-- 20260508120000_activities_draft_history_link.sql
-- Link an activity row (a sent email) back to the ai_draft_history entry
-- that produced it, so the inbox UI can render an AI-edit diff toggle on
-- AI-authored outbound bubbles.
--
-- ADDITIVE ONLY: nullable column, no destructive changes. Safe across iOS
-- App Store releases per the OPS iOS sync constraint.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS draft_history_id UUID
  REFERENCES ai_draft_history(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_activities_draft_history
  ON activities(draft_history_id)
  WHERE draft_history_id IS NOT NULL;
