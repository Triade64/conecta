const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, publicConfig } = require('../scripts/build.cjs');
const valid = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };

test('only the three public fields are emitted, regardless of other secrets', () => {
  const config = publicConfig({ ...valid, SUPABASE_SERVICE_ROLE_KEY: 'secret-server', DATABASE_URL: 'secret-database', VITE_UNRELATED_SECRET: 'secret-other' });
  assert.deepEqual(Object.keys(config), ['supabaseUrl', 'supabasePublishableKey', 'giphyApiKey']);
  assert(!JSON.stringify(config).includes('secret-'));
});
test('rejects secret and service_role keys in the public variable', () => {
  const jwt = 'header.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.signature';
  for (const key of ['sb_secret_test', jwt, '', 'arbitrary']) assert.throws(() => publicConfig({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key }));
});
test('supports legacy anon keys and validates project URL', () => {
  const jwt = 'header.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.signature';
  assert.equal(publicConfig({ VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: jwt }).supabasePublishableKey, jwt);
  for (const url of ['', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/?secret=x']) assert.throws(() => publicConfig({ ...valid, VITE_SUPABASE_URL: url }));
});
test('build uses deployment overrides and excludes env, backend, tests and docs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conecta-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env'), 'VITE_SUPABASE_URL=https://local.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local\nSUPABASE_SERVICE_ROLE_KEY=server-secret\n');
  fs.writeFileSync(path.join(root, 'index.html'), '<script src="runtime-config.js?v=1"></script><script src="app.js?v=1"></script><link rel="stylesheet" href="/public/theme.css"><link href="data:image/png;base64,ignored">');
  fs.writeFileSync(path.join(root, 'app.js'), 'window.app=true;');
  fs.mkdirSync(path.join(root, 'public')); fs.writeFileSync(path.join(root, 'public/theme.css'), 'body{}');
  fs.mkdirSync(path.join(root, 'backend')); fs.writeFileSync(path.join(root, 'backend/server.js'), 'server-secret');
  const out = build(root, valid);
  const config = fs.readFileSync(path.join(out, 'runtime-config.js'), 'utf8');
  assert(config.includes(valid.VITE_SUPABASE_URL)); assert(!config.includes('local.supabase.co')); assert(!config.includes('server-secret'));
  assert.deepEqual(fs.readdirSync(out).sort(), ['app.js', 'index.html', 'public', 'runtime-config.js']);
  assert(fs.existsSync(path.join(out, 'public/theme.css')));
});
