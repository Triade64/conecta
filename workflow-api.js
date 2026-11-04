(function(root){
 function create(db,getUser){
  const checked=async query=>{const {data,error}=await query;if(error)throw error;return data;};
  const command=(op,args)=>{if(!getUser()?.id)throw Error('Entre novamente.');return checked(db.rpc('workflow_command',{op,args}));};
  return {
   command,
   templates:()=>checked(db.from('workflow_template_catalog').select('id,name,version,definition,created_at').order('name')),
   overview:()=>checked(db.rpc('workflow_overview')),
   processes:(page=0,sector='')=>{let q=db.from('workflow_processes').select('id,name,company,period,legal_due_at,completed_at,created_at,revision,sectors,member_ids,template_id').order('created_at',{ascending:false}).order('id',{ascending:false});if(sector)q=q.contains('sectors',[sector]);return checked(q.range(page*50,page*50+49));},
   activities:(sector,page=0)=>{let q=db.from('workflow_steps').select('*').in('status',['ready','active','blocked','correction']).order('due_at').order('id');if(sector)q=q.eq('sector',sector);return checked(q.range(page*100,page*100+99));},
   async steps(ids,summary=false){
    if(!ids.length)return [];const rows=[];
    for(let offset=0;;offset+=500){const page=await checked(db.from('workflow_steps').select(summary?'id,process_id,key,sector,status,due_at,available_at,completed_at,definition':'*').in('process_id',ids).order('id').range(offset,offset+499));rows.push(...page);if(page.length<500)return rows;}
   },
   process:id=>checked(db.from('workflow_processes').select('*').eq('id',id).single()),
   history:(id,before)=>{let q=db.from('workflow_events').select('*').eq('process_id',id).order('id',{ascending:false});if(before)q=q.lt('id',before);return checked(q.limit(50));},
   documents:id=>checked(db.from('workflow_documents').select('*').eq('process_id',id).order('created_at')),
   notifications:()=>checked(db.from('workflow_notifications').select('*').order('id',{ascending:false}).limit(100)),
   reads:()=>checked(db.from('workflow_notification_reads').select('notification_id').eq('user_id',getUser().id).order('read_at',{ascending:false}).limit(1000)),
   series:()=>checked(db.from('workflow_series').select('*').order('next_run')),
   async upload(process,step,field,file,commandId){
    if(!file||file.size<1||file.size>25*1024*1024)throw Error('Selecione um arquivo de até 25 MB.');
    const actor=getUser()?.id;if(!actor)throw Error('Sessão expirada.');
    const path=`${process.id}/${step.id}/${actor}/${crypto.randomUUID()}`;
    await checked(db.storage.from('workflow-files').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false}));
    // Do not delete on an ambiguous network failure: registration may have committed.
    // An abandoned upload is inaccessible until registration succeeds.
    return command('document',{process_id:process.id,step_id:step.id,revision:process.revision,
     command_id:commandId,path,name:file.name,size:file.size,field_key:field});
   },
   async download(doc){return checked(db.storage.from('workflow-files').createSignedUrl(doc.path,60,{download:doc.name}));},
   subscribe(sector,onChange){
    let channel=db.channel('workflow-'+getUser().id).on('postgres_changes',{event:'*',schema:'public',table:'workflow_processes'},onChange);
    const filter={event:'INSERT',schema:'public',table:'workflow_notifications'};if(sector)filter.filter='sector=eq.'+sector;
    channel=channel.on('postgres_changes',filter,onChange).subscribe();return()=>db.removeChannel(channel);
   }
  };
 }
 if(typeof module==='object')module.exports={create};else root.conectaWorkflowAPI={create};
})(typeof window==='object'?window:globalThis);
