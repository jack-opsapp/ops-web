# QuickBooks Read-Only Sync (Sub-project A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only QuickBooks -> OPS data pipeline (Pull -> Stage -> Review -> Apply) that draws CanPro's customers, invoices, estimates, payments, and line items into OPS *without ever writing to QuickBooks*, so the iOS Books P&L / Cash Flow / A/R cards validate against real data.

**Architecture:** A new `sync_direction='pull_only'` mode on the accounting sync engine reads QuickBooks via GET-only Accounting API v3 queries into `qbo_*` staging tables. A web "QuickBooks Import" review screen shows proposed customer matches (email -> name -> pg_trgm fuzzy) and a QuickBooks-vs-OPS reconciliation. On owner approval, an idempotent, trigger-aware apply writes into live `clients`/`estimates`/`invoices`/`line_items`/`payments` (order: clients -> headers -> line items -> payments -> reconcile to QB-authoritative balances). Read-only is enforced by the direction mode + a separate import endpoint (the legacy push-then-pull `/api/sync` refuses `pull_only` connections); manual-only, no scheduler.

**Tech Stack:** Next.js App Router + TypeScript, Supabase Postgres 17 (RLS via `private.get_user_company_id()` + `public.has_permission`, `pg_trgm`), TanStack Query, vitest + testing-library, QuickBooks Online Accounting API v3 (read-only). Test target company: **Canpro Deck and Rail** `a612edc0-5c18-4c4d-af97-55b9410dd077`.

**Design spec:** `docs/superpowers/specs/2026-06-01-quickbooks-readonly-sync-design.md`. **Deferred:** token encryption-at-rest (bug `7600a1a2-566b-4d11-82a9-db72e966ee85`).

---

## File Structure

**Phase A0 — schema, safety rails, types**
- Create `supabase/migrations/20260602000000_qbo_readonly_sync_a0_schema.sql` — `sync_direction` column + `qbo_import_runs`, `qbo_staging_{customers,estimates,invoices,line_items,payments}`, `qbo_customer_matches`, RLS, `pg_trgm`, owner feature-flag override.
- Create `src/lib/types/qbo-import.ts` — `QboImportRun`, `QboStaged*`, `QboCustomerMatch`, `MatchAction`, `QboImportReview` (re-exported from `src/lib/types/pipeline.ts`).
- Modify `src/lib/api/services/sync-orchestrator.ts` — `pull_only` guard.

**Phase A1 — read-only pull service**
- Create `src/lib/api/services/quickbooks-pull-service.ts` — `QuickBooksPullService` (GET-only).

**Phase A2 — pull->stage + customer matching**
- Create `src/lib/api/services/quickbooks-import-service.ts` — `startImportRun`, `pullAndStage`, `computeCustomerMatches`, `getImportReview`.

**Phase A3 — apply engine + routes**
- Extend `src/lib/api/services/quickbooks-import-service.ts` — `applyImport`.
- Create `src/app/api/integrations/quickbooks/import/route.ts` (POST start, GET review) and `src/app/api/integrations/quickbooks/import/apply/route.ts` (POST apply).
- Modify `src/app/api/sync/route.ts` (409 on `pull_only`) and `src/app/api/integrations/quickbooks/callback/route.ts` (`sync_direction='pull_only'`, `sync_enabled=false`).

**Phase A4 — review UI (web)**
- Create `src/components/accounting/quickbooks-import-tab.tsx`, `src/lib/hooks/use-qbo-import.ts`, sub-components; modify `src/app/(dashboard)/accounting/page.tsx`; add dictionary keys to `src/i18n/dictionaries/{en,es}/accounting.json`.

**Phase A5 — connect wiring + live validation runbook**
- Env wiring (`QB_CLIENT_ID/SECRET/REDIRECT_URI/QB_ENVIRONMENT`); manual live-test runbook + SQL verification + rollback.

---

## Cross-Phase Reconciliation Notes (read before executing)

These resolve seams between the independently-drafted phases. They **override** any conflicting instruction inside a phase.

1. **`src/lib/types/qbo-import.ts` is owned by Phase A0.** A0 creates the complete type module (`QboImportRun`, `QboStaged*`, `QboCustomerMatch`, `MatchAction`, `QboImportReview`) and re-exports it from `src/lib/types/pipeline.ts`. A1–A4 **import** these types — do not re-create the file (A1's draft mentions a minimal version; skip that).
2. **Apply-complete notification = a dedicated type `accounting_import_complete`.** `notifications.type` is free text (no DB CHECK — verified) and already uses descriptive `*_complete` types (`email_sync_complete`, `pipeline_complete`), so **no migration is needed**; just add `'accounting_import_complete'` to the `NotificationType` union in `src/lib/api/services/notification-service.ts` (for type-safety + icon/label) and use it in the A3 apply route. Do **not** ship the generic `'role_needed'` placeholder some drafts mention.
3. **Strict execution order: A0 → A1 → A2 → A3 → A4 → A5.** A2 adds a customer-match RPC migration and a `qbo-normalize.ts` helper; A3 implements `applyImport` (A2 intentionally leaves it unimplemented). Every phase's tests assume the prior phases have landed.
4. **Build in an isolated git worktree**, never the shared primary `ops-web` checkout (a parallel session is active there). Create with `git worktree add ../OPS-Web-qb-readonly-sync -b feat/qb-readonly-sync`, then symlink `node_modules` and `.env.local` into it. Do not `git checkout -b` / reset / amend in the primary checkout.
5. **`accounting.view` and `accounting.manage_connections` already exist** in `src/lib/types/permissions.ts` (verified) — no permission-catalog registration needed. If any phase introduces a NEW permission bit, it MUST be added there too.

---


## Phase A0 — Schema, safety rails & types

### Task A0.1: Additive migration — sync_direction column, qbo_* tables, RLS, pg_trgm, owner feature-flag override

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/supabase/migrations/20260602000000_qbo_readonly_sync_a0_schema.sql`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/supabase/qbo-a0-schema-migration.test.ts`

- [ ] **Step 1: Write the failing migration-content test.** Mirror the proven `lead-lifecycle-p4-migration.test.ts` pattern (read the `.sql` as text, assert it contains the required DDL fragments). Create `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/supabase/qbo-a0-schema-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260602000000_qbo_readonly_sync_a0_schema.sql"
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("QBO read-only sync A0 schema migration", () => {
  it("is wrapped in a single transaction with a sentinel rollback guard", () => {
    const sql = migrationSql();
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    // Sentinel: verifies every new object exists before commit; raises (=> rollback) otherwise.
    expect(sql).toContain("qbo_a0_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("adds sync_direction as an additive, defaulted, checked column", () => {
    const sql = migrationSql();
    expect(sql).toContain("alter table public.accounting_connections");
    expect(sql).toContain("add column if not exists sync_direction text not null default 'pull_only'");
    expect(sql).toContain("check (sync_direction in ('pull_only', 'push_only', 'bidirectional'))");
  });

  it("creates the import-run + all six staging/match tables", () => {
    const sql = migrationSql();
    for (const table of [
      "public.qbo_import_runs",
      "public.qbo_staging_customers",
      "public.qbo_staging_estimates",
      "public.qbo_staging_invoices",
      "public.qbo_staging_line_items",
      "public.qbo_staging_payments",
      "public.qbo_customer_matches",
    ]) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }
  });

  it("constrains run status, match action/basis/confidence, and line-item parent type", () => {
    const sql = migrationSql();
    expect(sql).toContain("check (status in ('pending', 'pulling', 'staged', 'applying', 'applied', 'error'))");
    expect(sql).toContain("check (proposed_action in ('link', 'create', 'skip', 'needs_review'))");
    expect(sql).toContain("check (match_basis in ('email', 'name_exact', 'name_fuzzy', 'none'))");
    expect(sql).toContain("check (confidence in ('high', 'medium', 'low'))");
    expect(sql).toContain("check (parent_type in ('invoice', 'estimate'))");
  });

  it("uses run-scoped uniqueness and cascading run_id foreign keys", () => {
    const sql = migrationSql();
    expect(sql).toContain("references public.qbo_import_runs(id) on delete cascade");
    expect(sql).toContain("unique (run_id, qb_id)");
    expect(sql).toContain("unique (run_id, customer_qb_id)");
  });

  it("enables RLS with a company-scoped accounting.view SELECT policy on every new table", () => {
    const sql = migrationSql();
    for (const table of [
      "public.qbo_import_runs",
      "public.qbo_staging_customers",
      "public.qbo_staging_estimates",
      "public.qbo_staging_invoices",
      "public.qbo_staging_line_items",
      "public.qbo_staging_payments",
      "public.qbo_customer_matches",
    ]) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
    }
    expect(sql).toContain("public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')");
    expect(sql).toContain("company_id = (select private.get_user_company_id())");
    // Reads only — no broad authenticated write policy.
    expect(sql).not.toMatch(/for all\s+to authenticated/i);
    expect(sql).not.toMatch(/for insert/i);
  });

  it("enables pg_trgm and seeds the owner-only accounting feature-flag override without disturbing existing rows", () => {
    const sql = migrationSql();
    expect(sql).toContain("create extension if not exists pg_trgm");
    expect(sql).toContain("insert into public.feature_flag_overrides");
    expect(sql).toContain("'accounting'");
    expect(sql).toContain("'1746a0c1-be43-45d6-ab4d-584e82594b1b'");
    expect(sql).toContain("on conflict (flag_slug, user_id) do nothing");
  });
});
```

- [ ] **Step 2: Run the test, confirm it FAILS.** The migration file does not exist yet, so `readFileSync` throws ENOENT.

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/supabase/qbo-a0-schema-migration.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory, open '.../supabase/migrations/20260602000000_qbo_readonly_sync_a0_schema.sql'`.

- [ ] **Step 3: Write the migration file.** Create `/Users/jacksonsweet/Projects/OPS/ops-web/supabase/migrations/20260602000000_qbo_readonly_sync_a0_schema.sql` with the complete, single-transaction, sentinel-guarded DDL. Conventions match `20260601000000_pipeline_table_opportunity_views.sql` (lowercase SQL, `begin;`/`commit;`, `private.get_user_company_id()`/`private.get_current_user_id()`/`public.has_permission(...)` for RLS, `revoke all ... from anon` then `grant select ... to anon` for the Firebase bridge):

```sql
begin;

-- ============================================================================
-- QuickBooks read-only sync — Phase A0: schema, safety rails & types
--
-- Purely ADDITIVE (iOS-sync-safe): one nullable-by-default new column on
-- accounting_connections, seven brand-new qbo_* tables, RLS read policies,
-- the pg_trgm extension (already present in prod; kept idempotent), and a
-- single owner-only accounting feature-flag override. Nothing existing is
-- altered or dropped.
--
-- Firebase/anon bridge: OPS-Web browser requests reach Postgres as the anon
-- role (Firebase JWT -> PostgREST), with private.get_current_user_id()
-- resolving identity and private.get_user_company_id() (returns uuid)
-- resolving company. New-table reads are PUBLIC policies (no `to` clause) so
-- anon reads through them; all writes go through the service role (API
-- routes), which bypasses RLS. There are deliberately NO write policies.
--
-- Direct prod apply is authorized (low-tenant). The whole body is one
-- transaction and ends with a sentinel DO block that re-verifies every new
-- object; any missing invariant RAISEs and rolls the whole migration back.
-- ============================================================================

-- ── Fuzzy-match dependency ──────────────────────────────────────────────────
create extension if not exists pg_trgm;

-- ── A0.a — direction mode on the connection (additive, safe default) ─────────
alter table public.accounting_connections
  add column if not exists sync_direction text not null default 'pull_only'
  check (sync_direction in ('pull_only', 'push_only', 'bidirectional'));

-- ── A0.b — import run header ─────────────────────────────────────────────────
create table if not exists public.qbo_import_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  provider text not null default 'quickbooks',
  status text not null default 'pending'
    check (status in ('pending', 'pulling', 'staged', 'applying', 'applied', 'error')),
  history_cutoff date,
  qb_write_calls int not null default 0,
  totals jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid,
  created_at timestamptz default now(),
  finished_at timestamptz
);

create index if not exists idx_qbo_import_runs_company_created
  on public.qbo_import_runs (company_id, created_at desc);

-- ── A0.c — staging: customers ────────────────────────────────────────────────
create table if not exists public.qbo_staging_customers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qbo_import_runs(id) on delete cascade,
  company_id uuid not null,
  qb_id text not null,
  display_name text,
  email text,
  phone text,
  address text,
  active boolean,
  raw jsonb,
  created_at timestamptz default now(),
  unique (run_id, qb_id)
);

-- ── A0.d — staging: estimates ────────────────────────────────────────────────
create table if not exists public.qbo_staging_estimates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qbo_import_runs(id) on delete cascade,
  company_id uuid not null,
  qb_id text not null,
  doc_number text,
  customer_qb_id text,
  txn_date date,
  expiration_date date,
  txn_status text,
  subtotal numeric,
  tax_amount numeric,
  tax_rate numeric,
  total numeric,
  raw jsonb,
  unique (run_id, qb_id)
);

-- ── A0.e — staging: invoices ─────────────────────────────────────────────────
create table if not exists public.qbo_staging_invoices (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qbo_import_runs(id) on delete cascade,
  company_id uuid not null,
  qb_id text not null,
  doc_number text,
  customer_qb_id text,
  estimate_qb_id text,
  txn_date date,
  due_date date,
  subtotal numeric,
  tax_amount numeric,
  tax_rate numeric,
  total numeric,
  balance numeric,
  derived_status text,
  raw jsonb,
  unique (run_id, qb_id)
);

-- ── A0.f — staging: line items (no UNIQUE — replace-all-by-parent on apply) ──
create table if not exists public.qbo_staging_line_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qbo_import_runs(id) on delete cascade,
  company_id uuid not null,
  parent_type text not null check (parent_type in ('invoice', 'estimate')),
  parent_qb_id text not null,
  qb_line_id text,
  name text,
  description text,
  quantity numeric,
  unit_price numeric,
  amount numeric,
  is_taxable boolean,
  qb_item_type text,
  sort_order int
);

create index if not exists idx_qbo_staging_line_items_parent
  on public.qbo_staging_line_items (run_id, parent_type, parent_qb_id);

-- ── A0.g — staging: payments ─────────────────────────────────────────────────
create table if not exists public.qbo_staging_payments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qbo_import_runs(id) on delete cascade,
  company_id uuid not null,
  qb_id text not null,
  customer_qb_id text,
  txn_date date,
  total_amt numeric,
  unapplied_amt numeric,
  applied_lines jsonb not null default '[]'::jsonb, -- [{invoice_qb_id, amount, reference_number}]
  raw jsonb,
  unique (run_id, qb_id)
);

-- ── A0.h — customer match proposals ──────────────────────────────────────────
create table if not exists public.qbo_customer_matches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qbo_import_runs(id) on delete cascade,
  company_id uuid not null,
  customer_qb_id text not null,
  proposed_action text not null
    check (proposed_action in ('link', 'create', 'skip', 'needs_review')),
  matched_client_id uuid,
  match_basis text check (match_basis in ('email', 'name_exact', 'name_fuzzy', 'none')),
  confidence text check (confidence in ('high', 'medium', 'low')),
  candidates jsonb not null default '[]'::jsonb,
  decided_action text,
  decided_client_id uuid,
  unique (run_id, customer_qb_id)
);

-- ── A0.i — RLS: enable + company-scoped accounting.view SELECT on every table ─
-- Reads only. Service-role writes (API routes) bypass RLS. Mirrors the
-- opportunity_views grant dance: revoke all from anon, then grant SELECT only,
-- so anon never holds table-level INSERT/UPDATE/DELETE.

do $$
declare
  v_table text;
  v_policy text;
begin
  foreach v_table in array array[
    'qbo_import_runs',
    'qbo_staging_customers',
    'qbo_staging_estimates',
    'qbo_staging_invoices',
    'qbo_staging_line_items',
    'qbo_staging_payments',
    'qbo_customer_matches'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    execute format('revoke all on table public.%I from anon', v_table);
    execute format('grant select on table public.%I to anon', v_table);

    v_policy := format('read company %s with accounting view', v_table);
    execute format('drop policy if exists %I on public.%I', v_policy, v_table);
    execute format($p$
      create policy %I
      on public.%I for select
      using (
        company_id = (select private.get_user_company_id())
        and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
      )
    $p$, v_policy, v_table);
  end loop;
end$$;

-- ── A0.j — owner-only feature-flag override (flag stays OFF globally) ─────────
-- Scopes the QuickBooks Import surface to the CanPro owner. ON CONFLICT DO
-- NOTHING leaves the 5 pre-existing accounting overrides for other users
-- untouched and makes re-running this migration a no-op.
insert into public.feature_flag_overrides (flag_slug, user_id)
values ('accounting', '1746a0c1-be43-45d6-ab4d-584e82594b1b')
on conflict (flag_slug, user_id) do nothing;

-- ── A0.k — sentinel rollback guard ───────────────────────────────────────────
-- Re-verify every invariant this migration is responsible for. Any failure
-- RAISEs, aborting the transaction so nothing partial can land.
do $$
declare
  v_missing text;
  v_table text;
begin
  -- qbo_a0_sentinel: column exists with the right default + check
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'accounting_connections'
      and column_name = 'sync_direction'
      and column_default like '%pull_only%'
  ) then
    raise exception 'qbo_a0_sentinel: accounting_connections.sync_direction missing or wrong default';
  end if;

  -- all seven tables exist, RLS on, exactly one SELECT policy, zero write policies
  foreach v_table in array array[
    'qbo_import_runs',
    'qbo_staging_customers',
    'qbo_staging_estimates',
    'qbo_staging_invoices',
    'qbo_staging_line_items',
    'qbo_staging_payments',
    'qbo_customer_matches'
  ]
  loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table
        and c.relkind = 'r' and c.relrowsecurity = true
    ) then
      raise exception 'qbo_a0_sentinel: table public.% missing or RLS disabled', v_table;
    end if;

    if (
      select count(*) from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table
        and p.polcmd <> 'r'   -- 'r' = SELECT; anything else is a write policy
    ) <> 0 then
      raise exception 'qbo_a0_sentinel: table public.% has a non-SELECT policy', v_table;
    end if;
  end loop;

  -- pg_trgm installed
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception 'qbo_a0_sentinel: pg_trgm extension not installed';
  end if;

  -- owner override present
  if not exists (
    select 1 from public.feature_flag_overrides
    where flag_slug = 'accounting'
      and user_id = '1746a0c1-be43-45d6-ab4d-584e82594b1b'
  ) then
    raise exception 'qbo_a0_sentinel: owner accounting feature-flag override missing';
  end if;

  v_missing := null; -- explicit: all invariants passed
end$$;

commit;
```

- [ ] **Step 4: Run the test, confirm it PASSES.**

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/supabase/qbo-a0-schema-migration.test.ts
```

Expected: PASS — 7 tests / 7 passed.

- [ ] **Step 5: Apply the migration to prod ops-app via MCP** (direct prod migration authorized; the transaction + sentinel make a partial apply impossible). Use `mcp__plugin_supabase_supabase__apply_migration` with `project_id: ijeekuhbatykdomumfjx`, `name: qbo_readonly_sync_a0_schema`, and the exact file body from Step 3. If the sentinel RAISEs, the whole migration rolls back — read the error, fix, re-apply (the file is idempotent: `if not exists` / `do nothing`).

- [ ] **Step 6: Commit.**

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add supabase/migrations/20260602000000_qbo_readonly_sync_a0_schema.sql tests/unit/supabase/qbo-a0-schema-migration.test.ts && git commit -m "feat(accounting): add QBO read-only sync A0 schema, RLS rails, and owner flag override"
```

---

### Task A0.2: Post-apply verification — confirm the new objects exist in prod

**Files:**
- (No files created; this is a live read-only verification against prod ops-app.)

- [ ] **Step 1: Verify the column + all seven tables exist with RLS on.** Run via `mcp__plugin_supabase_supabase__execute_sql` (`project_id: ijeekuhbatykdomumfjx`):

```sql
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'accounting_connections'
       and column_name = 'sync_direction') as sync_direction_col,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
       and c.relname in (
         'qbo_import_runs','qbo_staging_customers','qbo_staging_estimates',
         'qbo_staging_invoices','qbo_staging_line_items','qbo_staging_payments',
         'qbo_customer_matches')) as rls_tables,
  (select count(*) from pg_extension where extname = 'pg_trgm') as pg_trgm,
  (select count(*) from public.feature_flag_overrides
     where flag_slug = 'accounting'
       and user_id = '1746a0c1-be43-45d6-ab4d-584e82594b1b') as owner_override,
  (select count(*) from public.feature_flag_overrides where flag_slug = 'accounting') as total_accounting_overrides;
```

Expected: `sync_direction_col = 1`, `rls_tables = 7`, `pg_trgm = 1`, `owner_override = 1`, `total_accounting_overrides = 6` (the 5 pre-existing + the owner — confirms no existing row was disturbed).

- [ ] **Step 2: Verify the read policies are SELECT-only (zero write policies) and the existing stub connection now defaults to pull_only.** Run via `mcp__plugin_supabase_supabase__execute_sql`:

```sql
select
  (select count(*) from pg_policy p
     join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and p.polcmd <> 'r'
       and c.relname in (
         'qbo_import_runs','qbo_staging_customers','qbo_staging_estimates',
         'qbo_staging_invoices','qbo_staging_line_items','qbo_staging_payments',
         'qbo_customer_matches')) as write_policies,
  (select sync_direction from public.accounting_connections
     where company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077' and provider = 'quickbooks') as canpro_direction;
```

Expected: `write_policies = 0`, `canpro_direction = 'pull_only'` (the existing stub row picked up the column default — confirms the safety default applies retroactively).

- [ ] **Step 3: Record the verification outcome in the run log** (no commit — read-only). If any count is off, do not proceed to A0.3/A0.4; investigate (most likely the migration sentinel rolled back and the apply needs a re-run).

---

### Task A0.3: TypeScript types — QboImportRun, QboStaged*, QboCustomerMatch, MatchAction, QboImportReview

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/types/qbo-import.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/types/pipeline.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/lib/types/qbo-import.test.ts`

- [ ] **Step 1: Write the failing types test.** Create `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/lib/types/qbo-import.test.ts`. This is a type-and-shape contract test: it imports the types both directly and via the `pipeline.ts` re-export, and exercises the runtime `MATCH_ACTIONS` tuple + a type-level assertion helper so a missing/renamed field fails compilation (which `vitest run` surfaces because esbuild transpiles the test).

```ts
import { describe, expect, it } from "vitest";
import {
  MATCH_ACTIONS,
  type MatchAction,
  type QboImportRun,
  type QboStagedCustomer,
  type QboStagedEstimate,
  type QboStagedInvoice,
  type QboStagedLineItem,
  type QboStagedPayment,
  type QboCustomerMatch,
  type QboImportReview,
} from "@/lib/types/qbo-import";
// Re-export surface must also resolve from pipeline.ts.
import type { QboImportReview as QboImportReviewViaPipeline } from "@/lib/types/pipeline";

function expectType<T>(_value: T): void {
  /* compile-time assertion only */
}

describe("qbo-import types", () => {
  it("exposes the four match actions as a runtime tuple", () => {
    expect(MATCH_ACTIONS).toEqual(["link", "create", "skip", "needs_review"]);
  });

  it("MatchAction is the union of the runtime tuple", () => {
    const a: MatchAction = "link";
    const b: MatchAction = "needs_review";
    expect([a, b]).toEqual(["link", "needs_review"]);
  });

  it("QboImportRun carries run metadata, the zero-write counter, and reconciliation totals", () => {
    const run: QboImportRun = {
      id: "r1",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      provider: "quickbooks",
      status: "staged",
      historyCutoff: "2024-06-01",
      qbWriteCalls: 0,
      totals: { customers: 12 },
      error: null,
      createdBy: "1746a0c1-be43-45d6-ab4d-584e82594b1b",
      createdAt: new Date(),
      finishedAt: null,
    };
    expectType<QboImportRun>(run);
    expect(run.qbWriteCalls).toBe(0);
  });

  it("staging types map the verified QB columns", () => {
    const customer: QboStagedCustomer = {
      id: "c1", runId: "r1", companyId: "co", qbId: "1",
      displayName: "Acme", email: null, phone: null, address: null,
      active: true, raw: {}, createdAt: new Date(),
    };
    const estimate: QboStagedEstimate = {
      id: "e1", runId: "r1", companyId: "co", qbId: "10",
      docNumber: "E-10", customerQbId: "1", txnDate: "2025-01-01",
      expirationDate: null, txnStatus: "Pending",
      subtotal: 100, taxAmount: 8, taxRate: 0.08, total: 108, raw: {},
    };
    const invoice: QboStagedInvoice = {
      id: "i1", runId: "r1", companyId: "co", qbId: "20",
      docNumber: "INV-20", customerQbId: "1", estimateQbId: "10",
      txnDate: "2025-02-01", dueDate: "2025-03-01",
      subtotal: 100, taxAmount: 8, taxRate: 0.08, total: 108,
      balance: 108, derivedStatus: "awaiting_payment", raw: {},
    };
    const line: QboStagedLineItem = {
      id: "l1", runId: "r1", companyId: "co", parentType: "invoice",
      parentQbId: "20", qbLineId: "1", name: "Decking", description: "Cedar",
      quantity: 3.5, unitPrice: 9.5, amount: 33.25, isTaxable: true,
      qbItemType: "Service", sortOrder: 0,
    };
    const payment: QboStagedPayment = {
      id: "p1", runId: "r1", companyId: "co", qbId: "30",
      customerQbId: "1", txnDate: "2025-03-15", totalAmt: 108,
      unappliedAmt: 0,
      appliedLines: [{ invoiceQbId: "20", amount: 108, referenceNumber: "CHK-1" }],
      raw: {},
    };
    expectType<QboStagedCustomer>(customer);
    expectType<QboStagedEstimate>(estimate);
    expectType<QboStagedInvoice>(invoice);
    expectType<QboStagedLineItem>(line);
    expectType<QboStagedPayment>(payment);
    expect(line.parentType).toBe("invoice");
    expect(payment.appliedLines[0].invoiceQbId).toBe("20");
  });

  it("QboCustomerMatch carries proposal + owner decision fields", () => {
    const match: QboCustomerMatch = {
      id: "m1", runId: "r1", companyId: "co", customerQbId: "1",
      proposedAction: "link", matchedClientId: "client-1",
      matchBasis: "email", confidence: "high",
      candidates: [{ clientId: "client-1", name: "Acme", basis: "email", score: 1 }],
      decidedAction: null, decidedClientId: null,
    };
    expectType<QboCustomerMatch>(match);
    expect(match.proposedAction).toBe("link");
  });

  it("QboImportReview aggregates the run, matches, counts, and reconciliation totals", () => {
    const review: QboImportReview = {
      run: {
        id: "r1", companyId: "co", provider: "quickbooks", status: "staged",
        historyCutoff: "2024-06-01", qbWriteCalls: 0, totals: {}, error: null,
        createdBy: null, createdAt: new Date(), finishedAt: null,
      },
      matches: [],
      counts: {
        customers: 12, customersLink: 8, customersCreate: 3, customersSkip: 0,
        customersNeedsReview: 1, estimates: 5, invoices: 20, lineItems: 60,
        payments: 18, orphanPayments: 1, skippedInvoices: 2,
      },
      reconciliation: {
        quickbooks: { openArTotal: 12345.67, openInvoiceCount: 9, collected24mo: 89000, customerCount: 12 },
        ops: { openArTotal: 12345.67, openInvoiceCount: 9, collected24mo: 89000, customerCount: 12 },
      },
    };
    expectType<QboImportReview>(review);
    expectType<QboImportReviewViaPipeline>(review);
    expect(review.reconciliation.quickbooks.openArTotal).toBe(review.reconciliation.ops.openArTotal);
  });
});
```

- [ ] **Step 2: Run the test, confirm it FAILS.** Module does not exist yet.

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/lib/types/qbo-import.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/types/qbo-import"`.

- [ ] **Step 3: Create the types module.** Create `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/types/qbo-import.ts`. camelCase interfaces, `Date | null` for timestamps, `number` for numerics, `string | null` for nullable text — matching `pipeline.ts` conventions. Dates pulled from QB (txn/expiration/due dates) are kept as ISO `string` (DB `date`), while `created_at`/`finished_at` are `Date | null` (DB `timestamptz`, hydrated by the service layer):

```ts
/**
 * OPS Web - QuickBooks Import (read-only sync) Types
 *
 * TypeScript interfaces for the QBO pull -> stage -> review -> apply pipeline.
 * These map to the qbo_* tables created in migration
 * 20260602000000_qbo_readonly_sync_a0_schema.sql.
 *
 * Conventions (match pipeline.ts):
 *   - camelCase fields (snake_case -> camelCase at the service layer).
 *   - `Date | null` for timestamptz columns; ISO `string` for `date` columns.
 *   - `number` for NUMERIC monetary/quantity values.
 *   - `Record<string, unknown>` for jsonb blobs.
 */

// ─── Run + status ─────────────────────────────────────────────────────────────

export type QboImportRunStatus =
  | "pending"
  | "pulling"
  | "staged"
  | "applying"
  | "applied"
  | "error";

/** One pull -> stage -> apply cycle. Mirrors qbo_import_runs. */
export interface QboImportRun {
  id: string;
  companyId: string;
  provider: string;
  status: QboImportRunStatus;
  /** Trailing-history cutoff date used for the pull window (ISO date). */
  historyCutoff: string | null;
  /** MUST stay 0 — read-only guarantee. Any non-zero value is a hard failure. */
  qbWriteCalls: number;
  totals: Record<string, unknown>;
  error: string | null;
  createdBy: string | null;
  createdAt: Date | null;
  finishedAt: Date | null;
}

// ─── Staging ────────────────────────────────────────────────────────────────--

/** Mirrors qbo_staging_customers. */
export interface QboStagedCustomer {
  id: string;
  runId: string;
  companyId: string;
  qbId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean | null;
  raw: Record<string, unknown> | null;
  createdAt: Date | null;
}

/** Mirrors qbo_staging_estimates. */
export interface QboStagedEstimate {
  id: string;
  runId: string;
  companyId: string;
  qbId: string;
  docNumber: string | null;
  customerQbId: string | null;
  txnDate: string | null;
  expirationDate: string | null;
  txnStatus: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  total: number | null;
  raw: Record<string, unknown> | null;
}

/** Mirrors qbo_staging_invoices. */
export interface QboStagedInvoice {
  id: string;
  runId: string;
  companyId: string;
  qbId: string;
  docNumber: string | null;
  customerQbId: string | null;
  estimateQbId: string | null;
  txnDate: string | null;
  dueDate: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  total: number | null;
  balance: number | null;
  derivedStatus: string | null;
  raw: Record<string, unknown> | null;
}

/** Mirrors qbo_staging_line_items. parentType discriminates the parent doc. */
export interface QboStagedLineItem {
  id: string;
  runId: string;
  companyId: string;
  parentType: "invoice" | "estimate";
  parentQbId: string;
  qbLineId: string | null;
  name: string | null;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  isTaxable: boolean | null;
  qbItemType: string | null;
  sortOrder: number | null;
}

/** One element of qbo_staging_payments.applied_lines. */
export interface QboStagedPaymentLine {
  invoiceQbId: string;
  amount: number;
  referenceNumber: string | null;
}

/** Mirrors qbo_staging_payments. */
export interface QboStagedPayment {
  id: string;
  runId: string;
  companyId: string;
  qbId: string;
  customerQbId: string | null;
  txnDate: string | null;
  totalAmt: number | null;
  unappliedAmt: number | null;
  appliedLines: QboStagedPaymentLine[];
  raw: Record<string, unknown> | null;
}

// ─── Customer matching ─────────────────────────────────────────────────────--

/** The four proposed/decided actions for a staged QB customer. */
export const MATCH_ACTIONS = ["link", "create", "skip", "needs_review"] as const;
export type MatchAction = (typeof MATCH_ACTIONS)[number];

export type MatchBasis = "email" | "name_exact" | "name_fuzzy" | "none";
export type MatchConfidence = "high" | "medium" | "low";

/** A candidate existing client surfaced for an ambiguous/low-confidence match. */
export interface QboMatchCandidate {
  clientId: string;
  name: string | null;
  basis: MatchBasis;
  /** 0..1 similarity score (1 = exact email/name). */
  score: number;
}

/** Mirrors qbo_customer_matches. */
export interface QboCustomerMatch {
  id: string;
  runId: string;
  companyId: string;
  customerQbId: string;
  proposedAction: MatchAction;
  matchedClientId: string | null;
  matchBasis: MatchBasis | null;
  confidence: MatchConfidence | null;
  candidates: QboMatchCandidate[];
  decidedAction: MatchAction | null;
  decidedClientId: string | null;
}

// ─── Review aggregate (returned to the review UI) ──────────────────────────--

/** Per-action and per-entity counts surfaced in the review screen. */
export interface QboImportCounts {
  customers: number;
  customersLink: number;
  customersCreate: number;
  customersSkip: number;
  customersNeedsReview: number;
  estimates: number;
  invoices: number;
  lineItems: number;
  payments: number;
  /** Payments with no linked pulled invoice (deposits/retainers). */
  orphanPayments: number;
  /** Voided / zero-total invoices skipped + flagged. */
  skippedInvoices: number;
}

/** A single side (QuickBooks or OPS) of the reconciliation strip. */
export interface QboReconciliationSide {
  openArTotal: number;
  openInvoiceCount: number;
  collected24mo: number;
  customerCount: number;
}

export interface QboReconciliation {
  quickbooks: QboReconciliationSide;
  ops: QboReconciliationSide;
}

/** Aggregate payload returned to the review UI for a run. */
export interface QboImportReview {
  run: QboImportRun;
  matches: QboCustomerMatch[];
  counts: QboImportCounts;
  reconciliation: QboReconciliation;
}

/** One owner decision applied at apply-time. */
export interface QboApplyDecision {
  customerQbId: string;
  action: MatchAction;
  clientId?: string;
}
```

- [ ] **Step 4: Re-export from pipeline.ts.** Add a re-export block under the existing email-connection re-exports (after line 24) in `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/types/pipeline.ts`, matching the established `export type { ... } from "./..."` pattern:

```ts
// Re-export QuickBooks import (read-only sync) types (./qbo-import.ts)
export type {
  QboImportRunStatus,
  QboImportRun,
  QboStagedCustomer,
  QboStagedEstimate,
  QboStagedInvoice,
  QboStagedLineItem,
  QboStagedPaymentLine,
  QboStagedPayment,
  MatchBasis,
  MatchConfidence,
  MatchAction,
  QboMatchCandidate,
  QboCustomerMatch,
  QboImportCounts,
  QboReconciliationSide,
  QboReconciliation,
  QboImportReview,
  QboApplyDecision,
} from "./qbo-import";
export { MATCH_ACTIONS } from "./qbo-import";
```

- [ ] **Step 5: Run the test, confirm it PASSES.**

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/lib/types/qbo-import.test.ts
```

Expected: PASS — 6 tests / 6 passed.

- [ ] **Step 6: Type-check the whole project to confirm the re-export compiles cleanly.**

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx tsc --noEmit
```

Expected: PASS (no new errors referencing `qbo-import.ts` or `pipeline.ts`). Pre-existing unrelated errors elsewhere, if any, are not introduced by this change.

- [ ] **Step 7: Commit.**

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/types/qbo-import.ts src/lib/types/pipeline.ts tests/unit/lib/types/qbo-import.test.ts && git commit -m "feat(accounting): add QBO import TypeScript types and pipeline re-exports"
```

---

### Task A0.4: Orchestrator direction-mode guard (read-only safety rail at the engine layer)

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/sync-orchestrator.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/lib/api/services/sync-orchestrator-direction-guard.test.ts`

> Engine-level guard only. `runSyncForConnection` loads `sync_direction` from the connection row (one extra select) so its public signature is unchanged and no caller must be touched. In `pull_only` the push path is unreachable; in `push_only` the pull path is unreachable. The `/api/sync` 409 refusal (route-level) and the callback `pull_only`/`sync_enabled=false` change are owned by later phases per the master plan.

- [ ] **Step 1: Write the failing guard test.** Create `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/lib/api/services/sync-orchestrator-direction-guard.test.ts`. Mock the QB/Sage sync services and `AccountingTokenService`, and a minimal Supabase stub, then assert that a `pull_only` connection NEVER calls any `push*` method.

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const pushClient = vi.fn();
const pushInvoice = vi.fn();
const pushEstimate = vi.fn();
const pushPayment = vi.fn();
const pullClients = vi.fn(async () => []);
const pullInvoices = vi.fn(async () => []);

vi.mock("@/lib/api/services/quickbooks-sync-service", () => ({
  QuickBooksSyncService: { pushClient, pushInvoice, pushEstimate, pushPayment, pullClients, pullInvoices },
}));
vi.mock("@/lib/api/services/sage-sync-service", () => ({
  SageSyncService: {
    pushClient: vi.fn(), pushInvoice: vi.fn(), pushEstimate: vi.fn(),
    pushPayment: vi.fn(), pullClients: vi.fn(async () => []), pullInvoices: vi.fn(async () => []),
  },
}));
vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken: vi.fn(async () => ({ accessToken: "tok", realmId: "realm-1" })),
  },
}));

