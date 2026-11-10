-- Verificação de integração do fluxo de tarefas. Tudo é desfeito no rollback final,
-- inclusive os setores temporários dados aos perfis de teste.
-- Requer: um administrador ativo e quatro outros perfis ativos.
-- Uso: execute no SQL Editor do Supabase (ou psql). Sucesso = termina sem erro.
-- Os IDs ficam em variáveis de sessão (tfx.*), visíveis após a troca de papel.
begin;
select set_config('tfx.admin_id',(select id::text from public.profiles where active and role='admin' order by id limit 1),true),
       set_config('tfx.atend_id',(select id::text from public.profiles where active and role<>'admin' order by id limit 1),true),
       set_config('tfx.fiscal_id',(select id::text from public.profiles where active and role<>'admin' order by id offset 1 limit 1),true),
       set_config('tfx.contab_id',(select id::text from public.profiles where active and role<>'admin' order by id offset 2 limit 1),true),
       set_config('tfx.outsider_id',(select id::text from public.profiles where active and role<>'admin' order by id offset 3 limit 1),true),
       set_config('tfx.template_id',gen_random_uuid()::text,true),
       set_config('tfx.client_id',gen_random_uuid()::text,true);
do $$ begin
  if coalesce(current_setting('tfx.admin_id',true),'')='' or coalesce(current_setting('tfx.outsider_id',true),'')='' then
    raise exception 'Preciso de um administrador e quatro outros perfis ativos';
  end if;
end $$;
update public.profiles set sector='Atendimento' where id=current_setting('tfx.atend_id')::uuid;
update public.profiles set sector='Fiscal' where id=current_setting('tfx.fiscal_id')::uuid;
update public.profiles set sector='Contábil' where id=current_setting('tfx.contab_id')::uuid;
update public.profiles set sector='Setor Externo Teste' where id=current_setting('tfx.outsider_id')::uuid;

-- Fixtures criadas como dono (a coluna id não é gravável pelo papel authenticated).
insert into public.task_templates(id,name,steps)
values (current_setting('tfx.template_id')::uuid,'Teste '||current_setting('tfx.template_id'),
  '[{"sector":"Atendimento"},{"sector":"Fiscal"},{"sector":"Contábil","label":"Fechamento"}]'::jsonb);
insert into public.task_clients(id,name,created_by)
values (current_setting('tfx.client_id')::uuid,'Cliente teste '||current_setting('tfx.client_id'),current_setting('tfx.atend_id')::uuid);

set local role authenticated;

-- Qualquer colaborador cria modelo; outro colaborador não edita o modelo alheio.
select set_config('request.jwt.claim.sub',current_setting('tfx.atend_id'),true);
insert into public.task_templates(name,steps) values ('Modelo do colaborador '||current_setting('tfx.template_id'),'[{"sector":"Fiscal"}]'::jsonb);
select set_config('request.jwt.claim.sub',current_setting('tfx.fiscal_id'),true);
update public.task_templates set name='Alterado por outro' where name='Modelo do colaborador '||current_setting('tfx.template_id');
select set_config('request.jwt.claim.sub',current_setting('tfx.atend_id'),true);
do $$ begin
  if not exists (select 1 from public.task_templates where name='Modelo do colaborador '||current_setting('tfx.template_id')) then
    raise exception 'FAIL: outro colaborador alterou modelo alheio';
  end if;
end $$;
update public.task_templates set active=false where name='Modelo do colaborador '||current_setting('tfx.template_id');
do $$ begin
  if (select active from public.task_templates where name='Modelo do colaborador '||current_setting('tfx.template_id')) then
    raise exception 'FAIL: criador não editou o próprio modelo';
  end if;
end $$;
-- Colaborador comum cadastra cliente (somente nome e documento).
insert into public.task_clients(name) values ('Cliente criado pelo colaborador');

do $$
declare t uuid; v integer;
begin
  t := public.task_create(current_setting('tfx.client_id')::uuid,current_setting('tfx.template_id')::uuid,'Tarefa de teste','','alta',null);
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
select set_config('request.jwt.claim.sub',current_setting('tfx.outsider_id'),true);
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
select set_config('request.jwt.claim.sub',current_setting('tfx.fiscal_id'),true);
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
select set_config('request.jwt.claim.sub',current_setting('tfx.atend_id'),true);
do $$
declare t uuid := current_setting('task_fx.id')::uuid; v integer;
begin
  select version into v from public.tasks where id=t; perform public.task_advance(t,v,'Contrato anexado');
end $$;
select set_config('request.jwt.claim.sub',current_setting('tfx.fiscal_id'),true);
do $$
declare t uuid := current_setting('task_fx.id')::uuid; v integer;
begin
  select version into v from public.tasks where id=t; perform public.task_advance(t,v,'');
