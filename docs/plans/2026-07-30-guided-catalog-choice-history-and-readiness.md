# Guided Catalog Choice History and Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Keep every quick-answer choice in chronological chat history and ensure Phase C asks only concrete questions for released OPS capabilities.

**Architecture:** Fix transcript normalization at the durable conversation layer so a session-version bump cannot synthesize a duplicate current question after a queued operator message. Remove the meta review-readiness intent from the released question manifest, add a server-owned material-scope question for the supported staff-managed or fixed-quantity paths, and repair affected active sessions when they are next resumed without touching live catalog records.

**Tech Stack:** TypeScript, Next.js 15, Zod, Vitest, React Testing Library, Supabase session persistence

**Design System:** `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:wizard-audit`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`

---

### Task 1: Preserve chronological transcript order

**Skills:** `superpowers:test-driven-development`

**Files:**
- Modify: `src/lib/catalog-setup/phase-c/__tests__/conversation-history.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/__tests__/turn-service-revision.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/conversation-history.ts`

**Design tokens:** N/A — state behavior only.

1. Add a regression test for a persisted assistant question followed by a queued operator choice at a newer session version.
2. Run the focused tests and verify the transcript contains one copy of the answered question and keeps the operator choice immediately after it.
3. Update normalization to recognize the already-persisted current question independently of the session version while preserving legitimate refined repeats.
4. Re-run the focused tests and commit the passing behavior.

### Task 2: Replace the invalid readiness question with released capability choices

**Skills:** `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`, `custom-skills:wizard-audit`

**Files:**
- Modify: `src/lib/catalog-setup/phase-c/__tests__/question-policy.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/__tests__/catalog-capability-manifest.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/question-policy.ts`
- Modify: `src/lib/catalog-setup/phase-c/catalog-capability-manifest.ts`
- Modify: `src/lib/catalog-setup/agent/setup-agent-service.ts`

**Design tokens:** N/A — server-owned conversational copy only.

1. Add failing tests proving `review_readiness` is not a released operator question and the supported material-scope question offers only staff-managed handling or a fixed material quantity.
2. Run the tests and verify they fail for the current policy.
3. Add the server-owned material-scope intent and remove readiness confirmation from the released capability manifest.
4. Update the Phase C decision policy: return a review blueprint when complete; otherwise ask the next concrete supported question.
5. Re-run the focused policy and agent tests.

### Task 3: Repair affected active sessions safely

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**
- Modify: `src/lib/catalog-setup/phase-c/__tests__/session-service.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/session-service.ts`

**Design tokens:** N/A — session repair only.

1. Add a failing test using the observed production shape: no proposed plan, a `review_readiness` current question, and confirmed roll/sheet inventory facts.
2. Verify the repair test fails before implementation.
3. On normal session resume, replace that invalid meta question with the released material-scope question, preserve the full transcript, remove only unsupported derived session facts, and append an auditable system-repair source.
4. Re-run session-service tests and verify no live catalog tables are written.

### Task 4: Prove the end-to-end guided behavior

**Skills:** `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`

**Files:**
- Modify: `src/components/catalog/setup/__tests__/guided-catalog-setup.test.tsx`

**Design tokens:** Existing conversational composer and transcript tokens only; no visual values change.

1. Add a component regression test that selects a quick answer and verifies the “YOU” turn remains visible before the next Phase C question.
2. Run Guided Catalog Setup component tests.
3. Run the complete Phase C/catalog-related suite.
4. Audit touched UI code for token compliance; no visual styling change is expected.
5. Commit the focused fix. Do not push or deploy without Jackson’s explicit authorization.
