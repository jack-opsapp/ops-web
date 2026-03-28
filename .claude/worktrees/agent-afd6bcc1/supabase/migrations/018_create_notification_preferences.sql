-- Migration 018: Create notification_preferences table
-- Per-user notification settings persisted to DB (replacing client-only Zustand)

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT true,
  task_assigned BOOLEAN DEFAULT true,
  task_completed BOOLEAN DEFAULT true,
  schedule_changes BOOLEAN DEFAULT true,
  project_updates BOOLEAN DEFAULT true,
  expense_submitted BOOLEAN DEFAULT true,
  expense_approved BOOLEAN DEFAULT true,
  invoice_sent BOOLEAN DEFAULT true,
  payment_received BOOLEAN DEFAULT true,
  team_mentions BOOLEAN DEFAULT true,
  daily_digest BOOLEAN DEFAULT false,
  quiet_hours_start TIME DEFAULT NULL,
  quiet_hours_end TIME DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, company_id)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notification preferences"
  ON notification_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own notification preferences"
  ON notification_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own notification preferences"
  ON notification_preferences FOR UPDATE
  USING (user_id = auth.uid());
