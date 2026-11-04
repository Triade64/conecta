-- Reviewed module; apply only to staging until production approval.
begin;
create schema if not exists private;
create table public.workflow_templates (
 id uuid primary key default gen_random_uuid(), name text not null, version integer not null,
 definition jsonb not null, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), unique(name,version)
);
create table public.workflow_processes (
 id uuid primary key default gen_random_uuid(), template_id uuid not null references public.workflow_templates,
 name text not null, company text not null, period date not null, legal_due_at timestamptz,
 definition jsonb not null, context jsonb not null default '{}', sectors text[] not null,
 member_ids uuid[] not null default '{}', created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(), completed_at timestamptz,
 revision integer not null default 0, series_id uuid, unique(series_id,period)
);
create table public.workflow_steps (
 id uuid primary key default gen_random_uuid(), process_id uuid not null references public.workflow_processes,
 key text not null, definition jsonb not null, sector text not null,
 status text not null check(status in ('waiting','ready','active','blocked','correction','completed','skipped')),
 applicable boolean not null default true, assignee uuid references public.profiles,
 data jsonb not null default '{}', due_at timestamptz, available_at timestamptz,
 started_at timestamptz, completed_at timestamptz, unique(process_id,key)
);
create index workflow_steps_queue on public.workflow_steps(sector,status,due_at);
create table public.workflow_events (
 id bigint generated always as identity primary key, process_id uuid not null references public.workflow_processes,
 step_id uuid references public.workflow_steps, command_id uuid not null,
 actor_id uuid references public.profiles, actor_name text not null, action text not null,
 origin_sector text, destination_sectors text[] not null default '{}',
 payload jsonb not null default '{}', created_at timestamptz not null default now(), unique(process_id,command_id)
);
create index workflow_events_history on public.workflow_events(process_id,id);
-- Persistent, shared sector inbox/outbox. Browser notifications are optional delivery;
-- a closed browser never loses the server-side event. Each user acknowledges separately.
create table public.workflow_notifications (
 id bigint generated always as identity primary key, process_id uuid not null references public.workflow_processes,
 step_id uuid references public.workflow_steps, sector text not null, kind text not null,
 message text not null, dedupe_key text not null unique, created_at timestamptz not null default now()
);
create index workflow_notifications_sector on public.workflow_notifications(sector,id desc);
create table public.workflow_notification_reads (
 notification_id bigint references public.workflow_notifications, user_id uuid references public.profiles,
 read_at timestamptz not null default now(), primary key(notification_id,user_id)
);
create table public.workflow_documents (
 id uuid primary key default gen_random_uuid(), process_id uuid not null references public.workflow_processes,
 step_id uuid not null references public.workflow_steps, field_key text not null,
 name text not null, path text not null unique, size bigint not null check(size between 1 and 26214400),
 uploaded_by uuid not null references public.profiles, created_at timestamptz not null default now()
);
create table public.workflow_series (
 id uuid primary key default gen_random_uuid(), template_id uuid not null references public.workflow_templates,
 company text not null, context jsonb not null, member_ids uuid[] not null default '{}',
 interval_months integer not null check(interval_months between 1 and 12),
 next_period date not null, next_run date not null, legal_day integer check(legal_day between 1 and 31),
 active boolean not null default true, last_error text, last_attempt_at timestamptz, created_by uuid not null references public.profiles
);
create function private.workflow_sector() returns text language sql stable security definer set search_path='' as $$
 select case role::text when 'fiscal' then 'Fiscal' when 'contabil' then 'Contábil' when 'pessoal' then 'Departamento Pessoal' else sector end
 from public.profiles where id=auth.uid() and active
$$;
create function private.workflow_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role::text='admin')
$$;
create function private.workflow_access(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workflow_processes p where p.id=pid and
 (private.workflow_admin() or (private.workflow_sector()=any(p.sectors) and
 (cardinality(p.member_ids)=0 or auth.uid()=any(p.member_ids)))))
