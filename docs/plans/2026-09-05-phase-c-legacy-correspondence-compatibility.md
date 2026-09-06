# Phase C Legacy Correspondence Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Let Phase C process current message-backed correspondence without failing on older projected events that deliberately have no provider-message identity.

**Architecture:** Keep the existing strict activity/message identity checks for every ordinary event. Before building model and appointment context, exclude intentional `legacy_*` projections with no provider message ID because they cannot be represented as `NormalizedEmail` or `PhaseCEventMessage`; continue requiring the current `requiredEventId` to be projected and message-backed, so missing or corrupt current evidence still fails closed.

**Tech Stack:** TypeScript, Next.js server runtime, Supabase query adapter, Vitest.

**Design System:** N/A — backend-only repair.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion`.

---

### Task 1: Lock the production failure into a regression test

**Skills:** Use `superpowers:test-driven-development` and preserve the exact durable-event trust boundary.

**Files:**

- Modify: `tests/unit/api/phase-c-lead-intelligence-work-runtime.test.ts`

**Step 1: Write the failing test**

Add an event-handoff worker case with two projected meaningful events: an older `legacy_thread_email` event whose `activity_id` and `provider_message_id` are null, plus the current required event with an exact activity and provider message. Assert the worker completes and the handoff evaluator receives only the current message-backed event.

**Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run tests/unit/api/phase-c-lead-intelligence-work-runtime.test.ts`

Expected: FAIL with `Phase C activity evidence missing for event event-legacy`.

### Task 2: Exclude non-message legacy projections from message context

**Skills:** Use `superpowers:systematic-debugging`; keep every existing identity conflict check unchanged.

**Files:**

- Modify: `src/lib/api/services/phase-c-lead-intelligence-work-runtime.ts`

**Step 1: Implement the minimal repair**

Build normalized message context without intentional `legacy_*` projections that lack `provider_message_id`. Do not suppress the same malformed shape for ordinary events, and do not weaken `exactActivityForEvent`, the current required-event projection/message check, company/opportunity scoping, or activity identity validation.

**Step 2: Run the focused test to verify it passes**

Run: `npm test -- --run tests/unit/api/phase-c-lead-intelligence-work-runtime.test.ts`

Expected: PASS.

**Step 3: Run adjacent Phase C contract tests**

Run: `npm test -- --run tests/unit/email/phase-c-lifecycle-decision.test.ts tests/unit/email/phase-c-bilateral-event-handoff.test.ts tests/unit/api/phase-c-lead-intelligence-work-service.test.ts`

Expected: PASS.

### Task 3: Document and verify the repaired contract

**Skills:** Use `superpowers:verification-before-completion`.

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`

**Step 1: Update the Phase C runtime contract**

Record that durable correspondence projections without provider-message identity remain lifecycle history but are not converted into message/model or appointment context; exact activity/message identity validation remains mandatory for message-backed events.

**Step 2: Verify the changed vertical**

Run the focused and adjacent tests, TypeScript-check the two changed TypeScript files where supported by the repository tooling, inspect the diff, and confirm no production database rows, provider state, deployment, or release were changed.

**Step 3: Commit the repair atomically**

In OPS-Web, stage only the plan, runtime, and test changes that belong to this repair and commit with `fix(phase-c): tolerate legacy correspondence projections`. In the separately versioned software-bible repository, stage only `04_API_AND_INTEGRATION.md` and commit its matching contract update independently.
