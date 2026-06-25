-- ============================================================================
-- MIGRATION (leads-review C-7) — defense-in-depth, latent today
-- Make pipeline.manage a real SERVER-SIDE write boundary on the pipeline-owned
-- tables, mirroring the proven projects/clients role_scope_* pattern.
-- Authored 2026-05-31 by the LEADS pre-merge review. APPLIED to prod 2026-05-31
-- (migration: pipeline_tables_role_scope_write_rls) with explicit PM authorization
-- once leads work was confirmed solo. Verified live: opportunities + stage_transitions
-- now carry role_scope_insert/update/delete alongside company_isolation (and the
-- pre-existing role_scope_read on opportunities). Mirror into OPS-Web/supabase/migrations.
--
-- !! COORDINATE BEFORE APPLYING !!
-- `opportunities` is the hot table of the active, push-held lead-lifecycle
-- initiative (see the many ops-web-lead-lifecycle-* worktrees). Apply this only
-- after confirming with that initiative's owner that it does not collide with
-- their in-flight opportunities RLS / schema migrations. The gap this closes is
-- LATENT: every current role with pipeline.view also has pipeline.manage at
-- scope 'all' (verified 2026-05-31), so no live user can exploit it today — it
-- only matters once a custom role grants view-without-manage.
--
-- SCOPE: gates ONLY opportunities + stage_transitions (unambiguously pipeline-
-- owned). activities and follow_ups are DELIBERATELY EXCLUDED — they are shared
-- across email ingestion, clients, estimates, invoices, projects and agent
-- messages (activities has opportunity_id/client_id/estimate_id/invoice_id/
-- project_id/email_thread_id/...; follow_ups has client_id + is_auto_generated),
-- so gating them on pipeline.manage would break non-pipeline writers. Finer-
-- grained gating of those tables (e.g. conditional on opportunity_id) is a
-- separate, carefully-scoped task.
--
-- SAFE because (verified 2026-05-31): all client pipeline writers hold
-- pipeline.manage='all'; server/service-role writers BYPASS RLS;
-- convert_lead_to_project is SECURITY DEFINER (owner bypasses RLS, so its inserts
-- are unaffected); move_opportunity_stage is SECURITY INVOKER and its caller
-- holds pipeline.manage. SELECT is left to company_isolation so pipeline.view
-- users keep reading.
-- ============================================================================

-- opportunities -------------------------------------------------------------
DROP POLICY IF EXISTS role_scope_insert ON public.opportunities;
CREATE POLICY role_scope_insert ON public.opportunities
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (private.current_user_has_permission('pipeline.manage', 'all'));

DROP POLICY IF EXISTS role_scope_update ON public.opportunities;
CREATE POLICY role_scope_update ON public.opportunities
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (private.current_user_has_permission('pipeline.manage', 'all'))
  WITH CHECK (private.current_user_has_permission('pipeline.manage', 'all'));

DROP POLICY IF EXISTS role_scope_delete ON public.opportunities;
CREATE POLICY role_scope_delete ON public.opportunities
  AS RESTRICTIVE FOR DELETE TO public
  USING (private.current_user_has_permission('pipeline.manage', 'all'));

-- stage_transitions (append-only audit log) ---------------------------------
DROP POLICY IF EXISTS role_scope_insert ON public.stage_transitions;
CREATE POLICY role_scope_insert ON public.stage_transitions
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (private.current_user_has_permission('pipeline.manage', 'all'));

DROP POLICY IF EXISTS role_scope_update ON public.stage_transitions;
CREATE POLICY role_scope_update ON public.stage_transitions
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (private.current_user_has_permission('pipeline.manage', 'all'))
  WITH CHECK (private.current_user_has_permission('pipeline.manage', 'all'));

DROP POLICY IF EXISTS role_scope_delete ON public.stage_transitions;
CREATE POLICY role_scope_delete ON public.stage_transitions
  AS RESTRICTIVE FOR DELETE TO public
  USING (private.current_user_has_permission('pipeline.manage', 'all'));
