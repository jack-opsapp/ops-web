-- 20260531200227_fix_expenses_rls_company_and_role_scope
-- Applied to ops-app (ijeekuhbatykdomumfjx) on 2026-05-31 via Supabase MCP.
-- Security remediation surfaced by the Books "Mission Deck" review.
--
-- BEFORE: expenses, expense_project_allocations, expense_categories each had a
-- single PERMISSIVE policy `USING (true)` for role public, with full CRUD granted
-- to anon+authenticated. The shipped anon key (no login) could read/insert/update/
-- delete EVERY company's expense data — an unauthenticated cross-tenant breach.
-- AFTER: the layered company-isolation + role-scope pattern already used by
-- invoices/estimates. Own-scope (crew) is now enforced at the DB via submitted_by.

-- ── expenses ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Company members can access expenses" ON public.expenses;

CREATE POLICY company_isolation ON public.expenses
  FOR ALL TO public
  USING (company_id = (SELECT private.get_user_company_id()));

CREATE POLICY role_scope_read ON public.expenses
  AS RESTRICTIVE FOR SELECT TO public
  USING (
    private.current_user_is_admin() OR
    CASE private.current_user_scope_for('expenses.view'::text)
      WHEN 'all'::text THEN true
      WHEN 'own'::text THEN (private.get_current_user_id() = submitted_by)
      ELSE false
    END
  );

CREATE POLICY role_scope_insert ON public.expenses
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (private.current_user_has_permission('expenses.create'::text, 'all'::text));

CREATE POLICY role_scope_update ON public.expenses
  AS RESTRICTIVE FOR UPDATE TO public
  USING (
    private.current_user_is_admin() OR
    private.current_user_has_permission('expenses.approve'::text, 'all'::text) OR
    CASE private.current_user_scope_for('expenses.edit'::text)
      WHEN 'all'::text THEN true
      WHEN 'own'::text THEN (private.get_current_user_id() = submitted_by)
      ELSE false
    END
  );

CREATE POLICY role_scope_delete ON public.expenses
  AS RESTRICTIVE FOR DELETE TO public
  USING (
    private.current_user_is_admin() OR
    private.current_user_has_permission('expenses.delete'::text, 'all'::text)
  );

-- ── expense_categories (company reference data — company isolation) ─────────
DROP POLICY IF EXISTS "Company members can access expense_categories" ON public.expense_categories;

CREATE POLICY company_isolation ON public.expense_categories
  FOR ALL TO public
  USING (company_id = (SELECT private.get_user_company_id()));

-- ── expense_project_allocations (no company_id — scope via parent expense) ──
DROP POLICY IF EXISTS "Company members can access expense_project_allocations" ON public.expense_project_allocations;

CREATE POLICY company_isolation ON public.expense_project_allocations
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_project_allocations.expense_id
        AND e.company_id = (SELECT private.get_user_company_id())
    )
  );

CREATE POLICY role_scope_read ON public.expense_project_allocations
  AS RESTRICTIVE FOR SELECT TO public
  USING (
    private.current_user_is_admin() OR
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_project_allocations.expense_id
        AND CASE private.current_user_scope_for('expenses.view'::text)
              WHEN 'all'::text THEN true
              WHEN 'own'::text THEN (private.get_current_user_id() = e.submitted_by)
              ELSE false
            END
    )
  );
