-- 035_email_pipeline_new_tables.sql
-- New tables for email pipeline: thread linking, feature overrides, opportunity fields

-- Junction table: links opportunities to email thread IDs
CREATE TABLE opportunity_email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  connection_id UUID REFERENCES email_connections(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(thread_id, connection_id)
);

CREATE INDEX idx_oet_thread ON opportunity_email_threads(thread_id);
CREATE INDEX idx_oet_opportunity ON opportunity_email_threads(opportunity_id);

-- RLS
ALTER TABLE opportunity_email_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company-scoped thread access" ON opportunity_email_threads
  FOR ALL USING (
    opportunity_id IN (
      SELECT id FROM opportunities WHERE company_id = (
        SELECT (auth.jwt()->>'company_id')::uuid
      )
    )
  );

-- Admin feature overrides (OPS admin controls per-company AI features)
CREATE TABLE admin_feature_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  enabled_by UUID,
  enabled_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  UNIQUE(company_id, feature_key)
);

ALTER TABLE admin_feature_overrides ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS — accessed via service role in admin API routes only

-- Add correspondence tracking columns to opportunities
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS correspondence_count INT DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS outbound_count INT DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS inbound_count INT DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS last_outbound_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS last_message_direction TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS ai_stage_confidence FLOAT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS ai_stage_signals TEXT[];
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS detected_value INT;
