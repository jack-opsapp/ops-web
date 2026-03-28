-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 016: Permission-Based RLS Policies
--
-- Adds permission-aware RLS to sensitive tables. Works alongside existing
-- company_isolation policies — both must pass for access.
--
-- Architecture:
--   Layer 1: company_isolation (existing) — no cross-company access
--   Layer 2: permission policies (this migration) — module-level access control
--   Layer 3: Client-side gating — route guards, sidebar, PermissionGate
--   Layer 4: Server-side API checks — checkPermission() in API routes
--
-- Applied to financial tables (invoices, estimates, payments, expenses) where
-- unauthorized access within a company is a meaningful risk.
-- Core operational tables (projects, tasks, clients) rely on layers 1+3+4
-- since over-restricting them at the DB level causes poor UX (empty pages
-- instead of access-denied redirects).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Helper: Check if current user has a permission ──────────────────────────
-- (private.get_current_user_id() is defined in migration 015)
-- Caches user ID in a transaction-local session variable so the users table
-- lookup happens once per transaction, not once per row per policy.

CREATE OR REPLACE FUNCTION private.current_user_has_permission(
  p_permission app_permission
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Try cached user ID from session variable
  v_user_id := current_setting('app.current_user_id', true)::uuid;

  -- If not cached, resolve and cache for this transaction
  IF v_user_id IS NULL THEN
    v_user_id := (SELECT private.get_current_user_id());
    IF v_user_id IS NULL THEN
      RETURN false;
    END IF;
    PERFORM set_config('app.current_user_id', v_user_id::text, true);
  END IF;

  RETURN public.has_permission(v_user_id, p_permission);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INVOICES — Require invoices.view to read, invoices.create/edit/delete to write
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop the existing FOR ALL policy and replace with granular ones
DROP POLICY IF EXISTS "company_isolation" ON invoices;

-- SELECT: company isolation + invoices.view permission
CREATE POLICY "invoices_select" ON invoices FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('invoices.view')
);

-- INSERT: company isolation + invoices.create permission
CREATE POLICY "invoices_insert" ON invoices FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('invoices.create')
);

-- UPDATE: company isolation + invoices.edit permission
CREATE POLICY "invoices_update" ON invoices FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('invoices.edit')
);

-- DELETE: company isolation + invoices.delete permission
CREATE POLICY "invoices_delete" ON invoices FOR DELETE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('invoices.delete')
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ESTIMATES — Require estimates.view to read, estimates.create/edit/delete to write
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "company_isolation" ON estimates;

CREATE POLICY "estimates_select" ON estimates FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('estimates.view')
);

CREATE POLICY "estimates_insert" ON estimates FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('estimates.create')
);

CREATE POLICY "estimates_update" ON estimates FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('estimates.edit')
);

CREATE POLICY "estimates_delete" ON estimates FOR DELETE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('estimates.delete')
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYMENTS — Require invoices.record_payment to read/write
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "company_isolation" ON payments;

CREATE POLICY "payments_select" ON payments FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('invoices.view')
);

CREATE POLICY "payments_insert" ON payments FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('invoices.record_payment')
);

CREATE POLICY "payments_update" ON payments FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('invoices.record_payment')
);

CREATE POLICY "payments_delete" ON payments FOR DELETE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('invoices.record_payment')
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- LINE ITEMS — Tied to estimate/invoice permissions
-- Line items belong to either an estimate or invoice, so require the
-- corresponding view permission.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "company_isolation" ON line_items;

-- SELECT: must have invoices.view OR estimates.view (line items serve both)
CREATE POLICY "line_items_select" ON line_items FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND (
    private.current_user_has_permission('invoices.view')
    OR private.current_user_has_permission('estimates.view')
  )
);

-- INSERT/UPDATE/DELETE: must have create/edit permission on invoices or estimates
CREATE POLICY "line_items_insert" ON line_items FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND (
    private.current_user_has_permission('invoices.create')
    OR private.current_user_has_permission('estimates.create')
  )
);

CREATE POLICY "line_items_update" ON line_items FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND (
    private.current_user_has_permission('invoices.edit')
    OR private.current_user_has_permission('estimates.edit')
  )
);

CREATE POLICY "line_items_delete" ON line_items FOR DELETE USING (
  company_id = (SELECT private.get_user_company_id())
  AND (
    private.current_user_has_permission('invoices.delete')
    OR private.current_user_has_permission('estimates.delete')
  )
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ACCOUNTING CONNECTIONS — Require accounting.view / accounting.manage_connections
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "company_isolation" ON accounting_connections;

CREATE POLICY "accounting_connections_select" ON accounting_connections FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('accounting.view')
);

CREATE POLICY "accounting_connections_insert" ON accounting_connections FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('accounting.manage_connections')
);

CREATE POLICY "accounting_connections_update" ON accounting_connections FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('accounting.manage_connections')
);

