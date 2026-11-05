-- OPTIONAL ACTIVATION. Apply only in an explicitly approved environment.
-- Run as the database owner after the workflow migration.
create extension if not exists pg_cron;
select cron.schedule('conecta-workflow-tick','*/5 * * * *',
  'select private.workflow_tick();');
-- Check: select jobid,jobname,schedule,active from cron.job where jobname='conecta-workflow-tick';
-- Pause: select cron.unschedule('conecta-workflow-tick');
-- Job failures: select * from cron.job_run_details where status='failed' order by start_time desc limit 20;
