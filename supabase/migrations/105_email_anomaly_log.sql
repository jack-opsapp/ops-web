-- 105_email_anomaly_log.sql
-- PR 8: Event Monitor + Anomaly Alerts
--
-- Tamper-evident log of detected deliverability anomalies. The cron writes
-- every breach. Dedup is enforced at write time by the cron, not the schema —
-- we want to be able to backfill / re-run without losing audit trail.

DO $$ BEGIN
  CREATE TYPE email_anomaly_kind AS ENUM (
    'bounce_spike', 'spam_spike', 'delivery_drop', 'volume_drop'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_anomaly_severity AS ENUM ('warn', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.email_anomaly_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  kind email_anomaly_kind NOT NULL,
  severity email_anomaly_severity NOT NULL,
  window_minutes int NOT NULL,
  metric_value numeric NOT NULL,
  threshold numeric NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_taken text NULL,
  notification_id uuid NULL,
  pause_audit_id uuid NULL REFERENCES public.email_pause_audit_log (id) ON DELETE SET NULL,
  resolved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_email_anomaly_log_detected_at
  ON public.email_anomaly_log (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_anomaly_log_kind_detected
  ON public.email_anomaly_log (kind, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_anomaly_log_unresolved
  ON public.email_anomaly_log (kind, detected_at DESC) WHERE resolved_at IS NULL;

-- Now wire migration 104's anomaly_log_id column with a real FK back to
-- email_anomaly_log.id (forward-referenced from migration 104).
DO $$ BEGIN
  ALTER TABLE public.email_pause_audit_log
    ADD CONSTRAINT email_pause_audit_log_anomaly_log_id_fkey
    FOREIGN KEY (anomaly_log_id) REFERENCES public.email_anomaly_log (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Defense in depth: revoke UPDATE/DELETE from non-service roles. The cron
-- service-role bypasses RLS; admin reads are routed through admin-gated
-- API routes (no direct table access for authenticated users).
REVOKE UPDATE, DELETE ON public.email_anomaly_log FROM anon, authenticated;

COMMENT ON TABLE public.email_anomaly_log IS
  'Detected deliverability anomalies. Written by /api/cron/email/anomaly-check. Dedup is enforced at write time (60-min window per kind unless severity escalates). action_taken is human-readable description (e.g. "pause(global) escalated to critical").';
COMMENT ON COLUMN public.email_anomaly_log.context IS
  'Snapshot context: {window_minutes, total_sent, total_delivered, total_bounced, bounce_pct, spam_pct, top_domains?, [...]}.';
COMMENT ON COLUMN public.email_anomaly_log.pause_audit_id IS
  'For critical anomalies that triggered an automatic pause, points at email_pause_audit_log.id. NULL for warn-only anomalies.';
