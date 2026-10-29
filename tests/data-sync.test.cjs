const{test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../supabase-app.js'),'utf8').replace(/^import[^\n]+\n/,'');
function setup(){const calls=[],events=[],channels=[],intervals=[];const profile={id:'me',name:'Me',role:'admin',active:true};let paused=null;
 const tables={profiles:[profile],notices:[],reminders:[],conversations:[{id:'conv',kind:'channel',name:'Geral'}],global_announcements:[],profile_photos:[],team_status:[],message_favorites:[],kitchen_calendar:[{id:true,config:{},version:1}],message_hidden_for:[]};
 const db={auth:{onAuthStateChange(){}},from(table){let filters=[];return {select(){return this},eq(k,v){filters.push([k,v]);return this},order(){return this},then(resolve,reject){return run().then(resolve,reject)},async maybeSingle(){const r=await run();return {...r,data:r.data?.[0]||null}}};async function run(){calls.push(table);if(paused&&table===paused.table)await paused.gate;return {data:tables[table].filter(r=>filters.every(([k,v])=>r[k]===v))};}},async rpc(name){calls.push(name);return {data:name==='list_team_directory'?[profile]:[]}},channel(name){const c={name,handlers:[],on(type,filter,fn){this.handlers.push({type,filter,fn});return this},subscribe(fn){this.subscribed=fn;return this},presenceState:()=>({}),track:async()=>'ok'};channels.push(c);return c},removeChannel:async()=>{}};
 const win={conectaConfig:{},conectaCurrentUser:{id:'me'},conectaCurrentProfile:profile,conectaSync:require('../sync-utils.js'),conectaMessageHistory:require('../message-history.js'),dispatchEvent:event=>events.push(event),addEventListener(){},removeEventListener(){},setInterval(fn,ms){intervals.push({fn,ms});return intervals.length},clearInterval(){}};
 const ctx={window:win,document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},createClient:()=>db,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},console,Map,Set,Date,Promise,setTimeout,clearTimeout,URLSearchParams};vm.createContext(ctx);vm.runInContext(source,ctx);
 return{ctx,calls,events,channels,intervals,tables,load:groups=>ctx.loadData({id:'me'},groups),pause(table){let release;paused={table,gate:new Promise(r=>release=r)};return()=>{release();paused=null}},stop:()=>vm.runInContext('stopDataSync();dataQueue?.stop();',ctx)};
}
test('message bursts refresh conversations and counters without reloading unrelated data',async()=>{
 const t=setup();t.ctx.startDataSync({id:'me'});await t.load([]);t.calls.length=0;
 const live=t.channels.find(c=>c.name==='conecta-live');
 for(let i=0;i<12;i++)for(const h of live.handlers)if(['conversations','messages'].includes(h.filter.table))h.fn({eventType:'UPDATE',new:{id:'msg'}});
 await t.load([]);assert.deepEqual(t.calls.sort(),['conversations','get_unread_counts']);t.stop();
});
test('minute scheduler evaluates announcements locally; fallback network refresh is five minutes',async()=>{
 const t=setup();t.ctx.startDataSync({id:'me'});await t.load([]);t.calls.length=0;await t.intervals.find(i=>i.ms===60000).fn();await t.load([]);assert.equal(t.calls.length,0);assert(t.intervals.some(i=>i.ms===300000));t.stop();
});
test('status events do not reload favorites or the calendar',async()=>{
 const t=setup();t.ctx.startDataSync({id:'me'});await t.load([]);t.calls.length=0;
 t.channels[0].handlers.find(h=>h.filter.table==='team_status').fn({new:{}});await t.load([]);assert.deepEqual(t.calls,['team_status']);t.stop();
});
test('data returned after an account switch is never dispatched',async()=>{
 const t=setup();await t.load();t.events.length=0;const release=t.pause('notices');const pending=t.load(['notices']);t.ctx.window.conectaCurrentUser={id:'another'};release();await pending;assert.equal(t.events.length,0);t.stop();
});
test('non-admin full refresh skips the administrative profiles directory',async()=>{
 const t=setup();t.tables.profiles[0].role='fiscal';await t.load();assert.equal(t.calls.filter(name=>name==='profiles').length,1);t.stop();
});
test('regular users detect newly scheduled announcements with a metadata check, not a full refresh',async()=>{
 const t=setup();t.tables.profiles[0].role='fiscal';t.ctx.startDataSync({id:'me'});await t.load([]);t.calls.length=0;
 t.tables.global_announcements.push({id:'scheduled',title:'Aviso',body:'Texto',is_active:true,starts_at:new Date(Date.now()-1000).toISOString(),updated_at:'new'});
 await t.intervals.find(i=>i.ms===60000).fn();await t.load([]);
 assert.deepEqual(t.calls,['global_announcements','global_announcements']);assert(t.events.some(e=>e.type==='conecta-global-announcement-sync'&&e.detail.some(row=>row.id==='scheduled')));t.stop();
});
