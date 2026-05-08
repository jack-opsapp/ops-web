-- Rollback fields cut from project workspace scope after design review (2026-05-06).
-- Surviving: visibility (still on projects). Dropped below.

ALTER TABLE projects
  DROP COLUMN IF EXISTS scope,
  DROP COLUMN IF EXISTS site_notes,
  DROP COLUMN IF EXISTS gate_code,
  DROP COLUMN IF EXISTS site_conditions,
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS buffer_days;

DROP TABLE IF EXISTS project_tag_assignments;
DROP TABLE IF EXISTS project_tags;
