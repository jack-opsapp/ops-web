-- Project tags — many-to-many. Used in the Context tab + future filtering.
-- RLS uses the canonical OPS pattern: private.get_user_company_id() for company
-- isolation, private.current_user_has_permission('projects.edit', 'all') for write
-- access (tag CRUD piggybacks on project edit), and private.current_user_is_admin()
-- as escape hatch.

CREATE TABLE IF NOT EXISTS project_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  tone        TEXT NOT NULL DEFAULT 'neutral'
    CHECK (tone IN ('neutral','olive','tan','rose','accent')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_project_tags_company_label
  ON project_tags (company_id, lower(label));

CREATE TABLE IF NOT EXISTS project_tag_assignments (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES project_tags(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_project_tag_assignments_project ON project_tag_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tag_assignments_tag ON project_tag_assignments(tag_id);

COMMENT ON TABLE project_tags IS 'Per-company project tag library. Many-to-many via project_tag_assignments.';
COMMENT ON COLUMN project_tags.tone IS 'Visual tone token. neutral | olive | tan | rose | accent. Drives chip color in the workspace.';
COMMENT ON TABLE project_tag_assignments IS 'Join table: which tags are applied to which projects.';

ALTER TABLE project_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tag_assignments ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- project_tags policies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "company_isolation_select"
  ON project_tags FOR SELECT
  USING (company_id = (SELECT private.get_user_company_id()));

CREATE POLICY "company_managers_insert"
  ON project_tags FOR INSERT
  WITH CHECK (
    company_id = (SELECT private.get_user_company_id())
    AND (
      private.current_user_is_admin()
      OR private.current_user_has_permission('projects.edit', 'all')
    )
  );

CREATE POLICY "company_managers_update"
  ON project_tags FOR UPDATE
  USING (
    company_id = (SELECT private.get_user_company_id())
    AND (
      private.current_user_is_admin()
      OR private.current_user_has_permission('projects.edit', 'all')
    )
  );

CREATE POLICY "company_managers_delete"
  ON project_tags FOR DELETE
  USING (
    company_id = (SELECT private.get_user_company_id())
    AND (
      private.current_user_is_admin()
      OR private.current_user_has_permission('projects.edit', 'all')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- project_tag_assignments policies
-- Visible/writable when the underlying project is visible/editable to the user.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "assignments_select_when_project_visible"
  ON project_tag_assignments FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects
      WHERE company_id = (SELECT private.get_user_company_id())
    )
  );

CREATE POLICY "assignments_insert_when_project_editable"
  ON project_tag_assignments FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects
      WHERE company_id = (SELECT private.get_user_company_id())
    )
    AND (
      private.current_user_is_admin()
      OR private.current_user_has_permission('projects.edit', 'all')
      OR (
        private.current_user_scope_for('projects.edit') = 'assigned'
        AND private.current_user_in_project(project_id)
      )
    )
  );

CREATE POLICY "assignments_delete_when_project_editable"
  ON project_tag_assignments FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM projects
      WHERE company_id = (SELECT private.get_user_company_id())
    )
    AND (
      private.current_user_is_admin()
      OR private.current_user_has_permission('projects.edit', 'all')
      OR (
        private.current_user_scope_for('projects.edit') = 'assigned'
        AND private.current_user_in_project(project_id)
      )
    )
  );
