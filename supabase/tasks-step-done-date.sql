-- Ao repassar (ou concluir), quem repassa informa em que dia a sua etapa foi
-- concluída (padrão: hoje; nunca futura nem anterior à criação). A data fica
-- na etapa (steps[i].done_date) e no histórico (task_events.done_on); na
-- última etapa vira a data de conclusão da tarefa. Aplique depois de
-- tasks-completion-date.sql.
begin;

alter table public.task_events add column if not exists done_on date;

-- Nova assinatura com p_done_on (opcional). Chamadas sem ela continuam valendo.
drop function if exists public.task_advance(uuid, integer, text);
create or replace function public.task_advance(p_task uuid, p_version integer, p_note text default '', p_done_on date default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks := private.lock_task_for_step(p_task, p_version);
  v_next integer := v_task.current_step + 1;
  v_last boolean := v_task.current_step + 1 >= jsonb_array_length(v_task.steps);
  v_done date := coalesce(p_done_on, private.office_today());
begin
  if v_done > private.office_today() or v_done < (v_task.created_at at time zone 'America/Sao_Paulo')::date then
    raise exception 'task_step_done_date_invalid';
  end if;
  update public.tasks set
    steps = jsonb_set(steps, array[current_step::text, 'done_date'], to_jsonb(to_char(v_done, 'YYYY-MM-DD'))),
    current_step = case when v_last then current_step else v_next end,
    status = case when v_last then 'done' else status end,
    completed_at = case when v_last then
      case when v_done = private.office_today() then now() else (v_done + time '12:00') at time zone 'America/Sao_Paulo' end
      else completed_at end,
    version = version + 1, updated_at = now()
  where id = p_task;
  insert into public.task_events (task_id, kind, from_step, to_step, note, actor_id, actor_name, done_on)
  values (p_task, case when v_last then 'completed' else 'advanced' end, v_task.current_step,
          case when v_last then v_task.current_step else v_next end,
          left(btrim(coalesce(p_note, '')), 2000), (select auth.uid()), private.task_actor_name(), v_done);
end;
$$;
revoke all on function public.task_advance(uuid, integer, text, date) from public, anon;
grant execute on function public.task_advance(uuid, integer, text, date) to authenticated;

commit;
