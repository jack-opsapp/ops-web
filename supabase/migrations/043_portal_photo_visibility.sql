-- 043_portal_photo_visibility.sql
-- Add client visibility flag to project photos for portal display control

ALTER TABLE project_photos
  ADD COLUMN is_client_visible BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_project_photos_client_visible
  ON project_photos (project_id, is_client_visible)
  WHERE is_client_visible = true AND deleted_at IS NULL;

COMMENT ON COLUMN project_photos.is_client_visible IS 'When true, photo is visible to clients in the portal. Crew uploads default to false.';