$$;
-- Only this private implementation can write workflow state. The exposed RPC is an
-- invoker wrapper. Permission checks and row locks are mandatory on every command.
create function private.workflow_validate(d jsonb) returns void language plpgsql set search_path='' as $$
declare s jsonb; f jsonb; seen text[]:='{}'; fields text[]; dep text;
begin
 if jsonb_typeof(d->'steps') is distinct from 'array' or jsonb_array_length(d->'steps') not between 1 and 50 then raise exception 'Configure de 1 a 50 etapas.'; end if;
 for s in select value from jsonb_array_elements(d->'steps') loop
  if coalesce(s->>'key','') !~ '^[a-z][a-z0-9_]{0,49}$' or s->>'key'=any(seen) or length(trim(coalesce(s->>'name',''))) not between 1 and 120
   or coalesce(s->>'sector','') not in ('Fiscal','Departamento Pessoal','Contábil','Atendimento','Geral') then raise exception 'Etapa ou setor inválido.'; end if;
  if jsonb_typeof(s->'dependencies') is distinct from 'array' or jsonb_typeof(s->'fields') is distinct from 'array' then raise exception 'Dependências e campos devem ser listas.'; end if;
  for dep in select jsonb_array_elements_text(s->'dependencies') loop
   if not dep=any(seen) then raise exception 'Dependências devem apontar para etapas anteriores; ciclos não são permitidos.'; end if;
  end loop;
  if coalesce((s->>'days')::integer,0) not between 0 and 365 or coalesce((s->>'legalOffset')::integer,0) not between 0 and 365 then raise exception 'Prazo inválido.'; end if;
  if s ? 'notifications' and jsonb_typeof(s->'notifications') is distinct from 'array' then raise exception 'Notificações devem ser uma lista.'; end if;
  if s ? 'condition' and s->'condition' <> 'null'::jsonb then
   if coalesce(s->'condition'->>'field','') !~ '^[a-z][a-z0-9_]{0,49}$' or not (s->'condition' ? 'equals') or jsonb_typeof(s->'condition'->'equals') not in ('string','number','boolean') then raise exception 'Condição inválida.'; end if;
  end if;
  if nullif(s->>'assignee','') is not null and not exists(select 1 from public.profiles p where p.id=(s->>'assignee')::uuid and p.active and
   (case p.role::text when 'fiscal' then 'Fiscal' when 'pessoal' then 'Departamento Pessoal' when 'contabil' then 'Contábil' else p.sector end)=s->>'sector') then raise exception 'Responsável deve pertencer ao setor.'; end if;
  fields:='{}';
  for f in select value from jsonb_array_elements(s->'fields') loop
   if coalesce(f->>'key','') !~ '^[a-z][a-z0-9_]{0,49}$' or f->>'key'=any(fields) or length(trim(coalesce(f->>'label',''))) not between 1 and 120
    or coalesce(f->>'type','') not in ('text','textarea','number','date','check','document') or jsonb_typeof(f->'required') is distinct from 'boolean' then raise exception 'Campo inválido.'; end if;
   fields:=array_append(fields,f->>'key');
  end loop;
  seen:=array_append(seen,s->>'key');
 end loop;
end $$;
create function private.workflow_notify(pid uuid,sid uuid,sec text,kind text,msg text,dedupe text) returns void language sql set search_path='' as $$
 insert into public.workflow_notifications(process_id,step_id,sector,kind,message,dedupe_key)
 select pid,sid,sec,kind,msg,dedupe where sid is null or not exists(select 1 from public.workflow_steps s where s.id=sid and s.definition ? 'notifications' and not (s.definition->'notifications' ? kind)) on conflict(dedupe_key) do nothing
