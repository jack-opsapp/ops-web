-- Add images array to opportunities for photos extracted from email threads
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';

-- Index for querying opportunities that have images
CREATE INDEX IF NOT EXISTS idx_opportunities_has_images
ON opportunities ((array_length(images, 1) > 0))
WHERE array_length(images, 1) > 0;
