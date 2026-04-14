-- 054_draft_history_profile_type.sql
-- Add profile_type to ai_draft_history for per-relationship-type edit learning.
-- Sprint E4: Enhanced Writing Profile & Full-Spectrum Edit Learning.

ALTER TABLE ai_draft_history
  ADD COLUMN IF NOT EXISTS profile_type TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_ai_draft_history_profile_type
  ON ai_draft_history(company_id, user_id, profile_type, created_at DESC);
