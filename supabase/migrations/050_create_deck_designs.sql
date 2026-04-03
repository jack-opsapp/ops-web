-- 050_create_deck_designs.sql
-- Deck Builder: drawing/sketching tool for deck & railing contractors

-- Add 'deck_design' to photo_source enum for project_photos integration
ALTER TYPE photo_source ADD VALUE IF NOT EXISTS 'deck_design';

-- Create deck_designs table
CREATE TABLE IF NOT EXISTS deck_designs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       TEXT NOT NULL,
  project_id       TEXT,                          -- nullable for standalone sketches
  title            TEXT NOT NULL DEFAULT 'Untitled Deck',
  drawing_data     JSONB NOT NULL DEFAULT '{}',   -- DeckDrawingData (vertices, edges, properties)
  thumbnail_url    TEXT,                          -- S3 URL of rendered PNG
  version          INT NOT NULL DEFAULT 1,
  created_by       TEXT,                          -- user ID
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_deck_designs_company ON deck_designs(company_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_deck_designs_project ON deck_designs(project_id, company_id)
  WHERE deleted_at IS NULL;

-- Row Level Security
ALTER TABLE deck_designs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deck_designs' AND policyname = 'company_isolation'
  ) THEN
    CREATE POLICY "company_isolation" ON deck_designs
      FOR ALL USING (company_id = (SELECT private.get_user_company_id())::text);
  END IF;
END $$;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE deck_designs;