CREATE POLICY "accounting_connections_delete" ON accounting_connections FOR DELETE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('accounting.manage_connections')
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXPENSES — Require expenses.view/create/edit, expenses.approve for approval
-- Currently these tables have fully permissive USING (true) policies.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable RLS (may already be enabled with permissive policies)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_project_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_batches ENABLE ROW LEVEL SECURITY;

-- Drop any existing permissive policies
DROP POLICY IF EXISTS "company_isolation" ON expenses;
DROP POLICY IF EXISTS "Enable read access for all users" ON expenses;
DROP POLICY IF EXISTS "Enable insert for all users" ON expenses;
DROP POLICY IF EXISTS "Enable update for all users" ON expenses;
DROP POLICY IF EXISTS "Enable delete for all users" ON expenses;

DROP POLICY IF EXISTS "company_isolation" ON expense_project_allocations;
DROP POLICY IF EXISTS "Enable read access for all users" ON expense_project_allocations;
DROP POLICY IF EXISTS "Enable insert for all users" ON expense_project_allocations;
DROP POLICY IF EXISTS "Enable update for all users" ON expense_project_allocations;
DROP POLICY IF EXISTS "Enable delete for all users" ON expense_project_allocations;

DROP POLICY IF EXISTS "company_isolation" ON expense_categories;
DROP POLICY IF EXISTS "Enable read access for all users" ON expense_categories;
DROP POLICY IF EXISTS "Enable insert for all users" ON expense_categories;
DROP POLICY IF EXISTS "Enable update for all users" ON expense_categories;
DROP POLICY IF EXISTS "Enable delete for all users" ON expense_categories;

DROP POLICY IF EXISTS "company_isolation" ON expense_settings;
DROP POLICY IF EXISTS "Enable read access for all users" ON expense_settings;
DROP POLICY IF EXISTS "Enable insert for all users" ON expense_settings;
DROP POLICY IF EXISTS "Enable update for all users" ON expense_settings;
DROP POLICY IF EXISTS "Enable delete for all users" ON expense_settings;

DROP POLICY IF EXISTS "company_isolation" ON expense_batches;
DROP POLICY IF EXISTS "Enable read access for all users" ON expense_batches;
DROP POLICY IF EXISTS "Enable insert for all users" ON expense_batches;
DROP POLICY IF EXISTS "Enable update for all users" ON expense_batches;
DROP POLICY IF EXISTS "Enable delete for all users" ON expense_batches;

-- ── expenses ──────────────────────────────────────────────────────────────────

CREATE POLICY "expenses_select" ON expenses FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.view')
);

CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.create')
);

CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.edit')
);

CREATE POLICY "expenses_delete" ON expenses FOR DELETE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.edit')
);

-- ── expense_project_allocations ───────────────────────────────────────────────
-- Tied to parent expense — require expenses.view to read, expenses.create/edit to write

CREATE POLICY "expense_allocations_select" ON expense_project_allocations FOR SELECT USING (
  expense_id IN (SELECT id FROM expenses)
);

CREATE POLICY "expense_allocations_insert" ON expense_project_allocations FOR INSERT WITH CHECK (
  expense_id IN (
    SELECT id FROM expenses
    WHERE company_id = (SELECT private.get_user_company_id())
  )
  AND private.current_user_has_permission('expenses.create')
);

CREATE POLICY "expense_allocations_update" ON expense_project_allocations FOR UPDATE USING (
  expense_id IN (SELECT id FROM expenses)
  AND private.current_user_has_permission('expenses.edit')
);

CREATE POLICY "expense_allocations_delete" ON expense_project_allocations FOR DELETE USING (
  expense_id IN (SELECT id FROM expenses)
  AND private.current_user_has_permission('expenses.edit')
);

-- ── expense_categories ────────────────────────────────────────────────────────
-- View requires expenses.view; manage requires expenses.approve (admin-level)

CREATE POLICY "expense_categories_select" ON expense_categories FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.view')
);

CREATE POLICY "expense_categories_insert" ON expense_categories FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.approve')
);

CREATE POLICY "expense_categories_update" ON expense_categories FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.approve')
);

CREATE POLICY "expense_categories_delete" ON expense_categories FOR DELETE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.approve')
);

-- ── expense_settings ──────────────────────────────────────────────────────────
-- One row per company. View requires expenses.view; modify requires expenses.approve

CREATE POLICY "expense_settings_select" ON expense_settings FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.view')
);

CREATE POLICY "expense_settings_insert" ON expense_settings FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.approve')
);

CREATE POLICY "expense_settings_update" ON expense_settings FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.approve')
);

-- ── expense_batches ───────────────────────────────────────────────────────────
-- View requires expenses.view; create/manage requires expenses.approve

CREATE POLICY "expense_batches_select" ON expense_batches FOR SELECT USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.view')
);

CREATE POLICY "expense_batches_insert" ON expense_batches FOR INSERT WITH CHECK (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.approve')
);

CREATE POLICY "expense_batches_update" ON expense_batches FOR UPDATE USING (
  company_id = (SELECT private.get_user_company_id())
  AND private.current_user_has_permission('expenses.approve')
);
