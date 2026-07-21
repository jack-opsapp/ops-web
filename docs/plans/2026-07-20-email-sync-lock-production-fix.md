# Email Sync Lock Production Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Restore forward Gmail ingestion by replacing the production-broken PostgREST OR-filter lock claim with one atomic, service-only PostgreSQL operation.

**Architecture:** PostgreSQL owns the compare-and-set lock claim and generates the lease owner UUID. The sync engine calls that RPC, while the existing owner-checked renew and release operations remain unchanged. Gmail sending and auto-send configuration are not touched.

**Tech Stack:** PostgreSQL/Supabase, TypeScript, Vitest, Next.js.

**Design System:** N/A — no UI changes.

**Required Skills:** `supabase:supabase`, `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`.

---

### Task 1: Lock contract regression

**Files:**

- Create: `tests/unit/supabase/email-sync-lock-rpc-migration.test.ts`
- Modify: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`

1. Add a SQL contract test requiring a service-role-only security-definer lock RPC with an atomic stale-or-empty predicate.
2. Add a sync-engine test proving acquisition uses the RPC and never an OR-filtered table PATCH.
3. Run both tests and confirm they fail because the contract is absent.

### Task 2: Minimal production repair

**Files:**

- Create: `supabase/migrations/20260721071828_email_sync_lock_rpc.sql`
- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `src/lib/types/database.types.ts`

1. Add `public.acquire_email_connection_sync_lock_as_system(uuid, integer)` returning the generated owner UUID or `NULL`.
2. Require `service_role`, validate the lease interval, set a locked search path, revoke defaults, and grant only `service_role`.
3. Replace only `acquireSyncLock()` with the RPC call.
4. Run the focused tests and confirm green.

### Task 3: Verification and release

**Files:**

- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md` only if the production contract description needs correction.

1. Parse the migration and function body with PostgreSQL tooling.
2. Run the focused email/lead suite, TypeScript, lint, formatting, and production build.
3. Commit atomically, apply the backward-compatible migration, and verify its signature, grants, and PostgREST result shape.
4. Push to `main` and wait for the production deployment; never deploy the RPC caller before its database contract.
5. Confirm drafts-only mailbox settings remain active.
6. Invoke one authorized sync and require HTTP 200 plus a fresh `last_synced_at`; do not send Gmail.
