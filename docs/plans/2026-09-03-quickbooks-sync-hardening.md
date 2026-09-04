# QuickBooks Bidirectional Sync Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Remove the five correctness failures reproduced against the Maverick QuickBooks sandbox and eliminate payment-driven invoice write amplification.

**Architecture:** Keep all provider writes queue-owned. Repair payment-derived invoice state and queue dependency selection in one additive PostgreSQL migration, expose a service-role-only least-recently-reconciled candidate RPC for fair bounded reads, and make overlength QuickBooks document numbers collision-resistant in the pure payload mapper. The production migration and deployment remain release-gated.

**Tech Stack:** Next.js 15, TypeScript, Vitest, Supabase/PostgreSQL 17, QuickBooks Online API.

**Design System:** `.interface-design/system.md` (no UI changes).

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `supabase:supabase`, `custom-skills:executing-plans`, `superpowers:verification-before-completion`.

---

### Task 1: Collision-resistant QuickBooks document numbers

**Skills:** `superpowers:test-driven-development`

**Files:**

- Modify: `src/lib/api/services/__tests__/qbo-push-mappers.test.ts`
- Modify: `src/lib/api/services/qbo-push-mappers.ts`

**Design tokens:** N/A.

1. Add failing invoice and estimate tests proving two records with the same first 21 characters produce distinct, deterministic document numbers no longer than 21 characters.
2. Run the mapper tests and verify the new assertions fail because both payloads currently use the same truncated prefix.
3. Add a stable record-id suffix only when a document number exceeds QuickBooks' 21-character limit; preserve all shorter numbers unchanged.
4. Run the mapper tests and verify they pass.
5. Commit the mapper and tests atomically.

### Task 2: Atomic payment balance repair and write-amplification suppression

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**

- Create: `supabase/migrations/20260904025000_qbo_bidirectional_sync_hardening.sql`
- Create: `tests/sql/qbo-bidirectional-sync-hardening-postgres17-baseline.sql`
- Create: `tests/sql/qbo-bidirectional-sync-hardening-payment-runtime.sql`
- Create: `tests/sql/qbo-bidirectional-sync-hardening-queue-runtime.sql`
- Create: `tests/sql/qbo-bidirectional-sync-hardening-reconcile-runtime.sql`
- Create: `tests/integration/qbo-bidirectional-sync-postgres-runtime.test.ts`

**Design tokens:** N/A.

1. Build the minimal PostgreSQL 17 baseline with the current payment-balance trigger and queue claim behavior.
2. Add runtime assertions proving the current trigger fails to clear the old invoice when a payment moves, leaves a zero-paid invoice in a paid state, and performs an invoice update for a payment `qb_id`-only writeback.
3. Run the runtime test against the baseline without the new migration and verify the original behaviors fail exactly as observed.
4. Add an additive migration that recalculates both old and new invoice ids, restores a zero-paid invoice to `past_due` or `awaiting_payment` while preserving legitimate draft/sent/terminal states, and narrows the payment trigger to balance-affecting columns.
5. Re-run the exact PostgreSQL 17 test and verify all balance and amplification assertions pass.

### Task 3: Dependency-aware outbound claims

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**

- Modify: `supabase/migrations/20260904025000_qbo_bidirectional_sync_hardening.sql`
- Modify: `tests/sql/qbo-bidirectional-sync-hardening-queue-runtime.sql`

**Design tokens:** N/A.

1. Add a failing runtime case with same-transaction customer create/update queue rows and prove the update can currently claim before its unresolved create.
2. Verify the failure against the baseline implementation.
3. Replace the claim RPC with a dependency-aware definition that excludes non-create work while an unfinished create exists for the same company, connection, provider, entity type, and entity id; retain stale-claim recovery and service-role-only execution.
4. Prove create is claimed first, the dependent update remains pending, and it becomes claimable only after create succeeds.

### Task 4: Fair, tombstone-safe reconciliation

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**

- Modify: `supabase/migrations/20260904025000_qbo_bidirectional_sync_hardening.sql`
- Modify: `tests/sql/qbo-bidirectional-sync-hardening-reconcile-runtime.sql`
- Modify: `tests/integration/qbo-bidirectional-sync-postgres-runtime.test.ts`
- Modify: `tests/integration/qbo-reconcile-route.test.ts`
- Modify: `src/app/api/cron/accounting/quickbooks/reconcile/route.ts`
- Modify: `src/lib/types/database.types.ts`

**Design tokens:** N/A.

1. Add failing route/runtime tests proving a customer-heavy tenant cannot consume the whole batch and inactive/deleted records cannot become reconciliation candidates.
2. Verify the tests fail against the current customer-first table scan.
3. Add a service-role-only candidate RPC that ranks least-recently-reconciled active records, interleaves customer/invoice/estimate/payment lanes, scopes the exact QuickBooks environment, and excludes terminal/tombstoned records.
4. Change the route to consume the bounded RPC result instead of independently exhausting each table in fixed order.
5. Verify all four entity types make progress, unseen records outrank recently reconciled records, and inactive customers are absent.

### Task 5: Documentation and final verification

**Skills:** `superpowers:verification-before-completion`

**Files:**

- Modify: `ops-software-bible/04_API_AND_INTEGRATION.md`
- Modify: `ops-software-bible/09_FINANCIAL_SYSTEM.md`

**Design tokens:** N/A.

1. Update the Software Bible with the payment-state contract, dependent-create claim fence, fair reconciliation candidate selection, tombstone exclusions, and deterministic document-number suffix.
2. Run the focused red-green regressions, the full QuickBooks-focused test pack, PostgreSQL 17 runtime proof, TypeScript type-check, and formatting checks for touched files.
3. Review the migration security boundary: fixed search paths, explicit `PUBLIC`/anon/authenticated revokes, service-role grant only, bounded inputs, and no production application.
4. Inspect the final diff and working-tree status, then commit coherent changes without pushing or deploying.
