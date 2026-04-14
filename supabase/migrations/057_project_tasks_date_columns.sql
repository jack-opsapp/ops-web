-- 057: Add scheduling columns to project_tasks (idempotent)
--
-- These columns store scheduling data directly on tasks.
-- Previously scheduling was via calendar_events linked by calendar_event_id,
-- but the app now uses direct date columns on project_tasks.

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS duration INT DEFAULT 1;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS start_time TEXT;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS end_time TEXT;

-- Index for calendar/schedule queries
CREATE INDEX IF NOT EXISTS idx_project_tasks_start_date
  ON project_tasks (company_id, start_date)
  WHERE deleted_at IS NULL AND start_date IS NOT NULL;