$$;
create function private.workflow_reconcile(pid uuid) returns void language plpgsql set search_path='' as $$
declare s public.workflow_steps; p public.workflow_processes; changed boolean:=true; sec text;
begin
 select * into p from public.workflow_processes where id=pid;
 while changed loop
  changed:=false;
  for s in select * from public.workflow_steps where process_id=pid and status='waiting' order by key loop
   if not exists(select 1 from jsonb_array_elements_text(s.definition->'dependencies') dep
      left join public.workflow_steps parent on parent.process_id=pid and parent.key=dep.value
      where parent.status is null or parent.status not in ('completed','skipped')) then
    update public.workflow_steps set status=case when applicable then 'ready' else 'skipped' end,
     available_at=now(), completed_at=case when not applicable then now() end,
     due_at=least(now()+make_interval(days=>coalesce((definition->>'days')::int,1)),
       p.legal_due_at-make_interval(days=>coalesce((definition->>'legalOffset')::int,0))) where id=s.id;
    changed:=true;
    if s.applicable then perform private.workflow_notify(pid,s.id,s.sector,'received','Nova atividade: '||(s.definition->>'name'),
      s.id::text||':received:'||p.revision); end if;
   end if;
  end loop;
 end loop;
 if not exists(select 1 from public.workflow_steps where process_id=pid and status not in ('completed','skipped')) then
  update public.workflow_processes set completed_at=now() where id=pid and completed_at is null;
  if p.completed_at is null then foreach sec in array p.sectors loop
   perform private.workflow_notify(pid,null,sec,'completed','Processo concluído: '||p.name,pid::text||':completed:'||p.revision||':'||sec);
  end loop; end if;
 end if;
end $$;
create function private.workflow_create(tid uuid,company text,period date,legal_due timestamptz,ctx jsonb,members uuid[],creator uuid,series uuid default null)
 returns uuid language plpgsql set search_path='' as $$
declare t public.workflow_templates; pid uuid; s jsonb; sectors text[];
begin
 select * into strict t from public.workflow_templates where id=tid;
 if length(trim(company)) not between 1 and 160 or period is null or period<>date_trunc('month',period)::date or jsonb_typeof(ctx) is distinct from 'object' then raise exception 'Empresa, competência ou contexto inválido.'; end if;
 if exists(select 1 from unnest(members) m where not exists(select 1 from public.profiles where id=m and active)) then raise exception 'Participante inválido.'; end if;
 select array_agg(distinct value->>'sector') into sectors from jsonb_array_elements(t.definition->'steps');
 insert into public.workflow_processes(template_id,name,company,period,legal_due_at,definition,context,sectors,member_ids,created_by,series_id)
 values(tid,t.name,trim(company),period,legal_due,t.definition,ctx,sectors,members,creator,series) returning id into pid;
 for s in select value from jsonb_array_elements(t.definition->'steps') loop
  insert into public.workflow_steps(process_id,key,definition,sector,status,applicable,assignee)
  values(pid,s->>'key',s,s->>'sector','waiting',case when not(s ? 'condition') or s->'condition'='null'::jsonb then true else
    ctx->(s->'condition'->>'field')=s->'condition'->'equals' end is true,nullif(s->>'assignee','')::uuid);
 end loop;
 insert into public.workflow_events(process_id,command_id,actor_id,actor_name,action,destination_sectors,payload)
 values(pid,gen_random_uuid(),creator,coalesce((select name from public.profiles where id=creator),'Sistema'),'create',sectors,jsonb_build_object('template',tid,'context',ctx));
 perform private.workflow_reconcile(pid); return pid;
