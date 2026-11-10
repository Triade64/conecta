-- Ao avançar/devolver para uma etapa de outro setor, a tarefa deixa de estar
-- "assumida" por quem a pegou no setor anterior.
create or replace function private.tasks_release_on_sector_change()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.assigned_to is not null and new.current_step is distinct from old.current_step
     and lower(btrim(coalesce(new.steps->new.current_step->>'sector', '')))
         is distinct from lower(btrim(coalesce(old.steps->old.current_step->>'sector', ''))) then
    new.assigned_to := null;
    new.assigned_name := '';
  end if;
  return new;
end $$;

drop trigger if exists tasks_release_on_sector_change on public.tasks;
create trigger tasks_release_on_sector_change before update on public.tasks
  for each row execute function private.tasks_release_on_sector_change();
