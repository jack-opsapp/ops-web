-- ============================================================
-- Migration 017: Permissions Audit Additions
-- Adds new permission enum values for expenses, invoices, and
-- estimates; seeds them into preset roles; and creates feature
-- flag rows for estimates, invoices, products, inventory, and
-- the client portal.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New app_permission enum values
-- ------------------------------------------------------------

ALTER TYPE app_permission ADD VALUE IF NOT EXISTS 'expenses.delete';
ALTER TYPE app_permission ADD VALUE IF NOT EXISTS 'expenses.configure';
ALTER TYPE app_permission ADD VALUE IF NOT EXISTS 'invoices.void';
ALTER TYPE app_permission ADD VALUE IF NOT EXISTS 'estimates.convert';

-- ------------------------------------------------------------
-- 2. Seed new permissions into preset roles
-- ------------------------------------------------------------

-- ADMIN (00000000-0000-0000-0000-000000000001) — all 4, scope='all'
INSERT INTO role_permissions (role_id, permission, scope)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'expenses.delete',    'all'),
  ('00000000-0000-0000-0000-000000000001', 'expenses.configure', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'invoices.void',      'all'),
  ('00000000-0000-0000-0000-000000000001', 'estimates.convert',  'all')
ON CONFLICT (role_id, permission) DO NOTHING;

-- OWNER (00000000-0000-0000-0000-000000000002) — all 4, scope='all'
INSERT INTO role_permissions (role_id, permission, scope)
VALUES
  ('00000000-0000-0000-0000-000000000002', 'expenses.delete',    'all'),
  ('00000000-0000-0000-0000-000000000002', 'expenses.configure', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'invoices.void',      'all'),
  ('00000000-0000-0000-0000-000000000002', 'estimates.convert',  'all')
ON CONFLICT (role_id, permission) DO NOTHING;

-- OFFICE (00000000-0000-0000-0000-000000000003) — all 4, scope='all'
INSERT INTO role_permissions (role_id, permission, scope)
VALUES
  ('00000000-0000-0000-0000-000000000003', 'expenses.delete',    'all'),
  ('00000000-0000-0000-0000-000000000003', 'expenses.configure', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'invoices.void',      'all'),
  ('00000000-0000-0000-0000-000000000003', 'estimates.convert',  'all')
ON CONFLICT (role_id, permission) DO NOTHING;

-- OPERATOR (00000000-0000-0000-0000-000000000004) — expenses.delete only, scope='own'
INSERT INTO role_permissions (role_id, permission, scope)
VALUES
  ('00000000-0000-0000-0000-000000000004', 'expenses.delete', 'own')
ON CONFLICT (role_id, permission) DO NOTHING;

-- CREW (00000000-0000-0000-0000-000000000005) — expenses.delete only, scope='own'
INSERT INTO role_permissions (role_id, permission, scope)
VALUES
  ('00000000-0000-0000-0000-000000000005', 'expenses.delete', 'own')
ON CONFLICT (role_id, permission) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Feature flags
-- ------------------------------------------------------------

INSERT INTO feature_flags (slug, label, description, enabled, routes, permissions)
VALUES
  (
    'estimates',
    'Estimates',
    'Estimate creation and management',
    true,
    ARRAY['/estimates'],
    ARRAY['estimates.view','estimates.create','estimates.edit','estimates.delete','estimates.send','estimates.convert']
  ),
  (
    'invoices',
    'Invoices',
    'Invoice creation and management',
    true,
    ARRAY['/invoices'],
    ARRAY['invoices.view','invoices.create','invoices.edit','invoices.delete','invoices.send','invoices.record_payment','invoices.void']
  ),
  (
    'products',
    'Products & Services',
    'Product catalog management',
    true,
    ARRAY['/products'],
    ARRAY['products.view','products.manage']
  ),
  (
    'inventory',
    'Inventory',
    'Inventory tracking and management',
    true,
    ARRAY['/inventory'],
    ARRAY['inventory.view','inventory.manage','inventory.import']
  ),
  (
    'portal',
    'Client Portal',
    'Client portal inbox and branding',
    true,
    ARRAY['/portal-inbox'],
    ARRAY['portal.view','portal.manage_branding']
  )
ON CONFLICT (slug) DO NOTHING;
