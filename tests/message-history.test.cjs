const{test}=require('node:test'),assert=require('node:assert/strict');const{createHistory}=require('../message-history.js');
const id=n=>n.toString().padStart(8,'0')+'-0000-0000-0000-000000000000';
const row=(n,time)=>({id:id(n),created_at:time||new Date(Date.UTC(2026,9,1,0,0,n)).toISOString(),conversation_id:'conv',text:'Message '+n,author_id:'other'});
function setup(count=180){const store={messages:Array.from({length:count},(_,i)=>row(i+1)),hidden:[],denied:false,fail:false,current:true},calls=[],published=[];
 const db={from(table){let eq=[],ids,filter,max=Infinity,lte;return{select(){return this},eq(k,v){eq.push([k,v]);return this},order(){return this},limit(n){max=n;return this},in(k,v){ids=v;return this},or(v){filter=v;return this},lte(k,v){lte=[k,v];return this},then(resolve,reject){return run().then(resolve,reject)},async maybeSingle(){const result=await run();return {...result,data:result.data?.[0]||null}}};
 async function run(){calls.push({table,ids,filter,max});if(store.fail)return {error:Error('offline')};if(table==='message_hidden_for')return {data:store.hidden.map(message_id=>({message_id}))};let rows=store.denied?[]:store.messages.filter(r=>eq.every(([k,v])=>r[k]===v));if(ids)rows=rows.filter(r=>ids.includes(r.id));if(lte)rows=rows.filter(r=>r[lte[0]]<=lte[1]);if(filter){const match=filter.match(/created_at.lt.([^,]+),and\(created_at.eq.([^,]+),id.(lte?).([^\)]+)\)/);if(!match)throw Error(filter);rows=rows.filter(r=>r.created_at<match[1]||(r.created_at===match[2]&&(match[3]==='lte'?r.id<=match[4]:r.id<match[4])));}return {data:rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,max)};}
 }};
 const history=createHistory({db,conversationId:'conv',userId:'me',isCurrent:()=>store.current,emit:async(rows,state)=>published.push({rows,state})});return{history,store,calls,published};}
test('initial request transfers only a recent page and older pages have no duplicates',async()=>{
 const t=setup();await t.history.start();assert.equal(t.history.snapshot().length,50);assert.equal(t.history.snapshot()[0].id,id(131));assert.equal(t.calls.find(c=>c.table==='messages').max,51);
 await t.history.older();assert.equal(t.history.snapshot().length,100);assert.equal(t.history.snapshot()[0].id,id(81));assert.equal(new Set(t.history.snapshot().map(r=>r.id)).size,100);assert.equal(t.history.state().loading,false);
});
test('keyset cursor handles many identical timestamps',async()=>{
 const t=setup(120);t.store.messages.forEach(r=>r.created_at='2026-10-01T12:00:00.123456+00:00');await t.history.start();await t.history.older();await t.history.older();assert.equal(t.history.snapshot().length,120);assert.equal(t.history.state().hasMore,false);
});
test('inserts and edits fetch only changed IDs; deletes and hidden messages disappear',async()=>{
 const t=setup();await t.history.start();t.calls.length=0;t.store.messages.push(row(181));await t.history.changes([{eventType:'INSERT',new:{id:id(181)}}]);assert.deepEqual(t.calls[0].ids,[id(181)]);assert.equal(t.history.snapshot().at(-1).id,id(181));
 t.store.messages.find(r=>r.id===id(180)).text='edited';await t.history.changes([{eventType:'UPDATE',new:{id:id(180)}}]);assert.equal(t.history.snapshot().find(r=>r.id===id(180)).text,'edited');
 await t.history.changes([{eventType:'DELETE',old:{id:id(179)}}]);assert(!t.history.snapshot().some(r=>r.id===id(179)));
 t.store.hidden.push(id(178));await t.history.hiddenChanged();assert(!t.history.snapshot().some(r=>r.id===id(178)));
});
test('reconnection reconciles offline edits, hard deletes, inserts and access removal',async()=>{
 const t=setup();await t.history.start();t.store.messages.find(r=>r.id===id(170)).text='offline edit';t.store.messages=t.store.messages.filter(r=>r.id!==id(175));t.store.messages.push(row(181));await t.history.recover();assert.equal(t.history.snapshot().find(r=>r.id===id(170)).text,'offline edit');assert(!t.history.snapshot().some(r=>r.id===id(175)));assert.equal(t.history.snapshot().at(-1).id,id(181));
 t.store.denied=true;await t.history.recover();assert.equal(t.history.snapshot().length,0);
});
test('old favorite/search target loads a bounded context, with a return to recent messages',async()=>{
 const t=setup(1000);await t.history.start();assert(await t.history.reveal(id(100)));assert(t.history.state().context);assert(t.history.snapshot().some(r=>r.id===id(100)));assert(t.history.snapshot().length<=51);
 t.store.messages.push(row(1001));await t.history.changes([{eventType:'INSERT',new:{id:id(1001)}}]);assert(!t.history.snapshot().some(r=>r.id===id(1001)));await t.history.latest();assert.equal(t.history.snapshot().at(-1).id,id(1001));assert.equal(t.history.state().context,false);
});
test('reply parent outside page is available without loading all intermediate history',async()=>{
 const t=setup();t.store.messages.at(-1).reply_to=id(1);await t.history.start();assert.equal(t.history.parent(id(1)).text,'Message 1');assert.equal(t.history.snapshot().length,50);assert(t.calls.some(c=>c.ids?.includes(id(1))));
});
test('failed page does not lose current messages; stale account never publishes',async()=>{
 const t=setup();await t.history.start();t.store.fail=true;await assert.rejects(t.history.older());assert.equal(t.history.snapshot().length,50);assert.equal(t.history.state().loading,false);
 t.store.fail=false;t.store.current=false;const before=t.published.length;await t.history.recover();assert.equal(t.published.length,before);
});
module.exports={setup};
