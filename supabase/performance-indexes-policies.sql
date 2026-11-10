-- Desempenho: índices nas consultas mais frequentes e regras de acesso unificadas.
-- As regras unificadas são equivalentes às anteriores (mesmo resultado, uma avaliação só).

create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc, id desc);
create index if not exists messages_author_idx on public.messages (author_id);
create index if not exists conversations_created_by_idx on public.conversations (created_by);
create index if not exists conversations_direct_recipient_idx on public.conversations (direct_recipient_id);
create index if not exists conversation_reads_user_idx on public.conversation_reads (user_id);
create index if not exists reminders_owner_idx on public.reminders (owner_id);
create index if not exists tasks_assigned_to_idx on public.tasks (assigned_to);
create index if not exists message_reactions_user_idx on public.message_reactions (user_id);

-- messages: leitura e edição (administrador OU regra normal) em uma regra só.
drop policy if exists messages_admin_read_all on public.messages;
drop policy if exists messages_read_scoped on public.messages;
create policy messages_read_scoped on public.messages for select to authenticated using (
  private.is_active_admin() or exists (select 1 from public.conversations c where c.id = messages.conversation_id and (
    (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
    or (c.kind = 'direct' and ((select auth.uid()) = c.created_by or (select auth.uid()) = c.direct_recipient_id)))));

drop policy if exists messages_admin_update_all on public.messages;
drop policy if exists messages_update_scoped on public.messages;
create policy messages_update_scoped on public.messages for update to authenticated
using (
  private.is_active_admin() or (author_id = (select auth.uid()) and deleted_at is null and exists (select 1 from public.conversations c where c.id = messages.conversation_id and (
    (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
    or (c.kind = 'direct' and ((select auth.uid()) = c.created_by or (select auth.uid()) = c.direct_recipient_id))))))
with check (
  private.is_active_admin() or (author_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = messages.conversation_id and (
    (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
    or (c.kind = 'direct' and ((select auth.uid()) = c.created_by or (select auth.uid()) = c.direct_recipient_id))))));

-- conversation_reads: as duas regras de leitura em uma.
drop policy if exists conversation_reads_direct_participants on public.conversation_reads;
drop policy if exists conversation_reads_select_own on public.conversation_reads;
create policy conversation_reads_select on public.conversation_reads for select to authenticated using (
  (user_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = conversation_reads.conversation_id and (
    (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
    or (c.kind = 'direct' and (c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid()))))))
  or (private.can_access_sector('Geral') and exists (select 1 from public.conversations c where c.id = conversation_reads.conversation_id and c.kind = 'direct'
    and ((select auth.uid()) = c.created_by or (select auth.uid()) = c.direct_recipient_id)
    and (conversation_reads.user_id = c.created_by or conversation_reads.user_id = c.direct_recipient_id))));

-- holidays: escrita só do administrador, leitura em uma regra.
drop policy if exists holidays_admin_write on public.holidays;
drop policy if exists holidays_read on public.holidays;
create policy holidays_read on public.holidays for select to authenticated using (private.my_sector_key() is not null or private.is_active_admin());
create policy holidays_admin_insert on public.holidays for insert to authenticated with check (private.is_active_admin());
create policy holidays_admin_update on public.holidays for update to authenticated using (private.is_active_admin()) with check (private.is_active_admin());
create policy holidays_admin_delete on public.holidays for delete to authenticated using (private.is_active_admin());

-- workflow_notification_reads: auth.uid() avaliado uma vez por consulta.
drop policy if exists workflow_ack_read on public.workflow_notification_reads;
create policy workflow_ack_read on public.workflow_notification_reads for select to authenticated using (user_id = (select auth.uid()));
