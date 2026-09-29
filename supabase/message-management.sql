-- Message actions are limited to the author or the signed-in user's own view.
begin;

alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists messages_reply_to_idx on public.messages(reply_to);

create table if not exists public.message_hidden_for (
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index if not exists message_hidden_for_message_id_idx
  on public.message_hidden_for(message_id);

alter table public.message_hidden_for enable row level security;
grant select, insert, delete on public.message_hidden_for to authenticated;
revoke all on public.message_hidden_for from anon;

drop policy if exists message_hidden_read_own on public.message_hidden_for;
drop policy if exists message_hidden_insert_own on public.message_hidden_for;
drop policy if exists message_hidden_delete_own on public.message_hidden_for;

create policy message_hidden_read_own on public.message_hidden_for
  for select to authenticated using (user_id = (select auth.uid()));

create policy message_hidden_insert_own on public.message_hidden_for
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
      where m.id = message_id
    )
  );

create policy message_hidden_delete_own on public.message_hidden_for
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function private.validate_message_reply()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.reply_to is not null and not exists (
    select 1 from public.messages parent
    where parent.id = new.reply_to
      and parent.conversation_id = new.conversation_id
  ) then
    raise exception using errcode = '23514', message = 'A resposta precisa apontar para uma mensagem da mesma conversa.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_message_reply on public.messages;
create trigger validate_message_reply
  before insert or update of reply_to, conversation_id on public.messages
  for each row execute function private.validate_message_reply();

create or replace function private.stamp_message_edit()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.author_id is distinct from old.author_id
    or new.author_name is distinct from old.author_name
    or new.conversation_id is distinct from old.conversation_id
    or new.created_at is distinct from old.created_at
    or new.reply_to is distinct from old.reply_to then
    raise exception using errcode = '42501', message = 'A identidade e o destino da mensagem são imutáveis.';
  end if;
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception using errcode = '42501', message = 'Uma mensagem apagada não pode ser alterada novamente.';
  end if;
  if new.text is distinct from old.text then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_message_edit on public.messages;
create trigger stamp_message_edit
  before update on public.messages
  for each row execute function private.stamp_message_edit();

drop policy if exists messages_update_scoped on public.messages;
create policy messages_update_scoped on public.messages for update to authenticated
  using (
    author_id = (select auth.uid())
    and deleted_at is null
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.kind = 'channel'
        and private.can_access_sector(c.sector)
    )
  )
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.kind = 'channel'
        and private.can_access_sector(c.sector)
    )
  );

revoke update, delete on public.messages from anon, authenticated;
grant update (text, deleted_at) on public.messages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_hidden_for'
  ) then
    alter publication supabase_realtime add table public.message_hidden_for;
  end if;
end;
$$;

commit;
