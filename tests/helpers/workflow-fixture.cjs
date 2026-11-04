const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const crypto=require('node:crypto');const path=require('node:path');
async function fixture(){const root=path.resolve(__dirname,'../..');const db=new PGlite();const ids={admin:crypto.randomUUID(),fiscal:crypto.randomUUID(),dp:crypto.randomUUID(),contabil:crypto.randomUUID(),outsider:crypto.randomUUID(),inactive:crypto.randomUUID(),fiscal2:crypto.randomUUID()};
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.profiles(id uuid primary key,name text,role text,sector text,active boolean default true);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
alter table storage.objects enable row level security;grant usage on schema auth,storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',fs.readdirSync(path.join(root,'supabase/migrations')).find(n=>n.endsWith('_intersector_workflows.sql'))),'utf8'));
for(const [name,id] of Object.entries(ids))await db.query('insert into profiles(id,name,role,sector,active) values($1,$2,$3,$4,$5)',[id,name,({dp:'pessoal',outsider:'colaborador',inactive:'fiscal',fiscal2:'fiscal'})[name]||name,name==='outsider'?'Atendimento':null,name!=='inactive']);
return {db,ids};}
module.exports={fixture};
