# Email Replay and Intake Owner Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Make shared-mailbox ingestion non-starving and give every new lead an authorized owner or an actionable mobile assignment prompt.

**Architecture:** Persisted correspondence direction is immutable replay authority; current teammate identity applies only to unseen provider messages. One service-role-only transaction creates each new shared-mailbox opportunity and either assigns it from the explicit connection setting through the canonical guard or enqueues durable missing-owner prompts. The existing assignment-delivery cron processes those prompts.

**Tech Stack:** Next.js, TypeScript, Vitest, Supabase Postgres/RLS/RPC, OneSignal, Vercel Cron.

**Design System:** N/A. No new visual surface.

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `supabase:supabase`, `ops-copywriter:ops-copywriter`, `vercel:deployments-cicd`, `superpowers:verification-before-completion`.

---

### Task 1: Preserve persisted direction during normal replay

**Files:**

- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`

**Steps:**

1. Strengthen the fake correspondence RPC so it rejects activity/event identity drift like production.
2. Add the Jake-then-Nick failing replay test and confirm the current engine reports the identity conflict and fails to advance its cursor.
3. Add a fresh internal-message test proving current authoritative teammate identity still wins for unseen messages.
4. Resolve one stable envelope per deduplicated provider message, preferring a valid persisted activity direction.
5. Reuse the envelope for direction partitioning and processor input so every downstream phase sees the same decision.
6. Re-run both tests and the existing sync-engine lifecycle suite.

### Task 2: Add guarded shared-mailbox default assignment

**Files:**

- Create: `supabase/migrations/20260723214524_company_mailbox_intake_owner.sql`
- Modify: `src/lib/types/database.types.ts`
- Modify: `src/lib/types/email-connection.ts`
- Modify: `src/lib/api/services/email-connection-service.ts`
- Modify: `src/lib/api/services/email-thread-service.ts`
- Rename/modify: `src/lib/email/personal-mailbox-lead-assignment.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `tests/unit/email/personal-mailbox-lead-assignment.test.ts`
- Add: `tests/unit/supabase/company-mailbox-intake-owner-migration.test.ts`

**Steps:**

1. Add failing tests for company default success, missing owner, ineligible owner, assignment rollback, retry idempotency, and manual-override protection.
2. Add failing migration-contract tests for the mailbox-only column, strict create payload, same-company guard, derived target, atomic rollback, service-role ACL, new immutable event source, and direct-write protection.
3. Generate the migration with the Supabase CLI, or use the reviewed timestamped path above if the CLI is unavailable in the prepared worktree.
4. Add `default_intake_owner_id` and the service-role-only atomic create-and-disposition RPC.
5. Keep personal-mailbox assignment on its existing guarded path; company-mailbox creation must use only the atomic path.
6. Return an existing source-key winner unchanged, then continue only idempotent downstream replay work.
7. Keep historical import company leads unassigned; do not backfill or route them through the new live path.
8. Re-run helper, migration, Phase C actor, assignment, and email-ingest tests.

### Task 3: Add durable missing-owner assignment prompts

**Files:**

- Extend: `supabase/migrations/20260723214524_company_mailbox_intake_owner.sql`
- Add: `src/lib/api/services/unassigned-lead-assignment-delivery-service.ts`
- Modify: `src/app/api/cron/lead-assignment-deliveries/route.ts`
- Modify: `src/lib/api/services/notification-service.ts`
- Add: `tests/unit/notifications/unassigned-lead-assignment-delivery-service.test.ts`
- Modify: `tests/unit/api/lead-assignment-deliveries-cron.test.ts`
- Extend: `tests/unit/supabase/company-mailbox-intake-owner-migration.test.ts`

**Steps:**

1. Add failing tests for authorized-admin addressing, persistent notification materialization, push preference, idempotency, stale suppression, retry leases, and resolution after assignment.
2. Add the RLS-protected delivery table and service-role-only enqueue/claim/complete/fail functions.
3. Enqueue only a newly created email opportunity that remains null/version zero after default assignment.
4. Implement `Lead needs an owner` / `Assign {lead title}` delivery with the canonical lead deep link.
5. Process the outbox in the existing one-minute assignment cron without coupling push failure to mailbox cursor advancement.
6. Re-run delivery and cron suites.

### Task 4: Documentation and full verification

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/07_SPECIALIZED_FEATURES.md`

**Steps:**

1. Document persisted-direction replay authority, mailbox intake ownership, fallback delivery, and configuration.
2. Run focused regression tests.
3. Run the relevant lifecycle, assignment, notification, and Phase C suites.
4. Run TypeScript checks.
5. Run the production build.
6. Inspect the diff for direct `assigned_to` writes, provider-send changes, secrets, and unrelated files.

### Task 5: Production rollout

**Steps:**

1. Commit the replay fix and assignment/prompt feature atomically.
2. Fetch and reconcile with current `origin/main`.
3. Apply migrations in order and verify migration history, schema, ACLs, and advisors.
4. Configure Canpro's company mailbox intake owner to Jackson through the guarded setting path.
5. Push the verified release to `main` and wait for the production deployment to become READY.
6. Verify runtime errors, cursor advancement, Nick's canonical lead/assignment/draft handoff, and assignment delivery using read-only Gmail/Supabase checks. Do not send, reply, or forward email.
