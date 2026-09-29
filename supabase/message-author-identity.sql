begin;

alter table public.messages
  add column if not exists author_name text;

-- Copy the historical sender names once; new messages are filled by the trigger.
update public.messages m
set author_name = p.name
from public.profiles p
where p.id = m.author_id
  and m.author_name is null;

create or replace function private.set_message_author_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if (select auth.uid()) is null
     or new.author_id is distinct from (select auth.uid()) then
    raise exception using errcode = '42501', message = 'Message author must match the signed-in user';
  end if;

  select p.name into v_name
  from public.profiles p
  where p.id = new.author_id and p.active;

  if v_name is null then
    raise exception using errcode = '42501', message = 'Active sender profile not found';
  end if;

  new.author_name := v_name;
  return new;
end;
$$;

revoke all on function private.set_message_author_name() from public, anon;
grant execute on function private.set_message_author_name() to authenticated;

drop trigger if exists set_message_author_name on public.messages;
create trigger set_message_author_name
before insert on public.messages
for each row execute function private.set_message_author_name();

-- Messages are immutable in the current UI; this prevents sender identity from
-- being changed after the trusted trigger has stamped it.
drop policy if exists messages_update_scoped on public.messages;
revoke update on public.messages from anon, authenticated;

commit;
