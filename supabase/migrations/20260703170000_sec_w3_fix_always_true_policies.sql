-- W3 security posture sweep — fix `rls_policy_always_true` exposures on the three
-- ops-web-owned tables where an always-true predicate is a real exposure (not
-- intentional write-only public ingestion).
--
-- Background: bug_reports/c5ff388e ("31 tables RLS disabled") is stale — 0 public
-- tables have RLS disabled today. The live advisor posture includes 14
-- rls_policy_always_true policies. Most are legitimate write-only public ingestion
-- (analytics_events / newsletter_subscribers / onboarding_analytics /
-- tutorial_analytics / assessment_* INSERTs) and are deliberately left open — an
-- INSERT ... WITH CHECK (true) exposes no data. These three are the genuine holes:
--
--   * qa_bugs "Service role full access" — ALL / USING(true) / WITH CHECK(true) to
--     {public}: every anon caller had full CRUD (incl. DELETE) over 234 QA rows
--     holding DOM snapshots + console errors. The QA harness writes via service_role
--     (bug-triage crons use getServiceRoleClient) and agents run as postgres; both
--     bypass RLS (pg_roles.rolbypassrls verified true), so no anon policy is needed.
--     Restrict to the global operator (private.is_ops_admin()).
--   * beta_access_requests "beta_requests_select" — SELECT / USING(true) to {public}:
--     any anon could read every request's user_email / user_name / company_name. The
--     only client reader (use-feature-access-requests.ts) filters
--     .eq('user_id', uid); admin reads use a service_role route. Scope to own rows.
--   * duplicate_reviews "Service role can insert" — INSERT / WITH CHECK(true) to
--     {public}: any anon could insert a review row for any company. SELECT/UPDATE are
--     already company-scoped (crit3). Bring INSERT in line. Merge-engine writes are
--     service_role (bypass RLS) so this only constrains bridged clients.
--
-- All identity/company scoping uses the Firebase-safe helpers (auth.uid() is
-- unusable under the JWT bridge — 'sub' is a non-uuid Firebase UID). Idempotent
-- (drop-if-exists + create) and guarded by an in-migration sentinel.

begin;

set local search_path = public, private, pg_temp;

-- 1. qa_bugs — operator-only (drops the anon full-CRUD policy).
drop policy if exists "Service role full access" on public.qa_bugs;
create policy "qa_bugs_ops_admin_all" on public.qa_bugs
  for all
  to public
  using (private.is_ops_admin())
  with check (private.is_ops_admin());

-- 2. beta_access_requests — caller reads only their own requests.
drop policy if exists "beta_requests_select" on public.beta_access_requests;
create policy "beta_requests_select_own" on public.beta_access_requests
  for select
  to public
  using (user_id = private.get_current_user_id()::text);

-- 3. duplicate_reviews — INSERT constrained to the caller's own company (mirrors the
--    existing crit3 company-isolation SELECT/UPDATE policies on this table).
drop policy if exists "Service role can insert" on public.duplicate_reviews;
create policy "duplicate_reviews_insert_company" on public.duplicate_reviews
  for insert
  to public
  with check (
    company_id in (
      select users.company_id from users where users.id = private.get_current_user_id()
    )
  );

-- Sentinel: the three original always-true policies must be gone, the three
-- replacements must exist, and no replacement may still evaluate to a bare `true`.
do $do$
declare
  v_old int;
  v_new int;
  v_true int;
begin
  select count(*) into v_old
  from pg_policies
  where schemaname = 'public' and (
       (tablename = 'qa_bugs'              and policyname = 'Service role full access')
    or (tablename = 'beta_access_requests' and policyname = 'beta_requests_select')
    or (tablename = 'duplicate_reviews'    and policyname = 'Service role can insert')
  );
  if v_old <> 0 then
    raise exception 'sec_w3_always_true_sentinel: % original always-true policy(ies) still present', v_old;
  end if;

  select count(*) into v_new
  from pg_policies
  where schemaname = 'public' and (
       (tablename = 'qa_bugs'              and policyname = 'qa_bugs_ops_admin_all')
    or (tablename = 'beta_access_requests' and policyname = 'beta_requests_select_own')
    or (tablename = 'duplicate_reviews'    and policyname = 'duplicate_reviews_insert_company')
  );
  if v_new <> 3 then
    raise exception 'sec_w3_always_true_sentinel: expected 3 replacement policies, found %', v_new;
  end if;

  select count(*) into v_true
  from pg_policies
  where schemaname = 'public'
    and tablename in ('qa_bugs','beta_access_requests','duplicate_reviews')
    and policyname in ('qa_bugs_ops_admin_all','beta_requests_select_own','duplicate_reviews_insert_company')
    and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true');
  if v_true <> 0 then
    raise exception 'sec_w3_always_true_sentinel: % replacement policy(ies) still evaluate to true', v_true;
  end if;
end
$do$;

commit;
