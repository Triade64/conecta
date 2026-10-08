const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

function publicConfig(env) {
  const supabaseUrl = (env.VITE_SUPABASE_URL || '').trim();
  const supabasePublishableKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  let url;
  try { url = new URL(supabaseUrl); } catch { throw Error('Configure VITE_SUPABASE_URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('VITE_SUPABASE_URL deve ser a URL HTTPS do projeto.');
  let anon = false;
  try { anon = JSON.parse(Buffer.from(supabasePublishableKey.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {}
  if (!supabasePublishableKey.startsWith('sb_publishable_') && !anon) throw Error('Configure VITE_SUPABASE_PUBLISHABLE_KEY com uma chave pública; chaves secret/service_role são proibidas no frontend.');
  // Explicit allowlist: no other environment variable is ever serialized.
  return { supabaseUrl, supabasePublishableKey, giphyApiKey: env.VITE_GIPHY_API_KEY || '' };
}

function build(root = path.resolve(__dirname, '..'), environment = process.env) {
  const localPath = path.join(root, '.env');
  const local = fs.existsSync(localPath) ? parseEnv(fs.readFileSync(localPath, 'utf8')) : {};
  // Deployment environment takes precedence over the local file.
  const config = publicConfig({ ...local, ...environment });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const assets = new Set(['index.html']);
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
    const reference = match[1].split('?')[0];
    if (/^(?:https?:|data:|#)/.test(reference) || reference === 'runtime-config.js') continue;
    const file = reference.replace(/^\//, '');
    if (file.includes('..') || !/\.(js|css)$/.test(file)) throw Error('Referência estática inválida.');
    assets.add(file);
  }
  const output = path.join(root, 'dist');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const file of assets) {
    const target = path.join(output, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const serialized = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  fs.writeFileSync(path.join(output, 'runtime-config.js'), 'window.conectaConfig = Object.freeze(' + serialized + ');\n');
  console.log('Site gerado em dist/ com configuração pública.');
  return output;
}

if (require.main === module) {
  try { build(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build, publicConfig };
