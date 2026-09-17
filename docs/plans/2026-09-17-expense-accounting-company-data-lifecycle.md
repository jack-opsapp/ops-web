# Expense Accounting Company-Data Lifecycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Classify every live company-scoped table the checked-in company-data manifest does not know (the seven `expense_accounting_*` tables first), and make account closure actually able to erase them.

**Architecture:** The manifest (`src/lib/data/company-data-manifest.ts`) drives `/api/data/export` and the transactional `public.purge_company_data` plan. Production readback on 2026-09-17 shows 15 unclassified in-scope tables, two delete-blocked ledgers that need the `public.purge_company_rows` definer detour, and three expense authority triggers that refuse the closure transaction outright. Two migrations (authority maintenance contract; definer purge of the expense ledgers) plus the manifest/snapshot/test refresh fix it; a disposable PostgreSQL 17 harness proves closure end to end with the real manifest order.

**Tech Stack:** TypeScript (Next.js 15 app code, Vitest 2.1.9), PostgreSQL 17 (Supabase prod 17.6, local Homebrew 17.11), PL/pgSQL.

**Design System:** N/A (no UI).

**Required Skills:** `supabase:supabase`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`.

---

## Production facts (read-only, project `ijeekuhbatykdomumfjx`, 2026-09-17)

| Table | Tenant column | `deleted_at` | service_role | Rows | Notes |
|---|---|---|---|---|---|
| `expense_accounting_settings` | `company_id uuid NN` | no | SELECT/INSERT/UPDATE/DELETE | 0 | PK `connection_id` → `accounting_connections` ON DELETE CASCADE |
| `expense_accounting_payee_mappings` | `company_id uuid NN` | no | full | 0 | → connections CASCADE, → `users` NO ACTION |
| `expense_accounting_category_mappings` | `company_id uuid NN` | no | full | 0 | → connections CASCADE, → `expense_categories` NO ACTION |
| `expense_accounting_project_mappings` | `company_id uuid NN` | no | full | 0 | → connections CASCADE, → `projects` NO ACTION |
| `expense_accounting_tax_mappings` | `company_id uuid NN` | no | full | 0 | → connections CASCADE |
| `expense_accounting_events` | `company_id uuid NN` | no | **SELECT only** | 2 (1 company) | self FK; referenced by postings and `private.expense_accounting_state` (NO ACTION) |
| `expense_accounting_postings` | `company_id uuid NN` | no | **SELECT only** | 0 | → `accounting_connections`, `accounting_sync_queue`, events: all NO ACTION |

None of the seven has triggers; RLS policies grant only service_role. `private.expense_accounting_state` (3 rows, 1 company) references events.

Other in-scope tables absent from the checked-in snapshot: `expense_recurring_reimbursements` (classified as retain/export by `feat/recurring-reimbursements`, merged to main as PR #133 during this work and staged there — CHECK `(deleted_at is null) = (deleted_by is null)` makes a closure soft-delete impossible, so retain is right), `ads_conversion_events`, `tryops_demo_bindings`, `tryops_demo_trials`, `tryops_health_notifications`, `tryops_outcomes`, `tryops_signup_bindings`, `tryops_trial_links`. All 15 are absent from `database.types.ts`.

Closure defect: `private.enforce_expense_accounting_authority`, `private.enforce_expense_accounting_related_authority` and `private.enforce_expense_recurring_line_authority` treat maintenance as `v_role='service_role' or (v_role is null and session_user='postgres')`. PostgREST ≥12 never sets `request.jwt.claim.role`; `purge_company_data` clears `request.jwt.claims` under login `authenticator`. Every closure of a company with an allocation or a live expense raises 42501 and rolls back (3 of 55 live companies today; none attempted since 2026-09-15). Only `purge_company_data` produces empty claims inside an API session (all seven claim-writing functions enumerated).

Closure side effects: tombstoning an approved expense appends reversal/review events and private state; deleting allocations queues the DEFERRABLE INITIALLY DEFERRED `zz_capture_expense_accounting_allocation`, which re-creates private state (and review events) at COMMIT.

## Decisions

- All seven: company scope, uuid, `softDeletable:false`, `deleteStrategy:"hard"`, `export:false`. Mappings/settings hold only provider-internal IDs for one connection — same shape and treatment as `supplier_bill_*_mappings`. Events and postings are posting-pipeline ledgers and provider bookkeeping (as `supplier_bill_events`, `supplier_bill_provider_links`, `accounting_sync_events`); OPS is not the books of record, the expenses themselves are exported and tombstoned, and no referential or OPS-own obligation justifies retention. Retained set unchanged apart from mirroring `expense_recurring_reimbursements`.
- Order: the six connection-bound tables before `accounting_connections`/`accounting_sync_queue`; `expense_accounting_events` immediately after `expenses`.
- `purge_company_rows('expense_accounting_events')` flushes the deferred allocation capture (`SET CONSTRAINTS public.zz_capture_expense_accounting_allocation IMMEDIATE`, only when that constraint trigger exists), deletes `private.expense_accounting_state` for the company, then the ledger.
- Authority triggers additionally treat empty `request.jwt.claims` as maintenance — the contract `private.enforce_expense_edit_authority` and `purge_company_data` already document.
- Marketing machinery: `ads_conversion_events`, `tryops_demo_trials`, `tryops_outcomes`, `tryops_trial_links` company-scoped hard/no export; `tryops_demo_bindings`, `tryops_signup_bindings` parent-scoped via `users.actor_id` (signup `company_id` is null until attachment); `tryops_health_notifications` parent-scoped via `notifications.notification_id` (NO ACTION FK would otherwise block the notification purge).
- `MANIFEST_VERSION = "2026-09-17.2"` — the recurring reimbursement branch merged first (PR #133) and production already emits `2026-09-17`; a same-day revision suffix keeps every receipt unambiguous. Release order: both migrations applied before the web change deploys (web-first makes every closure fail at the new definer steps).

---

### Task 1: Snapshots from production

**Files:** Modify `src/lib/data/company-data-scope-snapshot.ts`, `src/lib/data/company-data-privilege-snapshot.ts`.

1. Replace `IN_SCOPE_SNAPSHOT` wholesale with the 282-name live output; update the verified line and additions note.
2. Replace `SERVICE_ROLE_BLOCKED_TABLES` wholesale with the 44-row live output; update counts from a live base-table count.
3. Run `./node_modules/.bin/vitest run tests/integration/company-data-manifest.test.ts` — expect FAIL listing exactly the 15 unaccounted tables and the two unroutable ledgers (red proof).

### Task 2: Authority maintenance migration

**Files:** Create `supabase/migrations/20260917050651_expense_authority_account_closure.sql`.

1. Guard: `current_user='postgres'`; each function md5 ∈ {live, target}.
2. `CREATE OR REPLACE` each function from its exact live `pg_get_functiondef`, changing only the maintenance condition to `(v_role is null and (session_user='postgres' or coalesce(current_setting('request.jwt.claims',true),'')=''))`.
3. Re-assert revokes; post-check target md5s and trigger attachment.

### Task 3: Definer purge migration

**Files:** Create `supabase/migrations/20260917050826_expense_accounting_company_data_lifecycle.sql`.

1. Guard: postgres; `purge_company_rows` md5 ∈ {`b549970fec8be3a60c85f3a5987cac72`, target}; ledgers exist with service_role SELECT-only; private state table and constraint trigger exist.
2. Replace `purge_company_rows`: allowlist + `expense_accounting_postings`, `expense_accounting_events`; events branch = flush, erase state, delete. Everything else byte-identical.
3. Revoke/grant EXECUTE service_role only; comment "forty-four"; post-check md5.

### Task 4: Manifest, tests

**Files:** Modify `src/lib/data/company-data-manifest.ts`, `tests/integration/company-data-manifest.test.ts`.

1. Add failing expectations first: expense accounting lifecycle describe (classification, definer set, ordering, final-migration events branch), authority maintenance describe (final migration bodies), marketing machinery describe, retained-set line.
2. Run — FAIL.
3. Add entries (positions above), DEFINER_PURGED entries, UNTYPED allowlist (15), header prose/counts, version bump.
4. Run manifest test — PASS. Run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo $?` — expect only the 6 known test-file errors.
5. Commit in atomic slices (snapshots+manifest+tests; each migration with its tests).

