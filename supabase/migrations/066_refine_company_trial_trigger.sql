-- Migration 066: Refine initialize_company_trial() to cover partial inserts
--
-- Follow-up to 065. The original trigger only fired if BOTH subscription_status
-- and trial_end_date were null. A partial insert like
--
--   INSERT INTO companies (id, name, subscription_status)
--   VALUES ('x', 'y', 'trial');
--
-- slips through (status is set, end date is null) and produces a company with
-- status='trial' but no expiry. lib/subscription.ts then computed an
-- undefined daysRemaining, which silently granted unlimited access.
--
-- New trigger condition: fire whenever trial_end_date is null, regardless of
-- status. The generated values respect explicit caller values via COALESCE.
-- If the caller sets status='active' but leaves trial_end_date null, we
-- still populate trial_end_date (harmless; the active status drives access
-- via lib/subscription.ts, the trial dates are informational).
--
-- Paired with a fail-closed check in lib/subscription.ts that treats
-- "trialing status + undefined daysRemaining" as expired.

CREATE OR REPLACE FUNCTION initialize_company_trial()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trial_end_date IS NULL THEN
    NEW.subscription_status := COALESCE(NEW.subscription_status, 'trial');
    NEW.subscription_plan   := COALESCE(NEW.subscription_plan, 'trial');
    NEW.trial_start_date    := COALESCE(NEW.trial_start_date, NOW());
    NEW.trial_end_date      := NOW() + INTERVAL '30 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
