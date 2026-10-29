(function(root){
  // Coalesce bursts and serialize refreshes. Events arriving during a request
  // remain pending and are processed before any waiter is resolved.
  function createQueue(run, delay=150){
    let pending=new Set(),timer=null,running=false,stopped=false,waiters=[];
    const drain=async()=>{
      if(running||stopped)return;
      clearTimeout(timer);timer=null;running=true;
      try{while(pending.size&&!stopped){const keys=[...pending];pending.clear();await run(keys);}
        const list=waiters;waiters=[];list.forEach(w=>w.resolve());
      }catch(error){const list=waiters;waiters=[];list.forEach(w=>w.reject(error));}
      finally{running=false;if(pending.size&&!stopped)timer=setTimeout(drain,delay);}
    };
    return {
      request(keys,immediate=false){if(stopped)return Promise.resolve();keys.forEach(k=>pending.add(k));const promise=new Promise((resolve,reject)=>waiters.push({resolve,reject}));if(immediate)void drain();else if(!running&&!timer)timer=setTimeout(drain,delay);return promise;},
      stop(){stopped=true;clearTimeout(timer);pending.clear();waiters.splice(0).forEach(w=>w.resolve());}
    };
  }
  function createUrlCache(now=()=>Date.now()){
    const values=new Map();let epoch=0;
    return {
      async get(key,ttl,load){const time=now(),cached=values.get(key);if(cached&&cached.until>time)return cached.promise;
        const token=epoch;const entry={until:time+ttl,promise:null};
        entry.promise=Promise.resolve().then(load).then(value=>{if(!value&&values.get(key)===entry)values.delete(key);return value;},error=>{if(values.get(key)===entry)values.delete(key);throw error;});
        if(token===epoch){values.set(key,entry);if(values.size>1000)values.delete(values.keys().next().value);}return entry.promise;},
      delete(key){values.delete(key);},clear(){epoch++;values.clear();}
    };
  }
  const api={createQueue,createUrlCache};if(typeof module==='object'&&module.exports)module.exports=api;else root.conectaSync=api;
})(globalThis);
