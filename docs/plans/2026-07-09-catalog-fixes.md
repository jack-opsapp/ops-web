# Catalog Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Read `2026-07-09-web-polish-README.md` in this directory FIRST.

**Goal:** Catalog setup screen scrolls where it's meant to; the breadcrumb reads `CATALOG // SETUP`; the add flow shows exactly one plus.

**Context from prior plans (already landed on this branch — verify with `git log`):** the metrics plan removed the `// SUPPLY` label + clickable metric cells from the catalog strip; the toolbar plan fixed the full-width PRODUCTS‖STOCK toggle. **Verify both on `/catalog` in preview during Task 4 — they are acceptance criteria for the tab even though their code landed earlier.**

**Tech Stack:** Next 15 App Router, Tailwind.

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`, `custom-skills:wizard-audit` (Task 1 touches the setup wizard — load it to sanity-check you haven't broken a wizard invariant).

---

### Task 1: Setup screen scroll

**Root cause (verified):** the route is `fullHeight: "bleed"` (`src/lib/navigation/route-registry.ts:218`) → dashboard `<main>` is `overflow-hidden` with a `100vh - 56px` box (`dashboard-layout.tsx:261,268-271`), but the wizard shell root declares `min-h-screen` (`src/components/catalog-setup/setup-wizard-shell.tsx:247`) — 56px taller than its clipped parent — and neither the body grid (`:343-345`) nor the right CanvasPane (`src/components/catalog-setup/CanvasPane.tsx:204,213`) has any overflow, so the bottom is unreachable. The left DriverPane already scrolls internally (`DriverPane.tsx:175`).

**Files:**
- Modify: `src/components/catalog-setup/setup-wizard-shell.tsx:247`
- Modify: `src/components/catalog-setup/CanvasPane.tsx` (~:204-213)

**Step 1:** Shell root: `"flex h-full min-h-screen w-full flex-col bg-background"` → `"flex h-full min-h-0 w-full flex-col bg-background"`.
**Step 2:** CanvasPane: root already `flex h-full min-h-0 flex-col`; give its content column (`:213` div) `min-h-0 flex-1 overflow-y-auto scrollbar-hide` so the live canvas scrolls like the driver pane. Read the file first — if an inner list container is the true overflow point, put the scroll there instead; exactly ONE scroll container on the pane (no nested double-scroll).
**Step 3:** Guard the short-viewport case: with the header strip (~140px+) fixed, verify at `preview_resize` 1440×700 that both panes scroll to their ends and the header never collapses. If the body grid itself clips before the panes engage, add `min-h-0` down the chain (grid children need `min-h-0` to shrink) — NOT `overflow` on the grid.
**Step 4:** Preview `/catalog/setup` (reachable when the company has an empty catalog — if seed data has a populated catalog, navigate directly to the route; it renders regardless of the first-run gate — verify by reading `catalog/setup/page.tsx` gating first). Scroll both panes to the bottom; screenshot top + bottom states → `docs/artifacts/web-polish-2026-07-09/catalog-fixes/`.
**Step 5:** Commit: `fix(catalog-setup): wizard panes scroll — remove min-h-screen overflow trap`

### Task 2: Breadcrumb reads CATALOG // SETUP

**Root cause (verified):** for nested routes, `top-bar.tsx` builds the parent crumb from `getTitleKeyForPath(pathname)` — the FULL path (`top-bar.tsx:216-221,290-297`). `/catalog/setup` has its own registry entry (`route-registry.ts:212-215`, `nav.catalogSetup` = "Catalog setup"), so the parent crumb renders "CATALOG SETUP" and the leaf adds "SETUP" → `CATALOG SETUP // SETUP`.

**Files:**
- Modify: `src/components/layouts/top-bar.tsx` (:213-229 title derivation, :288-304 render)
- Test: unit test for the crumb derivation if the logic is extractable; otherwise a component test per repo convention

**Step 1:** Derive the nested-branch parent crumb from the PARENT route, not the full path:
```ts
const parentTitleKey = getTitleKeyForPath(parentRoute);
const resolvedParentTitle = parentTitleKey ? tNav(parentTitleKey) : "";
const parentTitleReady = !!parentTitleKey && resolvedParentTitle !== parentTitleKey;
const parentTitle = parentTitleReady ? resolvedParentTitle : "";
```
Use `parentTitle` in the auto-generated crumb button (`:290-297`) and in the `(parentCrumbs || rootTitle)` separator condition. **Keep `rootTitle` (full-path entry) for two things:** the top-level `<h1>` branch (`:308-312`) and — check — anything else consuming it (`usePageTitle`/document.title comes from elsewhere; verify). The leaf stays `entityName || leafFallback`.
**Step 2:** Regression sweep — every nested route must still render correctly: `/projects/[id]` ("PROJECTS // {title}"), `/clients/[id]`, any `/admin/*` nested paths, `/books` (top-level, unaffected), and `/catalog/setup` → "CATALOG // SETUP". Grep `route-registry.ts` for other nested entries WITH their own registry rows (the same doubled-crumb bug class) — list them in the report; they're fixed by the same change.
**Step 3:** tsc + tests + preview screenshots of `/catalog/setup` and `/projects/[id]` breadcrumbs.
**Step 4:** Commit: `fix(nav): nested breadcrumb parent crumb resolves the parent route — CATALOG // SETUP`

### Task 3: One plus in the add flow

**Verified state:** the toolbar ADD `WorkbarButton` renders one `<Plus>` icon + "ADD" (`products-segment.tsx:356`, `stock-segment.tsx:392`). The doubled plus is the modal it opens: `products.newProduct` = `"+ NEW PRODUCT"` (`src/i18n/dictionaries/en/catalog.json:94`, `es/catalog.json:94` `"+ NUEVO PRODUCTO"`) rendered as the DialogTitle (`product-quick-add.tsx:76`).

**Files:**
- Modify: `src/i18n/dictionaries/en/catalog.json:94` → `"NEW PRODUCT"`; `es/catalog.json:94` → `"NUEVO PRODUCTO"`.

**Step 1:** Edit both dictionaries. Grep both catalog dictionaries + components for any other literal `"+ "` label (recon found none — confirm).
**Step 2:** Preview: `/catalog` → ADD → modal title shows `NEW PRODUCT`, toolbar button shows one plus glyph. Also open the STOCK segment's ADD flow and eyeball for stray plusses. Screenshot both.
**Step 3:** Commit: `fix(catalog): drop literal plus from quick-add title — icon carries the affordance`

### Task 4: Whole-tab acceptance pass

**Step 1:** Preview `/catalog` end-to-end at 1440×900 and capture the acceptance set:
- metrics strip: starts at left edge, no `// SUPPLY`, cells flip (formula) or are static — never navigate;
- PRODUCTS‖STOCK toggle: intrinsic width;
- ADD flow: single plus;
- `/catalog/setup`: scrolls, breadcrumb `CATALOG // SETUP`.
**Step 2:** `custom-skills:audit-design-system` over touched files. Evidence folder complete. Report.
