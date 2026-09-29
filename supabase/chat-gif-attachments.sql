-- Enable animated GIF attachments in Conecta chats.
-- Messages remain protected by the existing conversation-scoped RLS policies.
begin;

alter table public.messages
  add column if not exists attachment_path text,
  add column if not exists attachment_url text;

create index if not exists messages_attachment_path_idx
  on public.messages (attachment_path) where attachment_path is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.messages'::regclass and conname='messages_attachment_url_https') then
    alter table public.messages add constraint messages_attachment_url_https
      check (attachment_url is null or (attachment_url like 'https://%' and char_length(attachment_url) <= 2048));
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 8388608, array['image/gif']::text[])
on conflict (id) do update set public = false, file_size_limit = 8388608,
  allowed_mime_types = array['image/gif']::text[];

drop policy if exists chat_media_read on storage.objects;
drop policy if exists chat_media_insert_self on storage.objects;
drop policy if exists chat_media_delete_self on storage.objects;
create policy chat_media_read on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and private.can_access_sector('Geral')
    and (
      name like (select auth.uid())::text || '/%'
      or exists (select 1 from public.messages m where m.attachment_path = name)
    )
  );
create policy chat_media_insert_self on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and private.can_access_sector('Geral')
    and name like (select auth.uid())::text || '/%.gif'
  );
create policy chat_media_delete_self on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and name like (select auth.uid())::text || '/%.gif'
  );
commit;