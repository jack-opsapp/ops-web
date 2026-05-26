-- Migration: tighten_rls_project_photo_annotations
-- Spawned by: RLS HARDENING - P1-1
-- Spec: ops-software-bible/specs/2026-05-10-lidar-dimensioned-photo-capture-design.md §13.1
--
-- Problem (pre-existing, NOT introduced by this migration):
--   project_photo_annotations had three wide-open RLS policies, all
--   evaluating to `true` with no company_id or project_id scoping. Any
--   authenticated user in any company could read/write/edit any other
--   company's photo annotations.
--
-- Origin: migration 012_create_photo_annotations.sql lines 25-35 shipped
--   the table with USING (true) / WITH CHECK (true) placeholders that were
--   never tightened. Verified live via pg_policy query on 2026-05-10.
--
-- Fix: replace all three policies with company-scoped equivalents using
--   `private.get_user_company_id()` — the canonical helper used by every
--   modern company-scoped table in this codebase. The TEXT cast matches
--   migration 050_create_deck_designs.sql (deck_designs.company_id is also
--   TEXT, same as project_photo_annotations.company_id).
--
-- SELECT additionally enforces a soft-delete guard (`deleted_at IS NULL`)
-- per spec §13.1.
--
-- iOS impact (verified 2026-05-11 against PhotoAnnotationRepository.swift):
--   - fetchForProject / fetchForPhoto already filter `.eq("company_id")`
--     and `.is("deleted_at", value: nil)` → continue to work identically.
--   - upsert / create / updateAnnotation / softDelete operate by id within
--     the same auth context; company_id is set on insert by
--     UpsertPhotoAnnotationDTO (Network/Supabase/DTOs/PhotoAnnotationDTOs.swift:58).
--   - **fetchAll(since:) sync regression**: InboundProcessor.syncPhotoAnnotations
--     relies on the server returning soft-deleted rows so that
--     mergePhotoAnnotation can propagate `deleted_at` into local SwiftData.
--     With the new soft-delete guard on SELECT, soft-deleted rows are
--     invisible to PostgREST. Soft-deletes made on device A will not
--     propagate to device B via the InboundProcessor pull path.
--     Mitigation options (out of scope for this migration; tracked as
--     follow-up): (a) remove the deleted_at clause from the SELECT policy
--     and rely on query-level filters as other tables do, or (b) add a
--     SECURITY DEFINER RPC that returns rows including deletions for
--     authenticated company members, and switch InboundProcessor to call
--     it instead of the table SELECT.

BEGIN;

-- Defensive drops: re-runnable migration.
DROP POLICY IF EXISTS "Users can read company annotations" ON public.project_photo_annotations;
DROP POLICY IF EXISTS "Users can create annotations"       ON public.project_photo_annotations;
DROP POLICY IF EXISTS "Users can update annotations"       ON public.project_photo_annotations;

-- SELECT: company-scoped + soft-delete guard.
CREATE POLICY "Users can read company annotations"
  ON public.project_photo_annotations
  FOR SELECT
  USING (
    company_id = (SELECT private.get_user_company_id())::text
    AND deleted_at IS NULL
  );

-- INSERT: company-scoped. WITH CHECK enforces that new rows belong to the
-- authenticated user's company; clients writing a foreign company_id will
-- be rejected at the DB layer.
CREATE POLICY "Users can create annotations"
  ON public.project_photo_annotations
  FOR INSERT
  WITH CHECK (
    company_id = (SELECT private.get_user_company_id())::text
  );

-- UPDATE: company-scoped on both USING (which row is visible to update)
-- and WITH CHECK (what the row may become). Note: soft-delete is performed
-- by setting deleted_at on the row itself — UPDATE intentionally does NOT
-- include the deleted_at IS NULL guard, otherwise softDelete() would
-- become impossible (the row becomes invisible mid-update).
CREATE POLICY "Users can update annotations"
  ON public.project_photo_annotations
  FOR UPDATE
  USING (
    company_id = (SELECT private.get_user_company_id())::text
  )
  WITH CHECK (
    company_id = (SELECT private.get_user_company_id())::text
  );

COMMIT;

-- Post-apply verification queries (run as the same Firebase JWT user, then
-- as a foreign-company user, to confirm scoping holds end-to-end):
--
--   -- 1. Inspect installed policies:
--   SELECT polname, pg_get_expr(polqual, polrelid)      AS using_expr,
--                   pg_get_expr(polwithcheck, polrelid) AS check_expr
--   FROM pg_policy
--   WHERE polrelid = 'public.project_photo_annotations'::regclass;
--
--   -- Expected: three rows, none with using_expr/check_expr = 'true'.
--
--   -- 2. Cross-company read attempt (run as authenticated user of company A
--   --    against a known row of company B):
--   SELECT COUNT(*) FROM public.project_photo_annotations
--   WHERE company_id = '<foreign-company-id>';
--
--   -- Expected: 0.
--
--   -- 3. Cross-company write attempt:
--   INSERT INTO public.project_photo_annotations
--     (project_id, company_id, photo_url, author_id)
--   VALUES ('<any-project>', '<foreign-company-id>', 'test', 'test');
--
--   -- Expected: ERROR — new row violates row-level security policy.
