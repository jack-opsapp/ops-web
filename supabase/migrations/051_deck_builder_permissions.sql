-- =================================================================
-- Migration 051: Deck Builder Permissions
--
-- Feature-gates the deck builder exactly like accounting:
-- - Feature flag (OFF by default)
-- - RBAC permissions (deck_builder.view/create/edit)
-- - Role grants for all 5 preset roles
-- =================================================================

-- ── Add deck_builder permissions to the app_permission enum ──────

ALTER TYPE app_permission ADD VALUE IF NOT EXISTS 'deck_builder.view';
ALTER TYPE app_permission ADD VALUE IF NOT EXISTS 'deck_builder.create';
ALTER TYPE app_permission ADD VALUE IF NOT EXISTS 'deck_builder.edit';

-- ── Add feature flag (OFF by default) ───────────────────────────

INSERT INTO feature_flags (slug, label, enabled, description) VALUES
  ('deck_builder', 'Deck Builder', false, 'In-app deck drawing and estimation tool for deck & railing contractors')
ON CONFLICT (slug) DO NOTHING;

-- ── Grant permissions to preset roles ───────────────────────────
-- Role UUIDs verified against 015_permissions_system.sql:
--   Admin    = 00000000-0000-0000-0000-000000000001 (hierarchy 1)
--   Owner    = 00000000-0000-0000-0000-000000000002 (hierarchy 2)
--   Office   = 00000000-0000-0000-0000-000000000003 (hierarchy 3)
--   Operator = 00000000-0000-0000-0000-000000000004 (hierarchy 4)
--   Crew     = 00000000-0000-0000-0000-000000000005 (hierarchy 5)

INSERT INTO role_permissions (role_id, permission, scope) VALUES
  -- Admin: full access
  ('00000000-0000-0000-0000-000000000001', 'deck_builder.view', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'deck_builder.create', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'deck_builder.edit', 'all'),
  -- Owner: full access
  ('00000000-0000-0000-0000-000000000002', 'deck_builder.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'deck_builder.create', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'deck_builder.edit', 'all'),
  -- Office: full access
  ('00000000-0000-0000-0000-000000000003', 'deck_builder.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'deck_builder.create', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'deck_builder.edit', 'all'),
  -- Operator: view + create assigned (no edit)
  ('00000000-0000-0000-0000-000000000004', 'deck_builder.view', 'assigned'),
  ('00000000-0000-0000-0000-000000000004', 'deck_builder.create', 'assigned'),
  -- Crew: view assigned only
  ('00000000-0000-0000-0000-000000000005', 'deck_builder.view', 'assigned')
ON CONFLICT (role_id, permission) DO NOTHING;
