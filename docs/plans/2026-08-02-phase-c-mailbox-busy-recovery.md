# Phase C Mailbox-Busy Recovery Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Prevent a legitimate OPS mailbox-lock collision from permanently suppressing an assignment-triggered Phase C Gmail draft, and return all contention-only terminal rows to the existing guarded queue.

**Architecture:** Keep the connection-wide physical-mailbox lease unchanged. Update the service-only database failure RPC so `EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_MAILBOX_BUSY` remains `retrying` regardless of attempt count, with a five-minute cooldown that naturally reaches the next ten-minute worker run after the ten-minute mailbox lease expires. Requeue all historical terminal rows with that exact pre-provider error; the existing claim path will re-check terminal lead state, prior replies, assignment version, mailbox authority, autonomy, and prior provider placement before doing any work.

**Tech Stack:** PostgreSQL 17 / Supabase migrations, Vitest contract tests, Next.js worker runtime

**Design System:** N/A

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `supabase:supabase`, `superpowers:verification-before-completion`

---

### Task 1: Lock the regression contract

**Skills:** `superpowers:test-driven-development`

**Files:**
- Create: `tests/unit/supabase/email-assignment-contact-form-draft-mailbox-busy-recovery-migration.test.ts`

**Step 1:** Write a contract test requiring the corrective migration to:

- special-case the exact mailbox-busy code before the bounded terminal-attempt branch;
- retain `retrying` status at and beyond attempt eight;
- use a five-minute cooldown;
- requeue only rows whose provider-create attempt never began and whose exact terminal error was mailbox contention;
- preserve service-role-only execution and the existing uncertain-provider reconciliation fence.

**Step 2:** Run the test and verify it fails because the corrective migration does not yet exist.

### Task 2: Correct the durable queue semantics

**Skills:** `supabase:supabase`, `superpowers:test-driven-development`

**Files:**
- Create: `supabase/migrations/<generated>_keep_contact_form_mailbox_busy_retryable.sql`

**Step 1:** Generate the migration filename with the Supabase CLI; if the CLI is unavailable, use the repository's established timestamp sequence only after documenting that tooling limitation.

**Step 2:** Replace `fail_email_assignment_contact_form_draft_as_system` with the same authorization, assignment, provider-attempt, and ACL contract plus the mailbox-busy retry classification.

**Step 3:** Add a generalized data repair for exact contention-only `failed` rows. Clear stale queue leases, set them to `retrying`, and leave the prepared Phase C draft/history intact. Do not identify or patch named leads.

**Step 4:** Revoke execution from `PUBLIC`, `anon`, and `authenticated`; grant only `service_role`.

**Step 5:** Run the new test and the existing contact-form migration/worker/runtime tests.

### Task 3: Keep the OPS bible current

**Skills:** `supabase:supabase`

**Files:**
- Mirror: `migrations/<generated>_keep_contact_form_mailbox_busy_retryable.sql`
- Modify: `07_SPECIALIZED_FEATURES.md`
- Modify: `10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

**Step 1:** Document mailbox busy as transport contention, not a provider failure.

**Step 2:** Document the nonterminal cooldown, guarded replay checks, and historical contention-only recovery.

### Task 4: Verify and commit

**Skills:** `superpowers:verification-before-completion`

**Step 1:** Run focused migration, worker, runtime, provider-lease, and cron contract tests.

**Step 2:** Run TypeScript type-check and `git diff --check`.

**Step 3:** Review the complete diff for tenant scope, service-only ACLs, idempotency, and no provider-send path.

**Step 4:** Commit the web change atomically, then commit the bible mirror/docs atomically. Do not push, deploy, apply the migration, or mutate live queue/Gmail state.
