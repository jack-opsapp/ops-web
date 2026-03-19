-- 040_ai_drafting_auto_send.sql
-- Tables for AI email drafting, edit tracking, and auto-send queue.

-- ── AI Draft History ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_draft_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL,
  user_id               UUID NOT NULL,
  opportunity_id        UUID,
  connection_id         UUID,
  thread_id             TEXT,
  original_draft        TEXT NOT NULL,
  final_version         TEXT,
  status                TEXT NOT NULL DEFAULT 'drafted'
                        CHECK (status IN ('drafted', 'sent', 'discarded')),
  sent_without_changes  BOOLEAN DEFAULT false,
  edit_distance         INT DEFAULT 0,
  changes_made          JSONB DEFAULT '{}',
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_draft_history_user
  ON ai_draft_history(company_id, user_id, created_at DESC);

ALTER TABLE ai_draft_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON ai_draft_history
  FOR ALL USING (company_id IN (
    SELECT company_id FROM users WHERE id = auth.uid()
  ));

-- ── Pending Auto-Sends ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_auto_sends (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL,
  connection_id         UUID NOT NULL,
  opportunity_id        UUID,
  thread_id             TEXT,
  in_reply_to           TEXT,
  to_emails             TEXT[] DEFAULT '{}',
  cc_emails             TEXT[] DEFAULT '{}',
  subject               TEXT NOT NULL,
  draft_text            TEXT NOT NULL,
  draft_history_id      UUID REFERENCES ai_draft_history(id),
  scheduled_send_at     TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  retry_count           INT NOT NULL DEFAULT 0,
  sent_at               TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_auto_sends_due
  ON pending_auto_sends(scheduled_send_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_auto_sends_company
  ON pending_auto_sends(company_id, status);

ALTER TABLE pending_auto_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON pending_auto_sends
  FOR ALL USING (company_id IN (
    SELECT company_id FROM users WHERE id = auth.uid()
  ));

-- ── Auto-send settings on email_connections ───────────────────────────────────

ALTER TABLE email_connections
  ADD COLUMN IF NOT EXISTS auto_send_settings JSONB;
