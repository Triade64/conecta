-- Verificação de integração do fluxo de tarefas. Tudo é desfeito no rollback final,
-- inclusive os setores temporários dados aos perfis de teste.
-- Requer: um administrador ativo e quatro outros perfis ativos.
-- Uso: execute no SQL Editor do Supabase (ou psql). Sucesso = termina sem erro.
begin;
create temporary table task_fx as
select (select id from public.profiles where active and role='admin' order by id limit 1) as admin_id,
       (select id from public.profiles where active and role<>'admin' order by id limit 1) as atend_id,
       (select id from public.profiles where active and role<>'admin' order by id offset 1 limit 1) as fiscal_id,
       (select id from public.profiles where active and role<>'admin' order by id offset 2 limit 1) as contab_id,
       (select id from public.profiles where active and role<>'admin' order by id offset 3 limit 1) as outsider_id,
       gen_random_uuid() as template_id, gen_random_uuid() as client_id;
grant select on task_fx to authenticated;
do $$ begin
  if exists (select 1 from task_fx where admin_id is null or atend_id is null or fiscal_id is null or contab_id is null or outsider_id is null) then
    raise exception 'Preciso de um administrador e quatro outros perfis ativos';
  end if;
end $$;
update public.profiles set sector='Atendimento' where id=(select atend_id from task_fx);
update public.profiles set sector='Fiscal' where id=(select fiscal_id from task_fx);
update public.profiles set sector='Contábil' where id=(select contab_id from task_fx);
update public.profiles set sector='Setor Externo Teste' where id=(select outsider_id from task_fx);

set local role authenticated;

-- Administrador cadastra o modelo; colaborador comum não consegue.
select set_config('request.jwt.claim.sub',(select admin_id::text from task_fx),true);
insert into public.task_templates(id,name,steps)
select template_id,'Teste '||template_id,
  '[{"sector":"Atendimento"},{"sector":"Fiscal"},{"sector":"Contábil","label":"Fechamento"}]'::jsonb from task_fx;

select set_config('request.jwt.claim.sub',(select atend_id::text from task_fx),true);
do $$
begin
  begin
    insert into public.task_templates(name,steps) values ('Modelo proibido','[{"sector":"Fiscal"}]'::jsonb);
    raise exception 'FAIL: colaborador criou modelo';
  exception when insufficient_privilege or others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
insert into public.task_clients(id,name) select client_id,'Cliente teste '||client_id from task_fx;

do $$
declare t uuid; v integer;
begin
  t := public.task_create((select client_id from task_fx),(select template_id from task_fx),'Tarefa de teste','','alta',null);
  perform set_config('task_fx.id', t::text, true);
  begin update public.tasks set status='done' where id=t; raise exception 'FAIL: update direto em tasks';
  exception when insufficient_privilege then null; end;
  begin insert into public.task_events(task_id,kind,actor_id) values (t,'comment',(select auth.uid())); raise exception 'FAIL: insert direto em task_events';
  exception when insufficient_privilege then null; end;
  select version into v from public.tasks where id=t;
  begin perform public.task_return(t,v,'motivo qualquer'); raise exception 'FAIL: devolveu na primeira etapa';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_first_step' then raise; end if; end;
  begin perform public.task_advance(t,v+5,''); raise exception 'FAIL: aceitou versão antiga';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_version_conflict' then raise; end if; end;
  perform public.task_advance(t,v,'Documentos recebidos');
  -- Depois de repassada, o Atendimento não é mais o setor da vez.
  select version into v from public.tasks where id=t;
  begin perform public.task_advance(t,v,''); raise exception 'FAIL: setor errado repassou';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_wrong_sector' then raise; end if; end;
end $$;