import { runSyncForConnection } from "@/lib/api/services/sync-orchestrator";

/**
 * Minimal chainable Supabase stub. select(...).eq(...).eq(...).single()
 * returns the connection row carrying sync_direction; all writes/upserts
 * resolve to no-ops; pull selects (clients/invoices by qb_id) resolve empty.
 */
function makeSupabaseStub(syncDirection: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    or: vi.fn(chain),
    order: vi.fn(chain),
    limit: vi.fn(chain),
    update: vi.fn(chain),
    insert: vi.fn(async () => ({ data: null, error: null })),
    upsert: vi.fn(async () => ({ data: null, error: null })),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({
      data: { id: "conn-1", sync_direction: syncDirection },
      error: null,
    })),
    then: undefined,
  });
  // `await builder` (used for list selects) resolves to an empty rows envelope.
  (builder as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null });
  return { from: vi.fn(() => builder) } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSyncForConnection direction guard", () => {
  it("never calls any push* method for a pull_only connection", async () => {
    const supabase = makeSupabaseStub("pull_only");
    await runSyncForConnection(
      supabase,
      "a612edc0-5c18-4c4d-af97-55b9410dd077",
      "quickbooks",
      "conn-1",
      null
    );
    expect(pushClient).not.toHaveBeenCalled();
    expect(pushInvoice).not.toHaveBeenCalled();
    expect(pushEstimate).not.toHaveBeenCalled();
    expect(pushPayment).not.toHaveBeenCalled();
  });

  it("never calls any pull* method for a push_only connection", async () => {
    const supabase = makeSupabaseStub("push_only");
    await runSyncForConnection(
      supabase,
      "a612edc0-5c18-4c4d-af97-55b9410dd077",
      "quickbooks",
      "conn-1",
      null
    );
    expect(pullClients).not.toHaveBeenCalled();
    expect(pullInvoices).not.toHaveBeenCalled();
  });

  it("runs both halves for a bidirectional connection (legacy behavior preserved)", async () => {
    const supabase = makeSupabaseStub("bidirectional");
    await runSyncForConnection(
      supabase,
      "a612edc0-5c18-4c4d-af97-55b9410dd077",
      "quickbooks",
      "conn-1",
      null
    );
    expect(pullClients).toHaveBeenCalledTimes(1);
    expect(pullInvoices).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test, confirm it FAILS.** `runSyncForConnection` does not yet read `sync_direction`, so a `pull_only` run still executes the push loops (which call `pushClient` against the empty client list — actually 0 calls — but the bidirectional/push_only assertions and the load-of-direction behavior will not hold). Run:

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/lib/api/services/sync-orchestrator-direction-guard.test.ts
```

Expected: FAIL — the `push_only` case still invokes `pullClients`/`pullInvoices` (current code always pulls), so `expect(pullClients).not.toHaveBeenCalled()` fails; the orchestrator does not yet branch on direction.

- [ ] **Step 3: Add the direction parameter to the QB/Sage sync functions.** In `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/sync-orchestrator.ts`, change the `syncQuickBooks` signature to accept a direction and guard each half. Replace the function header (line 27-35) and wrap the push/pull blocks:

Change the signature:

```ts
async function syncQuickBooks(
  supabase: SupabaseClient,
  companyId: string,
  connectionId: string,
  lastSyncAt: string | null,
  syncDirection: "pull_only" | "push_only" | "bidirectional"
): Promise<SyncResult[]> {
  const { accessToken, realmId } = await AccountingTokenService.getValidToken(supabase, connectionId);
  if (!realmId) throw new Error("QuickBooks realmId not found on connection");

  const results: SyncResult[] = [];
  const canPush = syncDirection !== "pull_only";
  const canPull = syncDirection !== "push_only";
```

Wrap the four push blocks (clients/invoices/estimates/payments, lines 38-166) in `if (canPush) { ... }`, and the two pull blocks (lines 168-232) in `if (canPull) { ... }`. Concretely, open the brace immediately before the `// ── Push Clients` block and close it immediately after the `// ── Push Payments` block's `results.push(...)`; likewise open before `// ── Pull Clients` and close after the `// ── Pull Invoices` block. The block bodies are unchanged.

- [ ] **Step 4: Apply the same guard to `syncSage`.** Change the `syncSage` signature (line 239-245) identically:

```ts
async function syncSage(
  supabase: SupabaseClient,
  companyId: string,
  connectionId: string,
  lastSyncAt: string | null,
  syncDirection: "pull_only" | "push_only" | "bidirectional"
): Promise<SyncResult[]> {
  const { accessToken } = await AccountingTokenService.getValidToken(supabase, connectionId);
  const results: SyncResult[] = [];
  const canPush = syncDirection !== "pull_only";
  const canPull = syncDirection !== "push_only";
```

Wrap the four Sage push blocks (lines 248-376) in `if (canPush) { ... }` and the two Sage pull blocks (lines 378-442) in `if (canPull) { ... }`. Block bodies unchanged.

- [ ] **Step 5: Load `sync_direction` in `runSyncForConnection` and pass it down.** Replace the body of `runSyncForConnection` (lines 449-498) so it reads the connection's direction first, defaults to `'bidirectional'` only if the column is somehow null (it cannot be — `NOT NULL DEFAULT 'pull_only'`), and forwards it:

```ts
export async function runSyncForConnection(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
  connectionId: string,
  lastSyncAt: string | null
): Promise<{ success: boolean; results: SyncResult[]; message: string }> {
  // Read-only safety rail: the connection's direction mode decides which
  // halves of the engine may run. A 'pull_only' connection can NEVER reach a
  // push* method; 'push_only' can never reach a pull*. Loaded here so the
  // public signature is unchanged and every caller is automatically guarded.
  const { data: conn, error: connErr } = await supabase
    .from("accounting_connections")
    .select("sync_direction")
    .eq("id", connectionId)
    .single();

  if (connErr || !conn) {
    throw new Error(`Connection ${connectionId} not found for direction check`);
  }

  const syncDirection = (conn.sync_direction ?? "pull_only") as
    | "pull_only"
    | "push_only"
    | "bidirectional";

  let results: SyncResult[];

  if (provider === "quickbooks") {
    results = await syncQuickBooks(supabase, companyId, connectionId, lastSyncAt, syncDirection);
  } else if (provider === "sage") {
    results = await syncSage(supabase, companyId, connectionId, lastSyncAt, syncDirection);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  // Log each result
  const totalErrors = results.reduce((acc, r) => acc + r.errors.length, 0);

  for (const r of results) {
    await supabase.from("accounting_sync_log").insert({
      company_id: companyId,
      provider,
      direction: r.direction,
      entity_type: r.entityType,
      status: r.errors.length > 0 ? "partial" : "success",
      details: r.errors.length > 0
        ? `${r.count} synced, ${r.errors.length} errors: ${r.errors.slice(0, 3).join("; ")}`
        : `${r.count} synced`,
    });
  }

  // Update last_sync_at
  await supabase
    .from("accounting_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  const totalSynced = results.reduce((acc, r) => acc + r.count, 0);

  return {
    success: true,
    results,
    message: `Sync complete: ${totalSynced} records synced${totalErrors > 0 ? `, ${totalErrors} errors` : ""}`,
  };
}
```

- [ ] **Step 6: Run the guard test, confirm it PASSES.**

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/lib/api/services/sync-orchestrator-direction-guard.test.ts
```

Expected: PASS — 3 tests / 3 passed (pull_only never pushes, push_only never pulls, bidirectional does both).

- [ ] **Step 7: Run the full accounting/sync test surface to confirm no regression.**

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/lib/api/services tests/unit/supabase tests/unit/lib/types/qbo-import.test.ts
```

Expected: PASS (all existing sync-orchestrator tests, if any, still green; the new guard + schema + types tests green).

- [ ] **Step 8: Commit.**

```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/sync-orchestrator.ts tests/unit/lib/api/services/sync-orchestrator-direction-guard.test.ts && git commit -m "feat(accounting): enforce sync_direction read-only guard in sync orchestrator"
```


## Phase A1 — Read-only QuickBooks pull service

## Phase A1 — Read-only QuickBooks pull service

> **Prereq:** Phase A0 (schema + safety rails) has landed. A1 is pure application code (one new service file + one test file) and does not touch the DB. It is safe to run in parallel with A0 because it has no schema dependency — the pull service only talks to the Intuit API and returns plain arrays; staging-table writes happen in A2/A3.
>
> **Parallel-session safety:** the working tree has pre-existing WIP from sibling sessions (`projects-table-v2/*`, dictionaries, `CLAUDE.md`). Every commit in this phase stages files **by name** (never `git add -A`/`.`). Do not touch those files.
>
> **Read-only contract (the whole point of A1):** `QuickBooksPullService` issues **GET only**. It tracks a `qbWriteCalls` counter that must remain `0`. The test suite mocks `fetch` and asserts that the `method` of every request is `GET` (or undefined → GET). A non-GET verb is a hard test failure.

---

### Task A1.1: Pull-service input-validation + host-switch (TDD, no network)

Establishes the deterministic, pure pieces first (host selection from `QB_ENVIRONMENT`, cutoff-date validation, query builder) so they can be unit-tested without any fetch. The class shell is created here; network methods are filled in A1.2.

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/quickbooks-pull-service.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/services/quickbooks-pull-service.test.ts`

- [ ] **Step 1: Write the failing host-switch + validation test.** Create the test file with the deterministic cases only (no fetch yet). The service is imported but not yet implemented, so this MUST fail to import/compile.

```ts
// tests/unit/services/quickbooks-pull-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { QuickBooksPullService } from "@/lib/api/services/quickbooks-pull-service";

describe("QuickBooksPullService — host selection", () => {
  it("uses the production host only when QB_ENVIRONMENT==='production'", () => {
    const prod = new QuickBooksPullService("4620816365", "tok", "production");
    expect(prod.baseUrl).toBe("https://quickbooks.api.intuit.com/v3/company/4620816365");
  });

  it("uses the sandbox host for 'sandbox', unset, or any other value", () => {
    const sandbox = new QuickBooksPullService("4620816365", "tok", "sandbox");
    const fallback = new QuickBooksPullService("4620816365", "tok", undefined);
    const garbage = new QuickBooksPullService("4620816365", "tok", "staging");
    expect(sandbox.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
    expect(fallback.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
    expect(garbage.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
  });

  it("starts with qbWriteCalls at 0", () => {
    expect(new QuickBooksPullService("r", "t", "production").qbWriteCalls).toBe(0);
  });
});

describe("QuickBooksPullService — cutoff validation", () => {
  it("rejects a non-YYYY-MM-DD cutoff before issuing any request", async () => {
    const fetchSpy = vi.fn();
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.pullInvoices("2024/01/01")).rejects.toThrow("Invalid cutoff date");
    await expect(svc.pullInvoices("garbage")).rejects.toThrow("Invalid cutoff date");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a valid YYYY-MM-DD cutoff (no throw on validation)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 })
    );
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.pullInvoices("2024-06-01")).resolves.toBeInstanceOf(Array);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module not found).**
  - Command: `npx vitest run tests/unit/services/quickbooks-pull-service.test.ts`
  - Expected: FAIL — `Failed to resolve import "@/lib/api/services/quickbooks-pull-service"`.

- [ ] **Step 3: Implement the class shell with host switch, validation, and the GET-only fetch core.** Write the full service file. (Network query methods in A1.2 build on `qboQuery`, which is implemented here so the cutoff-acceptance test passes.)

```ts
// src/lib/api/services/quickbooks-pull-service.ts
/**
 * OPS Web - QuickBooks Read-Only Pull Service
 *
 * GET-ONLY QuickBooks Online client for the read-only import (Sub-project A).
 * Issues nothing but GET requests against the QBO query endpoint; a write
 * verb is a hard failure. Tracks `qbWriteCalls`, which MUST remain 0 — the
 * import run records it and a non-zero value fails the run (spec §6.5).
 *
 * All methods accept a pre-validated access token + realmId (resolve via
 * AccountingTokenService.getValidToken). Host is selected by QB_ENVIRONMENT.
 * No minorversion is sent. Pagination via STARTPOSITION/MAXRESULTS.
 */

const QBO_PRODUCTION_HOST = "https://quickbooks.api.intuit.com";
const QBO_SANDBOX_HOST = "https://sandbox-quickbooks.api.intuit.com";

const PAGE_SIZE = 1000;

// QBO TxnDate is a date; cutoff is interpolated into the query so it must be
// a bare YYYY-MM-DD with no quote/space characters that could break out.
const CUTOFF_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertCutoff(cutoff: string): string {
  if (!CUTOFF_DATE_RE.test(cutoff)) {
    throw new Error(`Invalid cutoff date (expected YYYY-MM-DD): ${cutoff}`);
  }
  return cutoff;
}

export class QuickBooksPullService {
  readonly realmId: string;
  private readonly accessToken: string;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;
  private _qbWriteCalls = 0;

  /**
   * @param realmId      QBO company realm id.
   * @param accessToken  Valid OAuth access token (already refreshed).
   * @param environment  process.env.QB_ENVIRONMENT — 'production' selects the
   *                     production host; anything else (incl. unset/'sandbox')
   *                     selects the sandbox host (matches the existing OAuth
   *                     route default).
   * @param fetchImpl    Injectable fetch (defaults to global fetch) — tests
   *                     pass a spy to assert GET-only behavior.
   */
  constructor(
    realmId: string,
    accessToken: string,
    environment: string | undefined,
    fetchImpl: typeof fetch = fetch
  ) {
    this.realmId = realmId;
    this.accessToken = accessToken;
    this.host = environment?.trim() === "production" ? QBO_PRODUCTION_HOST : QBO_SANDBOX_HOST;
    this.fetchImpl = fetchImpl;
  }

  /** Read-only invariant: number of non-GET requests issued. MUST stay 0. */
  get qbWriteCalls(): number {
    return this._qbWriteCalls;
  }

  /** Effective company base, e.g. https://quickbooks.api.intuit.com/v3/company/{realmId}. */
  get baseUrl(): string {
    return `${this.host}/v3/company/${this.realmId}`;
  }

  /**
   * Issue a single read-only QBO query. GET ONLY. Returns the QueryResponse
   * object (entity arrays live under their type key, e.g. QueryResponse.Invoice).
   */
  private async qboQuery(sql: string): Promise<Record<string, unknown>> {
    const method = "GET";
    // Defensive: if this method is ever edited to a non-GET verb, count it so
    // the run fails loudly rather than silently writing to QuickBooks.
    if (method !== "GET") {
      this._qbWriteCalls += 1;
    }
    const url = `${this.baseUrl}/query?query=${encodeURIComponent(sql)}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuickBooks pull error (${response.status}): ${errorText}`);
    }

    const body = (await response.json()) as { QueryResponse?: Record<string, unknown> };
    return body.QueryResponse ?? {};
  }

  /**
   * Page through one entity via STARTPOSITION/MAXRESULTS until a short page.
   * `baseSql` must NOT already contain STARTPOSITION/MAXRESULTS — they are
   * appended here. `entityKey` is the QueryResponse key (e.g. "Invoice").
   */
  private async paginate(baseSql: string, entityKey: string): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let startPosition = 1; // QBO STARTPOSITION is 1-based
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const sql = `${baseSql} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;
      const qr = await this.qboQuery(sql);
      const rows = (qr[entityKey] as Array<Record<string, unknown>> | undefined) ?? [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      startPosition += PAGE_SIZE;
    }
    return out;
  }

  // ── Pull methods (implemented in A1.2) ───────────────────────────────────

  async pullCustomers(): Promise<Array<Record<string, unknown>>> {
    return this.paginate("SELECT * FROM Customer", "Customer");
  }

  async pullInvoices(cutoffISO: string): Promise<Array<Record<string, unknown>>> {
    const cutoff = assertCutoff(cutoffISO);
    // Window = (last 24mo by TxnDate) UNION (any still-open by Balance),
    // deduped by Id. QBO has no UNION, so issue two queries and merge.
    const recent = await this.paginate(
      `SELECT * FROM Invoice WHERE TxnDate >= '${cutoff}'`,
      "Invoice"
    );
    const open = await this.paginate(
      `SELECT * FROM Invoice WHERE Balance > '0'`,
      "Invoice"
    );
    return dedupeById([...recent, ...open]);
  }

  async pullEstimates(cutoffISO: string): Promise<Array<Record<string, unknown>>> {
    const cutoff = assertCutoff(cutoffISO);
    return this.paginate(`SELECT * FROM Estimate WHERE TxnDate >= '${cutoff}'`, "Estimate");
  }

  async pullPayments(cutoffISO: string): Promise<Array<Record<string, unknown>>> {
    const cutoff = assertCutoff(cutoffISO);
    return this.paginate(`SELECT * FROM Payment WHERE TxnDate >= '${cutoff}'`, "Payment");
  }

  async pullItems(): Promise<Array<Record<string, unknown>>> {
    return this.paginate("SELECT * FROM Item", "Item");
  }
}

function dedupeById(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of records) {
    const id = r.Id as string | undefined;
    if (id === undefined) continue;
    if (!byId.has(id)) byId.set(id, r);
  }
  return Array.from(byId.values());
}
```

- [ ] **Step 4: Run the test — expect PASS (host + validation cases).**
  - Command: `npx vitest run tests/unit/services/quickbooks-pull-service.test.ts`
  - Expected: PASS for the "host selection" and "cutoff validation" describes. (The pagination/dedup/GET-only network behavior is asserted in A1.2; both files compile now.)

- [ ] **Step 5: Type-check the new service.**
  - Command: `npx tsc --noEmit`
  - Expected: no new errors referencing `quickbooks-pull-service.ts` (pre-existing errors elsewhere from sibling WIP are out of scope — confirm none are in the new file).

- [ ] **Step 6: Commit (stage by name only).**
  - Command:
    ```
    git add src/lib/api/services/quickbooks-pull-service.ts tests/unit/services/quickbooks-pull-service.test.ts
    git commit -m "feat(accounting): add read-only QuickBooksPullService shell with host switch and cutoff validation"
    ```
  - No AI attribution. Do not stage any other modified file.

---

### Task A1.2: GET-only invariant, pagination, and 24-month/open invoice window (TDD with mocked fetch + real sandbox JSON)

Proves the safety core: with a mocked `fetch`, **every** request is a GET, the `qbWriteCalls` counter stays `0`, pagination walks STARTPOSITION pages, and the invoice window fires the two-query (recent OR open) dedupe. Uses real sandbox JSON shapes (Invoice with trailing `SubTotalLineDetail`, `Payment.Line[].LinkedTxn`, `Customer.PrimaryEmailAddr`).

**Files:**
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/services/quickbooks-pull-service.test.ts` (append)

- [ ] **Step 1: Add a sandbox-JSON fixture + a GET-asserting fetch harness to the test file.** Append to the existing test file. The harness records the `method` and `url` of every call and serves canned `QueryResponse` payloads keyed by the entity in the SQL.

```ts
// ── Real sandbox JSON shapes (trimmed to fields the import uses) ───────────

const SANDBOX_CUSTOMER = {
  Id: "1",
  DisplayName: "Amy's Bird Sanctuary",
  PrimaryEmailAddr: { Address: "Birds@Intuit.com" },
  PrimaryPhone: { FreeFormNumber: "(650) 555-3311" },
  BillAddr: { Line1: "4581 Finch St.", City: "Bayshore", CountrySubDivisionCode: "CA", PostalCode: "94326" },
  Active: true,
};

const SANDBOX_INVOICE_RECENT = {
  Id: "130",
  DocNumber: "1037",
  CustomerRef: { value: "1", name: "Amy's Bird Sanctuary" },
  TxnDate: "2024-09-01",
  DueDate: "2024-10-01",
  TotalAmt: 362.07,
  Balance: 0,
  Line: [
    {
      Id: "1",
      LineNum: 1,
      Description: "Rock Fountain",
      Amount: 275,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: { value: "5", name: "Rock Fountain" }, Qty: 1, UnitPrice: 275, TaxCodeRef: { value: "TAX" } },
    },
    // trailing computed line present on every real invoice — must be skipped downstream
    { Amount: 335.25, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} },
  ],
  TxnTaxDetail: { TotalTax: 26.82, TaxLine: [{ Amount: 26.82, DetailType: "TaxLineDetail", TaxLineDetail: { TaxPercent: 8, NetAmountTaxable: 335.25 } }] },
};

const SANDBOX_INVOICE_OPEN = {
  Id: "131",
  DocNumber: "1038",
  CustomerRef: { value: "1" },
  TxnDate: "2020-01-15", // older than the 24mo window — only reached via Balance>0
  DueDate: "2020-02-15",
  TotalAmt: 100,
  Balance: 100,
  Line: [{ Id: "1", LineNum: 1, Description: "Services", Amount: 100, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { Qty: 1, UnitPrice: 100, TaxCodeRef: { value: "NON" } } }],
};

const SANDBOX_PAYMENT = {
  Id: "200",
  TotalAmt: 362.07,
  TxnDate: "2024-10-05",
  CustomerRef: { value: "1" },
  PaymentRefNum: "CHK-9981",
  UnappliedAmt: 0,
  Line: [{ Amount: 362.07, LinkedTxn: [{ TxnId: "130", TxnType: "Invoice" }] }],
};

const SANDBOX_ESTIMATE = {
  Id: "300",
  DocNumber: "EST-7",
  CustomerRef: { value: "1" },
  TxnDate: "2024-08-01",
  ExpirationDate: "2024-09-01",
  TxnStatus: "Accepted",
  TotalAmt: 362.07,
  Line: [{ Id: "1", LineNum: 1, Description: "Rock Fountain", Amount: 275, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { Qty: 1, UnitPrice: 275 } }],
};

const SANDBOX_ITEM = { Id: "5", Name: "Rock Fountain", Type: "NonInventory" };

/**
 * Build a fetch spy that records every request and answers QBO queries based
 * on the SQL in the `query=` param. `pages` optionally returns multiple pages
 * for an entity to exercise STARTPOSITION pagination.
 */
function makeQboFetch(opts: {
  pages?: Record<string, Array<Array<Record<string, unknown>>>>; // entityKey -> array of pages
  single?: Record<string, Array<Record<string, unknown>>>; // entityKey -> one page
}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });

    const sql = decodeURIComponent(new URL(url).searchParams.get("query") ?? "");
    const startMatch = sql.match(/STARTPOSITION (\d+)/);
    const start = startMatch ? Number(startMatch[1]) : 1;
    const pageIndex = Math.floor((start - 1) / 1000);

    const entityKey =
      /FROM Customer/.test(sql) ? "Customer" :
      /FROM Invoice/.test(sql) ? "Invoice" :
      /FROM Estimate/.test(sql) ? "Estimate" :
      /FROM Payment/.test(sql) ? "Payment" :
      /FROM Item/.test(sql) ? "Item" : "Unknown";

    let rows: Array<Record<string, unknown>> = [];
    if (opts.pages?.[entityKey]) {
      rows = opts.pages[entityKey][pageIndex] ?? [];
    } else if (opts.single?.[entityKey]) {
      // Invoice fires twice (recent + open); disambiguate by the WHERE clause.
      if (entityKey === "Invoice" && /Balance > '0'/.test(sql)) {
        rows = (opts.single["Invoice_open"] as Array<Record<string, unknown>>) ?? [];
      } else {
        rows = opts.single[entityKey] ?? [];
      }
    }
    return new Response(JSON.stringify({ QueryResponse: { [entityKey]: rows } }), { status: 200 });
  });
  return { calls, fetchSpy };
}
```

- [ ] **Step 2: Write the failing GET-only + window + pagination tests.** Append these describes.

```ts
describe("QuickBooksPullService — read-only invariant (GET only)", () => {
  it("issues ONLY GET requests across every pull method and never increments qbWriteCalls", async () => {
    const { calls, fetchSpy } = makeQboFetch({
      single: {
        Customer: [SANDBOX_CUSTOMER],
        Invoice: [SANDBOX_INVOICE_RECENT],
        Invoice_open: [SANDBOX_INVOICE_OPEN],
        Estimate: [SANDBOX_ESTIMATE],
        Payment: [SANDBOX_PAYMENT],
        Item: [SANDBOX_ITEM],
      },
    });
    const svc = new QuickBooksPullService("4620816365", "tok", "production", fetchSpy as unknown as typeof fetch);

    await svc.pullCustomers();
    await svc.pullInvoices("2022-06-01");
    await svc.pullEstimates("2022-06-01");
    await svc.pullPayments("2022-06-01");
    await svc.pullItems();

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(c.url).toContain("/query?query=");
    }
    // The defining safety assertion: nothing was ever written to QuickBooks.
    expect(svc.qbWriteCalls).toBe(0);
  });

  it("targets the correct production query endpoint", async () => {
    const { calls, fetchSpy } = makeQboFetch({ single: { Customer: [SANDBOX_CUSTOMER] } });
    const svc = new QuickBooksPullService("4620816365", "tok", "production", fetchSpy as unknown as typeof fetch);
    await svc.pullCustomers();
    expect(calls[0].url.startsWith("https://quickbooks.api.intuit.com/v3/company/4620816365/query")).toBe(true);
  });

  it("omits minorversion from the request URL", async () => {
    const { calls, fetchSpy } = makeQboFetch({ single: { Customer: [SANDBOX_CUSTOMER] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await svc.pullCustomers();
    expect(calls[0].url).not.toContain("minorversion");
  });
});

describe("QuickBooksPullService — invoice window (open OR last-24mo, deduped)", () => {
  it("fires a recent-by-TxnDate query AND an open-by-Balance query, deduped by Id", async () => {
    const { calls, fetchSpy } = makeQboFetch({
      single: { Invoice: [SANDBOX_INVOICE_RECENT], Invoice_open: [SANDBOX_INVOICE_OPEN] },
    });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);

    const invoices = await svc.pullInvoices("2022-06-01");

    const sqls = calls.map((c) => decodeURIComponent(new URL(c.url).searchParams.get("query")!));
    expect(sqls.some((s) => /WHERE TxnDate >= '2022-06-01'/.test(s))).toBe(true);
    expect(sqls.some((s) => /WHERE Balance > '0'/.test(s))).toBe(true);
    // recent (130) + open (131), both distinct Ids
    expect(invoices.map((i) => i.Id).sort()).toEqual(["130", "131"]);
  });

  it("dedupes an invoice that appears in BOTH queries (same Id once)", async () => {
    const { fetchSpy } = makeQboFetch({
      // 130 is both recent and open → appears in each query, must collapse to one
      single: { Invoice: [SANDBOX_INVOICE_RECENT], Invoice_open: [SANDBOX_INVOICE_RECENT] },
    });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    const invoices = await svc.pullInvoices("2022-06-01");
    expect(invoices).toHaveLength(1);
    expect(invoices[0].Id).toBe("130");
  });
});

describe("QuickBooksPullService — pagination", () => {
  it("walks STARTPOSITION until a short page, concatenating all rows", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ Id: `c${i}`, DisplayName: `Cust ${i}` }));
    const lastPage = [{ Id: "c1000", DisplayName: "Cust 1000" }];
    const { calls, fetchSpy } = makeQboFetch({ pages: { Customer: [fullPage, lastPage] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);

    const customers = await svc.pullCustomers();

    expect(customers).toHaveLength(1001);
    // page 1 STARTPOSITION 1, page 2 STARTPOSITION 1001
    const positions = calls.map((c) => decodeURIComponent(new URL(c.url).searchParams.get("query")!).match(/STARTPOSITION (\d+)/)![1]);
    expect(positions).toEqual(["1", "1001"]);
  });

  it("stops after a single page when fewer than MAXRESULTS rows return", async () => {
    const { calls, fetchSpy } = makeQboFetch({ single: { Customer: [SANDBOX_CUSTOMER] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await svc.pullCustomers();
    expect(calls).toHaveLength(1);
  });
});

describe("QuickBooksPullService — passthrough fidelity (real sandbox shapes survive)", () => {
  it("returns raw Customer with PrimaryEmailAddr/BillAddr intact for downstream mapping", async () => {
    const { fetchSpy } = makeQboFetch({ single: { Customer: [SANDBOX_CUSTOMER] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    const [c] = await svc.pullCustomers();
    expect((c.PrimaryEmailAddr as { Address: string }).Address).toBe("Birds@Intuit.com");
    expect((c.BillAddr as { Line1: string }).Line1).toBe("4581 Finch St.");
  });

  it("returns raw Payment with Line[].LinkedTxn intact", async () => {
    const { fetchSpy } = makeQboFetch({ single: { Payment: [SANDBOX_PAYMENT] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    const [p] = await svc.pullPayments("2022-06-01");
    const line = (p.Line as Array<{ LinkedTxn: Array<{ TxnId: string; TxnType: string }> }>)[0];
    expect(line.LinkedTxn[0]).toEqual({ TxnId: "130", TxnType: "Invoice" });
  });

  it("returns raw Invoice with trailing SubTotalLineDetail line present (to be skipped downstream)", async () => {
    const { fetchSpy } = makeQboFetch({ single: { Invoice: [SANDBOX_INVOICE_RECENT], Invoice_open: [] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    const [inv] = await svc.pullInvoices("2022-06-01");
    const lines = inv.Line as Array<{ DetailType: string }>;
    expect(lines.some((l) => l.DetailType === "SubTotalLineDetail")).toBe(true);
  });
});

describe("QuickBooksPullService — error surface", () => {
  it("throws on a non-OK QBO response with status + body", async () => {
    const fetchSpy = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.pullCustomers()).rejects.toThrow("QuickBooks pull error (401): unauthorized");
    expect(svc.qbWriteCalls).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test — expect PASS (implementation from A1.1 already satisfies these).**
  - Command: `npx vitest run tests/unit/services/quickbooks-pull-service.test.ts`
  - Expected: ALL describes PASS — GET-only invariant, `qbWriteCalls === 0`, two-query invoice window + dedupe, STARTPOSITION pagination, passthrough fidelity, and error surface. (If any fail, the A1.1 implementation is wrong — fix the service, not the test.)
  - **If a failure occurs**, the most likely culprits to inspect in `quickbooks-pull-service.ts`: (a) `paginate` not appending STARTPOSITION/MAXRESULTS, (b) `pullInvoices` not issuing the second `Balance > '0'` query, (c) `dedupeById` keeping the wrong copy. Fix the service to make the test pass; the test encodes the contract.

- [ ] **Step 4: Run the full unit suite for this file in watch-free mode + confirm no other suite regressed by the new file.**
  - Command: `npx vitest run tests/unit/services/`
  - Expected: `quickbooks-pull-service.test.ts` and `weather-service.test.ts` both PASS.

- [ ] **Step 5: Commit (stage by name only).**
  - Command:
    ```
    git add tests/unit/services/quickbooks-pull-service.test.ts
    git commit -m "test(accounting): assert QuickBooksPullService is GET-only with 24mo/open invoice window and pagination"
    ```
  - No AI attribution. The service file is unchanged unless Step 3 required a fix — if it was, include `src/lib/api/services/quickbooks-pull-service.ts` in the `git add` for this commit.

---

### Task A1.3: Export a typed pull surface for the import service (no behavior change)

The import service (phase A2/A3) needs (a) the class, and (b) a small typed contract for what the pull returns so it can record `qb_write_calls` into `qbo_import_runs` and pass raw rows into staging without re-deriving shapes. This task adds the minimal type aliases the pull layer owns, in the new `qbo-import.ts`, without pre-empting the A2-owned interfaces.

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/types/qbo-import.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/quickbooks-pull-service.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/services/quickbooks-pull-service.test.ts` (append one type-contract assertion)

- [ ] **Step 1: Write a failing test for the exported `QboPullResult` aggregate shape.** Append:

```ts
import type { QboPullResult } from "@/lib/types/qbo-import";

describe("QuickBooksPullService — pullAll aggregate", () => {
  it("pullAll returns every entity array plus the write-call counter", async () => {
    const { fetchSpy } = makeQboFetch({
      single: {
        Customer: [SANDBOX_CUSTOMER],
        Invoice: [SANDBOX_INVOICE_RECENT],
        Invoice_open: [],
        Estimate: [SANDBOX_ESTIMATE],
        Payment: [SANDBOX_PAYMENT],
        Item: [SANDBOX_ITEM],
      },
    });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);

    const result: QboPullResult = await svc.pullAll("2022-06-01");

    expect(result.customers).toHaveLength(1);
    expect(result.invoices).toHaveLength(1);
    expect(result.estimates).toHaveLength(1);
    expect(result.payments).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.qbWriteCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.**
  - Command: `npx vitest run tests/unit/services/quickbooks-pull-service.test.ts`
  - Expected: FAIL — `@/lib/types/qbo-import` not found AND `pullAll` does not exist.

- [ ] **Step 3: Create `qbo-import.ts` with the pull-layer types only.** Author the file with the raw-record alias and the pull aggregate. (The full `QboImportRun`, `QboStaged*`, `QboCustomerMatch`, `QboImportReview`, `MatchAction` interfaces are added in phase A2 where they are first consumed — this file is appended there, not rewritten.)

```ts
// src/lib/types/qbo-import.ts
/**
 * OPS Web - QuickBooks Import Types (Sub-project A, read-only sync)
 *
 * Phase A1 owns only the pull-layer contract below. Staging-record and
 * review/match interfaces (QboImportRun, QboStagedCustomer, QboStagedInvoice,
 * QboStagedEstimate, QboStagedLineItem, QboStagedPayment, QboCustomerMatch,
 * MatchAction, QboImportReview) are appended in phase A2/A3 where they are
 * first consumed — do not duplicate them here.
 */

/** A raw QuickBooks Online record as returned by the pull service (untyped passthrough). */
export type QboRawRecord = Record<string, unknown>;

/** Aggregate of one full read-only pull, plus the safety counter (must be 0). */
export interface QboPullResult {
  customers: QboRawRecord[];
  invoices: QboRawRecord[];
  estimates: QboRawRecord[];
  payments: QboRawRecord[];
  items: QboRawRecord[];
  /** Number of non-GET requests issued during the pull. MUST be 0 (spec §6.5). */
  qbWriteCalls: number;
}
```

- [ ] **Step 4: Add `pullAll` to the service and align its return types.** Edit `quickbooks-pull-service.ts`: import the types and add `pullAll`. Change the five pull-method return types from `Record<string, unknown>[]` to `QboRawRecord[]` for consistency (purely cosmetic — same runtime type).

  Add the import at the top of the file (after the file header comment block):
  ```ts
  import type { QboRawRecord, QboPullResult } from "@/lib/types/qbo-import";
  ```

  Replace each `Promise<Array<Record<string, unknown>>>` return annotation on `pullCustomers`/`pullInvoices`/`pullEstimates`/`pullPayments`/`pullItems` (and the `paginate`/`qboQuery`/`dedupeById` internals) with `QboRawRecord` equivalents, then add `pullAll` as a new public method after `pullItems`:

  ```ts
  /**
   * Run a full read-only pull in dependency-neutral order and return every
   * entity array plus the GET-only write-call counter for the import run.
   */
  async pullAll(cutoffISO: string): Promise<QboPullResult> {
    const cutoff = assertCutoff(cutoffISO);
    const customers = await this.pullCustomers();
    const invoices = await this.pullInvoices(cutoff);
    const estimates = await this.pullEstimates(cutoff);
    const payments = await this.pullPayments(cutoff);
    const items = await this.pullItems();
    return { customers, invoices, estimates, payments, items, qbWriteCalls: this.qbWriteCalls };
  }
  ```

  (`QboRawRecord` is `Record<string, unknown>`, so the existing method bodies and `dedupeById` need no logic change — only the annotations. If you prefer, leave the internal `Record<string, unknown>` annotations as-is and only annotate the public method return types with `QboRawRecord[]`; both compile identically.)

- [ ] **Step 5: Run the test — expect PASS.**
  - Command: `npx vitest run tests/unit/services/quickbooks-pull-service.test.ts`
  - Expected: ALL describes PASS including the new `pullAll` aggregate.

- [ ] **Step 6: Type-check.**
  - Command: `npx tsc --noEmit`
  - Expected: no new errors in `quickbooks-pull-service.ts` or `qbo-import.ts`.

- [ ] **Step 7: Commit (stage by name only).**
  - Command:
    ```
    git add src/lib/types/qbo-import.ts src/lib/api/services/quickbooks-pull-service.ts tests/unit/services/quickbooks-pull-service.test.ts
    git commit -m "feat(accounting): add QboPullResult type and pullAll aggregate to QuickBooksPullService"
    ```
  - No AI attribution.

---

### Phase A1 exit criteria

- [ ] `src/lib/api/services/quickbooks-pull-service.ts` exists: `QuickBooksPullService` with private `qboQuery`, `pullCustomers/pullInvoices/pullEstimates/pullPayments/pullItems`, `pullAll`, public `qbWriteCalls` + `baseUrl` getters, injectable `fetchImpl`.
- [ ] Invoice window = `TxnDate >= cutoff` **plus** `Balance > '0'`, deduped by `Id`.
- [ ] Host switch: `QB_ENVIRONMENT==='production'` → production host; anything else → sandbox (matches existing OAuth route default).
- [ ] `minorversion` never appears in any request URL.
- [ ] Pagination via STARTPOSITION (1-based) / MAXRESULTS 1000, looping until a short page.
- [ ] Tests assert **every** request method is `GET` and `qbWriteCalls === 0` across all pull methods.
- [ ] `src/lib/types/qbo-import.ts` exports `QboRawRecord` + `QboPullResult` (and reserves space for the A2-owned interfaces).
- [ ] `npx vitest run tests/unit/services/quickbooks-pull-service.test.ts` is green; `npx tsc --noEmit` introduces no new errors in the two new files.
- [ ] Three atomic commits, files staged by name, no AI attribution, sibling WIP untouched.


## Phase A2 — Pull → stage + customer matching engine (quickbooks-import-service.ts)

## Phase A2 — Pull → stage + customer matching engine

Builds `quickbooks-import-service.ts`: `startImportRun` (create a `qbo_import_runs` row), `pullAndStage` (drive A1's `QuickBooksPullService`, normalize QB JSON into `qbo_staging_*` per the verified mappings — skip SubTotal/Tax/Discount/Description lines, flatten Group lines, split payments per linked invoice), `computeCustomerMatches` (email → name_exact → pg_trgm fuzzy → create, writing `qbo_customer_matches`), and `getImportReview` (the `QboImportReview` aggregate with reconciliation totals). TDD throughout, driven by sandbox-shaped fixture JSON.

> Depends on A0 (schema + types + pg_trgm + `accounting` flag override) and A1 (`QuickBooksPullService`). `applyImport` is A3 and is intentionally left as a typed `throw new Error("applyImport is implemented in phase A3")` stub here so the class shape is stable for routes (A-routes phase) without leaking apply behavior into A2.

---

### Task A2.1: Review-aggregate type (`QboImportReview`) + match types

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/types/qbo-import.ts` (A0 created the file with the staging/run/match types; A2 owns the review aggregate shape it returns)

- [ ] **Step 1: Read the A0-authored type file.** Open `src/lib/types/qbo-import.ts` and confirm `QboImportRun`, `QboStagedCustomer`, `QboStagedInvoice`, `QboStagedEstimate`, `QboStagedLineItem`, `QboStagedPayment`, `QboCustomerMatch`, and `MatchAction` already exist (A0). If `QboImportReview` is absent, proceed to add it. (If A0 already added a stub `QboImportReview`, reconcile — do not duplicate the export.)

- [ ] **Step 2: Add the reconciliation + review aggregate types.** Append to `src/lib/types/qbo-import.ts`:

```typescript
// ─── Review aggregate (returned by getImportReview → review UI) ──────────────

/** Per-action customer counts shown in the review header. */
export interface QboMatchCounts {
  link: number;
  create: number;
  skip: number;
  needs_review: number;
}

/** Staged record counts surfaced in the review UI. */
export interface QboStagedCounts {
  customers: number;
  estimates: number;
  invoices: number;
  lineItems: number;
  payments: number;
  /** Payment rows whose linked invoice was not pulled (deposits/retainers). */
  orphanPayments: number;
  /** Invoices skipped because voided or zero-total. */
  skippedInvoices: number;
}

/**
 * QUICKBOOKS-vs-OPS reconciliation totals. Because CanPro has 0 live invoices
 * pre-apply, "opsToBe" mirrors the QB-authoritative staged values; the strip
 * turns green when QB === opsToBe to the cent.
 */
export interface QboReconciliation {
  /** Sum of staged invoice `balance` for non-skipped invoices (QB open A/R). */
  qbOpenAr: number;
  /** What OPS A/R will become after apply (== qbOpenAr; QB is authoritative). */
  opsToBeOpenAr: number;
  /** Count of non-skipped staged invoices with balance > 0. */
  openInvoiceCount: number;
  /** Sum of staged payment `amount` (applied lines only) in the pull window. */
  collectedInWindow: number;
  /** Distinct staged customers. */
  customerCount: number;
  /** True when qbOpenAr === opsToBeOpenAr (rounded to cents). */
  arMatched: boolean;
}

/** Aggregate payload the review screen renders. */
export interface QboImportReview {
  run: QboImportRun;
  matches: QboCustomerMatch[];
  matchCounts: QboMatchCounts;
  stagedCounts: QboStagedCounts;
  reconciliation: QboReconciliation;
}
```

- [ ] **Step 3: Type-check.** Run:
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx tsc --noEmit
```
Expect: PASS (no errors referencing `qbo-import.ts`). If A0's types are not yet merged this will fail on missing `QboImportRun`/`QboCustomerMatch` — that is the A0 dependency, not an A2 defect; note it and proceed once A0 lands.

- [ ] **Step 4: Commit.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/types/qbo-import.ts && git commit -m "feat(qbo-import): add QboImportReview reconciliation aggregate types"
```

---

### Task A2.2: Pure normalization helpers — failing tests

**Files:**
- Create (test): `/Users/jacksonsweet/Projects/OPS/ops-web/tests/fixtures/qbo/customer.json`
- Create (test): `/Users/jacksonsweet/Projects/OPS/ops-web/tests/fixtures/qbo/invoice.json`
- Create (test): `/Users/jacksonsweet/Projects/OPS/ops-web/tests/fixtures/qbo/estimate.json`
- Create (test): `/Users/jacksonsweet/Projects/OPS/ops-web/tests/fixtures/qbo/payment.json`
- Create (test): `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/__tests__/qbo-normalize.test.ts`

- [ ] **Step 1: Write the sandbox-shaped Customer fixture.** Create `tests/fixtures/qbo/customer.json` (two customers: one with email+phone+addr, one inactive name-only):
```json
[
  {
    "Id": "58",
    "DisplayName": "Cool Cars",
    "PrimaryEmailAddr": { "Address": "cool_cars@intuit.com" },
    "PrimaryPhone": { "FreeFormNumber": "(415) 555-9933" },
    "BillAddr": {
      "Line1": "65 Ocean Dr.",
      "City": "Half Moon Bay",
      "CountrySubDivisionCode": "CA",
      "PostalCode": "94213"
    },
    "Active": true
  },
  {
    "Id": "12",
    "DisplayName": "Diego Rodriguez",
    "Active": false
  }
]
```

- [ ] **Step 2: Write the Invoice fixture** (`tests/fixtures/qbo/invoice.json`) covering: a real sales line, a SubTotal line (must be skipped), txn-level tax, an Estimate LinkedTxn, and a balance:
```json
[
  {
    "Id": "130",
    "DocNumber": "1037",
    "CustomerRef": { "value": "58", "name": "Cool Cars" },
    "TxnDate": "2026-04-01",
    "DueDate": "2026-05-01",
    "TotalAmt": 362.07,
    "Balance": 362.07,
    "LinkedTxn": [{ "TxnId": "98", "TxnType": "Estimate" }],
    "TxnTaxDetail": {
      "TotalTax": 26.82,
      "TaxLine": [
        { "Amount": 26.82, "TaxLineDetail": { "TaxPercent": 8, "PercentBased": true } }
      ]
    },
    "Line": [
      {
        "Id": "1",
        "LineNum": 1,
        "Description": "Rock Fountain",
        "Amount": 275.0,
        "DetailType": "SalesItemLineDetail",
        "SalesItemLineDetail": {
          "ItemRef": { "value": "5", "name": "Rock Fountain" },
          "Qty": 1,
          "UnitPrice": 275.0,
          "TaxCodeRef": { "value": "TAX" }
        }
      },
      {
        "Id": "2",
        "LineNum": 2,
        "Description": "Pump Hours",
        "Amount": 47.5,
        "DetailType": "SalesItemLineDetail",
        "SalesItemLineDetail": {
          "ItemRef": { "value": "11", "name": "Pump" },
          "Qty": 9.5,
          "UnitPrice": 5.0,
          "TaxCodeRef": { "value": "NON" }
        }
      },
      {
        "Amount": 335.25,
        "DetailType": "SubTotalLineDetail",
        "SubTotalLineDetail": {}
      }
    ]
  },
  {
    "Id": "131",
    "DocNumber": "1038",
    "CustomerRef": { "value": "58" },
    "TxnDate": "2026-04-02",
    "TotalAmt": 0,
    "Balance": 0,
    "Line": []
  }
]
```

- [ ] **Step 3: Write the Estimate fixture** (`tests/fixtures/qbo/estimate.json`) with a Group line to flatten and an Accepted status:
```json
[
  {
    "Id": "98",
    "DocNumber": "1001",
    "CustomerRef": { "value": "58" },
    "TxnDate": "2026-03-10",
    "ExpirationDate": "2026-04-10",
    "TxnStatus": "Accepted",
    "TotalAmt": 362.07,
    "TxnTaxDetail": {
      "TotalTax": 26.82,
      "TaxLine": [{ "Amount": 26.82, "TaxLineDetail": { "TaxPercent": 8 } }]
    },
    "Line": [
      {
        "Id": "1",
        "LineNum": 1,
        "Amount": 335.25,
        "DetailType": "GroupLineDetail",
        "GroupLineDetail": {
          "Line": [
            {
              "Id": "1a",
              "LineNum": 1,
              "Description": "Garden Install",
              "Amount": 335.25,
              "DetailType": "SalesItemLineDetail",
              "SalesItemLineDetail": {
                "ItemRef": { "value": "19", "name": "Installation" },
                "Qty": 3.5,
                "UnitPrice": 95.7857,
                "TaxCodeRef": { "value": "TAX" }
              }
            }
          ]
        }
      },
      { "Amount": 335.25, "DetailType": "SubTotalLineDetail", "SubTotalLineDetail": {} }
    ]
  }
]
```

- [ ] **Step 4: Write the Payment fixture** (`tests/fixtures/qbo/payment.json`): one payment applied to two invoices plus unapplied amount:
```json
[
  {
    "Id": "200",
    "CustomerRef": { "value": "58" },
    "TxnDate": "2026-04-15",
    "TotalAmt": 500.0,
    "UnappliedAmt": 137.93,
    "PaymentRefNum": "CHK-8841",
    "PaymentMethodRef": { "value": "1", "name": "Check" },
    "Line": [
      {
        "Amount": 362.07,
        "LinkedTxn": [{ "TxnId": "130", "TxnType": "Invoice" }]
      },
      {
        "Amount": 0.0,
        "LinkedTxn": [{ "TxnId": "131", "TxnType": "Invoice" }]
      }
    ]
  }
]
```

- [ ] **Step 5: Write the failing helper test.** Create `src/lib/api/services/__tests__/qbo-normalize.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import customers from "../../../../../tests/fixtures/qbo/customer.json";
import invoices from "../../../../../tests/fixtures/qbo/invoice.json";
import estimates from "../../../../../tests/fixtures/qbo/estimate.json";
import payments from "../../../../../tests/fixtures/qbo/payment.json";
import {
  normalizeCustomer,
  normalizeInvoice,
  normalizeEstimate,
  flattenSalesLines,
  splitPaymentLines,
  deriveInvoiceStatus,
  mapEstimateStatus,
  joinBillAddr,
} from "../qbo-normalize";

const TODAY = new Date("2026-04-20T00:00:00Z");

describe("normalizeCustomer", () => {
  it("maps id/name/email/phone/joined address/active", () => {
    const c = normalizeCustomer(customers[0]);
    expect(c.qb_id).toBe("58");
    expect(c.display_name).toBe("Cool Cars");
    expect(c.email).toBe("cool_cars@intuit.com");
    expect(c.phone).toBe("(415) 555-9933");
    expect(c.address).toBe("65 Ocean Dr., Half Moon Bay, CA 94213");
    expect(c.active).toBe(true);
  });

  it("handles name-only inactive customer", () => {
    const c = normalizeCustomer(customers[1]);
    expect(c.qb_id).toBe("12");
    expect(c.email).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.address).toBeNull();
    expect(c.active).toBe(false);
  });
});

describe("joinBillAddr", () => {
  it("joins present parts, comma-separating line/city and space-separating region/postal", () => {
    expect(
      joinBillAddr({ Line1: "1 A St", City: "Townsville", CountrySubDivisionCode: "BC", PostalCode: "V1V 1V1" })
    ).toBe("1 A St, Townsville, BC V1V 1V1");
  });
  it("returns null for empty/absent address", () => {
    expect(joinBillAddr(undefined)).toBeNull();
    expect(joinBillAddr({})).toBeNull();
  });
});

describe("flattenSalesLines", () => {
  it("keeps only SalesItemLineDetail, skips SubTotal, flattens GroupLineDetail", () => {
    const lines = flattenSalesLines((invoices[0] as { Line: unknown[] }).Line);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.name)).toEqual(["Rock Fountain", "Pump Hours"]);

    const estLines = flattenSalesLines((estimates[0] as { Line: unknown[] }).Line);
    expect(estLines).toHaveLength(1);
    expect(estLines[0].name).toBe("Garden Install");
    expect(estLines[0].quantity).toBe(3.5);
  });

  it("derives is_taxable from TaxCodeRef and sort_order from LineNum", () => {
    const lines = flattenSalesLines((invoices[0] as { Line: unknown[] }).Line);
    expect(lines[0].is_taxable).toBe(true); // TAX
    expect(lines[1].is_taxable).toBe(false); // NON
    expect(lines[0].sort_order).toBe(1);
    expect(lines[1].sort_order).toBe(2);
  });

  it("defaults quantity to 1 and amount equals qty*unitPrice", () => {
    const lines = flattenSalesLines((invoices[0] as { Line: unknown[] }).Line);
    expect(lines[1].quantity).toBe(9.5);
    expect(lines[1].unit_price).toBe(5);
    expect(lines[1].amount).toBe(47.5);
  });
});

describe("normalizeInvoice", () => {
  it("maps headers, txn-level tax, estimate linkage; flags zero-total skip", () => {
    const open = normalizeInvoice(invoices[0], TODAY);
    expect(open.staging.qb_id).toBe("130");
    expect(open.staging.doc_number).toBe("1037");
    expect(open.staging.customer_qb_id).toBe("58");
    expect(open.staging.estimate_qb_id).toBe("98");
    expect(open.staging.total).toBe(362.07);
    expect(open.staging.subtotal).toBe(335.25);
    expect(open.staging.tax_amount).toBe(26.82);
    expect(open.staging.tax_rate).toBe(8);
    expect(open.staging.balance).toBe(362.07);
    expect(open.staging.derived_status).toBe("past_due"); // DueDate 2026-05-01 > TODAY → not past; check next
    expect(open.skipped).toBe(false);

    const zero = normalizeInvoice(invoices[1], TODAY);
    expect(zero.skipped).toBe(true); // zero-total → skipped+flagged
  });

  it("emits one staged line per SalesItemLineDetail with parent linkage", () => {
    const open = normalizeInvoice(invoices[0], TODAY);
    expect(open.lines).toHaveLength(2);
    expect(open.lines[0].parent_type).toBe("invoice");
    expect(open.lines[0].parent_qb_id).toBe("130");
  });
});

describe("deriveInvoiceStatus", () => {
  it("paid when balance 0", () => {
    expect(deriveInvoiceStatus(0, 100, "2026-05-01", TODAY)).toBe("paid");
  });
  it("partially_paid when 0 < balance < total", () => {
    expect(deriveInvoiceStatus(40, 100, "2026-05-01", TODAY)).toBe("partially_paid");
  });
  it("past_due when full balance and due date passed", () => {
    expect(deriveInvoiceStatus(100, 100, "2026-04-01", TODAY)).toBe("past_due");
  });
  it("awaiting_payment when full balance and not yet due", () => {
    expect(deriveInvoiceStatus(100, 100, "2026-05-01", TODAY)).toBe("awaiting_payment");
  });
});

describe("mapEstimateStatus", () => {
  it("maps QB TxnStatus to OPS estimate status enum", () => {
    expect(mapEstimateStatus("Accepted", null, TODAY)).toBe("approved");
    expect(mapEstimateStatus("Closed", null, TODAY)).toBe("converted");
    expect(mapEstimateStatus("Rejected", null, TODAY)).toBe("declined");
    expect(mapEstimateStatus("Pending", "2026-05-01", TODAY)).toBe("sent");
    expect(mapEstimateStatus("Pending", "2026-04-01", TODAY)).toBe("expired");
  });
});

describe("normalizeEstimate", () => {
  it("maps headers and flattened lines", () => {
    const e = normalizeEstimate(estimates[0], TODAY);
    expect(e.staging.qb_id).toBe("98");
    expect(e.staging.estimate_number).toBe("1001");
    expect(e.staging.txn_status).toBe("approved");
    expect(e.staging.expiration_date).toBe("2026-04-10");
    expect(e.lines).toHaveLength(1);
    expect(e.lines[0].parent_type).toBe("estimate");
    expect(e.lines[0].parent_qb_id).toBe("98");
  });
});

describe("splitPaymentLines", () => {
  it("emits one row per LinkedTxn[Invoice] line; reports unapplied", () => {
    const rows = splitPaymentLines(payments[0]);
    expect(rows.applied).toHaveLength(2);
    expect(rows.applied[0].invoice_qb_id).toBe("130");
    expect(rows.applied[0].amount).toBe(362.07);
    expect(rows.applied[0].reference_number).toBe("CHK-8841");
    expect(rows.applied[1].invoice_qb_id).toBe("131");
    expect(rows.unappliedAmt).toBe(137.93);
    expect(rows.payment_method).toBe("Check");
    expect(rows.total_amt).toBe(500);
    expect(rows.customer_qb_id).toBe("58");
  });
});
```

- [ ] **Step 6: Run the failing test (expect FAIL — module missing).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/qbo-normalize.test.ts
```
Expect: FAIL — `Cannot find module '../qbo-normalize'`.

- [ ] **Step 7: Commit the fixtures + failing test.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add tests/fixtures/qbo/customer.json tests/fixtures/qbo/invoice.json tests/fixtures/qbo/estimate.json tests/fixtures/qbo/payment.json src/lib/api/services/__tests__/qbo-normalize.test.ts && git commit -m "test(qbo-import): sandbox fixtures + failing normalization specs"
```

---

### Task A2.3: Implement `qbo-normalize.ts` (pure QB-JSON → staging-row mappers)

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/qbo-normalize.ts`

- [ ] **Step 1: Write the helper module.** Create `src/lib/api/services/qbo-normalize.ts`:
```typescript
/**
 * OPS Web - QuickBooks → OPS normalization helpers (pure, side-effect free)
 *
 * Maps raw QuickBooks Online JSON into the shape of the qbo_staging_* tables,
 * per the verified sandbox mappings (spec §5.4–5.7). No Supabase, no I/O — so
 * every transformation is unit-testable against fixture JSON.
 *
 * READ-ONLY semantics: these only read QB records; nothing here writes to QB.
 */

type QbRecord = Record<string, unknown>;

// ─── Small typed views into the QB JSON ─────────────────────────────────────

interface QbBillAddr {
  Line1?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
}

/** A flattened SalesItemLineDetail line in staging shape (parent set by caller). */
export interface StagedLineCore {
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  is_taxable: boolean;
  qb_item_type: string | null;
  qb_line_id: string | null;
  sort_order: number;
}

export interface StagedLine extends StagedLineCore {
  parent_type: "invoice" | "estimate";
  parent_qb_id: string;
}

export interface StagedCustomerRow {
  qb_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  raw: QbRecord;
}

export interface StagedInvoiceRow {
  qb_id: string;
  doc_number: string | null;
  customer_qb_id: string | null;
  estimate_qb_id: string | null;
  txn_date: string | null;
  due_date: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  tax_rate: number | null;
  total: number | null;
  balance: number | null;
  derived_status: string;
  raw: QbRecord;
}

export interface StagedEstimateRow {
  qb_id: string;
  doc_number: string | null;
  customer_qb_id: string | null;
  txn_date: string | null;
  expiration_date: string | null;
  txn_status: string;
  subtotal: number | null;
  tax_amount: number | null;
  tax_rate: number | null;
  total: number | null;
  raw: QbRecord;
}

export interface NormalizedInvoice {
  staging: StagedInvoiceRow;
  lines: StagedLine[];
  skipped: boolean;
  skipReason: string | null;
}

export interface NormalizedEstimate {
  staging: StagedEstimateRow;
  lines: StagedLine[];
}

export interface PaymentAppliedLine {
  invoice_qb_id: string;
  amount: number;
  reference_number: string | null;
}

export interface SplitPayment {
  qb_id: string;
  customer_qb_id: string | null;
  txn_date: string | null;
  total_amt: number | null;
  unappliedAmt: number | null;
  payment_method: string | null;
  applied: PaymentAppliedLine[];
}

// ─── Field accessors ────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Round to cents, matching how line_total / QB Amount compare. */
function cents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Customer ───────────────────────────────────────────────────────────────

export function joinBillAddr(addr: QbBillAddr | undefined): string | null {
  if (!addr) return null;
  const line = [addr.Line1, addr.City].filter((p): p is string => !!p && p.length > 0);
  const region = [addr.CountrySubDivisionCode, addr.PostalCode]
    .filter((p): p is string => !!p && p.length > 0)
    .join(" ");
  const parts = [...line];
  if (region) parts.push(region);
  const joined = parts.join(", ");
  return joined.length > 0 ? joined : null;
}

export function normalizeCustomer(raw: QbRecord): StagedCustomerRow {
  const email = (raw.PrimaryEmailAddr as { Address?: string } | undefined)?.Address;
  const phone = (raw.PrimaryPhone as { FreeFormNumber?: string } | undefined)?.FreeFormNumber;
  return {
    qb_id: String(raw.Id),
    display_name: str(raw.DisplayName),
    email: str(email),
    phone: str(phone),
    address: joinBillAddr(raw.BillAddr as QbBillAddr | undefined),
    active: raw.Active !== false, // QB defaults active when absent
    raw,
  };
}

// ─── Line items ─────────────────────────────────────────────────────────────

function mapSalesLine(line: QbRecord): StagedLineCore {
  const detail = (line.SalesItemLineDetail as QbRecord) ?? {};
  const itemRef = detail.ItemRef as { name?: string } | undefined;
  const description = str(line.Description);
  const name = description ?? str(itemRef?.name) ?? "Line item";
  const qty = num(detail.Qty) ?? 1;
  const unitPrice = num(detail.UnitPrice) ?? 0;
  const amount = num(line.Amount) ?? cents(qty * unitPrice);
  const taxCode = (detail.TaxCodeRef as { value?: string } | undefined)?.value;
  return {
    name,
    description,
    quantity: qty,
    unit_price: unitPrice,
    amount: cents(amount),
    is_taxable: !!taxCode && taxCode !== "NON",
    qb_item_type: str(itemRef?.name) ? null : null, // Item.Type resolved later via pullItems; default null
    qb_line_id: str(line.Id),
    sort_order: num(line.LineNum) ?? 0,
  };
}

/**
 * Keep only SalesItemLineDetail lines. Skip SubTotal / Discount / DescriptionOnly.
 * Flatten GroupLineDetail.Line[] recursively.
 */
export function flattenSalesLines(lines: unknown): StagedLineCore[] {
  const arr = Array.isArray(lines) ? (lines as QbRecord[]) : [];
  const out: StagedLineCore[] = [];
  for (const line of arr) {
    const detailType = line.DetailType;
    if (detailType === "SalesItemLineDetail") {
      out.push(mapSalesLine(line));
    } else if (detailType === "GroupLineDetail") {
      const nested = (line.GroupLineDetail as { Line?: unknown } | undefined)?.Line;
      out.push(...flattenSalesLines(nested));
    }
    // SubTotalLineDetail / DiscountLineDetail / DescriptionOnly → skip
  }
  return out;
}

function attachParent(
  cores: StagedLineCore[],
  parentType: "invoice" | "estimate",
  parentQbId: string
): StagedLine[] {
  return cores.map((c) => ({ ...c, parent_type: parentType, parent_qb_id: parentQbId }));
}

// ─── Header tax / totals ────────────────────────────────────────────────────

function subtotalFromLines(lines: unknown): number | null {
  const arr = Array.isArray(lines) ? (lines as QbRecord[]) : [];
  const subLine = arr.find((l) => l.DetailType === "SubTotalLineDetail");
  return subLine ? num(subLine.Amount) : null;
}

function taxFromTxnDetail(raw: QbRecord): { taxAmount: number | null; taxRate: number | null } {
  const detail = raw.TxnTaxDetail as
    | { TotalTax?: number; TaxLine?: Array<{ TaxLineDetail?: { TaxPercent?: number } }> }
    | undefined;
  if (!detail) return { taxAmount: null, taxRate: null };
  const taxAmount = num(detail.TotalTax);
  const firstTaxLine = Array.isArray(detail.TaxLine) ? detail.TaxLine[0] : undefined;
  const taxRate = num(firstTaxLine?.TaxLineDetail?.TaxPercent);
  return { taxAmount, taxRate };
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

/** OPS invoices.status ∈ paid/partially_paid/past_due/awaiting_payment (derived subset). */
export function deriveInvoiceStatus(
  balance: number,
  total: number,
  dueDate: string | null,
  now: Date
): "paid" | "partially_paid" | "past_due" | "awaiting_payment" {
  if (balance <= 0) return "paid";
  if (balance < total) return "partially_paid";
  if (dueDate && new Date(`${dueDate}T00:00:00Z`).getTime() < now.getTime()) return "past_due";
  return "awaiting_payment";
}

function linkedEstimateId(raw: QbRecord): string | null {
  const linked = raw.LinkedTxn as Array<{ TxnId?: string; TxnType?: string }> | undefined;
  if (!Array.isArray(linked)) return null;
  const est = linked.find((l) => l.TxnType === "Estimate");
  return est?.TxnId ? String(est.TxnId) : null;
}

export function normalizeInvoice(raw: QbRecord, now: Date): NormalizedInvoice {
  const total = num(raw.TotalAmt) ?? 0;
  const balance = num(raw.Balance) ?? 0;
  const isVoid = String((raw as { PrivateNote?: string }).PrivateNote ?? "").toLowerCase().includes("voided")
    || raw.Voided === true;
  const skipped = total <= 0 || isVoid;
  const { taxAmount, taxRate } = taxFromTxnDetail(raw);
  const dueDate = str(raw.DueDate);
  const qbId = String(raw.Id);

  const staging: StagedInvoiceRow = {
    qb_id: qbId,
    doc_number: str(raw.DocNumber),
    customer_qb_id: str((raw.CustomerRef as { value?: string } | undefined)?.value),
    estimate_qb_id: linkedEstimateId(raw),
    txn_date: str(raw.TxnDate),
    due_date: dueDate,
    subtotal: subtotalFromLines(raw.Line),
    tax_amount: taxAmount,
    tax_rate: taxRate,
    total,
    balance,
    derived_status: skipped ? "skipped" : deriveInvoiceStatus(balance, total, dueDate, now),
    raw,
  };

  const lines = skipped ? [] : attachParent(flattenSalesLines(raw.Line), "invoice", qbId);
  return {
    staging,
    lines,
    skipped,
    skipReason: skipped ? (isVoid ? "voided" : "zero_total") : null,
  };
}

// ─── Estimate ───────────────────────────────────────────────────────────────

/** OPS estimates.status mapping from QB TxnStatus. */
export function mapEstimateStatus(
  txnStatus: string | null | undefined,
  expirationDate: string | null,
  now: Date
): "sent" | "approved" | "converted" | "declined" | "expired" {
  switch (txnStatus) {
    case "Accepted":
      return "approved";
    case "Closed":
      return "converted";
    case "Rejected":
      return "declined";
    case "Pending":
    default:
      if (expirationDate && new Date(`${expirationDate}T00:00:00Z`).getTime() < now.getTime()) {
        return "expired";
      }
      return "sent";
  }
}

export function normalizeEstimate(raw: QbRecord, now: Date): NormalizedEstimate {
  const { taxAmount, taxRate } = taxFromTxnDetail(raw);
  const expiration = str(raw.ExpirationDate);
  const qbId = String(raw.Id);
  const staging: StagedEstimateRow = {
    qb_id: qbId,
    doc_number: str(raw.DocNumber),
    customer_qb_id: str((raw.CustomerRef as { value?: string } | undefined)?.value),
    txn_date: str(raw.TxnDate),
    expiration_date: expiration,
    txn_status: mapEstimateStatus(str(raw.TxnStatus), expiration, now),
    subtotal: subtotalFromLines(raw.Line),
    tax_amount: taxAmount,
    tax_rate: taxRate,
    total: num(raw.TotalAmt),
    raw,
  };
  return { staging, lines: attachParent(flattenSalesLines(raw.Line), "estimate", qbId) };
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export function splitPaymentLines(raw: QbRecord): SplitPayment {
  const lineArr = Array.isArray(raw.Line) ? (raw.Line as QbRecord[]) : [];
  const topRef = str((raw as { PaymentRefNum?: string }).PaymentRefNum);
  const applied: PaymentAppliedLine[] = [];
  for (const line of lineArr) {
    const linked = line.LinkedTxn as Array<{ TxnId?: string; TxnType?: string }> | undefined;
    if (!Array.isArray(linked)) continue;
    for (const txn of linked) {
      if (txn.TxnType !== "Invoice" || !txn.TxnId) continue;
      const lineEx = (line.LineEx as { any?: Array<{ name?: string; value?: string }> } | undefined)?.any;
      const lineRef = lineEx?.find((e) => e.name === "txnReferenceNumber")?.value ?? null;
      applied.push({
        invoice_qb_id: String(txn.TxnId),
        amount: cents(num(line.Amount) ?? 0),
        reference_number: lineRef ?? topRef,
      });
    }
  }
  return {
    qb_id: String(raw.Id),
    customer_qb_id: str((raw.CustomerRef as { value?: string } | undefined)?.value),
    txn_date: str(raw.TxnDate),
    total_amt: num(raw.TotalAmt),
    unappliedAmt: num(raw.UnappliedAmt),
    payment_method: str((raw.PaymentMethodRef as { name?: string } | undefined)?.name),
    applied,
  };
}
```

- [ ] **Step 2: Run the helper test (expect PASS).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/qbo-normalize.test.ts
```
Expect: PASS — all describe blocks green. (The invoice `derived_status` assertion expects `past_due` only if DueDate < TODAY; in the fixture DueDate `2026-05-01` > TODAY `2026-04-20`, so adjust the test expectation to `awaiting_payment` if it was written as `past_due` — keep test and impl consistent before declaring PASS.)

- [ ] **Step 3: Reconcile the one ambiguous assertion.** In `qbo-normalize.test.ts`, the open-invoice status assertion must equal `awaiting_payment` (full balance, due date in the future relative to TODAY). Edit:
```typescript
    expect(open.staging.derived_status).toBe("awaiting_payment");
```
Re-run Step 2; expect PASS.

- [ ] **Step 4: Type-check.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx tsc --noEmit
```
Expect: PASS.

- [ ] **Step 5: Commit.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/qbo-normalize.ts src/lib/api/services/__tests__/qbo-normalize.test.ts && git commit -m "feat(qbo-import): pure QB-JSON normalization helpers (lines, tax, payment split)"
```

---

### Task A2.4: Fuzzy-match RPC migration (`qbo_match_customer_candidates`)

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/supabase/migrations/20260602100000_qbo_match_customer_candidates_rpc.sql`

> A0 enables `pg_trgm`. A2 owns the customer-match read function so `computeCustomerMatches` can run trigram similarity in Postgres (TS cannot reproduce `similarity()` exactly). SECURITY DEFINER + read-only; service-role calls it. (Contract deviation noted — new RPC name only; no table/column changes.)

- [ ] **Step 1: Write the migration.** Create `supabase/migrations/20260602100000_qbo_match_customer_candidates_rpc.sql`:
```sql
-- QuickBooks import: customer fuzzy-match candidate finder.
-- Read-only. Returns existing non-deleted clients for a company ranked by
-- pg_trgm name similarity to a normalized QB DisplayName, above a threshold.
-- Used by computeCustomerMatches for the name_fuzzy step. pg_trgm is enabled
-- in migration A0.

create or replace function public.qbo_match_customer_candidates(
  p_company_id uuid,
  p_name text,
  p_threshold numeric default 0.6
)
returns table (
  client_id uuid,
  name text,
  email text,
  phone_number text,
  similarity numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id as client_id,
    c.name,
    c.email,
    c.phone_number,
    round(similarity(lower(c.name), lower(p_name))::numeric, 4) as similarity
  from clients c
  where c.company_id = p_company_id
    and c.deleted_at is null
    and c.merged_into_client_id is null
    and similarity(lower(c.name), lower(p_name)) >= p_threshold
  order by similarity(lower(c.name), lower(p_name)) desc
  limit 10;
$$;

revoke all on function public.qbo_match_customer_candidates(uuid, text, numeric) from public;
grant execute on function public.qbo_match_customer_candidates(uuid, text, numeric) to service_role;

comment on function public.qbo_match_customer_candidates(uuid, text, numeric) is
  'QBO import: read-only pg_trgm fuzzy match of QB customer name to existing clients (threshold default 0.6).';
```

- [ ] **Step 2: Apply the migration to ops-app (via Supabase MCP `apply_migration`).** Name: `qbo_match_customer_candidates_rpc`. Then verify the function exists:
```
echo "verify in Supabase: select proname from pg_proc where proname = 'qbo_match_customer_candidates';"
```
Expect: one row. (Apply through the Supabase MCP tool against project `ijeekuhbatykdomumfjx`, not psql.)

- [ ] **Step 3: Commit the migration file.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add supabase/migrations/20260602100000_qbo_match_customer_candidates_rpc.sql && git commit -m "feat(qbo-import): pg_trgm customer fuzzy-match RPC"
```

---

### Task A2.5: `computeCustomerMatches` logic — failing test

**Files:**
- Create (test): `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/__tests__/qbo-match.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/qbo-match.ts`

> The match decision (email → name_exact → fuzzy → create) is factored into a pure resolver `resolveCustomerMatch` so it is testable without DB. `quickbooks-import-service.computeCustomerMatches` (Task A2.7) fetches candidate data, calls this resolver, and persists rows.

- [ ] **Step 1: Write the failing resolver test.** Create `src/lib/api/services/__tests__/qbo-match.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { resolveCustomerMatch, type ExistingClient } from "../qbo-match";

const clients: ExistingClient[] = [
  { id: "c-email", name: "Acme Holdings Ltd", email: "AP@acme.com", phone_number: null },
  { id: "c-name1", name: "Bright Spark Electric", email: null, phone_number: null },
  { id: "c-name2a", name: "Northside Plumbing", email: null, phone_number: null },
  { id: "c-name2b", name: "Northside Plumbing Inc", email: null, phone_number: null },
];

describe("resolveCustomerMatch", () => {
  it("email exact (case-insensitive, trimmed) → link / high", () => {
    const r = resolveCustomerMatch(
      { qb_id: "1", display_name: "Acme", email: "  ap@acme.com ", phone: null },
      clients,
      [] // no fuzzy candidates needed
    );
    expect(r.proposed_action).toBe("link");
    expect(r.matched_client_id).toBe("c-email");
    expect(r.match_basis).toBe("email");
    expect(r.confidence).toBe("high");
  });

  it("normalized-name exact single → link / medium", () => {
    const r = resolveCustomerMatch(
      { qb_id: "2", display_name: "Bright Spark Electric", email: null, phone: null },
      clients,
      []
    );
    expect(r.proposed_action).toBe("link");
    expect(r.matched_client_id).toBe("c-name1");
    expect(r.match_basis).toBe("name_exact");
    expect(r.confidence).toBe("medium");
  });

  it("normalized-name exact with >1 match → needs_review with candidates", () => {
    // "Northside Plumbing" and "Northside Plumbing Inc" normalize to the same key
    const r = resolveCustomerMatch(
      { qb_id: "3", display_name: "Northside Plumbing", email: null, phone: null },
      clients,
      []
    );
    expect(r.proposed_action).toBe("needs_review");
    expect(r.match_basis).toBe("name_exact");
    expect(r.confidence).toBe("medium");
    expect(r.candidates.map((c) => c.client_id).sort()).toEqual(["c-name2a", "c-name2b"]);
  });

  it("fuzzy candidate present (no exact) → link / low / name_fuzzy", () => {
    const r = resolveCustomerMatch(
      { qb_id: "4", display_name: "Brite Sparks Electrical", email: null, phone: null },
      [], // no exact-name pool so it falls to fuzzy
      [{ client_id: "c-fuzzy", name: "Bright Spark Electric", email: null, phone_number: null, similarity: 0.72 }]
    );
    expect(r.proposed_action).toBe("link");
    expect(r.match_basis).toBe("name_fuzzy");
    expect(r.confidence).toBe("low");
    expect(r.matched_client_id).toBe("c-fuzzy");
  });

  it("no match anywhere → create / none", () => {
    const r = resolveCustomerMatch(
      { qb_id: "5", display_name: "Totally New Customer", email: "new@x.com", phone: null },
      clients,
      []
    );
    expect(r.proposed_action).toBe("create");
    expect(r.match_basis).toBe("none");
    expect(r.matched_client_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run it (expect FAIL — module missing).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/qbo-match.test.ts
```
Expect: FAIL — `Cannot find module '../qbo-match'`.

- [ ] **Step 3: Implement the resolver.** Create `src/lib/api/services/qbo-match.ts`:
```typescript
/**
 * OPS Web - QuickBooks customer match resolver (pure).
 *
 * Decision order (spec §7):
 *   1. email exact (case-insensitive, trimmed)      → link, high
 *   2. normalized-name exact (single)               → link, medium
 *      normalized-name exact (>1)                   → needs_review, medium
 *   3. pg_trgm fuzzy candidate (≥0.6, supplied by RPC) → link, low
 *   4. else                                          → create, none
 *
 * Nothing is written to clients here — this only proposes.
 */

import { normalizeCompanyName } from "@/lib/utils/name-normalization";
import type { MatchAction } from "@/lib/types/qbo-import";

export interface ExistingClient {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
}

/** A fuzzy candidate row as returned by qbo_match_customer_candidates. */
export interface FuzzyCandidate {
  client_id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  similarity: number;
}

/** Staged-customer subset the resolver needs. */
export interface CustomerMatchInput {
  qb_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface CandidateView {
  client_id: string;
  name: string;
  email: string | null;
  basis: "email" | "name_exact" | "name_fuzzy";
  similarity: number | null;
}

export interface CustomerMatchResult {
  customer_qb_id: string;
  proposed_action: MatchAction;
  matched_client_id: string | null;
  match_basis: "email" | "name_exact" | "name_fuzzy" | "none";
  confidence: "high" | "medium" | "low" | null;
  candidates: CandidateView[];
}

function normEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

export function resolveCustomerMatch(
  staged: CustomerMatchInput,
  existing: ExistingClient[],
  fuzzy: FuzzyCandidate[]
): CustomerMatchResult {
  const qbId = staged.qb_id;

  // 1. Email exact ─────────────────────────────────────────────────────────
  const stagedEmail = normEmail(staged.email);
  if (stagedEmail) {
    const emailHits = existing.filter((c) => normEmail(c.email) === stagedEmail);
    if (emailHits.length >= 1) {
      const hit = emailHits[0];
      return {
        customer_qb_id: qbId,
        proposed_action: "link",
        matched_client_id: hit.id,
        match_basis: "email",
        confidence: "high",
        candidates: emailHits.map((c) => ({
          client_id: c.id, name: c.name, email: c.email, basis: "email", similarity: null,
        })),
      };
    }
  }

  // 2. Normalized-name exact ─────────────────────────────────────────────────
  const stagedName = staged.display_name ? normalizeCompanyName(staged.display_name) : "";
  if (stagedName.length > 0) {
    const nameHits = existing.filter((c) => normalizeCompanyName(c.name) === stagedName);
    if (nameHits.length === 1) {
      return {
        customer_qb_id: qbId,
        proposed_action: "link",
        matched_client_id: nameHits[0].id,
        match_basis: "name_exact",
        confidence: "medium",
        candidates: nameHits.map((c) => ({
          client_id: c.id, name: c.name, email: c.email, basis: "name_exact", similarity: null,
        })),
      };
    }
    if (nameHits.length > 1) {
      return {
        customer_qb_id: qbId,
        proposed_action: "needs_review",
        matched_client_id: null,
        match_basis: "name_exact",
        confidence: "medium",
        candidates: nameHits.map((c) => ({
          client_id: c.id, name: c.name, email: c.email, basis: "name_exact", similarity: null,
        })),
      };
    }
  }

  // 3. Fuzzy (pg_trgm ≥ 0.6, supplied by RPC) ───────────────────────────────
  if (fuzzy.length > 0) {
    const best = [...fuzzy].sort((a, b) => b.similarity - a.similarity)[0];
    return {
      customer_qb_id: qbId,
      proposed_action: "link",
      matched_client_id: best.client_id,
      match_basis: "name_fuzzy",
      confidence: "low",
      candidates: fuzzy.map((c) => ({
        client_id: c.client_id, name: c.name, email: c.email, basis: "name_fuzzy", similarity: c.similarity,
      })),
    };
  }

  // 4. No match → create ─────────────────────────────────────────────────────
  return {
    customer_qb_id: qbId,
    proposed_action: "create",
    matched_client_id: null,
    match_basis: "none",
    confidence: null,
    candidates: [],
  };
}
```

- [ ] **Step 4: Run the resolver test (expect PASS).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/qbo-match.test.ts
```
Expect: PASS. (`normalizeCompanyName` strips "Inc"/"Ltd" so "Northside Plumbing" and "Northside Plumbing Inc" collide → needs_review, exactly as asserted.)

- [ ] **Step 5: Commit.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/qbo-match.ts src/lib/api/services/__tests__/qbo-match.test.ts && git commit -m "feat(qbo-import): pure customer match resolver (email/name/fuzzy/create)"
```

---

### Task A2.6: Reconciliation aggregation — failing test

**Files:**
- Create (test): `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/__tests__/qbo-reconcile.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/qbo-reconcile.ts`

> The reconciliation/count math for `getImportReview` is pure given the staged rows + matches, so it is factored out and tested independently of Supabase.

- [ ] **Step 1: Write the failing test.** Create `src/lib/api/services/__tests__/qbo-reconcile.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildReconciliation, buildMatchCounts, buildStagedCounts } from "../qbo-reconcile";
import type { QboStagedInvoice, QboStagedPayment, QboCustomerMatch } from "@/lib/types/qbo-import";

const invoices = [
  { qb_id: "130", balance: 362.07, total: 362.07, derived_status: "awaiting_payment" },
  { qb_id: "140", balance: 0, total: 100, derived_status: "paid" },
  { qb_id: "150", balance: 0, total: 0, derived_status: "skipped" }, // skipped (zero total)
] as unknown as QboStagedInvoice[];

const payments = [
  { qb_id: "200", applied_lines: [{ invoice_qb_id: "130", amount: 200 }, { invoice_qb_id: "140", amount: 100 }] },
  { qb_id: "201", applied_lines: [] }, // orphan deposit
] as unknown as QboStagedPayment[];

const matches = [
  { proposed_action: "link" },
  { proposed_action: "create" },
  { proposed_action: "needs_review" },
  { proposed_action: "skip" },
] as unknown as QboCustomerMatch[];

describe("buildMatchCounts", () => {
  it("tallies per action", () => {
    expect(buildMatchCounts(matches)).toEqual({ link: 1, create: 1, skip: 1, needs_review: 1 });
  });
});

describe("buildReconciliation", () => {
  it("open A/R sums non-skipped positive balances; collected sums applied lines", () => {
    const r = buildReconciliation(invoices, payments, 5);
    expect(r.qbOpenAr).toBe(362.07);
    expect(r.opsToBeOpenAr).toBe(362.07);
    expect(r.openInvoiceCount).toBe(1);
    expect(r.collectedInWindow).toBe(300);
    expect(r.customerCount).toBe(5);
    expect(r.arMatched).toBe(true);
  });
});

describe("buildStagedCounts", () => {
  it("counts entities, orphan payments, and skipped invoices", () => {
    const c = buildStagedCounts({
      customers: 5, estimates: 2, invoices, lineItems: 7, payments,
    });
    expect(c.invoices).toBe(3);
    expect(c.skippedInvoices).toBe(1);
    expect(c.orphanPayments).toBe(1);
    expect(c.lineItems).toBe(7);
  });
});
```

- [ ] **Step 2: Run it (expect FAIL — module missing).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/qbo-reconcile.test.ts
```
Expect: FAIL — `Cannot find module '../qbo-reconcile'`.

- [ ] **Step 3: Implement.** Create `src/lib/api/services/qbo-reconcile.ts`:
```typescript
/**
 * OPS Web - QuickBooks import reconciliation aggregation (pure).
 *
 * Computes the QboImportReview counts + QB-vs-OPS reconciliation strip from
 * staged rows + matches. CanPro has 0 live invoices pre-apply, so OPS-to-be
 * mirrors the QB-authoritative staged values (arMatched is always true here;
 * the strip exists to catch regressions once re-imports run against live data).
 */

import type {
  QboStagedInvoice,
  QboStagedPayment,
  QboCustomerMatch,
  QboMatchCounts,
  QboStagedCounts,
  QboReconciliation,
} from "@/lib/types/qbo-import";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function buildMatchCounts(matches: QboCustomerMatch[]): QboMatchCounts {
  const counts: QboMatchCounts = { link: 0, create: 0, skip: 0, needs_review: 0 };
  for (const m of matches) {
    const action = m.proposed_action;
    if (action === "link") counts.link += 1;
    else if (action === "create") counts.create += 1;
    else if (action === "skip") counts.skip += 1;
    else if (action === "needs_review") counts.needs_review += 1;
  }
  return counts;
}

export function buildReconciliation(
  invoices: QboStagedInvoice[],
  payments: QboStagedPayment[],
  customerCount: number
): QboReconciliation {
  const live = invoices.filter((i) => i.derived_status !== "skipped");
  const openInvoices = live.filter((i) => Number(i.balance ?? 0) > 0);
  const qbOpenAr = round2(openInvoices.reduce((sum, i) => sum + Number(i.balance ?? 0), 0));
  const collectedInWindow = round2(
    payments.reduce((sum, p) => {
      const lines = Array.isArray(p.applied_lines) ? p.applied_lines : [];
      return sum + lines.reduce((s, l) => s + Number((l as { amount?: number }).amount ?? 0), 0);
    }, 0)
  );
  const opsToBeOpenAr = qbOpenAr; // QB authoritative; apply reconciles OPS to this
  return {
    qbOpenAr,
    opsToBeOpenAr,
    openInvoiceCount: openInvoices.length,
    collectedInWindow,
    customerCount,
    arMatched: round2(qbOpenAr) === round2(opsToBeOpenAr),
  };
}

export function buildStagedCounts(args: {
  customers: number;
  estimates: number;
  invoices: QboStagedInvoice[];
  lineItems: number;
  payments: QboStagedPayment[];
}): QboStagedCounts {
  const skippedInvoices = args.invoices.filter((i) => i.derived_status === "skipped").length;
  const orphanPayments = args.payments.filter(
    (p) => !Array.isArray(p.applied_lines) || p.applied_lines.length === 0
  ).length;
  return {
    customers: args.customers,
    estimates: args.estimates,
    invoices: args.invoices.length,
    lineItems: args.lineItems,
    payments: args.payments.length,
    orphanPayments,
    skippedInvoices,
  };
}
```

- [ ] **Step 4: Run the reconcile test (expect PASS).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/qbo-reconcile.test.ts
```
Expect: PASS.

- [ ] **Step 5: Commit.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/qbo-reconcile.ts src/lib/api/services/__tests__/qbo-reconcile.test.ts && git commit -m "feat(qbo-import): reconciliation + count aggregation helpers"
```

---

### Task A2.7: `quickbooks-import-service.ts` — orchestration (startImportRun / pullAndStage / computeCustomerMatches / getImportReview) — failing test

**Files:**
- Create (test): `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/__tests__/quickbooks-import-service.test.ts`
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/quickbooks-import-service.ts`

- [ ] **Step 1: Write the failing service test** with a stubbed Supabase client + mocked `QuickBooksPullService` and `AccountingTokenService`. Create `src/lib/api/services/__tests__/quickbooks-import-service.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import customers from "../../../../../tests/fixtures/qbo/customer.json";
import invoices from "../../../../../tests/fixtures/qbo/invoice.json";
import estimates from "../../../../../tests/fixtures/qbo/estimate.json";
import payments from "../../../../../tests/fixtures/qbo/payment.json";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const RUN_ID = "run-1";

// ── Mock the pull service (A1) so no network happens ───────────────────────
const pullInstance = {
  pullCustomers: vi.fn().mockResolvedValue(customers),
  pullInvoices: vi.fn().mockResolvedValue(invoices),
  pullEstimates: vi.fn().mockResolvedValue(estimates),
  pullPayments: vi.fn().mockResolvedValue(payments),
  pullItems: vi.fn().mockResolvedValue([]),
  qbWriteCalls: 0,
};
vi.mock("../quickbooks-pull-service", () => ({
  QuickBooksPullService: vi.fn().mockImplementation(() => pullInstance),
}));

vi.mock("../accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken: vi.fn().mockResolvedValue({ accessToken: "tok", realmId: "realm-1" }),
  },
}));

// ── In-memory Supabase fake ────────────────────────────────────────────────
type Row = Record<string, unknown>;
function makeSupabase() {
  const tables: Record<string, Row[]> = {
    accounting_connections: [
      { id: "conn-1", company_id: COMPANY_ID, provider: "quickbooks", realm_id: "realm-1", is_connected: true },
    ],
    qbo_import_runs: [],
    qbo_staging_customers: [],
    qbo_staging_invoices: [],
    qbo_staging_estimates: [],
    qbo_staging_line_items: [],
    qbo_staging_payments: [],
    qbo_customer_matches: [],
    clients: [
      { id: "client-cool", company_id: COMPANY_ID, name: "Cool Cars", email: "cool_cars@intuit.com",
        phone_number: null, deleted_at: null, merged_into_client_id: null },
    ],
  };

  function from(table: string) {
    let rows = tables[table] ?? (tables[table] = []);
    const filters: Array<(r: Row) => boolean> = [];
    const api: Record<string, unknown> = {
      insert: (payload: Row | Row[]) => {
        const items = Array.isArray(payload) ? payload : [payload];
        for (const it of items) {
          tables[table].push({ id: it.id ?? `${table}-${tables[table].length + 1}`, ...it });
        }
        const inserted = items.map((it, i) => tables[table][tables[table].length - items.length + i]);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: inserted[0], error: null }),
          }),
          then: (res: (v: { data: null; error: null }) => void) => res({ data: null, error: null }),
        };
      },
      upsert: (payload: Row | Row[]) => {
        const items = Array.isArray(payload) ? payload : [payload];
        tables[table].push(...items);
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: Row) => ({
        eq: (col: string, val: unknown) => {
          for (const r of tables[table]) if (r[col] === val) Object.assign(r, patch);
          return Promise.resolve({ data: null, error: null });
        },
      }),
      select: () => api,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return api; },
      single: () => {
        const r = rows.filter((row) => filters.every((f) => f(row)))[0] ?? null;
        return Promise.resolve({ data: r, error: r ? null : { message: "not found" } });
      },
      maybeSingle: () => {
        const r = rows.filter((row) => filters.every((f) => f(row)))[0] ?? null;
        return Promise.resolve({ data: r, error: null });
      },
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows.filter((row) => filters.every((f) => f(row))), error: null }),
    };
    return api;
  }

  function rpc(_fn: string, _args: Row) {
    // No fuzzy candidates by default in this fixture set.
    return Promise.resolve({ data: [], error: null });
  }

  return { from, rpc, _tables: tables } as unknown as import("@supabase/supabase-js").SupabaseClient & { _tables: Record<string, Row[]> };
}

import { QuickBooksImportService } from "../quickbooks-import-service";

let supabase: ReturnType<typeof makeSupabase>;

beforeEach(() => {
  vi.clearAllMocks();
  pullInstance.qbWriteCalls = 0;
  supabase = makeSupabase();
});

describe("QuickBooksImportService.startImportRun", () => {
  it("creates a pending run scoped to the company", async () => {
    const run = await QuickBooksImportService.startImportRun(supabase, COMPANY_ID);
    expect(run.status).toBe("pending");
    expect(supabase._tables.qbo_import_runs).toHaveLength(1);
    expect(supabase._tables.qbo_import_runs[0].company_id).toBe(COMPANY_ID);
  });
});

describe("QuickBooksImportService.pullAndStage", () => {
  it("stages customers/invoices/estimates/lines/payments and keeps qb_write_calls at 0", async () => {
    const run = await QuickBooksImportService.startImportRun(supabase, COMPANY_ID);
    await QuickBooksImportService.pullAndStage(supabase, run.id);

    const t = supabase._tables;
    expect(t.qbo_staging_customers.length).toBe(2);
    expect(t.qbo_staging_invoices.length).toBe(2); // includes the zero-total (flagged) row
    expect(t.qbo_staging_estimates.length).toBe(1);
    // invoice 130 → 2 sales lines; estimate 98 → 1 flattened line; zero-total invoice → 0 lines
    expect(t.qbo_staging_line_items.length).toBe(3);
    // payment 200 splits to 2 invoice lines
    expect(t.qbo_staging_payments.length).toBe(2);
    const finished = t.qbo_import_runs[0];
    expect(finished.status).toBe("staged");
    expect(finished.qb_write_calls).toBe(0);
  });
});

describe("QuickBooksImportService.computeCustomerMatches", () => {
  it("writes one match row per staged customer (email link for Cool Cars)", async () => {
    const run = await QuickBooksImportService.startImportRun(supabase, COMPANY_ID);
    await QuickBooksImportService.pullAndStage(supabase, run.id);
    await QuickBooksImportService.computeCustomerMatches(supabase, run.id);

    const matches = supabase._tables.qbo_customer_matches;
    expect(matches.length).toBe(2);
    const cool = matches.find((m) => m.customer_qb_id === "58");
    expect(cool?.proposed_action).toBe("link");
    expect(cool?.match_basis).toBe("email");
    expect(cool?.matched_client_id).toBe("client-cool");
    const diego = matches.find((m) => m.customer_qb_id === "12");
    expect(diego?.proposed_action).toBe("create");
  });
});

describe("QuickBooksImportService.getImportReview", () => {
  it("returns the aggregate with reconciliation + counts", async () => {
    const run = await QuickBooksImportService.startImportRun(supabase, COMPANY_ID);
    await QuickBooksImportService.pullAndStage(supabase, run.id);
    await QuickBooksImportService.computeCustomerMatches(supabase, run.id);

    const review = await QuickBooksImportService.getImportReview(supabase, run.id);
    expect(review.run.id).toBe(run.id);
    expect(review.matches.length).toBe(2);
    expect(review.matchCounts.link).toBe(1);
    expect(review.matchCounts.create).toBe(1);
    expect(review.stagedCounts.invoices).toBe(2);
    expect(review.stagedCounts.skippedInvoices).toBe(1);
    expect(review.reconciliation.qbOpenAr).toBe(362.07);
    expect(review.reconciliation.openInvoiceCount).toBe(1);
    expect(review.reconciliation.collectedInWindow).toBe(362.07);
    expect(review.reconciliation.arMatched).toBe(true);
  });
});

describe("applyImport (A3 boundary)", () => {
  it("throws — implemented in phase A3", async () => {
    await expect(
      QuickBooksImportService.applyImport(supabase, RUN_ID, [])
    ).rejects.toThrow(/A3/);
  });
});
```

- [ ] **Step 2: Run it (expect FAIL — module missing).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/quickbooks-import-service.test.ts
```
Expect: FAIL — `Cannot find module '../quickbooks-import-service'`.

- [ ] **Step 3: Implement the service.** Create `src/lib/api/services/quickbooks-import-service.ts`:
```typescript
/**
 * OPS Web - QuickBooks Import Service (read-only pull → stage → match → review)
 *
 * Drives the A1 read-only pull, normalizes QB JSON into the qbo_staging_* tables
 * (qbo-normalize), proposes customer matches (qbo-match + pg_trgm RPC), and
 * builds the QboImportReview aggregate (qbo-reconcile). applyImport is A3.
 *
 * READ-ONLY: the only QB calls go through QuickBooksPullService (GET only); the
 * run records qb_write_calls and asserts it stays 0.
 *
 * Mirrors sync-orchestrator's service-role + AccountingTokenService usage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountingTokenService } from "./accounting-token-service";
import { QuickBooksPullService } from "./quickbooks-pull-service";
import {
  normalizeCustomer,
  normalizeInvoice,
  normalizeEstimate,
  splitPaymentLines,
} from "./qbo-normalize";
import {
  resolveCustomerMatch,
  type ExistingClient,
  type FuzzyCandidate,
} from "./qbo-match";
import {
  buildReconciliation,
  buildMatchCounts,
  buildStagedCounts,
} from "./qbo-reconcile";
import type {
  QboImportRun,
  QboImportReview,
  QboStagedInvoice,
  QboStagedPayment,
  QboCustomerMatch,
  QboStagedCustomer,
} from "@/lib/types/qbo-import";

const QB_ENVIRONMENT = (process.env.QB_ENVIRONMENT as "production" | "sandbox") ?? "production";
const FUZZY_THRESHOLD = 0.6;
const HISTORY_MONTHS = 24;

// ─── Run-row mapping ────────────────────────────────────────────────────────

function mapRun(row: Record<string, unknown>): QboImportRun {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    provider: row.provider as string,
    status: row.status as QboImportRun["status"],
    historyCutoff: (row.history_cutoff as string) ?? null,
    qbWriteCalls: (row.qb_write_calls as number) ?? 0,
    totals: (row.totals as Record<string, unknown>) ?? {},
    error: (row.error as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: (row.created_at as string) ?? null,
    finishedAt: (row.finished_at as string) ?? null,
  };
}

function cutoffISODate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - HISTORY_MONTHS);
  return d.toISOString().slice(0, 10);
}

async function getRun(supabase: SupabaseClient, runId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("qbo_import_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (error || !data) throw new Error(`Import run not found: ${runId}`);
  return data as Record<string, unknown>;
}

async function setRun(
  supabase: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await supabase.from("qbo_import_runs").update(patch).eq("id", runId);
}

export const QuickBooksImportService = {
  /** Create a pending run for the company. */
  async startImportRun(supabase: SupabaseClient, companyId: string): Promise<QboImportRun> {
    const { data, error } = await supabase
      .from("qbo_import_runs")
      .insert({
        company_id: companyId,
        provider: "quickbooks",
        status: "pending",
        history_cutoff: cutoffISODate(),
        qb_write_calls: 0,
        totals: {},
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`Failed to start import run: ${error?.message}`);
    return mapRun(data as Record<string, unknown>);
  },

  /**
   * Pull from QB (GET only) and normalize into qbo_staging_*.
   * Idempotent on (run_id, qb_id) — staging UNIQUE constraints absorb retries
   * via upsert. Leaves the run in 'staged' (or 'error').
   */
  async pullAndStage(supabase: SupabaseClient, runId: string): Promise<void> {
    const runRow = await getRun(supabase, runId);
    const companyId = runRow.company_id as string;
    const cutoff = (runRow.history_cutoff as string) ?? cutoffISODate();

    // Resolve the connection + a valid token (refreshes if needed).
    const { data: conn, error: connErr } = await supabase
      .from("accounting_connections")
      .select("id, realm_id")
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .single();
    if (connErr || !conn) throw new Error(`No QuickBooks connection for company ${companyId}`);

    await setRun(supabase, runId, { status: "pulling" });

    try {
      const { accessToken, realmId } = await AccountingTokenService.getValidToken(
        supabase,
        conn.id as string
      );
      if (!realmId) throw new Error("QuickBooks realmId not found on connection");

      const pull = new QuickBooksPullService(realmId, accessToken, QB_ENVIRONMENT);
      const now = new Date();

      const [rawCustomers, rawInvoices, rawEstimates, rawPayments] = await Promise.all([
        pull.pullCustomers(),
        pull.pullInvoices(cutoff),
        pull.pullEstimates(cutoff),
        pull.pullPayments(cutoff),
      ]);

      // ── Customers ──────────────────────────────────────────────────────
      const customerRows = rawCustomers.map((c) => {
        const n = normalizeCustomer(c);
        return {
          run_id: runId,
          company_id: companyId,
          qb_id: n.qb_id,
          display_name: n.display_name,
          email: n.email,
          phone: n.phone,
          address: n.address,
          active: n.active,
          raw: n.raw,
        };
      });
      if (customerRows.length) {
        await supabase
          .from("qbo_staging_customers")
          .upsert(customerRows, { onConflict: "run_id,qb_id" });
      }

      // ── Estimates (+ their lines) ──────────────────────────────────────
      const estimateRows: Record<string, unknown>[] = [];
      const lineRows: Record<string, unknown>[] = [];
      for (const e of rawEstimates) {
        const norm = normalizeEstimate(e, now);
        estimateRows.push({
          run_id: runId,
          company_id: companyId,
          qb_id: norm.staging.qb_id,
          doc_number: norm.staging.doc_number,
          customer_qb_id: norm.staging.customer_qb_id,
          txn_date: norm.staging.txn_date,
          expiration_date: norm.staging.expiration_date,
          txn_status: norm.staging.txn_status,
          subtotal: norm.staging.subtotal,
          tax_amount: norm.staging.tax_amount,
          tax_rate: norm.staging.tax_rate,
          total: norm.staging.total,
          raw: norm.staging.raw,
        });
        for (const l of norm.lines) {
          lineRows.push({
            run_id: runId,
            company_id: companyId,
            parent_type: l.parent_type,
            parent_qb_id: l.parent_qb_id,
            qb_line_id: l.qb_line_id,
            name: l.name,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            amount: l.amount,
            is_taxable: l.is_taxable,
            qb_item_type: l.qb_item_type,
            sort_order: l.sort_order,
          });
        }
      }
      if (estimateRows.length) {
        await supabase
          .from("qbo_staging_estimates")
          .upsert(estimateRows, { onConflict: "run_id,qb_id" });
      }

      // ── Invoices (+ their lines; zero-total/void are staged but flagged) ─
      const invoiceRows: Record<string, unknown>[] = [];
      let skippedInvoiceCount = 0;
      for (const inv of rawInvoices) {
        const norm = normalizeInvoice(inv, now);
        if (norm.skipped) skippedInvoiceCount += 1;
        invoiceRows.push({
          run_id: runId,
          company_id: companyId,
          qb_id: norm.staging.qb_id,
          doc_number: norm.staging.doc_number,
          customer_qb_id: norm.staging.customer_qb_id,
          estimate_qb_id: norm.staging.estimate_qb_id,
          txn_date: norm.staging.txn_date,
          due_date: norm.staging.due_date,
          subtotal: norm.staging.subtotal,
          tax_amount: norm.staging.tax_amount,
          tax_rate: norm.staging.tax_rate,
          total: norm.staging.total,
          balance: norm.staging.balance,
          derived_status: norm.staging.derived_status,
          raw: norm.staging.raw,
        });
        for (const l of norm.lines) {
          lineRows.push({
            run_id: runId,
            company_id: companyId,
            parent_type: l.parent_type,
            parent_qb_id: l.parent_qb_id,
            qb_line_id: l.qb_line_id,
            name: l.name,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            amount: l.amount,
            is_taxable: l.is_taxable,
            qb_item_type: l.qb_item_type,
            sort_order: l.sort_order,
          });
        }
      }
      if (invoiceRows.length) {
        await supabase
          .from("qbo_staging_invoices")
          .upsert(invoiceRows, { onConflict: "run_id,qb_id" });
      }
      if (lineRows.length) {
        // Line items have no UNIQUE on (run_id,qb_id); insert is fine because a
        // run is staged once. Re-running a run re-uses startImportRun → new run_id.
        await supabase.from("qbo_staging_line_items").insert(lineRows);
      }

      // ── Payments (one row per linked invoice line) ─────────────────────
      const paymentRows: Record<string, unknown>[] = [];
      for (const p of rawPayments) {
        const split = splitPaymentLines(p);
        paymentRows.push({
          run_id: runId,
          company_id: companyId,
          qb_id: split.qb_id,
          customer_qb_id: split.customer_qb_id,
          txn_date: split.txn_date,
          total_amt: split.total_amt,
          unapplied_amt: split.unappliedAmt,
          applied_lines: split.applied,
          raw: p,
        });
      }
      if (paymentRows.length) {
        await supabase
          .from("qbo_staging_payments")
          .upsert(paymentRows, { onConflict: "run_id,qb_id" });
      }

      // ── Read-only assertion: zero QB writes ────────────────────────────
      const qbWriteCalls = pull.qbWriteCalls ?? 0;
      if (qbWriteCalls !== 0) {
        throw new Error(`Read-only violation: QB write calls = ${qbWriteCalls}`);
      }

      await setRun(supabase, runId, {
        status: "staged",
        qb_write_calls: qbWriteCalls,
        totals: {
          customers: customerRows.length,
          estimates: estimateRows.length,
          invoices: invoiceRows.length,
          lineItems: lineRows.length,
          payments: paymentRows.length,
          skippedInvoices: skippedInvoiceCount,
        },
      });
    } catch (err) {
      await setRun(supabase, runId, { status: "error", error: (err as Error).message });
      throw err;
    }
  },

  /**
   * Compute proposed customer matches for every staged customer in the run and
   * persist them to qbo_customer_matches. Reads existing clients (email/name)
   * and uses the pg_trgm RPC for the fuzzy step. Writes nothing to `clients`.
   */
  async computeCustomerMatches(supabase: SupabaseClient, runId: string): Promise<void> {
    const runRow = await getRun(supabase, runId);
    const companyId = runRow.company_id as string;

    const { data: staged } = await supabase
      .from("qbo_staging_customers")
      .select("qb_id, display_name, email, phone")
      .eq("run_id", runId);

    const { data: existing } = await supabase
      .from("clients")
      .select("id, name, email, phone_number, deleted_at, merged_into_client_id")
      .eq("company_id", companyId);

    const activeClients: ExistingClient[] = (existing ?? [])
      .filter((c) => !c.deleted_at && !c.merged_into_client_id)
      .map((c) => ({
        id: c.id as string,
        name: c.name as string,
        email: (c.email as string) ?? null,
        phone_number: (c.phone_number as string) ?? null,
      }));

    const matchRows: Record<string, unknown>[] = [];
    for (const s of staged ?? []) {
      const displayName = (s.display_name as string) ?? null;
      const email = (s.email as string) ?? null;

      // Pre-check email/name so we only hit the fuzzy RPC when needed.
      const hasEmailHit =
        !!email &&
        activeClients.some((c) => (c.email ?? "").trim().toLowerCase() === email.trim().toLowerCase());
      let fuzzy: FuzzyCandidate[] = [];
      if (!hasEmailHit && displayName) {
        const { data: candidates } = await supabase.rpc("qbo_match_customer_candidates", {
          p_company_id: companyId,
          p_name: displayName,
          p_threshold: FUZZY_THRESHOLD,
        });
        fuzzy = ((candidates as FuzzyCandidate[]) ?? []).map((c) => ({
          client_id: c.client_id,
          name: c.name,
          email: c.email ?? null,
          phone_number: c.phone_number ?? null,
          similarity: Number(c.similarity),
        }));
      }

      const result = resolveCustomerMatch(
        { qb_id: s.qb_id as string, display_name: displayName, email, phone: (s.phone as string) ?? null },
        activeClients,
        fuzzy
      );

      matchRows.push({
        run_id: runId,
        company_id: companyId,
        customer_qb_id: result.customer_qb_id,
        proposed_action: result.proposed_action,
        matched_client_id: result.matched_client_id,
        match_basis: result.match_basis === "none" ? "none" : result.match_basis,
        confidence: result.confidence,
        candidates: result.candidates,
      });
    }

    if (matchRows.length) {
      await supabase
        .from("qbo_customer_matches")
        .upsert(matchRows, { onConflict: "run_id,customer_qb_id" });
    }
  },

  /** Build the QboImportReview aggregate (run + matches + counts + reconciliation). */
  async getImportReview(supabase: SupabaseClient, runId: string): Promise<QboImportReview> {
    const runRow = await getRun(supabase, runId);
    const run = mapRun(runRow);

    const [{ data: matchData }, { data: invoiceData }, { data: paymentData }, { data: estimateData }, { data: customerData }, { data: lineData }] =
      await Promise.all([
        supabase.from("qbo_customer_matches").select("*").eq("run_id", runId),
        supabase.from("qbo_staging_invoices").select("*").eq("run_id", runId),
        supabase.from("qbo_staging_payments").select("*").eq("run_id", runId),
        supabase.from("qbo_staging_estimates").select("qb_id").eq("run_id", runId),
        supabase.from("qbo_staging_customers").select("qb_id").eq("run_id", runId),
        supabase.from("qbo_staging_line_items").select("id").eq("run_id", runId),
      ]);

    const matches = (matchData ?? []) as unknown as QboCustomerMatch[];
    const invoices = (invoiceData ?? []) as unknown as QboStagedInvoice[];
    const payments = (paymentData ?? []) as unknown as QboStagedPayment[];
    const customerCount = (customerData ?? []).length;

    return {
      run,
      matches,
      matchCounts: buildMatchCounts(matches),
      stagedCounts: buildStagedCounts({
        customers: customerCount,
        estimates: (estimateData ?? []).length,
        invoices,
        lineItems: (lineData ?? []).length,
        payments,
      }),
      reconciliation: buildReconciliation(invoices, payments, customerCount),
    };
  },

  /** APPLY is implemented in phase A3. */
  async applyImport(
    _supabase: SupabaseClient,
    _runId: string,
    _decisions: { customer_qb_id: string; action: string; client_id?: string }[]
  ): Promise<{ applied: Record<string, number> }> {
    throw new Error("applyImport is implemented in phase A3");
  },
};

export type { QboStagedCustomer };
```

- [ ] **Step 4: Run the service test (expect PASS).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/quickbooks-import-service.test.ts
```
Expect: PASS — all describe blocks green, including `applyImport` rejecting with `/A3/`. If the in-memory fake's chaining surfaces a mismatch (e.g. `.select().single()` after insert), fix the fake to match the service's actual call chain, not the service — the production chain is the contract.

- [ ] **Step 5: Type-check the whole import surface.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx tsc --noEmit
```
Expect: PASS. (Depends on A1's `QuickBooksPullService` export and A0's `qbo-import` types. If either is unmerged, the failure is the upstream dependency; note and re-run after they land.)

- [ ] **Step 6: Commit.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/quickbooks-import-service.ts src/lib/api/services/__tests__/quickbooks-import-service.test.ts && git commit -m "feat(qbo-import): import service — startImportRun, pullAndStage, computeCustomerMatches, getImportReview"
```

---

### Task A2.8: Full-suite green + lint gate

**Files:**
- (verification only — no new files)

- [ ] **Step 1: Run the whole QBO import test set together.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/qbo-normalize.test.ts src/lib/api/services/__tests__/qbo-match.test.ts src/lib/api/services/__tests__/qbo-reconcile.test.ts src/lib/api/services/__tests__/quickbooks-import-service.test.ts
```
Expect: PASS — 4 files, all suites green.

- [ ] **Step 2: Lint the new files** (CI gates tests behind `next lint`; keep the new files clean).
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx next lint --file src/lib/api/services/qbo-normalize.ts --file src/lib/api/services/qbo-match.ts --file src/lib/api/services/qbo-reconcile.ts --file src/lib/api/services/quickbooks-import-service.ts
```
Expect: no errors on the new files. Fix any (unused imports, `any` usage) before proceeding — do not suppress with `eslint-disable` unless a rule genuinely does not apply.

- [ ] **Step 3: Final type-check.**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx tsc --noEmit
```
Expect: PASS.

- [ ] **Step 4: Commit any lint/type fixups (only if Step 2/3 required edits).**
```
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/qbo-normalize.ts src/lib/api/services/qbo-match.ts src/lib/api/services/qbo-reconcile.ts src/lib/api/services/quickbooks-import-service.ts && git commit -m "chore(qbo-import): lint and type cleanups for A2 services"
```


## Phase A3 — Apply engine (transactional, trigger-aware) + import routes + pull_only guards

## Phase A3 — Apply engine (transactional, trigger-aware) + import routes + pull_only safety guards

> **Depends on A0** (migration: `qbo_import_runs`, `qbo_staging_*`, `qbo_customer_matches`, `accounting_connections.sync_direction`), **A1** (`src/lib/types/qbo-import.ts` types + `quickbooks-import-service.ts` with `startImportRun` / `pullAndStage` / `getImportReview`), **A2** (`computeCustomerMatches`). A3 adds the `applyImport` method, wires the two import routes, and lands the three read-only safety guards.
>
> **Locked apply order (contract §8, do not reorder):** (1) clients link/create/skip → (2) estimate + invoice **headers** with QB-authoritative totals + `invoices.estimate_id` linkage → (3) `line_items` delete-by-parent then reinsert (`line_total` is GENERATED — never inserted) → (4) `payments` one row per linked invoice line (fires `trg_payment_balance`) → (5) **reconcile** `invoices.amount_paid`/`balance_due`/`status`/`paid_at` to QB `Balance` (MUST run AFTER payments so it overwrites the trigger's in-window-only computation). Idempotent on `(company_id, qb_id)`.

---

### Task A3.1: Add `MatchAction` / `QboApplyDecision` / `QboApplyResult` types to the QBO import type module

A1 created `src/lib/types/qbo-import.ts` with `QboImportRun`, `QboStagedCustomer/Invoice/Estimate/LineItem/Payment`, `QboCustomerMatch`, `QboImportReview`. A3 needs the apply-input decision shape and the apply-result counts shape. Confirm `MatchAction` exists (A1) and append the two apply types.

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/types/qbo-import.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/services/qbo-apply-types.test.ts` (Create)

Steps:

- [ ] **Step 1: Write a failing type-contract test.** This compiles the new types and asserts their shape at runtime via a sample object, so the suite fails until the types exist.

```ts
// tests/unit/services/qbo-apply-types.test.ts
import { describe, it, expect } from "vitest";
import type {
  MatchAction,
  QboApplyDecision,
  QboApplyResult,
} from "@/lib/types/qbo-import";

describe("QBO apply type contract", () => {
  it("MatchAction admits the four locked actions", () => {
    const actions: MatchAction[] = ["link", "create", "skip", "needs_review"];
    expect(actions).toHaveLength(4);
  });

  it("QboApplyDecision carries customer_qb_id + action + optional client_id", () => {
    const d: QboApplyDecision = {
      customer_qb_id: "QB-CUST-1",
      action: "link",
      client_id: "11111111-1111-1111-1111-111111111111",
    };
    expect(d.action).toBe("link");
    const created: QboApplyDecision = { customer_qb_id: "QB-CUST-2", action: "create" };
    expect(created.client_id).toBeUndefined();
  });

  it("QboApplyResult exposes per-entity applied counts + qb_write_calls=0", () => {
    const r: QboApplyResult = {
      clientsLinked: 1,
      clientsCreated: 2,
      clientsSkipped: 0,
      estimatesUpserted: 3,
      invoicesUpserted: 4,
      lineItemsInserted: 10,
      paymentsUpserted: 5,
      invoicesReconciled: 4,
      qb_write_calls: 0,
    };
    expect(r.qb_write_calls).toBe(0);
    expect(r.invoicesReconciled).toBe(r.invoicesUpserted);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL.** `QboApplyDecision` / `QboApplyResult` do not exist yet.

```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/services/qbo-apply-types.test.ts
```
Expected: FAIL — TS resolution error / `has no exported member 'QboApplyDecision'`.

- [ ] **Step 3: Append the apply types.** Add to the end of `src/lib/types/qbo-import.ts` (keep A1's `MatchAction` definition; if A1 did not export it, add it here exactly once):

```ts
// ─── A3: Apply engine input/output ──────────────────────────────────────────

/**
 * Owner's per-customer decision passed from the review UI to applyImport.
 * `client_id` is required when action === "link" (the existing client to
 * attach qb_id to); optional otherwise. For "create" it is ignored.
 */
export interface QboApplyDecision {
  customer_qb_id: string;
  action: MatchAction;
  client_id?: string;
}

/** Per-entity counts returned by applyImport. qb_write_calls MUST be 0. */
export interface QboApplyResult {
  clientsLinked: number;
  clientsCreated: number;
  clientsSkipped: number;
  estimatesUpserted: number;
  invoicesUpserted: number;
  lineItemsInserted: number;
  paymentsUpserted: number;
  invoicesReconciled: number;
  qb_write_calls: number;
}
```

If `MatchAction` is not already exported by A1, add (only if missing):
```ts
export type MatchAction = "link" | "create" | "skip" | "needs_review";
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/services/qbo-apply-types.test.ts
```
Expected: PASS (3 passing).

- [ ] **Step 5: Commit.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/types/qbo-import.ts tests/unit/services/qbo-apply-types.test.ts && git commit -m "feat(qbo-import): add apply decision + result types for A3 apply engine"
```

---

### Task A3.2: TDD the `applyImport` engine — failing test that asserts balance == QB Balance and Σ line_total == subtotal

The contract requires a test that applies a fixture run into a temp company and asserts `invoice.balance_due == QB Balance` and `Σ line_total == subtotal`. The repo mocks Supabase in unit tests (it never hits a live DB), so the test builds an in-memory Supabase double whose `invoices` row is recomputed by a faithful `update_invoice_balance` simulation on every `payments` write — exercising the real trigger-then-reconcile ordering. `line_total` is computed by the double using the generated-column formula `round(qty*unit_price*(1-coalesce(disc,0)/100),2)` and is rejected if the caller ever tries to insert it.

**Files:**
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/services/quickbooks-apply.test.ts` (Create)
- Fixture: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/fixtures/qbo/apply-run.fixture.ts` (Create)

Steps:

- [ ] **Step 1: Create the staged fixture** representing one fully-staged run (1 customer → create, 1 estimate, 1 invoice linked to that estimate, 2 line items, 1 payment applying $200 of a $362.07 invoice → QB Balance 162.07). Subtotal 335.25, tax 26.82, total 362.07; line totals 235.25 + 100.00 = 335.25 = subtotal.

```ts
// tests/fixtures/qbo/apply-run.fixture.ts
export const TEMP_COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
export const RUN_ID = "99999999-0000-4000-8000-000000000001";

export const stagedCustomers = [
  {
    id: "sc-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    qb_id: "QB-CUST-1", display_name: "Acme Decks", email: "ap@acmedecks.test",
    phone: "555-0100", address: "1 Cedar Way, Vancouver BC V5K0A1", active: true, raw: {},
  },
];

export const stagedEstimates = [
  {
    id: "se-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    qb_id: "QB-EST-1", doc_number: "E-1001", customer_qb_id: "QB-CUST-1",
    txn_date: "2026-03-01", expiration_date: "2026-04-01", txn_status: "Accepted",
    subtotal: 335.25, tax_amount: 26.82, tax_rate: 8, total: 362.07, raw: {},
  },
];

export const stagedInvoices = [
  {
    id: "si-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    qb_id: "QB-INV-1", doc_number: "1001", customer_qb_id: "QB-CUST-1",
    estimate_qb_id: "QB-EST-1", txn_date: "2026-03-05", due_date: "2026-04-05",
    subtotal: 335.25, tax_amount: 26.82, tax_rate: 8, total: 362.07,
    balance: 162.07, derived_status: "partially_paid", raw: {},
  },
];

export const stagedLineItems = [
  {
    id: "sl-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    parent_type: "invoice", parent_qb_id: "QB-INV-1", qb_line_id: "1",
    name: "Cedar deck boards", description: "Cedar deck boards",
    quantity: 47.05, unit_price: 5, amount: 235.25,
    is_taxable: true, qb_item_type: "NonInventory", sort_order: 0,
  },
  {
    id: "sl-2", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    parent_type: "invoice", parent_qb_id: "QB-INV-1", qb_line_id: "2",
    name: "Labor", description: "Install labor",
    quantity: 1, unit_price: 100, amount: 100,
    is_taxable: true, qb_item_type: "Service", sort_order: 1,
  },
];

export const stagedPayments = [
  {
    id: "sp-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    qb_id: "QB-PMT-1", customer_qb_id: "QB-CUST-1", txn_date: "2026-03-20",
    total_amt: 200, unapplied_amt: 0,
    applied_lines: [{ invoice_qb_id: "QB-INV-1", amount: 200, reference_number: "CHK-77" }],
    raw: {},
  },
];

export const customerMatches = [
  {
    id: "cm-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    customer_qb_id: "QB-CUST-1", proposed_action: "create",
    matched_client_id: null, match_basis: "none", confidence: "low",
    candidates: [], decided_action: null, decided_client_id: null,
  },
];

export const decisions = [
  { customer_qb_id: "QB-CUST-1", action: "create" as const },
];
```

- [ ] **Step 2: Write the failing apply test.** The in-memory Supabase double stores tables in Maps; the `payments` insert handler runs a `recomputeInvoiceBalance` simulation of `update_invoice_balance()`; `line_items` insert rejects any payload containing `line_total` and computes it. `getValidToken` is mocked.

```ts
// tests/unit/services/quickbooks-apply.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TEMP_COMPANY_ID, RUN_ID,
  stagedCustomers, stagedEstimates, stagedInvoices,
  stagedLineItems, stagedPayments, customerMatches, decisions,
} from "../../fixtures/qbo/apply-run.fixture";

// Token service is never allowed to be hit for a GET-only/no-network apply,
// but the service imports it; stub to a fixed token.
vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: {
    getValidToken: vi.fn(async () => ({ accessToken: "stub", realmId: "realm-1" })),
  },
}));

type Row = Record<string, any>;
function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * In-memory Supabase double. Tables are arrays of rows. Supports the exact
 * builder calls applyImport uses: from().select().eq()....maybeSingle(),
 * from().upsert(rows,{onConflict}), from().insert(rows), from().delete().eq(),
 * from().update(patch).eq(). The payments insert path recomputes the parent
 * invoice exactly like trg_payment_balance -> update_invoice_balance().
 */
function makeSupabase() {
  const db: Record<string, Row[]> = {
    qbo_import_runs: [{ id: RUN_ID, company_id: TEMP_COMPANY_ID, status: "staged", qb_write_calls: 0, totals: {} }],
    qbo_staging_customers: structuredClone(stagedCustomers),
    qbo_staging_estimates: structuredClone(stagedEstimates),
    qbo_staging_invoices: structuredClone(stagedInvoices),
    qbo_staging_line_items: structuredClone(stagedLineItems),
    qbo_staging_payments: structuredClone(stagedPayments),
    qbo_customer_matches: structuredClone(customerMatches),
    clients: [],
    estimates: [],
    invoices: [],
    line_items: [],
    payments: [],
    notifications: [],
  };
  let seq = 0;
  const uid = (p: string) => `${p}-${++seq}`;

  function recomputeInvoiceBalance(invoiceId: string) {
    const inv = db.invoices.find((r) => r.id === invoiceId);
    if (!inv) return;
    const paid = db.payments
      .filter((p) => p.invoice_id === invoiceId && !p.voided_at)
      .reduce((s, p) => s + Number(p.amount), 0);
    inv.amount_paid = round2(paid);
    inv.balance_due = round2(Number(inv.total) - paid);
    if (paid >= Number(inv.total)) { inv.status = "paid"; inv.paid_at = new Date().toISOString(); }
    else if (paid > 0) { inv.status = "partially_paid"; }
  }

  function builder(table: string) {
    let rows = db[table];
    const filters: Array<(r: Row) => boolean> = [];
    const api: any = {
      select() { return api; },
      eq(col: string, val: any) { filters.push((r) => r[col] === val); return api; },
      in(col: string, vals: any[]) { filters.push((r) => vals.includes(r[col])); return api; },
      order() { return api; },
      _match() { return rows.filter((r) => filters.every((f) => f(r))); },
      async maybeSingle() { return { data: api._match()[0] ?? null, error: null }; },
      async single() { const m = api._match(); return { data: m[0] ?? null, error: m.length ? null : { message: "no rows" } }; },
      then(resolve: any) { return Promise.resolve({ data: api._match(), error: null }).then(resolve); },
      async upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
        const list = Array.isArray(payload) ? payload : [payload];
        const keys = (opts?.onConflict ?? "id").split(",");
        for (const incoming of list) {
          const existing = db[table].find((r) => keys.every((k) => r[k] === incoming[k]));
          if (existing) Object.assign(existing, incoming);
          else db[table].push({ id: incoming.id ?? uid(table), ...incoming });
        }
        return { data: list, error: null };
      },
      async insert(payload: Row | Row[]) {
        const list = Array.isArray(payload) ? payload : [payload];
        for (const incoming of list) {
          if (table === "line_items" && "line_total" in incoming) {
            throw new Error("line_total is GENERATED — must not be inserted");
          }
          const row: Row = { id: incoming.id ?? uid(table), ...incoming };
          if (table === "line_items") {
            row.line_total = round2(
              Number(row.quantity) * Number(row.unit_price) *
              (1 - (Number(row.discount_percent ?? 0)) / 100)
            );
          }
          db[table].push(row);
          if (table === "payments" && row.invoice_id) recomputeInvoiceBalance(row.invoice_id);
        }
        return { data: list, error: null };
      },
      async delete() {
        return {
          eq(col: string, val: any) {
            db[table] = db[table].filter((r) => r[col] !== val);
            return Promise.resolve({ data: null, error: null });
          },
          in(col: string, vals: any[]) {
            db[table] = db[table].filter((r) => !vals.includes(r[col]));
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      update(patch: Row) {
        return {
          eq(col: string, val: any) {
            for (const r of db[table]) if (r[col] === val) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null });
          },
          in(col: string, vals: any[]) {
            for (const r of db[table]) if (vals.includes(r[col])) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    return api;
  }
  return { from: (t: string) => builder(t), __db: db } as any;
}

describe("QuickBooksImportService.applyImport", () => {
  let supabase: any;
  beforeEach(() => { supabase = makeSupabase(); });

  it("applies a staged run: creates client, headers, line items, payments, reconciles to QB Balance", async () => {
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    const result = await svc.applyImport(RUN_ID, decisions);

    // Client created
    expect(result.clientsCreated).toBe(1);
    const client = supabase.__db.clients[0];
    expect(client.qb_id).toBe("QB-CUST-1");
    expect(client.name).toBe("Acme Decks");

    // Estimate + invoice headers (QB-authoritative totals)
    expect(result.estimatesUpserted).toBe(1);
    expect(result.invoicesUpserted).toBe(1);
    const est = supabase.__db.estimates[0];
    const inv = supabase.__db.invoices[0];
    expect(est.subtotal).toBe(335.25);
    expect(inv.total).toBe(362.07);
    expect(inv.client_id).toBe(client.id);
    expect(inv.estimate_id).toBe(est.id); // estimate→invoice linkage

    // Line items: 2 inserted, NONE carried line_total in, Σ line_total == subtotal
    expect(result.lineItemsInserted).toBe(2);
    const invLines = supabase.__db.line_items.filter((l: any) => l.invoice_id === inv.id);
    expect(invLines).toHaveLength(2);
    const sumLineTotal = round2(invLines.reduce((s: number, l: any) => s + Number(l.line_total), 0));
    expect(sumLineTotal).toBe(Number(inv.subtotal)); // 335.25

    // Payment applied + trigger recomputed amount_paid to 200
    expect(result.paymentsUpserted).toBe(1);
    expect(supabase.__db.payments[0].amount).toBe(200);

    // RECONCILE ran AFTER payments: balance_due == QB Balance to the cent
    expect(result.invoicesReconciled).toBe(1);
    expect(inv.balance_due).toBe(162.07);          // == staged QB Balance
    expect(round2(Number(inv.amount_paid) + Number(inv.balance_due))).toBe(362.07);
    expect(inv.status).toBe("partially_paid");

    // Read-only guarantee
    expect(result.qb_write_calls).toBe(0);
  });

  it("is idempotent — second apply produces no duplicate clients/invoices/lines", async () => {
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    await svc.applyImport(RUN_ID, decisions);
    await svc.applyImport(RUN_ID, decisions);
    expect(supabase.__db.clients).toHaveLength(1);
    expect(supabase.__db.invoices).toHaveLength(1);
    expect(supabase.__db.estimates).toHaveLength(1);
    expect(supabase.__db.line_items).toHaveLength(2); // delete-by-parent then reinsert
    expect(supabase.__db.payments).toHaveLength(1);
  });

  it("link decision writes ONLY qb_id onto the existing client", async () => {
    supabase.__db.clients.push({
      id: "existing-1", company_id: TEMP_COMPANY_ID, name: "Acme Decks Ltd",
      email: "billing@acme.test", phone_number: "555-9999", address: "old addr", qb_id: null,
    });
    supabase.__db.qbo_customer_matches[0].proposed_action = "link";
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    await svc.applyImport(RUN_ID, [{ customer_qb_id: "QB-CUST-1", action: "link", client_id: "existing-1" }]);
    const c = supabase.__db.clients.find((r: any) => r.id === "existing-1");
    expect(c.qb_id).toBe("QB-CUST-1");
    expect(c.name).toBe("Acme Decks Ltd");          // never overwritten
    expect(c.email).toBe("billing@acme.test");
    expect(c.phone_number).toBe("555-9999");
    expect(supabase.__db.clients).toHaveLength(1);  // no new client created
  });

  it("skip decision drops the customer and its dependent invoice/lines/payments", async () => {
    supabase.__db.qbo_customer_matches[0].proposed_action = "skip";
    const { QuickBooksImportService } = await import("@/lib/api/services/quickbooks-import-service");
    const svc = new QuickBooksImportService(supabase);
    const result = await svc.applyImport(RUN_ID, [{ customer_qb_id: "QB-CUST-1", action: "skip" }]);
    expect(result.clientsSkipped).toBe(1);
    expect(supabase.__db.clients).toHaveLength(0);
    expect(supabase.__db.invoices).toHaveLength(0);
    expect(supabase.__db.line_items).toHaveLength(0);
    expect(supabase.__db.payments).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test — expect FAIL.** `applyImport` does not exist on the A1 service yet (and the class may not accept a `supabase` constructor arg).

```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/services/quickbooks-apply.test.ts
```
Expected: FAIL — `svc.applyImport is not a function` / constructor signature mismatch.

(No commit — test lands together with the implementation in A3.3.)

---

### Task A3.3: Implement `applyImport` in `quickbooks-import-service.ts` (the 5-step transactional engine)

A1 created `QuickBooksImportService`. A3 adds `applyImport`. The service is **service-role** only (writes via the injected service-role client) and issues **zero** QB calls during apply (it operates entirely on already-staged rows). Add `applyImport` and its private helpers without disturbing A1/A2 methods.

> **Constructor note:** A1's `QuickBooksImportService` constructor takes the service-role `SupabaseClient` (the test injects the in-memory double). If A1 instead constructed its own client internally, A3 must add an optional injected-client constructor param `constructor(supabase: SupabaseClient = getServiceRoleClient())` and store it as `this.supabase`. The code below assumes `this.supabase` is the service-role client.

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/quickbooks-import-service.ts`

Steps:

- [ ] **Step 1: Add imports + the status-deriving helper.** At the top of the file (merge with A1's import block; do not duplicate):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type {
  QboApplyDecision,
  QboApplyResult,
} from "@/lib/types/qbo-import";
```

- [ ] **Step 2: Ensure the constructor stores an injectable service-role client.** If A1 did not already, add:

```ts
export class QuickBooksImportService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = getServiceRoleClient()) {
    this.supabase = supabase;
  }
  // ... A1/A2 methods unchanged ...
}
```

- [ ] **Step 3: Add the private status-deriving helper** (contract §5.2; today-relative). Place inside the class:

```ts
  /**
   * Derive OPS invoice status from QB Balance / Total / DueDate.
   * Voided / zero-total invoices are filtered upstream (never staged as live).
   */
  private deriveInvoiceStatus(total: number, balance: number, dueDate: string | null): string {
    if (balance <= 0) return "paid";
    if (balance < total) return "partially_paid";
    if (dueDate) {
      const today = new Date().toISOString().slice(0, 10);
      if (dueDate < today) return "past_due";
    }
    return "awaiting_payment";
  }
```

- [ ] **Step 4: Add `applyImport` — STEP 1 (clients) + scaffolding.** Place inside the class. This loads staged rows, applies client decisions, and builds the `customer_qb_id → client_id` map. `skip`ped customers are tracked so their dependent invoices/estimates/payments are dropped.

```ts
  /**
   * Apply a staged import run into live tables, in the locked transactional
   * order (contract §8). Idempotent on (company_id, qb_id). Issues ZERO calls
   * to QuickBooks — operates entirely on staged rows.
   */
  async applyImport(runId: string, decisions: QboApplyDecision[]): Promise<QboApplyResult> {
    const sb = this.supabase;

    const { data: run } = await sb
      .from("qbo_import_runs")
      .select("id, company_id")
      .eq("id", runId)
      .single();
    if (!run) throw new Error(`Import run not found: ${runId}`);
    const companyId = run.company_id as string;

    await sb.from("qbo_import_runs").update({ status: "applying" }).eq("id", runId);

    // ── Load all staged rows for this run ──────────────────────────────────
    const { data: stagedCustomers } = await sb
      .from("qbo_staging_customers").select("*").eq("run_id", runId);
    const { data: stagedEstimates } = await sb
      .from("qbo_staging_estimates").select("*").eq("run_id", runId);
    const { data: stagedInvoices } = await sb
      .from("qbo_staging_invoices").select("*").eq("run_id", runId);
    const { data: stagedLines } = await sb
      .from("qbo_staging_line_items").select("*").eq("run_id", runId);
    const { data: stagedPayments } = await sb
      .from("qbo_staging_payments").select("*").eq("run_id", runId);

    const result: QboApplyResult = {
      clientsLinked: 0, clientsCreated: 0, clientsSkipped: 0,
      estimatesUpserted: 0, invoicesUpserted: 0, lineItemsInserted: 0,
      paymentsUpserted: 0, invoicesReconciled: 0, qb_write_calls: 0,
    };

    const decisionByQbId = new Map(decisions.map((d) => [d.customer_qb_id, d]));
    // customer_qb_id → resolved OPS client_id (null === skipped)
    const clientIdByCustomerQbId = new Map<string, string | null>();

    // ── STEP 1: Clients (link / create / skip) ─────────────────────────────
    for (const cust of stagedCustomers ?? []) {
      const decision = decisionByQbId.get(cust.qb_id as string);
      const action = decision?.action ?? "skip";

      if (action === "skip" || action === "needs_review") {
        clientIdByCustomerQbId.set(cust.qb_id as string, null);
        result.clientsSkipped++;
        continue;
      }

      if (action === "link") {
        const clientId = decision?.client_id;
        if (!clientId) {
          clientIdByCustomerQbId.set(cust.qb_id as string, null);
          result.clientsSkipped++;
          continue;
        }
        // Link writes ONLY qb_id — never overwrite name/email/phone/address.
        await sb.from("clients").update({ qb_id: cust.qb_id }).eq("id", clientId);
        clientIdByCustomerQbId.set(cust.qb_id as string, clientId);
        result.clientsLinked++;
        continue;
      }

      // action === "create" — idempotent on (company_id, qb_id)
      const { data: existing } = await sb
        .from("clients")
        .select("id")
        .eq("company_id", companyId)
        .eq("qb_id", cust.qb_id)
        .maybeSingle();

      if (existing?.id) {
        clientIdByCustomerQbId.set(cust.qb_id as string, existing.id as string);
        result.clientsCreated++; // counts as an applied create even on re-run
        continue;
      }

      const newId = crypto.randomUUID();
      await sb.from("clients").upsert(
        {
          id: newId,
          company_id: companyId,
          qb_id: cust.qb_id,
          name: cust.display_name ?? "QuickBooks customer",
          email: cust.email ?? null,
          phone_number: cust.phone ?? null,
          address: cust.address ?? null,
        },
        { onConflict: "company_id,qb_id" }
      );
      const { data: created } = await sb
        .from("clients").select("id")
        .eq("company_id", companyId).eq("qb_id", cust.qb_id).maybeSingle();
      clientIdByCustomerQbId.set(cust.qb_id as string, (created?.id as string) ?? newId);
      result.clientsCreated++;
    }
```

> `crypto.randomUUID()` is available in the Node/Next server runtime; the test double accepts the supplied `id` on upsert.

- [ ] **Step 5: Continue `applyImport` — STEP 2 (estimate + invoice headers, with linkage).** Estimates first (so invoices can resolve `estimate_id`). Build `estimate_qb_id → estimates.id` and `invoice_qb_id → invoices.id` maps. Skip estimates/invoices whose customer was skipped.

```ts
    // ── STEP 2: Estimate + invoice HEADERS (QB-authoritative totals) ────────
    const estimateIdByQbId = new Map<string, string>();
    for (const est of stagedEstimates ?? []) {
      const clientId = clientIdByCustomerQbId.get(est.customer_qb_id as string);
      if (!clientId) continue; // customer skipped → drop estimate

      const status = this.mapEstimateStatus(
        est.txn_status as string | null,
        est.expiration_date as string | null
      );
      const estId = crypto.randomUUID();
      await sb.from("estimates").upsert(
        {
          id: estId,
          company_id: companyId,
          qb_id: est.qb_id,
          client_id: clientId,
          estimate_number: est.doc_number ?? null,
          subtotal: est.subtotal ?? null,
          tax_rate: est.tax_rate ?? null,
          tax_amount: est.tax_amount ?? null,
          total: est.total ?? null,
          status,
          issue_date: est.txn_date ?? null,
          expiration_date: est.expiration_date ?? null,
        },
        { onConflict: "company_id,qb_id" }
      );
      const { data: row } = await sb
        .from("estimates").select("id")
        .eq("company_id", companyId).eq("qb_id", est.qb_id).maybeSingle();
      const resolved = (row?.id as string) ?? estId;
      estimateIdByQbId.set(est.qb_id as string, resolved);
      result.estimatesUpserted++;
    }

    const invoiceIdByQbId = new Map<string, string>();
    for (const inv of stagedInvoices ?? []) {
      const clientId = clientIdByCustomerQbId.get(inv.customer_qb_id as string);
      if (!clientId) continue; // customer skipped → drop invoice

      const total = Number(inv.total ?? 0);
      const balance = Number(inv.balance ?? 0);
      const status = this.deriveInvoiceStatus(total, balance, inv.due_date as string | null);
      const estimateId = inv.estimate_qb_id
        ? estimateIdByQbId.get(inv.estimate_qb_id as string) ?? null
        : null;

      const invId = crypto.randomUUID();
      await sb.from("invoices").upsert(
        {
          id: invId,
          company_id: companyId,
          qb_id: inv.qb_id,
          client_id: clientId,
          estimate_id: estimateId,
          invoice_number: inv.doc_number ?? null,
          subtotal: inv.subtotal ?? null,
          tax_rate: inv.tax_rate ?? null,
          tax_amount: inv.tax_amount ?? null,
          total: inv.total ?? null,
          status, // provisional; reconciled in STEP 5
          issue_date: inv.txn_date ?? null,
          due_date: inv.due_date ?? null,
        },
        { onConflict: "company_id,qb_id" }
      );
      const { data: row } = await sb
        .from("invoices").select("id")
        .eq("company_id", companyId).eq("qb_id", inv.qb_id).maybeSingle();
      const resolved = (row?.id as string) ?? invId;
      invoiceIdByQbId.set(inv.qb_id as string, resolved);
      result.invoicesUpserted++;
    }
```

> **`mapEstimateStatus`**: A1/A2 may already define the estimate-status mapping during staging. If a `mapEstimateStatus(txnStatus, expirationDate)` helper does not already exist on the class, add it here (contract §5.6):

```ts
  private mapEstimateStatus(txnStatus: string | null, expirationDate: string | null): string {
    const today = new Date().toISOString().slice(0, 10);
    switch (txnStatus) {
      case "Accepted": return "approved";
      case "Closed":   return "converted";
      case "Rejected": return "declined";
      case "Pending":
      default:
        if (expirationDate && expirationDate < today) return "expired";
        return "sent";
    }
  }
```

- [ ] **Step 6: Continue `applyImport` — STEP 3 (line items: delete-by-parent then reinsert).** `line_items` has no triggers and `line_total` is GENERATED — never insert it. Re-import = delete all lines for each applied parent, then reinsert. Parent type drives `estimate_id` xor `invoice_id`.

```ts
    // ── STEP 3: Line items (delete-by-parent then reinsert) ────────────────
    // line_total is GENERATED — never inserted. No triggers — purely additive.
    const appliedInvoiceIds = [...invoiceIdByQbId.values()];
    const appliedEstimateIds = [...estimateIdByQbId.values()];
    if (appliedInvoiceIds.length) {
      await sb.from("line_items").delete().in("invoice_id", appliedInvoiceIds);
    }
    if (appliedEstimateIds.length) {
      await sb.from("line_items").delete().in("estimate_id", appliedEstimateIds);
    }

    for (const line of stagedLines ?? []) {
      let parentInvoiceId: string | null = null;
      let parentEstimateId: string | null = null;
      if (line.parent_type === "invoice") {
        parentInvoiceId = invoiceIdByQbId.get(line.parent_qb_id as string) ?? null;
        if (!parentInvoiceId) continue; // parent dropped (skipped customer)
      } else {
        parentEstimateId = estimateIdByQbId.get(line.parent_qb_id as string) ?? null;
        if (!parentEstimateId) continue;
      }

      const itemType = line.qb_item_type as string | null;
      const opsType =
        itemType === "Inventory" || itemType === "NonInventory" ? "MATERIAL" : "OTHER";

      await sb.from("line_items").insert({
        company_id: companyId,
        estimate_id: parentEstimateId,
        invoice_id: parentInvoiceId,
        product_id: null,
        name: line.name ?? "Line item",
        description: line.description ?? null,
        quantity: line.quantity ?? 1,
        unit: null,
        unit_price: line.unit_price ?? 0,
        // line_total intentionally omitted — GENERATED column.
        is_taxable: line.is_taxable ?? false,
        sort_order: line.sort_order ?? 0,
        type: opsType,
      });
      result.lineItemsInserted++;
    }
```

- [ ] **Step 7: Continue `applyImport` — STEP 4 (payments: one row per linked invoice line).** Upsert on `(company_id, qb_id)`. Because OPS `payments.qb_id` is one column but a QB payment can apply to multiple invoices, the idempotency key per OPS row is the composite `qb_id` of `{qbPaymentId}:{invoiceQbId}` so re-import updates in place rather than duplicating. Each insert fires `trg_payment_balance`.

```ts
    // ── STEP 4: Payments (one OPS row per linked invoice line) ─────────────
    // Each insert fires trg_payment_balance -> update_invoice_balance(),
    // recomputing amount_paid/balance_due/status from in-window payments.
    for (const pmt of stagedPayments ?? []) {
      const clientId = clientIdByCustomerQbId.get(pmt.customer_qb_id as string) ?? null;
      const lines = (pmt.applied_lines as Array<{
        invoice_qb_id: string; amount: number; reference_number?: string;
      }>) ?? [];

      for (const l of lines) {
        const invoiceId = invoiceIdByQbId.get(l.invoice_qb_id) ?? null;
        if (!invoiceId) continue; // payment line references a dropped/absent invoice
        const compositeQbId = `${pmt.qb_id}:${l.invoice_qb_id}`;
        await sb.from("payments").upsert(
          {
            company_id: companyId,
            qb_id: compositeQbId,
            invoice_id: invoiceId,
            client_id: clientId,
            amount: l.amount,
            payment_date: pmt.txn_date ?? null,
            reference_number: l.reference_number ?? null,
            payment_method: null,
          },
          { onConflict: "company_id,qb_id" }
        );
        result.paymentsUpserted++;
      }
    }
```

- [ ] **Step 8: Finish `applyImport` — STEP 5 (reconcile to QB Balance) + run bookkeeping.** This runs AFTER payments so it overwrites the trigger's in-window-only computation, making OPS A/R match QB to the cent.

```ts
    // ── STEP 5: Reconcile invoices to QB-authoritative Balance ─────────────
    for (const inv of stagedInvoices ?? []) {
      const invoiceId = invoiceIdByQbId.get(inv.qb_id as string);
      if (!invoiceId) continue;
      const total = Number(inv.total ?? 0);
      const balance = Number(inv.balance ?? 0);
      const amountPaid = Math.round((total - balance + Number.EPSILON) * 100) / 100;
      const status = this.deriveInvoiceStatus(total, balance, inv.due_date as string | null);
      await sb.from("invoices").update({
        amount_paid: amountPaid,
        balance_due: balance,
        status,
        paid_at: balance <= 0 ? new Date().toISOString() : null,
      }).eq("id", invoiceId);
      result.invoicesReconciled++;
    }

    await sb.from("qbo_import_runs").update({
      status: "applied",
      totals: result as unknown as Record<string, number>,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    return result;
  }
```

- [ ] **Step 9: Run the apply test — expect PASS.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/services/quickbooks-apply.test.ts
```
Expected: PASS (4 passing) — balance_due === 162.07 (QB Balance), Σ line_total === 335.25 (subtotal), idempotent re-run, link-only-qb_id, skip-cascade all green.

- [ ] **Step 10: Typecheck the service in isolation.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "quickbooks-import-service|qbo-import|quickbooks-apply" || echo "no type errors in A3 files"
```
Expected: `no type errors in A3 files`.

- [ ] **Step 11: Commit engine + test + fixture.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/quickbooks-import-service.ts tests/unit/services/quickbooks-apply.test.ts tests/fixtures/qbo/apply-run.fixture.ts && git commit -m "feat(qbo-import): transactional trigger-aware applyImport engine (clients→headers→lines→payments→reconcile)"
```

---

### Task A3.4: Create `import/route.ts` — POST (start+pull+stage+match) and GET (review)

Mirrors `/api/sync` auth exactly: `verifyAdminAuth` → `findUserByAuth` (company) → `verifyCompanyAccess` → `checkPermissionById(userId, "accounting.manage_connections")`. POST orchestrates `startImportRun` → `pullAndStage` → `computeCustomerMatches` and returns `{ runId }`. GET `?runId=` returns the `QboImportReview` aggregate.

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/app/api/integrations/quickbooks/import/route.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/integration/qbo-import-route.test.ts` (Create)

Steps:

- [ ] **Step 1: Write the failing route test.** Mock auth + permission + the import service; assert 401/403/400 gating and the happy-path `{ runId }`.

```ts
// tests/integration/qbo-import-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const startImportRun = vi.fn();
const pullAndStage = vi.fn();
const computeCustomerMatches = vi.fn();
const getImportReview = vi.fn();
const connSingle = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: (...a: unknown[]) => checkPermissionById(...a) }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: () => connSingle() }) }) }) }),
  }),
}));
vi.mock("@/lib/api/services/quickbooks-import-service", () => ({
  QuickBooksImportService: class {
    startImportRun = (...a: unknown[]) => startImportRun(...a);
    pullAndStage = (...a: unknown[]) => pullAndStage(...a);
    computeCustomerMatches = (...a: unknown[]) => computeCustomerMatches(...a);
    getImportReview = (...a: unknown[]) => getImportReview(...a);
  },
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
function req(body: unknown, url = "http://localhost/api/integrations/quickbooks/import") {
  return new Request(url, { method: "POST", body: JSON.stringify(body) }) as never;
}

describe("POST /api/integrations/quickbooks/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "o@x.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
    connSingle.mockResolvedValue({ data: { id: "conn-1", is_connected: true }, error: null });
    startImportRun.mockResolvedValue({ id: "run-1", company_id: CO, status: "pending" });
    pullAndStage.mockResolvedValue(undefined);
    computeCustomerMatches.mockResolvedValue(undefined);
  });

  it("401 when unauthenticated", async () => {
    verifyAdminAuth.mockResolvedValue(null);
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({ companyId: CO }));
    expect(res.status).toBe(401);
  });

  it("403 when lacking accounting.manage_connections", async () => {
    checkPermissionById.mockResolvedValue(false);
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({ companyId: CO }));
    expect(res.status).toBe(403);
  });

  it("403 when company mismatch", async () => {
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: "other-co" });
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({ companyId: CO }));
    expect(res.status).toBe(403);
  });

  it("400 when companyId missing", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("runs start→pull→match and returns runId", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/route");
    const res = await POST(req({ companyId: CO }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: "run-1" });
    expect(startImportRun).toHaveBeenCalledWith(CO);
    expect(pullAndStage).toHaveBeenCalledWith("run-1");
    expect(computeCustomerMatches).toHaveBeenCalledWith("run-1");
  });

  it("GET returns the review aggregate for a runId", async () => {
    getImportReview.mockResolvedValue({ run: { id: "run-1" }, matches: [], counts: {}, reconciliation: {} });
    const { GET } = await import("@/app/api/integrations/quickbooks/import/route");
    const url = `http://localhost/api/integrations/quickbooks/import?runId=run-1`;
    const res = await GET(new Request(url) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).run.id).toBe("run-1");
    expect(getImportReview).toHaveBeenCalledWith("run-1");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Route file does not exist.
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/qbo-import-route.test.ts
```
Expected: FAIL — cannot resolve `@/app/api/integrations/quickbooks/import/route`.

- [ ] **Step 3: Implement the route.**

```ts
// src/app/api/integrations/quickbooks/import/route.ts
/**
 * OPS Web — QuickBooks Read-Only Import
 *
 * POST /api/integrations/quickbooks/import        — start run + pull + stage + compute matches → { runId }
 * GET  /api/integrations/quickbooks/import?runId= — return the QboImportReview aggregate
 *
 * Auth mirrors /api/sync: Firebase/Supabase JWT → company-access check →
 * accounting.manage_connections permission. Read-only: issues ONLY GET calls
 * to QuickBooks; nothing is written to Intuit.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { QuickBooksImportService } from "@/lib/api/services/quickbooks-import-service";

const PROVIDER = "quickbooks";

// ─── POST: start run + pull + stage + compute matches ───────────────────────

export async function POST(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const companyId = (body as { companyId?: string }).companyId;
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if ((user.company_id as string) !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allowed = await checkPermissionById(user.id as string, "accounting.manage_connections");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();
    const { data: connection, error: connError } = await supabase
      .from("accounting_connections")
      .select("id, is_connected")
      .eq("company_id", companyId)
      .eq("provider", PROVIDER)
      .single();

    if (connError || !connection) {
      return NextResponse.json({ error: "No QuickBooks connection found" }, { status: 404 });
    }
    if (!connection.is_connected) {
      return NextResponse.json({ error: "QuickBooks is not connected" }, { status: 400 });
    }

    const service = new QuickBooksImportService(supabase);
    try {
      const run = await service.startImportRun(companyId);
      await service.pullAndStage(run.id);
      await service.computeCustomerMatches(run.id);
      return NextResponse.json({ runId: run.id });
    } catch (err) {
      console.error("[qbo-import] pull/stage failed:", err);
      return NextResponse.json(
        { error: `Import failed: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[qbo-import] POST error:", err);
    return NextResponse.json({ error: "Failed to start import" }, { status: 500 });
  }
}

// ─── GET: review aggregate ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const allowed = await checkPermissionById(user.id as string, "accounting.manage_connections");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();
    const service = new QuickBooksImportService(supabase);

    // Scope check: the run must belong to the caller's company.
    const review = await service.getImportReview(runId);
    if (review.run && (review.run.company_id as string) !== (user.company_id as string)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(review);
  } catch (err) {
    console.error("[qbo-import] GET error:", err);
    return NextResponse.json({ error: "Failed to load import review" }, { status: 500 });
  }
}
```

> The GET company-scope check reads `review.run.company_id`; `QboImportReview.run` is the full `QboImportRun` (which carries `company_id`). The test mocks `getImportReview` returning a `run` without `company_id`, so the scope branch is skipped (`undefined !== "co"` would be true) — adjust the test mock to include `company_id: CO` if the strict scope check is desired; the provided mock returns `{ run: { id: "run-1" } }`, so add `company_id: CO` to that mock object in Step 1 to keep the GET test green. (Update the Step-1 GET mock to `getImportReview.mockResolvedValue({ run: { id: "run-1", company_id: CO }, ... })`.)

- [ ] **Step 4: Apply the GET-mock fix noted above** in the test (so the scope check passes), then run — expect PASS.
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/qbo-import-route.test.ts
```
Expected: PASS (6 passing).

- [ ] **Step 5: Commit.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/app/api/integrations/quickbooks/import/route.ts tests/integration/qbo-import-route.test.ts && git commit -m "feat(qbo-import): import route POST (start+pull+stage+match) and GET review"
```

---

### Task A3.5: Create `import/apply/route.ts` — POST apply + notification-rail event

Same auth as A3.4. Validates `{ runId, decisions }`, scopes the run to the caller's company, calls `service.applyImport`, then inserts a notification-rail row directly into `notifications` (server-side; the client `notification-dispatch.ts` helpers cannot run from an API route). Returns `{ applied: QboApplyResult }`.

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/app/api/integrations/quickbooks/import/apply/route.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/integration/qbo-import-apply-route.test.ts` (Create)

Steps:

- [ ] **Step 1: Write the failing test.** Mock auth/permission, the service `applyImport`, and a Supabase double that records the run lookup + the notification insert.

```ts
// tests/integration/qbo-import-apply-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const checkPermissionById = vi.fn();
const applyImport = vi.fn();
const runSingle = vi.fn();
const notificationInsert = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: (...a: unknown[]) => checkPermissionById(...a) }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (t: string) => {
      if (t === "qbo_import_runs") {
        return { select: () => ({ eq: () => ({ single: () => runSingle() }) }) };
      }
      if (t === "notifications") {
        return { insert: (row: unknown) => { notificationInsert(row); return Promise.resolve({ error: null }); } };
      }
      return {};
    },
  }),
}));
vi.mock("@/lib/api/services/quickbooks-import-service", () => ({
  QuickBooksImportService: class {
    applyImport = (...a: unknown[]) => applyImport(...a);
  },
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
function post(body: unknown) {
  return new Request("http://localhost/api/integrations/quickbooks/import/apply", {
    method: "POST", body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/integrations/quickbooks/import/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "o@x.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    checkPermissionById.mockResolvedValue(true);
    runSingle.mockResolvedValue({ data: { id: "run-1", company_id: CO }, error: null });
    applyImport.mockResolvedValue({
      clientsLinked: 0, clientsCreated: 1, clientsSkipped: 0,
      estimatesUpserted: 1, invoicesUpserted: 1, lineItemsInserted: 2,
      paymentsUpserted: 1, invoicesReconciled: 1, qb_write_calls: 0,
    });
  });

  it("401 unauthenticated", async () => {
    verifyAdminAuth.mockResolvedValue(null);
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ runId: "run-1", decisions: [] }))).status).toBe(401);
  });

  it("403 without permission", async () => {
    checkPermissionById.mockResolvedValue(false);
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ runId: "run-1", decisions: [] }))).status).toBe(403);
  });

  it("403 when run belongs to another company", async () => {
    runSingle.mockResolvedValue({ data: { id: "run-1", company_id: "other" }, error: null });
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ runId: "run-1", decisions: [] }))).status).toBe(403);
  });

  it("400 when runId missing", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ decisions: [] }))).status).toBe(400);
  });

  it("400 when decisions is not an array", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    expect((await POST(post({ runId: "run-1", decisions: "nope" }))).status).toBe(400);
  });

  it("applies and emits a notification-rail event", async () => {
    const { POST } = await import("@/app/api/integrations/quickbooks/import/apply/route");
    const res = await POST(post({
      runId: "run-1",
      decisions: [{ customer_qb_id: "QB-CUST-1", action: "create" }],
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.applied.invoicesReconciled).toBe(1);
    expect(json.applied.qb_write_calls).toBe(0);
    expect(applyImport).toHaveBeenCalledWith("run-1", [{ customer_qb_id: "QB-CUST-1", action: "create" }]);
    expect(notificationInsert).toHaveBeenCalledTimes(1);
    const note = notificationInsert.mock.calls[0][0];
    expect(note.user_id).toBe("user-1");
    expect(note.company_id).toBe(CO);
    expect(note.action_url).toBe("/accounting");
    expect(note.persistent).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Route does not exist.
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/qbo-import-apply-route.test.ts
```
Expected: FAIL — cannot resolve the apply route module.

- [ ] **Step 3: Implement the apply route.**

```ts
// src/app/api/integrations/quickbooks/import/apply/route.ts
/**
 * OPS Web — QuickBooks Import Apply
 *
 * POST /api/integrations/quickbooks/import/apply
 * Body: { runId: string, decisions: { customer_qb_id, action, client_id? }[] }
 *
 * Applies a staged, owner-reviewed import into live tables (clients →
 * estimate/invoice headers → line items → payments → reconcile). Writes ONLY
 * to OPS Supabase — never to QuickBooks. Same auth as /api/sync +
 * accounting.manage_connections. Emits a notification-rail event on success.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { QuickBooksImportService } from "@/lib/api/services/quickbooks-import-service";
import type { QboApplyDecision } from "@/lib/types/qbo-import";

export async function POST(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { runId?: string; decisions?: unknown }
      | null;
    const runId = body?.runId;
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }
    if (!Array.isArray(body?.decisions)) {
      return NextResponse.json({ error: "decisions must be an array" }, { status: 400 });
    }
    const decisions = body.decisions as QboApplyDecision[];

    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userId = user.id as string;
    const companyId = user.company_id as string;

    const allowed = await checkPermissionById(userId, "accounting.manage_connections");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();

    // Scope the run to the caller's company before applying anything.
    const { data: run, error: runErr } = await supabase
      .from("qbo_import_runs")
      .select("id, company_id")
      .eq("id", runId)
      .single();
    if (runErr || !run) {
      return NextResponse.json({ error: "Import run not found" }, { status: 404 });
    }
    if ((run.company_id as string) !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const service = new QuickBooksImportService(supabase);
    let applied;
    try {
      applied = await service.applyImport(runId, decisions);
    } catch (err) {
      console.error("[qbo-import-apply] applyImport failed:", err);
      return NextResponse.json(
        { error: `Apply failed: ${(err as Error).message}` },
        { status: 500 }
      );
    }

    // ── Notification-rail event (server-side insert; non-fatal) ────────────
    try {
      const created = applied.clientsCreated + applied.clientsLinked;
      await supabase.from("notifications").insert({
        user_id: userId,
        company_id: companyId,
        type: "role_needed",
        title: "QuickBooks import applied",
        body:
          `${applied.invoicesUpserted} invoices, ${applied.paymentsUpserted} payments ` +
          `and ${created} clients imported into Books`,
        is_read: false,
        persistent: false,
        action_url: "/accounting",
        action_label: "View Books",
      });
    } catch (notifyErr) {
      console.error("[qbo-import-apply] notification insert failed (non-fatal):", notifyErr);
    }

    return NextResponse.json({ applied });
  } catch (err) {
    console.error("[qbo-import-apply] POST error:", err);
    return NextResponse.json({ error: "Failed to apply import" }, { status: 500 });
  }
}
```

> `type: "role_needed"` is the existing notification type used elsewhere in OPS-Web for "operation the user initiated finished" rail events (see OPS-Web CLAUDE.md Notification Rail examples). If A4's dictionary work introduces a dedicated `accounting_import` type, swap it there; `role_needed` is the safe, already-supported value for A3.

- [ ] **Step 4: Run — expect PASS.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/qbo-import-apply-route.test.ts
```
Expected: PASS (6 passing).

- [ ] **Step 5: Commit.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/app/api/integrations/quickbooks/import/apply/route.ts tests/integration/qbo-import-apply-route.test.ts && git commit -m "feat(qbo-import): import apply route with notification-rail event"
```

---

### Task A3.6: `sync-orchestrator` `pull_only` guard — never call any push* for a non-bidirectional connection

`runSyncForConnection` must read `sync_direction` and skip the push half when `pull_only` (and skip pulls when `push_only`). The contract requires the guard "at the top." Thread a `syncDirection` arg through and guard `syncQuickBooks` / `syncSage`.

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/sync-orchestrator.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/services/sync-orchestrator-pull-only.test.ts` (Create)

Steps:

- [ ] **Step 1: Write the failing guard test.** A Supabase double records which `from(...)` tables are written. For `pull_only`, the orchestrator must never push (no QB push service calls). Mock the QB/Sage sync + token services to count push calls.

```ts
// tests/unit/services/sync-orchestrator-pull-only.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const pushClient = vi.fn();
const pullClients = vi.fn(async () => []);
const pullInvoices = vi.fn(async () => []);

vi.mock("@/lib/api/services/accounting-token-service", () => ({
  AccountingTokenService: { getValidToken: vi.fn(async () => ({ accessToken: "t", realmId: "r" })) },
}));
vi.mock("@/lib/api/services/quickbooks-sync-service", () => ({
  QuickBooksSyncService: {
    pushClient: (...a: unknown[]) => pushClient(...a),
    pushInvoice: vi.fn(), pushEstimate: vi.fn(), pushPayment: vi.fn(),
    pullClients: (...a: unknown[]) => pullClients(...a),
    pullInvoices: (...a: unknown[]) => pullInvoices(...a),
  },
}));
vi.mock("@/lib/api/services/sage-sync-service", () => ({ SageSyncService: {} }));

function fakeSupabase() {
  const writes: string[] = [];
  const api: any = {
    from(t: string) {
      return {
        select: () => ({ eq: () => ({ or: () => Promise.resolve({ data: [], error: null }) }) }),
        update: () => { writes.push(`update:${t}`); return { eq: () => Promise.resolve({ error: null }) }; },
        insert: () => { writes.push(`insert:${t}`); return Promise.resolve({ error: null }); },
        upsert: () => { writes.push(`upsert:${t}`); return Promise.resolve({ error: null }); },
      };
    },
    __writes: writes,
  };
  return api;
}

describe("runSyncForConnection pull_only guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pull_only never invokes any push* method", async () => {
    const { runSyncForConnection } = await import("@/lib/api/services/sync-orchestrator");
    const sb = fakeSupabase();
    await runSyncForConnection(sb, "co-1", "quickbooks", "conn-1", null, "pull_only");
    expect(pushClient).not.toHaveBeenCalled();
    expect(pullClients).toHaveBeenCalled(); // pulls still run
  });

  it("bidirectional still pushes (backwards compatible)", async () => {
    const { runSyncForConnection } = await import("@/lib/api/services/sync-orchestrator");
    const sb = fakeSupabase();
    await runSyncForConnection(sb, "co-1", "quickbooks", "conn-1", null, "bidirectional");
    // No client rows returned, so pushClient body loop doesn't run, but the
    // push *section* executed (no throw). Pull still runs.
    expect(pullClients).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `runSyncForConnection` currently takes 5 args (no `syncDirection`) and always pushes.
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/services/sync-orchestrator-pull-only.test.ts
```
Expected: FAIL — arity/guard mismatch (`pushClient` would be reachable / signature error).

- [ ] **Step 3: Thread `syncDirection` and add guards.** Change `syncQuickBooks` / `syncSage` signatures to accept a `pushAllowed: boolean` and a `pullAllowed: boolean`, wrap the push sections and pull sections in those flags, and update `runSyncForConnection`.

In `syncQuickBooks` (and identically in `syncSage`), change the signature and gate the sections:

```ts
async function syncQuickBooks(
  supabase: SupabaseClient,
  companyId: string,
  connectionId: string,
  lastSyncAt: string | null,
  pushAllowed: boolean,
  pullAllowed: boolean
): Promise<SyncResult[]> {
  const { accessToken, realmId } = await AccountingTokenService.getValidToken(supabase, connectionId);
  if (!realmId) throw new Error("QuickBooks realmId not found on connection");

  const results: SyncResult[] = [];

  if (pushAllowed) {
    // ── Push Clients ──
    // ... existing push-clients block unchanged ...
    // ── Push Invoices / Estimates / Payments blocks unchanged ...
  }

  if (pullAllowed) {
    // ── Pull Clients ──
    // ── Pull Invoices ──
    // ... existing pull blocks unchanged ...
  }

  return results;
}
```

> Concretely: wrap lines 38–166 (the four QB push blocks) in `if (pushAllowed) { ... }` and lines 168–232 (the two QB pull blocks) in `if (pullAllowed) { ... }`. Do the same for the Sage push blocks and Sage pull blocks. Do not change the block bodies.

Then update the public entry point:

```ts
export async function runSyncForConnection(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
  connectionId: string,
  lastSyncAt: string | null,
  syncDirection: "pull_only" | "push_only" | "bidirectional" = "bidirectional"
): Promise<{ success: boolean; results: SyncResult[]; message: string }> {
  // ── Direction guard (read-only safety core, contract §6) ──────────────────
  // pull_only  → never push to the provider.
  // push_only  → never pull from the provider.
  const pushAllowed = syncDirection !== "pull_only";
  const pullAllowed = syncDirection !== "push_only";

  let results: SyncResult[];

  if (provider === "quickbooks") {
    results = await syncQuickBooks(supabase, companyId, connectionId, lastSyncAt, pushAllowed, pullAllowed);
  } else if (provider === "sage") {
    results = await syncSage(supabase, companyId, connectionId, lastSyncAt, pushAllowed, pullAllowed);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  // ... logging + last_sync_at update + return unchanged ...
}
```

- [ ] **Step 4: Run — expect PASS.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/services/sync-orchestrator-pull-only.test.ts
```
Expected: PASS (2 passing).

- [ ] **Step 5: Commit.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/sync-orchestrator.ts tests/unit/services/sync-orchestrator-pull-only.test.ts && git commit -m "feat(qbo-import): pull_only/push_only direction guard in sync-orchestrator"
```

---

### Task A3.7: `/api/sync` refuses `pull_only` connections (409) + passes `sync_direction` through

The legacy push-then-pull route must not run for a `pull_only` connection. Read `sync_direction` on the connection and 409 when `pull_only`; otherwise pass it to `runSyncForConnection`.

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/app/api/sync/route.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/integration/sync-route-pull-only-409.test.ts` (Create)

Steps:

- [ ] **Step 1: Write the failing test.**

```ts
// tests/integration/sync-route-pull-only-409.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verifyAdminAuth = vi.fn();
const findUserByAuth = vi.fn();
const runSyncForConnection = vi.fn();
const connSingle = vi.fn();

vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: (r: unknown) => verifyAdminAuth(r) }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: (...a: unknown[]) => findUserByAuth(...a) }));
vi.mock("@/lib/api/services/sync-orchestrator", () => ({
  runSyncForConnection: (...a: unknown[]) => runSyncForConnection(...a),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: () => connSingle() }) }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}));

const CO = "a612edc0-5c18-4c4d-af97-55b9410dd077";
function post(body: unknown) {
  return new Request("http://localhost/api/sync", { method: "POST", body: JSON.stringify(body) }) as never;
}

describe("POST /api/sync direction gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAdminAuth.mockResolvedValue({ uid: "fb-1", email: "o@x.test" });
    findUserByAuth.mockResolvedValue({ id: "user-1", company_id: CO });
    runSyncForConnection.mockResolvedValue({ success: true, results: [], message: "ok" });
  });

  it("409 when connection is pull_only", async () => {
    connSingle.mockResolvedValue({
      data: { id: "conn-1", is_connected: true, last_sync_at: null, sync_direction: "pull_only" },
      error: null,
    });
    const { POST } = await import("@/app/api/sync/route");
    const res = await POST(post({ companyId: CO, provider: "quickbooks" }));
    expect(res.status).toBe(409);
    expect(runSyncForConnection).not.toHaveBeenCalled();
  });

  it("runs and forwards sync_direction for bidirectional", async () => {
    connSingle.mockResolvedValue({
      data: { id: "conn-1", is_connected: true, last_sync_at: null, sync_direction: "bidirectional" },
      error: null,
    });
    const { POST } = await import("@/app/api/sync/route");
    const res = await POST(post({ companyId: CO, provider: "quickbooks" }));
    expect(res.status).toBe(200);
    expect(runSyncForConnection).toHaveBeenCalledWith(
      expect.anything(), CO, "quickbooks", "conn-1", null, "bidirectional"
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Route doesn't select `sync_direction`, doesn't 409, and calls `runSyncForConnection` with 5 args.
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/sync-route-pull-only-409.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Edit `/api/sync/route.ts`.** Add `sync_direction` to the connection select, the 409 gate, and the sixth arg.

Change the connection select (around line 58–63):
```ts
    const { data: connection, error: connError } = await supabase
      .from("accounting_connections")
      .select("id, is_connected, last_sync_at, sync_direction")
      .eq("company_id", companyId)
      .eq("provider", provider)
      .single();
```

Add the direction gate immediately after the `if (!connection.is_connected)` block (after line 77), before the sync `try`:
```ts
    if (connection.sync_direction === "pull_only") {
      return NextResponse.json(
        {
          error:
            "This connection is read-only (pull_only). Use the QuickBooks Import flow instead.",
        },
        { status: 409 }
      );
    }
```

Change the orchestrator call (line 80) to forward the direction:
```ts
      const result = await runSyncForConnection(
        supabase,
        companyId,
        provider,
        connection.id,
        connection.last_sync_at,
        (connection.sync_direction as "pull_only" | "push_only" | "bidirectional") ?? "bidirectional"
      );
```

- [ ] **Step 4: Run — expect PASS.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/sync-route-pull-only-409.test.ts
```
Expected: PASS (2 passing).

- [ ] **Step 5: Commit.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/app/api/sync/route.ts tests/integration/sync-route-pull-only-409.test.ts && git commit -m "feat(qbo-import): /api/sync refuses pull_only connections with 409"
```

---

### Task A3.8: OAuth callback sets `sync_direction='pull_only'` and `sync_enabled=false` on connect

On successful connect the connection must default to read-only with no auto-sync (contract §6.3 + §14.1).

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/app/api/integrations/quickbooks/callback/route.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/integration/qbo-callback-pull-only.test.ts` (Create)

Steps:

- [ ] **Step 1: Write the failing test.** Mock `fetch` (token exchange) and a Supabase double that captures the update payload; assert `sync_direction: "pull_only"` and `sync_enabled: false`.

```ts
// tests/integration/qbo-callback-pull-only.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateCapture = vi.fn();

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: () =>
        Promise.resolve({ data: { webhook_verifier_token: "CO:abc" }, error: null }) }) }) }),
      update: (payload: unknown) => {
        updateCapture(payload);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    }),
  }),
}));
vi.mock("@/lib/utils/app-url", () => ({ getAppUrl: () => "http://localhost" }));

describe("QuickBooks OAuth callback defaults to pull_only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QB_CLIENT_ID = "cid";
    process.env.QB_CLIENT_SECRET = "secret";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    })) as never);
  });

  it("stores sync_direction=pull_only and sync_enabled=false", async () => {
    const { GET } = await import("@/app/api/integrations/quickbooks/callback/route");
    const url = "http://localhost/api/integrations/quickbooks/callback?code=c&state=CO:abc&realmId=R1";
    await GET(new Request(url) as never);
    expect(updateCapture).toHaveBeenCalledTimes(1);
    const payload = updateCapture.mock.calls[0][0];
    expect(payload.sync_direction).toBe("pull_only");
    expect(payload.sync_enabled).toBe(false);
    expect(payload.is_connected).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Current callback sets `sync_enabled: true` and never sets `sync_direction`.
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/qbo-callback-pull-only.test.ts
```
Expected: FAIL — `sync_direction` is undefined / `sync_enabled` is true.

- [ ] **Step 3: Edit the callback update payload** (lines 103–115). Change `sync_enabled: true` → `false` and add `sync_direction: "pull_only"`:

```ts
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(
          Date.now() + (tokens.expires_in || 3600) * 1000
        ).toISOString(),
        realm_id: realmId,
        is_connected: true,
        sync_enabled: false,            // read-only validation phase: no auto-sync
        sync_direction: "pull_only",    // hard read-only mode (contract §6.3)
        webhook_verifier_token: null,
        updated_at: new Date().toISOString(),
      })
```

- [ ] **Step 4: Run — expect PASS.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/qbo-callback-pull-only.test.ts
```
Expected: PASS (1 passing).

- [ ] **Step 5: Commit.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/app/api/integrations/quickbooks/callback/route.ts tests/integration/qbo-callback-pull-only.test.ts && git commit -m "feat(qbo-import): connect defaults to pull_only + sync_enabled=false"
```

---

### Task A3.9: Full A3 suite green + lint sanity

**Files:** (no new files)

Steps:

- [ ] **Step 1: Run the entire A3 test surface together.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run \
  tests/unit/services/qbo-apply-types.test.ts \
  tests/unit/services/quickbooks-apply.test.ts \
  tests/unit/services/sync-orchestrator-pull-only.test.ts \
  tests/integration/qbo-import-route.test.ts \
  tests/integration/qbo-import-apply-route.test.ts \
  tests/integration/sync-route-pull-only-409.test.ts \
  tests/integration/qbo-callback-pull-only.test.ts
```
Expected: all suites PASS.

- [ ] **Step 2: Lint only the files A3 touched** (CI gates tests on `next lint`; keep A3 files clean even though pre-existing repo lint may be red — see project memory).
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx eslint \
  src/lib/api/services/quickbooks-import-service.ts \
  src/lib/types/qbo-import.ts \
  src/lib/api/services/sync-orchestrator.ts \
  src/app/api/integrations/quickbooks/import/route.ts \
  src/app/api/integrations/quickbooks/import/apply/route.ts \
  src/app/api/sync/route.ts \
  src/app/api/integrations/quickbooks/callback/route.ts
```
Expected: no errors on these files. Fix any A3-introduced lint before proceeding.

- [ ] **Step 3: Typecheck the A3 files.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx tsc --noEmit 2>&1 | grep -E "quickbooks-import-service|qbo-import|sync-orchestrator|quickbooks/import|api/sync/route|quickbooks/callback" || echo "no A3 type errors"
```
Expected: `no A3 type errors`.

- [ ] **Step 4: No commit needed** unless Step 2 required a lint fix; if it did, commit that single fix:
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add <fixed-file> && git commit -m "fix(qbo-import): resolve lint in A3 apply engine files"
```


## Phase A4 — Review UI (web) + reconciliation + apply

Phase **A4 — Review UI (web) + reconciliation + apply.** Builds the "QuickBooks Import" tab on `/accounting`: a TanStack-Query hook layer (`use-qbo-import.ts`), the tab component (`quickbooks-import-tab.tsx`) with a reconciliation strip, a customer-match review table (link/create/skip + confidence + candidate picker), per-section + global apply, and a notification-rail event on apply. Gated by `can('accounting.manage_connections')`. All strings via `useDictionary('accounting')`. Design-system tokens only; JetBrains Mono tabular numbers; em-dash for empty.

> **Dependency.** A4 consumes A1's `src/lib/types/qbo-import.ts` (`QboImportRun`, `QboCustomerMatch`, `MatchAction`, `QboImportReview`) and A1/A3's routes (`POST /api/integrations/quickbooks/import`, `GET …/import?runId=`, `POST …/import/apply`). A4 implements **no** routes or pull/apply logic — only the hook + UI over those contracts. Do not start A4 until A1's `qbo-import.ts` exists.
>
> **Copy note.** Every string added below is a **first-draft placeholder**. Before this phase is marked done, run `ops-copywriter` over the new `accounting.json` keys (`qbo.*`) and replace in place. Voice target: terse/tactical, sentence case for content, UPPERCASE for authority, em-dash (`—`) for empty, no exclamation points, no emoji.

---

### Task A4.1: Dictionary keys — `qbo.*` (en + es)

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/i18n/dictionaries/en/accounting.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/i18n/dictionaries/es/accounting.json`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/i18n/accounting-qbo-keys.test.ts` (Create)

- [ ] **Step 1: Write failing parity test.** Create `tests/unit/i18n/accounting-qbo-keys.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/accounting.json";
import es from "@/i18n/dictionaries/es/accounting.json";

const REQUIRED_QBO_KEYS = [
  "tabs.import",
  "qbo.title",
  "qbo.readOnlyNote",
  "qbo.pull",
  "qbo.pulling",
  "qbo.lastPulled",
  "qbo.never",
  "qbo.notConnected",
  "qbo.connectFirst",
  "qbo.writeCalls",
  "qbo.writeCallsOk",
  "qbo.writeCallsFail",
  "qbo.recon.title",
  "qbo.recon.quickbooks",
  "qbo.recon.ops",
  "qbo.recon.openAr",
  "qbo.recon.openInvoices",
  "qbo.recon.collected24mo",
  "qbo.recon.customers",
  "qbo.recon.matched",
  "qbo.recon.delta",
  "qbo.customers.title",
  "qbo.customers.action",
  "qbo.customers.basis",
  "qbo.customers.confidence",
  "qbo.customers.match",
  "qbo.action.link",
  "qbo.action.create",
  "qbo.action.skip",
  "qbo.action.needs_review",
  "qbo.basis.email",
  "qbo.basis.name_exact",
  "qbo.basis.name_fuzzy",
  "qbo.basis.none",
  "qbo.confidence.high",
  "qbo.confidence.medium",
  "qbo.confidence.low",
  "qbo.candidate.pick",
  "qbo.candidate.none",
  "qbo.records.title",
  "qbo.records.estimates",
  "qbo.records.invoices",
  "qbo.records.payments",
  "qbo.records.lineItems",
  "qbo.records.skippedInvoices",
  "qbo.records.orphanPayments",
  "qbo.apply.customers",
  "qbo.apply.all",
  "qbo.apply.applying",
  "qbo.applied",
  "qbo.applyConfirm",
  "qbo.empty.noRun",
  "qbo.empty.startPrompt",
  "qbo.error",
  "qbo.notify.title",
  "qbo.notify.body",
  "qbo.notify.action",
];

describe("accounting dictionary qbo keys", () => {
  it("en has every qbo key", () => {
    for (const k of REQUIRED_QBO_KEYS) {
      expect(en, `missing en key ${k}`).toHaveProperty([k]);
    }
  });
  it("es mirrors en exactly (no missing/extra keys)", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run tests/unit/i18n/accounting-qbo-keys.test.ts` → FAIL (`missing en key tabs.import`).
- [ ] **Step 3: Add keys to `en/accounting.json`.** Insert after the `"tabs.integrations": "Integrations",` line, and add the `qbo.*` block before the closing `}` (placeholder copy — run `ops-copywriter` later):
```jsonc
  "tabs.import": "QuickBooks Import",

  "qbo.title": "QuickBooks Import",
  "qbo.readOnlyNote": "Read-only — nothing is sent to QuickBooks.",
  "qbo.pull": "PULL FROM QUICKBOOKS",
  "qbo.pulling": "Pulling…",
  "qbo.lastPulled": "Last pulled",
  "qbo.never": "—",
  "qbo.notConnected": "QuickBooks is not connected.",
  "qbo.connectFirst": "Connect QuickBooks on the Integrations tab first.",
  "qbo.writeCalls": "QuickBooks writes",
  "qbo.writeCallsOk": "0 — read-only confirmed",
  "qbo.writeCallsFail": "{count} — read-only breach",
  "qbo.recon.title": "Reconciliation",
  "qbo.recon.quickbooks": "QUICKBOOKS",
  "qbo.recon.ops": "OPS AFTER IMPORT",
  "qbo.recon.openAr": "Open A/R",
  "qbo.recon.openInvoices": "Open invoices",
  "qbo.recon.collected24mo": "Collected (24 mo)",
  "qbo.recon.customers": "Customers",
  "qbo.recon.matched": "Matched to clients",
  "qbo.recon.delta": "Delta",
  "qbo.customers.title": "Customers",
  "qbo.customers.action": "ACTION",
  "qbo.customers.basis": "MATCH",
  "qbo.customers.confidence": "CONFIDENCE",
  "qbo.customers.match": "OPS CLIENT",
  "qbo.action.link": "Link",
  "qbo.action.create": "Create",
  "qbo.action.skip": "Skip",
  "qbo.action.needs_review": "Needs review",
  "qbo.basis.email": "Email",
  "qbo.basis.name_exact": "Name",
  "qbo.basis.name_fuzzy": "Name (fuzzy)",
  "qbo.basis.none": "—",
  "qbo.confidence.high": "High",
  "qbo.confidence.medium": "Medium",
  "qbo.confidence.low": "Low",
  "qbo.candidate.pick": "Pick client",
  "qbo.candidate.none": "Create new",
  "qbo.records.title": "Records to import",
  "qbo.records.estimates": "Estimates",
  "qbo.records.invoices": "Invoices",
  "qbo.records.payments": "Payments",
  "qbo.records.lineItems": "Line items",
  "qbo.records.skippedInvoices": "Skipped (void / zero)",
  "qbo.records.orphanPayments": "Unlinked payments",
  "qbo.apply.customers": "APPLY CUSTOMERS",
  "qbo.apply.all": "APPLY TO OPS",
  "qbo.apply.applying": "Applying…",
  "qbo.applied": "Imported {count} records into OPS.",
  "qbo.applyConfirm": "Write {customers} clients, {invoices} invoices, {payments} payments to OPS. QuickBooks is untouched.",
  "qbo.empty.noRun": "No import yet",
  "qbo.empty.startPrompt": "Pull from QuickBooks to stage a dry-run review.",
  "qbo.error": "Import failed",
  "qbo.notify.title": "QuickBooks import complete",
  "qbo.notify.body": "{count} records imported. A/R and cash now reflect QuickBooks.",
  "qbo.notify.action": "View Books"
```
- [ ] **Step 4: Add mirrored keys to `es/accounting.json`.** Same key set, Spanish placeholder values:
```jsonc
  "tabs.import": "Importar de QuickBooks",

  "qbo.title": "Importar de QuickBooks",
  "qbo.readOnlyNote": "Solo lectura — no se envía nada a QuickBooks.",
  "qbo.pull": "TRAER DE QUICKBOOKS",
  "qbo.pulling": "Trayendo…",
  "qbo.lastPulled": "Última extracción",
  "qbo.never": "—",
  "qbo.notConnected": "QuickBooks no está conectado.",
  "qbo.connectFirst": "Conecta QuickBooks en la pestaña Integraciones primero.",
  "qbo.writeCalls": "Escrituras a QuickBooks",
  "qbo.writeCallsOk": "0 — solo lectura confirmado",
  "qbo.writeCallsFail": "{count} — violación de solo lectura",
  "qbo.recon.title": "Conciliación",
  "qbo.recon.quickbooks": "QUICKBOOKS",
  "qbo.recon.ops": "OPS TRAS IMPORTAR",
  "qbo.recon.openAr": "C×C abierto",
  "qbo.recon.openInvoices": "Facturas abiertas",
  "qbo.recon.collected24mo": "Cobrado (24 m)",
  "qbo.recon.customers": "Clientes",
  "qbo.recon.matched": "Vinculados a clientes",
  "qbo.recon.delta": "Diferencia",
  "qbo.customers.title": "Clientes",
  "qbo.customers.action": "ACCIÓN",
  "qbo.customers.basis": "COINCIDENCIA",
  "qbo.customers.confidence": "CONFIANZA",
  "qbo.customers.match": "CLIENTE OPS",
  "qbo.action.link": "Vincular",
  "qbo.action.create": "Crear",
  "qbo.action.skip": "Omitir",
  "qbo.action.needs_review": "Revisar",
  "qbo.basis.email": "Correo",
  "qbo.basis.name_exact": "Nombre",
  "qbo.basis.name_fuzzy": "Nombre (aprox.)",
  "qbo.basis.none": "—",
  "qbo.confidence.high": "Alta",
  "qbo.confidence.medium": "Media",
  "qbo.confidence.low": "Baja",
  "qbo.candidate.pick": "Elegir cliente",
  "qbo.candidate.none": "Crear nuevo",
  "qbo.records.title": "Registros a importar",
  "qbo.records.estimates": "Cotizaciones",
  "qbo.records.invoices": "Facturas",
  "qbo.records.payments": "Pagos",
  "qbo.records.lineItems": "Líneas de detalle",
  "qbo.records.skippedInvoices": "Omitidas (anuladas / cero)",
  "qbo.records.orphanPayments": "Pagos sin vincular",
  "qbo.apply.customers": "APLICAR CLIENTES",
  "qbo.apply.all": "APLICAR A OPS",
  "qbo.apply.applying": "Aplicando…",
  "qbo.applied": "Se importaron {count} registros a OPS.",
  "qbo.applyConfirm": "Escribir {customers} clientes, {invoices} facturas, {payments} pagos en OPS. QuickBooks no se modifica.",
  "qbo.empty.noRun": "Sin importación aún",
  "qbo.empty.startPrompt": "Trae de QuickBooks para preparar una revisión de prueba.",
  "qbo.error": "La importación falló",
  "qbo.notify.title": "Importación de QuickBooks completa",
  "qbo.notify.body": "{count} registros importados. C×C y caja reflejan QuickBooks.",
  "qbo.notify.action": "Ver Libros"
```
- [ ] **Step 5: Run — expect PASS.** `npx vitest run tests/unit/i18n/accounting-qbo-keys.test.ts` → PASS (both tests green).
- [ ] **Step 6: Commit.** `git add src/i18n/dictionaries/en/accounting.json src/i18n/dictionaries/es/accounting.json tests/unit/i18n/accounting-qbo-keys.test.ts && git commit -m "feat(accounting): add qbo import dictionary keys (en/es)"`

---

### Task A4.2: `use-qbo-import.ts` hook — start / review / apply

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/hooks/use-qbo-import.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/query-client.ts`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/hooks/index.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/hooks/use-qbo-import.test.tsx` (Create)

- [ ] **Step 1: Add query keys.** In `query-client.ts`, inside the `accounting` key object (after `syncHistory`), add the import-run keys:
```ts
    importRun: (companyId: string) =>
      [...queryKeys.accounting.all, "importRun", companyId] as const,
    importReview: (runId: string) =>
      [...queryKeys.accounting.all, "importReview", runId] as const,
```
- [ ] **Step 2: Write failing hook test.** Create `tests/unit/hooks/use-qbo-import.test.tsx`. Mock `fetch`, the firebase token, and the notify hook; assert `useStartImport` POSTs to `/api/integrations/quickbooks/import` and returns `{ runId }`, `useImportReview(runId)` GETs `…/import?runId=`, and `useApplyImport` POSTs decisions to `…/import/apply` then fires a notification.
```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn();
vi.mock("@/lib/hooks/use-notifications", () => ({
  useCreateNotification: () => notify,
}));
vi.mock("@/lib/firebase/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-jwt"),
}));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars
        ? Object.entries(vars).reduce(
            (s, [k, v]) => s.replace(`{${k}}`, String(v)),
            key
          )
        : key,
  }),
}));

import {
  useStartImport,
  useImportReview,
  useApplyImport,
} from "@/lib/hooks/use-qbo-import";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const fetchMock = vi.fn();

beforeEach(() => {
  notify.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStartImport", () => {
  it("POSTs to the import route with the company id and Firebase bearer", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ runId: "run-1" }),
    });
    const { result } = renderHook(() => useStartImport(), { wrapper });
    const res = await result.current.mutateAsync({ companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077" });
    expect(res).toEqual({ runId: "run-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/integrations/quickbooks/import");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    expect(JSON.parse(init.body)).toEqual({
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
    });
  });
});

describe("useImportReview", () => {
  it("GETs the review by runId and returns the payload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ run: { id: "run-1", status: "staged" } }),
    });
    const { result } = renderHook(() => useImportReview("run-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/integrations/quickbooks/import?runId=run-1"
    );
    expect(result.current.data?.run.id).toBe("run-1");
  });

  it("is disabled when runId is null", () => {
    const { result } = renderHook(() => useImportReview(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useApplyImport", () => {
  it("POSTs decisions then fires an apply notification", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ applied: { customers: 3, invoices: 5, payments: 2, estimates: 1, lineItems: 12 } }),
    });
    const { result } = renderHook(() => useApplyImport(), { wrapper });
    const res = await result.current.mutateAsync({
      runId: "run-1",
      decisions: [{ customer_qb_id: "QB1", action: "link", client_id: "c-1" }],
    });
    expect(res.applied.customers).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/integrations/quickbooks/import/apply");
    expect(JSON.parse(init.body)).toEqual({
      runId: "run-1",
      decisions: [{ customer_qb_id: "QB1", action: "link", client_id: "c-1" }],
    });
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "system",
        actionUrl: "/accounting?tab=dashboard",
        persistent: false,
      })
    );
  });
});
```
- [ ] **Step 3: Run — expect FAIL.** `npx vitest run tests/unit/hooks/use-qbo-import.test.tsx` → FAIL (cannot resolve `@/lib/hooks/use-qbo-import`).
- [ ] **Step 4: Implement the hook.** Create `src/lib/hooks/use-qbo-import.ts` (mirrors `accounting-service.ts` Firebase-bearer fetch pattern + `use-gmail-import.ts` notify pattern; review/apply types come from A1's `qbo-import.ts`):
```ts
/**
 * OPS Web - QuickBooks Import Hooks (read-only sync, dry-run review + apply)
 *
 * TanStack Query hooks over the A1/A3 import routes:
 *   POST /api/integrations/quickbooks/import           → start run + pull + stage + match → { runId }
 *   GET  /api/integrations/quickbooks/import?runId=…    → QboImportReview
 *   POST /api/integrations/quickbooks/import/apply      → { applied: counts }
 *
 * No write ever reaches QuickBooks. apply writes only to OPS tables (handled server-side).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { useCreateNotification } from "./use-notifications";
import { useDictionary } from "@/i18n/client";
import type {
  MatchAction,
  QboImportReview,
} from "../types/qbo-import";

// ─── Apply payload ──────────────────────────────────────────────────────────

export interface ApplyDecision {
  customer_qb_id: string;
  action: MatchAction;
  client_id?: string;
}

export interface ApplyResult {
  applied: {
    customers: number;
    estimates: number;
    invoices: number;
    payments: number;
    lineItems: number;
  };
}

// ─── Auth'd fetch (Firebase JWT, matches AccountingService) ───────────────────

async function authedFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const idToken = await getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
  });
}

// ─── Start a run (pull → stage → compute matches) ─────────────────────────────

export function useStartImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      companyId,
    }: {
      companyId: string;
    }): Promise<{ runId: string }> => {
      const res = await authedFetch("/api/integrations/quickbooks/import", {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "QuickBooks pull failed");
      }
      return res.json();
    },
    onSuccess: (_data, { companyId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.importRun(companyId),
      });
    },
  });
}

// ─── Fetch the staged review for a run ────────────────────────────────────────

export function useImportReview(runId: string | null) {
  return useQuery({
    queryKey: queryKeys.accounting.importReview(runId ?? "none"),
    queryFn: async (): Promise<QboImportReview> => {
      const res = await authedFetch(
        `/api/integrations/quickbooks/import?runId=${runId}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to load import review");
      }
      return res.json();
    },
    enabled: !!runId,
  });
}

// ─── Apply approved decisions, then fire the notification-rail event ──────────

export function useApplyImport() {
  const queryClient = useQueryClient();
  const notify = useCreateNotification();
  const { t } = useDictionary("accounting");

  return useMutation({
    mutationFn: async ({
      runId,
      decisions,
    }: {
      runId: string;
      decisions: ApplyDecision[];
    }): Promise<ApplyResult> => {
      const res = await authedFetch(
        "/api/integrations/quickbooks/import/apply",
        {
          method: "POST",
          body: JSON.stringify({ runId, decisions }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Apply failed");
      }
      return res.json();
    },
    onSuccess: (data, { runId }) => {
      const a = data.applied;
      const total =
        a.customers + a.estimates + a.invoices + a.payments + a.lineItems;

      // Notification-rail event (read-only import landed). No QB-specific
      // NotificationType exists in the DB enum, so use the generic 'system'
      // type; the web Books/A-R surface is the click-through target.
      notify({
        type: "system",
        title: t("qbo.notify.title"),
        body: t("qbo.notify.body", { count: total }),
        actionUrl: "/accounting?tab=dashboard",
        actionLabel: t("qbo.notify.action"),
        persistent: false,
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.importReview(runId),
      });
      // Imported $ now lives in clients/invoices/payments — refresh the dash.
      queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
    },
  });
}
```
- [ ] **Step 5: Re-export from the hooks barrel.** In `src/lib/hooks/index.ts`, add `export * from "./use-qbo-import";` next to the other accounting exports.
- [ ] **Step 6: Run — expect PASS.** `npx vitest run tests/unit/hooks/use-qbo-import.test.tsx` → PASS (4 tests: start POST, review GET, review disabled, apply + notify).
- [ ] **Step 7: Commit.** `git add src/lib/hooks/use-qbo-import.ts src/lib/api/query-client.ts src/lib/hooks/index.ts tests/unit/hooks/use-qbo-import.test.tsx && git commit -m "feat(accounting): add use-qbo-import hooks (start/review/apply + rail event)"`

---

### Task A4.3: `ReconciliationStrip` — QuickBooks vs OPS totals (green when matched)

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/components/accounting/qbo/reconciliation-strip.tsx`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/components/qbo-reconciliation-strip.test.tsx` (Create)

- [ ] **Step 1: Write failing test.** Create `tests/unit/components/qbo-reconciliation-strip.test.tsx`. Mock `useDictionary` (key passthrough); assert a matched row (qb === ops to the cent) carries the success token class and an em-dash for a null delta, and a mismatched row carries the brick/error token.
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

import { ReconciliationStrip } from "@/components/accounting/qbo/reconciliation-strip";

const recon = {
  qbOpenAr: 12000,
  opsOpenAr: 12000,
  qbCollected24mo: 80000,
  opsCollected: 79500,
  qbCustomerCount: 10,
  opsMatchedCount: 10,
};

describe("ReconciliationStrip", () => {
  it("marks a to-the-cent A/R match as success", () => {
    render(<ReconciliationStrip recon={recon} />);
    const arRow = screen.getByTestId("recon-row-openAr");
    expect(arRow).toHaveClass("text-status-success");
  });

  it("marks a non-matching collected row as a delta breach", () => {
    render(<ReconciliationStrip recon={recon} />);
    const row = screen.getByTestId("recon-row-collected24mo");
    expect(row).toHaveClass("text-[#B58289]");
    expect(screen.getByTestId("recon-delta-collected24mo").textContent).toContain(
      "$500.00"
    );
  });

  it("renders an em-dash delta when matched", () => {
    render(<ReconciliationStrip recon={recon} />);
    expect(screen.getByTestId("recon-delta-openAr").textContent).toBe("—");
  });
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run tests/unit/components/qbo-reconciliation-strip.test.tsx` → FAIL (module not found).
- [ ] **Step 3: Implement `ReconciliationStrip`.** Create `src/components/accounting/qbo/reconciliation-strip.tsx`. Currency via `formatCurrency`, counts as plain mono tabular numbers; rows green when equal (cent-equality on money, exact on counts), brick `#B58289` when not:
```tsx
"use client";

import { useDictionary } from "@/i18n/client";
import { formatCurrency } from "@/lib/types/pipeline";
import { cn } from "@/lib/utils/cn";
import type { QboImportReview } from "@/lib/types/qbo-import";

type Recon = QboImportReview["reconciliation"];

// money equality to the cent (avoids float dust)
function moneyEq(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

interface RowSpec {
  id: string;
  labelKey: string;
  qb: number;
  ops: number;
  kind: "money" | "count";
}

function ReconRow({
  spec,
  t,
}: {
  spec: RowSpec;
  t: (k: string) => string;
}) {
  const matched =
    spec.kind === "money"
      ? moneyEq(spec.qb, spec.ops)
      : spec.qb === spec.ops;
  const delta = spec.ops - spec.qb;
  const fmt = (n: number) =>
    spec.kind === "money" ? formatCurrency(n) : String(n);

  return (
    <div
      data-testid={`recon-row-${spec.id}`}
      className={cn(
        "grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-1.5 py-1 rounded",
        "font-mono text-data-sm tabular-nums",
        matched ? "text-status-success" : "text-[#B58289]"
      )}
    >
      <span className="text-text-3 uppercase tracking-wider text-caption-sm">
        {t(spec.labelKey)}
      </span>
      <span className="text-right tabular-nums">{fmt(spec.qb)}</span>
      <span className="text-right tabular-nums">{fmt(spec.ops)}</span>
      <span
        data-testid={`recon-delta-${spec.id}`}
        className="text-right tabular-nums w-[80px]"
      >
        {matched ? "—" : fmt(Math.abs(delta))}
      </span>
    </div>
  );
}

export function ReconciliationStrip({ recon }: { recon: Recon }) {
  const { t } = useDictionary("accounting");

  const rows: RowSpec[] = [
    {
      id: "openAr",
      labelKey: "qbo.recon.openAr",
      qb: recon.qbOpenAr,
      ops: recon.opsOpenAr,
      kind: "money",
    },
    {
      id: "collected24mo",
      labelKey: "qbo.recon.collected24mo",
      qb: recon.qbCollected24mo,
      ops: recon.opsCollected,
      kind: "money",
    },
    {
      id: "customers",
      labelKey: "qbo.recon.customers",
      qb: recon.qbCustomerCount,
      ops: recon.opsMatchedCount,
      kind: "count",
    },
  ];

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-1.5 pb-0.5 border-b border-border">
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
          {t("qbo.recon.title")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right">
          {t("qbo.recon.quickbooks")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right">
          {t("qbo.recon.ops")}
        </span>
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider text-right w-[80px]">
          {t("qbo.recon.delta")}
        </span>
      </div>
      {rows.map((spec) => (
        <ReconRow key={spec.id} spec={spec} t={t} />
      ))}
    </div>
  );
}
```
- [ ] **Step 4: Run — expect PASS.** `npx vitest run tests/unit/components/qbo-reconciliation-strip.test.tsx` → PASS (3 tests).
- [ ] **Step 5: Commit.** `git add src/components/accounting/qbo/reconciliation-strip.tsx tests/unit/components/qbo-reconciliation-strip.test.tsx && git commit -m "feat(accounting): add qbo reconciliation strip (qb vs ops, green when matched)"`

---

### Task A4.4: `CustomerMatchTable` — link/create/skip + confidence + candidate picker

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/components/accounting/qbo/customer-match-table.tsx`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/components/qbo-customer-match-table.test.tsx` (Create)

- [ ] **Step 1: Write failing test.** Create `tests/unit/components/qbo-customer-match-table.test.tsx`. Verify it renders one row per match, shows confidence + basis labels, lets the user override action (calls `onDecisionChange`), and surfaces the candidate picker when action is `link`/`needs_review`.
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

import { CustomerMatchTable } from "@/components/accounting/qbo/customer-match-table";
import type { QboCustomerMatch } from "@/lib/types/qbo-import";

const matches: QboCustomerMatch[] = [
  {
    id: "m1",
    runId: "run-1",
    companyId: "co",
    customerQbId: "QB1",
    displayName: "Acme Decks",
    proposedAction: "link",
    matchedClientId: "c-1",
    matchBasis: "email",
    confidence: "high",
    candidates: [
      { clientId: "c-1", name: "Acme Decks", email: "a@acme.test", similarity: 1 },
    ],
    decidedAction: null,
    decidedClientId: null,
  },
  {
    id: "m2",
    runId: "run-1",
    companyId: "co",
    customerQbId: "QB2",
    displayName: "New Guy",
    proposedAction: "create",
    matchedClientId: null,
    matchBasis: "none",
    confidence: "low",
    candidates: [],
    decidedAction: null,
    decidedClientId: null,
  },
];

describe("CustomerMatchTable", () => {
  it("renders one row per match with confidence + basis", () => {
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={vi.fn()} />
    );
    expect(screen.getByText("Acme Decks")).toBeInTheDocument();
    expect(screen.getByText("New Guy")).toBeInTheDocument();
    expect(screen.getByTestId("match-confidence-QB1").textContent).toContain(
      "qbo.confidence.high"
    );
    expect(screen.getByTestId("match-basis-QB1").textContent).toContain(
      "qbo.basis.email"
    );
  });

  it("emits a decision change when an action is picked", () => {
    const onChange = vi.fn();
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={onChange} />
    );
    fireEvent.change(screen.getByTestId("match-action-QB2"), {
      target: { value: "skip" },
    });
    expect(onChange).toHaveBeenCalledWith("QB2", { action: "skip", client_id: undefined });
  });

  it("shows the candidate picker for link rows", () => {
    render(
      <CustomerMatchTable matches={matches} decisions={{}} onDecisionChange={vi.fn()} />
    );
    expect(screen.getByTestId("match-candidate-QB1")).toBeInTheDocument();
    expect(screen.queryByTestId("match-candidate-QB2")).not.toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run tests/unit/components/qbo-customer-match-table.test.tsx` → FAIL (module not found).
- [ ] **Step 3: Implement `CustomerMatchTable`.** Create `src/components/accounting/qbo/customer-match-table.tsx`. The current decision for a row resolves as `decisions[qbId] ?? { action: proposedAction, client_id: matchedClientId }`. Native `<select>` styled with tokens (no touch surface, so dropdowns are fine per the OPS-Web design rules):
```tsx
"use client";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { MatchAction, QboCustomerMatch } from "@/lib/types/qbo-import";

export interface RowDecision {
  action: MatchAction;
  client_id?: string;
}

const ACTIONS: MatchAction[] = ["link", "create", "skip", "needs_review"];

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "text-status-success",
  medium: "text-[#C4A868]",
  low: "text-[#B58289]",
};

function resolveDecision(
  m: QboCustomerMatch,
  decisions: Record<string, RowDecision>
): RowDecision {
  return (
    decisions[m.customerQbId] ?? {
      action: m.proposedAction,
      client_id: m.matchedClientId ?? undefined,
    }
  );
}

export function CustomerMatchTable({
  matches,
  decisions,
  onDecisionChange,
}: {
  matches: QboCustomerMatch[];
  decisions: Record<string, RowDecision>;
  onDecisionChange: (qbId: string, decision: RowDecision) => void;
}) {
  const { t } = useDictionary("accounting");

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.title")}
            </th>
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.basis")}
            </th>
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.confidence")}
            </th>
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.action")}
            </th>
            <th className="text-left font-mono text-micro text-text-mute uppercase tracking-wider px-1.5 py-1">
              {t("qbo.customers.match")}
            </th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const decision = resolveDecision(m, decisions);
            const showPicker =
              decision.action === "link" || decision.action === "needs_review";
            return (
              <tr
                key={m.customerQbId}
                className="border-b border-border last:border-0 hover:bg-[rgba(255,255,255,0.02)]"
              >
                <td className="px-1.5 py-1 font-mono text-caption text-text-2 truncate max-w-[220px]">
                  {m.displayName || "—"}
                </td>
                <td
                  data-testid={`match-basis-${m.customerQbId}`}
                  className="px-1.5 py-1 font-mono text-caption-sm text-text-3"
                >
                  {t(`qbo.basis.${m.matchBasis ?? "none"}`)}
                </td>
                <td
                  data-testid={`match-confidence-${m.customerQbId}`}
                  className={cn(
                    "px-1.5 py-1 font-mono text-caption-sm uppercase tracking-wider",
                    m.confidence ? CONFIDENCE_COLOR[m.confidence] : "text-text-mute"
                  )}
                >
                  {m.confidence ? t(`qbo.confidence.${m.confidence}`) : "—"}
                </td>
                <td className="px-1.5 py-1">
                  <select
                    data-testid={`match-action-${m.customerQbId}`}
                    value={decision.action}
                    onChange={(e) =>
                      onDecisionChange(m.customerQbId, {
                        action: e.target.value as MatchAction,
                        client_id:
                          e.target.value === "link" ||
                          e.target.value === "needs_review"
                            ? decision.client_id
                            : undefined,
                      })
                    }
                    className="h-[36px] rounded-btn bg-[rgba(255,255,255,0.04)] border border-border px-2 font-mono text-caption text-text-2 focus:border-ops-accent focus:outline-none"
                  >
                    {ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {t(`qbo.action.${a}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1.5 py-1">
                  {showPicker ? (
                    <select
                      data-testid={`match-candidate-${m.customerQbId}`}
                      value={decision.client_id ?? ""}
                      onChange={(e) =>
                        onDecisionChange(m.customerQbId, {
                          action: decision.action,
                          client_id: e.target.value || undefined,
                        })
                      }
                      className="h-[36px] rounded-btn bg-[rgba(255,255,255,0.04)] border border-border px-2 font-mono text-caption text-text-2 focus:border-ops-accent focus:outline-none max-w-[220px]"
                    >
                      <option value="">{t("qbo.candidate.none")}</option>
                      {m.candidates.map((c) => (
                        <option key={c.clientId} value={c.clientId}>
                          {c.name}
                          {c.email ? ` · ${c.email}` : ""}
                          {typeof c.similarity === "number"
                            ? ` · ${Math.round(c.similarity * 100)}%`
                            : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-mono text-caption-sm text-text-mute">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```
- [ ] **Step 4: Run — expect PASS.** `npx vitest run tests/unit/components/qbo-customer-match-table.test.tsx` → PASS (3 tests).
- [ ] **Step 5: Commit.** `git add src/components/accounting/qbo/customer-match-table.tsx tests/unit/components/qbo-customer-match-table.test.tsx && git commit -m "feat(accounting): add qbo customer-match review table (link/create/skip + candidates)"`

---

### Task A4.5: `quickbooks-import-tab.tsx` — pull header, records strip, apply flow

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/components/accounting/qbo/quickbooks-import-tab.tsx`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/components/quickbooks-import-tab.test.tsx` (Create)

- [ ] **Step 1: Write failing test.** Create `tests/unit/components/quickbooks-import-tab.test.tsx`. Mock the three qbo hooks + `useAuthStore` + `useDictionary` + `formatCurrency` passthrough. Cover: empty state (no run) shows the pull CTA; with a staged review it renders the recon strip + match table + records; clicking PULL calls `useStartImport.mutateAsync`; clicking APPLY calls `useApplyImport.mutateAsync` with assembled decisions; the read-only `qb_write_calls` badge shows the OK label at 0.
```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const startMutate = vi.fn().mockResolvedValue({ runId: "run-1" });
const applyMutate = vi.fn().mockResolvedValue({
  applied: { customers: 2, estimates: 0, invoices: 3, payments: 1, lineItems: 7 },
});
let reviewData: unknown = undefined;

vi.mock("@/lib/hooks/use-qbo-import", () => ({
  useStartImport: () => ({ mutateAsync: startMutate, isPending: false }),
  useImportReview: () => ({ data: reviewData, isLoading: false, isError: false }),
  useApplyImport: () => ({ mutateAsync: applyMutate, isPending: false }),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "a612edc0-5c18-4c4d-af97-55b9410dd077" } }),
}));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (k: string, vars?: Record<string, string | number>) =>
      vars
        ? Object.entries(vars).reduce((s, [kk, v]) => s.replace(`{${kk}}`, String(v)), k)
        : k,
  }),
  useLocale: () => ({ locale: "en" }),
}));

import { QuickBooksImportTab } from "@/components/accounting/qbo/quickbooks-import-tab";

const review = {
  run: { id: "run-1", status: "staged", qbWriteCalls: 0, lastPulledAt: null, error: null },
  matches: [
    {
      id: "m1", runId: "run-1", companyId: "co", customerQbId: "QB1",
      displayName: "Acme", proposedAction: "link", matchedClientId: "c-1",
      matchBasis: "email", confidence: "high",
      candidates: [{ clientId: "c-1", name: "Acme", email: null, similarity: 1 }],
      decidedAction: null, decidedClientId: null,
    },
  ],
  counts: {
    customers: { link: 1, create: 0, skip: 0, needsReview: 0 },
    estimates: 0, invoices: 3, payments: 1, lineItems: 7,
    skippedInvoices: 0, orphanPayments: 0,
  },
  reconciliation: {
    qbOpenAr: 100, opsOpenAr: 100, qbCollected24mo: 50, opsCollected: 50,
    qbCustomerCount: 1, opsMatchedCount: 1,
  },
};

describe("QuickBooksImportTab", () => {
  it("shows the empty state with a pull CTA when there is no run", () => {
    reviewData = undefined;
    render(<QuickBooksImportTab />);
    expect(screen.getByText("qbo.empty.noRun")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qbo.pull/ })).toBeInTheDocument();
  });

  it("starts a pull when the CTA is clicked", async () => {
    reviewData = undefined;
    render(<QuickBooksImportTab />);
    fireEvent.click(screen.getByRole("button", { name: /qbo.pull/ }));
    await waitFor(() =>
      expect(startMutate).toHaveBeenCalledWith({
        companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      })
    );
  });

  it("renders recon + matches + records and applies decisions", async () => {
    reviewData = review;
    render(<QuickBooksImportTab />);
    expect(screen.getByTestId("recon-row-openAr")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByTestId("match-action-QB1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /qbo.apply.all/ }));
    await waitFor(() =>
      expect(applyMutate).toHaveBeenCalledWith({
        runId: "run-1",
        decisions: [{ customer_qb_id: "QB1", action: "link", client_id: "c-1" }],
      })
    );
  });

  it("shows the read-only write-call badge as OK at zero", () => {
    reviewData = review;
    render(<QuickBooksImportTab />);
    expect(screen.getByTestId("qbo-write-calls").textContent).toContain(
      "qbo.writeCallsOk"
    );
  });
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run tests/unit/components/quickbooks-import-tab.test.tsx` → FAIL (module not found).
- [ ] **Step 3: Implement `QuickBooksImportTab`.** Create `src/components/accounting/qbo/quickbooks-import-tab.tsx`. Owns `runId` + `decisions` state, fans the review into the recon strip, match table, and a records grid; assembles decisions for apply (every match → its resolved decision, dropping `needs_review` rows that still have no client). Uses `Card`/`Button` primitives + lucide icons:
```tsx
"use client";

import { useMemo, useState } from "react";
import { DownloadCloud, Loader2, ShieldCheck, ShieldAlert, AlertCircle } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useStartImport,
  useImportReview,
  useApplyImport,
  type ApplyDecision,
} from "@/lib/hooks/use-qbo-import";
import { ReconciliationStrip } from "./reconciliation-strip";
import { CustomerMatchTable, type RowDecision } from "./customer-match-table";

function RecordStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 p-1.5 rounded bg-[rgba(255,255,255,0.02)] border border-border">
      <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
        {label}
      </span>
      <span className="font-mono text-data text-text tabular-nums">{value}</span>
    </div>
  );
}

export function QuickBooksImportTab() {
  const { t } = useDictionary("accounting");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const [runId, setRunId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});

  const startImport = useStartImport();
  const applyImport = useApplyImport();
  const { data: review, isLoading, isError } = useImportReview(runId);

  const handlePull = async () => {
    if (!companyId) return;
    setDecisions({});
    const res = await startImport.mutateAsync({ companyId });
    setRunId(res.runId);
  };

  const handleDecisionChange = (qbId: string, decision: RowDecision) => {
    setDecisions((prev) => ({ ...prev, [qbId]: decision }));
  };

  // Assemble the apply payload from every staged match's resolved decision.
  const applyDecisions: ApplyDecision[] = useMemo(() => {
    if (!review) return [];
    return review.matches.map((m) => {
      const d =
        decisions[m.customerQbId] ?? {
          action: m.proposedAction,
          client_id: m.matchedClientId ?? undefined,
        };
      return {
        customer_qb_id: m.customerQbId,
        action: d.action,
        client_id: d.client_id,
      };
    });
  }, [review, decisions]);

  const handleApply = async () => {
    if (!runId) return;
    await applyImport.mutateAsync({ runId, decisions: applyDecisions });
  };

  const writeCalls = review?.run.qbWriteCalls ?? 0;
  const counts = review?.counts;
  const applied = review?.run.status === "applied";

  return (
    <div className="space-y-3">
      {/* Run header */}
      <Card variant="default" className="p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-mohave text-body-lg text-text uppercase tracking-wider">
              {t("qbo.title")}
            </h2>
            <p className="font-mono text-caption-sm text-text-3 mt-0.5">
              {t("qbo.readOnlyNote")}
            </p>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={handlePull}
            disabled={startImport.isPending || !companyId}
            className="gap-1"
          >
            {startImport.isPending ? (
              <Loader2 className="w-[14px] h-[14px] animate-spin" />
            ) : (
              <DownloadCloud className="w-[14px] h-[14px]" />
            )}
            {startImport.isPending ? t("qbo.pulling") : t("qbo.pull")}
          </Button>
        </div>

        {review && (
          <div
            data-testid="qbo-write-calls"
            className={cn(
              "flex items-center gap-1.5 font-mono text-caption-sm tabular-nums",
              writeCalls === 0 ? "text-status-success" : "text-[#B58289]"
            )}
          >
            {writeCalls === 0 ? (
              <ShieldCheck className="w-[12px] h-[12px]" />
            ) : (
              <ShieldAlert className="w-[12px] h-[12px]" />
            )}
            <span className="uppercase tracking-wider text-micro text-text-mute">
              {t("qbo.writeCalls")}
            </span>
            <span>
              {writeCalls === 0
                ? t("qbo.writeCallsOk")
                : t("qbo.writeCallsFail", { count: writeCalls })}
            </span>
          </div>
        )}
      </Card>

      {/* Empty / loading / error */}
      {!runId && !startImport.isPending && (
        <Card variant="default" className="p-3">
          <p className="font-mohave text-body text-text uppercase tracking-wider">
            {t("qbo.empty.noRun")}
          </p>
          <p className="font-mono text-caption-sm text-text-mute mt-1">
            {t("qbo.empty.startPrompt")}
          </p>
        </Card>
      )}

      {runId && isLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-[20px] h-[20px] text-text-mute animate-spin" />
        </div>
      )}

      {runId && isError && (
        <Card variant="default" className="p-3 flex items-center gap-1.5">
          <AlertCircle className="w-[14px] h-[14px] text-[#B58289]" />
          <span className="font-mono text-caption-sm text-[#B58289]">
            {t("qbo.error")}
          </span>
        </Card>
      )}

      {/* Review body */}
      {review && counts && (
        <>
          <Card variant="default" className="p-3 space-y-2">
            <ReconciliationStrip recon={review.reconciliation} />
          </Card>

          <Card variant="default" className="p-3 space-y-2">
            <h3 className="font-mohave text-body text-text uppercase tracking-wider">
              {t("qbo.records.title")}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <RecordStat label={t("qbo.records.estimates")} value={counts.estimates} />
              <RecordStat label={t("qbo.records.invoices")} value={counts.invoices} />
              <RecordStat label={t("qbo.records.payments")} value={counts.payments} />
              <RecordStat label={t("qbo.records.lineItems")} value={counts.lineItems} />
              <RecordStat
                label={t("qbo.records.skippedInvoices")}
                value={counts.skippedInvoices}
              />
              <RecordStat
                label={t("qbo.records.orphanPayments")}
                value={counts.orphanPayments}
              />
            </div>
          </Card>

          <Card variant="default" className="p-3 space-y-2">
            <h3 className="font-mohave text-body text-text uppercase tracking-wider">
              {t("qbo.customers.title")}
            </h3>
            <CustomerMatchTable
              matches={review.matches}
              decisions={decisions}
              onDecisionChange={handleDecisionChange}
            />
          </Card>

          {/* Apply */}
          <Card variant="default" className="p-3 space-y-2">
            <p className="font-mono text-caption-sm text-text-3">
              {t("qbo.applyConfirm", {
                customers: counts.customers.link + counts.customers.create,
                invoices: counts.invoices,
                payments: counts.payments,
              })}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={applyImport.isPending || applied}
                className="gap-1"
              >
                {applyImport.isPending && (
                  <Loader2 className="w-[14px] h-[14px] animate-spin" />
                )}
                {applyImport.isPending ? t("qbo.apply.applying") : t("qbo.apply.all")}
              </Button>
              {applied && (
                <span className="font-mono text-caption-sm text-status-success">
                  {t("qbo.applied", {
                    count:
                      counts.estimates +
                      counts.invoices +
                      counts.payments +
                      counts.lineItems +
                      counts.customers.link +
                      counts.customers.create,
                  })}
                </span>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
```
- [ ] **Step 4: Run — expect PASS.** `npx vitest run tests/unit/components/quickbooks-import-tab.test.tsx` → PASS (4 tests).
- [ ] **Step 5: Commit.** `git add src/components/accounting/qbo/quickbooks-import-tab.tsx tests/unit/components/quickbooks-import-tab.test.tsx && git commit -m "feat(accounting): add quickbooks import tab (pull/review/apply UI)"`

---

### Task A4.6: Wire the Import tab into `/accounting` (gated by `accounting.manage_connections`)

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/app/(dashboard)/accounting/page.tsx`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/components/accounting-page-import-tab.test.tsx` (Create)

- [ ] **Step 1: Write failing test.** Create `tests/unit/components/accounting-page-import-tab.test.tsx`. Mock the data hooks so the page renders, mock the permission store, and assert the Import tab button appears only with `accounting.manage_connections` and renders `QuickBooksImportTab` when selected. (Mock `QuickBooksImportTab` to a sentinel to keep the test focused on wiring.)
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/accounting/qbo/quickbooks-import-tab", () => ({
  QuickBooksImportTab: () => <div data-testid="qbo-import-tab">IMPORT</div>,
}));
vi.mock("@/components/expenses/expense-review-dashboard", () => ({
  ExpenseReviewDashboard: () => <div />,
}));
vi.mock("@/components/metrics", () => ({ MetricsHeader: () => <div /> }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/hooks/use-page-title", () => ({ usePageTitle: () => {} }));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/lib/hooks", () => ({
  useAccountingConnections: () => ({ data: [], isLoading: false }),
  useInitiateOAuth: () => ({ mutate: vi.fn() }),
  useDisconnectProvider: () => ({ mutate: vi.fn() }),
  useTriggerSync: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useSyncHistory: () => ({ data: [], isLoading: false }),
  useInvoices: () => ({ data: [] }),
  useClients: () => ({ data: { clients: [] } }),
  useAccountingMetrics: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co" } }),
}));

const canMock = vi.fn();
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (sel: (s: { can: (p: string) => boolean }) => unknown) =>
    sel({ can: canMock }),
}));

import AccountingPage from "@/app/(dashboard)/accounting/page";

describe("AccountingPage import tab", () => {
  it("hides the import tab without accounting.manage_connections", () => {
    canMock.mockReturnValue(false);
    render(<AccountingPage />);
    expect(screen.queryByText("tabs.import")).not.toBeInTheDocument();
  });

  it("shows and renders the import tab with the permission", () => {
    canMock.mockImplementation((p: string) => p === "accounting.manage_connections");
    render(<AccountingPage />);
    const tabBtn = screen.getByText("tabs.import");
    fireEvent.click(tabBtn);
    expect(screen.getByTestId("qbo-import-tab")).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run tests/unit/components/accounting-page-import-tab.test.tsx` → FAIL (`tabs.import` not found / `QuickBooksImportTab` not rendered).
- [ ] **Step 3: Wire the tab into the page.** In `page.tsx`:
  1. Extend the tab union: change `type TabValue = "dashboard" | "expenses" | "integrations";` to `type TabValue = "dashboard" | "expenses" | "integrations" | "import";`
  2. Import the component near the `ExpenseReviewDashboard` import:
```ts
import { QuickBooksImportTab } from "@/components/accounting/qbo/quickbooks-import-tab";
```
  3. Update the `initialTab` guard to accept `import`:
```ts
  const [activeTab, setActiveTab] = useState<TabValue>(
    initialTab === "expenses" ||
      initialTab === "integrations" ||
      initialTab === "import"
      ? initialTab
      : "dashboard"
  );
```
  4. Add the tab to the `tabs` memo array (after `integrations`), gated by the same permission:
```ts
      { value: "integrations", label: t("tabs.integrations"), show: can("accounting.manage_connections") },
      { value: "import", label: t("tabs.import"), show: can("accounting.manage_connections") },
```
  5. Render the panel after the Integrations block (before the page's closing `</div>`):
```tsx
      {/* QuickBooks Import Tab */}
      {activeTab === "import" && <QuickBooksImportTab />}
```
- [ ] **Step 4: Run — expect PASS.** `npx vitest run tests/unit/components/accounting-page-import-tab.test.tsx` → PASS (2 tests).
- [ ] **Step 5: Full-suite typecheck + regression.** Run the new + adjacent suites together and a typecheck:
  `npx vitest run tests/unit/i18n/accounting-qbo-keys.test.ts tests/unit/hooks/use-qbo-import.test.tsx tests/unit/components/qbo-reconciliation-strip.test.tsx tests/unit/components/qbo-customer-match-table.test.tsx tests/unit/components/quickbooks-import-tab.test.tsx tests/unit/components/accounting-page-import-tab.test.tsx` → all PASS;
  `npx tsc --noEmit` → no new errors in the touched files.
- [ ] **Step 6: Commit.** `git add src/app/(dashboard)/accounting/page.tsx tests/unit/components/accounting-page-import-tab.test.tsx && git commit -m "feat(accounting): wire quickbooks import tab into /accounting (perm-gated)"`

---

### Task A4.7: Final copy pass + design verification (no code change beyond strings)

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/i18n/dictionaries/en/accounting.json`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/i18n/dictionaries/es/accounting.json`

- [ ] **Step 1: Run `ops-copywriter` over the `qbo.*` keys.** Invoke the `ops-copywriter` skill with the full `qbo.*` block as context. Target voice: terse/tactical, sentence case for content, UPPERCASE for authority (`PULL FROM QUICKBOOKS`, `APPLY TO OPS`), em-dash for empty, no exclamation points, no emoji. Replace en values in place; do not change keys.
- [ ] **Step 2: Translate finalized en strings to es.** Update `es/accounting.json` so values match the finalized en intent and keys stay 1:1.
- [ ] **Step 3: Re-run the parity test — expect PASS.** `npx vitest run tests/unit/i18n/accounting-qbo-keys.test.ts` → PASS (parity intact; copy changes don't touch keys).
- [ ] **Step 4: Design-system self-check (read-only, no code change).** Confirm against `ops-design-system/project/DESIGN.md`: numbers use `font-mono tabular-nums` (recon + record stats + match similarity); empty values render `—`; no hardcoded hex outside the sanctioned earth-tone semantics already used elsewhere on this page (`#B58289` brick for error/low, `#C4A868` tan for medium — both already present in `page.tsx`); buttons use `min-h 36px` via `size="sm"`/`size="default"`; accent `#6F94B0` appears once (the primary `APPLY TO OPS` button). Fix any drift found, then re-run the affected suite.
- [ ] **Step 5: Commit.** `git add src/i18n/dictionaries/en/accounting.json src/i18n/dictionaries/es/accounting.json && git commit -m "docs(accounting): finalize qbo import copy via ops-copywriter (en/es)"`

---

**Phase A4 deliverables:** the perm-gated "QuickBooks Import" tab on `/accounting`; `use-qbo-import.ts` (`useStartImport` / `useImportReview` / `useApplyImport`) with a notification-rail event on apply; `ReconciliationStrip` (QB vs OPS, green at cent-match, em-dash deltas); `CustomerMatchTable` (link/create/skip/needs_review + confidence + candidate picker); the import-tab shell (pull header with read-only `qb_write_calls=0` badge, records grid, apply confirmation); en+es dictionary keys (`qbo.*`, finalized via `ops-copywriter`); and component/hook tests across six vitest files.


## Phase A5 — Connect wiring + live validation runbook

## Phase A5 — Connect wiring + live validation runbook

> Final integration phase. Depends on A0 (schema + `sync_direction`), A1 (pull service), A2 (matching), A3 (apply engine), A4 (review UI). This phase wires production Intuit credentials into Vercel, hardens the connect flow to land CanPro as a `pull_only` connection with auto-sync off, then drives the real live test end-to-end with an exact runbook, SQL verification block, and a by-run-id rollback.
>
> Most of A5 is a **procedural checklist** executed against the real CanPro production QuickBooks file. Two small code/test tasks (A5.1 env-config guard, A5.3 callback hardening) precede the runbook so the connect flow is provably safe before a real company file is ever touched. Every command below is exact.
>
> **Shared constants used throughout:**
> - CanPro `company_id` = `a612edc0-5c18-4c4d-af97-55b9410dd077`
> - Owner (importer) `user_id` = `1746a0c1-be43-45d6-ab4d-584e82594b1b`
> - Supabase project `ops-app` = `ijeekuhbatykdomumfjx`
> - Production redirect URI = `https://app.opsapp.co/api/integrations/quickbooks/callback`

---

### Task A5.1: Env-config safety guard — fail loud if production QB creds or environment are misconfigured

The connect flow today silently falls back to `QB_ENVIRONMENT="sandbox"` (route.ts:15) and to a derived redirect URI (route.ts:17). For a real production company file this is dangerous: a sandbox token would point pulls at the wrong host, and a mismatched redirect URI fails OAuth opaquely. Add a single shared config helper that validates the QB env at module load and is reused by route.ts, callback/route.ts, the pull service, and the import route — so the whole connect+import surface refuses to run against a half-configured environment.

**Files:**
- Create: `/Users/jacksonsweet/Projects/OPS/ops-web/src/lib/api/services/quickbooks-config.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/unit/services/quickbooks-config.test.ts`

- [ ] **Step 1: Write the failing test.** Create `tests/unit/services/quickbooks-config.test.ts`:
```typescript
/**
 * Unit tests for the shared QuickBooks environment-config helper.
 * The helper centralizes QB_CLIENT_ID / QB_CLIENT_SECRET / QB_REDIRECT_URI /
 * QB_ENVIRONMENT resolution and the API base-host selection so every QB
 * surface (OAuth init, callback, pull service, import route) reads ONE
 * source of truth and fails loud on misconfiguration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("getQuickBooksConfig", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.QB_CLIENT_ID = "AB_test_client_id";
    process.env.QB_CLIENT_SECRET = "test_client_secret";
    process.env.QB_REDIRECT_URI =
      "https://app.opsapp.co/api/integrations/quickbooks/callback";
    process.env.QB_ENVIRONMENT = "production";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("resolves production config and the production API host", async () => {
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    const cfg = getQuickBooksConfig();
    expect(cfg.clientId).toBe("AB_test_client_id");
    expect(cfg.clientSecret).toBe("test_client_secret");
    expect(cfg.redirectUri).toBe(
      "https://app.opsapp.co/api/integrations/quickbooks/callback"
    );
    expect(cfg.environment).toBe("production");
    expect(cfg.apiBaseHost).toBe("https://quickbooks.api.intuit.com");
  });

  it("selects the sandbox API host when QB_ENVIRONMENT=sandbox", async () => {
    process.env.QB_ENVIRONMENT = "sandbox";
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(getQuickBooksConfig().apiBaseHost).toBe(
      "https://sandbox-quickbooks.api.intuit.com"
    );
  });

  it("throws a loud error when QB_CLIENT_ID is missing", async () => {
    delete process.env.QB_CLIENT_ID;
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(() => getQuickBooksConfig()).toThrow(/QB_CLIENT_ID/);
  });

  it("throws when QB_ENVIRONMENT is an invalid value", async () => {
    process.env.QB_ENVIRONMENT = "staging";
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(() => getQuickBooksConfig()).toThrow(/QB_ENVIRONMENT/);
  });

  it("defaults to sandbox host only when QB_ENVIRONMENT is unset (dev safety)", async () => {
    delete process.env.QB_ENVIRONMENT;
    const { getQuickBooksConfig } = await import(
      "@/lib/api/services/quickbooks-config"
    );
    expect(getQuickBooksConfig().environment).toBe("sandbox");
    expect(getQuickBooksConfig().apiBaseHost).toBe(
      "https://sandbox-quickbooks.api.intuit.com"
    );
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module does not exist yet).**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/services/quickbooks-config.test.ts
```
Expected: `Error: Failed to load url @/lib/api/services/quickbooks-config` / suite fails to import. Confirms the helper is genuinely absent.

- [ ] **Step 3: Implement the config helper (complete, no placeholders).** Create `src/lib/api/services/quickbooks-config.ts`:
```typescript
/**
 * OPS Web - QuickBooks Environment Config (single source of truth)
 *
 * Centralizes resolution of the Intuit OAuth credentials, redirect URI, and
 * environment → API base-host. Every QuickBooks surface (OAuth init, callback,
 * pull service, import route) reads this so there is exactly one place that
 * decides production vs sandbox and exactly one place that fails loud when the
 * environment is half-configured. Connecting a REAL production company file in
 * read-only mode (Canpro) must never silently fall back to sandbox or to a
 * mismatched redirect URI.
 */

export type QuickBooksEnvironment = "production" | "sandbox";

export interface QuickBooksConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QuickBooksEnvironment;
  /** Intuit Accounting API base host, chosen by environment. */
  apiBaseHost: string;
}

const PRODUCTION_API_HOST = "https://quickbooks.api.intuit.com";
const SANDBOX_API_HOST = "https://sandbox-quickbooks.api.intuit.com";

const DEFAULT_REDIRECT_URI =
  "https://app.opsapp.co/api/integrations/quickbooks/callback";

function resolveEnvironment(raw: string | undefined): QuickBooksEnvironment {
  // Unset → sandbox (dev safety). An explicit invalid value is a hard error.
  if (raw === undefined || raw.trim() === "") return "sandbox";
  const value = raw.trim().toLowerCase();
  if (value === "production" || value === "sandbox") {
    return value as QuickBooksEnvironment;
  }
  throw new Error(
    `QB_ENVIRONMENT is set to an invalid value "${raw}". Expected "production" or "sandbox".`,
  );
}

/**
 * Resolve and validate the QuickBooks config. Throws on any missing required
 * value so misconfiguration surfaces immediately rather than at OAuth-exchange
 * or first-pull time.
 */
export function getQuickBooksConfig(): QuickBooksConfig {
  const clientId = process.env.QB_CLIENT_ID?.trim();
  const clientSecret = process.env.QB_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.QB_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  const environment = resolveEnvironment(process.env.QB_ENVIRONMENT);

  if (!clientId) {
    throw new Error(
      "QB_CLIENT_ID is missing. QuickBooks integration is not configured.",
    );
  }
  if (!clientSecret) {
    throw new Error(
      "QB_CLIENT_SECRET is missing. QuickBooks integration is not configured.",
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    environment,
    apiBaseHost:
      environment === "production" ? PRODUCTION_API_HOST : SANDBOX_API_HOST,
  };
}
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/unit/services/quickbooks-config.test.ts
```
Expected: `5 passed`.

- [ ] **Step 5: Commit.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/lib/api/services/quickbooks-config.ts tests/unit/services/quickbooks-config.test.ts && git commit -m "feat(quickbooks): add shared env-config helper with loud misconfig errors"
```

---

### Task A5.2: Wire production Intuit credentials into Vercel env (preview + production)

Set the four `QB_*` variables on the ops-web Vercel project so the deployed connect flow uses CanPro's real production app. The owner supplies `client_id` and `client_secret` (decision log #9). Cost note: Intuit production API access and the developer account are free — no per-call connector fee (spec §11); this task incurs no spend.

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/.env.example` (document the production-correct values; never commit real secrets)

- [ ] **Step 1: Confirm the Vercel project is linked.** From the repo root:
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && vercel link --yes 2>&1 | tail -3
```
If it prints `Linked to <scope>/ops-web`, proceed. If it errors, run `vercel login` first, then re-run. (This only links the local dir to the existing Vercel project; it changes nothing remote.)

- [ ] **Step 2: Pull current env to diff what already exists.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && vercel env ls production 2>&1 | grep -iE "QB_CLIENT_ID|QB_CLIENT_SECRET|QB_REDIRECT_URI|QB_ENVIRONMENT" || echo "no QB_* vars set in production yet"
```
Record which (if any) already exist so you replace rather than duplicate.

- [ ] **Step 3: Add `QB_ENVIRONMENT=production` to production + preview.** (Not secret — safe to type.)
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && printf 'production' | vercel env add QB_ENVIRONMENT production && printf 'production' | vercel env add QB_ENVIRONMENT preview
```

- [ ] **Step 4: Add `QB_REDIRECT_URI` to production + preview.** This MUST be byte-for-byte identical to the Redirect URI registered in the owner's Intuit production app, or OAuth fails with `redirect_uri_mismatch`.
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && printf 'https://app.opsapp.co/api/integrations/quickbooks/callback' | vercel env add QB_REDIRECT_URI production && printf 'https://app.opsapp.co/api/integrations/quickbooks/callback' | vercel env add QB_REDIRECT_URI preview
```

- [ ] **Step 5: Add the secret `QB_CLIENT_ID` (owner-supplied) to production + preview.** Replace `<OWNER_CLIENT_ID>` with the real value from the owner; do not paste it into any file or commit.
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && printf '<OWNER_CLIENT_ID>' | vercel env add QB_CLIENT_ID production && printf '<OWNER_CLIENT_ID>' | vercel env add QB_CLIENT_ID preview
```

- [ ] **Step 6: Add the secret `QB_CLIENT_SECRET` (owner-supplied) to production + preview.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && printf '<OWNER_CLIENT_SECRET>' | vercel env add QB_CLIENT_SECRET production && printf '<OWNER_CLIENT_SECRET>' | vercel env add QB_CLIENT_SECRET preview
```

- [ ] **Step 7: Verify all four are set in both targets.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && for t in production preview; do echo "== $t =="; vercel env ls $t 2>&1 | grep -iE "QB_CLIENT_ID|QB_CLIENT_SECRET|QB_REDIRECT_URI|QB_ENVIRONMENT"; done
```
Expected: each of the four names listed once per target (values are masked by Vercel). Anything missing → re-run the matching step above.

- [ ] **Step 8: Document the production-correct values in `.env.example` (no secrets).** Update the QB block so future operators know production wiring. Change the existing line:
```
QB_ENVIRONMENT=sandbox                                # [_] sandbox or production
```
to:
```
QB_ENVIRONMENT=production                             # [_] sandbox or production — Canpro live test uses production
```
Leave `QB_CLIENT_ID`/`QB_CLIENT_SECRET` blank (secrets) and confirm `QB_REDIRECT_URI` already reads `https://app.opsapp.co/api/integrations/quickbooks/callback`.

- [ ] **Step 9: Commit the doc change only (never secrets).**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add .env.example && git commit -m "docs(quickbooks): note production QB_ENVIRONMENT for Canpro live test"
```

---

### Task A5.3: Harden the OAuth callback — land CanPro as `pull_only`, auto-sync off

The current callback (callback/route.ts:104-117) sets `sync_enabled: true` and never sets `sync_direction`, which would leave the connection eligible for the untested bidirectional push path. Per spec §4 and §6, on a successful connect the row MUST be `sync_direction='pull_only'`, `sync_enabled=false`. If A4 already landed this change, this task is a verification no-op — Step 4's test must still pass.

**Files:**
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-web/src/app/api/integrations/quickbooks/callback/route.ts`
- Test: `/Users/jacksonsweet/Projects/OPS/ops-web/tests/integration/quickbooks-callback-pull-only.test.ts`

- [ ] **Step 1: Write the failing test.** Create `tests/integration/quickbooks-callback-pull-only.test.ts`:
```typescript
/**
 * Integration test: the QuickBooks OAuth callback must land the connection in
 * read-only mode — sync_direction='pull_only', sync_enabled=false — and must
 * NOT auto-trigger any sync. This is a hard safety requirement for the Canpro
 * live test (spec §4, §6): a connected real company file must never be eligible
 * for the untested push path or for the scheduler.
 *
 * Mocking strategy mirrors stripe-webhook-billing-events.test.ts: a hand-rolled
 * Supabase mock records every .update(...) payload so we assert on the row the
 * callback tried to write. We stub global fetch for the Intuit token exchange.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.QB_CLIENT_ID = "AB_test_client_id";
process.env.QB_CLIENT_SECRET = "test_client_secret";
process.env.QB_REDIRECT_URI =
  "https://app.opsapp.co/api/integrations/quickbooks/callback";
process.env.QB_ENVIRONMENT = "production";
process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const STATE = `${COMPANY_ID}:deadbeefdeadbeefdeadbeefdeadbeef`;

const updateCalls: Array<{ payload: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: { webhook_verifier_token: STATE },
              error: null,
            }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updateCalls.push({ payload });
        return {
          eq: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    }),
  }),
}));

import { GET } from "@/app/api/integrations/quickbooks/callback/route";

describe("QuickBooks OAuth callback — pull_only landing", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: "qb_access_token",
          refresh_token: "qb_refresh_token",
          expires_in: 3600,
        }),
      })),
    );
  });

  it("sets sync_direction='pull_only' and sync_enabled=false on connect", async () => {
    const url =
      "https://app.opsapp.co/api/integrations/quickbooks/callback" +
      `?code=auth_code_123&state=${encodeURIComponent(STATE)}&realmId=9999999999`;
    const req = new Request(url, { method: "GET" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(req as any);

    // Redirects to the connected confirmation, not an error.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("connected=quickbooks");

    // The token-storing update must carry the read-only mode.
    const tokenUpdate = updateCalls.find(
      (c) => c.payload.access_token === "qb_access_token",
    );
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate!.payload.sync_direction).toBe("pull_only");
    expect(tokenUpdate!.payload.sync_enabled).toBe(false);
    expect(tokenUpdate!.payload.is_connected).toBe(true);
    expect(tokenUpdate!.payload.realm_id).toBe("9999999999");
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL** (current callback sets `sync_enabled: true` and omits `sync_direction`).
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/quickbooks-callback-pull-only.test.ts
```
Expected: assertion failure — `expected undefined to be 'pull_only'` and/or `expected true to be false`. (If A4 already hardened the callback, it PASSES; record that and skip Step 3.)

- [ ] **Step 3: Implement the hardening.** In `src/app/api/integrations/quickbooks/callback/route.ts`, replace the token-store update block (lines 102-117) so it lands read-only:
```typescript
    // Store tokens in accounting_connections — READ-ONLY connection.
    // Canpro live test (spec §4, §6): a connected real company file must be
    // pull_only with auto-sync OFF so the untested push path and the scheduler
    // can never run for it. The import is driven manually via /api/integrations/
    // quickbooks/import, never by /api/sync.
    const { error: upsertError } = await supabase
      .from("accounting_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(
          Date.now() + (tokens.expires_in || 3600) * 1000
        ).toISOString(),
        realm_id: realmId,
        is_connected: true,
        sync_enabled: false,
        sync_direction: "pull_only",
        webhook_verifier_token: null, // Clear CSRF token
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "quickbooks");
```

- [ ] **Step 4: Run the test — expect PASS.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && npx vitest run tests/integration/quickbooks-callback-pull-only.test.ts
```
Expected: `1 passed`.

- [ ] **Step 5: Commit.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && git add src/app/api/integrations/quickbooks/callback/route.ts tests/integration/quickbooks-callback-pull-only.test.ts && git commit -m "fix(quickbooks): land OAuth connections as pull_only with auto-sync off"
```

---

### Task A5.4: Pre-flight verification — deploy is live, flag is on, no accounting cron, CanPro baseline captured

Before connecting a real company file, confirm the environment is correct and capture the exact "before" counts so reconciliation and rollback are provable. No QuickBooks calls happen here.

**Files:** none (verification only).

- [ ] **Step 1: Confirm the latest production deploy includes A0–A5 code.**
```bash
cd /Users/jacksonsweet/Projects/OPS/ops-web && vercel ls --prod 2>&1 | head -5
```
Confirm the most recent production deployment is `Ready` and its commit is at or after the A5.3 commit. If not, deploy is the gate — do not proceed until A0–A5 are live in production.

- [ ] **Step 2: Confirm NO accounting cron is registered (spec §6.3, decision: manual-only).** Use the Read tool on `/Users/jacksonsweet/Projects/OPS/ops-web/vercel.json` and confirm there is no entry whose `path` contains `accounting-sync`, `qbo`, or `quickbooks`. (Verified absent at plan time — re-confirm in case a sibling session added one.) If one exists, STOP and remove it before connecting.

- [ ] **Step 3: Confirm the `accounting` feature flag is enabled for the owner ONLY (seeded in A0).** Run via Supabase MCP `execute_sql` against project `ijeekuhbatykdomumfjx`:
```sql
SELECT user_id, flag_key, enabled
FROM feature_flag_overrides
WHERE flag_key = 'accounting'
  AND user_id = '1746a0c1-be43-45d6-ab4d-584e82594b1b';
```
Expected: exactly one row, `enabled = true`. If missing, A0's seed did not land — fix A0 before proceeding.

- [ ] **Step 4: Confirm the global `accounting` flag is still OFF (no other company sees the surface).**
```sql
SELECT key, enabled FROM feature_flags WHERE key = 'accounting';
```
Expected: `enabled = false` (or no global-on row). If globally on, STOP — this phase is owner-only.

- [ ] **Step 5: Capture the CanPro money/clients BEFORE baseline (this is the reconciliation + rollback anchor).** Run and SAVE the output verbatim:
```sql
SELECT
  (SELECT count(*) FROM clients
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       AND deleted_at IS NULL)                                   AS clients_total,
  (SELECT count(*) FROM clients
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       AND qb_id IS NOT NULL)                                    AS clients_with_qb_id,
  (SELECT count(*) FROM invoices
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077')  AS invoices_total,
  (SELECT count(*) FROM estimates
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077')  AS estimates_total,
  (SELECT count(*) FROM payments
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077')  AS payments_total,
  (SELECT count(*) FROM line_items
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077')  AS line_items_total,
  (SELECT coalesce(sum(balance_due), 0) FROM invoices
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       AND status NOT IN ('void','written_off','paid'))          AS open_ar_balance;
```
Expected baseline (spec §3.2): `clients_total ≈ 349`, `clients_with_qb_id = 0`, `invoices_total = 0`, `estimates_total = 0`, `payments_total = 0`, `line_items_total = 0`, `open_ar_balance = 0`. Record the ACTUAL numbers — they are the source of truth, not the spec estimate.

- [ ] **Step 6: Confirm the redirect URI matches Intuit, WITH THE OWNER.** Ask the owner to read the Redirect URI registered in their Intuit production app (developer.intuit.com → app → Keys & OAuth → Redirect URIs). It must equal `https://app.opsapp.co/api/integrations/quickbooks/callback` exactly (scheme, host, path, no trailing slash). Mismatch → fix in Intuit's dashboard before connecting (changing it there is free and instant). This resolves the residual risk in spec §14.

---

### Task A5.5: Connect CanPro's real QuickBooks (read-only) — the live OAuth handshake

Owner-driven OAuth consent against the real production company file. This is the first moment a real Intuit token exists for CanPro. Read-only by construction: the scope is unchanged (`com.intuit.quickbooks.accounting`, which QuickBooks treats as read+write at the token level, but OPS only ever issues GETs — enforced in A1's pull service and the `sync_direction='pull_only'` guard).

**Files:** none (live procedure).

- [ ] **Step 1: Owner opens the Accounting page and starts the connect.** Owner (logged in as `1746a0c1-...`) navigates to `https://app.opsapp.co/accounting`, opens the QuickBooks Import surface, and clicks the connect/`PULL FROM QUICKBOOKS` connect action. This `POST /api/integrations/quickbooks` with `{ companyId: 'a612edc0-5c18-4c4d-af97-55b9410dd077' }`, which writes the CSRF state into `webhook_verifier_token` and returns the Intuit `authUrl`.

- [ ] **Step 2: Owner completes Intuit consent and selects the REAL CanPro company.** On Intuit's screen the owner authorizes and — critically — picks the **production CanPro company file** (not a sandbox company). Intuit redirects back to `…/callback?code=…&state=…&realmId=…`.

- [ ] **Step 3: Verify the connection landed read-only.** Immediately after redirect, run:
```sql
SELECT company_id, provider, is_connected, sync_enabled, sync_direction,
       realm_id IS NOT NULL AS has_realm,
       access_token IS NOT NULL AS has_access_token,
       refresh_token IS NOT NULL AS has_refresh_token,
       webhook_verifier_token
FROM accounting_connections
WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND provider = 'quickbooks';
```
Expected: `is_connected = true`, `sync_enabled = false`, `sync_direction = 'pull_only'`, `has_realm = true`, `has_access_token = true`, `has_refresh_token = true`, `webhook_verifier_token = null` (CSRF cleared). Any deviation → STOP; do not pull until the row is correct.

- [ ] **Step 4: Confirm `/api/sync` refuses this connection (defense-in-depth, A3/contract).** Prove the dangerous legacy endpoint is blocked for pull_only. As the owner (authenticated), trigger `POST /api/sync` with `{ companyId: 'a612edc0-...', provider: 'quickbooks' }` (via the browser devtools console or curl with the owner's bearer token):
```bash
curl -s -X POST https://app.opsapp.co/api/sync \
  -H "Authorization: Bearer <OWNER_FIREBASE_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"companyId":"a612edc0-5c18-4c4d-af97-55b9410dd077","provider":"quickbooks"}' \
  -w '\nHTTP %{http_code}\n'
```
Expected: `HTTP 409` with a refusal message (pull_only). If it returns 200/partial, the `/api/sync` guard is missing — STOP and fix before any import.

---

### Task A5.6: Run the import — pull → stage → match (zero QB writes)

Trigger the manual import. This pulls Customers/Invoices/Estimates/Payments/Items via GET only, writes to `qbo_staging_*`, and computes `qbo_customer_matches`. Nothing touches live business tables yet.

**Files:** none (live procedure).

- [ ] **Step 1: Owner starts the import from the web UI.** In the QuickBooks Import tab, owner clicks `PULL FROM QUICKBOOKS`. The hook `useStartImport` calls `POST /api/integrations/quickbooks/import` with `{ companyId: 'a612edc0-...' }`. The route starts a run, pulls, stages, and computes matches, returning `{ runId }`. Record the `runId`.

- [ ] **Step 2: Confirm the run reached `staged` and recorded ZERO QB writes.** Substitute the recorded `<RUN_ID>`:
```sql
SELECT id, status, history_cutoff, qb_write_calls, totals, error,
       created_by, created_at, finished_at
FROM qbo_import_runs
WHERE id = '<RUN_ID>'
  AND company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077';
```
Expected: `status = 'staged'`, **`qb_write_calls = 0`** (hard requirement — any non-zero is an immediate FAIL per spec §2.3/§6.5; STOP and investigate), `history_cutoff` ≈ today − 24 months, `error = null`, `created_by = '1746a0c1-...'`. Record `history_cutoff`.

- [ ] **Step 3: Confirm staging tables are populated and scoped to CanPro.**
```sql
SELECT
  (SELECT count(*) FROM qbo_staging_customers   WHERE run_id = '<RUN_ID>') AS staged_customers,
  (SELECT count(*) FROM qbo_staging_estimates    WHERE run_id = '<RUN_ID>') AS staged_estimates,
  (SELECT count(*) FROM qbo_staging_invoices     WHERE run_id = '<RUN_ID>') AS staged_invoices,
  (SELECT count(*) FROM qbo_staging_line_items   WHERE run_id = '<RUN_ID>') AS staged_line_items,
  (SELECT count(*) FROM qbo_staging_payments     WHERE run_id = '<RUN_ID>') AS staged_payments,
  (SELECT count(*) FROM qbo_customer_matches     WHERE run_id = '<RUN_ID>') AS computed_matches,
  (SELECT count(*) FROM qbo_staging_customers
     WHERE run_id = '<RUN_ID>'
       AND company_id <> 'a612edc0-5c18-4c4d-af97-55b9410dd077')           AS wrong_company_rows;
```
Expected: non-zero `staged_*` and `computed_matches`; `staged_customers = computed_matches`; `wrong_company_rows = 0`. If `wrong_company_rows > 0`, the pull leaked another company's scope — STOP.

- [ ] **Step 4: Inspect the proposed match distribution before reviewing in the UI.**
```sql
SELECT proposed_action, confidence, count(*)
FROM qbo_customer_matches
WHERE run_id = '<RUN_ID>'
GROUP BY proposed_action, confidence
ORDER BY proposed_action, confidence;
```
Expected: a mix of `link/high` (email), `link/medium` (name), some `create`, possibly `needs_review`. Sanity-check that the `link` count is plausible against CanPro's 241 email-bearing clients (spec §3.3). This sets expectations for the UI review.

- [ ] **Step 5: Confirm live business tables are STILL untouched (staging only).** Re-run the BEFORE baseline (Task A5.4 Step 5). Every count must be IDENTICAL to the baseline — `invoices_total`, `payments_total`, `estimates_total`, `line_items_total` still `0`, `clients_with_qb_id` still `0`. If anything changed, the pull wrote to live tables (contract violation) — STOP and roll back.

---

### Task A5.7: Review on web, then APPLY (customers first, then invoices/estimates/payments)

Owner reviews the dry-run in the UI and applies. Apply is transactional and ordered per spec §8 (clients → headers → line items → payments → reconcile). Customers are applied first so every downstream document resolves its `client_id`.

**Files:** none (live procedure).

- [ ] **Step 1: Owner reviews the reconciliation strip and match table.** In the Import tab the owner inspects: QUICKBOOKS vs OPS(after import) for open A/R, # open invoices, collected(24mo), # customers; the customer match table (link/create/skip/needs_review with confidence); and any flagged orphans (payment without a pulled invoice) or skipped voided/zero-total invoices. Owner resolves every `needs_review` (pick a candidate, or set create/skip) and any low-confidence fuzzy links.

- [ ] **Step 2: Owner applies customers first.** Owner triggers apply for customers (the decisions array of `{customer_qb_id, action, client_id?}`), which calls `POST /api/integrations/quickbooks/import/apply`. Verify customers landed without duplicating CanPro's existing 349:
```sql
SELECT
  (SELECT count(*) FROM clients
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       AND deleted_at IS NULL)                                  AS clients_total_now,
  (SELECT count(*) FROM clients
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       AND qb_id IS NOT NULL)                                   AS clients_with_qb_id_now,
  (SELECT count(*) FROM (
     SELECT qb_id FROM clients
       WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
         AND qb_id IS NOT NULL
       GROUP BY qb_id HAVING count(*) > 1) d)                   AS duplicate_qb_ids;
```
Expected: `clients_with_qb_id_now` = (# link decisions + # create decisions); `clients_total_now` = baseline + (# create decisions only); **`duplicate_qb_ids = 0`** (success criterion §2.4 — no duplicate clients). If `duplicate_qb_ids > 0`, apply is non-idempotent — STOP and roll back.

- [ ] **Step 2b: Confirm `link` did NOT overwrite existing client fields (spec §7).** Spot-check that a linked client kept its original OPS name/email/phone/address (only `qb_id` was added). Pick one linked client's `qb_id` from the match table and confirm its non-`qb_id` fields are unchanged from the owner's knowledge of that client. (No SQL diff is possible post-hoc; rely on owner recognition + the apply engine's tested behavior from A3.)

- [ ] **Step 3: Owner applies invoices/estimates/payments.** Owner triggers the full apply. Verify documents landed and reconciliation holds to the cent:
```sql
-- OPS post-apply money snapshot for CanPro
SELECT
  (SELECT count(*) FROM invoices
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077')  AS invoices_now,
  (SELECT count(*) FROM estimates
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077')  AS estimates_now,
  (SELECT count(*) FROM payments
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077')  AS payments_now,
  (SELECT count(*) FROM line_items
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077')  AS line_items_now,
  (SELECT coalesce(sum(balance_due), 0) FROM invoices
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       AND status NOT IN ('void','written_off','paid'))          AS ops_open_ar,
  (SELECT coalesce(sum(amount), 0) FROM payments
     WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       AND voided_at IS NULL)                                     AS ops_collected_total;
```
Then compare against the run's recorded reconciliation totals:
```sql
SELECT totals FROM qbo_import_runs WHERE id = '<RUN_ID>';
```
Expected: `invoices_now`/`payments_now`/`line_items_now` match the staged counts (minus skipped voided/zero-total invoices, which `totals` reports separately); `ops_open_ar` equals the QuickBooks open A/R total in `totals` **to the cent** (success criterion §2.2); `qbo_import_runs.status = 'applied'`. Any cent-level A/R delta → investigate the reconcile step (§8.5) before declaring success.

- [ ] **Step 4: Confirm a notification-rail event fired on apply.**
```sql
SELECT type, title, body, action_url, action_label, persistent, created_at
FROM notifications
WHERE company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND user_id = '1746a0c1-be43-45d6-ab4d-584e82594b1b'
ORDER BY created_at DESC
LIMIT 3;
```
Expected: a recent row for the import-applied event with `action_url` pointing at Books/accounting. If absent, the apply route's notification dispatch (A4) didn't fire — log as a follow-up but not a blocker for the money verification.

- [ ] **Step 5: Confirm STILL zero QB writes after the full cycle.**
```sql
SELECT qb_write_calls, status FROM qbo_import_runs WHERE id = '<RUN_ID>';
```
Expected: `qb_write_calls = 0`, `status = 'applied'`. Non-zero `qb_write_calls` is a hard failure of success criterion §2.3 regardless of everything else.

---

### Task A5.8: Verify success criteria on iOS Books (the real payoff)

Confirm CanPro's iOS Books cards light up with real, reconciled numbers. This is the validation surface the entire phase exists for (spec §2, §10).

**Files:** none (live procedure, on the owner's device).

- [ ] **Step 1: Owner opens iOS Books and pulls to refresh.** On the owner's iPhone, logged into CanPro, open the Books tab and pull-to-refresh so it re-reads the now-populated `invoices`/`payments`.

- [ ] **Step 2: Verify A/R card matches QuickBooks to the cent.** The A/R card's outstanding total must equal `ops_open_ar` from Task A5.7 Step 3, which in turn equals QuickBooks' open A/R from `qbo_import_runs.totals`. Aging buckets should populate from the open invoices' `due_date`. This is the strongest validation (spec §10). The owner confirms the figure matches what they know CanPro is owed.

- [ ] **Step 3: Verify P&L and Cash Flow cards show plausible real numbers.** P&L `payments in` and Cash Flow weekly-net derive from the imported 24-month payments. The owner confirms these are recognizable CanPro figures (non-zero, plausible), satisfying success criterion §2.1.

- [ ] **Step 4: Confirm the Jobs card did NOT auto-populate (expected boundary).** Per spec §10, QB invoices carry no OPS `project_id`, so per-job profit stays empty. Confirm it is empty (not erroring) — this is the documented boundary that motivates Sub-project B, not a bug.

- [ ] **Step 5: Confirm zero QB writes in Intuit's audit trail (independent proof).** Owner opens the QuickBooks Online company file → Settings → Audit Log and confirms NO new create/update/delete entries from the OPS app during the test window. Combined with `qb_write_calls = 0`, this double-proves success criterion §2.3 from both sides.

- [ ] **Step 6: Record the final result.** Write the captured numbers into the run record for traceability:
```sql
UPDATE qbo_import_runs
SET totals = totals || jsonb_build_object(
      'live_test_passed', true,
      'live_test_at', now(),
      'ios_ar_confirmed', true)
WHERE id = '<RUN_ID>'
  AND company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077';
```

---

### Task A5.9: Rollback runbook — undo a run by `run_id` (operator action)

A clean, scoped undo per spec §8 ("Reversibility"). Every imported row carries `qb_id`; rollback deletes only the rows this run created, scoped to CanPro, and strips `qb_id` from clients that were merely linked (so they revert to pre-import state). Safe because CanPro is a clean seed (no hand-edits to commingle). Use only if a verification step fails.

**Files:** none (operational SQL — run via Supabase MCP `execute_sql`, wrapped in a transaction).

- [ ] **Step 1: Identify exactly what the run touched.** Capture the staged qb_id sets for the run so the deletes are precisely scoped:
```sql
-- The qb_ids this run staged, by entity (the rollback target set).
SELECT 'invoice'  AS kind, count(*) FROM qbo_staging_invoices  WHERE run_id = '<RUN_ID>'
UNION ALL
SELECT 'estimate', count(*) FROM qbo_staging_estimates WHERE run_id = '<RUN_ID>'
UNION ALL
SELECT 'payment',  count(*) FROM qbo_staging_payments  WHERE run_id = '<RUN_ID>'
UNION ALL
SELECT 'customer', count(*) FROM qbo_staging_customers WHERE run_id = '<RUN_ID>';
```

- [ ] **Step 2: Run the rollback as a single transaction (delete in reverse apply order).** Payments first (so the balance trigger recomputes on the way down), then line items, then invoice/estimate headers, then unlink/delete clients:
```sql
BEGIN;

-- 1) Payments: delete the OPS payments this run created.
--    Trigger trg_payment_balance recomputes each affected invoice's
--    amount_paid/balance_due/status as payments are removed.
DELETE FROM payments p
USING qbo_staging_payments s
WHERE s.run_id = '<RUN_ID>'
  AND p.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND p.qb_id = s.qb_id;

-- 2) Line items: delete-by-parent for invoices this run created.
DELETE FROM line_items li
USING invoices i
WHERE i.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND li.invoice_id = i.id
  AND i.qb_id IN (SELECT qb_id FROM qbo_staging_invoices WHERE run_id = '<RUN_ID>');

-- 2b) Line items for estimates this run created.
DELETE FROM line_items li
USING estimates e
WHERE e.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND li.estimate_id = e.id
  AND e.qb_id IN (SELECT qb_id FROM qbo_staging_estimates WHERE run_id = '<RUN_ID>');

-- 3) Invoice headers created by this run.
DELETE FROM invoices i
WHERE i.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND i.qb_id IN (SELECT qb_id FROM qbo_staging_invoices WHERE run_id = '<RUN_ID>');

-- 3b) Estimate headers created by this run.
DELETE FROM estimates e
WHERE e.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND e.qb_id IN (SELECT qb_id FROM qbo_staging_estimates WHERE run_id = '<RUN_ID>');

-- 4a) Clients CREATED by this run (decided_action='create') → delete outright.
DELETE FROM clients c
WHERE c.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND c.qb_id IN (
    SELECT m.customer_qb_id
    FROM qbo_customer_matches m
    WHERE m.run_id = '<RUN_ID>'
      AND m.decided_action = 'create'
  );

-- 4b) Clients LINKED by this run (decided_action='link') → strip qb_id only.
--     Never deletes a pre-existing client; reverts it to pre-import state.
UPDATE clients c
SET qb_id = NULL, updated_at = now()
WHERE c.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
  AND c.qb_id IN (
    SELECT m.customer_qb_id
    FROM qbo_customer_matches m
    WHERE m.run_id = '<RUN_ID>'
      AND m.decided_action = 'link'
  );

-- 5) Mark the run as rolled back (audit trail; keeps staging for re-run).
UPDATE qbo_import_runs
SET status = 'error',
    error = 'rolled back by operator',
    finished_at = now()
WHERE id = '<RUN_ID>'
  AND company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077';

COMMIT;
```

- [ ] **Step 3: Verify the rollback restored the BEFORE baseline.** Re-run the Task A5.4 Step 5 baseline query. Every count must equal the original baseline — `invoices_total = 0`, `estimates_total = 0`, `payments_total = 0`, `line_items_total = 0`, `clients_with_qb_id = 0`, `clients_total` back to ≈349, `open_ar_balance = 0`. If anything is off, do NOT re-run the import — investigate the discrepancy first.

- [ ] **Step 4: (Optional) Drop the staging rows for the run.** If discarding the run entirely (vs. re-applying), cascade-delete the staging via the run row:
```sql
DELETE FROM qbo_import_runs
WHERE id = '<RUN_ID>'
  AND company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077';
-- ON DELETE CASCADE removes qbo_staging_* and qbo_customer_matches for this run.
```
Keep the run row (skip this step) if you intend to fix a mapping bug and re-apply against the same staged data.

---

**Phase A5 exit criteria (all must hold):**
1. Four `QB_*` vars set in Vercel production + preview; `QB_ENVIRONMENT=production`; redirect URI matches Intuit exactly.
2. CanPro connection row: `is_connected=true`, `sync_enabled=false`, `sync_direction='pull_only'`.
3. `/api/sync` returns 409 for the pull_only connection.
4. `qbo_import_runs.qb_write_calls = 0` after the full pull→apply cycle, and Intuit's audit log shows zero OPS-originated writes.
5. iOS Books A/R reconciles to QuickBooks **to the cent**; P&L and Cash Flow show plausible real CanPro numbers; Jobs card correctly empty.
6. Zero duplicate clients (`duplicate_qb_ids = 0`); linked clients kept their original fields, gained only `qb_id`.
7. Rollback by `run_id` provably restores the captured BEFORE baseline.
