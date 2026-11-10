-- Libera qualquer emoji nas reações (antes eram só 6).
alter table public.message_reactions drop constraint message_reactions_emoji_check;
alter table public.message_reactions add constraint message_reactions_emoji_check
  check (char_length(emoji) between 1 and 16 and emoji !~ '[[:alnum:][:space:]<>]');
