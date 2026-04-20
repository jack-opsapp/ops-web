-- Migration 074: Mention-based project access (Bug G9)
--
-- Adds a new read-only access helper `private.current_user_can_view_project`
-- that extends `private.current_user_in_project` with a mention-based path.
-- A user tagged in any live (deleted_at IS NULL) note on a project gains
-- read access to the project and its tasks at "assigned" scope.
--
-- Mention-grant is INTENTIONALLY view-only. The existing `current_user_in_project`
-- helper is untouched so WRITE policies on projects / project_tasks / estimates /
-- invoices continue to require team membership. Enforced at the database layer —
-- defense in depth even if client code forgets to gate.
--
-- Surfaces affected (read only):
--   projects.role_scope_read    — extended to mention-granted
--   project_tasks.role_scope_read — extended to mention-granted
--
-- Surfaces intentionally NOT changed:
--   projects.role_scope_update    — team-only (no mention writes)
--   project_tasks.role_scope_update — team-only
--   estimates.*                   — out of scope; extend in follow-up if needed
--   invoices.*                    — out of scope
--   project_notes.*               — currently company-wide open; out of scope
--
-- Indexes relied on (already exist, verified 2026-04-20):
--   idx_project_notes_mentions — GIN on mentioned_user_ids WHERE deleted_at IS NULL
--   idx_project_notes_project_id — btree on project_id WHERE deleted_at IS NULL
--
-- Type note: project_notes.project_id is TEXT (not uuid). The helper casts
-- projects.id::text for the equality comparison.

BEGIN;

-- 1. New helper: extended project view access (team OR mention).
CREATE OR REPLACE FUNCTION private.current_user_can_view_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT private.current_user_in_project(p_project_id)
      OR EXISTS (
        SELECT 1 FROM public.project_notes pn
        WHERE pn.project_id = p_project_id::text
          AND pn.deleted_at IS NULL
          AND private.get_current_user_id()::text = ANY(COALESCE(pn.mentioned_user_ids, ARRAY[]::text[]))
      );
$function$;

COMMENT ON FUNCTION private.current_user_can_view_project(uuid) IS
  'Read-only access helper for the projects domain. Superset of '
  'current_user_in_project — adds mention-based grant from '
  'project_notes.mentioned_user_ids (Bug G9, 2026-04-20). MUST NOT be used in '
  'UPDATE/DELETE/INSERT policies; mention grants are view-only.';

-- 2. Extend projects.role_scope_read to honor mention-based grant.
DROP POLICY IF EXISTS role_scope_read ON public.projects;
CREATE POLICY role_scope_read ON public.projects
FOR SELECT
USING (
  private.current_user_is_admin() OR
  CASE private.current_user_scope_for('projects.view')
    WHEN 'all' THEN true
    WHEN 'assigned' THEN private.current_user_can_view_project(projects.id)
    ELSE false
  END
);

-- 3. Extend project_tasks.role_scope_read to honor mention-based grant.
--    Keeps the direct "user on this task" check explicit; falls through to the
--    project-level helper for the inherited cases.
DROP POLICY IF EXISTS role_scope_read ON public.project_tasks;
CREATE POLICY role_scope_read ON public.project_tasks
FOR SELECT
USING (
  private.current_user_is_admin() OR
  CASE private.current_user_scope_for('tasks.view')
    WHEN 'all' THEN true
    WHEN 'assigned' THEN (
      (private.get_current_user_id()::text = ANY (COALESCE(team_member_ids, ARRAY[]::text[])))
      OR private.current_user_can_view_project(project_id)
    )
    ELSE false
  END
);

-- 4. WRITE policies are INTENTIONALLY NOT TOUCHED.
--    projects.role_scope_update and project_tasks.role_scope_update continue
--    to call current_user_in_project (team-only). Mention-only users cannot
--    update any row — Rule 1/Rule 2 enforced at DB.

COMMIT;

-- Verification queries (run as a mention-granted, non-team user in psql with
-- SET role + SET auth.jwt.claims.email after migration):
--   SELECT id FROM projects WHERE id = '<mention-granted-project-id>';
--     -> should return 1 row
--   UPDATE projects SET title = 'x' WHERE id = '<mention-granted-project-id>';
--     -> should return 0 rows (RLS blocks)
--   SELECT id FROM project_tasks WHERE project_id = '<mention-granted-project-id>';
--     -> should return all tasks on that project
--   UPDATE project_tasks SET status = 'done' WHERE project_id = '<mention-granted-project-id>';
--     -> should return 0 rows
