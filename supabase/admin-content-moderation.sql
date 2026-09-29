-- Gives active administrators cross-conversation message review and moderation.
-- The web app deletes messages for everyone with a soft delete (deleted_at).
begin;

drop policy if exists messages_admin_read_all on public.messages;
create policy messages_admin_read_all on public.messages
  for select to authenticated
  using (private.is_active_admin());

drop policy if exists messages_admin_update_all on public.messages;
create policy messages_admin_update_all on public.messages
  for update to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin());

commit;
