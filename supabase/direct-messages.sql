-- Direct conversations are shared only by their two participants.
begin;

alter table public.conversations
  add column if not exists direct_recipient_id uuid references public.profiles(id) on delete cascade,
  add column if not exists direct_key text;

create unique index if not exists conversations_direct_key_unique
  on public.conversations (direct_key)
  where direct_key is not null;

create or replace function public.list_team_directory()
returns table (id uuid, name text, role text, sector text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.role::text, p.sector
  from public.profiles p
  where p.active
    and p.id <> (select auth.uid())
    and exists (
      select 1 from public.profiles current_profile
      where current_profile.id = (select auth.uid())
        and current_profile.active
    )
  order by p.name;
$$;

revoke all on function public.list_team_directory() from public, anon;
grant execute on function public.list_team_directory() to authenticated;

create or replace function public.start_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text;
  v_conversation_id uuid;
begin
  if v_actor is null or p_other_user_id is null or p_other_user_id = v_actor then
    raise exception 'Selecione outro colaborador ativo.';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_actor and p.active) then
    raise exception 'Usuário inativo ou não autorizado.';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_other_user_id and p.active) then
    raise exception 'Colaborador não encontrado ou inativo.';
  end if;

  v_key := least(v_actor::text, p_other_user_id::text) || ':' ||
           greatest(v_actor::text, p_other_user_id::text);

  insert into public.conversations
    (kind, name, sector, created_by, direct_recipient_id, direct_key)
  values
    ('direct', 'Conversa individual', null, v_actor, p_other_user_id, v_key)
  on conflict (direct_key) where direct_key is not null do nothing
  returning id into v_conversation_id;

  if v_conversation_id is null then
    select c.id into v_conversation_id
    from public.conversations c
    where c.direct_key = v_key and c.kind = 'direct'
    limit 1;
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.start_direct_conversation(uuid) from public, anon;
grant execute on function public.start_direct_conversation(uuid) to authenticated;

drop policy if exists conversations_read_scoped on public.conversations;
drop policy if exists conversations_insert_scoped on public.conversations;
drop policy if exists conversations_update_scoped on public.conversations;
drop policy if exists conversations_delete_scoped on public.conversations;

create policy conversations_read_scoped on public.conversations for select to authenticated
  using (
    (kind = 'channel' and (private.is_active_admin() or private.can_access_sector(sector)))
    or (kind = 'direct' and (
      created_by = (select auth.uid()) or direct_recipient_id = (select auth.uid())
    ))
  );

create policy conversations_insert_scoped on public.conversations for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and kind = 'channel'
    and private.can_access_sector(sector)
  );

create policy conversations_update_scoped on public.conversations for update to authenticated
  using (
    (kind = 'channel' and (private.is_active_admin() or private.can_access_sector(sector)))
    or (kind = 'direct' and (
      created_by = (select auth.uid()) or direct_recipient_id = (select auth.uid())
    ))
  )
  with check (
    (kind = 'channel' and (private.is_active_admin() or private.can_access_sector(sector)))
    or (kind = 'direct' and (
      created_by = (select auth.uid()) or direct_recipient_id = (select auth.uid())
    ))
  );

create policy conversations_delete_scoped on public.conversations for delete to authenticated
  using (
    kind = 'channel' and (
      private.is_active_admin()
      or (created_by = (select auth.uid()) and private.can_access_sector(sector))
    )
  );

drop policy if exists messages_read_scoped on public.messages;
drop policy if exists messages_insert_scoped on public.messages;
drop policy if exists messages_update_scoped on public.messages;
drop policy if exists messages_delete_scoped on public.messages;

create policy messages_read_scoped on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (
        (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
        or (c.kind = 'direct' and (
          c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid())
        ))
      )
    )
  );

create policy messages_insert_scoped on public.messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
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

create policy messages_update_scoped on public.messages for update to authenticated
  using (
    author_id = (select auth.uid()) and deleted_at is null and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (
        (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
        or (c.kind = 'direct' and (
          c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid())
        ))
      )
    )
  )
  with check (
    author_id = (select auth.uid()) and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (
        (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
        or (c.kind = 'direct' and (
          c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid())
        ))
      )
    )
  );

create policy messages_delete_scoped on public.messages for delete to authenticated
  using (
    author_id = (select auth.uid()) and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (
        (c.kind = 'channel' and (private.is_active_admin() or private.can_access_sector(c.sector)))
        or (c.kind = 'direct' and (
          c.created_by = (select auth.uid()) or c.direct_recipient_id = (select auth.uid())
        ))
      )
    )
  );

-- The app only edits these two columns after a message is sent. This prevents
-- participants from changing the immutable identity/pair of a direct chat.
revoke update on public.conversations from authenticated;
grant update (updated_at, last_message) on public.conversations to authenticated;

commit;
