-- Execute once in Supabase SQL Editor. Department access is enforced by RLS,
-- not only by hiding channels in the browser. "Geral" is shared.
begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_active_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'admin'
  );
$$;

create or replace function private.can_access_sector(p_sector text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select auth.uid()) is not null and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and (
        p.role = 'admin'
        or lower(trim(coalesce(p_sector, ''))) in ('geral', 'general')
        or (p.role = 'fiscal' and lower(trim(coalesce(p_sector, ''))) in ('fiscal', 'dpto. fiscal', 'departamento fiscal'))
        or (p.role = 'contabil' and lower(trim(coalesce(p_sector, ''))) in ('contábil', 'contabil', 'dpto. contábil', 'dpto. contabil', 'departamento contábil', 'departamento contabil'))
        or (p.role = 'pessoal' and lower(trim(coalesce(p_sector, ''))) in ('pessoal', 'dpto. pessoal', 'departamento pessoal'))
      )
  ), false);
$$;

revoke all on function private.is_active_admin() from public, anon;
revoke all on function private.can_access_sector(text) from public, anon;
grant execute on function private.is_active_admin() to authenticated;
grant execute on function private.can_access_sector(text) to authenticated;

-- Remove every previous policy from these tables first. PostgreSQL combines
-- permissive policies with OR, so leaving an old broad policy would bypass these.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'notices', 'reminders', 'conversations', 'messages')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

create policy profiles_read_scoped on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_active_admin()
    or (active and private.can_access_sector(sector)));
create policy profiles_admin_insert on public.profiles for insert to authenticated
  with check (private.is_active_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (private.is_active_admin()) with check (private.is_active_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (private.is_active_admin());

create policy notices_read_scoped on public.notices for select to authenticated
  using (private.can_access_sector(sector));
create policy notices_insert_scoped on public.notices for insert to authenticated
  with check (author_id = (select auth.uid()) and private.can_access_sector(sector));
create policy notices_update_scoped on public.notices for update to authenticated
  using (private.is_active_admin() or (author_id = (select auth.uid()) and private.can_access_sector(sector)))
  with check (private.is_active_admin() or (author_id = (select auth.uid()) and private.can_access_sector(sector)));
create policy notices_delete_scoped on public.notices for delete to authenticated
  using (private.is_active_admin() or (author_id = (select auth.uid()) and private.can_access_sector(sector)));

create policy reminders_read_owner on public.reminders for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_active_admin());
create policy reminders_insert_owner on public.reminders for insert to authenticated
  with check (owner_id = (select auth.uid()) or private.is_active_admin());
create policy reminders_update_owner on public.reminders for update to authenticated
  using (owner_id = (select auth.uid()) or private.is_active_admin())
  with check (owner_id = (select auth.uid()) or private.is_active_admin());
create policy reminders_delete_owner on public.reminders for delete to authenticated
  using (owner_id = (select auth.uid()) or private.is_active_admin());

create policy conversations_read_scoped on public.conversations for select to authenticated
  using (private.is_active_admin() or (kind = 'channel' and private.can_access_sector(sector)));
create policy conversations_insert_scoped on public.conversations for insert to authenticated
  with check (created_by = (select auth.uid()) and kind = 'channel' and private.can_access_sector(sector));
create policy conversations_update_scoped on public.conversations for update to authenticated
  using (private.is_active_admin() or (kind = 'channel' and private.can_access_sector(sector)))
  with check (private.is_active_admin() or (kind = 'channel' and private.can_access_sector(sector)));
create policy conversations_delete_scoped on public.conversations for delete to authenticated
  using (private.is_active_admin() or (kind = 'channel' and created_by = (select auth.uid()) and private.can_access_sector(sector)));

create policy messages_read_scoped on public.messages for select to authenticated
  using (private.is_active_admin() or exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.kind = 'channel' and private.can_access_sector(c.sector)
  ));
create policy messages_insert_scoped on public.messages for insert to authenticated
  with check (author_id = (select auth.uid()) and (private.is_active_admin() or exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.kind = 'channel' and private.can_access_sector(c.sector)
  )));
create policy messages_update_scoped on public.messages for update to authenticated
  using (private.is_active_admin() or (author_id = (select auth.uid()) and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.kind = 'channel' and private.can_access_sector(c.sector)
  )))
  with check (private.is_active_admin() or (author_id = (select auth.uid()) and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.kind = 'channel' and private.can_access_sector(c.sector)
  )));
create policy messages_delete_scoped on public.messages for delete to authenticated
  using (private.is_active_admin() or (author_id = (select auth.uid()) and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.kind = 'channel' and private.can_access_sector(c.sector)
  )));

-- Active administrators can review and remove any message, including in
-- individual conversations. App deletion remains a soft delete via deleted_at.
create policy messages_admin_read_all on public.messages for select to authenticated
  using (private.is_active_admin());
create policy messages_admin_update_all on public.messages for update to authenticated
  using (private.is_active_admin())
  with check (private.is_active_admin());

grant select, insert, update, delete on public.profiles, public.notices, public.reminders,
  public.conversations, public.messages to authenticated;

-- The old bootstrap function allowed a caller to promote itself. It is not
-- needed by the current app and must not remain executable.
drop function if exists public.bootstrap_first_admin();
drop function if exists public.is_admin();

commit;
