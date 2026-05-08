-- Add nullable trade category to projects.
-- iOS-additive: existing rows untouched, no NOT NULL, no default. iOS clients on
-- the prior release simply ignore the column until their next App Store update.
--
-- trade: web-side enum-as-text. Lowercase values to match the OPS DB convention
--   (project status, visibility, employee role all follow the same pattern).
--   The workspace UI uppercases for display ("ROOFING" / "HVAC" / "PLUMBING").
--   NULL = legacy projects created before this migration; the IdentityTab
--   leaves the field optional in editing mode for them, required when creating.
--
-- text + CHECK rather than CREATE TYPE: extending a Postgres enum requires
-- ALTER TYPE which is a stronger schema change. CHECK constraints are easier
-- to evolve as the trade catalogue grows.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS trade TEXT;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_trade_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_trade_check
  CHECK (trade IS NULL OR trade IN ('roofing', 'hvac', 'plumbing'));

COMMENT ON COLUMN projects.trade IS
  'Project trade category. Lowercase enum-as-text. NULL means unset (legacy projects).';
