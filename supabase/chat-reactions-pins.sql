-- Reações rápidas e mensagens fixadas nas conversas. Quem pode ler a conversa
-- pode reagir (em nome próprio) e fixar/desafixar mensagens. Aplique depois de
-- managed-channels.sql.
begin;

-- Mesma regra de leitura das mensagens (participante, não o acesso de moderação do admin).
create or replace function private.can_use_conversation(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation
      and ((c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
        or (c.kind = 'direct' and (c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid()))))
      and (not c.managed_channel or (select auth.uid()) = any (c.member_ids))
  );
$$;
revoke all on function private.can_use_conversation(uuid) from public, anon;
grant execute on function private.can_use_conversation(uuid) to authenticated;

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '✅', '👀', '❤️', '😂', '🙏')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists message_reactions_conversation_idx on public.message_reactions(conversation_id);
alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from anon, authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
create policy message_reactions_read on public.message_reactions for select to authenticated
  using (private.can_use_conversation(conversation_id));
create policy message_reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_use_conversation(conversation_id)
    and exists (select 1 from public.messages m where m.id = message_id and m.conversation_id = message_reactions.conversation_id and m.deleted_at is null));
create policy message_reactions_delete on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.message_pins (
  message_id uuid primary key references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists message_pins_conversation_idx on public.message_pins(conversation_id);
alter table public.message_pins enable row level security;
revoke all on public.message_pins from anon, authenticated;
grant select, insert, delete on public.message_pins to authenticated;
create policy message_pins_read on public.message_pins for select to authenticated
  using (private.can_use_conversation(conversation_id));
create policy message_pins_insert on public.message_pins for insert to authenticated
  with check (pinned_by = (select auth.uid()) and private.can_use_conversation(conversation_id)
    and exists (select 1 from public.messages m where m.id = message_id and m.conversation_id = message_pins.conversation_id and m.deleted_at is null));
create policy message_pins_delete on public.message_pins for delete to authenticated
  using (private.can_use_conversation(conversation_id));

alter table public.message_reactions replica identity full;
alter table public.message_pins replica identity full;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_pins') then
    alter publication supabase_realtime add table public.message_pins;
  end if;
end $$;

commit;
