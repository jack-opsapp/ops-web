-- Single-tenant cleanup: delete the superseded ai_email_review rows now that
-- phase_c rows are authoritative. Runs same ship day after the
-- 20260424000000 collapse migration and the N3 code changes that remove
-- the last remaining write/read paths.
--
-- Safe to run: after collapse, every ai_email_review row has a matching
-- phase_c row (step 1/2 of 20260424000000). The row is now dead data.

DELETE FROM admin_feature_overrides
WHERE feature_key = 'ai_email_review';
