(() => {
 'use strict';
 const M=window.conectaWorkflowModels,api=()=>window.conectaWorkflows,profile=()=>window.conectaCurrentProfile,
  admin=()=>profile()?.role==='admin'&&profile()?.active===true,sector=()=>admin()?'':M.sector(profile()),user=()=>window.conectaCurrentUser?.id;
 const E=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const button=(label,fn,cls='secondary')=>{const b=E('button',label,cls);b.type='button';b.onclick=fn;return b;};
 const fmt=v=>v?new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Sem prazo';
 const period=v=>{const [year,month]=String(v).slice(0,7).split('-');return month+'/'+year;};
 const shortSector=v=>v==='Departamento Pessoal'?'DP':v;
 const fold=(title,cls='wf-fold')=>{const d=E('details',undefined,cls);d.append(E('summary',title));return d;};
 const status=s=>({waiting:'Aguardando etapa anterior',ready:'Pronta para começar',active:'Em andamento',blocked:'Parada por impedimento',correction:'Precisa de correção',completed:'Concluída',skipped:'Não se aplica'}[s.status]||M.status[s.status]);
 const goToStep=key=>{const card=[...document.querySelectorAll('.wf-step')].find(c=>c.dataset.key===key);if(card){card.open=true;card.scrollIntoView({behavior:'smooth',block:'start'});card.querySelector('summary')?.focus({preventScroll:true});}};
 let listQuery='',listFilter='open';
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
 const documentLink=d=>button('📎 '+d.name,async()=>{try{const signed=await api().download(d);const a=E('a');a.href=signed.signedUrl;a.download=d.name;a.rel='noopener';a.click();}catch(e){toast(fail(e));}},'text-btn');
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
    if(detailId){const latest=processes.find(p=>p.id===detailId),banner=document.getElementById('wfChanges');if(banner&&latest&&detail?.p.id===detailId)banner.hidden=latest.revision===detail.p.revision;}
    else if(!currentDialog)render();
   }
  }catch(e){if(gen===generation){error=fail(e);if(visible()&&!detailId&&!currentDialog)render();}}
  finally{loading=false;if(rerun){rerun=false;refresh(true);}}
 }
 function summary(root){
  const o=state.overview;if(!o)return;
  const wrap=fold('Resumo por setor e prazos');const metrics=E('div',undefined,'wf-metrics');
  for(const [name,value] of [['Aguardando Fiscal',o.bySector.Fiscal||0],['Aguardando DP',o.bySector['Departamento Pessoal']||0],['Aguardando Contábil',o.bySector['Contábil']||0],['Em correção',o.corrections],['Concluídos no prazo',o.timely],['Etapas atrasadas',o.overdue],['Espera média para assumir',o.transferHours==null?'—':Number(o.transferHours).toFixed(1)+' h']]){
   const card=E('article',undefined,'wf-metric');card.append(E('small',name),E('strong',String(value)));metrics.append(card);
  }wrap.append(metrics);root.append(wrap);
 }
 function shell(){
  const host=E('section',undefined,'wf-root');
  if(detailId){host.classList.add('is-detail');if(error)host.append(E('p',error,'wf-error'));return host;}
  const toolbar=E('div',undefined,'view-toolbar');const title=E('div');title.append(E('h2','Fluxo de Processos'),E('p','Veja o que precisa ser feito e passe a entrega para o próximo setor.'));
  const actions=E('div',undefined,'wf-actions');
  actions.append(button('Atualizar',()=>{if(detailId)loadDetail(detailId);else refresh(true);},'text-btn'));
  if(!detailId)actions.append(button('Novo processo',createProcess,'primary'));toolbar.append(title,actions);host.append(toolbar);
  if(!detailId){
   const tabs=E('div',undefined,'wf-tabs');
   for(const [key,text] of [['processes','Processos'],['activities','Tarefas do setor'],['inbox','Avisos']]){
    const b=button(text,()=>{tab=key;render();},tab===key?'primary':'secondary');b.setAttribute('aria-pressed',String(tab===key));tabs.append(b);
   }
   if(admin()){
    const settings=fold('Configurar','wf-settings');
    settings.append(button('Modelos de processo',()=>{tab='templates';render();},'text-btn'),button('Repetições automáticas',()=>{tab='series';render();},'text-btn'));tabs.append(settings);
   }host.append(tabs);
  }
  if(error)host.append(E('p',error,'wf-error'));return host;
 }
 function render(){
  if(!visible())return;
  const focused=document.activeElement?.id==='wfSearch',selection=document.getElementById('wfSearch')?.selectionStart;
  panel().replaceChildren();const host=shell();panel().append(host);
  if(detailId){loadDetail(detailId);return;}
  if(tab==='templates'){renderTemplates(host);return;}if(tab==='series'){renderSeries(host);return;}
  if(tab==='inbox'){renderInbox(host);return;}
  if(tab==='activities'){
   host.append(E('h3','O que seu setor precisa fazer'),E('p','Escolha uma tarefa para começar ou continuar a entrega.'));
   for(const step of state.activities)host.append(activityCard(step));
   if(!state.activities.length)host.append(E('p','Tudo em dia. Nenhuma tarefa liberada para seu setor.','empty'));
   if(state.activities.length===100)host.append(button('Carregar mais tarefas',async e=>{
    try{const more=await api().activities(sector(),Math.floor(state.activities.length/100));state.activities.push(...more);e.target.before(...more.map(activityCard));if(more.length<100)e.target.remove();}catch(err){toast(fail(err));}
   }));return;
  }
  const search=input('search',listQuery);search.id='wfSearch';search.placeholder='Buscar empresa ou processo';search.setAttribute('aria-label',search.placeholder);
  const filter=select([['open','Em andamento'],['completed','Concluídos'],['all','Todos']],listFilter);filter.setAttribute('aria-label','Situação dos processos');
  const filters=E('div',undefined,'wf-filters');filters.append(search,filter);host.append(filters);
  const list=E('div',undefined,'wf-process-list');host.append(list);
  const draw=()=>{list.replaceChildren();const q=listQuery.toLocaleLowerCase('pt-BR');
   const rows=state.processes.filter(p=>(listFilter==='all'||(listFilter==='completed'?!!p.completed_at:!p.completed_at))&&(p.company+' '+p.name+' '+period(p.period)).toLocaleLowerCase('pt-BR').includes(q));
   for(const p of rows){
    const steps=state.steps.filter(s=>s.process_id===p.id),current=steps.filter(active),done=steps.filter(s=>['completed','skipped'].includes(s.status)).length;
    const card=E('article',undefined,'card wf-process');const head=E('div',undefined,'wf-process-head');head.append(E('small',period(p.period)),E('h3',p.company));card.append(head,E('p',p.name,'wf-process-name'));
    const own=current.find(s=>s.sector===sector()),nextAction=own||current[0];
    if(p.completed_at)card.append(E('span','Concluído','wf-badge is-done'),E('small','Finalizado em '+fmt(p.completed_at)));
    else if(nextAction){
     const waiting=E('div',undefined,'wf-next');waiting.append(E('small',own?'Seu setor é o próximo a agir':'Aguardando'),E('strong',shortSector(nextAction.sector)),E('span',nextAction.definition.name));card.append(waiting);
     if(current.length>1)card.append(E('small',current.length+' etapas liberadas em paralelo'));
     if(nextAction.status==='correction'||nextAction.status==='blocked')card.append(E('span',status(nextAction),'wf-badge is-alert'));
     card.append(E('small','Prazo da etapa: '+fmt(nextAction.due_at)));
    }
    const progress=E('progress');progress.max=steps.length||1;progress.value=done;progress.setAttribute('aria-label','Conclusão');card.append(progress,E('small',done+' de '+steps.length+' etapas concluídas'));
    card.append(button(p.completed_at?'Ver processo':own||admin()?'Continuar processo':'Acompanhar processo',()=>{detailId=p.id;dirty=false;render();},p.completed_at?'secondary':'primary'));list.append(card);
   }
   if(!list.children.length){
    const empty=E('div',undefined,'wf-empty');empty.append(E('h3',listQuery?'Nenhum resultado para esta busca':listFilter==='open'?'Nenhum processo em andamento':'Nenhum processo encontrado'),E('p',listQuery?'Tente o nome da empresa ou outro termo.':listFilter==='open'?'Comece informando a empresa e a competência. O modelo organiza as etapas para você.':'Altere o filtro para consultar os outros processos.'));
    if(!listQuery&&listFilter==='open')empty.append(button('Criar primeiro processo',createProcess,'primary'));list.append(empty);
   }
  };
  search.oninput=()=>{listQuery=search.value;draw();};filter.onchange=()=>{listFilter=filter.value;draw();};draw();
  const pages=E('div',undefined,'wf-actions');if(page>0)pages.append(button('Página anterior',()=>{page--;refresh(true);}));
  if(page>0||state.processes.length===50)pages.append(E('small','Página '+(page+1)+' · busca e filtro nesta página'));
  if(state.processes.length===50)pages.append(button('Próxima página',()=>{page++;refresh(true);}));host.append(pages);summary(host);
  if(focused){search.focus();if(selection!=null)search.setSelectionRange(selection,selection);}
 }
 function activityCard(s){
  const p=s.process||state.processes.find(p=>p.id===s.process_id),card=E('article',undefined,'wf-activity');const info=E('div',undefined,'wf-activity-info');
  info.append(E('strong',p?p.company+' · '+period(p.period):'Processo do setor'),E('span',s.definition.name),E('small',shortSector(s.sector)+' · '+status(s)+' · Prazo: '+fmt(s.due_at)));
  card.append(info,button('Abrir tarefa',()=>open(s.process_id),'primary'));return card;
 }
 function renderInbox(host){
  host.append(E('p','Novas entregas, pedidos de informação e alertas do seu setor. Mostramos os 100 avisos mais recentes.'));
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
  const ordered=steps.slice().sort((a,b)=>p.definition.steps.findIndex(x=>x.key===a.key)-p.definition.steps.findIndex(x=>x.key===b.key));
  const focusStep=ordered.find(s=>active(s)&&(admin()||s.sector===sector()))||ordered.find(active);
  const done=ordered.filter(s=>['completed','skipped'].includes(s.status)).length;
  const navigation=E('div',undefined,'wf-detail-nav');navigation.append(button('← Voltar aos processos',()=>{if(dirty&&!confirm('Sair sem salvar as alterações?'))return;detailId=null;dirty=false;tab='processes';render();},'text-btn'),button('Atualizar',()=>loadDetail(p.id),'text-btn'));body.append(navigation,E('h2',p.company),E('p',period(p.period)+' · '+p.name,'wf-process-name'));
  const overview=E('div',undefined,'wf-focus');overview.append(E('small',p.completed_at?'Processo concluído':focusStep&&(admin()||focusStep.sector===sector())?'Sua próxima ação':'Próxima ação'));
  overview.append(E('strong',p.completed_at?'Todas as entregas foram concluídas':focusStep?shortSector(focusStep.sector)+' · '+focusStep.definition.name:'Aguardando liberação'));
  overview.append(E('span',done+' de '+steps.length+' etapas concluídas'+(focusStep?' · Prazo: '+fmt(focusStep.due_at):'')));body.append(overview);
  const route=E('ol',undefined,'wf-route');
  ordered.forEach((s,i)=>{const li=E('li');const b=button('',()=>goToStep(s.key),'wf-route-step');b.dataset.status=s.status;b.setAttribute('aria-label','Etapa '+(i+1)+': '+s.definition.name+' · '+status(s));b.append(E('span',String(i+1),'wf-route-number'),E('strong',shortSector(s.sector)),E('small',status(s)));li.append(b);route.append(li);});
  if(ordered.length>6){const routeFold=fold('Ver as '+ordered.length+' etapas do processo');routeFold.append(route);body.append(routeFold);}else body.append(route);
  const banner=E('div',undefined,'wf-warning');banner.append(E('span','Este processo foi atualizado. Seu formulário foi mantido.'),button('Carregar atualização',()=>loadDetail(p.id),'text-btn'));banner.id='wfChanges';banner.hidden=true;body.append(banner);
  for(const s of steps.sort((a,b)=>p.definition.steps.findIndex(x=>x.key===a.key)-p.definition.steps.findIndex(x=>x.key===b.key))){
   const card=E('details',undefined,'card wf-step');card.dataset.key=s.key;card.open=s.key===focusStep?.key;
   const title=E('summary');title.tabIndex=0;title.append(E('span',s.definition.name),E('small',shortSector(s.sector)+' · '+status(s)));card.append(title);
   const assignee=(window.conectaDirectory||[]).find(x=>x.id===s.assignee);card.append(E('p','Responsável: '+(assignee?.name||(s.assignee?'Colaborador atribuído':'Ainda não assumida'))+' · Prazo: '+fmt(s.due_at),'wf-step-meta'));
   const deps=steps.filter(x=>s.definition.dependencies.includes(x.key));
   if(s.status==='waiting')card.append(E('p','Esta etapa será liberada depois de: '+deps.filter(x=>!['completed','skipped'].includes(x.status)).map(x=>shortSector(x.sector)+' · '+x.definition.name).join('; '),'wf-help'));
   const delivered=deps.filter(x=>x.status==='completed');
   if(delivered.length){const handoff=fold('Ver o que o setor anterior entregou','wf-fold wf-handoff');
    for(const prev of delivered){handoff.append(E('h4',shortSector(prev.sector)+' · '+prev.definition.name));const values=E('dl');for(const f of prev.definition.fields.filter(f=>f.type!=='document')){const v=prev.data[f.key];if(v!=null&&v!=='')values.append(E('dt',f.label),E('dd',typeof v==='boolean'?(v?'Sim':'Não'):String(v)));}handoff.append(values);for(const d of docs.filter(d=>d.step_id===prev.id))handoff.append(documentLink(d));}card.append(handoff);
   }
   const impact=M.impact(steps,s.key).filter(x=>!['completed','skipped'].includes(x.status));
   if(s.status==='blocked'||(active(s)&&s.due_at&&Date.parse(s.due_at)<Date.now()))card.append(E('p','Etapas potencialmente impactadas: '+(impact.map(x=>x.definition.name+' · '+x.sector).join('; ')||'Encerramento do processo'),'wf-warning'));
   const can=active(s)&&(admin()||sector()===s.sector),mine=!!s.assignee&&(admin()||s.assignee===user()),needsStart=can&&(!s.assignee||(s.assignee===user()&&!s.started_at));
   const guidance=needsStart?(s.assignee?'Retome a atividade para conferir e reenviar a entrega.':'Assuma a atividade para começar.'):can&&mine?'Preencha os dados, confira os documentos e encaminhe a entrega.':can?'Esta tarefa já está com '+(assignee?.name||'outro integrante do setor')+'.':active(s)?'A próxima ação está com o setor '+shortSector(s.sector)+'. Você pode consultar os dados abaixo.':'';
   if(guidance)card.append(E('p',guidance,'wf-help'));
   const form=E('form',undefined,'wf-step-form'),controls=new Map();
   const optional=fold('Informações adicionais (opcional)');const appendField=(f,node)=>(f.required?form:optional).append(node);
   for(const f of s.definition.fields){
    if(needsStart)continue;
    if(f.type==='document'){
     if((!can||!mine)&&!docs.some(d=>d.step_id===s.id&&d.field_key===f.key))continue;
     const area=E('div',undefined,'wf-field');area.append(E('strong',f.label+(f.required?' *':'')));
     for(const d of docs.filter(d=>d.step_id===s.id&&d.field_key===f.key))area.append(documentLink(d));
     if(can&&mine){const upload=input('file');upload.setAttribute('aria-label',f.label);upload.onchange=async()=>{
      if(!upload.files[0])return;upload.disabled=true;
      try{const saved=await api().command('save',{process_id:p.id,step_id:s.id,revision:p.revision,command_id:crypto.randomUUID(),data:values()});p.revision=saved.revision;dirty=false;await api().upload(p,s,f.key,upload.files[0],crypto.randomUUID());await loadDetail(p.id);refresh(true);}catch(e){toast(fail(e));upload.disabled=false;}
     };area.append(upload);}appendField(f,area);continue;
    }
    if(!can||!mine){const v=s.data[f.key];if(v==null||v==='')continue;const value=E('div',undefined,'wf-read-value');value.append(E('small',f.label),E('p',v==null||v===''?'Ainda não informado':typeof v==='boolean'?(v?'Conferido':'Não conferido'):String(v)));appendField(f,value);continue;}
    const control=input({number:'number',date:'date',check:'checkbox',textarea:'textarea'}[f.type]||'text',s.data[f.key]);
    if(f.type==='check')control.checked=!!s.data[f.key];if(f.type==='number')control.step='any';
    control.disabled=!can||!mine;control.oninput=()=>{dirty=true;};controls.set(f.key,{f,control});appendField(f,label(f.label+(f.required?' *':''),control));
   }
   if(optional.children.length>1)form.append(optional);
   const values=()=>Object.fromEntries([...controls].map(([key,{f,control:c}])=>[key,f.type==='check'?c.checked:f.type==='number'?(c.value===''?null:Number(c.value)):c.value]));
   const feedback=E('p',undefined,'wf-error');feedback.setAttribute('role','alert');form.append(feedback);let busy=false;
   const run=async(op,extra={},btn)=>{
    if(busy)return;busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
    // Keep command UUID across a failed retry. A lost response cannot forward twice.
    const request={process_id:p.id,step_id:s.id,revision:p.revision,...extra};
    const signature=JSON.stringify([op,request]);let cmd=drafts.get(signature);if(!cmd){cmd=crypto.randomUUID();drafts.set(signature,cmd);}
    try{await api().command(op,{...request,command_id:cmd});drafts.delete(signature);dirty=false;await loadDetail(p.id);if(op==='complete')toast(detail?.p.completed_at?'Processo concluído.':'Entrega concluída e encaminhada.');else if(op==='save')toast('Rascunho salvo.');refresh(true);}
    catch(e){feedback.textContent=fail(e);if(e.code==='40001')document.getElementById('wfChanges').hidden=false;}
    finally{busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
   };
   form.onsubmit=e=>e.preventDefault();
   if(can){
    const actions=E('div',undefined,'wf-actions wf-main-actions');
    if(needsStart)actions.append(button(s.assignee?'Retomar atividade':'Assumir atividade',()=>run('claim'),'primary'));
    else if(mine){
     if(s.status==='blocked')actions.append(button('Resolver impedimento',()=>reasonDialog('Resolver impedimento',[],extra=>run('unblock',extra)),'primary'));
     else actions.append(button('Concluir e encaminhar',()=>run('complete',{data:values()}),'primary'));
     actions.append(button('Salvar rascunho',()=>run('save',{data:values()})));
     const next=ordered.filter(n=>n.definition.dependencies.includes(s.key)&&n.status!=='skipped');
     form.append(E('p',next.length?'Ao concluir, a entrega segue para '+[...new Set(next.map(n=>shortSector(n.sector)))].join(' e ')+', quando todas as etapas anteriores estiverem prontas.':'Ao concluir esta entrega, o sistema verifica se o processo já pode ser encerrado.','wf-help'));
    }
    form.append(actions);
    const more=fold('Preciso de ajuda ou de uma correção','wf-fold wf-more-actions');
    more.append(button('Solicitar informação',()=>reasonDialog('Solicitar informação',p.sectors.map(x=>[x,shortSector(x)]),extra=>run('request',extra),'destination_sector')));
    if(mine){
     if(s.status!=='blocked')more.append(button('Registrar impedimento',()=>reasonDialog('Registrar impedimento',[],extra=>run('block',extra))));
     const parents=deps.filter(x=>x.status==='completed');if(parents.length)more.append(button('Devolver para correção',()=>reasonDialog('Devolver para correção',parents.map(x=>[x.key,x.definition.name+' · '+shortSector(x.sector)]),extra=>run('return',extra),'target_key')));
    }
    if(admin()&&s.assignee&&s.assignee!==user())more.append(button('Assumir no lugar do responsável',()=>run('claim')));
    form.append(more);
   }
   if(admin()&&s.status==='completed'){const manage=fold('Revisar esta etapa');manage.append(button('Reabrir etapa',()=>reasonDialog('Reabrir etapa',[],extra=>run('reopen',extra))));form.append(manage);}
   card.append(form);body.append(card);card.addEventListener('toggle',()=>{if(card.open)body.querySelectorAll('.wf-step').forEach(other=>{if(other!==card)other.open=false;});});
  }
  const log=fold('Histórico do processo','wf-history');
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
  appendEvents(events);body.append(log);if(events.length===50){let before=events.at(-1).id;const older=button('Histórico anterior',async()=>{try{const rows=await api().history(p.id,before);appendEvents(rows);before=rows.at(-1)?.id;if(rows.length<50)older.remove();}catch(e){toast(fail(e));}});log.append(older);}
 }
 function dialog(title){
  currentDialog?.remove();const d=E('dialog',undefined,'wf-dialog');d.setAttribute('aria-label',title);const form=E('form');form.onsubmit=e=>e.preventDefault();form.append(E('h2',title));const error=E('p',undefined,'wf-error');error.setAttribute('role','alert');
  const actions=E('div',undefined,'wf-actions'),cancel=button('Cancelar',()=>d.close()),submit=E('button','Salvar','primary');submit.type='submit';actions.append(cancel,submit);
  form.append(error,actions);d.append(form);document.body.append(d);currentDialog=d;d.addEventListener('close',()=>{d.remove();if(currentDialog===d)currentDialog=null;});d.showModal();
  return {d,form,error,actions,submit,cancel,add:e=>form.insertBefore(e,error),busy:v=>{submit.disabled=v;cancel.disabled=v;}};
 }
 function reasonDialog(title,options,done,key){
  const q=dialog(title),reason=input('textarea');
  q.submit.textContent=title==='Solicitar informação'?'Enviar solicitação':title==='Devolver para correção'?'Devolver etapa':title==='Registrar impedimento'?'Registrar impedimento':title==='Reabrir etapa'?'Reabrir etapa':'Confirmar';
  if(title==='Devolver para correção'||title==='Reabrir etapa')q.add(E('p','As etapas que dependem desta entrega precisarão ser conferidas novamente. Os dados anteriores serão mantidos.','wf-help'));reason.required=true;reason.minLength=3;reason.maxLength=4000;q.add(label('Justificativa / informação transmitida',reason));
  const dest=options.length?select(options):null;if(dest)q.add(label('Destino',dest));
  q.form.onsubmit=async e=>{e.preventDefault();q.d.close();await done({reason:reason.value,...(dest?{[key]:dest.value}:{})});};
 }
 async function createProcess(){
  const q=dialog('Novo processo');q.submit.textContent='Criar processo';q.submit.disabled=true;
  try{templates=await api().templates();if(!q.d.isConnected)return;
   const latest=[...new Map(templates.map(t=>[t.name,templates.filter(x=>x.name===t.name).sort((a,b)=>b.version-a.version)[0]])).values()];
   if(!latest.length){
    q.add(E('p',admin()?'Vamos preparar seu primeiro fluxo. Você pode usar a sequência Fiscal → DP → Fiscal → Contábil e ajustar depois.':'Um administrador precisa preparar o tipo de processo antes da primeira abertura.','wf-help'));
    if(admin())q.add(button('Começar com o modelo Fiscal e DP',async e=>{e.target.disabled=true;try{await api().command('template',{name:M.factorR.name,definition:M.factorR.definition,expected_version:0});if(!q.d.isConnected)return;q.d.close();createProcess();}catch(err){q.error.textContent=fail(err);e.target.disabled=false;}},'primary'));
    q.submit.hidden=true;return;
   }
   const model=select(latest.map(t=>[t.id,t.name])),company=input('text'),competence=input('month',new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date())),legal=input('datetime-local'),conditions=E('div'),preview=E('div',undefined,'wf-create-preview');
   company.required=true;company.maxLength=160;company.placeholder='Nome da empresa';competence.required=true;
   q.add(label('Tipo de processo',model));q.add(preview);q.add(label('Empresa',company));q.add(label('Competência',competence));q.add(conditions);
   const contextInputs=new Map();model.onchange=()=>{conditions.replaceChildren();contextInputs.clear();preview.replaceChildren(E('small','Caminho da entrega'));const flow=E('p');flow.textContent=latest.find(t=>t.id===model.value).definition.steps.map(s=>shortSector(s.sector)).join(' → ');preview.append(flow);
    for(const step of latest.find(t=>t.id===model.value).definition.steps.filter(s=>s.condition)){
     const key=step.condition.field;if(contextInputs.has(key))continue;const control=input('text');control.placeholder=String(step.condition.equals);conditions.append(label('Informação do cliente: '+key,control));contextInputs.set(key,{control,example:step.condition.equals});
    }
   };model.onchange();
   const options=fold('Prazo e acesso (opcional)');options.append(label('Prazo final de referência',legal));const selected=new Set();
   if(admin()){
    const access=fold('Restringir o acesso a pessoas específicas');access.append(E('p','Sem seleção, todos os integrantes dos setores participantes podem acompanhar.'));
    for(const person of (window.conectaUsers||window.conectaDirectory||[]).filter(p=>p.active!==false)){const c=input('checkbox');c.onchange=()=>c.checked?selected.add(person.id):selected.delete(person.id);access.append(label(person.name,c));}options.append(access);
   }q.add(options);q.add(E('p','A primeira etapa será liberada assim que o processo for criado.','wf-help'));
   q.submit.disabled=false;const cid=crypto.randomUUID();q.form.onsubmit=async e=>{e.preventDefault();q.busy(true);
    try{const context={};for(const [key,{control,example}] of contextInputs)context[key]=typeof example==='boolean'?control.value==='true':typeof example==='number'?Number(control.value):control.value;
     const created=await api().command('create',{command_id:cid,template_id:model.value,company:company.value,period:competence.value+'-01',legal_due_at:legal.value?new Date(legal.value).toISOString():null,context,member_ids:[...selected]});q.d.close();listFilter='open';open(created.id);refresh(true);
    }catch(err){q.error.textContent=fail(err);}finally{q.busy(false);}
   };
  }catch(e){q.error.textContent=fail(e);}
 }
 async function renderTemplates(host){
  host.append(E('h3','Modelos de processo'));
  const actions=E('div',undefined,'wf-actions');actions.append(button('Criar modelo',()=>editTemplate()),button('Usar exemplo do Fator R',()=>editTemplate(M.factorR)));host.append(actions,E('p','Defina uma vez o caminho e as informações de cada entrega. As alterações valem para os próximos processos.'));
  try{const gen=generation;templates=await api().templates();if(gen!==generation||!host.isConnected)return;const names=new Set();for(const t of templates){if(names.has(t.name))continue;names.add(t.name);const card=E('article',undefined,'wf-activity');card.append(E('strong',t.name),E('small','Versão '+t.version+' · '+t.definition.steps.length+' etapas'),button('Ajustar modelo',()=>editTemplate(t)));host.append(card);}}catch(e){host.append(E('p',fail(e),'wf-error'));}
 }
 function editTemplate(source){
  const q=dialog(source?'Ajustar modelo':'Criar modelo');q.d.classList.add('wf-model-dialog');const name=input('text',source?.name||'');name.required=true;name.maxLength=160;q.add(label('Nome do processo',name));
  const list=E('div');q.add(list);let steps=structuredClone(source?.definition?.steps||[]);const sectors=['Fiscal','Departamento Pessoal','Contábil','Atendimento','Geral'];
  const readAll=()=>{list.querySelectorAll('[data-step]').forEach((card,i)=>card.dispatchEvent(new Event('wf-read')));};
  const draw=()=>{list.replaceChildren();steps.forEach((s,i)=>{
   const card=fold((i+1)+'. '+shortSector(s.sector)+' · '+s.name,'wf-model-step');card.dataset.step=s.key;card.open=i===0;
   const title=input('text',s.name),sec=select(sectors.map(x=>[x,x]),s.sector),days=input('number',s.days??1),offset=input('number',s.legalOffset??0);days.min=0;days.max=365;offset.min=0;offset.max=365;title.required=true;
   const assignee=select([['','Qualquer integrante do setor'],...(window.conectaUsers||window.conectaDirectory||[]).filter(p=>p.active!==false).map(p=>[p.id,p.name])],s.assignee||'');
   card.append(label('O que precisa ser feito?',title),label('Qual setor faz esta etapa?',sec),label('Quantos dias para entregar?',days));const advanced=fold('Ajustes avançados desta etapa');advanced.append(label('Responsável preferencial (opcional)',assignee),label('Dias de antecedência ao prazo final',offset));
   const depBox=E('div');depBox.append(E('strong','Depende de (marque todas as obrigatórias)'));const deps=new Map();for(const prev of steps.slice(0,i)){
    const c=input('checkbox');c.checked=s.dependencies.includes(prev.key);deps.set(prev.key,c);depBox.append(label(prev.name,c));
   }advanced.append(depBox);
   const cond=input('text',s.condition?.field||''),equals=input('text',s.condition?.equals==null?'':String(s.condition.equals));cond.placeholder='Ex.: exige_fator_r';advanced.append(label('Condição opcional: campo do cliente',cond),label('Executar apenas quando o campo for igual a',equals));
   const notices=E('div');notices.append(E('strong','Notificações da etapa'));const checks=new Map();for(const [kind,title] of [['received','Nova atividade'],['correction','Correção'],['information','Solicitação de informação'],['due','Prazo próximo'],['overdue','Atraso'],['blocked','Impedimento']]){const c=input('checkbox');c.checked=!s.notifications||s.notifications.includes(kind);checks.set(kind,c);notices.append(label(title,c));}advanced.append(notices);
   const fields=E('div');card.append(E('h4','Formulário e critérios de conclusão'),fields);const fieldReaders=[];
   s.fields.forEach((f,j)=>{
    const row=E('div',undefined,'wf-model-field'),key=input('text',f.key),text=input('text',f.label),type=select([['text','Texto'],['textarea','Texto longo'],['number','Número'],['date','Data'],['check','Conferência / checklist'],['document','Documento']],f.type),required=input('checkbox');required.checked=f.required;key.pattern='[a-z][a-z0-9_]{0,49}';key.required=true;text.required=true;
    const fieldAdvanced=fold('Identificador do campo');fieldAdvanced.append(label('Identificador',key));row.append(label('O que informar?',text),label('Tipo de informação',type),label('Obrigatório para concluir',required),fieldAdvanced,button('Remover campo',()=>{readAll();s.fields.splice(j,1);draw();}));fields.append(row);
    fieldReaders.push(()=>({key:key.value,label:text.value,type:type.value,required:required.checked}));
   });
   card.addEventListener('wf-read',()=>{Object.assign(s,{name:title.value,sector:sec.value,assignee:assignee.value||null,days:Number(days.value),legalOffset:Number(offset.value),dependencies:[...deps].filter(([k,c])=>c.checked).map(([k])=>k),fields:fieldReaders.map(fn=>fn()),notifications:[...checks].filter(([k,c])=>c.checked).map(([k])=>k)});if(cond.value.trim())s.condition={field:cond.value.trim(),equals:s.condition&&String(s.condition.equals)===equals.value?s.condition.equals:equals.value};else delete s.condition;});
   const move=delta=>{readAll();const at=i+delta;if(at<0||at>=steps.length)return;const copy=steps.slice();[copy[i],copy[at]]=[copy[at],copy[i]];const seen=new Set();for(const item of copy){if(item.dependencies.some(k=>!seen.has(k))){q.error.textContent='A ordem deve respeitar as dependências. Ajuste-as antes de mover.';return;}seen.add(item.key);}steps=copy;q.error.textContent='';draw();};
   if(i>0)card.append(button('Mover acima',()=>move(-1)));if(i<steps.length-1)card.append(button('Mover abaixo',()=>move(1)));
   card.append(advanced);card.append(button('Adicionar campo',()=>{readAll();s.fields.push({key:'campo_'+(s.fields.length+1)+'_'+Date.now().toString(36),label:'Novo campo',type:'text',required:true});draw();}),button('Remover etapa',()=>{readAll();if(steps.some(x=>x.dependencies.includes(s.key))){q.error.textContent='Remova primeiro as dependências desta etapa.';return;}steps.splice(i,1);draw();}));list.append(card);
  });};draw();
  q.add(button('Adicionar etapa',()=>{readAll();steps.push({key:'etapa_'+crypto.randomUUID().replaceAll('-','').slice(0,8),name:'Nova etapa',sector:'Fiscal',days:1,legalOffset:0,dependencies:steps.length?[steps.at(-1).key]:[],fields:[]});draw();}));
  q.submit.textContent='Salvar modelo';q.form.onsubmit=async e=>{e.preventDefault();readAll();q.busy(true);
   try{const current=await api().templates();const expected=Math.max(0,...current.filter(x=>x.name===name.value.trim()).map(x=>x.version));
    if(source?.version&&source.name===name.value.trim()&&expected!==source.version)throw Error('Este modelo ganhou uma nova versão. Abra a versão atual.');
    await api().command('template',{name:name.value,definition:{steps},expected_version:source?.version&&source.name===name.value.trim()?source.version:expected});q.d.close();render();toast('Nova versão do modelo salva.');
   }catch(err){q.error.textContent=fail(err);}finally{q.busy(false);}
  };
 }
 async function renderSeries(host){
  host.append(E('h3','Repetições automáticas'));
  host.append(E('p','Crie automaticamente o mesmo processo nas próximas competências. Você pode pausar a repetição a qualquer momento.'),button('Nova recorrência',async()=>{
   const q=dialog('Nova recorrência');try{const models=await api().templates();const model=select(models.map(t=>[t.id,t.name+' · v'+t.version]));const company=input('text'),period=input('month'),run=input('date'),months=input('number',1),legal=input('number');company.required=true;period.required=true;run.required=true;months.min=1;months.max=12;legal.min=1;legal.max=31;
    q.add(label('Tipo de processo',model));q.add(label('Empresa',company));q.add(label('Primeira competência',period));q.add(label('Primeira abertura em',run));q.add(label('Repetir a cada N meses',months));q.add(label('Dia do prazo legal na competência (opcional)',legal));
    const ctx=E('div');q.add(ctx);const inputs=new Map();model.onchange=()=>{ctx.replaceChildren();inputs.clear();for(const s of models.find(t=>t.id===model.value)?.definition.steps||[]){if(!s.condition||inputs.has(s.condition.field))continue;const c=input('text');ctx.append(label('Condição: '+s.condition.field,c));inputs.set(s.condition.field,c);}};model.onchange();
    const command_id=crypto.randomUUID();q.form.onsubmit=async e=>{e.preventDefault();q.busy(true);try{await api().command('series',{command_id,template_id:model.value,company:company.value,period:period.value+'-01',next_run:run.value,interval_months:Number(months.value),legal_day:legal.value,context:Object.fromEntries([...inputs].map(([k,c])=>[k,c.value]))});q.d.close();render();}catch(err){q.error.textContent=fail(err);}finally{q.busy(false);}};
   }catch(e){q.error.textContent=fail(e);}
  }));
  try{const rows=await api().series();if(!host.isConnected)return;for(const r of rows){const card=E('article',undefined,'wf-activity');if(r.last_error)card.append(E('p','Falha na última abertura: '+r.last_error,'wf-error'));card.append(E('strong',r.company),E('p',`A cada ${r.interval_months} mês(es) · Próxima: ${r.next_run} · ${r.active?'Ativa':'Pausada'}`),button(r.active?'Pausar':'Ativar',async()=>{try{await api().command('series',{id:r.id,active:!r.active});render();}catch(e){toast(fail(e));}}));host.append(card);}}catch(e){host.append(E('p',fail(e),'wf-error'));}
 }
 function reset(){listQuery='';listFilter='open';nav.textContent='⇄  Fluxo de Processos';generation++;unsubscribe?.();unsubscribe=null;clearTimeout(refreshTimer);currentDialog?.close();drafts.clear();state={processes:[],steps:[],activities:[],notifications:[],reads:[],overview:null};detail=null;detailId=null;dirty=false;seen.clear();notificationBaseline=false;error='';lastRefresh=0;page=0;document.getElementById('wfDashboard')?.remove();document.querySelectorAll('.wf-shared-reminders').forEach(e=>e.remove());if(visible())panel().replaceChildren(E('p','Entre novamente para consultar os processos.'));}
 function start(){reset();if(!user()||!profile()?.active)return;unsubscribe=api()?.subscribe(sector(),()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(true),300);});refresh(true);}
 window.addEventListener('conecta-profile-ready',start);window.addEventListener('conecta-auth-session-reset',reset);
 window.addEventListener('focus',()=>{if(Date.now()-lastRefresh>60000)refresh();});window.addEventListener('online',()=>refresh(true));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>60000)refresh();});
 setInterval(()=>{if(!document.hidden)refresh();},300000);
 const baseForShared=renderView;renderView=window.renderView=view=>{baseForShared(view);if(view==='Lembretes')paintShared();};
 window.conectaOpenProcess=open;
})();
