-- Loosen project_photos INSERT policy so anyone with view-scope on a project
-- can upload photos to it. Background: when 20260513184821 (projects_table_v2
-- phase 4) tightened the photo INSERT to require projects.edit, Crew /
-- Unassigned roles assigned to a project lost the ability to add photos even
-- to projects they could see and were working on. Per product owner: "anyone
-- who has visibility to a project needs to be able to upload photos." UPDATE
-- and DELETE remain edit-gated — caption edits, client-visibility toggle and
-- soft-delete still belong to project editors.

-- 1. New helper, mirroring private.current_user_can_edit_project but gating
--    on projects.view scope instead of projects.edit. Admins always pass.
CREATE OR REPLACE FUNCTION private.current_user_can_view_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND p.company_id = (SELECT private.get_user_company_id())
  ) AND (
    private.current_user_is_admin()
    OR private.current_user_scope_for('projects.view') = 'all'
    OR (
      private.current_user_scope_for('projects.view') = 'assigned'
      AND private.current_user_in_project(p_project_id)
    )
  );
$function$;

GRANT EXECUTE ON FUNCTION private.current_user_can_view_project(uuid) TO authenticated;

-- 2. Swap the INSERT policy on project_photos.
DROP POLICY IF EXISTS "project table photos insert requires project edit"
  ON public.project_photos;

CREATE POLICY "project_photos insert requires project view"
  ON public.project_photos
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    company_id = (SELECT private.get_user_company_id())::text
    AND uploaded_by = (SELECT private.get_current_user_id())::text
    AND private.project_table_project_id_from_text(project_id) IS NOT NULL
    AND private.current_user_can_view_project(
      private.project_table_project_id_from_text(project_id)
    )
  );
