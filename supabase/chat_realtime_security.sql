-- Enable live updates for the tables used by the app. Realtime still enforces
-- each subscriber's RLS policies before sending row changes.
begin;

alter publication supabase_realtime
  add table public.profiles, public.notices, public.reminders,
             public.conversations, public.messages;

-- This function exists only as the Auth trigger target, never as a public RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

commit;
