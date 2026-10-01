const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const api=require('../chat-attachments.js');
test('office and image types use canonical MIME regardless of Windows file MIME',()=>{
 for(const [name,mime] of [['FOTO.JPG','image/jpeg'],['planilha.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['recibo.pdf','application/pdf']])assert.equal(api.validate({name,size:1024,type:''}).mime,mime);
});
test('empty, oversized, executable and active markup files are rejected',()=>{
 for(const file of [{name:'a.pdf',size:0},{name:'a.png',size:api.maxSize+1},{name:'arquivo.exe',size:10},{name:'x.html',size:10},{name:'x.svg',size:10}])assert.throws(()=>api.validate(file));
 assert.equal(api.validate({name:'limite.zip',size:api.maxSize}).size,api.maxSize);
});
test('upload binds the object to author and conversation, with private storage and validated MIME',async()=>{
 const source=fs.readFileSync(require.resolve('../supabase-app.js'),'utf8'),code=source.slice(source.indexOf('  uploadChatFile:'),source.indexOf('  changePassword:'));
 const calls=[];const storage={upload:async(...args)=>{calls.push(args);return {error:null};},remove:async paths=>{calls.push(paths);return {error:null};}};
 const ctx={window:{conectaAttachments:api},crypto:{randomUUID:()=> 'random-id'},supabase:{storage:{from:bucket=>{assert.equal(bucket,'chat-files');return storage;}}}};
 const object=vm.runInNewContext('({'+code+'})',ctx),result=await object.uploadChatFile({id:'author'},'conversation',{name:'Comprovante.pdf',size:1024});
 assert.equal(result.path,'file:author/conversation/random-id.pdf');assert.equal(result.info.name,'Comprovante.pdf');assert.equal(calls[0][2].contentType,'application/pdf');assert.equal(calls[0][2].upsert,false);
 await assert.rejects(object.uploadChatFile({id:'author'},'conversation',{name:'x.exe',size:10}));assert.equal(calls.length,1);
 await object.removePendingChatFile(result.path);assert.equal(calls[1][0],'author/conversation/random-id.pdf');
});
test('file-only sends include metadata; existing text and GIF call signatures still work',async()=>{
 const source=fs.readFileSync(require.resolve('../supabase-app.js'),'utf8'),start=source.indexOf('  sendMessage: async'),end=source.indexOf('\n};',start),inserts=[],updates=[];
 const ctx={supabase:{from:table=>table==='messages'?{insert:async row=>{inserts.push(row);return {error:null};}}:{update:row=>{updates.push(row);return {eq:async()=>({error:null})};}}},console};
 const object=vm.runInNewContext('({'+source.slice(start,end)+'})',ctx);
 await object.sendMessage({id:'author'},'conversation','',null,'file:author/conversation/file.pdf',null,{name:'arquivo.pdf',mime:'application/pdf',size:1024});
 assert.equal(inserts[0].attachment_name,'arquivo.pdf');assert.equal(inserts[0].attachment_size,1024);assert.equal(updates[0].last_message,'📎 arquivo.pdf');
 await object.sendMessage({id:'author'},'conversation','Olá');assert.equal(inserts[1].text,'Olá');assert(!('attachment_name' in inserts[1]));
 await object.sendMessage({id:'author'},'conversation','',null,'giphy:123');assert.equal(updates[2].last_message,'GIF');
});
