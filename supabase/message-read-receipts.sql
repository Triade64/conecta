begin;
-- A reader's watermark is visible only to the two participants in that direct chat.
create policy conversation_reads_direct_participants on public.conversation_reads
for select to authenticated using (
  private.can_access_sector('Geral') and exists (
    select 1 from public.conversations c
    where c.id = conversation_reads.conversation_id and c.kind = 'direct'
      and ((select auth.uid()) = c.created_by or (select auth.uid()) = c.direct_recipient_id)
      and (conversation_reads.user_id = c.created_by or conversation_reads.user_id = c.direct_recipient_id)
  )
);
-- Use message timestamps, preserve monotonic progress across tabs and keep RLS in force.
create or replace function public.mark_conversation_seen(p_conversation_id uuid, p_seen_at timestamptz)
returns void language sql security invoker set search_path = '' as $$
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  select p_conversation_id, (select auth.uid()), max(m.created_at)
  from public.messages m
  where m.conversation_id = p_conversation_id and m.created_at <= p_seen_at
    and m.created_at <= now() and m.deleted_at is null
  having max(m.created_at) is not null
  on conflict (conversation_id, user_id) do update
  set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at);
$$;
revoke all on function public.mark_conversation_seen(uuid,timestamptz) from public,anon;
grant execute on function public.mark_conversation_seen(uuid,timestamptz) to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conversation_reads') then
    alter publication supabase_realtime add table public.conversation_reads;
  end if;
end $$;
commit;
