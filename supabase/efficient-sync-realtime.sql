-- These small tables need events so clients can refresh only changed data.
-- Existing RLS policies continue to decide which subscribers can receive rows.
begin;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='profile_photos') then
    alter publication supabase_realtime add table public.profile_photos;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='global_announcements') then
    alter publication supabase_realtime add table public.global_announcements;
  end if;
end $$;
commit;
