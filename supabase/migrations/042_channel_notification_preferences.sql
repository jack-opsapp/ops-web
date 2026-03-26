-- Migration: Per-channel notification preferences
-- Adds a JSONB column that stores { push: boolean, email: boolean } per event type.
-- Global kill switches (push_enabled, email_enabled) are retained.
-- Existing per-type boolean columns are preserved for backward compatibility
-- but the new channel_preferences column is the source of truth going forward.

ALTER TABLE notification_preferences
ADD COLUMN IF NOT EXISTS channel_preferences JSONB;

-- Populate defaults from existing boolean columns for all existing rows.
-- Each event type gets { push: <current_boolean>, email: false } by default,
-- since email notifications were not previously sent per-event.
-- Financial events (expense, invoice, payment) default email to true
-- since those are high-value events users expect email for.
UPDATE notification_preferences
SET channel_preferences = jsonb_build_object(
  'task_assigned', jsonb_build_object('push', COALESCE(task_assigned, true), 'email', false),
  'task_completed', jsonb_build_object('push', COALESCE(task_completed, true), 'email', false),
  'schedule_changes', jsonb_build_object('push', COALESCE(schedule_changes, true), 'email', false),
  'project_updates', jsonb_build_object('push', COALESCE(project_updates, true), 'email', true),
  'expense_submitted', jsonb_build_object('push', COALESCE(expense_submitted, true), 'email', true),
  'expense_approved', jsonb_build_object('push', COALESCE(expense_approved, true), 'email', true),
  'invoice_sent', jsonb_build_object('push', COALESCE(invoice_sent, true), 'email', false),
  'payment_received', jsonb_build_object('push', COALESCE(payment_received, true), 'email', true),
  'team_mentions', jsonb_build_object('push', COALESCE(team_mentions, true), 'email', false),
  'daily_digest', jsonb_build_object('push', false, 'email', COALESCE(daily_digest, false))
)
WHERE channel_preferences IS NULL;

-- Set default for new rows
ALTER TABLE notification_preferences
ALTER COLUMN channel_preferences SET DEFAULT '{
  "task_assigned": {"push": true, "email": false},
  "task_completed": {"push": true, "email": false},
  "schedule_changes": {"push": true, "email": false},
  "project_updates": {"push": true, "email": true},
  "expense_submitted": {"push": true, "email": true},
  "expense_approved": {"push": true, "email": true},
  "invoice_sent": {"push": true, "email": false},
  "payment_received": {"push": true, "email": true},
  "team_mentions": {"push": true, "email": false},
  "daily_digest": {"push": false, "email": false}
}'::jsonb;
