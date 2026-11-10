-- Padroniza os nomes de setor nos nomes oficiais do cadastro de colaboradores
-- (Dpto. Fiscal, Dpto. Contábil, Dpto. Pessoal, Administrador), em perfis,
-- modelos de fluxo e tarefas. Variações como "Fiscal", "Departamento Fiscal" e
-- "Administração" são convertidas; setores fora dessa lista ficam como estão.
-- Aplique depois de tasks-sector-aliases.sql. Pode ser executado mais de uma vez.
begin;
create or replace function private.canonical_sector(p_sector text)
returns text language sql immutable set search_path = ''
as $$
  select case private.sector_key(p_sector)
    when 'fiscal' then 'Dpto. Fiscal'
    when 'contabil' then 'Dpto. Contábil'
    when 'pessoal' then 'Dpto. Pessoal'
    when 'administracao' then 'Administrador'
    else btrim(p_sector) end;
$$;
revoke all on function private.canonical_sector(text) from public, anon;

update public.profiles set sector = private.canonical_sector(sector)
where sector is distinct from private.canonical_sector(sector);

create or replace function private.canonical_steps(p_steps jsonb)
returns jsonb language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_set(e, '{sector}', to_jsonb(private.canonical_sector(e->>'sector'))) order by n), '[]'::jsonb)
  from jsonb_array_elements(p_steps) with ordinality as x(e, n);
$$;
revoke all on function private.canonical_steps(jsonb) from public, anon;

update public.task_templates set steps = private.canonical_steps(steps)
where steps is distinct from private.canonical_steps(steps);
update public.tasks set steps = private.canonical_steps(steps)
where steps is distinct from private.canonical_steps(steps);
commit;
