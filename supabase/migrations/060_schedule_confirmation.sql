-- Sprint S2 Amendment: Schedule confirmation state + expanded client comms settings
--
-- Adds explicit "schedule confirmed" state to project_tasks so confirmation emails
-- only fire at the right moment (not on every task creation), and expands the
-- per-company client_comms_settings JSONB to support the new configuration wizard.
--
-- Idempotent — safe to re-run.

-- ── Schedule confirmation columns on project_tasks ──────────────────────────
ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS schedule_confirmed_at TIMESTAMPTZ;

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS schedule_confirmed_by UUID;

COMMENT ON COLUMN project_tasks.schedule_confirmed_at IS
  'When the task was explicitly or automatically marked as schedule-confirmed. '
  'Triggers onTaskScheduleConfirmed() dispatcher which fires the configured action '
  'based on client_comms_settings.appointment_confirmation.level.';

COMMENT ON COLUMN project_tasks.schedule_confirmed_by IS
  'User id who confirmed the schedule. NULL when auto-confirmed by cron.';

CREATE INDEX IF NOT EXISTS idx_project_tasks_schedule_confirmed_at
  ON project_tasks(schedule_confirmed_at)
  WHERE deleted_at IS NULL;

-- Index to support the auto-confirm cron which filters by company +
-- unconfirmed + has start_date + stable updated_at
CREATE INDEX IF NOT EXISTS idx_project_tasks_auto_confirm_candidates
  ON project_tasks(company_id, updated_at)
  WHERE schedule_confirmed_at IS NULL
    AND start_date IS NOT NULL
    AND deleted_at IS NULL;

-- ── Auto-execute window on agent_actions ───────────────────────────────────
--
-- When a user selects an "auto-send" autonomy level with a cancellable delay,
-- we create the agent_action as pending with auto_execute_at = now() + delay.
-- A background cron approves and executes any pending actions whose
-- auto_execute_at has passed. Users can cancel by rejecting the action from
-- the approval queue before the timer elapses.

ALTER TABLE agent_actions
  ADD COLUMN IF NOT EXISTS auto_execute_at TIMESTAMPTZ;

COMMENT ON COLUMN agent_actions.auto_execute_at IS
  'If set, the action is automatically approved and executed at this time '
  'unless the user rejects or cancels first. Used by auto-send autonomy levels.';

CREATE INDEX IF NOT EXISTS idx_agent_actions_auto_execute
  ON agent_actions(auto_execute_at)
  WHERE status = 'pending' AND auto_execute_at IS NOT NULL;

-- ── Expand client_comms_settings default for new wizard-driven schema ───────
--
-- The amendment introduces per-email-type configuration including a 5-level
-- autonomy ladder, configurable reminder lead time, and a configuration wizard
-- completion marker. The old keys (`appointment_confirmations`,
-- `day_before_reminders`) are retained as fallbacks; new keys are canonical.
--
-- Existing rows are NOT rewritten to preserve user data — the service layer
-- reads both old and new keys, preferring new. The wizard writes new keys.

ALTER TABLE companies
  ALTER COLUMN client_comms_settings SET DEFAULT '{
    "comms_wizard_completed_at": null,
    "comms_wizard_version": 0,
    "appointment_confirmation": {
      "level": "draft_on_confirm",
      "confirm_mode": "explicit",
      "auto_confirm_after_hours": 4,
      "send_delay_minutes": 15,
      "reschedule_behavior": "draft"
    },
    "appointment_reminder": {
      "enabled": true,
      "lead_days": 1,
      "send_hour_local": 14,
      "include_weather": true,
      "autonomy": "draft_to_queue",
      "send_delay_minutes": 15
    },
    "status_update": {
      "cadence": "off",
      "weekly_day": 1,
      "autonomy": "draft_to_queue",
      "send_delay_minutes": 15
    },
    "payment_reminder": {
      "enabled": true,
      "preset": "standard",
      "custom_days": [7, 14, 30, 45],
      "max_reminders": 4,
      "autonomy": "draft_to_queue",
      "send_delay_minutes": 15
    },
    "invoice_cover": {
      "enabled": true,
      "threshold": 0,
      "autonomy": "draft_to_queue",
      "send_delay_minutes": 15
    },
    "reschedule_request": {
      "enabled": true,
      "behavior": "detect_and_draft",
      "min_confidence": 0.6,
      "autonomy": "draft_to_queue",
      "send_delay_minutes": 15
    },
    "subcontractor_coordination": {
      "enabled": false,
      "trigger": "manual"
    },
    "appointment_confirmations": {
      "enabled": true,
      "delay_hours": 0
    },
    "day_before_reminders": {
      "enabled": true,
      "send_hour_utc": 14,
      "include_weather": true
    },
    "reschedule_requests": {
      "enabled": true,
      "min_confidence": 0.6
    }
  }'::jsonb;

COMMENT ON COLUMN companies.client_comms_settings IS
  'Per-company communication settings. New wizard-driven schema (060): '
  'appointment_confirmation (5-level autonomy), appointment_reminder (configurable lead_days), '
  'status_update, payment_reminder, invoice_cover, reschedule_request, subcontractor_coordination. '
  'Legacy keys (appointment_confirmations plural, day_before_reminders) retained for backwards compat.';
