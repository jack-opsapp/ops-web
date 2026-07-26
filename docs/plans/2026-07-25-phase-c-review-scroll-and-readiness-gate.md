# Phase C Review Scroll and Readiness Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Keep the guided catalog review fully reachable at every supported viewport and prevent Phase C from entering review until supplier-specific commercial values are confirmed by the operator.

**Architecture:** Give the full-height `/catalog/setup` route one explicit, bounded vertical scroll owner around the guided surface. At the supplier-adapter boundary, derive customer prices, labor costs, minimum charge, tax rate, and task type from confirmed facts and the live snapshot; if any required commercial fact is absent, replace a premature model review with one deterministic follow-up question instead of accepting model-authored values.

**Tech Stack:** Next.js 15, React, TypeScript, Tailwind tokens, Vitest, Testing Library, Supabase-backed durable guided sessions.

**Design System:** `.interface-design/system.md` and `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`

**Required Skills:** `superpowers:systematic-debugging`, `custom-skills:wizard-audit`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter`, `superpowers:test-driven-development`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`

---

### Task 1: Prove the full-height review has no scroll owner

**Skills:** `superpowers:systematic-debugging`, `custom-skills:wizard-audit`, `superpowers:test-driven-development`

**Files:**

- Modify: `src/components/catalog/setup/__tests__/catalog-setup-route.test.tsx`
- Modify: `src/components/catalog/setup/catalog-setup-route.tsx`

**Design tokens:** Existing layout tokens only: `min-h-0`, `flex-1`, `overflow-y-auto`, `scrollbar-hide`.

1. Add a route-level regression test that requires a named guided scroll region with bounded flex sizing and vertical overflow.
2. Run the focused test and confirm it fails because the current route mounts `GuidedCatalogSetup` directly inside a full-height, overflow-hidden dashboard frame.
3. Add one route-level scroll owner around the guided setup surface. Do not add nested scrolling inside the review card.
4. Re-run the focused test and confirm it passes.

### Task 2: Prove supplier review cannot invent missing commercial values

**Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`

**Files:**

- Modify: `src/lib/catalog-setup/phase-c/__tests__/turn-service-canonicalization.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/turn-service.ts`
- Modify: `src/lib/catalog-setup/agent/setup-agent-service.ts`

1. Add a regression showing that a DekSmart model review cannot advance when confirmed facts omit the 60 mil price, both labor costs, or GST rate—even when the model places plausible numbers in its actions.
2. Add a regression showing that confirmed facts override conflicting model action values and produce `$11.73`, `$12.73`, `$2.00`, `$2.25`, and `5%`.
3. Run the focused tests and confirm both fail against the current model-action-derived canonicalizer.
4. Add a deterministic missing-commercial-facts question using terse product copy. Keep it supplier-specific only after the supplier adapter is explicitly active.
5. Build the verified desired structure from confirmed facts and the live task-type snapshot, never from model-authored action prices or costs.
6. Re-run the focused tests and confirm they pass.

### Task 3: Verify the operator can understand and reach the approval action

**Skills:** `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:wizard-audit`, `custom-skills:audit-design-system`

**Files:**

- Verify: `src/components/catalog/setup/catalog-setup-route.tsx`
- Verify: `src/components/catalog/setup/guided-catalog-setup.tsx`
- Verify: `src/i18n/dictionaries/en/catalog-setup.json`

1. Run the guided component and route tests.
2. Render the review at the reported desktop viewport and confirm the page scroll reaches all product cards, issues, and `BUILD CATALOG`.
3. Confirm the interview remains the active surface after supplier selection when commercial facts are missing.
4. Audit touched UI code for hardcoded color, spacing, radius, and font values. Preserve the existing OPS review hierarchy and single accent CTA.

### Task 4: Ship and repair the active Canpro test session

**Skills:** `superpowers:verification-before-completion`

**Files:**

- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md`

1. Update the Bible with the commercial-fact readiness boundary and full-height scroll-owner rule.
2. Run all Phase C and guided catalog tests, TypeScript, and the production build.
3. Commit the web fix atomically and push only with the user’s existing deployment authorization for this ongoing catalog test.
4. Wait for the production deployment to become `READY`.
5. After deployment, replace Canpro’s incorrect review state with the missing-commercial-values question using an optimistic version/status/hash guard. Preserve all confirmed facts and sources.
6. Read back the active session and verify it is interviewing, contains the correct question, and has no proposed plan ready for approval.
