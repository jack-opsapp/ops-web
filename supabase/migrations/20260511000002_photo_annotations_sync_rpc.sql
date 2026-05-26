-- Migration: photo_annotations_sync_rpc
-- Spawned by: RLS HARDENING - P1-2
-- Spec:        ops-software-bible/specs/2026-05-10-lidar-dimensioned-photo-capture-design.md §13.1
-- Tracks bug:  bug_reports.id = ded38a1f-70a4-4f2e-af96-e6d429968632
--
-- Context: Migration 20260511000001 tightened the SELECT policy on
-- project_photo_annotations to enforce `deleted_at IS NULL` per spec §13.1.
-- That correctly hides tombstones from "normal" reads, but it also hides
-- them from the iOS sync pull at InboundProcessor.syncPhotoAnnotations,
-- which depends on soft-deleted rows flowing through so that
-- mergePhotoAnnotation can propagate `deleted_at` into local SwiftData on
-- every device.
--
-- Fix: introduce a SECURITY DEFINER RPC that bypasses the SELECT policy's
-- soft-delete guard while performing its OWN company-scoping check inside
-- the function body (so the RPC remains as tight as the policy it replaces
-- for sync). The strict SELECT policy stays in place for direct table
-- reads — only the dedicated sync entry point uses the RPC.
--
-- Safety:
--   - The function checks `private.get_user_company_id()` first. That
--     helper returns NULL when there is no authenticated user, no matching
--     row in public.users, no company_id, or the user is soft-deleted —
--     so unauthenticated callers short-circuit to an empty result set.
--   - Rows are filtered by `company_id = v_company_id::text`. The cast
--     mirrors the SELECT policy (company_id column is TEXT; helper returns
--     UUID).
--   - The `p_since` filter mirrors the prior PostgREST call exactly:
--     `.gte("updated_at", since)` → `updated_at >= p_since`. When
--     p_since is NULL the filter is skipped.
--   - EXECUTE is revoked from PUBLIC and granted only to `authenticated`.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_photo_annotations_since(
  p_since timestamptz DEFAULT NULL
)
RETURNS SETOF public.project_photo_annotations
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  v_company_id := private.get_user_company_id();
  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.project_photo_annotations
  WHERE company_id = v_company_id::text
    AND (p_since IS NULL OR updated_at >= p_since)
  ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_photo_annotations_since(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_photo_annotations_since(timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_photo_annotations_since IS
  'Company-scoped pull of project_photo_annotations including soft-deleted rows so iOS InboundProcessor can propagate tombstones to local SwiftData. SECURITY DEFINER bypasses the strict SELECT policy that hides deleted_at IS NOT NULL rows; the function applies its own company scoping via private.get_user_company_id().';

COMMIT;

-- Post-apply verification queries:
--
--   -- 1. Function exists with the right signature and is SECURITY DEFINER:
--   SELECT prosecdef, pg_get_function_arguments(oid), pg_get_function_result(oid)
--   FROM pg_proc WHERE proname = 'get_photo_annotations_since'
--     AND pronamespace = 'public'::regnamespace;
--
--   -- Expected: prosecdef = true, args = 'p_since timestamp with time zone DEFAULT NULL'
--
--   -- 2. Confirm authenticated has EXECUTE, PUBLIC does not:
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_schema = 'public' AND routine_name = 'get_photo_annotations_since';
--
--   -- 3. Round-trip soft-delete propagation test (run as auth'd user):
--   --    a. INSERT a row → call RPC → confirm visible
--   --    b. UPDATE deleted_at = now() → call RPC → confirm STILL visible
--   --       (this is the regression fix — direct SELECT would now hide it)
--   --    c. Direct SELECT same id → confirm NOT visible (policy still enforced)
