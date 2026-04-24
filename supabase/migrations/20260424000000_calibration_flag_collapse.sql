-- Collapse ai_email_review feature_key rows into phase_c rows.
-- Per V1: admin_feature_overrides is row-per-(company, feature_key).
-- Migration copies any enabled=true ai_email_review row into a phase_c row
-- for the same company (if one doesn't already exist or isn't already enabled).

-- Step 1: Insert phase_c rows for any company that has ai_email_review=true
--         but does NOT have a phase_c row at all.
INSERT INTO admin_feature_overrides (
  company_id, feature_key, enabled, enabled_by, enabled_at, metadata
)
SELECT
  r.company_id,
  'phase_c' AS feature_key,
  true AS enabled,
  r.enabled_by,
  COALESCE(r.enabled_at, now()) AS enabled_at,
  COALESCE(r.metadata, '{}'::jsonb) || '{"migrated_from":"ai_email_review"}'::jsonb AS metadata
FROM admin_feature_overrides r
WHERE r.feature_key = 'ai_email_review'
  AND r.enabled = true
  AND NOT EXISTS (
    SELECT 1 FROM admin_feature_overrides p
    WHERE p.company_id = r.company_id AND p.feature_key = 'phase_c'
  );

-- Step 2: Update existing phase_c=false rows to enabled=true where the company
--         has an enabled ai_email_review row. Preserve the older enabled_at.
UPDATE admin_feature_overrides p
SET
  enabled = true,
  enabled_by = COALESCE(p.enabled_by, r.enabled_by),
  enabled_at = LEAST(COALESCE(p.enabled_at, now()), COALESCE(r.enabled_at, now())),
  metadata = COALESCE(p.metadata, '{}'::jsonb) || '{"migrated_from":"ai_email_review"}'::jsonb
FROM admin_feature_overrides r
WHERE p.feature_key = 'phase_c'
  AND r.feature_key = 'ai_email_review'
  AND p.company_id = r.company_id
  AND r.enabled = true
  AND (p.enabled IS NULL OR p.enabled = false);

-- Step 3: Mark the old ai_email_review rows as inactive (not deleted — keeps audit trail).
-- Per single-customer rollout (N2), a follow-up migration deletes these rows same-day.
UPDATE admin_feature_overrides
SET metadata = COALESCE(metadata, '{}'::jsonb)
  || jsonb_build_object('superseded_by', 'phase_c', 'superseded_at', now()::text)
WHERE feature_key = 'ai_email_review'
  AND enabled = true;

-- Verification output: after apply, expect phase_c_enabled >= legacy_enabled
-- for every company that previously had ai_email_review.
-- Run manually post-migration:
--   SELECT
--     COUNT(*) FILTER (WHERE feature_key = 'ai_email_review' AND enabled = true) AS legacy_enabled,
--     COUNT(*) FILTER (WHERE feature_key = 'phase_c' AND enabled = true) AS phase_c_enabled
--   FROM admin_feature_overrides;
