-- =================================================================
-- Migration 015: Permissions System
--
-- Full RBAC+ABAC permissions system with:
-- - app_permission enum (~55 dot-notation permissions)
-- - permission_scope enum (all, assigned, own)
-- - roles table (presets + custom per-company)
-- - role_permissions table (permission grants per role)
-- - user_roles table (one role per user)
-- - has_permission() security definer function
-- - 5 preset roles seeded with full permission sets
-- =================================================================

-- ── Enums ────────────────────────────────────────────────────────

CREATE TYPE app_permission AS ENUM (
  -- Core Operations
  'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
  'projects.archive', 'projects.assign_team',
  'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete',
  'tasks.assign', 'tasks.change_status',
  'clients.view', 'clients.create', 'clients.edit', 'clients.delete',
  'calendar.view', 'calendar.create', 'calendar.edit', 'calendar.delete',
  'job_board.view', 'job_board.manage_sections',
  -- Financial
  'estimates.view', 'estimates.create', 'estimates.edit', 'estimates.delete', 'estimates.send',
  'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete',
  'invoices.send', 'invoices.record_payment',
  'pipeline.view', 'pipeline.manage', 'pipeline.configure_stages',
  'products.view', 'products.manage',
  'expenses.view', 'expenses.create', 'expenses.edit', 'expenses.approve',
  'accounting.view', 'accounting.manage_connections',
  -- Resources
  'inventory.view', 'inventory.manage', 'inventory.import',
  'photos.view', 'photos.upload', 'photos.annotate', 'photos.delete',
  'documents.view', 'documents.manage_templates',
  -- People & Location
  'team.view', 'team.manage', 'team.assign_roles',
  'map.view', 'map.view_crew_locations',
  'notifications.view', 'notifications.manage_preferences',
  -- Admin
  'settings.company', 'settings.billing', 'settings.integrations', 'settings.preferences',
  'portal.view', 'portal.manage_branding',
  'reports.view'
);

CREATE TYPE permission_scope AS ENUM ('all', 'assigned', 'own');

-- ── Tables ───────────────────────────────────────────────────────

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  is_preset   boolean DEFAULT false,
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  hierarchy   integer NOT NULL,  -- 1=Admin (highest), 5=Crew (lowest)
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),

  CONSTRAINT roles_unique_name UNIQUE (company_id, name),
  CONSTRAINT roles_preset_no_company CHECK (NOT is_preset OR company_id IS NULL)
);

CREATE TABLE role_permissions (
  role_id     uuid REFERENCES roles(id) ON DELETE CASCADE,
  permission  app_permission NOT NULL,
  scope       permission_scope DEFAULT 'all',

  PRIMARY KEY (role_id, permission)
);

CREATE TABLE user_roles (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_at timestamptz DEFAULT now(),
  assigned_by uuid REFERENCES users(id)
);

-- ── Indexes ──────────────────────────────────────────────────────

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_roles_company_id ON roles(company_id);

-- ── Helper: Resolve current user's UUID from JWT ──────────────────

CREATE OR REPLACE FUNCTION private.get_current_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
  SELECT id FROM public.users
  WHERE auth_id = (SELECT auth.uid())::text
  LIMIT 1
$$;

-- ── Permission Check Function ────────────────────────────────────

CREATE OR REPLACE FUNCTION has_permission(
  p_user_id uuid,
  p_permission app_permission,
  p_required_scope permission_scope DEFAULT 'all'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND rp.permission = p_permission
      AND (
        rp.scope = 'all'
        OR rp.scope = p_required_scope
        OR (p_required_scope = 'own' AND rp.scope IN ('own', 'assigned', 'all'))
        OR (p_required_scope = 'assigned' AND rp.scope IN ('assigned', 'all'))
      )
  );
END;
$$;

-- ── RLS on permission tables ─────────────────────────────────────

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Roles: everyone can read presets; company members can read their custom roles
CREATE POLICY roles_select ON roles FOR SELECT USING (
  is_preset = true
  OR company_id IN (
    SELECT company_id FROM users WHERE id = (SELECT private.get_current_user_id())
  )
);

-- Role permissions: readable if you can read the role
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT USING (
  role_id IN (SELECT id FROM roles)
);

-- User roles: readable by company members
CREATE POLICY user_roles_select ON user_roles FOR SELECT USING (
  user_id IN (
    SELECT id FROM users WHERE company_id IN (
      SELECT company_id FROM users WHERE id = (SELECT private.get_current_user_id())
    )
  )
);

