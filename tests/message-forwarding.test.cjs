const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { File } = require('node:buffer');
const code = fs.readFileSync(require('node:path').join(__dirname, '../message-forwarding.js'), 'utf8');
function setup(source, options = {}) {
  const calls = [];
  const ctx = { File, console, conectaCurrentUser: { id: 'me' }, conectaFirebase: {
    db: {
      from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: source, error: options.readError }; } }),
      storage: { from: bucket => ({ async download(path) { calls.push(['download', bucket, path]); return { data: new Blob(['image'], { type: 'image/png' }), error: options.downloadError }; } }) }
    },
    async uploadChatFile(user, destination, file) { calls.push(['upload', destination, file.name]); return { path: 'file:me/destination/copy.png', info: { name: file.name, mime: file.type, size: file.size } }; },
    async sendMessage(...args) { calls.push(['send', ...args]); if (options.sendError) throw Error('send failed'); },
    async removePendingChatFile(path) { calls.push(['cleanup', path]); }
  } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, calls, send: () => ctx.conectaForwardMessage({ id: 'me' }, 'destination', 'source') };
}
test('text forwards as current user, marked and without original reply', async () => {
  const t = setup({ text: 'Olá', reply_to: 'private-reply', author_id: 'other' }); await t.send();
  assert.deepEqual(t.calls[0], ['send', { id: 'me' }, 'destination', '↪ Mensagem encaminhada\nOlá', null, null, null, null]);
});
test('private attachments are copied into destination storage', async () => {
  const t = setup({ text: 'Foto', attachment_path: 'file:other/source/private.png', attachment_name: 'foto.png', attachment_mime: 'image/png' }); await t.send();
  assert.deepEqual(t.calls.slice(0, 2), [['download', 'chat-files', 'other/source/private.png'], ['upload', 'destination', 'foto.png']]);
  assert.equal(t.calls[2][5], 'file:me/destination/copy.png'); assert.equal(t.calls[2][6], null);
});
test('legacy stored GIF is copied and Giphy identifier remains reusable', async () => {
  const legacy = setup({ attachment_path: 'other/old.gif' }); await legacy.send();
  assert.equal(legacy.calls[0][1], 'chat-media'); assert.equal(legacy.calls[1][2], 'GIF.gif');
  const giphy = setup({ attachment_path: 'giphy:public-id' }); await giphy.send();
  assert.equal(giphy.calls.length, 1); assert.equal(giphy.calls[0][5], 'giphy:public-id');
});
test('inaccessible, deleted and stale-session sources cannot forward', async () => {
  for (const source of [null, { deleted_at: 'date' }]) { const t = setup(source); await assert.rejects(t.send); assert.equal(t.calls.length, 0); }
  const t = setup({ text: 'secret' }); t.ctx.conectaCurrentUser.id = 'another'; await assert.rejects(t.send); assert.equal(t.calls.length, 0);
});
test('download failures do not send incomplete messages', async () => {
  const t = setup({ attachment_path: 'file:private/file.png' }, { downloadError: Error('denied') }); await assert.rejects(t.send); assert.equal(t.calls.length, 1);
});
test('failed insertion removes pending copy; successful insertion keeps it', async () => {
  const t = setup({ attachment_path: 'file:private/file.png' }, { sendError: true }); await assert.rejects(t.send);
  assert.deepEqual(t.calls.at(-1), ['cleanup', 'file:me/destination/copy.png']);
});
