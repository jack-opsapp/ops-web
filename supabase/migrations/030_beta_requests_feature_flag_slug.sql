-- =================================================================
-- Migration 030: Add feature_flag_slug to beta_access_requests
--
-- Allows sidebar feature-gate access requests to share the same
-- table as whats-new beta requests.
-- =================================================================

-- Add feature_flag_slug column
ALTER TABLE beta_access_requests
  ADD COLUMN IF NOT EXISTS feature_flag_slug text;

-- Make whats_new_item_id nullable (sidebar requests won't have one)
ALTER TABLE beta_access_requests
  ALTER COLUMN whats_new_item_id DROP NOT NULL;

-- At least one source must be set
ALTER TABLE beta_access_requests
  DROP CONSTRAINT IF EXISTS beta_request_has_source;
ALTER TABLE beta_access_requests
  ADD CONSTRAINT beta_request_has_source
  CHECK (whats_new_item_id IS NOT NULL OR feature_flag_slug IS NOT NULL);

-- Unique constraint: one request per user per feature flag
CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_requests_user_flag
  ON beta_access_requests (user_id, feature_flag_slug)
  WHERE feature_flag_slug IS NOT NULL;
