-- 012_create_photo_annotations.sql
-- Project photo annotations: drawing overlays and text notes for project photos

CREATE TABLE IF NOT EXISTS project_photo_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  annotation_url TEXT,
  note TEXT DEFAULT '',
  author_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_photo_annotations_project ON project_photo_annotations(project_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_photo_annotations_company ON project_photo_annotations(company_id)
  WHERE deleted_at IS NULL;

ALTER TABLE project_photo_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read company annotations"
  ON project_photo_annotations FOR SELECT
  USING (true);

CREATE POLICY "Users can create annotations"
  ON project_photo_annotations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update annotations"
  ON project_photo_annotations FOR UPDATE
  USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE project_photo_annotations;
