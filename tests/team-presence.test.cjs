const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase-app.js'),'utf8');
const start=source.slice(source.indexOf('function startDataSync(user)'),source.indexOf('const watchMessages ='));
function setup(){
 const events=[],channels=[];
 const supabase={channel(name){const c={name,handlers:{},state:{},on(type,{event},cb){this.handlers[type+':'+event]=cb;return this},subscribe(cb){this.subscription=cb;return this},presenceState(){return this.state},track:async()=> 'ok'};channels.push(c);return c},removeChannel(){}};
 const context={supabase,window:{setInterval:()=>1,clearInterval(){}},loadData(){},dispatch:(name,detail)=>events.push({name,detail}),dispatchIncomingMessageNotification(){},console};
 vm.createContext(context);vm.runInContext('let stopDataSync=()=>{},stopMessageSync=()=>{},presenceChannel=null,messageWatchGeneration=0,activeMessageChannel=null;'+start+';globalThis.start=startDataSync;globalThis.stop=()=>stopDataSync();',context);context.start({id:'a'});
 return {events,context,channel:channels.find(c=>c.name==='conecta-presence')};
}
test('presence publishes one user per key across multiple app sessions',()=>{const s=setup();s.channel.state={a:[{userId:'a'},{userId:'a'}],b:[{userId:'b'}],empty:[]};s.channel.handlers['presence:sync']();const event=s.events.find(e=>e.name==='conecta-presence-sync');assert.deepEqual(JSON.parse(JSON.stringify(event.detail)),{userIds:['a','b'],ready:true});assert.equal(s.events.find(e=>e.name==='conecta-online-count-sync').detail,2);});
test('disconnect clears stale online state and marks status unavailable',async()=>{const s=setup();await s.channel.subscription('CHANNEL_ERROR');assert.deepEqual(JSON.parse(JSON.stringify(s.events.at(-1).detail)),{userIds:[],ready:false});});
test('stopped channels cannot publish stale presence after logout',()=>{const s=setup();s.context.stop();const count=s.events.length;s.channel.state={a:[{}]};s.channel.handlers['presence:sync']();assert.equal(s.events.length,count);assert.equal(s.events.at(-1).detail.ready,false);});
