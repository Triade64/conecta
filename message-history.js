(function(root){
  const fields='id,conversation_id,text,author_id,author_name,created_at,reply_to,edited_at,deleted_at,attachment_path,attachment_url,attachment_name,attachment_mime,attachment_size';
  const compare=(a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id);
  function createHistory({db,conversationId,userId,isCurrent,emit,pageSize=50}){
    const rows=new Map(),parents=new Map();let hidden=new Set(),cursor=null,hasMore=false,loading=false,context=false;
    let serial=Promise.resolve();
    const query=()=>db.from('messages').select(fields).eq('conversation_id',conversationId);
    const ordered=q=>q.order('created_at',{ascending:false}).order('id',{ascending:false});
    const check=result=>{if(result.error)throw result.error;return result.data||[];};
    const snapshot=()=>[...rows.values()].filter(r=>!hidden.has(r.id)).sort(compare);
    const state=()=>({conversationId,hasMore,loading,context});
    const publish=async()=>{
      if(!isCurrent())return;
      const missing=[...new Set(snapshot().filter(r=>!r.deleted_at).map(r=>r.reply_to).filter(id=>id&&!rows.has(id)&&!parents.has(id)))];
      if(missing.length){const data=check(await query().in('id',missing));if(!isCurrent())return;for(const row of data)parents.set(row.id,row);}
      if(isCurrent())await emit(snapshot(),state());
    };
    const enqueue=task=>{const next=serial.then(async()=>{if(isCurrent())return task();});serial=next.catch(()=>{});return next;};
    const hide=async()=>{const data=check(await db.from('message_hidden_for').select('message_id').eq('user_id',userId));if(isCurrent())hidden=new Set(data.map(r=>r.message_id));};
    const recent=async(reset=false)=>{
      const data=check(await ordered(query()).limit(pageSize+1));if(!isCurrent())return;
      const page=data.slice(0,pageSize);
      if(reset||!page.length){rows.clear();parents.clear();context=false;cursor=page.at(-1)||null;hasMore=data.length>pageSize;}
      else if(!cursor){cursor=page.at(-1)||null;hasMore=data.length>pageSize;}
      if(page.length){const ids=new Set(page.map(r=>r.id)),oldest=page.at(-1);for(const [id,row]of rows)if(compare(row,oldest)>=0&&!ids.has(id))rows.delete(id);}
      for(const row of page)rows.set(row.id,row);
    };
    return {
      state, snapshot,
      parent:id=>hidden.has(id)?null:(rows.get(id)||parents.get(id)),
      start:()=>enqueue(async()=>{await Promise.all([recent(true),hide()]);await publish();}),
      publish:()=>enqueue(publish),
      refresh:()=>enqueue(async()=>{if(!context)await recent();await hide();await publish();}),
      latest:()=>enqueue(async()=>{await recent(true);await hide();await publish();}),
      older:()=>enqueue(async()=>{
        if(!hasMore||!cursor)return;
        loading=true;
        try{
          const filter=`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
          const data=check(await ordered(query().or(filter)).limit(pageSize+1));if(!isCurrent())return;
          const page=data.slice(0,pageSize);hasMore=data.length>pageSize;cursor=page.at(-1)||cursor;
          for(const row of page)rows.set(row.id,row);loading=false;await publish();
        }finally{loading=false;}
      }),
      hiddenChanged:()=>enqueue(async()=>{await hide();await publish();}),
      changes:payloads=>enqueue(async()=>{
        const ids=new Set();
        for(const p of payloads){const id=p.new?.id||p.old?.id;if(!id)continue;
          if(p.eventType==='DELETE'){rows.delete(id);parents.delete(id);continue;}
          if(p.eventType==='INSERT'||rows.has(id)||parents.has(id))ids.add(id);
        }
        if(ids.size){const data=check(await query().in('id',[...ids]));if(!isCurrent())return;
          const returned=new Set(data.map(r=>r.id));for(const id of ids)if(!returned.has(id)){rows.delete(id);parents.delete(id);}
          for(const row of data){if(parents.has(row.id))parents.set(row.id,row);
            if(!context||rows.has(row.id))rows.set(row.id,row);}
        }
        await publish();
      }),
      recover:()=>enqueue(async()=>{
        // Reconcile only the window already loaded, including offline edits/deletes.
        const ids=[...new Set([...rows.keys(),...parents.keys()])];
        for(let i=0;i<ids.length;i+=pageSize){const batch=ids.slice(i,i+pageSize),data=check(await query().in('id',batch));if(!isCurrent())return;
          const returned=new Map(data.map(r=>[r.id,r]));for(const id of batch){if(rows.has(id)){if(returned.has(id))rows.set(id,returned.get(id));else rows.delete(id);}if(parents.has(id)){if(returned.has(id))parents.set(id,returned.get(id));else parents.delete(id);}}
        }
        if(!context)await recent();await hide();await publish();
      }),
      reveal:id=>enqueue(async()=>{
        if(rows.has(id)){await publish();return true;}
        const result=await query().eq('id',id).maybeSingle();if(result.error)throw result.error;
        const target=result.data;if(!target||target.deleted_at||hidden.has(id))return false;
        const filter=`created_at.lt.${target.created_at},and(created_at.eq.${target.created_at},id.lte.${target.id})`;
        const before=check(await ordered(query().or(filter)).limit(pageSize+1));if(!isCurrent())return false;
        rows.clear();parents.clear();for(const row of before.slice(0,pageSize))rows.set(row.id,row);rows.set(id,target);
        cursor=[...rows.values()].sort(compare)[0];hasMore=before.length>pageSize;context=true;
        await publish();return true;
      })
    };
  }
  const api={createHistory,fields};if(typeof module==='object'&&module.exports)module.exports=api;else root.conectaMessageHistory=api;
})(globalThis);
