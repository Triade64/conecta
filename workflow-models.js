(function(root){
 const field=(key,label,type='text',required=true)=>({key,label,type,required});
 const step=(key,name,sector,dependencies,fields,days=1)=>({key,name,sector,dependencies,fields,days,legalOffset:0,assignee:null});
 const factorR={name:'Apuração mensal — Empresa sujeita à análise do Fator R',definition:{steps:[
  step('fiscal_inicial','Orientações e informações iniciais','Fiscal',[],[
   field('orientacoes','Orientações para processamento e premissas validadas','textarea'),
   field('pro_labore_previsto','Pró-labore previsto (orientação inicial)','number',false),
   field('conferencia','Informações iniciais conferidas','check')]),
  step('dp_folha','Processar e conferir a folha','Departamento Pessoal',['fiscal_inicial'],[
   field('folha_efetiva','Valores efetivos da folha e encargos considerados','textarea'),
   field('pro_labore_efetivo','Pró-labore efetivamente processado','number'),
   field('demonstrativo_folha','Demonstrativo da folha','document'),field('conferencia','Folha conferida','check')],2),
  step('fiscal_apuracao','Analisar Fator R e apurar Simples Nacional','Fiscal',['dp_folha'],[
   field('periodo_calculo','Período considerado no cálculo (conforme regras aplicáveis)'),
   field('folha_considerada','Folha e encargos considerados no período','number'),
   field('receita_considerada','Receita bruta considerada no período','number'),
   field('memoria_calculo','Memória de cálculo, fontes e validações aplicáveis','textarea'),
   field('demonstrativo','Demonstrativo da apuração','document'),
   field('conferencia','Período, folha e receita conferidos para a apuração definitiva','check')],2),
  step('contabil_fechamento','Contabilização, conciliações e fechamento','Contábil',['fiscal_apuracao'],[
   field('movimentos','Movimentos recebidos e verificações do fechamento','textarea'),
   field('conferencia','Contabilização e conciliações conferidas','check'),
   field('demonstrativos','Demonstrativos contábeis','document',false)],3)
 ]}};
 const api={factorR,status:{waiting:'Aguardando dependência',ready:'Disponível',active:'Em execução',blocked:'Impedida',correction:'Em correção',completed:'Concluída',skipped:'Dispensada'},
  sector:p=>({fiscal:'Fiscal',contabil:'Contábil',pessoal:'Departamento Pessoal'}[p?.role]||p?.sector),
  impact(steps,key){const found=new Set([key]);let changed=true;while(changed){changed=false;for(const s of steps)if(!found.has(s.key)&&s.definition.dependencies.some(k=>found.has(k))){found.add(s.key);changed=true;}}found.delete(key);return steps.filter(s=>found.has(s.key));},
  metrics(processes,steps,events,now=Date.now()){
   const open=steps.filter(s=>['ready','active','correction','blocked'].includes(s.status));
   const bySector={};for(const s of open)bySector[s.sector]=(bySector[s.sector]||new Set()).add(s.process_id);
   const timely=processes.filter(p=>p.completed_at&&p.legal_due_at&&Date.parse(p.completed_at)<=Date.parse(p.legal_due_at)).length;
   const completions=events.filter(e=>e.action==='complete');const transfers=[];
   for(const s of steps.filter(s=>s.started_at&&s.available_at&&s.definition.dependencies.length)){
    // Only actual intersector handoffs, measured from release to acceptance.
    if(s.definition.dependencies.some(k=>steps.some(p=>p.process_id===s.process_id&&p.key===k&&p.sector!==s.sector)))
     transfers.push(Math.max(0,Date.parse(s.started_at)-Date.parse(s.available_at)));
   }
   return {bySector:Object.fromEntries(Object.entries(bySector).map(([k,v])=>[k,v.size])),corrections:new Set(open.filter(s=>s.status==='correction').map(s=>s.process_id)).size,
    timely,completed:processes.filter(p=>p.completed_at).length,transferHours:transfers.length?transfers.reduce((a,b)=>a+b,0)/transfers.length/3600000:null,
    overdue:open.filter(s=>s.due_at&&Date.parse(s.due_at)<now).length};
  }};
 if(typeof module==='object')module.exports=api;else root.conectaWorkflowModels=api;
})(typeof window==='object'?window:globalThis);
