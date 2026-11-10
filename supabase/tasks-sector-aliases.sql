-- Setores equivalentes no fluxo de tarefas: "Dpto. Fiscal", "Depto Fiscal",
-- "Departamento Fiscal" e "Fiscal" viram a mesma chave; "Administrador" e
-- "Administração" também. Aplique depois de tasks.sql. Recalcula as tarefas existentes.
begin;
create or replace function private.sector_key(p_sector text)
returns text language sql immutable set search_path = ''
as $$
  select case when k in ('administrador', 'administracao', 'adm') then 'administracao' else k end
  from (select btrim(regexp_replace(
          translate(lower(btrim(coalesce(p_sector, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
          '^(departamento|dpto|depto|dep)\.?\s*(de\s+)?', '')) as k) s;
$$;

update public.tasks t set sector_keys = array(
  select distinct private.sector_key(e->>'sector') from jsonb_array_elements(t.steps) e
  union
  select private.sector_key(p.sector) from public.profiles p where p.id = t.created_by
);
commit;
