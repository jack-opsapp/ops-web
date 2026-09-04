# MCP Tool Request Vertical Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Place the MCP tool-request form in a full-width row beneath its section heading and description at every viewport.

**Architecture:** Keep the existing section, copy, form component, and submission behavior unchanged. Replace the request section's desktop 12-column split with one vertical flow, then protect the visual hierarchy with a browser-level geometry assertion.

**Tech Stack:** Next.js, React, Tailwind CSS, Playwright

**Design System:** `.interface-design/system.md`

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`

---

### Task 1: Protect the section hierarchy

**Skills:** Use `superpowers:test-driven-development` and `custom-skills:interface-design` for the layout contract.

**Files:**
- Modify: `tests/e2e/mcp-guide.spec.ts`

**Design tokens:** Existing responsive canvas width and section spacing only; introduce no colors, radii, typography, or animation values.

**Step 1: Write the failing test**

Add a desktop Playwright assertion that the request form starts below the section introduction and shares the section's horizontal bounds.

**Step 2: Run the test to verify it fails**

Run the exact new Playwright test in Chromium. Expect the current 7/5 desktop grid to fail the vertical-position or full-width assertion.

### Task 2: Stack the request form

**Skills:** Use `ops-design`, `frontend-design:frontend-design`, and `custom-skills:interface-design`.

**Files:**
- Modify: `src/app/developers/mcp/_components/mcp-guide-page.tsx`

**Design tokens:** `gap-4` for the existing 32px vertical section gap; preserve all existing type, surface, border, and spacing tokens.

**Step 1: Write the minimal implementation**

Remove the large-screen column split and its span classes. Keep a single `grid grid-cols-1 gap-4` wrapper so the heading block renders first and `RequestToolForm` renders full-width beneath it.

**Step 2: Run the test to verify it passes**

Run the exact new Chromium test and confirm the vertical and full-width assertions pass.

### Task 3: Verify and commit

**Skills:** Use `custom-skills:audit-design-system` and `superpowers:verification-before-completion`.

**Files:**
- Verify: `src/app/developers/mcp/_components/mcp-guide-page.tsx`
- Verify: `tests/e2e/mcp-guide.spec.ts`

**Step 1: Verify responsive behavior**

Run the existing guide suite at 375, 768, 1024, and 1440 pixels, then inspect the generated screenshots.

**Step 2: Verify code quality**

Run the focused unit suite and lint the changed source and test files. Audit the diff for hardcoded colors, spacing, radii, fonts, copy, or animation values.

**Step 3: Commit**

Stage only the plan, layout component, and regression test. Commit as `fix(mcp): stack tool request form below heading`.
