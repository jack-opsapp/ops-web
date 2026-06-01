-- Remediate live cross-tenant exposures surfaced by get_advisors `rls_policy_always_true`
-- during the post-Books "Mission Deck" security review (2026-06-01). Each table below had a
-- PERMISSIVE policy with USING(true) for role `public` plus anon+authenticated CRUD grants, so
-- the shipped anon key could read/write every company's rows via the Data API -- the same class
-- of unauthenticated cross-tenant breach the Books review fixed for `expenses`, on tables that
-- fix did not cover. App access model + column types + id encodings verified before each change.

-- == accounting_* : server/service-role ONLY (OAuth tokens, sync logs, GL mappings) ==========
-- Verified: only api/integrations/{quickbooks,sage}, api/sync, api/cron/accounting-sync and
-- lib/api/services/accounting-* touch these, all via getServiceRoleClient(). No browser/iOS path.
-- service_role has rolbypassrls=true, so it retains full access after client grants are revoked.
REVOKE ALL ON public.accounting_connections        FROM anon, authenticated;
REVOKE ALL ON public.accounting_sync_log           FROM anon, authenticated;
REVOKE ALL ON public.accounting_category_mappings  FROM anon, authenticated;

DROP POLICY IF EXISTS company_access ON public.accounting_connections;
DROP POLICY IF EXISTS company_access ON public.accounting_sync_log;
DROP POLICY IF EXISTS "Company members can access accounting_category_mappings" ON public.accounting_category_mappings;

CREATE POLICY service_role_only ON public.accounting_connections       FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_only ON public.accounting_sync_log          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_only ON public.accounting_category_mappings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- == expense_batches / expense_settings : company isolation (expense siblings Books missed) ==
-- company_id is uuid; mirrors company_isolation from 20260531200227_fix_expenses_rls_*.
DROP POLICY IF EXISTS "Company members can access expense_batches"  ON public.expense_batches;
DROP POLICY IF EXISTS "Company members can access expense_settings" ON public.expense_settings;
CREATE POLICY company_isolation ON public.expense_batches  FOR ALL TO public USING (company_id = (SELECT private.get_user_company_id()));
CREATE POLICY company_isolation ON public.expense_settings FOR ALL TO public USING (company_id = (SELECT private.get_user_company_id()));

-- == project_notes : company isolation (company_id is TEXT = companies.id; verified 90/90) ====
DROP POLICY IF EXISTS "Users can read own company notes" ON public.project_notes;
DROP POLICY IF EXISTS "Users can create notes"           ON public.project_notes;
DROP POLICY IF EXISTS "Users can update own notes"       ON public.project_notes;
CREATE POLICY company_isolation ON public.project_notes
  FOR ALL TO public
  USING (company_id = (SELECT private.get_user_company_id())::text)
  WITH CHECK (company_id = (SELECT private.get_user_company_id())::text);

-- == notifications : per-recipient scope (user_id/company_id are TEXT = users.id/companies.id; 393/393) ==
-- Reads/updates scope to the recipient; inserts to the caller's company (server creation uses
-- service_role and bypasses RLS).
DROP POLICY IF EXISTS "Users can read own notifications"   ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can create notifications"     ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO public USING (user_id = (SELECT private.get_current_user_id())::text);
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO public USING (user_id = (SELECT private.get_current_user_id())::text)
                       WITH CHECK (user_id = (SELECT private.get_current_user_id())::text);
CREATE POLICY notifications_insert_company ON public.notifications
  FOR INSERT TO public WITH CHECK (company_id = (SELECT private.get_user_company_id())::text);

-- == crew_locations : drop misnamed public USING(true) policy; keep org/own-scoped policies ==
-- "Service role full access to crew_locations" targeted role `public` with USING(true), overriding
-- the correct org-scoped read + own-location write policies (which use private.resolve_uid()).
-- Replace with a real service_role policy; the scoped public policies remain and now bind.
DROP POLICY IF EXISTS "Service role full access to crew_locations" ON public.crew_locations;
CREATE POLICY service_role_all ON public.crew_locations FOR ALL TO service_role USING (true) WITH CHECK (true);
