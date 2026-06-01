-- 20260529000000_onboarding_email_log_enable_rls.sql
-- Lock down public.onboarding_email_log. The table shipped with RLS DISABLED
-- (created in 20260527150000_onboarding_email_log.sql), so the default anon +
-- authenticated grants let any caller read/write every row via the Data API.
-- get_advisors flags this as ERROR 0013_rls_disabled_in_public. This migration
-- is purely additive (enable RLS + one read policy); it changes no columns and
-- drops nothing, so it is safe to ship between iOS App Store releases — the iOS
-- app never touches this table (web/cron backend state only).
--
-- Access model (verified against the codebase):
--   * Writes are exclusively service-role. The drip cron
--     (api/cron/onboarding-drip), the OnboardingDripService claim/update path,
--     and the Day-0 send in api/setup/progress all use getServiceRoleClient().
--     service_role bypasses RLS unconditionally, so NO insert/update/delete
--     policy is required for the app to keep functioning. Leaving those
--     commands without a policy means RLS denies them by default for
--     anon/authenticated — exactly what we want.
--   * Reads: nothing client-side reads this table today. We grant a
--     company-scoped SELECT to authenticated so an operator can legitimately
--     inspect their own company's onboarding drip state (and to mirror the
--     peer backend log table opportunity_lifecycle_action_audit, which uses
--     this identical posture). anon gets no policy at all → zero access.

alter table public.onboarding_email_log enable row level security;

-- Authenticated callers may read only their own company's rows. Scoping uses
-- the canonical security-definer helper (returns the caller's company_id as
-- uuid); company_id is NOT NULL on this table so every row is covered.
drop policy if exists onboarding_email_log_company_select
  on public.onboarding_email_log;

create policy onboarding_email_log_company_select
  on public.onboarding_email_log
  for select
  to authenticated
  using (company_id = (select private.get_user_company_id()));

-- No anon policy and no authenticated write policy by design:
--   anon            -> no policy  -> denied for all commands.
--   authenticated   -> SELECT only (above); insert/update/delete denied.
--   service_role    -> bypasses RLS, retains full access for the cron + routes.
