-- Qualquer colaborador ativo cria modelos de fluxo. Editar, inativar ou excluir:
-- somente quem criou ou administradores. Aplique depois de tasks.sql.
begin;
alter table public.task_templates add column if not exists created_by uuid default auth.uid() references auth.users(id);
drop policy if exists task_templates_read on public.task_templates;
drop policy if exists task_templates_admin_write on public.task_templates;
create policy task_templates_read on public.task_templates for select to authenticated
  using (private.my_sector_key() is not null and (active or private.is_active_admin() or created_by = (select auth.uid())));
create policy task_templates_insert on public.task_templates for insert to authenticated
  with check (private.my_sector_key() is not null and created_by = (select auth.uid()));
create policy task_templates_update on public.task_templates for update to authenticated
  using (private.is_active_admin() or (private.my_sector_key() is not null and created_by = (select auth.uid())))
  with check (private.is_active_admin() or (private.my_sector_key() is not null and created_by = (select auth.uid())));
create policy task_templates_delete on public.task_templates for delete to authenticated
  using (private.is_active_admin() or (private.my_sector_key() is not null and created_by = (select auth.uid())));
commit;
