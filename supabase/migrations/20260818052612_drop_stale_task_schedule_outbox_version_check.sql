-- The 2026-08-18 agent wave added the named version-gate constraint
-- task_schedule_automation_outbox_task_schedule_version_check, which exempts
-- the new schedule_confirmation_dispatch / schedule_unconfirmation_dispatch
-- kinds from the task_schedule_version >= 1 requirement, but did not drop the
-- July-era inline (auto-named) twin task_schedule_automation_outbox_check.
-- The stale twin rejects dispatch rows for never-rescheduled tasks
-- (schedule_version = 0), which aborts confirm/unconfirm RPCs at the
-- dispatch-enqueue step. The named successor carries the intended rule, so the
-- legacy constraint is dropped outright.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.task_schedule_automation_outbox'::regclass
      and conname = 'task_schedule_automation_outbox_task_schedule_version_check'
  ) then
    raise exception 'successor version-gate constraint missing; refusing to drop legacy task_schedule_automation_outbox_check';
  end if;
end $$;

alter table public.task_schedule_automation_outbox
  drop constraint if exists task_schedule_automation_outbox_check;
