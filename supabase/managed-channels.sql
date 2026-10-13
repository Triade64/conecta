begin;
alter table public.conversations
  add column managed_channel boolean not null default false,
  add column member_ids uuid[] not null default '{}';
alter table public.conversations add constraint managed_channel_shape check (
  not managed_channel or (kind = 'channel' and sector = 'Geral' and created_by is not null
    and created_by = any(member_ids) and cardinality(member_ids) between 1 and 200
    and char_length(trim(name)) between 2 and 80)
);
grant update (name,member_ids) on public.conversations to authenticated;
create unique index managed_channels_unique_name on public.conversations(lower(trim(name))) where managed_channel;

-- The existing sector/direct policies still apply. Restrictive policies prevent
-- those permissive policies (including moderation) from bypassing membership.
create policy managed_channels_select on public.conversations as restrictive for select to authenticated
  using (not managed_channel or (select auth.uid()) = any(member_ids));
create policy managed_channels_insert on public.conversations as restrictive for insert to authenticated
  with check (not managed_channel or private.is_active_admin());
create policy managed_channels_update on public.conversations as restrictive for update to authenticated
  using (not managed_channel or (select auth.uid()) = any(member_ids))
  with check (not managed_channel or (select auth.uid()) = any(member_ids));
create policy managed_channels_delete on public.conversations as restrictive for delete to authenticated
  using (not managed_channel or private.is_active_admin());

create function private.validate_managed_channel() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if (new.name is distinct from old.name or new.member_ids is distinct from old.member_ids) and not private.is_active_admin() then
      raise exception using errcode='42501', message='Somente administradores podem alterar o nome e os membros.';
    end if;
    if new.managed_channel is distinct from old.managed_channel then
      raise exception 'O tipo de canal não pode ser alterado.';
    end if;
    if new.managed_channel and (new.kind is distinct from old.kind or new.sector is distinct from old.sector
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
       or new.id is distinct from old.id or new.direct_key is distinct from old.direct_key
       or new.direct_recipient_id is distinct from old.direct_recipient_id) then
      raise exception 'A identidade do canal não pode ser alterada.';
    end if;
  end if;
  if new.managed_channel and (TG_OP = 'INSERT' or new.name is distinct from old.name or new.member_ids is distinct from old.member_ids) then
    if not private.is_active_admin() then raise exception using errcode='42501', message='Somente administradores ativos podem gerenciar os canais.'; end if;
    new.name := trim(new.name);
    new.member_ids := array(select distinct id from unnest(new.member_ids) id order by id);
    if exists (select 1 from unnest(new.member_ids) as member(user_id) where member.user_id is null or not exists
      (select 1 from public.profiles p where p.id = member.user_id and p.active)) then
      raise exception 'Selecione somente colaboradores ativos.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_managed_channel() from public,anon,authenticated;
create trigger validate_managed_channel before insert or update on public.conversations
  for each row execute function private.validate_managed_channel();

-- A private boolean helper checks only the extra membership restriction. It
-- preserves existing moderation of legacy direct chats without granting access.
create function private.managed_channel_allowed(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and not exists (
    select 1 from public.conversations c where c.id = p_conversation_id
      and c.managed_channel and not ((select auth.uid()) = any(c.member_ids))
  );
$$;
revoke all on function private.managed_channel_allowed(uuid) from public,anon;
grant execute on function private.managed_channel_allowed(uuid) to authenticated;
create policy managed_channel_messages on public.messages as restrictive for all to authenticated
  using (private.managed_channel_allowed(conversation_id))
  with check (private.managed_channel_allowed(conversation_id));
create policy managed_channel_reads on public.conversation_reads as restrictive for all to authenticated
  using (private.managed_channel_allowed(conversation_id))
  with check (private.managed_channel_allowed(conversation_id));
create policy managed_channel_files on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'chat-files' or exists (select 1 from public.conversations c
    where c.id::text = (storage.foldername(storage.objects.name))[2] and
      (not c.managed_channel or (select auth.uid()) = any(c.member_ids))))
  with check (bucket_id <> 'chat-files' or exists (select 1 from public.conversations c
    where c.id::text = (storage.foldername(storage.objects.name))[2] and
      (not c.managed_channel or (select auth.uid()) = any(c.member_ids))));
commit;
