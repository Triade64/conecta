-- Integration verification only: all fixture writes roll back, including messages.
begin;
create temporary table channel_test_fixture as
select (select id from public.profiles where active and role='admin' limit 1) as admin_id,
       (select id from public.profiles where active and role<>'admin' order by id limit 1) as member_id,
       (select id from public.profiles where active and role<>'admin' order by id offset 1 limit 1) as outsider_id,
       gen_random_uuid() as channel_id, gen_random_uuid() as message_id;
grant select on channel_test_fixture to authenticated;
create temporary table channel_test_results (check_name text);
grant insert,select on channel_test_results to authenticated;
do $$ begin
  if exists(select 1 from channel_test_fixture where admin_id is null or member_id is null or outsider_id is null) then raise exception 'Need one admin and two other active profiles for rollback test'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from channel_test_fixture),true);
insert into public.conversations(id,name,kind,sector,created_by,managed_channel,member_ids)
select channel_id,'Teste canal '||channel_id,'channel','Geral',admin_id,true,array[admin_id,member_id] from channel_test_fixture;
insert into public.messages(id,conversation_id,author_id,text,attachment_path,attachment_name,attachment_mime,attachment_size)
select message_id,channel_id,admin_id,'Rollback fixture','file:'||admin_id::text||'/'||channel_id::text||'/fixture.txt','fixture.txt','text/plain',4 from channel_test_fixture;
insert into storage.objects(bucket_id,name)
select 'chat-files',admin_id::text||'/'||channel_id::text||'/fixture.txt' from channel_test_fixture;
insert into channel_test_results values ('admin creates channel with members');
select set_config('request.jwt.claim.sub',(select member_id::text from channel_test_fixture),true);
do $$ begin
  if (select count(*) from public.conversations where id=(select channel_id from channel_test_fixture))<>1 then raise exception 'Member cannot see channel'; end if;
  if (select count(*) from public.messages where id=(select message_id from channel_test_fixture))<>1 then raise exception 'Member cannot read message'; end if;
  if (select count(*) from storage.objects where bucket_id='chat-files' and name like '%/'||(select channel_id::text from channel_test_fixture)||'/%')<>1 then raise exception 'Member cannot read attachment'; end if;
  begin
    update public.conversations set member_ids=member_ids||(select outsider_id from channel_test_fixture) where id=(select channel_id from channel_test_fixture);
    raise exception 'FAIL: member changed membership';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.conversations(name,kind,sector,created_by,managed_channel,member_ids)
    select 'Forbidden creation','channel','Geral',member_id,true,array[member_id] from channel_test_fixture;
    raise exception 'FAIL: member created channel';
  exception when insufficient_privilege then null; end;
  begin
    update public.conversations set managed_channel=false where id=(select channel_id from channel_test_fixture);
    raise exception 'FAIL: member disabled membership';
  exception when insufficient_privilege then null;
  when raise_exception then
    if SQLERRM like 'FAIL:%' then raise; end if;
  end;
end $$;
insert into public.messages(conversation_id,author_id,text) select channel_id,member_id,'Member rollback reply' from channel_test_fixture;
update public.conversations set last_message='Member rollback reply',updated_at=now() where id=(select channel_id from channel_test_fixture);
insert into channel_test_results values ('member can read/send/access files but cannot create/manage/bypass');
select set_config('request.jwt.claim.sub',(select outsider_id::text from channel_test_fixture),true);
do $$ begin
  if exists(select 1 from public.conversations where id=(select channel_id from channel_test_fixture)) then raise exception 'Outsider can see channel'; end if;
  if exists(select 1 from public.messages where id=(select message_id from channel_test_fixture)) then raise exception 'Outsider can read messages'; end if;
  if exists(select 1 from storage.objects where bucket_id='chat-files' and name like '%/'||(select channel_id::text from channel_test_fixture)||'/%') then raise exception 'Outsider can read file'; end if;
  if exists(select 1 from public.get_unread_counts() where conversation_id=(select channel_id from channel_test_fixture)) then raise exception 'Outsider sees unread count'; end if;
  begin
    insert into public.messages(conversation_id,author_id,text) select channel_id,outsider_id,'Forbidden' from channel_test_fixture;
    raise exception 'FAIL: outsider sent message';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name) select 'chat-files',outsider_id::text||'/'||channel_id::text||'/forbidden.txt' from channel_test_fixture;
    raise exception 'FAIL: outsider uploaded attachment';
  exception when insufficient_privilege then null; end;
end $$;
insert into channel_test_results values ('outsider cannot see messages, files, counts or send/upload');
select set_config('request.jwt.claim.sub',(select admin_id::text from channel_test_fixture),true);
update public.conversations set member_ids=member_ids||(select outsider_id from channel_test_fixture) where id=(select channel_id from channel_test_fixture);
select set_config('request.jwt.claim.sub',(select outsider_id::text from channel_test_fixture),true);
do $$ begin
  if not exists(select 1 from public.messages where id=(select message_id from channel_test_fixture)) then raise exception 'Added member cannot read'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select admin_id::text from channel_test_fixture),true);
update public.conversations set member_ids=array_remove(member_ids,(select outsider_id from channel_test_fixture)) where id=(select channel_id from channel_test_fixture);
select set_config('request.jwt.claim.sub',(select outsider_id::text from channel_test_fixture),true);
do $$ begin
  if exists(select 1 from public.messages where id=(select message_id from channel_test_fixture)) then raise exception 'Removed member can read'; end if;
end $$;
insert into channel_test_results values ('membership addition grants and removal revokes access');
reset role;
-- Promoting a nonmember inside this rollback transaction must not bypass RLS.
update public.profiles set role='admin' where id=(select outsider_id from channel_test_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select outsider_id::text from channel_test_fixture),true);
do $$ begin
  if exists(select 1 from public.messages where id=(select message_id from channel_test_fixture)) then raise exception 'Nonmember admin can read managed messages'; end if;
  if exists(select 1 from public.conversations where id=(select channel_id from channel_test_fixture)) then raise exception 'Nonmember admin can see managed channel'; end if;
end $$;
insert into channel_test_results values ('admin role does not bypass managed-channel membership');
reset role;
select jsonb_agg(check_name) as passed from channel_test_results;
rollback;
