-- ─────────────────────────────────────────────────────────────────────────────
-- 021: Gmail Scan Jobs
--
-- Async scan job tracking. scan-start creates a row, background processing
-- updates progress, and scan-status reads the current state.
-- No RLS — queried via service-role client only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE gmail_scan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL,
  company_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress JSONB DEFAULT '{"stage": "pending", "current": 0, "total": 0, "message": "Starting scan..."}',
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_gmail_scan_jobs_connection ON gmail_scan_jobs(connection_id);
CREATE INDEX idx_gmail_scan_jobs_status ON gmail_scan_jobs(status);
