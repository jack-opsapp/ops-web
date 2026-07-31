# Gmail Sync Recovery Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Restore mailbox cursor advancement after the deployed follow-up migration and make stale-sync alerts describe the real server-side condition without telling an operator to reconnect an authorized Gmail account.

**Architecture:** Replace the deployed follow-up reconciliation RPC with the same guarded, service-only function using an explicit unique-constraint conflict target so PL/pgSQL output variables cannot collide with column names. Keep automatic-project safety holds fail-closed in the durable `commercial_outcome` recovery queue while allowing unrelated mailbox messages to advance, using the recovery wiring already merged in `0f57ea7d`. Split heartbeat presentation by failure reason: expired or incomplete provider setup remains reconnectable; `sync_stale` reports delayed OPS processing and automatic retry.

**Tech Stack:** PostgreSQL/Supabase migrations, Next.js route handlers, React Email, TypeScript, Vitest

**Design System:** N/A — no visual application UI changes

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `supabase:supabase`, `ops-copywriter:ops-copywriter`, `superpowers:verification-before-completion`

---

### Task 1: Lock the PostgreSQL ambiguity into a regression test

**Skills:** `superpowers:test-driven-development`

**Files:**

- Modify: `tests/unit/supabase/pipeline-follow-up-reliability-migration.test.ts`
- Create: `supabase/migrations/20260730220000_fix_manual_outbound_follow_up_conflict_target.sql`

**Step 1:** Add a test that loads the follow-up conflict-target repair migration and requires `ON CONFLICT ON CONSTRAINT opportunity_manual_outbound_cycle_r_correspondence_event_id_key`, while rejecting the ambiguous bare `ON CONFLICT (correspondence_event_id)` form.

**Step 2:** Run the focused migration test and verify it fails because the repair migration does not exist.

**Step 3:** Add a forward-only `CREATE OR REPLACE FUNCTION public.reconcile_manual_outbound_follow_up_cycle_as_system(uuid, uuid, uuid)` migration preserving the deployed guards, locks, lifecycle writes, idempotency receipt, ACLs, and result contract. Change only the insert conflict target to the verified live unique constraint.

**Step 4:** Run the focused migration test and verify it passes.

### Task 2: Lock reason-specific heartbeat behavior into regression tests

**Skills:** `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`

**Files:**

- Modify: `tests/unit/email/email-ingest-heartbeat-route.test.ts`
- Create: `tests/unit/email/inbox-connection-down-template.test.tsx`
- Modify: `src/app/api/cron/email-ingest-heartbeat/route.ts`
- Modify: `src/lib/email/react/templates/InboxConnectionDown.tsx`
- Modify: `src/lib/email/sendgrid.tsx`

**Step 1:** Add a stale active-connection fixture to the heartbeat route test and assert the in-app incident says OPS processing is delayed, reports automatic retry, and uses a neutral inbox-status action instead of `RECONNECT INBOX`.

**Step 2:** Add a real React Email render test proving `sync_stale` has no reconnect instruction or reconnect CTA, while `webhook_expired` still provides the reconnect action.

**Step 3:** Run both focused tests and verify the new assertions fail against current behavior.

**Step 4:** Centralize reason-specific alert presentation. Use terse copy:

- stale title: `Inbox processing is delayed`
- stale body: `<address> is still connected. OPS has not processed recent mail. Automatic retry is active.`
- stale action: `CHECK INBOX STATUS`
- stale email status: `Processing delayed`
- stale email CTA: `Open inbox settings`

Provider-expired and setup-failed incidents retain reconnect wording and deep links.

**Step 5:** Run the focused heartbeat and template tests and verify they pass.

### Task 3: Document the corrected operational contract

**Skills:** `supabase:supabase`

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible-lead-intake-correctness/04_API_AND_INTEGRATION.md`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible-lead-intake-correctness/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

**Step 1:** Document that manual outbound cycle reconciliation targets the named unique receipt constraint and is replay-idempotent.

**Step 2:** Document that active-token `sync_stale` incidents are server-processing alerts, not provider disconnections, and must never instruct the operator to reconnect.

### Task 4: Verify, commit, release, and shadow-check

**Skills:** `superpowers:verification-before-completion`

**Files:**

- Verify all files above

**Step 1:** Run focused migration, heartbeat, template, sync-engine recovery, relationship safety-hold, and follow-up reliability suites.

**Step 2:** Run TypeScript typecheck, lint for changed files, and the production build.

**Step 3:** Review the complete diff, confirm both isolated worktrees contain no unrelated changes, and commit the web and bible changes atomically with conventional messages.

**Step 4:** Apply the reviewed forward migration, release the exact tested web commit under the existing production-release approval, and verify deployment readiness.

**Step 5:** Observe the live mailbox row and Vercel sync route until `last_synced_at` advances, the safety hold is durably queued instead of pinning the cursor, the persistent heartbeat incident resolves, and no new stale warning is emitted. Do not send or modify Gmail.
