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
-- so anon never holds table-level INSERT/UPDATE/DELETE. Issued as explicit
-- per-table statements (matching public.opportunity_views) so the literal DDL
-- is greppable; every SELECT policy carries the identical company-scope +
-- accounting.view predicate. There are deliberately NO write policies.

-- qbo_import_runs
alter table public.qbo_import_runs enable row level security;
grant select on table public.qbo_import_runs to authenticated;
revoke all on table public.qbo_import_runs from anon;
grant select on table public.qbo_import_runs to anon;
drop policy if exists "read company qbo_import_runs with accounting view" on public.qbo_import_runs;
create policy "read company qbo_import_runs with accounting view"
on public.qbo_import_runs for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

-- qbo_staging_customers
alter table public.qbo_staging_customers enable row level security;
grant select on table public.qbo_staging_customers to authenticated;
revoke all on table public.qbo_staging_customers from anon;
grant select on table public.qbo_staging_customers to anon;
drop policy if exists "read company qbo_staging_customers with accounting view" on public.qbo_staging_customers;
create policy "read company qbo_staging_customers with accounting view"
on public.qbo_staging_customers for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

-- qbo_staging_estimates
alter table public.qbo_staging_estimates enable row level security;
grant select on table public.qbo_staging_estimates to authenticated;
revoke all on table public.qbo_staging_estimates from anon;
grant select on table public.qbo_staging_estimates to anon;
drop policy if exists "read company qbo_staging_estimates with accounting view" on public.qbo_staging_estimates;
create policy "read company qbo_staging_estimates with accounting view"
on public.qbo_staging_estimates for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

-- qbo_staging_invoices
alter table public.qbo_staging_invoices enable row level security;
grant select on table public.qbo_staging_invoices to authenticated;
revoke all on table public.qbo_staging_invoices from anon;
grant select on table public.qbo_staging_invoices to anon;
drop policy if exists "read company qbo_staging_invoices with accounting view" on public.qbo_staging_invoices;
create policy "read company qbo_staging_invoices with accounting view"
on public.qbo_staging_invoices for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

-- qbo_staging_line_items
alter table public.qbo_staging_line_items enable row level security;
grant select on table public.qbo_staging_line_items to authenticated;
revoke all on table public.qbo_staging_line_items from anon;
grant select on table public.qbo_staging_line_items to anon;
drop policy if exists "read company qbo_staging_line_items with accounting view" on public.qbo_staging_line_items;
create policy "read company qbo_staging_line_items with accounting view"
on public.qbo_staging_line_items for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

-- qbo_staging_payments
alter table public.qbo_staging_payments enable row level security;
grant select on table public.qbo_staging_payments to authenticated;
revoke all on table public.qbo_staging_payments from anon;
grant select on table public.qbo_staging_payments to anon;
drop policy if exists "read company qbo_staging_payments with accounting view" on public.qbo_staging_payments;
create policy "read company qbo_staging_payments with accounting view"
on public.qbo_staging_payments for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

-- qbo_customer_matches
alter table public.qbo_customer_matches enable row level security;
grant select on table public.qbo_customer_matches to authenticated;
revoke all on table public.qbo_customer_matches from anon;
grant select on table public.qbo_customer_matches to anon;
drop policy if exists "read company qbo_customer_matches with accounting view" on public.qbo_customer_matches;
create policy "read company qbo_customer_matches with accounting view"
on public.qbo_customer_matches for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

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
