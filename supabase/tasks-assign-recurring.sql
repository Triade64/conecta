-- Tarefas: responsável individual, autor da última mudança e recorrência mensal.
-- Aplique depois de tasks-open-templates.sql. Requer a extensão pg_cron.
begin;

-- 1. Responsável e autor da última mudança ------------------------------------
alter table public.tasks
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists assigned_name text not null default '',
  add column if not exists updated_by uuid references auth.users(id);

-- Registra quem mudou (nulo quando é a recorrência automática) e libera o
-- responsável sempre que a tarefa muda de etapa ou é encerrada.
create or replace function private.tasks_touch()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  if tg_op = 'UPDATE' and (new.current_step is distinct from old.current_step or new.status <> 'open') then
    new.assigned_to := null;
    new.assigned_name := '';
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before insert or update on public.tasks
  for each row execute function private.tasks_touch();

alter table public.task_events drop constraint if exists task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in ('created', 'advanced', 'returned', 'completed', 'cancelled', 'comment', 'claimed', 'released'));

-- Assumir (ou liberar) a etapa atual. Assumir: alguém do setor da vez ou admin.
-- Liberar: o próprio responsável ou admin.
create or replace function public.task_claim(p_task uuid, p_version integer, p_release boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks := private.lock_task_for_step(p_task, p_version);
  v_uid uuid := (select auth.uid());
begin
  if p_release then
    if v_task.assigned_to is null then raise exception 'task_not_assigned'; end if;
    if v_task.assigned_to <> v_uid and not private.is_active_admin() then raise exception 'task_forbidden'; end if;
    update public.tasks set assigned_to = null, assigned_name = '', version = version + 1, updated_at = now() where id = p_task;
  else
    if v_task.assigned_to = v_uid then raise exception 'task_already_yours'; end if;
    update public.tasks set assigned_to = v_uid, assigned_name = private.task_actor_name(), version = version + 1, updated_at = now() where id = p_task;
  end if;
  insert into public.task_events (task_id, kind, from_step, actor_id, actor_name)
  values (p_task, case when p_release then 'released' else 'claimed' end, v_task.current_step, v_uid, private.task_actor_name());
end;
$$;
revoke all on function public.task_claim(uuid, integer, boolean) from public, anon;
grant execute on function public.task_claim(uuid, integer, boolean) to authenticated;

-- 2. Recorrência mensal --------------------------------------------------------
create table if not exists public.task_recurrences (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_templates(id) on delete cascade,
  client_id uuid not null references public.task_clients(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 160),
  description text not null default '' check (length(description) <= 4000),
  priority text not null default 'normal' check (priority in ('baixa', 'normal', 'alta')),
  day_of_month integer not null check (day_of_month between 1 and 28),
  due_days integer not null default 5 check (due_days between 0 and 60),
  active boolean not null default true,
  last_period text check (last_period ~ '^\d{4}-\d{2}$'),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists task_recurrences_active_idx on public.task_recurrences (active, day_of_month);

-- Data de hoje no fuso do escritório.
create or replace function private.office_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'America/Sao_Paulo')::date; $$;

-- Ao criar: se o dia deste mês já passou, a primeira tarefa sai no próximo mês.
create or replace function private.task_recurrences_start()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.day_of_month < extract(day from private.office_today()) then
    new.last_period := to_char(private.office_today(), 'YYYY-MM');
  end if;
  return new;
end;
$$;
drop trigger if exists task_recurrences_start on public.task_recurrences;
create trigger task_recurrences_start before insert on public.task_recurrences
  for each row execute function private.task_recurrences_start();

alter table public.task_recurrences enable row level security;
revoke all on public.task_recurrences from public, anon, authenticated;
grant select, delete on public.task_recurrences to authenticated;
grant insert (template_id, client_id, title, description, priority, day_of_month, due_days) on public.task_recurrences to authenticated;
grant update (template_id, client_id, title, description, priority, day_of_month, due_days, active) on public.task_recurrences to authenticated;

create policy task_recurrences_read on public.task_recurrences for select to authenticated
  using (private.my_sector_key() is not null and (created_by = (select auth.uid()) or private.is_active_admin()));
create policy task_recurrences_insert on public.task_recurrences for insert to authenticated
  with check (private.my_sector_key() is not null and created_by = (select auth.uid()));
create policy task_recurrences_update on public.task_recurrences for update to authenticated
  using (private.my_sector_key() is not null and (created_by = (select auth.uid()) or private.is_active_admin()))
  with check (private.my_sector_key() is not null and (created_by = (select auth.uid()) or private.is_active_admin()));
create policy task_recurrences_delete on public.task_recurrences for delete to authenticated
  using (private.my_sector_key() is not null and (created_by = (select auth.uid()) or private.is_active_admin()));

-- Gera as tarefas do mês para recorrências cujo dia já chegou. Idempotente por
-- mês (last_period). "{mes}" no título vira MM/AAAA.
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
    insert into public.tasks (client_id, template_id, template_name, title, description, priority, due_date, steps, sector_keys, created_by)
    values (r.client_id, r.template_id, r.template_name,
            left(replace(r.title, '{mes}', to_char(v_today, 'MM/YYYY')), 160), r.description, r.priority,
            make_date(extract(year from v_today)::int, extract(month from v_today)::int, r.day_of_month) + r.due_days,
            r.steps,
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

-- Todo dia às 06:15 (Brasília) = 09:15 UTC.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'conecta-task-recurrences') then
    perform cron.unschedule('conecta-task-recurrences');
  end if;
  perform cron.schedule('conecta-task-recurrences', '15 9 * * *', 'select private.task_run_recurrences()');
end;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_recurrences') then
    alter publication supabase_realtime add table public.task_recurrences;
  end if;
end;
$$;

commit;
