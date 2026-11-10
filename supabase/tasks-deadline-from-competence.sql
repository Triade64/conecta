-- Prazos das etapas contados a partir do mês seguinte à competência
-- (competência 10/2026 → etapas vencem em novembro/2026). Sem competência,
-- continuam contados a partir da data de criação. Recalcula as tarefas
-- abertas que têm competência. Aplique depois de tasks-competence.sql.
begin;

-- Início da contagem: 1º dia do mês seguinte à competência, ou hoje.
create or replace function private.task_deadline_start(p_competence text)
returns date language sql stable set search_path = ''
as $$
  select case when p_competence ~ '^\d{4}-(0[1-9]|1[0-2])$'
              then (to_date(p_competence || '-01', 'YYYY-MM-DD') + interval '1 month')::date
              else private.office_today() end;
$$;
revoke all on function private.task_deadline_start(text) from public, anon;
grant execute on function private.task_deadline_start(text) to authenticated;

create or replace function public.task_create(
  p_client uuid, p_template uuid, p_title text, p_description text, p_priority text, p_due date,
  p_competence text default null
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
  if p_competence is not null and p_competence !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'task_competence_invalid'; end if;
  select * into v_template from public.task_templates where id = p_template and active;
  if not found then raise exception 'task_template_unavailable'; end if;
  if not exists (select 1 from public.task_clients where id = p_client and active) then
    raise exception 'task_client_unavailable';
  end if;
  v_steps := private.task_step_dates(v_template.steps, private.task_deadline_start(p_competence));
  select array_agg(distinct private.sector_key(e->>'sector')) into v_keys
    from jsonb_array_elements(v_template.steps) e;
  v_keys := array(select distinct unnest(v_keys || private.my_sector_key()));
  insert into public.tasks (client_id, template_id, template_name, title, description, priority, due_date, steps, sector_keys, created_by, competence)
  values (p_client, v_template.id, v_template.name, btrim(p_title), coalesce(p_description, ''),
          coalesce(nullif(p_priority, ''), 'normal'), coalesce(private.task_last_due(v_steps), p_due), v_steps, v_keys, v_uid, p_competence)
  returning id into v_id;
  insert into public.task_events (task_id, kind, to_step, actor_id, actor_name)
  values (v_id, 'created', 0, v_uid, private.task_actor_name());
  return v_id;
end;
$$;
revoke all on function public.task_create(uuid, uuid, text, text, text, date, text) from public, anon;
grant execute on function public.task_create(uuid, uuid, text, text, text, date, text) to authenticated;

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
  v_comp_date date;
  v_comp text;
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
    v_comp_date := (date_trunc('month', v_today) + make_interval(months => r.competence_offset))::date;
    v_comp := to_char(v_comp_date, 'MM/YYYY');
    v_steps := private.task_step_dates(r.steps, private.task_deadline_start(to_char(v_comp_date, 'YYYY-MM')));
    insert into public.tasks (client_id, template_id, template_name, title, description, priority, due_date, steps, sector_keys, created_by, competence)
    values (r.client_id, r.template_id, r.template_name,
            left(replace(replace(r.title, '{mes}', v_comp), '{competencia}', v_comp), 160), r.description, r.priority,
            coalesce(private.task_last_due(v_steps),
                     make_date(extract(year from v_today)::int, extract(month from v_today)::int, r.day_of_month) + r.due_days),
            v_steps,
            array(select distinct k from (
              select private.sector_key(e->>'sector') as k from jsonb_array_elements(r.steps) e
              union select private.sector_key(r.creator_sector)) s),
            r.created_by, to_char(v_comp_date, 'YYYY-MM'))
    returning id into v_id;
    insert into public.task_events (task_id, kind, to_step, note, actor_id, actor_name)
    values (v_id, 'created', 0, 'Criada automaticamente pela recorrência mensal (competência ' || v_comp || ').', r.created_by, r.creator_name);
    update public.task_recurrences set last_period = v_period where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.task_run_recurrences() from public, anon, authenticated;

-- Recalcula as tarefas abertas com competência pela regra nova.
update public.tasks
set steps = private.task_step_dates(steps, private.task_deadline_start(competence)),
    due_date = coalesce(private.task_last_due(private.task_step_dates(steps, private.task_deadline_start(competence))), due_date),
    updated_at = now()
where status = 'open' and competence is not null
  and steps is distinct from private.task_step_dates(steps, private.task_deadline_start(competence));

commit;
