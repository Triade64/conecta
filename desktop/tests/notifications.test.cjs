const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { notificationOptions, showNativeNotification } = require('../notifications.cjs');
function mock(outcome) {
  return class extends EventEmitter {
    static isSupported() { return outcome !== 'unsupported'; }
    constructor(options) { super(); this.options = options; }
    show() { if (outcome === 'throw') throw Error('Registration failed'); if (outcome === 'show') this.emit('show'); if (outcome === 'failed') this.emit('failed', {}, 'Windows rejected'); }
    close() { this.closed = true; }
  };
}
const payload = {title:'Nova mensagem',body:'Gabriel enviou uma mensagem.',tag:'message-123',silent:false};
test('notification payload restricts fields and rejects malformed values', () => {
  assert.deepEqual(notificationOptions({...payload,toastXml:'untrusted',icon:'file:///bad'}),{title:payload.title,body:payload.body,silent:false});
  for(const value of [null,{}, {...payload,title:'x'.repeat(121)}, {...payload,body:500}, {...payload,tag:''}, {...payload,silent:'false'}]) assert.equal(notificationOptions(value),null);
});
test('native notification confirms delivery, retains object and invokes click', async () => {
  const active=new Map();let clicks=0;const result=await showNativeNotification(mock('show'),notificationOptions(payload),()=>clicks++,active,payload.tag);
  assert.deepEqual(result,{ok:true});active.get(payload.tag).emit('click');assert.equal(clicks,1);assert.equal(active.get(payload.tag).options.silent,false);
});
test('failure and unsupported system return actionable errors', async () => {
  for(const outcome of ['unsupported','failed','throw']) {const active=new Map(),result=await showNativeNotification(mock(outcome),payload,()=>{},active,payload.tag);assert.equal(result.ok,false);assert(result.error);assert.equal(active.size,0);}
});
test('absence of OS confirmation times out instead of reporting success', async () => {
  let expire;const timers={setTimeout:callback=>{expire=callback;return 1;},clearTimeout(){}};
  const result=showNativeNotification(mock('silent'),payload,()=>{},new Map(),payload.tag,timers);expire();assert.equal((await result).ok,false);
});
test('same tag closes the old notification and keeps the replacement', async () => {
  const active=new Map(),Notification=mock('show');await showNativeNotification(Notification,payload,()=>{},active,payload.tag);const old=active.get(payload.tag);await showNativeNotification(Notification,payload,()=>{},active,payload.tag);assert(old.closed);assert.notEqual(active.get(payload.tag),old);
});
