-- Project site metadata for the operational dossier (Project Workspace modal).
-- Drives the SITE card in the Details tab and the editing form's Context tab.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS scope            TEXT,
  ADD COLUMN IF NOT EXISTS site_notes       TEXT,
  ADD COLUMN IF NOT EXISTS gate_code        TEXT,
  ADD COLUMN IF NOT EXISTS site_conditions  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS color            TEXT,
  ADD COLUMN IF NOT EXISTS visibility       TEXT DEFAULT 'all'
    CHECK (visibility IN ('all', 'office', 'private')),
  ADD COLUMN IF NOT EXISTS buffer_days      SMALLINT DEFAULT 0
    CHECK (buffer_days BETWEEN 0 AND 14);

COMMENT ON COLUMN projects.scope IS 'One-paragraph scope summary shown on the Details tab.';
COMMENT ON COLUMN projects.site_notes IS 'Free-text site access notes (e.g., "Gate code 4820, dogs on property").';
COMMENT ON COLUMN projects.gate_code IS 'Site gate/lockbox code surfaced in the SITE card.';
COMMENT ON COLUMN projects.site_conditions IS 'JSONB: { parking, pets[], power, hazards[] } used by the SITE card.';
COMMENT ON COLUMN projects.color IS 'User-picked accent color for calendar/board surfaces. Hex or token name.';
COMMENT ON COLUMN projects.visibility IS 'all | office | private. Drives portal exposure.';
COMMENT ON COLUMN projects.buffer_days IS 'Optional weather buffer days padded around start/end on the schedule strip.';

CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility) WHERE visibility != 'all';
