-- Alterar a data de conclusão de uma tarefa concluída. Permitido ao criador
-- da tarefa ou a administradores; a data não pode ser futura nem anterior à
-- criação. Fica registrado no histórico. Aplique depois de
-- tasks-deadline-from-competence.sql.
begin;

alter table public.task_events drop constraint if exists task_events_kind_check;
alter table public.task_events add constraint task_events_kind_check
  check (kind in ('created', 'advanced', 'returned', 'completed', 'cancelled', 'comment', 'claimed', 'released', 'completion_changed'));

create or replace function public.task_set_completed_at(p_task uuid, p_version integer, p_date date, p_note text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks;
  v_old date;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or not private.can_view_task(v_task.sector_keys, v_task.created_by) then
    raise exception 'task_not_found';
  end if;
  if v_task.created_by <> (select auth.uid()) and not private.is_active_admin() then
    raise exception 'task_forbidden';
  end if;
  if v_task.status <> 'done' then raise exception 'task_not_done'; end if;
  if v_task.version <> p_version then raise exception 'task_version_conflict'; end if;
  if p_date is null or p_date > private.office_today()
     or p_date < (v_task.created_at at time zone 'America/Sao_Paulo')::date then
    raise exception 'task_completion_date_invalid';
  end if;
  v_old := (v_task.completed_at at time zone 'America/Sao_Paulo')::date;
  -- Meio-dia no horário de Brasília evita que a data "vire" por fuso.
  update public.tasks
  set completed_at = (p_date + time '12:00') at time zone 'America/Sao_Paulo',
      version = version + 1, updated_at = now()
  where id = p_task;
  insert into public.task_events (task_id, kind, from_step, note, actor_id, actor_name)
  values (p_task, 'completion_changed', v_task.current_step,
          'Data de conclusão alterada de ' || coalesce(to_char(v_old, 'DD/MM/YYYY'), '—') || ' para ' || to_char(p_date, 'DD/MM/YYYY') || '.'
            || case when length(btrim(coalesce(p_note, ''))) > 0 then ' ' || left(btrim(p_note), 1900) else '' end,
          (select auth.uid()), private.task_actor_name());
end;
$$;
revoke all on function public.task_set_completed_at(uuid, integer, date, text) from public, anon;
grant execute on function public.task_set_completed_at(uuid, integer, date, text) to authenticated;

commit;
