(() => {
 'use strict';
 const M=window.conectaWorkflowModels,api=()=>window.conectaWorkflows,profile=()=>window.conectaCurrentProfile,
  admin=()=>profile()?.role==='admin'&&profile()?.active===true,sector=()=>admin()?'':M.sector(profile()),user=()=>window.conectaCurrentUser?.id;
 const E=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const button=(label,fn,cls='secondary')=>{const b=E('button',label,cls);b.type='button';b.onclick=fn;return b;};
 const fmt=v=>v?new Date(v).toLocaleString('pt-BR'):'Sem prazo';
 const input=(type,value='')=>{const e=E(type==='textarea'?'textarea':'input');if(type!=='textarea')e.type=type;e.value=value??'';return e;};
 const label=(text,control)=>{const e=E('label',undefined,'wf-field');e.append(E('span',text),control);return e;};
 const select=(values,value)=>{const e=E('select');for(const [v,t] of values){const o=E('option',t);o.value=v;e.append(o);}e.value=value??values[0]?.[0]??'';return e;};
 const active=s=>['ready','active','correction','blocked'].includes(s.status);
 const visible=()=>document.getElementById('crumb')?.textContent==='Fluxo de Processos';
 const panel=()=>document.getElementById('viewPanel');
 let generation=0,unsubscribe,refreshTimer,loading=false,rerun=false,detailId=null,dirty=false,page=0,tab='processes',lastRefresh=0;
 let state={processes:[],steps:[],activities:[],notifications:[],reads:[],overview:null},error='',templates=[],detail=null;
 let notificationBaseline=false,seen=new Set(),drafts=new Map(),currentDialog=null;
 const toast=t=>window.showToast?.(t);
 const nav=button('⇄  Fluxo de Processos',()=>open());nav.dataset.view='Fluxo de Processos';document.querySelector('.nav [data-view="Lembretes"]')?.after(nav);
 function open(id){if(!id)tab='processes';detailId=id||null;dirty=false;document.querySelectorAll('.nav button,.channel').forEach(b=>b.classList.toggle('active',b===nav));renderView('Fluxo de Processos');}
 const original=renderView;renderView=window.renderView=view=>{original(view);if(view==='Fluxo de Processos'){render();refresh(true);}};
 const missing=e=>['42P01','42883','PGRST202','PGRST205'].includes(e?.code);
 function fail(e){return missing(e)?'O módulo está preparado, mas o banco deste ambiente ainda não recebeu a migração de Fluxo de Processos.':e?.message||'Falha ao carregar. Tente novamente.';}
 async function refresh(force=false){
  if(!api()||!user()||!profile()?.active)return;if(loading){rerun=true;return;}if(!force&&Date.now()-lastRefresh<1000)return;
  const gen=generation,account=user();loading=true;
  try{
   const [processes,activities,notifications,reads,overview]=await Promise.all([api().processes(page),api().activities(sector()),api().notifications(),api().reads(),api().overview()]);
   const steps=await api().steps(processes.map(p=>p.id),true);
   if(gen!==generation||account!==user())return;
   state={processes,activities,notifications,reads,overview,steps};error='';lastRefresh=Date.now();
   const read=new Set(reads.map(r=>r.notification_id));
   const incoming=notifications.filter(n=>!seen.has(n.id)&&!read.has(n.id));
   if(notificationBaseline)for(const n of incoming){toast(n.message);window.dispatchEvent(new CustomEvent('conecta-workflow-notification',{detail:n}));}
   seen=new Set(notifications.map(n=>n.id));notificationBaseline=true;
   paintShared();
   if(visible()){
    if(detailId){const banner=document.getElementById('wfChanges');if(banner)banner.hidden=false;}
    else if(!currentDialog)render();
   }
  }catch(e){if(gen===generation){error=fail(e);if(visible()&&!detailId&&!currentDialog)render();}}
  finally{loading=false;if(rerun){rerun=false;refresh(true);}}
 }
 function summary(root){
  const o=state.overview;if(!o)return;
  const metrics=E('div',undefined,'wf-metrics');
  for(const [name,value] of [['Aguardando Fiscal',o.bySector.Fiscal||0],['Aguardando DP',o.bySector['Departamento Pessoal']||0],['Aguardando Contábil',o.bySector['Contábil']||0],['Em correção',o.corrections],['Concluídos no prazo',o.timely],['Etapas atrasadas',o.overdue],['Espera média na transferência',o.transferHours==null?'—':Number(o.transferHours).toFixed(1)+' h']]){
   const card=E('article',undefined,'wf-metric');card.append(E('small',name),E('strong',String(value)));metrics.append(card);
  }root.append(metrics);
 }
 function shell(){
  const host=E('section',undefined,'wf-root');
  const toolbar=E('div',undefined,'view-toolbar');const title=E('div');title.append(E('h2','Fluxo de Processos'),E('p','Entregas entre setores, responsabilidades e histórico de cada etapa.'));
  toolbar.append(title,button('Atualizar',()=>{if(detailId)loadDetail(detailId);else refresh(true);}),button('Novo processo',createProcess,'primary'));host.append(toolbar);
  const tabs=E('div',undefined,'wf-tabs');for(const [key,text] of [['processes','Processos'],['activities','Atividades do setor'],['inbox','Avisos do setor'],...(admin()?[['templates','Modelos'],['series','Recorrências']]:[])]){
   const b=button(text,()=>{if(dirty&&!confirm('Sair sem salvar as alterações?'))return;dirty=false;tab=key;detailId=null;render();},tab===key?'primary':'secondary');b.setAttribute('aria-pressed',String(tab===key));tabs.append(b);
  }host.append(tabs);if(error)host.append(E('p',error,'wf-error'));return host;
 }
 function render(){
  if(!visible())return;panel().replaceChildren();const host=shell();panel().append(host);
  if(detailId){loadDetail(detailId);return;}
  if(tab==='templates'){renderTemplates(host);return;}if(tab==='series'){renderSeries(host);return;}
  if(tab==='inbox'){renderInbox(host);return;}
  summary(host);
  if(tab==='activities'){
   host.append(E('p','Atividades liberadas para seu setor. Abra a atividade para assumir, informar os dados ou encaminhar.'));
   for(const s of state.activities)host.append(activityCard(s));
   if(!state.activities.length)host.append(E('p','Nenhuma atividade liberada.','empty'));
   if(state.activities.length===100)host.append(button('Carregar mais atividades',async e=>{
    try{const more=await api().activities(sector(),Math.floor(state.activities.length/100));state.activities.push(...more);e.target.before(...more.map(activityCard));if(more.length<100)e.target.remove();}catch(err){toast(fail(err));}
   }));return;
  }
  const search=input('search');search.placeholder='Buscar cliente ou processo nesta página';search.setAttribute('aria-label',search.placeholder);
  const list=E('div',undefined,'wf-process-list');host.append(search,list);
  const draw=()=>{list.replaceChildren();const q=search.value.toLocaleLowerCase('pt-BR');for(const p of state.processes.filter(p=>(p.company+' '+p.name+' '+p.period).toLocaleLowerCase('pt-BR').includes(q))){
   const steps=state.steps.filter(s=>s.process_id===p.id),current=steps.filter(active),done=steps.filter(s=>['completed','skipped'].includes(s.status)).length;
   const card=E('article',undefined,'card wf-process');const head=E('div');head.append(E('h3',p.company+' · '+p.period.slice(0,7)),E('p',p.name));card.append(head);
   const progress=E('progress');progress.max=steps.length||1;progress.value=done;progress.setAttribute('aria-label','Conclusão');card.append(progress,E('small',Math.round(done/(steps.length||1)*100)+'% concluído'));
   if(p.completed_at)card.append(E('p','Concluído em '+fmt(p.completed_at)));
   for(const s of current){const next=steps.filter(n=>n.definition.dependencies.includes(s.key));const h=Math.max(0,(Date.now()-Date.parse(s.available_at))/3600000);
    card.append(E('p',`${s.definition.name} · ${s.sector} · ${M.status[s.status]}`,s.status==='blocked'?'wf-error':''),E('small',`Prazo: ${fmt(s.due_at)} · Há ${Math.floor(h)} h na etapa · Próximo: ${next.map(n=>n.sector).join(', ')||'Encerramento'}`));}
   card.append(button('Acompanhar processo',()=>{detailId=p.id;dirty=false;render();}));list.append(card);
  }if(!list.children.length)list.append(E('p','Nenhum processo nesta página.','empty'));};search.oninput=draw;draw();
  const pages=E('div',undefined,'wf-actions');if(page>0)pages.append(button('Página anterior',()=>{page--;refresh(true);}));pages.append(E('span','Página '+(page+1)));if(state.processes.length===50)pages.append(button('Próxima página',()=>{page++;refresh(true);}));host.append(pages);
 }
 function activityCard(s){const card=E('article',undefined,'wf-activity');card.append(E('strong',s.definition.name),E('span',s.sector+' · '+M.status[s.status]),E('small','Prazo: '+fmt(s.due_at)),button('Abrir atividade',()=>open(s.process_id)));return card;}
 function renderInbox(host){
  host.append(E('p','Avisos persistentes compartilhados pelo setor. A leitura é individual. Os 100 mais recentes aparecem aqui.'));
  const reads=new Set(state.reads.map(r=>r.notification_id));
  for(const n of state.notifications){const row=E('article',undefined,'wf-activity');row.append(E('strong',n.message),E('small',n.sector+' · '+fmt(n.created_at)),button('Abrir processo',()=>open(n.process_id)));
   if(!reads.has(n.id))row.append(button('Marcar como lido',async e=>{try{await api().command('ack',{process_id:n.process_id,notification_id:n.id});e.target.remove();refresh(true);}catch(err){toast(fail(err));}}));host.append(row);
  }if(!state.notifications.length)host.append(E('p','Nenhum aviso do setor.','empty'));
 }
 function paintShared(){
  const unread=state.notifications.filter(n=>!state.reads.some(r=>r.notification_id===n.id)).length;nav.textContent='⇄  Fluxo de Processos'+(unread?' ('+unread+')':'');
  const place=document.querySelector('.content>.grid>.right-col')||document.querySelector('.grid');
  if(place){let card=document.getElementById('wfDashboard');if(!card){card=E('section',undefined,'card wf-dashboard');card.id='wfDashboard';place.append(card);}card.replaceChildren(E('h3','Processos do setor'),E('p',state.activities.length+(state.activities.length===100?'+':'')+' atividades disponíveis · '+unread+' avisos não lidos'),button('Acompanhar',()=>open()));}
  document.querySelectorAll('.wf-shared-reminders').forEach(e=>e.remove());
  if(document.getElementById('crumb')?.textContent==='Lembretes'){
   const shared=E('section',undefined,'card wf-shared-reminders');shared.append(E('h3','Lembretes compartilhados do setor'),E('p','O andamento destas atividades é controlado pelo processo.'));
   for(const s of state.activities)shared.append(activityCard(s));for(const n of state.notifications.filter(n=>!state.reads.some(r=>r.notification_id===n.id)).slice(0,10))shared.append(button(n.message,()=>open(n.process_id)));
   if(!state.activities.length)shared.append(E('p','Nenhuma atividade liberada.'));panel().append(shared);
  }
 }
 // Refreshes never replace an open form. Explicit reload obtains the current revision.
 async function loadDetail(id){
  if(dirty&&!confirm('Há alterações não salvas. Recarregar os dados do processo?'))return;
  const gen=generation,account=user();const host=panel().querySelector('.wf-root');if(!host)return;
  const body=E('div');host.querySelector('.wf-detail')?.remove();body.className='wf-detail';body.textContent='Carregando processo…';host.append(body);
  try{
   const [p,steps,events,docs]=await Promise.all([api().process(id),api().steps([id]),api().history(id),api().documents(id)]);
   if(gen!==generation||account!==user()||detailId!==id||!visible()||!body.isConnected)return;
   detail={p,steps,events,docs};dirty=false;drawDetail(body);
  }catch(e){if(body.isConnected)body.textContent=fail(e);}
 }
 function drawDetail(body){
  const {p,steps,events,docs}=detail;body.replaceChildren();
  body.append(button('← Voltar à lista',()=>{if(dirty&&!confirm('Sair sem salvar as alterações?'))return;detailId=null;dirty=false;render();}),E('h2',p.company+' · '+p.period.slice(0,7)),E('p',p.name),E('small','Prazo legal/referência: '+fmt(p.legal_due_at)+' · Versão preservada do modelo'));
  const banner=E('p','O processo pode ter novas atualizações. Use Atualizar para carregar a versão atual.','wf-warning');banner.id='wfChanges';banner.hidden=true;body.append(banner);
  for(const s of steps.sort((a,b)=>p.definition.steps.findIndex(x=>x.key===a.key)-p.definition.steps.findIndex(x=>x.key===b.key))){
   const card=E('details',undefined,'card wf-step');card.open=active(s);const title=E('summary',`${s.definition.name} · ${s.sector} · ${M.status[s.status]}`);card.append(title);
   const assignee=(window.conectaDirectory||[]).find(x=>x.id===s.assignee);card.append(E('p','Responsável: '+(assignee?.name||(s.assignee?'Colaborador atribuído':'Aguardando alguém assumir'))+' · Prazo: '+fmt(s.due_at)));
   const deps=steps.filter(x=>s.definition.dependencies.includes(x.key));card.append(E('small','Dependências: '+(deps.map(d=>d.definition.name+' ('+M.status[d.status]+')').join('; ')||'Nenhuma')));
   const impact=M.impact(steps,s.key).filter(x=>!['completed','skipped'].includes(x.status));
   if(s.status==='blocked'||(active(s)&&s.due_at&&Date.parse(s.due_at)<Date.now()))card.append(E('p','Etapas potencialmente impactadas: '+(impact.map(x=>x.definition.name+' · '+x.sector).join('; ')||'Encerramento do processo'),'wf-warning'));
   const can=active(s)&&(admin()||sector()===s.sector),mine=admin()||s.assignee===user();
   const form=E('form',undefined,'wf-step-form'),controls=new Map();
   for(const f of s.definition.fields){
    if(f.type==='document'){
     const area=E('div',undefined,'wf-field');area.append(E('strong',f.label+(f.required?' *':'')));
     for(const d of docs.filter(d=>d.step_id===s.id&&d.field_key===f.key))area.append(button('📎 '+d.name,async()=>{try{const signed=await api().download(d);const a=E('a');a.href=signed.signedUrl;a.download=d.name;a.rel='noopener';a.click();}catch(e){toast(fail(e));}},'text-btn'));
     if(can&&mine){const upload=input('file');upload.setAttribute('aria-label',f.label);upload.onchange=async()=>{
      if(!upload.files[0])return;upload.disabled=true;
      try{const saved=await api().command('save',{process_id:p.id,step_id:s.id,revision:p.revision,command_id:crypto.randomUUID(),data:values()});p.revision=saved.revision;dirty=false;await api().upload(p,s,f.key,upload.files[0],crypto.randomUUID());await loadDetail(p.id);refresh(true);}catch(e){toast(fail(e));upload.disabled=false;}
     };area.append(upload);}form.append(area);continue;
    }
    const control=input({number:'number',date:'date',check:'checkbox',textarea:'textarea'}[f.type]||'text',s.data[f.key]);
    if(f.type==='check')control.checked=!!s.data[f.key];if(f.type==='number')control.step='any';
    control.disabled=!can||!mine;control.oninput=()=>{dirty=true;};controls.set(f.key,{f,control});form.append(label(f.label+(f.required?' *':''),control));
   }
   const values=()=>Object.fromEntries([...controls].map(([key,{f,control:c}])=>[key,f.type==='check'?c.checked:f.type==='number'?(c.value===''?null:Number(c.value)):c.value]));
   const feedback=E('p',undefined,'wf-error');feedback.setAttribute('role','alert');form.append(feedback);let busy=false;
   const run=async(op,extra={},btn)=>{
    if(busy)return;busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
    // Keep command UUID across a failed retry. A lost response cannot forward twice.
    const request={process_id:p.id,step_id:s.id,revision:p.revision,...extra};
    const signature=JSON.stringify([op,request]);let cmd=drafts.get(signature);if(!cmd){cmd=crypto.randomUUID();drafts.set(signature,cmd);}
    try{await api().command(op,{...request,command_id:cmd});drafts.delete(signature);dirty=false;await loadDetail(p.id);refresh(true);}
    catch(e){feedback.textContent=fail(e);if(e.code==='40001')document.getElementById('wfChanges').hidden=false;}
    finally{busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
   };
   form.onsubmit=e=>e.preventDefault();
   if(can){
    const actions=E('div',undefined,'wf-actions');
    if(!s.assignee||admin()||(s.assignee===user()&&!s.started_at))actions.append(button('Assumir atividade',()=>run('claim')));
    if(mine){actions.append(button('Salvar dados',()=>run('save',{data:values()})),button('Concluir e encaminhar',()=>run('complete',{data:values()}),'primary'));
     actions.append(button(s.status==='blocked'?'Resolver impedimento':'Registrar impedimento',()=>reasonDialog(s.status==='blocked'?'Resolver impedimento':'Registrar impedimento',[],extra=>run(s.status==='blocked'?'unblock':'block',extra))));
     const parents=deps.filter(x=>x.status==='completed');if(parents.length)actions.append(button('Devolver para correção',()=>reasonDialog('Devolver para correção',parents.map(x=>[x.key,x.definition.name+' · '+x.sector]),extra=>run('return',extra),'target_key')));
    }
    actions.append(button('Solicitar informação',()=>reasonDialog('Solicitar informação',p.sectors.map(x=>[x,x]),extra=>run('request',extra),'destination_sector')));form.append(actions);
   }
   if(admin()&&s.status==='completed')form.append(button('Reabrir etapa',()=>reasonDialog('Reabrir etapa e invalidar dependentes',[],extra=>run('reopen',extra))));
   card.append(form);body.append(card);
  }
  const log=E('section',undefined,'wf-history');log.append(E('h3','Histórico auditável'));
  const labels={complete:'Concluiu e encaminhou',claim:'Assumiu atividade',return:'Devolveu para correção',request:'Solicitou informação',block:'Registrou impedimento',unblock:'Resolveu impedimento',reopen:'Reabriu etapa',save:'Salvou os dados',document:'Anexou documento',create:'Abriu o processo',create_request:'Registrou abertura'};
  const appendEvents=rows=>{for(const e of rows){const item=E('details');item.append(E('summary',`${fmt(e.created_at)} · ${e.actor_name} · ${labels[e.action]||e.action}`),E('p',(e.origin_sector||'Abertura')+' → '+(e.destination_sectors.join(', ')||'Registro interno')));const request=e.payload?.request||{},before=e.payload?.before;
    if(request.reason)item.append(E('p',request.reason));
    if(request.name)item.append(E('p','Documento: '+request.name));
    const fields=steps.find(s=>s.id===e.step_id)?.definition.fields||[];
    const showData=(title,data,defs=fields)=>{if(!data||!Object.keys(data).length)return;item.append(E('strong',title));const values=E('dl');for(const [key,value] of Object.entries(data)){values.append(E('dt',defs.find(f=>f.key===key)?.label||key),E('dd',typeof value==='boolean'?(value?'Sim':'Não'):String(value??'—')));}item.append(values);};
    showData('Informações transmitidas',request.data);
    if(before&&['save','complete','return','reopen'].includes(e.action))showData('Registro anterior preservado',before.data);
    for(const old of e.payload?.invalidated||[])showData('Revisão necessária: '+old.definition.name,old.data,old.definition.fields);
    log.append(item);}};
  appendEvents(events);body.append(log);if(events.length===50){let before=events.at(-1).id;const older=button('Histórico anterior',async()=>{try{const rows=await api().history(p.id,before);appendEvents(rows);before=rows.at(-1)?.id;if(rows.length<50)older.remove();}catch(e){toast(fail(e));}});body.append(older);}
 }
 function dialog(title){
  currentDialog?.remove();const d=E('dialog',undefined,'wf-dialog');d.setAttribute('aria-label',title);const form=E('form');form.onsubmit=e=>e.preventDefault();form.append(E('h2',title));const error=E('p',undefined,'wf-error');error.setAttribute('role','alert');
  const actions=E('div',undefined,'wf-actions'),cancel=button('Cancelar',()=>d.close()),submit=E('button','Salvar','primary');submit.type='submit';actions.append(cancel,submit);
  form.append(error,actions);d.append(form);document.body.append(d);currentDialog=d;d.addEventListener('close',()=>{d.remove();if(currentDialog===d)currentDialog=null;});d.showModal();
  return {d,form,error,actions,submit,cancel,add:e=>form.insertBefore(e,error),busy:v=>{submit.disabled=v;cancel.disabled=v;}};
 }
 function reasonDialog(title,options,done,key){
  const q=dialog(title),reason=input('textarea');reason.required=true;reason.minLength=3;reason.maxLength=4000;q.add(label('Justificativa / informação transmitida',reason));
  const dest=options.length?select(options):null;if(dest)q.add(label('Destino',dest));
  q.form.onsubmit=async e=>{e.preventDefault();q.d.close();await done({reason:reason.value,...(dest?{[key]:dest.value}:{})});};
 }
 async function createProcess(){
  const q=dialog('Novo processo');q.submit.textContent='Criar processo';q.submit.disabled=true;
  try{templates=await api().templates();if(!q.d.isConnected)return;
   const latest=[...new Map(templates.map(t=>[t.name,templates.find(x=>x.name===t.name)])).values()];
   if(!latest.length){q.error.textContent='Cadastre primeiro um modelo na aba Modelos.';q.submit.disabled=true;return;}
   const model=select(latest.map(t=>[t.id,t.name+' · v'+t.version])),company=input('text'),period=input('month',new Date().toISOString().slice(0,7)),legal=input('datetime-local'),conditions=E('div'),members=E('div');company.required=true;period.required=true;
   q.add(label('Modelo',model));q.add(label('Empresa',company));q.add(label('Competência',period));q.add(label('Prazo legal / de referência (opcional)',legal));q.add(conditions);
   const contextInputs=new Map();model.onchange=()=>{conditions.replaceChildren();contextInputs.clear();for(const s of latest.find(t=>t.id===model.value).definition.steps.filter(s=>s.condition)){
    const f=s.condition.field;if(contextInputs.has(f))continue;const c=input('text');c.placeholder=String(s.condition.equals);conditions.append(label('Condição do cliente: '+f,c));contextInputs.set(f,{c,example:s.condition.equals});
   }};model.onchange();
   const selected=new Set();if(admin()){
    members.append(E('p','Acesso: todos os integrantes dos setores participantes. Se marcar pessoas abaixo, restringe a consulta a elas e aos administradores.'));
    for(const p of (window.conectaUsers||window.conectaDirectory||[]).filter(p=>p.active!==false)){const c=input('checkbox');c.onchange=()=>c.checked?selected.add(p.id):selected.delete(p.id);members.append(label(p.name,c));}q.add(members);
   }
   q.submit.disabled=false;const cid=crypto.randomUUID();q.form.onsubmit=async e=>{e.preventDefault();q.busy(true);
    try{const context={};for(const [key,{c,example}] of contextInputs){context[key]=typeof example==='boolean'?c.value==='true':typeof example==='number'?Number(c.value):c.value;}
     const p=await api().command('create',{command_id:cid,template_id:model.value,company:company.value,period:period.value+'-01',legal_due_at:legal.value?new Date(legal.value).toISOString():null,context,member_ids:[...selected]});q.d.close();open(p.id);refresh(true);
    }catch(err){q.error.textContent=fail(err);}finally{q.busy(false);}
   };
  }catch(e){q.error.textContent=fail(e);}
 }
 async function renderTemplates(host){
  const actions=E('div',undefined,'wf-actions');actions.append(button('Criar modelo',()=>editTemplate()),button('Usar exemplo do Fator R',()=>editTemplate(M.factorR)));host.append(actions,E('p','As edições criam novas versões. Processos em andamento preservam o modelo original.'));
  try{const gen=generation;templates=await api().templates();if(gen!==generation||!host.isConnected)return;const names=new Set();for(const t of templates){if(names.has(t.name))continue;names.add(t.name);const card=E('article',undefined,'wf-activity');card.append(E('strong',t.name),E('small','Versão '+t.version+' · '+t.definition.steps.length+' etapas'),button('Editar nova versão',()=>editTemplate(t)));host.append(card);}}catch(e){host.append(E('p',fail(e),'wf-error'));}
 }
 function editTemplate(source){
  const q=dialog(source?'Configurar modelo':'Criar modelo');q.d.classList.add('wf-model-dialog');const name=input('text',source?.name||'');name.required=true;name.maxLength=160;q.add(label('Nome do processo',name));
  const list=E('div');q.add(list);let steps=structuredClone(source?.definition?.steps||[]);const sectors=['Fiscal','Departamento Pessoal','Contábil','Atendimento','Geral'];
  const readAll=()=>{list.querySelectorAll('[data-step]').forEach((card,i)=>card.dispatchEvent(new Event('wf-read')));};
  const draw=()=>{list.replaceChildren();steps.forEach((s,i)=>{
   const card=E('section',undefined,'wf-model-step');card.dataset.step=s.key;card.append(E('h3','Etapa '+(i+1)));
   const title=input('text',s.name),sec=select(sectors.map(x=>[x,x]),s.sector),days=input('number',s.days??1),offset=input('number',s.legalOffset??0);days.min=0;days.max=365;offset.min=0;offset.max=365;title.required=true;
   const assignee=select([['','Qualquer integrante do setor'],...(window.conectaUsers||window.conectaDirectory||[]).filter(p=>p.active!==false).map(p=>[p.id,p.name])],s.assignee||'');
   card.append(label('Nome da etapa',title),label('Setor responsável',sec),label('Responsável preferencial (deve pertencer ao setor)',assignee),label('Prazo interno: dias após liberação',days),label('Antecedência ao prazo legal (dias)',offset));
   const depBox=E('div');depBox.append(E('strong','Depende de (marque todas as obrigatórias)'));const deps=new Map();for(const prev of steps.slice(0,i)){
    const c=input('checkbox');c.checked=s.dependencies.includes(prev.key);deps.set(prev.key,c);depBox.append(label(prev.name,c));
   }card.append(depBox);
   const cond=input('text',s.condition?.field||''),equals=input('text',s.condition?.equals==null?'':String(s.condition.equals));cond.placeholder='Ex.: exige_fator_r';card.append(label('Condição opcional: campo do cliente',cond),label('Executar apenas quando o campo for igual a',equals));
   const notices=E('div');notices.append(E('strong','Notificações da etapa'));const checks=new Map();for(const [kind,title] of [['received','Nova atividade'],['correction','Correção'],['information','Solicitação de informação'],['due','Prazo próximo'],['overdue','Atraso'],['blocked','Impedimento']]){const c=input('checkbox');c.checked=!s.notifications||s.notifications.includes(kind);checks.set(kind,c);notices.append(label(title,c));}card.append(notices);
   const fields=E('div');card.append(E('h4','Formulário e critérios de conclusão'),fields);const fieldReaders=[];
   s.fields.forEach((f,j)=>{
    const row=E('div',undefined,'wf-model-field'),key=input('text',f.key),text=input('text',f.label),type=select([['text','Texto'],['textarea','Texto longo'],['number','Número'],['date','Data'],['check','Conferência / checklist'],['document','Documento']],f.type),required=input('checkbox');required.checked=f.required;key.pattern='[a-z][a-z0-9_]{0,49}';key.required=true;text.required=true;
    row.append(label('Identificador',key),label('Título do campo',text),label('Tipo',type),label('Obrigatório',required),button('Remover campo',()=>{readAll();s.fields.splice(j,1);draw();}));fields.append(row);
    fieldReaders.push(()=>({key:key.value,label:text.value,type:type.value,required:required.checked}));
   });
   card.addEventListener('wf-read',()=>{Object.assign(s,{name:title.value,sector:sec.value,assignee:assignee.value||null,days:Number(days.value),legalOffset:Number(offset.value),dependencies:[...deps].filter(([k,c])=>c.checked).map(([k])=>k),fields:fieldReaders.map(fn=>fn()),notifications:[...checks].filter(([k,c])=>c.checked).map(([k])=>k)});if(cond.value.trim())s.condition={field:cond.value.trim(),equals:equals.value};else delete s.condition;});
   const move=delta=>{readAll();const at=i+delta;if(at<0||at>=steps.length)return;const copy=steps.slice();[copy[i],copy[at]]=[copy[at],copy[i]];const seen=new Set();for(const item of copy){if(item.dependencies.some(k=>!seen.has(k))){q.error.textContent='A ordem deve respeitar as dependências. Ajuste-as antes de mover.';return;}seen.add(item.key);}steps=copy;q.error.textContent='';draw();};
   if(i>0)card.append(button('Mover acima',()=>move(-1)));if(i<steps.length-1)card.append(button('Mover abaixo',()=>move(1)));
   card.append(button('Adicionar campo',()=>{readAll();s.fields.push({key:'campo_'+(s.fields.length+1)+'_'+Date.now().toString(36),label:'Novo campo',type:'text',required:true});draw();}),button('Remover etapa',()=>{readAll();if(steps.some(x=>x.dependencies.includes(s.key))){q.error.textContent='Remova primeiro as dependências desta etapa.';return;}steps.splice(i,1);draw();}));list.append(card);
  });};draw();
  q.add(button('Adicionar etapa',()=>{readAll();steps.push({key:'etapa_'+crypto.randomUUID().replaceAll('-','').slice(0,8),name:'Nova etapa',sector:'Fiscal',days:1,legalOffset:0,dependencies:steps.length?[steps.at(-1).key]:[],fields:[]});draw();}));
  q.form.onsubmit=async e=>{e.preventDefault();readAll();q.busy(true);
   try{const current=await api().templates();const expected=Math.max(0,...current.filter(x=>x.name===name.value.trim()).map(x=>x.version));
    if(source?.version&&source.name===name.value.trim()&&expected!==source.version)throw Error('Este modelo ganhou uma nova versão. Abra a versão atual.');
    await api().command('template',{name:name.value,definition:{steps},expected_version:source?.version&&source.name===name.value.trim()?source.version:expected});q.d.close();render();toast('Nova versão do modelo salva.');
   }catch(err){q.error.textContent=fail(err);}finally{q.busy(false);}
  };
 }
 async function renderSeries(host){
  host.append(E('p','Recorrências usam uma versão fixa do modelo e criam competências independentes. O agendador deve estar habilitado no ambiente de teste / produção autorizado.'),button('Nova recorrência',async()=>{
   const q=dialog('Nova recorrência');try{const models=await api().templates();const model=select(models.map(t=>[t.id,t.name+' · v'+t.version]));const company=input('text'),period=input('month'),run=input('date'),months=input('number',1),legal=input('number');company.required=true;period.required=true;run.required=true;months.min=1;months.max=12;legal.min=1;legal.max=31;
    q.add(label('Modelo e versão',model));q.add(label('Empresa',company));q.add(label('Primeira competência',period));q.add(label('Primeira abertura em',run));q.add(label('Repetir a cada N meses',months));q.add(label('Dia do prazo legal na competência (opcional)',legal));
    const ctx=E('div');q.add(ctx);const inputs=new Map();model.onchange=()=>{ctx.replaceChildren();inputs.clear();for(const s of models.find(t=>t.id===model.value)?.definition.steps||[]){if(!s.condition||inputs.has(s.condition.field))continue;const c=input('text');ctx.append(label('Condição: '+s.condition.field,c));inputs.set(s.condition.field,c);}};model.onchange();
    const command_id=crypto.randomUUID();q.form.onsubmit=async e=>{e.preventDefault();q.busy(true);try{await api().command('series',{command_id,template_id:model.value,company:company.value,period:period.value+'-01',next_run:run.value,interval_months:Number(months.value),legal_day:legal.value,context:Object.fromEntries([...inputs].map(([k,c])=>[k,c.value]))});q.d.close();render();}catch(err){q.error.textContent=fail(err);}finally{q.busy(false);}};
   }catch(e){q.error.textContent=fail(e);}
  }));
  try{const rows=await api().series();if(!host.isConnected)return;for(const r of rows){const card=E('article',undefined,'wf-activity');if(r.last_error)card.append(E('p','Falha na última abertura: '+r.last_error,'wf-error'));card.append(E('strong',r.company),E('p',`A cada ${r.interval_months} mês(es) · Próxima: ${r.next_run} · ${r.active?'Ativa':'Pausada'}`),button(r.active?'Pausar':'Ativar',async()=>{try{await api().command('series',{id:r.id,active:!r.active});render();}catch(e){toast(fail(e));}}));host.append(card);}}catch(e){host.append(E('p',fail(e),'wf-error'));}
 }
 function reset(){nav.textContent='⇄  Fluxo de Processos';generation++;unsubscribe?.();unsubscribe=null;clearTimeout(refreshTimer);currentDialog?.close();drafts.clear();state={processes:[],steps:[],activities:[],notifications:[],reads:[],overview:null};detail=null;detailId=null;dirty=false;seen.clear();notificationBaseline=false;error='';lastRefresh=0;page=0;document.getElementById('wfDashboard')?.remove();document.querySelectorAll('.wf-shared-reminders').forEach(e=>e.remove());if(visible())panel().replaceChildren(E('p','Entre novamente para consultar os processos.'));}
 function start(){reset();if(!user()||!profile()?.active)return;unsubscribe=api()?.subscribe(sector(),()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(true),300);});refresh(true);}
 window.addEventListener('conecta-profile-ready',start);window.addEventListener('conecta-auth-session-reset',reset);
 window.addEventListener('focus',()=>{if(Date.now()-lastRefresh>60000)refresh();});window.addEventListener('online',()=>refresh(true));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>60000)refresh();});
 setInterval(()=>{if(!document.hidden)refresh();},300000);
 const baseForShared=renderView;renderView=window.renderView=view=>{baseForShared(view);if(view==='Lembretes')paintShared();};
 window.conectaOpenProcess=open;
})();
