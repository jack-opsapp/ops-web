# Phase C Lead Intelligence P1-16 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Make linked email correspondence converge on a refreshed lead summary, an auditable evidence-bound lifecycle decision, guarded exactly-once conversion when clearly won, and a canonical bilateral-event handoff without booking a provider calendar.

**Architecture:** A database-owned Phase C workload is inserted atomically from meaningful correspondence and remains pending until summary, lifecycle, conversion/review, and event-handoff outcomes are durably acknowledged. Immutable decision receipts precede mutations. A source-event high-water mark lets newer correspondence advance active stages while preserving later explicit corrections. Existing guarded conversion remains the only project-creation path. Calendar work stops at a canonical OPS handoff envelope for P1-17.

**Tech Stack:** Next.js 15, TypeScript, Supabase/Postgres, Vitest, Swift/iOS client models.

**Design System:** N/A. This work changes backend contracts and existing attachment provenance models; it adds no interface or styling.

**Required Skills:** custom-skills:executing-plans, superpowers:test-driven-development, superpowers:systematic-debugging, supabase:supabase, supabase:supabase-postgres-best-practices, custom-skills:mobile-ux-design, superpowers:verification-before-completion.

---

### Task 1: Lock the durable Phase C database contract

**Files:**
- Create: `supabase/migrations/20260820*_phase_c_lead_intelligence_workload.sql`
- Create: `tests/unit/supabase/phase-c-lead-intelligence-workload-migration.test.ts`

1. Write failing contract tests for the workload, immutable decisions, evidence-bound stage apply, durable reviews, bilateral handoffs, claim/lease/retry behavior, RLS, grants, and supporting indexes.
2. Generate the migration with `supabase migration new` and implement the smallest schema/RPC contract that satisfies those tests.
3. Run only the migration contract test and commit the database contract atomically.

### Task 2: Preserve summary work until a canonical result commits

**Files:**
- Modify: `src/lib/api/services/lead-summary-service.ts`
- Modify: `tests/integration/lead-summary-refresh-cron.test.ts`
- Modify: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`

1. Replace the existing model-contract terminal test with a failing retry-persistence assertion.
2. Keep every refusal, contract failure, provider outage, write conflict, and crash-recoverable result in the pending set; acknowledge only a canonical summary write or an explicit non-material terminal result.
3. Prove Crystal's material reply remains queued until the summary refresh succeeds.
4. Commit the summary durability repair.

### Task 3: Persist lifecycle decisions and apply evidence-bound stage movement

**Files:**
- Create: `src/lib/email/phase-c-lifecycle-decision.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`
- Modify: `tests/sql/lead-assignment-contract.sql`

1. Write failing tests that require a proposed-stage receipt with confidence, reason, and source/evidence IDs before the guarded stage RPC.
2. Route active-stage changes through the new evidence-bound RPC. Older or same-boundary evidence must preserve an explicit correction; strictly newer evidence may advance monotonically.
3. Prove the Crystal thread moves `quoted -> negotiation` despite the historical manual flag, while terminal/manual-later corrections remain fenced.
4. Commit the auditable stage repair.

### Task 4: Converge won decisions through the guarded conversion path

**Files:**
- Modify: `src/lib/api/services/conversation-state/acceptance-evaluation.ts`
- Create or modify focused tests under `tests/unit/inbox/conversation-state/` and `tests/unit/email/`.

1. Write failing tests for clearly won primary/subcontact/co-owner correspondence, exactly-once replay, and ambiguous identity/authority/acceptance.
2. Persist a decision before invoking `ProjectConversionService`; use the existing guarded conversion path only for clearly authorized acceptance.
3. Persist a durable review outcome for ambiguity instead of silently returning or creating a project.
4. Prove Crystal is negotiation only: no conversion.
5. Commit the conversion/review orchestration.

### Task 5: Correct administrative classification and relationship matching

**Files:**
- Modify: `src/lib/email/opportunity-correspondence-classifier.ts`
- Modify: `src/lib/email/opportunity-relationship-matching.ts`
- Modify: `tests/unit/email/opportunity-correspondence-classifier.test.ts`
- Modify: `tests/unit/email/opportunity-relationship-matching.test.ts`

1. Add failing fixtures for landlord/internal/property administration, exact primary/subcontact/co-owner linkage, duplicate/ambiguous exact emails, address qualification, and prohibited name-only matching.
2. Add deterministic administrative skip/review handling and exact persisted relationship authority without weakening ambiguity fences.
3. Commit the classification and identity repair.

### Task 6: Emit the bilateral-event handoff for P1-17

**Files:**
- Create: `src/lib/email/bilateral-event-handoff.ts`
- Create: `tests/unit/email/bilateral-event-handoff.test.ts`
- Modify: Phase C lifecycle orchestration only as required to persist the envelope.

1. Write failing tests for explicit proposal plus explicit acceptance, counterproposal plus acceptance, quoted-text exclusion, unresolved date/time/timezone, duplicate/replay, Crystal's call request, and arbitrary inbound calendar text.
2. Extract event title, date/time/timezone, location, attendees, lead, proposal evidence, and acceptance evidence only when both parties explicitly agree.
3. Persist one idempotent `ready` envelope or an explicit `review` reason. Do not create `site_visits`, calendar events, or provider records.
4. Commit the P1-17 handoff boundary.

### Task 7: Preserve exact activity and direction for lead attachments

**Files:**
- Create: a focused additive Supabase migration updating the safe lead-attachment RPC.
- Modify: `tests/unit/supabase/email-attachment-lead-files-client-access-migration.test.ts`
- Modify in an isolated iOS worktree: `OPS/ViewModels/LeadDetailViewModel.swift`
- Modify in an isolated iOS worktree: `OPS/Views/Leads/Components/LeadAttachmentPresentation.swift`
- Modify focused iOS tests.

1. Write failing web migration tests that require `activity_id`, `direction`, and inline provenance from the exact joined activity.
2. Return the provenance through the authorized RPC without changing attachment ownership semantics.
3. Write failing Swift tests, then require inbound, non-inline, stored image provenance for Lead Photos and expose exact activity grouping.
4. Check active Xcode/Swift jobs, use one isolated DerivedData path, and run one focused test process only if genuinely required.
5. Commit web and iOS attachment changes separately.

### Task 8: Document and verify the final contract

**Files:**
- Modify in an isolated Bible worktree: `03_DATA_ARCHITECTURE.md`
- Modify in an isolated Bible worktree: `04_API_AND_INTEGRATION.md`
- Modify in an isolated Bible worktree: `07_SPECIALIZED_FEATURES.md`
- Modify in an isolated Bible worktree: `10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

1. Document the durable workload, decision receipts, correction boundary, conversion/review fence, identity/classification rules, bilateral envelope, attachment provenance, and P1-17 ownership.
2. Run the complete focused P1-16 Vitest set one process at a time, plus static checks appropriate to changed files.
3. Inspect diffs/status in all worktrees, commit docs atomically, and report local/pushed/deployed/released state separately.