end $$;
create function private.workflow_command(op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles; p public.workflow_processes; s public.workflow_steps; target public.workflow_steps;
 t public.workflow_templates; f jsonb; val jsonb; dat jsonb; pid uuid; eid bigint; cid uuid; ver int; destinations text[]:='{}';
 descendants uuid[]; previous jsonb; def jsonb; vname text;
begin
 select * into actor from public.profiles where id=auth.uid() and active;
 if actor.id is null then raise exception using errcode='42501',message='Sessão ou usuário inativo.'; end if;
 if op='template' then
  if actor.role::text<>'admin' then raise exception using errcode='42501',message='Somente administradores configuram modelos.'; end if;
  def:=args->'definition'; perform private.workflow_validate(def); vname:=trim(args->>'name');
  if length(vname) not between 2 and 160 then raise exception 'Nome inválido.'; end if;
  perform pg_advisory_xact_lock(hashtext('workflow-template:'||vname));
  select coalesce(max(version),0)+1 into ver from public.workflow_templates where name=vname;
  if (args->>'expected_version')::int is distinct from ver-1 then raise exception using errcode='40001',message='O modelo mudou. Recarregue antes de salvar.'; end if;
  insert into public.workflow_templates(name,version,definition,created_by) values(vname,ver,def,actor.id) returning * into t;
  return to_jsonb(t);
 end if;
 if op='create' then
  select * into strict t from public.workflow_templates where id=(args->>'template_id')::uuid;
  if actor.role::text<>'admin' and not exists(select 1 from jsonb_array_elements(t.definition->'steps') v where v->>'sector'=private.workflow_sector()) then
   raise exception using errcode='42501',message='Seu setor não participa deste modelo.'; end if;
  -- Instance creation idempotency across retries, including disconnected clients.
  cid:=(args->>'command_id')::uuid; if cid is null then raise exception 'Identificador obrigatório.'; end if;
  perform pg_advisory_xact_lock(hashtext(cid::text));
  select process_id into pid from public.workflow_events where command_id=cid and actor_id=actor.id and action='create_request';
  if pid is not null then return jsonb_build_object('id',pid); end if;
  if actor.role::text<>'admin' and coalesce(jsonb_array_length(args->'member_ids'),0)>0 then raise exception 'Somente administrador restringe participantes.'; end if;
  pid:=private.workflow_create(t.id,args->>'company',(args->>'period')::date,nullif(args->>'legal_due_at','')::timestamptz,
   coalesce(args->'context','{}'),array(select jsonb_array_elements_text(coalesce(args->'member_ids','[]'))::uuid),actor.id);
  insert into public.workflow_events(process_id,command_id,actor_id,actor_name,action,payload)
   values(pid,cid,actor.id,actor.name,'create_request',args-'command_id');
  return jsonb_build_object('id',pid);
 end if;
 if op='series' then
  if actor.role::text<>'admin' then raise exception using errcode='42501',message='Somente administrador configura recorrência.'; end if;
  if args ? 'id' then
   update public.workflow_series set active=(args->>'active')::boolean where id=(args->>'id')::uuid returning id into pid;
  else
   if length(trim(coalesce(args->>'company',''))) not between 1 and 160 or nullif(args->>'next_run','') is null or jsonb_typeof(coalesce(args->'context','{}'))<>'object' then raise exception 'Configure empresa, início e contexto da recorrência.'; end if;
   insert into public.workflow_series(id,template_id,company,context,member_ids,interval_months,next_period,next_run,legal_day,created_by)
    values(coalesce((args->>'command_id')::uuid,gen_random_uuid()),(args->>'template_id')::uuid,args->>'company',coalesce(args->'context','{}'),'{}',(args->>'interval_months')::int,
    date_trunc('month',(args->>'period')::date)::date,(args->>'next_run')::date,nullif(args->>'legal_day','')::int,actor.id) on conflict(id) do update set id=excluded.id returning id into pid;
  end if;
  return jsonb_build_object('id',pid);
 end if;
 pid:=(args->>'process_id')::uuid;
 select * into p from public.workflow_processes where id=pid for update;
 if p.id is null or not private.workflow_access(pid) then raise exception using errcode='42501',message='Processo não autorizado.'; end if;
 if op='ack' then
  insert into public.workflow_notification_reads(notification_id,user_id)
   select id,actor.id from public.workflow_notifications where process_id=pid and
    (sector=private.workflow_sector() or actor.role::text='admin') and id=(args->>'notification_id')::bigint on conflict do nothing;
  return '{}'::jsonb;
 end if;
 cid:=(args->>'command_id')::uuid;
 if cid is null then raise exception 'Identificador obrigatório.'; end if;
 select * into previous from (select to_jsonb(e) x from public.workflow_events e where process_id=pid and command_id=cid and actor_id=actor.id) q;
 if previous is not null then return jsonb_build_object('id',pid,'duplicate',true,'revision',p.revision); end if;
 if (args->>'revision')::int is distinct from p.revision then raise exception using errcode='40001',message='Outro usuário alterou o processo. Recarregue antes de continuar.'; end if;
 select * into s from public.workflow_steps where id=(args->>'step_id')::uuid and process_id=pid;
 if s.id is null then raise exception 'Etapa não encontrada.'; end if;
 if actor.role::text<>'admin' and s.sector<>private.workflow_sector() then raise exception using errcode='42501',message='Ação restrita ao setor responsável.'; end if;
 if op not in ('claim','save','complete','return','request','block','unblock','reopen','document') then raise exception 'Ação inválida.'; end if;
 if op<>'reopen' and s.status not in ('ready','active','blocked','correction') then raise exception 'Etapa não liberada para execução.'; end if;
 if op not in ('claim','request','reopen') and actor.role::text<>'admin' and s.assignee is distinct from actor.id then raise exception 'Assuma a atividade antes de executar.'; end if;
 if op in ('return','request','block','reopen','unblock') and length(trim(coalesce(args->>'reason',''))) not between 3 and 4000 then raise exception 'Informe uma justificativa (mínimo de 3 caracteres).'; end if;
 if op='claim' then
  if s.assignee is not null and s.assignee<>actor.id and actor.role::text<>'admin' then raise exception 'Atividade já assumida por outro usuário.'; end if;
  update public.workflow_steps set assignee=actor.id,status=case when status='blocked' then status else 'active' end,started_at=coalesce(started_at,now()) where id=s.id;
 elsif op in ('save','complete') then
  dat:=coalesce(args->'data','{}'); if jsonb_typeof(dat)<>'object' then raise exception 'Formulário inválido.'; end if;
  if exists(select 1 from jsonb_object_keys(dat) k where not exists(select 1 from jsonb_array_elements(s.definition->'fields') fld where fld->>'key'=k)) then raise exception 'Campo desconhecido.'; end if;
  for f in select value from jsonb_array_elements(s.definition->'fields') loop
   val:=dat->(f->>'key');
   if f->>'type'='document' then
    if op='complete' and (f->>'required')::boolean and not exists(select 1 from public.workflow_documents where step_id=s.id and field_key=f->>'key') then raise exception 'Documento obrigatório: %',f->>'label'; end if;
   else
    if op='complete' and (f->>'required')::boolean and (val is null or val='null'::jsonb or val='""'::jsonb or (jsonb_typeof(val)='string' and length(trim(val#>>'{}'))=0) or (f->>'type'='check' and val<>'true'::jsonb)) then raise exception 'Campo obrigatório: %',f->>'label'; end if;
    if val is not null and val<>'null'::jsonb and val<>'""'::jsonb then
     if (f->>'type'='number' and jsonb_typeof(val)<>'number') or (f->>'type'='check' and jsonb_typeof(val)<>'boolean') or (f->>'type' in ('text','textarea','date') and jsonb_typeof(val)<>'string') then raise exception 'Tipo inválido: %',f->>'label'; end if;
     if f->>'type'='date' then perform (val#>>'{}')::date; end if;
    end if;
   end if;
  end loop;
  if op='complete' and s.status='blocked' then raise exception 'Resolva o impedimento antes de concluir.'; end if;
  update public.workflow_steps set data=dat,status=case when op='complete' then 'completed' else status end,
   completed_at=case when op='complete' then now() else completed_at end where id=s.id;
 elsif op in ('return','reopen') then
  if op='reopen' and actor.role::text<>'admin' then raise exception using errcode='42501',message='Somente administrador pode reabrir.'; end if;
  if op='return' then
   select * into target from public.workflow_steps where process_id=pid and key=args->>'target_key' and status='completed'
    and key in (select jsonb_array_elements_text(s.definition->'dependencies'));
   if target.id is null then raise exception 'Escolha uma etapa anterior concluída da qual esta depende.'; end if;
  else
   if s.status<>'completed' then raise exception 'Somente etapas concluídas podem ser reabertas.'; end if;
   target:=s; end if;
  with recursive children as (
   select target.id id,target.key key union
   select c.id,c.key from public.workflow_steps c join children d on c.definition->'dependencies' ? d.key where c.process_id=pid
  ) select array_agg(id) into descendants from children;
  -- Previous data and completion evidence survive in the immutable audit event.
  select jsonb_agg(to_jsonb(x)) into previous from public.workflow_steps x where id=any(descendants);
  update public.workflow_steps set status='waiting',completed_at=null,available_at=null,started_at=null,due_at=null where id=any(descendants);
  update public.workflow_steps set status='correction',available_at=now(),due_at=least(now()+make_interval(days=>coalesce((definition->>'days')::int,1)),p.legal_due_at-make_interval(days=>coalesce((definition->>'legalOffset')::int,0))) where id=target.id;
  update public.workflow_processes set completed_at=null where id=pid;
  destinations:=array[target.sector];
  perform private.workflow_notify(pid,target.id,target.sector,'correction','Devolvido para correção: '||(target.definition->>'name'),cid::text);
 elsif op='block' then
  update public.workflow_steps set status='blocked' where id=s.id;
  destinations:=p.sectors;
  for vname in select unnest(p.sectors) loop
   perform private.workflow_notify(pid,s.id,vname,'blocked','Processo bloqueado: '||(args->>'reason'),cid::text||':'||vname); end loop;
 elsif op='unblock' then
  if s.status<>'blocked' then raise exception 'A etapa não está impedida.'; end if;
  update public.workflow_steps set status='active' where id=s.id;
 elsif op='request' then
  if not (args->>'destination_sector')=any(p.sectors) then raise exception 'Setor não participa do processo.'; end if;
  destinations:=array[args->>'destination_sector'];
  perform private.workflow_notify(pid,s.id,args->>'destination_sector','information','Informação solicitada: '||(args->>'reason'),cid::text);
 elsif op='document' then
  if not exists(select 1 from jsonb_array_elements(s.definition->'fields') fld where fld->>'key'=args->>'field_key' and fld->>'type'='document') then raise exception 'Campo de documento inválido.'; end if;
  if (args->>'path') not like pid::text||'/'||s.id::text||'/'||actor.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='workflow-files' and name=args->>'path') then raise exception 'Arquivo não encontrado ou caminho inválido.'; end if;
  insert into public.workflow_documents(process_id,step_id,field_key,name,path,size,uploaded_by)
  values(pid,s.id,args->>'field_key',args->>'name',args->>'path',(args->>'size')::bigint,actor.id);
 end if;
 update public.workflow_processes set revision=revision+1 where id=pid;
 perform private.workflow_reconcile(pid);
 if op='complete' then select coalesce(array_agg(distinct sector),'{}') into destinations from public.workflow_steps
  where process_id=pid and definition->'dependencies' ? s.key; end if;
 insert into public.workflow_events(process_id,step_id,command_id,actor_id,actor_name,action,origin_sector,destination_sectors,payload)
 values(pid,s.id,cid,actor.id,actor.name,op,s.sector,destinations,jsonb_build_object('request',args-'command_id','before',to_jsonb(s),'invalidated',previous)) returning id into eid;
 return jsonb_build_object('id',pid,'revision',p.revision+1,'event_id',eid);
end $$;
create function public.workflow_command(op text,args jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select private.workflow_command(op,args)
$$;
-- Called by a trusted scheduler only; not callable by a browser user.
create function private.workflow_tick(at_time timestamptz default now()) returns void language plpgsql security definer set search_path='' as $$
declare r public.workflow_series; s record; legal timestamptz; pid uuid; i int;
begin
 for r in select * from public.workflow_series where active and next_run<= (at_time at time zone 'America/Sao_Paulo')::date for update skip locked loop
  begin
  i:=0;
  while r.next_run <= (at_time at time zone 'America/Sao_Paulo')::date and i<12 loop
   legal:=case when r.legal_day is not null then
    (r.next_period + (least(r.legal_day,extract(day from (r.next_period+interval '1 month - 1 day')))::int-1))::timestamp at time zone 'America/Sao_Paulo' end;
   if not exists(select 1 from public.workflow_processes where series_id=r.id and period=r.next_period) then
    pid:=private.workflow_create(r.template_id,r.company,r.next_period,legal,r.context,r.member_ids,r.created_by,r.id);
   end if;
   r.next_period:=(r.next_period+make_interval(months=>r.interval_months))::date;
   r.next_run:=(r.next_run+make_interval(months=>r.interval_months))::date; i:=i+1;
  end loop;
  update public.workflow_series set next_period=r.next_period,next_run=r.next_run,last_error=null,last_attempt_at=at_time where id=r.id;
  exception when others then
   update public.workflow_series set last_error=sqlerrm,last_attempt_at=at_time where id=r.id;
  end;
 end loop;
 for s in select st.*,pr.revision from public.workflow_steps st join public.workflow_processes pr on pr.id=st.process_id
  where st.status in ('ready','active','correction','blocked') and st.due_at<=at_time+interval '1 day' loop
  perform private.workflow_notify(s.process_id,s.id,s.sector,case when s.due_at<at_time then 'overdue' else 'due' end,
   case when s.due_at<at_time then 'Etapa atrasada: ' else 'Prazo próximo: ' end||(s.definition->>'name'),
   s.id::text||':'||s.due_at::text||':'||case when s.due_at<at_time then 'overdue' else 'due' end);
 end loop;
end $$;
-- Read-only state. Direct DML is revoked even when a client attempts to bypass RPCs.
alter table public.workflow_templates enable row level security;
alter table public.workflow_processes enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.workflow_events enable row level security;
alter table public.workflow_notifications enable row level security;
alter table public.workflow_notification_reads enable row level security;
alter table public.workflow_documents enable row level security;
alter table public.workflow_series enable row level security;
revoke all on public.workflow_templates,public.workflow_processes,public.workflow_steps,public.workflow_events,public.workflow_notifications,public.workflow_notification_reads,public.workflow_documents,public.workflow_series from public,anon,authenticated;
grant select on public.workflow_templates,public.workflow_processes,public.workflow_steps,public.workflow_events,public.workflow_notifications,public.workflow_notification_reads,public.workflow_documents,public.workflow_series to authenticated;
create policy workflow_template_read on public.workflow_templates for select to authenticated using (
 private.workflow_admin() or exists(select 1 from jsonb_array_elements(definition->'steps') s where s->>'sector'=private.workflow_sector()));
create policy workflow_process_read on public.workflow_processes for select to authenticated using (private.workflow_access(id));
create policy workflow_step_read on public.workflow_steps for select to authenticated using (private.workflow_access(process_id));
create policy workflow_event_read on public.workflow_events for select to authenticated using (private.workflow_access(process_id));
create policy workflow_document_read on public.workflow_documents for select to authenticated using (private.workflow_access(process_id));
create policy workflow_notification_read on public.workflow_notifications for select to authenticated using (
 private.workflow_access(process_id) and (sector=private.workflow_sector() or private.workflow_admin()));
create policy workflow_ack_read on public.workflow_notification_reads for select to authenticated using (user_id=auth.uid());
create policy workflow_series_read on public.workflow_series for select to authenticated using (private.workflow_admin());
-- All privileged functions are private with a fixed search_path, authenticated checks
-- and least-privilege grants. Helpers do not expose data or arbitrary SQL execution.
revoke all on function private.workflow_sector(),private.workflow_admin(),private.workflow_access(uuid),private.workflow_validate(jsonb),
 private.workflow_notify(uuid,uuid,text,text,text,text),private.workflow_reconcile(uuid),
 private.workflow_create(uuid,text,date,timestamptz,jsonb,uuid[],uuid,uuid),private.workflow_command(text,jsonb),private.workflow_tick(timestamptz),public.workflow_command(text,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.workflow_sector(),private.workflow_admin(),private.workflow_access(uuid),private.workflow_command(text,jsonb),public.workflow_command(text,jsonb) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values('workflow-files','workflow-files',false,26214400) on conflict(id) do nothing;
create function private.workflow_file_allowed(path text,write_file boolean) returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[]:=string_to_array(path,'/'); s public.workflow_steps;
begin
 if array_length(parts,1)<>4 or parts[1] !~ '^[0-9a-f-]{36}$' or parts[2] !~ '^[0-9a-f-]{36}$' then return false; end if;
 if not private.workflow_access(parts[1]::uuid) then return false; end if;
 if not write_file then return exists(select 1 from public.workflow_documents d where d.path=workflow_file_allowed.path); end if;
 select * into s from public.workflow_steps where process_id=parts[1]::uuid and id=parts[2]::uuid;
 return parts[3]=auth.uid()::text and s.status in ('ready','active','correction','blocked') and
 (private.workflow_admin() or (s.sector=private.workflow_sector() and s.assignee=auth.uid()));
exception when invalid_text_representation then return false;
end $$;
revoke all on function private.workflow_file_allowed(text,boolean) from public,anon,authenticated;
grant execute on function private.workflow_file_allowed(text,boolean) to authenticated;
create policy workflow_file_read on storage.objects for select to authenticated using(bucket_id='workflow-files' and private.workflow_file_allowed(name,false));
create policy workflow_file_upload on storage.objects for insert to authenticated with check(bucket_id='workflow-files' and private.workflow_file_allowed(name,true));
-- Files registered in the audit trail are immutable. Only abandoned uploads can be removed.
create policy workflow_file_cleanup on storage.objects for delete to authenticated using(bucket_id='workflow-files'
 and private.workflow_file_allowed(name,true) and not exists(select 1 from public.workflow_documents d where d.path=name));
create view public.workflow_template_catalog with (security_invoker=true) as
 select distinct on(name) id,name,version,definition,created_at from public.workflow_templates order by name,version desc;
revoke all on public.workflow_template_catalog from public,anon,authenticated;
grant select on public.workflow_template_catalog to authenticated;
-- Aggregates obey the caller's RLS, including restricted process participants.
create function public.workflow_overview() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'bySector',(select coalesce(jsonb_object_agg(sector,n),'{}') from (select sector,count(distinct process_id) n from public.workflow_steps where status in ('ready','active','blocked','correction') group by sector) x),
 'corrections',(select count(distinct process_id) from public.workflow_steps where status='correction'),
 'overdue',(select count(*) from public.workflow_steps where status in ('ready','active','blocked','correction') and due_at<now()),
 'completed',(select count(*) from public.workflow_processes where completed_at is not null),
 'timely',(select count(*) from public.workflow_processes p where p.completed_at is not null and (p.legal_due_at is null or p.completed_at<=p.legal_due_at) and not exists(select 1 from public.workflow_steps s where s.process_id=p.id and s.completed_at>s.due_at and s.status='completed')),
 'transferHours',(select avg(greatest(0,extract(epoch from (s.started_at-s.available_at)))/3600) from public.workflow_steps s where s.started_at is not null and s.available_at is not null and exists(select 1 from public.workflow_steps prev where prev.process_id=s.process_id and s.definition->'dependencies' ? prev.key and prev.sector<>s.sector)))
$$;
revoke all on function public.workflow_overview() from public,anon,authenticated;
grant execute on function public.workflow_overview() to authenticated;
-- Publication is additive; production application is a separate approved action.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.workflow_processes,public.workflow_notifications;
 end if;
end $$;
commit;
