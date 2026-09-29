-- Run after schema.sql and sector-permissions.sql.
begin;

create table if not exists public.global_announcements (
  singleton boolean primary key default true check (singleton),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.global_announcements enable row level security;
revoke all on public.global_announcements from anon, public;
grant select, insert, update, delete on public.global_announcements to authenticated;

drop policy if exists global_announcement_read on public.global_announcements;
drop policy if exists global_announcement_insert_admin on public.global_announcements;
drop policy if exists global_announcement_update_admin on public.global_announcements;
drop policy if exists global_announcement_delete_admin on public.global_announcements;

create policy global_announcement_read on public.global_announcements for select to authenticated
  using ((is_active and private.can_access_sector('Geral')) or private.is_active_admin());
create policy global_announcement_insert_admin on public.global_announcements for insert to authenticated
  with check (private.is_active_admin() and updated_by = (select auth.uid()));
create policy global_announcement_update_admin on public.global_announcements for update to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin() and updated_by = (select auth.uid()));
create policy global_announcement_delete_admin on public.global_announcements for delete to authenticated
  using (private.is_active_admin());

-- Presence is shared only by authenticated, active Conecta users on one fixed topic.
drop policy if exists conecta_presence_read on realtime.messages;
drop policy if exists conecta_presence_track on realtime.messages;
create policy conecta_presence_read on realtime.messages for select to authenticated
  using (extension = 'presence' and realtime.topic() = 'conecta-presence' and private.can_access_sector('Geral'));
create policy conecta_presence_track on realtime.messages for insert to authenticated
  with check (extension = 'presence' and realtime.topic() = 'conecta-presence' and private.can_access_sector('Geral'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'global_announcements'
  ) then
    alter publication supabase_realtime add table public.global_announcements;
  end if;
end;
$$;

commit;
