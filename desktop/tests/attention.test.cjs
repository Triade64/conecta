const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trustedUrl, validAttentionSender, bringForward } = require('../attention.cjs');
const id = '00000000-0000-4000-8000-000000000001';
test('IPC accepts only the Conecta main frame and valid conversation ids', () => {
  const frame = { url: 'https://triadecontabilidade.vercel.app/' }, contents = { mainFrame: frame };
  const win = { webContents: contents, isDestroyed: () => false }, event = { sender: contents, senderFrame: frame };
  assert(validAttentionSender(event, win, id));
  assert(!validAttentionSender({ ...event, sender: {} }, win, id));
  assert(!validAttentionSender({ ...event, senderFrame: { url: frame.url } }, win, id));
  assert(!validAttentionSender(event, win, 'invalid'));
  frame.url = 'https://example.com'; assert(!validAttentionSender(event, win, id));
});
test('restore, show, raise and focus run in order with taskbar fallback', () => {
  const calls = [], win = { isDestroyed: () => false, isMinimized: () => true, isFocused: () => false };
  for (const method of ['restore', 'show', 'moveTop', 'focus', 'flashFrame']) win[method] = value => calls.push([method, value]);
  assert(bringForward(win)); assert.deepEqual(calls.map(row => row[0]), ['restore','show','moveTop','focus','flashFrame']);
  assert.equal(calls.at(-1)[1], true);
  assert(!bringForward({ isDestroyed: () => true }));
});
test('trusted origin rejects HTTP, deceptive domains and embedded credentials', () => {
  assert(trustedUrl('https://triadecontabilidade.vercel.app/path'));
  for (const url of ['http://triadecontabilidade.vercel.app','https://triadecontabilidade.vercel.app.evil.test','file:///C:/x','https://user@triadecontabilidade.vercel.app']) assert(!trustedUrl(url));
});
test('focused non-minimized window does not restore and stops taskbar flashing', () => {
  const calls = [], win = { isDestroyed: () => false, isMinimized: () => false, isFocused: () => true };
  for (const method of ['restore','show','moveTop','focus','flashFrame']) win[method] = value => calls.push([method,value]);
  assert(bringForward(win));assert(!calls.some(row => row[0] === 'restore'));assert.equal(calls.at(-1)[1],false);
});
test('preload exposes only attention and notification capabilities', () => {
  const vm = require('node:vm'), fs = require('node:fs'), calls = []; let exposed;
  const electron = {contextBridge:{exposeInMainWorld:(name,api)=>{assert.equal(name,'conectaDesktop');exposed=api;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({ok:true});}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return electron;}});
  assert.deepEqual(Object.keys(exposed),['requestAttention','notify','onNotificationClick']);exposed.requestAttention(id);assert.deepEqual(calls,[['conecta:attention',id]]);
});
