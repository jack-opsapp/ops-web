-- 026_onboarding_completed_jsonb.sql
-- Replace has_completed_onboarding boolean with onboarding_completed JSONB
-- containing per-platform sub-fields: { ios: boolean, web: boolean }

-- 1. Add new JSONB column
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed JSONB DEFAULT '{}';

-- 2. Backfill from existing data
--    - has_completed_onboarding=true WITH starfield step → both platforms done
--    - has_completed_onboarding=true WITHOUT starfield → only iOS done
--    - otherwise → empty object
UPDATE users
SET onboarding_completed = CASE
  WHEN has_completed_onboarding = true
    AND setup_progress->'steps'->>'starfield' = 'true'
    THEN '{"ios": true, "web": true}'::jsonb
  WHEN has_completed_onboarding = true
    THEN '{"ios": true, "web": false}'::jsonb
  ELSE '{}'::jsonb
END;

-- 3. Drop the old boolean column
ALTER TABLE users DROP COLUMN IF EXISTS has_completed_onboarding;
