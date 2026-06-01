-- #3 rls_enabled_no_policy: these tables have RLS enabled with zero policies, so anon/authenticated
-- are already default-denied -- but they still hold broad CRUD grants, which is latent risk (a single
-- accidental permissive policy or RLS-disable would instantly expose them; portal_tokens/portal_sessions
-- hold portal session tokens). All are written/read by server-side service-role jobs/routes only
-- (verified: project_team_members/task_team_members have zero web+iOS refs; the rest are ads/email/
-- portal/admin backend). Revoke the client grants to make the deny-all explicit. service_role keeps
-- access (rolbypassrls=true + its own grants). This changes nothing functional for the app.
REVOKE ALL ON public.ad_briefings               FROM anon, authenticated;
REVOKE ALL ON public.admin_feature_overrides    FROM anon, authenticated;
REVOKE ALL ON public.ads_daily_account          FROM anon, authenticated;
REVOKE ALL ON public.ads_daily_campaign         FROM anon, authenticated;
REVOKE ALL ON public.ads_daily_keyword          FROM anon, authenticated;
REVOKE ALL ON public.ads_sync_status            FROM anon, authenticated;
REVOKE ALL ON public.email_events               FROM anon, authenticated;
REVOKE ALL ON public.email_ingest_heartbeat_log FROM anon, authenticated;
REVOKE ALL ON public.lifecycle_email_config     FROM anon, authenticated;
REVOKE ALL ON public.newsletter_content         FROM anon, authenticated;
REVOKE ALL ON public.onboarding_events          FROM anon, authenticated;
REVOKE ALL ON public.portal_sessions            FROM anon, authenticated;
REVOKE ALL ON public.portal_tokens              FROM anon, authenticated;
REVOKE ALL ON public.project_team_members       FROM anon, authenticated;
REVOKE ALL ON public.task_team_members          FROM anon, authenticated;

-- document_templates is the one of the 16 with legitimate app access (web invoice/estimate/portal
-- routes + document-template-service). company_id is uuid. Add company isolation so RLS stops
-- default-denying it: anon w/o context -> 0 rows, authenticated -> own company, service_role bypasses.
CREATE POLICY company_isolation ON public.document_templates
  FOR ALL TO public
  USING (company_id = (SELECT private.get_user_company_id()));