### Task 5: Disposable PostgreSQL proof

**Files:** Create `scripts/test-company-data-purge-expense-postgres.sh`, `tests/sql/company-data-purge-expense-fixture.sql`, `tests/sql/company-data-purge-expense-fidelity.sql`, `tests/integration/company-data-purge-expense-postgres-runtime.test.ts`.

1. Template database: existing expense fixture/constituent chain (as `scripts/test-expense-correction-postgres.sh`) + recurring live objects + purge migrations + PostgREST roles (`authenticator` login, service_role BYPASSRLS) + prod service_role grants + prod FKs among harness tables.
2. Fidelity: md5 of every closure-path function equals production.
3. Runtime (vitest, gated `OPS_RUN_COMPANY_PURGE_POSTGRES=1`): plan = `transactionalPurgePlan()` filtered to harness tables in manifest order; closure runs as `authenticator` → `service_role` with service claims, then COMMIT.
   - Control on unrepaired DB with the production-manifest plan → 42501 `Expense access denied` (reproduces prod).
   - Authority fix only + production-manifest plan → postings block `accounting_connections` (23503); without postings → events/state left behind.
   - Repaired DB, events step moved before `expenses` → leftovers; constraint trigger renamed (no flush) → state re-created at COMMIT.
   - Repaired DB, real order → zero target rows in all purged tables incl. private state after COMMIT; tombstones and retained rows intact; bystander fingerprint unchanged.
4. Regression: `tests/sql/expense-accounting-runtime.sql` and `tests/sql/expense-correction-runtime.sql` on unrepaired vs repaired live-faithful DBs — identical pass counts.
5. Commit harness.

### Task 6: Bible

**Files:** `ops-software-bible/03_DATA_ARCHITECTURE.md` (company-data lifecycle for expense accounting, Try OPS and ads tables, closure defect, release order, proof), `ops-software-bible/migrations/pending/` (byte-identical mirrors). Commit by name only.
