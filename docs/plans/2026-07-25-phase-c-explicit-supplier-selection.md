# Phase C Explicit Supplier Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Prevent the generic Phase C catalog agent from assuming DekSmart, while activating and retaining the verified DekSmart catalog reference only after the operator explicitly identifies that supplier.

**Architecture:** Keep the general interview prompt supplier-neutral. Resolve a supplier adapter only from the current operator answer or already-confirmed facts, inject supplier-specific generation rules only after that resolution, and persist an explicit supplier answer as a confirmed fact. Deterministic reconciliation must trust the selected adapter, never a brand name invented by the model.

**Tech Stack:** TypeScript, OpenAI Chat Completions, Zod, Vitest

**Design System:** `.interface-design/system.md` reviewed. No visual, layout, motion, or design-token changes.

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `ops-copywriter:ops-copywriter`, `custom-skills:wizard-audit`

---

### Task 1: Lock the supplier boundary with failing tests

**Skills:** `superpowers:test-driven-development`, `custom-skills:wizard-audit`

**Files:**

- Modify: `src/lib/catalog-setup/agent/__tests__/setup-agent-service.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/__tests__/turn-service-canonicalization.test.ts`

1. Add a test proving a supplier-neutral guided turn sends no DekSmart instruction or reference to the model.
2. Add a test proving verified DekSmart guidance is present after the reference is selected.
3. Add a test proving a model-authored DekSmart label cannot activate deterministic reconciliation without the selected adapter.
4. Add a test proving an explicit DekSmart answer becomes a durable confirmed supplier fact.
5. Run the focused suites and confirm they fail for the missing boundary behavior.

### Task 2: Make supplier selection explicit and durable

**Skills:** `ops-copywriter:ops-copywriter`

**Files:**

- Modify: `src/lib/catalog-setup/agent/setup-agent-service.ts`
- Modify: `src/lib/catalog-setup/phase-c/turn-service.ts`

1. Replace the global DekSmart rule with a generic instruction requiring explicit supplier confirmation before any supplier-specific behavior.
2. Append the DekSmart review contract only when the verified supplier reference is present.
3. Require `supplierAdapter === "deksmart"` before deterministic DekSmart reconciliation.
4. When the current operator answer explicitly identifies DekSmart, add a confirmed supplier fact before reducing the turn.
5. Run the focused suites and confirm they pass.

### Task 3: Verify, release, and preserve the live test

**Skills:** `superpowers:verification-before-completion`

**Files:**

- Verify: `src/lib/catalog-setup/agent/setup-agent-service.ts`
- Verify: `src/lib/catalog-setup/phase-c/turn-service.ts`
- Verify: Phase C tests

1. Run the complete Phase C and catalog-agent regression suites.
2. Run TypeScript, the production build, and `git diff --check`.
3. Review the scoped diff and commit atomically.
4. Push the fast-forward commit to production under the user’s existing deployment authorization.
5. Confirm the deployment is ready.
6. Replace only the contaminated unresolved Canpro question with a neutral supplier-confirmation question; preserve all confirmed facts, sources, and versioning.
7. Read the live session back and confirm its prior facts remain intact.
