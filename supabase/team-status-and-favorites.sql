create table public.team_status (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 status text not null default 'available' check (status in ('available','busy','meeting','away')),
 note text not null default '' check (char_length(note) <= 80),
 updated_at timestamptz not null default now()
);
alter table public.team_status enable row level security;
revoke all on public.team_status from anon, authenticated;
grant select, insert, update on public.team_status to authenticated;
create policy team_status_read on public.team_status for select to authenticated
 using (private.can_access_sector('Geral'));
create policy team_status_insert on public.team_status for insert to authenticated
 with check (user_id = (select auth.uid()) and private.can_access_sector('Geral'));
create policy team_status_update on public.team_status for update to authenticated
 using (user_id = (select auth.uid()) and private.can_access_sector('Geral'))
 with check (user_id = (select auth.uid()) and private.can_access_sector('Geral'));

create table public.message_favorites (
 user_id uuid not null references public.profiles(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,message_id)
);
create index message_favorites_message_id_idx on public.message_favorites(message_id);
alter table public.message_favorites enable row level security;
revoke all on public.message_favorites from anon, authenticated;
grant select, insert, delete on public.message_favorites to authenticated;
create policy message_favorites_read on public.message_favorites for select to authenticated
 using (user_id = (select auth.uid()) and private.can_access_sector('Geral')
 and exists (select 1 from public.messages m where m.id = message_favorites.message_id));
create policy message_favorites_insert on public.message_favorites for insert to authenticated
 with check (user_id = (select auth.uid()) and private.can_access_sector('Geral')
 and exists (select 1 from public.messages m where m.id = message_favorites.message_id and m.deleted_at is null)
 and not exists (select 1 from public.message_hidden_for h where h.user_id = (select auth.uid()) and h.message_id = message_favorites.message_id));
create policy message_favorites_delete on public.message_favorites for delete to authenticated
 using (user_id = (select auth.uid()) and private.can_access_sector('Geral'));
do $$ begin
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='team_status') then
  alter publication supabase_realtime add table public.team_status;
 end if;
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_favorites') then
  alter publication supabase_realtime add table public.message_favorites;
 end if;
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kitchen_calendar') then
  alter publication supabase_realtime add table public.kitchen_calendar;
 end if;
end $$;
