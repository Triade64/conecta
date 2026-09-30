-- Shared office calendar. Active staff can read; active admins manage the rotation.
begin;
create table public.kitchen_calendar (
  id boolean primary key default true check (id),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.kitchen_calendar enable row level security;
revoke all on public.kitchen_calendar from public, anon, authenticated;
grant select on public.kitchen_calendar to authenticated;
grant update (config, version, updated_at) on public.kitchen_calendar to authenticated;
create policy kitchen_calendar_read on public.kitchen_calendar for select to authenticated
  using (private.can_access_sector('Geral'));
create policy kitchen_calendar_manage on public.kitchen_calendar for update to authenticated
  using (private.is_active_admin()) with check (private.is_active_admin());
insert into public.kitchen_calendar (id) values (true);
commit;
