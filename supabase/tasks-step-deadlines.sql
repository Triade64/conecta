-- Prazo por etapa: no modelo de fluxo, cada etapa pode ter "due_day" (dia do mês,
-- 1 a 31). Ao criar a tarefa, cada etapa recebe a próxima data com esse dia a
-- partir da criação, nunca antes da etapa anterior; fim de semana ou feriado
-- adia para o próximo dia útil. O prazo da tarefa (due_date) passa a ser o da
-- última etapa. Aplique depois de tasks-assign-recurring.sql.
begin;

-- Feriados (administradores mantêm). Já inclui os nacionais de 2026 e 2027.
create table if not exists public.holidays (
  day date primary key,
  name text not null check (length(btrim(name)) between 2 and 80)
);
alter table public.holidays enable row level security;
revoke all on public.holidays from public, anon, authenticated;
grant select on public.holidays to authenticated;
grant insert (day, name), update (name), delete on public.holidays to authenticated;
drop policy if exists holidays_read on public.holidays;
drop policy if exists holidays_admin_write on public.holidays;
create policy holidays_read on public.holidays for select to authenticated
  using (private.my_sector_key() is not null);
create policy holidays_admin_write on public.holidays for all to authenticated
  using (private.is_active_admin()) with check (private.is_active_admin());
insert into public.holidays (day, name) values
  ('2026-01-01', 'Confraternização Universal'), ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'), ('2026-05-01', 'Dia do Trabalho'),
  ('2026-09-07', 'Independência do Brasil'), ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'), ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'), ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'), ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'), ('2027-05-01', 'Dia do Trabalho'),
  ('2027-09-07', 'Independência do Brasil'), ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'), ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'), ('2027-12-25', 'Natal')
on conflict (day) do nothing;

-- Próximo dia útil (o próprio dia, se já for útil).
create or replace function private.business_day(p_day date)
returns date language plpgsql stable security definer set search_path = ''
as $$
declare d date := p_day;
begin
  while extract(isodow from d) in (6, 7) or exists (select 1 from public.holidays h where h.day = d) loop
    d := d + 1;
  end loop;
  return d;
end;
$$;

-- Data com o dia "p_day" no mês de "p_month" (dia 31 em mês curto = último dia).
create or replace function private.day_in_month(p_month date, p_day integer)
returns date language sql immutable set search_path = ''
as $$
  select make_date(extract(year from p_month)::int, extract(month from p_month)::int,
    least(p_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int));
$$;