-- Write policies: only users with team.assign_roles can modify
CREATE POLICY roles_insert ON roles FOR INSERT WITH CHECK (
  has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

CREATE POLICY roles_update ON roles FOR UPDATE USING (
  NOT is_preset AND has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

CREATE POLICY roles_delete ON roles FOR DELETE USING (
  NOT is_preset AND has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

CREATE POLICY role_permissions_insert ON role_permissions FOR INSERT WITH CHECK (
  role_id IN (SELECT id FROM roles WHERE NOT is_preset)
  AND has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

CREATE POLICY role_permissions_update ON role_permissions FOR UPDATE USING (
  role_id IN (SELECT id FROM roles WHERE NOT is_preset)
  AND has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

CREATE POLICY role_permissions_delete ON role_permissions FOR DELETE USING (
  role_id IN (SELECT id FROM roles WHERE NOT is_preset)
  AND has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

CREATE POLICY user_roles_insert ON user_roles FOR INSERT WITH CHECK (
  has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

CREATE POLICY user_roles_update ON user_roles FOR UPDATE USING (
  has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

CREATE POLICY user_roles_delete ON user_roles FOR DELETE USING (
  has_permission((SELECT private.get_current_user_id()), 'team.assign_roles')
);

-- ── Seed Preset Roles ────────────────────────────────────────────

-- 1. ADMIN (hierarchy 1)
INSERT INTO roles (id, name, description, is_preset, company_id, hierarchy) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Admin', 'Full system access including billing and roles.', true, NULL, 1);

-- 2. OWNER (hierarchy 2)
INSERT INTO roles (id, name, description, is_preset, company_id, hierarchy) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Owner', 'Full access. Company settings and integrations.', true, NULL, 2);

-- 3. OFFICE (hierarchy 3)
INSERT INTO roles (id, name, description, is_preset, company_id, hierarchy) VALUES
  ('00000000-0000-0000-0000-000000000003', 'Office', 'Office staff. Full project and financial access.', true, NULL, 3);

-- 4. OPERATOR (hierarchy 4)
INSERT INTO roles (id, name, description, is_preset, company_id, hierarchy) VALUES
  ('00000000-0000-0000-0000-000000000004', 'Operator', 'Lead tech. Quotes jobs, manages assigned work.', true, NULL, 4);

-- 5. CREW (hierarchy 5)
INSERT INTO roles (id, name, description, is_preset, company_id, hierarchy) VALUES
  ('00000000-0000-0000-0000-000000000005', 'Crew', 'Basic field access. View assigned work only.', true, NULL, 5);

-- ── Admin Permissions (all permissions, scope=all) ───────────────

INSERT INTO role_permissions (role_id, permission, scope)
SELECT '00000000-0000-0000-0000-000000000001', unnest(enum_range(NULL::app_permission)), 'all'::permission_scope;

-- ── Owner Permissions ────────────────────────────────────────────

INSERT INTO role_permissions (role_id, permission, scope) VALUES
  -- Projects: full access
  ('00000000-0000-0000-0000-000000000002', 'projects.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'projects.create', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'projects.edit', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'projects.delete', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'projects.archive', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'projects.assign_team', 'all'),
  -- Tasks: full access
  ('00000000-0000-0000-0000-000000000002', 'tasks.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'tasks.create', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'tasks.edit', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'tasks.delete', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'tasks.assign', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'tasks.change_status', 'all'),
  -- Clients: full access
  ('00000000-0000-0000-0000-000000000002', 'clients.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'clients.create', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'clients.edit', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'clients.delete', 'all'),
  -- Calendar: full access
  ('00000000-0000-0000-0000-000000000002', 'calendar.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'calendar.create', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'calendar.edit', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'calendar.delete', 'all'),
  -- Job Board: full access
  ('00000000-0000-0000-0000-000000000002', 'job_board.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'job_board.manage_sections', 'all'),
  -- Estimates: full access
  ('00000000-0000-0000-0000-000000000002', 'estimates.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'estimates.create', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'estimates.edit', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'estimates.delete', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'estimates.send', 'all'),
  -- Invoices: full access
  ('00000000-0000-0000-0000-000000000002', 'invoices.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'invoices.create', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'invoices.edit', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'invoices.delete', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'invoices.send', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'invoices.record_payment', 'all'),
  -- Pipeline: full access
  ('00000000-0000-0000-0000-000000000002', 'pipeline.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'pipeline.manage', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'pipeline.configure_stages', 'all'),
  -- Products: full access
  ('00000000-0000-0000-0000-000000000002', 'products.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'products.manage', 'all'),
  -- Expenses: full access
  ('00000000-0000-0000-0000-000000000002', 'expenses.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'expenses.create', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'expenses.edit', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'expenses.approve', 'all'),
  -- Accounting: full access
  ('00000000-0000-0000-0000-000000000002', 'accounting.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'accounting.manage_connections', 'all'),
  -- Inventory: full access
  ('00000000-0000-0000-0000-000000000002', 'inventory.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'inventory.manage', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'inventory.import', 'all'),
  -- Photos: full access
  ('00000000-0000-0000-0000-000000000002', 'photos.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'photos.upload', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'photos.annotate', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'photos.delete', 'all'),
  -- Documents: full access
  ('00000000-0000-0000-0000-000000000002', 'documents.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'documents.manage_templates', 'all'),
  -- Team: manage but not assign_roles
  ('00000000-0000-0000-0000-000000000002', 'team.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'team.manage', 'all'),
  -- Map: full access
  ('00000000-0000-0000-0000-000000000002', 'map.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'map.view_crew_locations', 'all'),
  -- Notifications: own
  ('00000000-0000-0000-0000-000000000002', 'notifications.view', 'own'),
  ('00000000-0000-0000-0000-000000000002', 'notifications.manage_preferences', 'own'),
  -- Settings: company + integrations + preferences (not billing)
  ('00000000-0000-0000-0000-000000000002', 'settings.company', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'settings.integrations', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'settings.preferences', 'all'),
  -- Portal: full access
  ('00000000-0000-0000-0000-000000000002', 'portal.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'portal.manage_branding', 'all'),
  -- Reports
  ('00000000-0000-0000-0000-000000000002', 'reports.view', 'all');

-- ── Office Permissions ───────────────────────────────────────────

INSERT INTO role_permissions (role_id, permission, scope) VALUES
  -- Projects: view/create/edit all, archive, assign_team (no delete)
  ('00000000-0000-0000-0000-000000000003', 'projects.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'projects.create', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'projects.edit', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'projects.archive', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'projects.assign_team', 'all'),
  -- Tasks: full access
  ('00000000-0000-0000-0000-000000000003', 'tasks.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'tasks.create', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'tasks.edit', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'tasks.delete', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'tasks.assign', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'tasks.change_status', 'all'),
  -- Clients: view/create/edit (no delete)
  ('00000000-0000-0000-0000-000000000003', 'clients.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'clients.create', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'clients.edit', 'all'),
  -- Calendar: full access
  ('00000000-0000-0000-0000-000000000003', 'calendar.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'calendar.create', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'calendar.edit', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'calendar.delete', 'all'),
  -- Job Board
  ('00000000-0000-0000-0000-000000000003', 'job_board.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'job_board.manage_sections', 'all'),
  -- Estimates: full (no delete)
  ('00000000-0000-0000-0000-000000000003', 'estimates.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'estimates.create', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'estimates.edit', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'estimates.delete', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'estimates.send', 'all'),
  -- Invoices: full
  ('00000000-0000-0000-0000-000000000003', 'invoices.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'invoices.create', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'invoices.edit', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'invoices.delete', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'invoices.send', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'invoices.record_payment', 'all'),
  -- Pipeline: view + manage (no configure_stages)
  ('00000000-0000-0000-0000-000000000003', 'pipeline.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'pipeline.manage', 'all'),
  -- Products: full
  ('00000000-0000-0000-0000-000000000003', 'products.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'products.manage', 'all'),
  -- Expenses: full
  ('00000000-0000-0000-0000-000000000003', 'expenses.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'expenses.create', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'expenses.edit', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'expenses.approve', 'all'),
  -- Accounting: view only
  ('00000000-0000-0000-0000-000000000003', 'accounting.view', 'all'),
  -- Inventory: view + manage (no import)
  ('00000000-0000-0000-0000-000000000003', 'inventory.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'inventory.manage', 'all'),
  -- Photos: full
  ('00000000-0000-0000-0000-000000000003', 'photos.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'photos.upload', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'photos.annotate', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'photos.delete', 'all'),
  -- Documents: view only
  ('00000000-0000-0000-0000-000000000003', 'documents.view', 'all'),
  -- Team: view only
  ('00000000-0000-0000-0000-000000000003', 'team.view', 'all'),
  -- Map: full
  ('00000000-0000-0000-0000-000000000003', 'map.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'map.view_crew_locations', 'all'),
  -- Notifications: own
  ('00000000-0000-0000-0000-000000000003', 'notifications.view', 'own'),
  ('00000000-0000-0000-0000-000000000003', 'notifications.manage_preferences', 'own'),
  -- Settings: preferences only
  ('00000000-0000-0000-0000-000000000003', 'settings.preferences', 'all'),
  -- Portal: view only
  ('00000000-0000-0000-0000-000000000003', 'portal.view', 'all'),
  -- Reports
  ('00000000-0000-0000-0000-000000000003', 'reports.view', 'all');

-- ── Operator Permissions ─────────────────────────────────────────

INSERT INTO role_permissions (role_id, permission, scope) VALUES
  -- Projects: view all, create, edit assigned (no delete/archive/assign_team)
  ('00000000-0000-0000-0000-000000000004', 'projects.view', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'projects.create', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'projects.edit', 'assigned'),
  -- Tasks: view all, create, edit/status assigned (no delete/assign)
  ('00000000-0000-0000-0000-000000000004', 'tasks.view', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'tasks.create', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'tasks.edit', 'assigned'),
  ('00000000-0000-0000-0000-000000000004', 'tasks.change_status', 'assigned'),
  -- Clients: view all, create (no edit/delete)
  ('00000000-0000-0000-0000-000000000004', 'clients.view', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'clients.create', 'all'),
  -- Calendar: view all, create, edit own
  ('00000000-0000-0000-0000-000000000004', 'calendar.view', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'calendar.create', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'calendar.edit', 'own'),
  -- Job Board: view all
  ('00000000-0000-0000-0000-000000000004', 'job_board.view', 'all'),
  -- Estimates: view all, create, edit own (no delete/send)
  ('00000000-0000-0000-0000-000000000004', 'estimates.view', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'estimates.create', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'estimates.edit', 'own'),
  -- Invoices: view all only
  ('00000000-0000-0000-0000-000000000004', 'invoices.view', 'all'),
  -- Products: view only
  ('00000000-0000-0000-0000-000000000004', 'products.view', 'all'),
  -- Expenses: view/create/edit own (no approve)
  ('00000000-0000-0000-0000-000000000004', 'expenses.view', 'own'),
  ('00000000-0000-0000-0000-000000000004', 'expenses.create', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'expenses.edit', 'own'),
  -- Photos: view all, upload, annotate, delete own
  ('00000000-0000-0000-0000-000000000004', 'photos.view', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'photos.upload', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'photos.annotate', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'photos.delete', 'own'),
  -- Documents: view
  ('00000000-0000-0000-0000-000000000004', 'documents.view', 'all'),
  -- Team: view
  ('00000000-0000-0000-0000-000000000004', 'team.view', 'all'),
  -- Map: view (no crew locations)
  ('00000000-0000-0000-0000-000000000004', 'map.view', 'all'),
  -- Notifications: own
  ('00000000-0000-0000-0000-000000000004', 'notifications.view', 'own'),
  ('00000000-0000-0000-0000-000000000004', 'notifications.manage_preferences', 'own'),
  -- Settings: preferences only
  ('00000000-0000-0000-0000-000000000004', 'settings.preferences', 'all');

-- ── Crew Permissions ─────────────────────────────────────────────

INSERT INTO role_permissions (role_id, permission, scope) VALUES
  -- Projects: view assigned only
  ('00000000-0000-0000-0000-000000000005', 'projects.view', 'assigned'),
  -- Tasks: view assigned, edit/status assigned
  ('00000000-0000-0000-0000-000000000005', 'tasks.view', 'assigned'),
  ('00000000-0000-0000-0000-000000000005', 'tasks.edit', 'assigned'),
  ('00000000-0000-0000-0000-000000000005', 'tasks.change_status', 'assigned'),
  -- Clients: view assigned
  ('00000000-0000-0000-0000-000000000005', 'clients.view', 'assigned'),
  -- Calendar: view own
  ('00000000-0000-0000-0000-000000000005', 'calendar.view', 'own'),
  -- Job Board: view assigned
  ('00000000-0000-0000-0000-000000000005', 'job_board.view', 'assigned'),
  -- Expenses: view/create/edit own
  ('00000000-0000-0000-0000-000000000005', 'expenses.view', 'own'),
  ('00000000-0000-0000-0000-000000000005', 'expenses.create', 'all'),
  ('00000000-0000-0000-0000-000000000005', 'expenses.edit', 'own'),
  -- Photos: view assigned, upload, annotate
  ('00000000-0000-0000-0000-000000000005', 'photos.view', 'assigned'),
  ('00000000-0000-0000-0000-000000000005', 'photos.upload', 'all'),
  ('00000000-0000-0000-0000-000000000005', 'photos.annotate', 'all'),
  -- Map: view
  ('00000000-0000-0000-0000-000000000005', 'map.view', 'all'),
  -- Notifications: own
  ('00000000-0000-0000-0000-000000000005', 'notifications.view', 'own'),
  ('00000000-0000-0000-0000-000000000005', 'notifications.manage_preferences', 'own'),
  -- Settings: preferences only
  ('00000000-0000-0000-0000-000000000005', 'settings.preferences', 'all');
