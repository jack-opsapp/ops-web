-- ═══════════════════════════════════════════════════════════════
-- Migration 027: Add weather_dependent column to companies
--
-- The setup flow collects whether a company's work is weather-
-- dependent, but the column was missing from the table.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS weather_dependent BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN companies.weather_dependent
  IS 'Whether the company work is weather-dependent (set during onboarding)';
