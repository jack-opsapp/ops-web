# Toolbar Cohesion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Read `2026-07-09-web-polish-README.md` in this directory FIRST.

**Goal:** Like elements sit in the same predictable place on every surface's toolbar. The segment control stops stretching full-width anywhere. Pipeline's toolbar conforms to the shared grammar and sheds dead code.

**Architecture:** The canonical toolbar already exists — `Workbar` (`src/components/ui/table-shell/table-shell.tsx:88-161`, grammar: `[search][filters]—elastic—[meta][tools][create]` / row 2 `[tabStrip]`). The defects: (1) `tabStrip` children get cross-axis-stretched by the column-flex `TableWorkbar` (the ONE root cause of the full-width Catalog toggle + Books width jumps); (2) Pipeline feeds a nowrap non-chip filter idiom into the elastic cell + carries an orphaned toolbar component; (3) Projects canvas/map uses a bespoke floating toolbar with off-grammar grouping. Books-segment height normalization lives in the Books plan (executes after this one); Schedule is EXCLUDED (sibling session owns that area).

**Tech Stack:** React/Tailwind; Framer Motion only where already present.

**Design System:** Compact workbar tier — 28px controls, 22–24px tabs/chips (DESIGN.md §9 compact tier, sanctioned 2026-06-11). Toggles: no accent.

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:audit-design-system`.

---

### Task 1: Fix the tabStrip stretch centrally

**Files:**
- Modify: `src/components/ui/table-shell/table-shell.tsx:157`
- Test: component test asserting the tabStrip wrapper exists (snapshot or class assertion per repo convention)

**Step 1:** Replace the raw `{tabStrip}` emission with an intrinsic-width row that still allows future right-side tab content:
```tsx
{tabStrip != null ? (
  // Row 2 — a row-flex wrapper so inline-flex children keep their intrinsic
  // width (a direct child of the column-flex TableWorkbar gets cross-axis
  // stretched to full row width — the full-bleed segment-control bug).
  <div className="flex min-w-0 items-center gap-2">{tabStrip}</div>
) : null}
```
**Step 2:** Check every `tabStrip` consumer renders correctly (grep `tabStrip={`): books invoices/estimates/expenses/sync, catalog products/stock, pipeline (`PipelineModeSwitcher` + `tabsSlot` portal), projects table-v2 (saved-view tabs). The projects tabs row and pipeline's `tabsSlot` pass composite nodes — confirm in preview that their internal layout (chips + "+ new view", switcher + saved views) still spreads correctly; if a consumer relied on the stretch (e.g. a `justify-between` row), it now needs `w-full` on ITS root — apply per-consumer, deliberately.
**Step 3:** Preview: `/catalog` → PRODUCTS‖STOCK toggle hugs its content (bordered box ends after the tabs); `/books` all four segments → tab control constant width; `/pipeline` + `/projects` rows intact. Screenshots each → `docs/artifacts/web-polish-2026-07-09/toolbar-cohesion/`.
**Step 4:** Commit: `fix(workbar): tab strip keeps intrinsic width — kill the full-bleed segment-control stretch`

### Task 2: Pipeline filters conform to the chip idiom

Pipeline's `filters` slot currently receives `PipelineFilterRow variant="toolbar"` — a `min-w-max flex-nowrap` block of `EntityPicker` dropdowns + dividers with dead search/new-lead branches (`page.tsx:993-1008`, `pipeline-filter-row.tsx:252-343`), violating the Workbar overflow contract (`table-shell.tsx:65-82`).

**Files:**
- Modify: `src/app/(dashboard)/pipeline/page.tsx:993-1008`
- Create (or extract): `src/app/(dashboard)/pipeline/_components/pipeline-filter-chips.tsx`
- Reference: `src/app/(dashboard)/clients/page.tsx:331-357` (the reference Workbar impl) + the shared `FilterChips` component it uses (read it; reuse, don't fork)
- Delete (after migration): the toolbar variant branch inside `pipeline-filter-row.tsx` — or the whole file if the non-toolbar variant has no other consumers (grep first; mobile may use it)

**Step 1:** Read `FilterChips` (find via clients page import) + current stage/assignee filter state wiring in pipeline page. The two filters are: stage (multi or single select over PIPELINE stages) and assignee (users). Recreate BOTH as chips consistent with the clients/books chip pattern: 22–24px, `rounded-chip`, `font-mono text-micro uppercase`, active = `bg-surface-active text-text border-[rgba(255,255,255,0.18)]`. Where a filter needs a picker (assignee list), the chip opens the existing `EntityPicker` popover — chip is the trigger, picker portals to body (the Picker kit already portals). Zero behavior change to the filtering itself: same state, same setters.
**Step 2:** Swap the `filters` slot to the new chips component; the wrap behavior now follows the Workbar contract (chips reflow inside the elastic cell).
**Step 3:** Delete dead branches: `showSearch`/`showNewLead` props and their JSX if now unused everywhere; then delete `pipeline-focused-toolbar.tsx` (orphaned — grep-confirm zero imports) and prune anything only it used (`toolbarVariants` — check other consumers before removing from `motion.ts`; if `motion.ts` still has consumers, leave it).
**Step 4:** tsc + preview `/pipeline` (both focused + table modes): filters work (stage narrows columns/rows, assignee narrows), chips wrap gracefully at ~1040px width (`preview_resize` to 1040×800 — the historical failure width), right cluster (count, REVIEW EMAILS, NEW LEAD) stays inline. Screenshots wide + narrow.
**Step 5:** Commit: `refactor(pipeline): toolbar filters on the shared chip idiom; delete orphaned focused toolbar`

### Task 3: Empty-region hygiene in focused mode

In focused mode the `tools` clusterSlot + `tabsSlot` portals are empty, leaving hollow flex regions (`page.tsx:1009-1028, 1042-1045`).

**Step 1:** Read how `clusterSlot`/`tabsSlot` portal (they exist for table mode). Make the containers render `null`/collapse when empty (conditional on mode or on `childNodes` presence — prefer mode conditionals, they're explicit). The row-2 `flex-1` spacer div at `:1042-1045` goes away with Task 1's wrapper (verify) — if not, remove it.
**Step 2:** Preview focused mode: row 2 shows just the mode switcher at intrinsic width; no phantom gaps. Screenshot.
**Step 3:** Commit: `fix(pipeline): collapse empty toolbar regions in focused mode`

### Task 4: Projects canvas/map floating toolbar — grammar alignment

`src/app/(dashboard)/projects/_components/project-floating-toolbar.tsx` is bespoke (floating over canvas — legitimately not a `TableWorkbar`), but its grouping must follow the shared grammar: search leftmost, filters next, view controls right, and controls on the 28px ladder.

**Step 1:** Read the file fully. Apply surgical alignment (NOT a rebuild):
- Order left→right: search-expand → filter controls → sort/fit-all → bulk → view SegmentControl (rightmost, matching tabStrip position semantics).
- Replace any raw `<select>` with the app's picker/dropdown primitives styled per system (raw selects violate the component system — check what `EntityPicker`/`Select` primitives exist under `src/components/ui/`).
- Normalize control heights to 28px; radii to tokens; kill any hardcoded colors found in passing.
**Step 2:** tsc + preview `/projects` (canvas mode; map tab renders blank locally — verify layout only by code review + canvas-mode screenshot).
**Step 3:** Commit: `refactor(projects): canvas toolbar follows the workbar grammar`

### Task 5: Audit + evidence

`custom-skills:audit-design-system` over all touched files. Evidence folder assembled: per-surface before/after where feasible (git stash trick not needed — the before is on `main`; cite commit diffs instead). Report any consumer you deliberately gave `w-full` in Task 1 and why.
