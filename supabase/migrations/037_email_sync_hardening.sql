-- 037_email_sync_hardening.sql
-- Adds missing columns to activities for full email storage,
-- and adds stage_manually_set flag to opportunities.

-- ── Activities: store full email data ─────────────────────────────────────────

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS to_emails    TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cc_emails    TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS body_text    TEXT,
  ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachment_count INT NOT NULL DEFAULT 0;

-- ── Opportunities: protect manual stage changes from AI override ──────────────

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS stage_manually_set BOOLEAN NOT NULL DEFAULT false;

-- Index for subscription-gated sync (cron joins email_connections → companies)
CREATE INDEX IF NOT EXISTS idx_email_connections_company_id
  ON email_connections(company_id) WHERE sync_enabled = true AND status = 'active';
