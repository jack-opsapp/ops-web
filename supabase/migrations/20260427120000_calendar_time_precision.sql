-- 20260427120000: Calendar time precision (Phase 3.A)
--
-- Adds all_day flag to project_tasks (was implicit) and company default work
-- hours used as seed when toggling a task to timed. Existing tasks preserve
-- behavior via DEFAULT TRUE.

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT TRUE;

-- Seed defaults for tasks created before this migration.
UPDATE project_tasks SET all_day = TRUE WHERE all_day IS NULL;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS default_work_start TIME NOT NULL DEFAULT '08:00:00',
  ADD COLUMN IF NOT EXISTS default_work_end TIME NOT NULL DEFAULT '17:00:00';

COMMENT ON COLUMN project_tasks.all_day IS
  'When true, start_time/end_time are ignored. When false, they are authoritative local-clock times.';

COMMENT ON COLUMN companies.default_work_start IS
  'Seed value for project_tasks.start_time when toggling all_day=false.';

COMMENT ON COLUMN companies.default_work_end IS
  'Seed value for project_tasks.end_time when toggling all_day=false.';
