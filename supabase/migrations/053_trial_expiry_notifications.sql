-- 053: trial_expiry_notifications
-- Dedupe table for trial expiry notifications. Inserts use ON CONFLICT DO NOTHING
-- so the daily cron is safe to rerun.
--
-- notification_type values:
--   warning_7d        — 7 days before trial ends (email only)
--   warning_5d        — 5 days before trial ends (email only)
--   discount_3d       — 3 days before, discount offer (email + push + in-app)
--   warning_1d        — 1 day before (email only)
--   reengagement_7d   — 7 days after expiry, win-back offer (email + in-app)
--   reengagement_30d  — 30 days after expiry, final win-back offer (email + in-app)

CREATE TABLE IF NOT EXISTS trial_expiry_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN (
    'warning_7d',
    'warning_5d',
    'discount_3d',
    'warning_1d',
    'reengagement_7d',
    'reengagement_30d'
  )),
  sent_at timestamptz NOT NULL DEFAULT now(),
  promo_code_50 text,
  promo_code_30 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trial_expiry_notifications_unique UNIQUE (company_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_trial_expiry_notifications_company
  ON trial_expiry_notifications (company_id);

CREATE INDEX IF NOT EXISTS idx_trial_expiry_notifications_sent_at
  ON trial_expiry_notifications (sent_at DESC);
