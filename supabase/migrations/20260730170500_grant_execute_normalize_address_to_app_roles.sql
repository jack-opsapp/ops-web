-- INCIDENT FIX — "permission denied for function normalize_address" on every
-- qualifying project write from the app.
--
-- STATUS: APPLIED to prod ijeekuhbatykdomumfjx on 2026-07-30 via MCP
-- apply_migration (name: grant_execute_normalize_address_to_app_roles). This
-- file is the repo record of that applied change. Idempotent — GRANT is safe
-- to re-run.
--
-- ROOT CAUSE
-- public.projects carries a partial index whose expression calls the function:
--
--   CREATE INDEX projects_active_company_normalized_address_idx
--     ON public.projects (company_id, private.normalize_address(address))
--     WHERE deleted_at IS NULL
--       AND status IN ('rfq','estimated','accepted','in_progress');
--
-- Postgres evaluates an index expression in the CALLING role's context on
-- every INSERT/UPDATE that maintains the index — it is not covered by any
-- SECURITY DEFINER wrapper. private.normalize_address(text) had its default
-- owner-only ACL (postgres=X/postgres), so the app roles (the iOS app runs as
-- anon under the Firebase JWT bridge) could not execute it and every
-- qualifying project write failed. Bug row aa38ddf9.
--
-- The function is a pure text normalizer (SECURITY INVOKER, no table access),
-- so granting EXECUTE exposes nothing the caller did not already supply.
-- A post-apply sweep of every public-table index expression calling a private.
-- function confirmed this was the only instance of the trap.

grant execute on function private.normalize_address(text)
  to anon, authenticated, service_role;
