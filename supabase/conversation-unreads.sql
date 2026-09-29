-- Persist the last-read point per user and conversation. The RPC returns only
-- unread counts and runs as the caller, so existing message RLS remains in force.
begin;

create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_reads enable row level security;
revoke all on public.conversation_reads from public, anon;
grant select, insert on public.conversation_reads to authenticated;
grant update (last_read_at) on public.conversation_reads to authenticated;

drop policy if exists conversation_reads_select_own on public.conversation_reads;
drop policy if exists conversation_reads_insert_own on public.conversation_reads;
drop policy if exists conversation_reads_update_own on public.conversation_reads;

create policy conversation_reads_select_own on public.conversation_reads
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (
        (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
        or (c.kind = 'direct' and (
          c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid())
        ))
      )
    )
  );

create policy conversation_reads_insert_own on public.conversation_reads
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (
        (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
        or (c.kind = 'direct' and (
          c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid())
        ))
      )
    )
  );

create policy conversation_reads_update_own on public.conversation_reads
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (
        (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
        or (c.kind = 'direct' and (
          c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid())
        ))
      )
    )
  );

create or replace function public.get_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql
stable
set search_path = ''
as $$
  select m.conversation_id, count(*)::bigint
  from public.messages m
  left join public.conversation_reads r
    on r.conversation_id = m.conversation_id
    and r.user_id = (select auth.uid())
  where m.author_id <> (select auth.uid())
    and m.deleted_at is null
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
    and not exists (
      select 1 from public.message_hidden_for h
      where h.message_id = m.id and h.user_id = (select auth.uid())
    )
  group by m.conversation_id;
$$;

revoke all on function public.get_unread_counts() from public, anon;
grant execute on function public.get_unread_counts() to authenticated;

commit;
