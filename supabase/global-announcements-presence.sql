-- Run after schema.sql and sector-permissions.sql.
begin;

-- Upgrade the previous single global announcement into a scheduled collection.
alter table public.global_announcements add column if not exists id uuid;
update public.global_announcements set id = gen_random_uuid() where id is null;
do $$
declare key_name text;
begin
  select conname into key_name from pg_constraint
  where conrelid = 'public.global_announcements'::regclass and contype = 'p';
  if key_name is not null then
    execute format('alter table public.global_announcements drop constraint %I', key_name);
  end if;
end;
$$;
alter table public.global_announcements drop column if exists singleton;
alter table public.global_announcements alter column id set default gen_random_uuid();
alter table public.global_announcements alter column id set not null;
alter table public.global_announcements add constraint global_announcements_pkey primary key (id);
alter table public.global_announcements add column if not exists starts_at timestamptz not null default now();
alter table public.global_announcements add column if not exists ends_at timestamptz;
alter table public.global_announcements add column if not exists image_path text;
alter table public.global_announcements drop constraint if exists global_announcements_title_check;
alter table public.global_announcements drop constraint if exists global_announcements_body_check;
alter table public.global_announcements drop constraint if exists global_announcements_schedule_check;
alter table public.global_announcements add constraint global_announcements_title_check check (char_length(title) between 1 and 120);
alter table public.global_announcements add constraint global_announcements_body_check check (char_length(body) between 1 and 4000);
alter table public.global_announcements add constraint global_announcements_schedule_check check (ends_at is null or ends_at > starts_at);

alter table public.global_announcements enable row level security;
revoke all on public.global_announcements from anon, public;
grant select, insert, update, delete on public.global_announcements to authenticated;
drop policy if exists global_announcement_read on public.global_announcements;
drop policy if exists global_announcement_insert_admin on public.global_announcements;
drop policy if exists global_announcement_update_admin on public.global_announcements;
drop policy if exists global_announcement_delete_admin on public.global_announcements;
create policy global_announcement_read on public.global_announcements for select to authenticated
  using (private.is_active_admin() or (is_active and starts_at <= now()
    and (ends_at is null or ends_at > now()) and private.can_access_sector('Geral')));
create policy global_announcement_insert_admin on public.global_announcements for insert to authenticated
  with check (private.is_active_admin() and updated_by = (select auth.uid()));
create policy global_announcement_update_admin on public.global_announcements for update to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin() and updated_by = (select auth.uid()));
create policy global_announcement_delete_admin on public.global_announcements for delete to authenticated
  using (private.is_active_admin());

-- Images are private; client-optimized files are capped at 1 MiB in Storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('global-announcements', 'global-announcements', false, 1048576, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public = false, file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[];
drop policy if exists global_announcement_images_read on storage.objects;
drop policy if exists global_announcement_images_insert_admin on storage.objects;
drop policy if exists global_announcement_images_update_admin on storage.objects;
drop policy if exists global_announcement_images_delete_admin on storage.objects;
create policy global_announcement_images_read on storage.objects for select to authenticated
  using (bucket_id = 'global-announcements' and (private.is_active_admin() or (
    private.can_access_sector('Geral') and exists (
      select 1 from public.global_announcements a where a.image_path = name and a.is_active
        and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
    )
  )));
create policy global_announcement_images_insert_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'global-announcements' and private.is_active_admin());
create policy global_announcement_images_update_admin on storage.objects for update to authenticated
  using (bucket_id = 'global-announcements' and private.is_active_admin())
  with check (bucket_id = 'global-announcements' and private.is_active_admin());
create policy global_announcement_images_delete_admin on storage.objects for delete to authenticated
  using (bucket_id = 'global-announcements' and private.is_active_admin());

-- Presence is shared only by authenticated, active Conecta users on one fixed topic.
drop policy if exists conecta_presence_read on realtime.messages;
drop policy if exists conecta_presence_track on realtime.messages;
create policy conecta_presence_read on realtime.messages for select to authenticated
  using (extension = 'presence' and realtime.topic() = 'conecta-presence' and private.can_access_sector('Geral'));
create policy conecta_presence_track on realtime.messages for insert to authenticated
  with check (extension = 'presence' and realtime.topic() = 'conecta-presence' and private.can_access_sector('Geral'));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'global_announcements') then
    alter publication supabase_realtime add table public.global_announcements;
  end if;
end;
$$;
commit;
