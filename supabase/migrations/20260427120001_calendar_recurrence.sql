-- 20260427120001: Recurring task templates + per-occurrence exceptions (Phase 3.B)
--
-- RFC 5545 RRULE stored as text on a template row. A cron worker materializes
-- the next N concrete project_tasks per template. Exceptions handle
-- per-occurrence skip/reschedule/reassign.

CREATE TABLE IF NOT EXISTS task_recurrences (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id              UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_id               UUID REFERENCES clients(id) ON DELETE SET NULL,
  task_type_id            UUID REFERENCES task_types(id) ON DELETE SET NULL,
  title                   TEXT NOT NULL,
  team_member_ids         UUID[] NOT NULL DEFAULT '{}',
  rrule                   TEXT NOT NULL,
  start_anchor            DATE NOT NULL,
  end_anchor              DATE,
  all_day                 BOOLEAN NOT NULL DEFAULT TRUE,
  start_time              TIME,
  end_time                TIME,
  duration                INT NOT NULL DEFAULT 1,
  notes                   TEXT,
  next_generation_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_recurrences_active_due
  ON task_recurrences (company_id, next_generation_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_recurrences_project
  ON task_recurrences (project_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS task_recurrence_exceptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence_id           UUID NOT NULL REFERENCES task_recurrences(id) ON DELETE CASCADE,
  original_date           DATE NOT NULL,
  action                  TEXT NOT NULL CHECK (action IN ('skip','reschedule')),
  new_date                DATE,
  new_start_time          TIME,
  new_end_time            TIME,
  new_team_member_ids     UUID[],
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recurrence_id, original_date)
);

CREATE INDEX IF NOT EXISTS idx_task_recurrence_exceptions_lookup
  ON task_recurrence_exceptions (recurrence_id, original_date);

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS recurrence_id UUID REFERENCES task_recurrences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence_origin_date DATE;

CREATE INDEX IF NOT EXISTS idx_project_tasks_recurrence
  ON project_tasks (company_id, recurrence_id)
  WHERE recurrence_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_tasks_recurrence_origin
  ON project_tasks (recurrence_id, recurrence_origin_date)
  WHERE recurrence_id IS NOT NULL AND deleted_at IS NULL;

-- RLS — match project_tasks policies (company-scoped via auth.uid() lookup).
ALTER TABLE task_recurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_recurrence_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_recurrences_company_isolation ON task_recurrences
  USING (company_id IN (
    SELECT company_id FROM users WHERE id = auth.uid()
  ));

CREATE POLICY task_recurrence_exceptions_company_isolation ON task_recurrence_exceptions
  USING (recurrence_id IN (
    SELECT id FROM task_recurrences WHERE company_id IN (
      SELECT company_id FROM users WHERE id = auth.uid()
    )
  ));

COMMENT ON TABLE task_recurrences IS
  'Recurring task templates. Materialized into project_tasks by /api/cron/recurrence-generate. RRULE format is RFC 5545.';

COMMENT ON COLUMN task_recurrences.next_generation_at IS
  'Cron checkpoint. Set to NOW() on rule-affecting updates to force regeneration.';

COMMENT ON TABLE task_recurrence_exceptions IS
  'Per-occurrence overrides. action=skip drops the occurrence, action=reschedule applies new_date/new_start_time/new_end_time/new_team_member_ids.';
