# Phase C Mailbox-Aware Wait Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Replace periodic Phase C mailbox-busy retries with a condition-aware durable wait that cannot consume worker capacity indefinitely and opens a persistent operator alert after one hour.

**Architecture:** Add durable `mailbox_busy_since` state to the service-only contact-form draft queue. The claim RPC will identify due work whose physical provider mailbox currently has an active lease, mark it waiting once, and exclude it from claims until the lease is absent; a race after claim remains safely handled by the existing worker error. A deduped persistent notification opens only after one continuous hour of active mailbox contention and resolves automatically when the guarded draft job leaves the wait lifecycle.

**Tech Stack:** PostgreSQL 17, Supabase migrations, Vitest migration/worker contracts

**Design System:** N/A — no UI implementation

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `supabase:supabase`, `ops-copywriter:ops-copywriter`, `superpowers:verification-before-completion`

---

### Task 1: Replace the indefinite-retry regression contract

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**
- Modify: `tests/unit/supabase/email-assignment-contact-form-draft-mailbox-busy-recovery-migration.test.ts`

**Step 1:** Require the prepared migration to add `mailbox_busy_since`, prove an active physical-mailbox lease through a private helper, mark mailbox-blocked work before claim, and exclude active-mailbox rows from the bounded candidate batch.

**Step 2:** Require the failure RPC to preserve the first wait timestamp for acquisition races instead of using unbounded attempt processing.

**Step 3:** Require one deduped persistent notification after one hour with terse product copy and automatic resolution on success, skip, stale assignment, ordinary failure, or reconciliation.

**Step 4:** Run the test and verify RED against the existing five-minute retry-only migration.

### Task 2: Implement condition-aware waiting

**Skills:** `supabase:supabase`, `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`

**Files:**
- Modify: `supabase/migrations/20260802163538_keep_contact_form_mailbox_busy_retryable.sql`

**Step 1:** Add the nullable wait timestamp and a partial operational index without exposing the queue to application roles.

**Step 2:** Add a private, non-exposed helper that checks both the canonical physical-mailbox lease digest and the rolling-deploy public mirror; revoke execution from all application roles.

**Step 3:** Replace the claim RPC with the live verified contract plus a one-time wait transition before claim and an active-lease exclusion in the candidate query.

**Step 4:** Preserve the provider-create reconciliation fence, current assignment checks, exact source/authorization checks, prior-placement proof, and service-role-only public RPC ACLs.

**Step 5:** Open the persistent `Draft waiting for mailbox` notification only after one continuous hour, and resolve it through a private queue trigger when the wait lifecycle ends.

**Step 6:** Recover exact historical mailbox-busy failures into the wait lifecycle only when both provider-create markers are null.

**Step 7:** Run the regression contract until GREEN.

### Task 3: Verify lifecycle behavior

**Skills:** `superpowers:verification-before-completion`

**Files:**
- Test: `tests/unit/supabase/email-assignment-contact-form-drafts-migration.test.ts`
- Test: `tests/unit/email/email-assignment-contact-form-draft-worker.test.ts`
- Test: `tests/unit/email/email-assignment-contact-form-draft-runtime.test.ts`
- Test: `tests/unit/email/email-thread-provider-mailbox-lease.test.ts`
- Test: `tests/unit/api/lead-assignment-deliveries-cron.test.ts`

**Step 1:** Run the focused migration, worker, runtime, mailbox-lease, and cron tests in single-thread/no-cache mode because the workstation data volume is full.

**Step 2:** Run `git diff --check`, review security-definer search paths and ACLs, and confirm no provider send path or live mutation was added.

**Step 3:** Commit the revised web contract atomically.

### Task 4: Keep the OPS Software Bible current

**Skills:** `supabase:supabase`

**Files:**
- Mirror: `migrations/20260802163538_keep_contact_form_mailbox_busy_retryable.sql`
- Modify: `03_DATA_ARCHITECTURE.md`
- Modify: `07_SPECIALIZED_FEATURES.md`
- Modify: `10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

**Step 1:** Replace indefinite-retry wording with mailbox-aware wait, batch-starvation prevention, one-hour escalation, and automatic notification resolution.

**Step 2:** Mirror the exact migration, verify byte identity, and commit the documentation after the web commit.

**Step 3:** Do not push, deploy, apply the migration, or mutate production queue/Gmail records without a separate explicit production authorization.
