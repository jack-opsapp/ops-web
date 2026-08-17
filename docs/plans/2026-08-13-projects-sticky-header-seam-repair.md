# Projects Sticky Header Seam Repair Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Eliminate the sub-pixel gap between the pinned projects toolbar and sticky column header without changing their layout or visual treatment.

**Architecture:** Keep `TableChrome` as the single publisher of `--shell-header-top`, but publish the toolbar's fractional CSS-pixel border-box height from `getBoundingClientRect()` instead of the integer-rounded `offsetHeight`. Preserve the existing `ResizeObserver`, scroll-parent discovery, cleanup, and all tokenized styling.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Testing Library, JSDOM

**Design System:** `/Users/jacksonsweet/Projects/OPS/ops-web/.interface-design/system.md` and `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`

**Required Skills:** `custom-skills:executing-plans`, `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `superpowers:using-git-worktrees`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:audit-design-system`

---

### Task 1: Protect the fractional sticky offset contract

**Skills:** Use systematic debugging and test-driven development. Apply the existing OPS command-deck layout unchanged.

**Files:**

- Create: `tests/unit/components/ui/table-chrome.test.tsx`
- Modify: `src/components/ui/table-shell/table-chrome.tsx`

**Design tokens:** No token changes. Preserve `bg-background`, existing z-index utilities, and `--shell-header-top`.

**Step 1: Write the failing test**

Render the real `TableChrome` inside an overflow scroller. Give the toolbar an integer `offsetHeight` of `45` and a fractional `getBoundingClientRect().height` of `45.5`. Assert that the scroller receives `--shell-header-top: 45.5px`, then unmount and assert cleanup removes the property. The production mutation this catches is publishing integer-rounded layout height and reopening the seam.

**Step 2: Run the focused test to verify it fails correctly**

Run: `npm test -- --run tests/unit/components/ui/table-chrome.test.tsx`

Expected: FAIL because current code publishes `45px`.

**Step 3: Implement the minimal root-cause fix**

Change only the `apply` measurement in `TableChrome` to publish `el.getBoundingClientRect().height`. Do not alter layout classes, tokens, scroll ownership, or observer behavior.

**Step 4: Run the focused test to verify it passes**

Run: `npm test -- --run tests/unit/components/ui/table-chrome.test.tsx`

Expected: PASS with the fractional value preserved and cleanup verified.

### Task 2: Verify, review, commit, and integrate

**Skills:** Use design-system audit, verification-before-completion, requesting-code-review, and finishing-a-development-branch.

**Files:**

- Verify: `src/components/ui/table-shell/table-chrome.tsx`
- Verify: `tests/unit/components/ui/table-chrome.test.tsx`
- Verify: `docs/plans/2026-08-13-projects-sticky-header-seam-repair.md`

**Step 1: Run focused neighboring table suites**

Run the new regression plus the projects read-only/edit/phase 4/phase 5 integration suites to verify the shared table chrome remains compatible.

**Step 2: Run type/build and repository hygiene gates**

Run TypeScript checking, the production Next build with remote template sync disabled, and `git diff --check`.

**Step 3: Audit the touched UI code**

Confirm no colors, spacing, radius, typography, motion, or user-facing copy changed and no hardcoded design values were introduced.

**Step 4: Request independent code review**

Review the exact base-to-head diff against bug `3c9655d5-6f5f-4f01-a782-db7f12fff170`, fixing every Critical or Important finding before integration.

**Step 5: Commit and merge locally**

Commit only the plan, focused regression, and one-line root-cause fix with a conventional message referencing the bug ID. Merge into the clean local `main` integration worktree, rerun the focused test on merged `main`, and verify ancestry. Do not push or deploy.

**Step 6: Release Fixer A capacity in Supabase**

After local-main proof, guard the update by exact ID, worker, eligible status, unresolved state, and non-human-review state. Record exact commit/tests/local-merge evidence, append a stable `nightly-release-needed:v1` marker because customer-live runtime verification requires a later push/deploy, clear `assigned_to`, and independently read back all assignment/completion fields.
