const{test}=require('node:test'),assert=require('node:assert/strict');const{createQueue,createUrlCache}=require('../sync-utils.js');
test('burst refreshes merge; an event during a request runs before waiters finish',async()=>{
 const calls=[];let release;const gate=new Promise(r=>release=r);
 const queue=createQueue(async keys=>{calls.push(keys.sort());if(calls.length===1)await gate;},1);
 const first=queue.request(['conversations']);const same=queue.request(['unread']);await new Promise(r=>setTimeout(r,5));
 const during=queue.request(['favorites']);release();await Promise.all([first,same,during]);
 assert.deepEqual(calls,[['conversations','unread'],['favorites']]);queue.stop();
});
test('failed refresh remains recoverable and stop settles pending requests',async()=>{
 let fail=true;const queue=createQueue(async()=>{if(fail)throw Error('offline');},1);
 await assert.rejects(queue.request(['one'],true));fail=false;await queue.request(['two'],true);const pending=queue.request(['three']);queue.stop();await pending;
});
test('URL cache deduplicates pending calls, expires, isolates accounts and never caches failures',async()=>{
 let now=0,calls=0;const cache=createUrlCache(()=>now),load=async()=>{calls++;return 'signed-'+calls;};
 const [a,b]=await Promise.all([cache.get('user-a/file',10,load),cache.get('user-a/file',10,load)]);assert.equal(a,b);assert.equal(calls,1);
 await cache.get('user-b/file',10,load);assert.equal(calls,2);now=11;await cache.get('user-a/file',10,load);assert.equal(calls,3);
 cache.clear();await cache.get('user-a/file',10,load);assert.equal(calls,4);
 await assert.rejects(cache.get('failed',10,async()=>{throw Error('denied')}));assert.equal(await cache.get('failed',10,async()=>'retry'),'retry');
});
