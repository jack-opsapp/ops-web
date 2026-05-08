-- Add typed attachment_ids array to activities. Distinct from the existing
-- text[] `attachments` column (which stores arbitrary URLs/keys). The new uuid[]
-- column references project_photos.id so the workspace timeline can resolve
-- thumbnails + URLs reliably without parsing free-form strings.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS attachment_ids UUID[] DEFAULT ARRAY[]::UUID[];

COMMENT ON COLUMN activities.attachment_ids IS 'References to project_photos.id for activity entries with photo attachments. Distinct from the legacy attachments text[] column.';

CREATE INDEX IF NOT EXISTS idx_activities_attachments
  ON activities USING GIN (attachment_ids)
  WHERE array_length(attachment_ids, 1) > 0;
