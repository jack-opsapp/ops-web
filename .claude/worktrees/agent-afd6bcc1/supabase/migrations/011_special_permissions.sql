-- ═══════════════════════════════════════════════════════════════
-- Migration 011: Special Permissions on Users
--
-- Adds a TEXT[] column `special_permissions` to the users table.
-- Used to beta-test features without hardcoding user access.
--
-- Admin console can set values like: {'inventoryAccess', 'betaDashboard'}
-- Mobile app checks: special_permissions @> ARRAY['inventoryAccess']
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS special_permissions TEXT[] DEFAULT '{}';

-- Index for array containment queries (GIN index)
CREATE INDEX IF NOT EXISTS idx_users_special_permissions
  ON users USING GIN (special_permissions);
