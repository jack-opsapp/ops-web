# Guided Catalog Composer Proportions Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Make Guided Catalog Setup composer actions visually subordinate and prevent disproportionate composer controls from returning.

**Architecture:** Keep the existing answer and upload behavior, but express both through a shared local composer-action style. Protect the hierarchy with real-browser bounding-box and computed-style assertions, then codify the reusable pattern in the active OPS interface system.

**Tech Stack:** React, TypeScript, Tailwind tokens, Lucide, Vitest, Playwright

**Design System:** `.interface-design/system.md`

**Required Skills:** `custom-skills:interface-design`, `frontend-design:frontend-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:ops-design`, `superpowers:test-driven-development`, `custom-skills:audit-design-system`

---

### Task 1: Prove the visual hierarchy regression

**Skills:** Test-driven development and interface design.

**Files:**
- Modify: `tests/e2e/catalog-setup-viewport.spec.ts`

**Design tokens:** Existing dense-control spacing, `text-text-2`, `text-text-3`, `surface-hover`, `ops-accent` focus ring, 16px Lucide icon tier.

1. Add real-browser assertions that the send action is square, no larger than the desktop dense-control tier, and occupies only its compact share of the answer field.
2. Assert the upload action has no full perimeter border and its icon renders at the 16px tier.
3. Run the focused viewport test and confirm it fails against commit `d50ed237` for the oversized labeled send action and bordered upload treatment.

### Task 2: Implement the approved composer actions

**Skills:** OPS design, frontend design, interface design, and accessibility guidance.

**Files:**
- Modify: `src/components/catalog/setup/guided-catalog-setup.tsx`

**Design tokens:** `h-9`, `w-9`, `gap-1`, `right-1`, `bottom-1`, `text-text-2`, `text-text-3`, `hover:bg-surface-hover`, `focus-visible:ring-ops-accent`, `rounded`.

1. Replace the text Continue treatment with a square icon-only action while keeping the localized accessible name, disabled state, and submit behavior.
2. Reduce the textarea’s reserved action space to the square control plus standard gap.
3. Replace the dense spreadsheet glyph with a lightweight attachment glyph and remove the upload action’s perimeter border.
4. Run the focused component and viewport tests and confirm they pass.

### Task 3: Make the prevention contract permanent

**Skills:** Interface design and design-system audit.

**Files:**
- Modify: `.interface-design/system.md`

1. Add a Composer Actions subsection under Component Primitives.
2. Define chat composers as contextual controls: square icon-only send, quiet ghost attachment, 16px utility icons, and no standalone CTA treatment inside the field.
3. Explain that token compliance does not override contextual proportion and hierarchy.

### Task 4: Verify and deliver

**Skills:** Design-system audit and verification-before-completion.

**Files:**
- Update: `docs/artifacts/guided-catalog-setup/after-*.png`

1. Run Guided Catalog Setup component tests.
2. Run all catalog-related tests.
3. Run the required viewport browser suite and inspect every screenshot.
4. Run type-check, full lint, production build, `git diff --check`, and a hardcoded-token scan.
5. Commit only the scoped source, test, design-guidance, plan/spec, and screenshot changes. Do not push or deploy.
