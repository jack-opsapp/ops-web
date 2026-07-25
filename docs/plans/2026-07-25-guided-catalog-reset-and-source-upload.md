# Guided Catalog Reset and Source Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Make Guided Catalog Setup restartable, visually token-correct, and able to feed optional spreadsheet evidence directly to Phase C.

**Architecture:** Keep the durable session as the source of truth. Add a company-scoped abandon operation, a bounded client-side spreadsheet-to-structured-evidence adapter, and focused UI controls around the existing one-question turn endpoint. The live catalog remains untouched until the existing reviewed commit gate.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library, Supabase, OpenAI JSON mode, existing CSV/XLSX parsers.

**Design System:** `.interface-design/system.md`

**Required Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `custom-skills:ops-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:wizard-audit`, `custom-skills:audit-design-system`, `ops-copywriter:ops-copywriter`, `superpowers:verification-before-completion`

---

### Task 1: Truthful guided progress

**Skills:** interface-design, ops-copywriter, test-driven-development

**Files:**
- Modify: `src/components/catalog/setup/guided-catalog-setup.tsx`
- Test: `src/components/catalog/setup/__tests__/guided-catalog-setup.test.tsx`

**Design tokens:** `text-text-mute`, `font-mono`, `text-micro`

1. Add a failing component test with three `live_ops` facts and one operator fact.
2. Verify it fails because the UI reports four confirmed details.
3. Count only confirmed `operator` and `upload` facts.
4. Verify the test passes.

### Task 2: Tokenized answer controls

**Skills:** ops-design, frontend-design, interface-design, audit-design-system, test-driven-development

**Files:**
- Modify: `src/components/catalog/setup/guided-catalog-setup.tsx`
- Test: `src/components/catalog/setup/__tests__/guided-catalog-setup.test.tsx`

**Design tokens:** shared `Textarea` and `Input` primitives; `bg-surface-input`, `border-border`, `text-text`, `placeholder:text-text-3`

1. Add failing tests proving text and numeric questions render through the shared tokenized controls.
2. Verify the tests fail against the hand-rolled controls.
3. Replace the hand-rolled textarea/input with the shared primitives.
4. Verify both tests pass and no `bg-glass-fill` remains.

### Task 3: Optional guided spreadsheet evidence

**Skills:** wizard-audit, ops-copywriter, test-driven-development

**Files:**
- Create: `src/lib/catalog-setup/phase-c/source-document.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/source-document.test.ts`
- Modify: `src/components/catalog/setup/guided-catalog-setup.tsx`
- Modify: `src/components/catalog/setup/__tests__/guided-catalog-setup.test.tsx`
- Modify: `src/lib/catalog-setup/agent/setup-agent-service.ts`
- Modify: `src/lib/catalog-setup/agent/__tests__/setup-agent-service.test.ts`
- Modify: `src/i18n/dictionaries/en/catalog-setup.json`
- Modify: `src/i18n/dictionaries/es/catalog-setup.json`

1. Add failing adapter tests for CSV, XLS/XLSX routing, unsupported format, empty sheets, size ceiling, and payload ceiling.
2. Verify the adapter tests fail because the adapter does not exist.
3. Implement the bounded structured source-document adapter using the existing parsers.
4. Add failing component tests for successful upload payload and visible upload errors.
5. Verify they fail because no inline upload exists.
6. Add the neutral upload control and submit its structured result through the current turn.
7. Update the Phase C prompt to treat a user-initiated document as optional sourced evidence while retaining the ban on model-generated upload gates.
8. Add English and Spanish copy with exact format limits.
9. Verify adapter, component, prompt, and i18n tests pass.

### Task 4: Safe start-over operation

**Skills:** wizard-audit, test-driven-development

**Files:**
- Modify: `src/lib/catalog-setup/phase-c/session-service.ts`
- Modify: `src/lib/catalog-setup/phase-c/__tests__/session-service.test.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/abandon/route.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/abandon/__tests__/route.test.ts`
- Modify: `src/components/catalog/setup/guided-catalog-setup.tsx`
- Modify: `src/components/catalog/setup/__tests__/guided-catalog-setup.test.tsx`
- Modify: `src/i18n/dictionaries/en/catalog-setup.json`
- Modify: `src/i18n/dictionaries/es/catalog-setup.json`

1. Add failing service tests for company-scoped optimistic abandonment and version conflict.
2. Verify they fail because the operation does not exist.
3. Implement abandonment by setting session status to `abandoned`; never delete catalog data.
4. Add failing route tests for authorization, permission checks, and service arguments.
5. Implement the authenticated abandon route.
6. Add a failing component test for the confirmation and fresh-session restart sequence.
7. Add the `START OVER` confirmation using tokenized OPS surfaces and copy.
8. Verify all reset tests pass.

### Task 5: Release and production cleanup

**Skills:** audit-design-system, verification-before-completion

**Files:**
- Modify if required: `ops-software-bible` Catalog guided setup section, only after confirming its worktree is safe

1. Run focused Catalog tests and i18n parity.
2. Run design-token scans for the touched UI.
3. Run type-check and production build.
4. Visually verify the focused, dark, tokenized input; visible upload control; accurate zero count; and start-over confirmation.
5. Commit atomically and push to production under the user's existing deployment authorization.
6. Mark only Canpro's current test session abandoned after the code is live.
7. Reopen Catalog and verify a fresh session has zero operator-confirmed details and no new catalog actions or products.