-- Preenche due_date em cada etapa com due_day, a partir de p_start.
create or replace function private.task_step_dates(p_steps jsonb, p_start date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_prev date := p_start;
  v_out jsonb := '[]'::jsonb;
  v_step jsonb;
  v_day integer;
  v_raw date;
  v_due date;
begin
  for v_step in select e from jsonb_array_elements(p_steps) e loop
    v_step := v_step - 'due_date';
    if jsonb_typeof(v_step->'due_day') = 'number' then
      v_day := (v_step->>'due_day')::int;
      v_raw := private.day_in_month(v_prev, v_day);
      if v_raw < v_prev then v_raw := private.day_in_month((date_trunc('month', v_prev) + interval '1 month')::date, v_day); end if;
      v_due := private.business_day(v_raw);
      v_step := v_step || jsonb_build_object('due_date', to_char(v_due, 'YYYY-MM-DD'));
      v_prev := v_due;
    end if;
    v_out := v_out || jsonb_build_array(v_step);
  end loop;
  return v_out;
end;
$$;

create or replace function private.task_last_due(p_steps jsonb)
returns date language sql immutable set search_path = ''
as $$ select max((e->>'due_date')::date) from jsonb_array_elements(p_steps) e where e ? 'due_date'; $$;

revoke all on function private.business_day(date) from public, anon;
revoke all on function private.day_in_month(date, integer) from public, anon;
revoke all on function private.task_step_dates(jsonb, date) from public, anon;
revoke all on function private.task_last_due(jsonb) from public, anon;
grant execute on function private.business_day(date) to authenticated;
grant execute on function private.day_in_month(date, integer) to authenticated;
grant execute on function private.task_step_dates(jsonb, date) to authenticated;
grant execute on function private.task_last_due(jsonb) to authenticated;

-- Valida due_day (opcional, inteiro de 1 a 31) além do que já era validado.
create or replace function private.valid_task_steps(p_steps jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p_steps) = 'array'
    and jsonb_array_length(p_steps) between 1 and 12
    and not exists (
      select 1 from jsonb_array_elements(p_steps) e
      where jsonb_typeof(e) <> 'object'
        or length(btrim(coalesce(e->>'sector', ''))) not between 1 and 60
        or length(coalesce(e->>'label', '')) > 80
        or (e ? 'due_day' and jsonb_typeof(e->'due_day') <> 'null'
            and (jsonb_typeof(e->'due_day') <> 'number' or (e->>'due_day')::numeric not between 1 and 31
                 or (e->>'due_day')::numeric <> trunc((e->>'due_day')::numeric)))
    );
$$;

create or replace function public.task_create(
  p_client uuid, p_template uuid, p_title text, p_description text, p_priority text, p_due date
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_template public.task_templates;
  v_steps jsonb;
  v_keys text[];
  v_id uuid;
begin
  if private.my_sector_key() is null then raise exception 'task_forbidden'; end if;
  select * into v_template from public.task_templates where id = p_template and active;
  if not found then raise exception 'task_template_unavailable'; end if;
  if not exists (select 1 from public.task_clients where id = p_client and active) then
    raise exception 'task_client_unavailable';
  end if;
  v_steps := private.task_step_dates(v_template.steps, private.office_today());
  select array_agg(distinct private.sector_key(e->>'sector')) into v_keys
    from jsonb_array_elements(v_template.steps) e;
  v_keys := array(select distinct unnest(v_keys || private.my_sector_key()));
  insert into public.tasks (client_id, template_id, template_name, title, description, priority, due_date, steps, sector_keys, created_by)
  values (p_client, v_template.id, v_template.name, btrim(p_title), coalesce(p_description, ''),
          coalesce(nullif(p_priority, ''), 'normal'), coalesce(private.task_last_due(v_steps), p_due), v_steps, v_keys, v_uid)
  returning id into v_id;
  insert into public.task_events (task_id, kind, to_step, actor_id, actor_name)
  values (v_id, 'created', 0, v_uid, private.task_actor_name());
  return v_id;
end;
$$;

create or replace function private.task_run_recurrences()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := private.office_today();
  v_period text := to_char(v_today, 'YYYY-MM');
  v_count integer := 0;
  r record;
  v_id uuid;
  v_steps jsonb;
begin
  for r in
    select rc.*, t.name as template_name, t.steps, p.sector as creator_sector, p.name as creator_name
    from public.task_recurrences rc
    join public.task_templates t on t.id = rc.template_id and t.active
    join public.task_clients c on c.id = rc.client_id and c.active
    join public.profiles p on p.id = rc.created_by and p.active
    where rc.active and rc.day_of_month <= extract(day from v_today)
      and coalesce(rc.last_period, '') < v_period
    for update of rc skip locked
  loop
    v_steps := private.task_step_dates(r.steps, v_today);
    insert into public.tasks (client_id, template_id, template_name, title, description, priority, due_date, steps, sector_keys, created_by)
    values (r.client_id, r.template_id, r.template_name,
            left(replace(r.title, '{mes}', to_char(v_today, 'MM/YYYY')), 160), r.description, r.priority,
            coalesce(private.task_last_due(v_steps),
                     make_date(extract(year from v_today)::int, extract(month from v_today)::int, r.day_of_month) + r.due_days),
            v_steps,
            array(select distinct k from (
              select private.sector_key(e->>'sector') as k from jsonb_array_elements(r.steps) e
              union select private.sector_key(r.creator_sector)) s),
            r.created_by)
    returning id into v_id;
    insert into public.task_events (task_id, kind, to_step, note, actor_id, actor_name)
    values (v_id, 'created', 0, 'Criada automaticamente pela recorrência mensal.', r.created_by, r.creator_name);
    update public.task_recurrences set last_period = v_period where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.task_run_recurrences() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'holidays') then
    alter publication supabase_realtime add table public.holidays;
  end if;
end;
$$;

commit;
