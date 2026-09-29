-- Profile pictures for Conecta. Applied to Supabase project fmyenjfzdwizpgretpkk.
-- Private bucket; images are resized in the browser and capped at 300 KiB.
begin;

create table if not exists public.profile_photos (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  path text not null unique,
  updated_at timestamptz not null default now(),
  constraint profile_photos_path_matches_user check (path = user_id::text || '/avatar.webp')
);
alter table public.profile_photos enable row level security;
revoke all on public.profile_photos from anon, public;
grant select, insert, update, delete on public.profile_photos to authenticated;

drop policy if exists profile_photos_read_active on public.profile_photos;
drop policy if exists profile_photos_insert_self on public.profile_photos;
drop policy if exists profile_photos_update_self on public.profile_photos;
drop policy if exists profile_photos_delete_self on public.profile_photos;
create policy profile_photos_read_active on public.profile_photos for select to authenticated
  using (private.can_access_sector('Geral'));
create policy profile_photos_insert_self on public.profile_photos for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_access_sector('Geral'));
create policy profile_photos_update_self on public.profile_photos for update to authenticated
  using (user_id = (select auth.uid()) and private.can_access_sector('Geral'))
  with check (user_id = (select auth.uid()) and private.can_access_sector('Geral'));
create policy profile_photos_delete_self on public.profile_photos for delete to authenticated
  using (user_id = (select auth.uid()) and private.can_access_sector('Geral'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 307200, array['image/webp']::text[])
on conflict (id) do update set public = false, file_size_limit = 307200,
  allowed_mime_types = array['image/webp']::text[];

drop policy if exists profile_photos_storage_read on storage.objects;
drop policy if exists profile_photos_storage_insert_self on storage.objects;
drop policy if exists profile_photos_storage_update_self on storage.objects;
drop policy if exists profile_photos_storage_delete_self on storage.objects;
create policy profile_photos_storage_read on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and private.can_access_sector('Geral')
    and (
      name = (select auth.uid())::text || '/avatar.webp'
      or exists (select 1 from public.profile_photos p where p.path = name)
    )
  );
create policy profile_photos_storage_insert_self on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and private.can_access_sector('Geral')
    and name = (select auth.uid())::text || '/avatar.webp'
  );
create policy profile_photos_storage_update_self on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and private.can_access_sector('Geral')
    and name = (select auth.uid())::text || '/avatar.webp'
  )
  with check (
    bucket_id = 'profile-photos'
    and private.can_access_sector('Geral')
    and name = (select auth.uid())::text || '/avatar.webp'
  );
create policy profile_photos_storage_delete_self on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and name = (select auth.uid())::text || '/avatar.webp'
  );
commit;