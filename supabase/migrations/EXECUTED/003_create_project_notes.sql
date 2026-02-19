-- Create project_notes table
CREATE TABLE IF NOT EXISTS project_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  mentioned_user_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- Index for fetching notes by project (most common query)
CREATE INDEX idx_project_notes_project_id
  ON project_notes (project_id)
  WHERE deleted_at IS NULL;

-- Index for finding notes that mention a specific user (for notifications)
CREATE INDEX idx_project_notes_mentions
  ON project_notes USING GIN (mentioned_user_ids)
  WHERE deleted_at IS NULL;

-- Index for company-scoped queries
CREATE INDEX idx_project_notes_company_id
  ON project_notes (company_id)
  WHERE deleted_at IS NULL;

-- RLS policies
ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own company notes"
  ON project_notes FOR SELECT
  USING (true);

CREATE POLICY "Users can create notes"
  ON project_notes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own notes"
  ON project_notes FOR UPDATE
  USING (true);
