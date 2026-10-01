begin;
alter table public.messages add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;
alter table public.messages add constraint chat_file_attachment_scope check (
  attachment_path is null or attachment_path not like 'file:%' or
  (split_part(attachment_path,'/',1) = 'file:' || author_id::text and
   split_part(attachment_path,'/',2) = conversation_id::text and
   attachment_size is not null and attachment_name is not null and attachment_mime is not null and
   attachment_size between 1 and 20971520 and char_length(attachment_name) between 1 and 255)
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('chat-files','chat-files',false,20971520,array['image/jpeg','image/png','image/gif','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','text/csv','application/zip','application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet']);
create policy chat_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='chat-files' and private.can_access_sector('Geral') and
  (storage.foldername(storage.objects.name))[1]=(select auth.uid())::text and
  lower(storage.extension(storage.objects.name)) in ('jpg','jpeg','png','gif','webp','pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv','zip','odt','ods') and
  exists(select 1 from public.conversations c where c.id::text=(storage.foldername(storage.objects.name))[2]
    and ((c.kind='channel' and private.can_access_sector(c.sector)) or
         (c.kind='direct' and (c.created_by=(select auth.uid()) or c.direct_recipient_id=(select auth.uid())))))
);
create policy chat_files_read on storage.objects for select to authenticated using (
  bucket_id='chat-files' and private.can_access_sector('Geral') and
  exists(select 1 from public.conversations c where c.id::text=(storage.foldername(storage.objects.name))[2]
    and ((c.kind='channel' and private.can_access_sector(c.sector)) or
         (c.kind='direct' and (c.created_by=(select auth.uid()) or c.direct_recipient_id=(select auth.uid()))))) and
  ((storage.foldername(storage.objects.name))[1]=(select auth.uid())::text or
   exists(select 1 from public.messages m where m.attachment_path='file:' || storage.objects.name and m.deleted_at is null))
);
create policy chat_files_delete_pending on storage.objects for delete to authenticated using (
  bucket_id='chat-files' and private.can_access_sector('Geral') and
  (storage.foldername(storage.objects.name))[1]=(select auth.uid())::text and
  exists(select 1 from public.conversations c where c.id::text=(storage.foldername(storage.objects.name))[2]
    and ((c.kind='channel' and private.can_access_sector(c.sector)) or
         (c.kind='direct' and (c.created_by=(select auth.uid()) or c.direct_recipient_id=(select auth.uid()))))) and
  not exists(select 1 from public.messages m where m.attachment_path='file:' || storage.objects.name)
);
commit;
