# Quoted Email Project Photo Repair Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Prevent owner-authored images carried inside quoted replies from becoming project photos, and guarantee one email-origin project photo per exact image content hash.

**Architecture:** Filter Gmail inline MIME parts whose content IDs exist only inside structurally quoted HTML before attachment persistence. Add the authoritative safeguard in Postgres: an inbound image is ineligible when the same bytes appeared earlier on an outbound message in the same provider thread or attributed opportunity, and only the earliest eligible inbound attachment for an opportunity/content hash may materialize. A partial unique index protects the project/hash invariant under concurrency, while the existing revocation and object-cleanup ledgers converge previously published mistakes safely.

**Tech Stack:** TypeScript, Vitest, Gmail MIME payloads, Supabase Postgres 17, PL/pgSQL, Supabase Storage cleanup ledger.

**Design System:** N/A — no UI or user-facing copy changes.

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`, `custom-skills:writing-plans`, `custom-skills:executing-plans`, `supabase:supabase`, `superpowers:verification-before-completion`.

---

### Task 1: Reject quote-only Gmail inline images at enumeration

**Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`.

**Files:**

- Modify: `tests/unit/email/gmail-provider-attachments.test.ts`
- Modify: `src/lib/api/services/providers/gmail-provider.ts`

**Design tokens:** N/A.

**Step 1: Write the failing provider regression tests**

Add a Gmail MIME fixture containing one newly authored inline image and one inline image referenced only inside `<div class="gmail_quote">`. Assert that exact-message and thread enumeration retain the new image and omit the quote-only image. Add a case where the same CID is referenced outside and inside the quote, and assert it remains eligible.

**Step 2: Run the focused test and verify RED**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/unit/email/gmail-provider-attachments.test.ts
```

Expected: FAIL because quote-only inline MIME parts are currently returned.

**Step 3: Implement the minimal structural filter**

Decode the message HTML already available in the Gmail payload, collect normalized `cid:` references before and after `stripQuotedHtml`, derive the quote-only CID set, and skip only inline parts whose `Content-ID` is exclusive to quoted HTML. Preserve ordinary file attachments, CID-less images, and CIDs referenced in the newly authored body.

**Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: all Gmail attachment tests pass.

### Task 2: Enforce outbound provenance and content deduplication in Postgres

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`.

**Files:**

- Create: `tests/unit/supabase/quoted-email-photo-provenance-dedup-migration.test.ts`
- Modify: `supabase/migrations/20260811232704_quoted_email_photo_provenance_dedup.sql`

**Design tokens:** N/A.

**Step 1: Write failing migration-contract tests**

Assert that the new migration:

- centralizes source eligibility in a private function;
- rejects an inbound image when identical bytes appeared earlier outbound in the same company and either the same connection/provider thread or the same attributed opportunity;
- keeps only the earliest eligible inbound attachment for a company/opportunity/content hash;
- rechecks that eligibility at queue insertion, reconciliation, trigger-driven sibling reconciliation, job identity validation, and completion;
- adds a partial unique index for one materializing job per company/project/source hash;
- revokes existing ineligible or duplicate projections through the durable cleanup ledger;
- retains service-only execution privileges for public worker RPCs.

**Step 2: Run the focused migration test and verify RED**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/unit/supabase/quoted-email-photo-provenance-dedup-migration.test.ts
```

Expected: FAIL because the generated migration is empty.

**Step 3: Implement the migration**

Create private base-eligibility and source-eligibility functions with exact activity identity, earlier-outbound provenance, and canonical-earliest-inbound checks. Replace the conversion enqueue/reconcile/completion guards to call the shared predicate. Reconcile all same-hash siblings when either attachment or activity identity changes. Revoke pre-existing ineligible/duplicate jobs before creating the partial unique index, using the existing revocation function so photos hide immediately and Storage cleanup remains durable.

**Step 4: Compile the migration in a rolled-back production transaction**

Execute the migration body against project `ijeekuhbatykdomumfjx` inside `BEGIN ... ROLLBACK`, then verify no migration history or schema state changed. Expected: SQL compiles and the transaction rolls back completely.

**Step 5: Run focused tests and verify GREEN**

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/unit/supabase/quoted-email-photo-provenance-dedup-migration.test.ts tests/unit/supabase/email-conversion-photo-materialization-migration.test.ts tests/unit/email/email-conversion-photo-worker.test.ts
```

Expected: all tests pass.

### Task 3: Document the corrected source-of-truth behavior

**Skills:** `supabase:supabase`.

**Files:**

- Modify: the exact email attachment/project photo section found under `/Users/jacksonsweet/Projects/OPS/ops-software-bible/`

**Design tokens:** N/A.

**Step 1: Locate the canonical email attachment/project photo section**

Search the bible for `email_conversion_photo_jobs`, `email_attachments`, and `project_photos`. Preserve unrelated documentation.

**Step 2: Document the invariants**

Record that reply-envelope direction does not establish MIME-part authorship; earlier outbound byte identity in the same provider thread disqualifies a later inbound copy; and email conversion materializes at most one project photo per source content hash.

**Step 3: Verify documentation consistency**

Search the bible for contradictory claims that every attributed inbound image becomes a project photo and correct only the canonical section.

### Task 4: Full verification and atomic commit

**Skills:** `superpowers:verification-before-completion`.

**Files:**

- Verify all modified files from Tasks 1–3.

**Design tokens:** N/A.

**Step 1: Run focused regression tests**

Run all Gmail attachment, conversion-photo worker/runtime, and migration tests.

**Step 2: Run static verification**

Run TypeScript type-check, formatting check on changed TypeScript files, and Supabase migration-list verification. Inspect the full diff and confirm the original dirty checkout remains untouched.

**Step 3: Run database security advisors**

Run Supabase security and performance advisors; distinguish pre-existing findings from new findings and fix any introduced by this migration.

**Step 4: Commit atomically**

Stage only the repair files and commit with:

```bash
git commit -m "fix(email): reject quoted owner photos"
```

Do not push or deploy.

### Task 5: Remove Mark Smith's five incorrect production photos

**Skills:** `supabase:supabase`, `superpowers:verification-before-completion`.

**Files:**

- No repository files.

**Design tokens:** N/A.

**Step 1: Re-resolve the live targets**

Read back the active project, the five `project_photos`, their conversion jobs, source and processed hashes, object ledger rows, and the original outbound/inbound activities. Abort if the exact expected identity no longer holds.

**Step 2: Revoke only the exact five projections**

Invoke the existing private revocation path for those exact job IDs. This soft-deletes the five gallery rows immediately and places only their mapped Storage objects on the durable cleanup queue.

**Step 3: Independently verify the write**

Read back the project gallery, jobs, object ledgers, and unaffected project data. Confirm zero active copies remain and report whether physical object deletion is complete or still queued for the scheduled worker.
