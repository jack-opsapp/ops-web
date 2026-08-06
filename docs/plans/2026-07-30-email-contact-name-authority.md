# Email Contact Name Authority Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Make email-derived contact names converge on authoritative customer identity while preserving human edits and keeping generated lead titles in sync.

**Architecture:** Extract conservative signed-name evidence before signature cleaning, carry field-specific evidence through the existing canonical enrichment choke point, and use existing provenance snapshots to govern contact and generated-title replacement. All live, import, historical, and recovery callers inherit the behavior without a new schema.

**Tech Stack:** TypeScript, Next.js, Vitest, Supabase Postgres.

**Design System:** N/A — no UI or user-facing copy changes.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `supabase:supabase`, `superpowers:verification-before-completion`.

---

### Task 1: Signed-name evidence boundary

**Skills:** Test-driven development and systematic debugging.

**Files:**

- Modify: `src/lib/api/services/conversation-state/message-cleaner.ts`
- Modify: `src/lib/api/services/conversation-state/contact-resolver.ts`
- Modify: `src/lib/api/services/conversation-state/types.ts`
- Test: `tests/unit/inbox/conversation-state/message-cleaner.test.ts`
- Test: `tests/unit/inbox/conversation-state/contact-resolver.test.ts`

**Steps:**

1. Add failing tests for the Kevin Falk and James Lam sign-offs.
2. Add failing negative tests for quoted/operator signatures, one-word names, prose, company/role lines, digits, and ambiguous public-domain cases.
3. Run the focused tests and confirm each new test fails for the missing signed-name evidence.
4. Implement a bounded authored-signature parser that returns a full-name candidate without weakening body cleaning.
5. Make `resolveContact` prefer valid inbound signed-name evidence over provisional header/local-part evidence and retain its per-field provenance.
6. Run the focused tests and confirm they pass.

### Task 2: Field-specific name precedence

**Skills:** Test-driven development.

**Files:**

- Modify: `src/lib/email/lead-enrichment.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Test: `tests/unit/email/lead-enrichment.test.ts`
- Test: `tests/unit/email/lead-enrichment-provenance.test.ts`

**Steps:**

1. Add failing tests proving signature evidence replaces `falkks` and `Jtblam`.
2. Add failing tests proving exact linked-client evidence promotes only across the same normalized email, signed full names outrank it, and equal/weaker headers, stale snapshots, confirmed fields, unrelated email/phone evidence, retries, and out-of-order messages cannot replace canonical names.
3. Add an optional contact-name evidence payload to enrichment facts.
4. Map resolved name provenance into that payload, admit exact linked-client evidence only behind the same-email fence, and do not raise confidence for unrelated fields.
5. Apply source/confidence per written field and persist exact provenance.
6. Run the focused tests and confirm red-green completion.

### Task 3: Generated-title synchronization

**Skills:** Test-driven development.

**Files:**

- Modify: `src/lib/email/opportunity-title.ts`
- Modify: `src/lib/email/lead-enrichment.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `src/app/api/integrations/email/import/route.ts`
- Modify: `src/app/api/integrations/gmail/historical-import/route.ts`
- Test: `tests/unit/email/email-opportunity-title-live-pattern.test.ts`
- Test: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`
- Test: `tests/unit/email/lead-enrichment-provenance.test.ts`
- Test: `tests/integration/email-opportunity-title-routes.test.ts`

**Steps:**

1. Add failing tests for inquiry/estimate title correction and mailbox-handle fallback suppression.
2. Add failing tests proving arbitrary and snapshot-diverged human titles remain unchanged.
3. Implement generated-title parsing/rewriting with normalized identity matching for legacy rows.
4. Persist a `title` provenance snapshot on creation and automatic correction.
5. Route title correction through canonical enrichment so sync/import/recovery callers cannot bypass it.
6. Run all title and enrichment tests.

### Task 4: End-to-end caller and recovery coverage

**Skills:** Test-driven development and systematic debugging.

**Files:**

- Modify: relevant sync/import/recovery tests discovered during execution.
- Test: `tests/unit/email/sync-engine-ingestion-recovery-wiring.test.ts`
- Test: `tests/unit/email/gmail-historical-import-provider-ids.test.ts`
- Test: `tests/integration/email-opportunity-title-routes.test.ts`

**Steps:**

1. Add regression cases for live inbound sync, linked-thread reuse, exact-message replay, historical import, and contact-form precedence.
2. Confirm recovery and retries call the shared enrichment boundary and remain idempotent.
3. Confirm actual external recipients remain eligible customer contacts and staff/operator signatures cannot supply their names.
4. Run focused end-to-end suites.

### Task 5: Documentation and verification

**Skills:** Supabase read-only verification and verification before completion.

**Files:**

- Modify: `../ops-software-bible/03_DATA_ARCHITECTURE.md`
- Modify: `../ops-software-bible/04_API_AND_INTEGRATION.md`
- Create or modify: guarded repair documentation under `docs/`.

**Steps:**

1. Update the Bible with the name-evidence ladder, title provenance behavior, and recovery semantics.
2. Confirm no generated database type change is required.
3. Run focused tests, broader email/conversation-state suites, typecheck, lint, and production build.
4. Inspect the final diff for unrelated changes, placeholders, and unsafe mutations.
5. Perform read-only live shadow evaluation for Falkks, Jtblam, and a bounded suspicious-name sample.
6. Commit coherent atomic changes with conventional messages.
7. Report the exact approval-only release and guarded production-repair sequence; do not push, deploy, or mutate production without explicit approval.
