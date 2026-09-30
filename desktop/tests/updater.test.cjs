const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../updater.cjs');
function setup({ available = true, answers = [0,0], fail = false, packaged = true } = {}) {
  const calls=[],dialogs=[],app=new EventEmitter();app.isPackaged=packaged;app.getVersion=()=> '0.1.2';
  const autoUpdater=new EventEmitter();
  autoUpdater.checkForUpdates=async()=>{calls.push('check');if(fail){autoUpdater.emit('error',Error('offline'));throw Error('offline');}if(available)autoUpdater.emit('update-available',{version:'0.1.3'});};
  autoUpdater.downloadUpdate=async()=>{calls.push('download');autoUpdater.emit('update-downloaded');};
  autoUpdater.quitAndInstall=(silent,restart)=>calls.push(['install',silent,restart]);
  const dialog={showMessageBox:async options=>{dialogs.push(options);return {response:answers.shift() ?? 1};}};
  const updates=createUpdater({app,autoUpdater,dialog,getWindow:()=>null,prepareQuit:()=>calls.push('prepareQuit')});
  return {calls,dialogs,autoUpdater,updates};
}
test('accepted update downloads then enables quitting before restarting installer',async()=>{
  const s=setup();try{await s.updates.check();assert.deepEqual(s.calls,['check','download','prepareQuit',['install',false,true]]);assert.equal(s.autoUpdater.autoDownload,false);assert.equal(s.autoUpdater.autoInstallOnAppQuit,false);}finally{s.updates.dispose();}
});
test('declining download keeps current app and never invokes installer',async()=>{const s=setup({answers:[1]});try{await s.updates.check();assert.deepEqual(s.calls,['check']);}finally{s.updates.dispose();}});
test('deferred restart can be installed later without downloading again',async()=>{const s=setup({answers:[0,1,0]});try{await s.updates.check();assert.deepEqual(s.calls,['check','download']);await s.updates.check();assert.deepEqual(s.calls,['check','download','prepareQuit',['install',false,true]]);}finally{s.updates.dispose();}});
test('no update stays quiet in background and gives manual confirmation',async()=>{const s=setup({available:false});try{await s.updates.check(false);assert.equal(s.dialogs.length,0);await s.updates.check();assert.equal(s.dialogs.length,1);assert(s.dialogs[0].message.includes('0.1.2'));}finally{s.updates.dispose();}});
test('network failure shows one error and never starts installation',async()=>{const s=setup({fail:true});try{await s.updates.check();assert.equal(s.dialogs.length,1);assert.equal(s.dialogs[0].type,'error');assert.deepEqual(s.calls,['check']);}finally{s.updates.dispose();}});
test('concurrent checks do not duplicate download or restart',async()=>{const s=setup({answers:[1]});let resolve;s.autoUpdater.checkForUpdates=()=>{s.calls.push('check');return new Promise(r=>resolve=r);};try{const first=s.updates.check();await s.updates.check();assert.deepEqual(s.calls,['check']);assert(s.dialogs[0].message.includes('andamento'));resolve();await first;}finally{s.updates.dispose();}});
