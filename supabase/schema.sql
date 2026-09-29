create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'fiscal', 'contabil', 'pessoal', 'colaborador');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role public.app_role not null default 'colaborador',
  sector text not null default 'Geral',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sector text not null default 'Geral',
  tag text not null default 'NOVO',
  body text not null,
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  due_at timestamptz,
  done boolean not null default false,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'channel',
  name text not null,
  sector text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message text
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  text text not null,
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.notices enable row level security;
alter table public.reminders enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active); $$;

create policy "profiles_read_self_or_admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles_admin_write" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "notices_authenticated" on public.notices for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "reminders_owner" on public.reminders for all using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy "conversations_authenticated" on public.conversations for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "messages_authenticated" on public.messages for all using (auth.uid() is not null) with check (auth.uid() is not null);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin insert into public.profiles (id, name, email) values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email) on conflict (id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.bootstrap_first_admin()
returns json language plpgsql security definer set search_path = public
as $$
declare total_profiles integer;
begin
  select count(*) into total_profiles from public.profiles;
  if total_profiles = 0 or (total_profiles = 1 and not exists (select 1 from public.profiles where role = 'admin')) then
    update public.profiles set role = 'admin', sector = 'Administração' where id = auth.uid();
  end if;
  return json_build_object('role', (select role from public.profiles where id = auth.uid()));
end;
$$;
grant execute on function public.bootstrap_first_admin() to authenticated;