-- Quem não participa do fluxo não vê nem movimenta a tarefa.
select set_config('request.jwt.claim.sub',(select outsider_id::text from task_fx),true);
do $$
declare t uuid := current_setting('task_fx.id')::uuid; v integer;
begin
  if (select count(*) from public.tasks where id=t)<>0 then raise exception 'FAIL: estranho vê a tarefa'; end if;
  if (select count(*) from public.task_events where task_id=t)<>0 then raise exception 'FAIL: estranho lê o histórico'; end if;
  begin perform public.task_comment(t,'oi'); raise exception 'FAIL: estranho comentou';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_not_found' then raise; end if; end;
  begin perform public.task_advance(t,2,''); raise exception 'FAIL: estranho repassou';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_not_found' then raise; end if; end;
end $$;

-- Fiscal vê o histórico, devolve com motivo e repassa de novo; Contábil conclui.
select set_config('request.jwt.claim.sub',(select fiscal_id::text from task_fx),true);
do $$
declare t uuid := current_setting('task_fx.id')::uuid; v integer;
begin
  if (select count(*) from public.tasks where id=t)<>1 then raise exception 'FAIL: Fiscal não vê a tarefa'; end if;
  if (select count(*) from public.task_events where task_id=t)<>2 then raise exception 'FAIL: histórico incompleto para o Fiscal'; end if;
  select version into v from public.tasks where id=t;
  begin perform public.task_return(t,v,''); raise exception 'FAIL: devolveu sem motivo';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_note_required' then raise; end if; end;
  perform public.task_return(t,v,'Faltou o contrato social');
  if (select current_step from public.tasks where id=t)<>0 then raise exception 'FAIL: devolução não voltou a etapa'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select atend_id::text from task_fx),true);
do $$
declare t uuid := current_setting('task_fx.id')::uuid; v integer;
begin
  select version into v from public.tasks where id=t; perform public.task_advance(t,v,'Contrato anexado');
end $$;
select set_config('request.jwt.claim.sub',(select fiscal_id::text from task_fx),true);
do $$
declare t uuid := current_setting('task_fx.id')::uuid; v integer;
begin
  select version into v from public.tasks where id=t; perform public.task_advance(t,v,'');
end $$;
select set_config('request.jwt.claim.sub',(select contab_id::text from task_fx),true);
do $$
declare t uuid := current_setting('task_fx.id')::uuid; v integer;
begin
  select version into v from public.tasks where id=t; perform public.task_advance(t,v,'Fechado');
  if (select status from public.tasks where id=t)<>'done' or (select completed_at from public.tasks where id=t) is null then
    raise exception 'FAIL: última etapa não concluiu a tarefa';
  end if;
  select version into v from public.tasks where id=t;
  begin perform public.task_advance(t,v,''); raise exception 'FAIL: movimentou tarefa concluída';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_closed' then raise; end if; end;
end $$;

-- Cancelamento: só criador ou administrador, e com motivo.
select set_config('request.jwt.claim.sub',(select atend_id::text from task_fx),true);
do $$
declare t uuid; v integer;
begin
  t := public.task_create((select client_id from task_fx),(select template_id from task_fx),'Outra tarefa','','normal',current_date);
  perform set_config('task_fx.id2', t::text, true);
end $$;
select set_config('request.jwt.claim.sub',(select fiscal_id::text from task_fx),true);
do $$
declare t uuid := current_setting('task_fx.id2')::uuid; v integer;
begin
  select version into v from public.tasks where id=t;
  begin perform public.task_cancel(t,v,'quero cancelar'); raise exception 'FAIL: não criador cancelou';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_forbidden' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub',(select atend_id::text from task_fx),true);
do $$
declare t uuid := current_setting('task_fx.id2')::uuid; v integer;
begin
  select version into v from public.tasks where id=t;
  begin perform public.task_cancel(t,v,''); raise exception 'FAIL: cancelou sem motivo';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_note_required' then raise; end if; end;
  perform public.task_cancel(t,v,'Cliente desistiu');
  if (select status from public.tasks where id=t)<>'cancelled' then raise exception 'FAIL: não cancelou'; end if;
end $$;

select 'tasks.rls: todas as verificações passaram' as result;
rollback;