end $$;
select set_config('request.jwt.claim.sub',current_setting('tfx.contab_id'),true);
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
select set_config('request.jwt.claim.sub',current_setting('tfx.atend_id'),true);
do $$
declare t uuid; v integer;
begin
  t := public.task_create(current_setting('tfx.client_id')::uuid,current_setting('tfx.template_id')::uuid,'Outra tarefa','','normal',current_date);
  perform set_config('task_fx.id2', t::text, true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('tfx.fiscal_id'),true);
do $$
declare t uuid := current_setting('task_fx.id2')::uuid; v integer;
begin
  select version into v from public.tasks where id=t;
  begin perform public.task_cancel(t,v,'quero cancelar'); raise exception 'FAIL: não criador cancelou';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_forbidden' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('tfx.atend_id'),true);
do $$
declare t uuid := current_setting('task_fx.id2')::uuid; v integer;
begin
  select version into v from public.tasks where id=t;
  begin perform public.task_cancel(t,v,''); raise exception 'FAIL: cancelou sem motivo';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_note_required' then raise; end if; end;
  perform public.task_cancel(t,v,'Cliente desistiu');
  if (select status from public.tasks where id=t)<>'cancelled' then raise exception 'FAIL: não cancelou'; end if;
end $$;

-- Responsável: só o setor da vez assume; mudar de etapa libera o responsável.
select set_config('request.jwt.claim.sub',current_setting('tfx.atend_id'),true);
do $$
declare t uuid; v integer;
begin
  t := public.task_create(current_setting('tfx.client_id')::uuid,current_setting('tfx.template_id')::uuid,'Tarefa com responsável','','normal',null);
  perform set_config('task_fx.id3', t::text, true);
  if (select updated_by from public.tasks where id=t) <> current_setting('tfx.atend_id')::uuid then raise exception 'FAIL: updated_by não registrado'; end if;
  select version into v from public.tasks where id=t; perform public.task_advance(t,v,'');
end $$;
select set_config('request.jwt.claim.sub',current_setting('tfx.contab_id'),true);
do $$
declare t uuid := current_setting('task_fx.id3')::uuid; v integer;
begin
  select version into v from public.tasks where id=t;
  begin perform public.task_claim(t,v,false); raise exception 'FAIL: setor errado assumiu';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_wrong_sector' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('tfx.fiscal_id'),true);
do $$
declare t uuid := current_setting('task_fx.id3')::uuid; v integer;
begin
  select version into v from public.tasks where id=t;
  perform public.task_claim(t,v,false);
  if (select assigned_to from public.tasks where id=t) <> current_setting('tfx.fiscal_id')::uuid then raise exception 'FAIL: não assumiu'; end if;
  select version into v from public.tasks where id=t;
  begin perform public.task_claim(t,v,false); raise exception 'FAIL: assumiu duas vezes';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm <> 'task_already_yours' then raise; end if; end;
  perform public.task_advance(t,v,'');
  if (select assigned_to from public.tasks where id=t) is not null then raise exception 'FAIL: responsável não foi liberado ao repassar'; end if;
  if not exists (select 1 from public.task_events where task_id=t and kind='claimed') then raise exception 'FAIL: histórico sem "assumida"'; end if;
end $$;

-- Recorrência: o colaborador cria a sua, outro não enxerga; a rotina gera uma vez por mês.
select set_config('request.jwt.claim.sub',current_setting('tfx.atend_id'),true);
insert into public.task_recurrences(client_id,template_id,title,day_of_month,due_days)
values (current_setting('tfx.client_id')::uuid,current_setting('tfx.template_id')::uuid,'Fechamento {mes}',1,3);
select set_config('request.jwt.claim.sub',current_setting('tfx.outsider_id'),true);
do $$ begin
  if exists (select 1 from public.task_recurrences where title='Fechamento {mes}') then raise exception 'FAIL: outro colaborador vê a recorrência'; end if;
end $$;
reset role;
update public.task_recurrences set last_period = null where title='Fechamento {mes}' and created_by=current_setting('tfx.atend_id')::uuid;
do $$
declare n integer; expected text := 'Fechamento ' || to_char(private.office_today(),'MM/YYYY');
begin
  n := private.task_run_recurrences();
  if n < 1 or not exists (select 1 from public.tasks where title=expected and created_by=current_setting('tfx.atend_id')::uuid) then
    raise exception 'FAIL: recorrência não gerou a tarefa (%)', expected;
  end if;
  if (select due_date from public.tasks where title=expected and created_by=current_setting('tfx.atend_id')::uuid limit 1)
     <> make_date(extract(year from private.office_today())::int, extract(month from private.office_today())::int, 1) + 3 then
    raise exception 'FAIL: prazo da recorrência incorreto';
  end if;
  perform private.task_run_recurrences();
  if (select count(*) from public.tasks where title=expected and created_by=current_setting('tfx.atend_id')::uuid) <> 1 then
    raise exception 'FAIL: recorrência gerou duas vezes no mesmo mês';
  end if;
end $$;

select 'tasks.rls: todas as verificações passaram' as result;
rollback;
