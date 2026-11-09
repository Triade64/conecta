-- Fluxo de tarefas entre setores. Aplique depois dos scripts existentes.
-- Modelo: cada tarefa pertence a um cliente e segue uma sequência de etapas
-- (copiada do modelo de fluxo no momento da criação). Cada etapa pertence a um
-- setor, comparado com profiles.sector. As mudanças de estado só ocorrem pelas
-- funções task_*; o banco impõe a sequência e o controle de versão.
begin;

-- Normaliza o nome do setor: minúsculas, sem acentos nem espaços nas pontas.
create or replace function private.sector_key(p_sector text)
returns text language sql immutable set search_path = ''
as $$ select translate(lower(btrim(coalesce(p_sector, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'); $$;

-- Setor normalizado do usuário ativo; nulo quando inativo ou sem perfil.
create or replace function private.my_sector_key()
returns text language sql stable security definer set search_path = ''
as $$
  select private.sector_key(p.sector) from public.profiles p
  where p.id = (select auth.uid()) and p.active;
$$;

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
    );
$$;

create or replace function private.can_view_task(p_keys text[], p_creator uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.my_sector_key() is not null and (
    private.is_active_admin()
    or p_creator = (select auth.uid())
    or private.my_sector_key() = any (p_keys)
  );
$$;

revoke all on function private.sector_key(text) from public, anon;
revoke all on function private.my_sector_key() from public, anon;
revoke all on function private.valid_task_steps(jsonb) from public, anon;
revoke all on function private.can_view_task(text[], uuid) from public, anon;
grant execute on function private.sector_key(text) to authenticated;
grant execute on function private.my_sector_key() to authenticated;
grant execute on function private.valid_task_steps(jsonb) to authenticated;
grant execute on function private.can_view_task(text[], uuid) to authenticated;

create table public.task_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  document text check (document is null or length(document) <= 30),
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index task_clients_name_key on public.task_clients (lower(btrim(name)));

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  steps jsonb not null check (private.valid_task_steps(steps)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index task_templates_name_key on public.task_templates (lower(btrim(name)));

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.task_clients(id),
  template_id uuid references public.task_templates(id) on delete set null,
  template_name text not null,
  title text not null check (length(btrim(title)) between 3 and 160),
  description text not null default '' check (length(description) <= 4000),
  priority text not null default 'normal' check (priority in ('baixa', 'normal', 'alta')),
  due_date date,
  steps jsonb not null check (private.valid_task_steps(steps)),
  current_step integer not null default 0 check (current_step >= 0),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  sector_keys text[] not null,
  created_by uuid not null references auth.users(id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (current_step < jsonb_array_length(steps))
);
create index tasks_sector_keys_idx on public.tasks using gin (sector_keys);
create index tasks_status_updated_idx on public.tasks (status, updated_at desc);
create index tasks_client_idx on public.tasks (client_id);

create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('created', 'advanced', 'returned', 'completed', 'cancelled', 'comment')),
  from_step integer,
  to_step integer,
  note text not null default '' check (length(note) <= 2000),
  actor_id uuid not null references auth.users(id),
  actor_name text not null default '',
  created_at timestamptz not null default now()
);
create index task_events_task_idx on public.task_events (task_id, id);

alter table public.task_clients enable row level security;
alter table public.task_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
revoke all on public.task_clients, public.task_templates, public.tasks, public.task_events from public, anon, authenticated;

grant select on public.task_clients, public.task_templates, public.tasks, public.task_events to authenticated;
grant insert (name, document) on public.task_clients to authenticated;
grant update (name, document, active) on public.task_clients to authenticated;
grant insert (name, steps, active), update (name, steps, active, updated_at) on public.task_templates to authenticated;
grant delete on public.task_templates to authenticated;

create policy task_clients_read on public.task_clients for select to authenticated
  using (private.my_sector_key() is not null);
create policy task_clients_insert on public.task_clients for insert to authenticated
  with check (private.my_sector_key() is not null and created_by = (select auth.uid()));
create policy task_clients_admin_update on public.task_clients for update to authenticated
  using (private.is_active_admin()) with check (private.is_active_admin());

create policy task_templates_read on public.task_templates for select to authenticated
  using (private.my_sector_key() is not null and (active or private.is_active_admin()));
create policy task_templates_admin_write on public.task_templates for all to authenticated
  using (private.is_active_admin()) with check (private.is_active_admin());

create policy tasks_read on public.tasks for select to authenticated
  using (private.can_view_task(sector_keys, created_by));
create policy task_events_read on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- Nome do autor registrado no histórico (sobrevive a renomeações de perfil).
create or replace function private.task_actor_name()
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select p.name from public.profiles p where p.id = (select auth.uid())), ''); $$;
revoke all on function private.task_actor_name() from public, anon;
grant execute on function private.task_actor_name() to authenticated;

create or replace function public.task_create(
  p_client uuid, p_template uuid, p_title text, p_description text, p_priority text, p_due date
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_template public.task_templates;
  v_keys text[];
  v_id uuid;
begin
  if private.my_sector_key() is null then raise exception 'task_forbidden'; end if;
  select * into v_template from public.task_templates where id = p_template and active;
  if not found then raise exception 'task_template_unavailable'; end if;
  if not exists (select 1 from public.task_clients where id = p_client and active) then
    raise exception 'task_client_unavailable';
  end if;
  select array_agg(distinct private.sector_key(e->>'sector')) into v_keys
    from jsonb_array_elements(v_template.steps) e;
  v_keys := array(select distinct unnest(v_keys || private.my_sector_key()));
  insert into public.tasks (client_id, template_id, template_name, title, description, priority, due_date, steps, sector_keys, created_by)
  values (p_client, v_template.id, v_template.name, btrim(p_title), coalesce(p_description, ''),
          coalesce(nullif(p_priority, ''), 'normal'), p_due, v_template.steps, v_keys, v_uid)
  returning id into v_id;
  insert into public.task_events (task_id, kind, to_step, actor_id, actor_name)
  values (v_id, 'created', 0, v_uid, private.task_actor_name());
  return v_id;
end;
$$;

-- Etapa atual só pode ser movida por quem é do setor dela (ou administrador).
create or replace function private.lock_task_for_step(p_task uuid, p_version integer)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or not private.can_view_task(v_task.sector_keys, v_task.created_by) then
    raise exception 'task_not_found';
  end if;
  if v_task.status <> 'open' then raise exception 'task_closed'; end if;
  if v_task.version <> p_version then raise exception 'task_version_conflict'; end if;
  if not (private.is_active_admin()
          or private.my_sector_key() = private.sector_key(v_task.steps -> v_task.current_step ->> 'sector')) then
    raise exception 'task_wrong_sector';
  end if;
  return v_task;
end;
$$;
revoke all on function private.lock_task_for_step(uuid, integer) from public, anon;
grant execute on function private.lock_task_for_step(uuid, integer) to authenticated;

create or replace function public.task_advance(p_task uuid, p_version integer, p_note text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks := private.lock_task_for_step(p_task, p_version);
  v_next integer := v_task.current_step + 1;
  v_last boolean := v_task.current_step + 1 >= jsonb_array_length(v_task.steps);
begin
  update public.tasks set
    current_step = case when v_last then current_step else v_next end,
    status = case when v_last then 'done' else status end,
    completed_at = case when v_last then now() else completed_at end,
    version = version + 1, updated_at = now()
  where id = p_task;
  insert into public.task_events (task_id, kind, from_step, to_step, note, actor_id, actor_name)
  values (p_task, case when v_last then 'completed' else 'advanced' end, v_task.current_step,
          case when v_last then v_task.current_step else v_next end,
          left(btrim(coalesce(p_note, '')), 2000), (select auth.uid()), private.task_actor_name());
end;
$$;

create or replace function public.task_return(p_task uuid, p_version integer, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_task public.tasks := private.lock_task_for_step(p_task, p_version);
begin
  if v_task.current_step = 0 then raise exception 'task_first_step'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'task_note_required'; end if;
  update public.tasks set current_step = current_step - 1, version = version + 1, updated_at = now()
  where id = p_task;
  insert into public.task_events (task_id, kind, from_step, to_step, note, actor_id, actor_name)
  values (p_task, 'returned', v_task.current_step, v_task.current_step - 1,
          left(btrim(p_note), 2000), (select auth.uid()), private.task_actor_name());
end;
$$;

create or replace function public.task_cancel(p_task uuid, p_version integer, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or not private.can_view_task(v_task.sector_keys, v_task.created_by) then
    raise exception 'task_not_found';
  end if;
  if v_task.created_by <> (select auth.uid()) and not private.is_active_admin() then
    raise exception 'task_forbidden';
  end if;
  if v_task.status <> 'open' then raise exception 'task_closed'; end if;
  if v_task.version <> p_version then raise exception 'task_version_conflict'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'task_note_required'; end if;
  update public.tasks set status = 'cancelled', completed_at = now(), version = version + 1, updated_at = now()
  where id = p_task;
  insert into public.task_events (task_id, kind, from_step, note, actor_id, actor_name)
  values (p_task, 'cancelled', v_task.current_step, left(btrim(p_note), 2000), (select auth.uid()), private.task_actor_name());
end;
$$;

create or replace function public.task_comment(p_task uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task;
  if not found or not private.can_view_task(v_task.sector_keys, v_task.created_by) then
    raise exception 'task_not_found';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 1 then raise exception 'task_note_required'; end if;
  insert into public.task_events (task_id, kind, from_step, note, actor_id, actor_name)
  values (p_task, 'comment', v_task.current_step, left(btrim(p_note), 2000), (select auth.uid()), private.task_actor_name());
end;
$$;

revoke all on function public.task_create(uuid, uuid, text, text, text, date) from public, anon;
revoke all on function public.task_advance(uuid, integer, text) from public, anon;
revoke all on function public.task_return(uuid, integer, text) from public, anon;
revoke all on function public.task_cancel(uuid, integer, text) from public, anon;
revoke all on function public.task_comment(uuid, text) from public, anon;
grant execute on function public.task_create(uuid, uuid, text, text, text, date) to authenticated;
grant execute on function public.task_advance(uuid, integer, text) to authenticated;
grant execute on function public.task_return(uuid, integer, text) to authenticated;
grant execute on function public.task_cancel(uuid, integer, text) to authenticated;
grant execute on function public.task_comment(uuid, text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['tasks', 'task_events', 'task_clients', 'task_templates'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

commit;
