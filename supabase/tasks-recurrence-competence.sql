-- Competência da recorrência: "mês anterior" (-1, padrão: trabalho retroativo,
-- ex.: em novembro faz-se a competência 10) ou "mês atual" (0). O marcador {mes}
-- (ou {competencia}) no título vira a competência no formato MM/AAAA. Os prazos
-- das etapas continuam contados a partir da data de criação da tarefa.
-- Aplique depois de tasks-step-deadlines.sql.
begin;

alter table public.task_recurrences
  add column if not exists competence_offset integer not null default -1
  check (competence_offset in (-1, 0));
grant insert (competence_offset), update (competence_offset) on public.task_recurrences to authenticated;

create or replace function private.task_run_recurrences()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := private.office_today();
  v_period text := to_char(v_today, 'YYYY-MM');
  v_count integer := 0;
  r record;
  v_id uuid;
  v_steps jsonb;
  v_comp text;
begin
  for r in
    select rc.*, t.name as template_name, t.steps, p.sector as creator_sector, p.name as creator_name
    from public.task_recurrences rc
    join public.task_templates t on t.id = rc.template_id and t.active
    join public.task_clients c on c.id = rc.client_id and c.active
    join public.profiles p on p.id = rc.created_by and p.active
    where rc.active and rc.day_of_month <= extract(day from v_today)
      and coalesce(rc.last_period, '') < v_period
    for update of rc skip locked
  loop
    v_comp := to_char(date_trunc('month', v_today) + make_interval(months => r.competence_offset), 'MM/YYYY');
    v_steps := private.task_step_dates(r.steps, v_today);
    insert into public.tasks (client_id, template_id, template_name, title, description, priority, due_date, steps, sector_keys, created_by)
    values (r.client_id, r.template_id, r.template_name,
            left(replace(replace(r.title, '{mes}', v_comp), '{competencia}', v_comp), 160), r.description, r.priority,
            coalesce(private.task_last_due(v_steps),
                     make_date(extract(year from v_today)::int, extract(month from v_today)::int, r.day_of_month) + r.due_days),
            v_steps,
            array(select distinct k from (
              select private.sector_key(e->>'sector') as k from jsonb_array_elements(r.steps) e
              union select private.sector_key(r.creator_sector)) s),
            r.created_by)
    returning id into v_id;
    insert into public.task_events (task_id, kind, to_step, note, actor_id, actor_name)
    values (v_id, 'created', 0, 'Criada automaticamente pela recorrência mensal (competência ' || v_comp || ').', r.created_by, r.creator_name);
    update public.task_recurrences set last_period = v_period where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.task_run_recurrences() from public, anon, authenticated;

commit;
