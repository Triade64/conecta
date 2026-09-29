-- Avoid treating messages sent before unread tracking was enabled as new.
insert into public.conversation_reads (conversation_id, user_id, last_read_at)
select c.id, p.id, now()
from public.conversations c
cross join public.profiles p
where p.active
  and (
    (c.kind = 'direct' and (c.created_by = p.id or c.direct_recipient_id = p.id))
    or (c.kind = 'channel' and (
      p.role::text = 'admin'
      or lower(trim(coalesce(c.sector, ''))) in ('geral', 'general')
      or (p.role::text = 'fiscal' and lower(trim(coalesce(c.sector, ''))) in ('fiscal', 'dpto. fiscal', 'departamento fiscal'))
      or (p.role::text = 'contabil' and lower(trim(coalesce(c.sector, ''))) in ('contábil', 'contabil', 'dpto. contábil', 'dpto. contabil', 'departamento contábil', 'departamento contabil'))
      or (p.role::text = 'pessoal' and lower(trim(coalesce(c.sector, ''))) in ('pessoal', 'dpto. pessoal', 'departamento pessoal'))
    ))
  )
on conflict (conversation_id, user_id) do nothing;
