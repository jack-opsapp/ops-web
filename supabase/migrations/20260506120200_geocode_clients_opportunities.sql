-- Add lat/lng to clients (idempotent — already present, this migration is a no-op
-- for clients in production but ships the contract for fresh installs) and
-- opportunities (new). Drives the Project Workspace map fallback when the project
-- itself has no coordinates.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMENT ON COLUMN clients.latitude  IS 'Geocoded lat for map display. Populated by Mapbox Geocoding on address change.';
COMMENT ON COLUMN clients.longitude IS 'Geocoded lng for map display. Populated by Mapbox Geocoding on address change.';
COMMENT ON COLUMN opportunities.latitude  IS 'Geocoded lat for map display. Populated by Mapbox Geocoding on address change.';
COMMENT ON COLUMN opportunities.longitude IS 'Geocoded lng for map display. Populated by Mapbox Geocoding on address change.';

CREATE INDEX IF NOT EXISTS idx_clients_geo
  ON clients (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_geo
  ON opportunities (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
