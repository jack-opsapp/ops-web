-- Migration 065: Auto-initialize trial window on new company inserts
--
-- Problem: A company row inserted with NULL subscription_status and NULL
-- trial_end_date slips past every gating check — getSubscriptionInfo() in
-- lib/subscription.ts treats "null + null" as an active trial with no
-- expiry, and daysRemainingInTrial returns undefined, so trialExpired is
-- false and isActive is true forever. Effectively an unlimited trial.
--
-- Companies are not created directly from ops-web today — they come in via
-- Bubble sync, which may or may not set trial fields. This trigger catches
-- every INSERT path regardless of origin.
--
-- Design choices:
--   - 30-day trial window, matching TIER_CONFIG.trial.features in
--     lib/subscription.ts ("30-day trial").
--   - Only fires when BOTH status and trial_end_date are null, so explicit
--     inserts with values (backfills, admin tools, Bubble sync that sets
--     everything) are left untouched.
--   - subscription_plan defaults to 'trial' if also null, keeping the plan
--     and status consistent.
--
-- No backfill of existing rows: as of 2026-04, zero companies in prod have
-- both columns null.

CREATE OR REPLACE FUNCTION initialize_company_trial()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.subscription_status IS NULL AND NEW.trial_end_date IS NULL THEN
    NEW.subscription_status := 'trial';
    NEW.subscription_plan   := COALESCE(NEW.subscription_plan, 'trial');
    NEW.trial_start_date    := COALESCE(NEW.trial_start_date, NOW());
    NEW.trial_end_date      := NOW() + INTERVAL '30 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS initialize_company_trial_trigger ON companies;

CREATE TRIGGER initialize_company_trial_trigger
BEFORE INSERT ON companies
FOR EACH ROW
EXECUTE FUNCTION initialize_company_trial();
