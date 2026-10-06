const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../supabase-app.js'),'utf8');
const fn=source.slice(source.indexOf('async function dispatchIncomingMessageNotification'),source.indexOf('function startDataSync'));
async function check({conversation,conversationError=null,author='sender',text='Mensagem',account='admin',session='admin',deleted=false}){
 const events=[];
 const supabase={from(table){return {select(){return this},eq(){return this},async maybeSingle(){return table==='messages'?{data:{id:'msg',conversation_id:'conv',author_id:author,text,deleted_at:deleted?'date':null}}:{data:conversation,error:conversationError}}}},rpc:async()=>({data:[{id:author,name:'Remetente'}]})};
 const ctx={supabase,window:{conectaCurrentUser:{id:session}},dispatch:(name,detail)=>events.push({name,detail})};vm.createContext(ctx);vm.runInContext(fn,ctx);
 await ctx.dispatchIncomingMessageNotification({new:{id:'msg',author_id:author}},{id:account});return events;
}
test('admin does not receive another pair’s private message or nudge',async()=>{
 for(const text of ['Mensagem','🔔 Chamou sua atenção!'])assert.equal((await check({conversation:{kind:'direct',created_by:'a',direct_recipient_id:'b'},text})).length,0);
});
test('both direct participants can receive messages from the other participant',async()=>{
 for(const account of ['a','b'])assert.equal((await check({conversation:{kind:'direct',created_by:'a',direct_recipient_id:'b'},account,session:account,author:account==='a'?'b':'a'})).length,1);
});
test('authorized channel notifications continue working',async()=>assert.equal((await check({conversation:{kind:'channel',name:'Geral'}})).length,1));
test('own and deleted messages do not notify',async()=>{
 assert.equal((await check({conversation:{kind:'direct',created_by:'admin'},author:'admin'})).length,0);
 assert.equal((await check({conversation:{kind:'direct',created_by:'admin'},deleted:true})).length,0);
});
test('missing, failed or unknown conversations fail closed',async()=>{
 for(const options of [{conversation:null},{conversation:{kind:'direct',created_by:'admin'},conversationError:{message:'network'}},{conversation:{kind:'unknown'}}])assert.equal((await check(options)).length,0);
});
test('a stale realtime callback cannot notify a different signed-in account',async()=>assert.equal((await check({conversation:{kind:'direct',created_by:'admin'},session:'other'})).length,0));
