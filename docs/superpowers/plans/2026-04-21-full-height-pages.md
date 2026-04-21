# Full-Height Dashboard Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-page `h-[calc(100vh-...)]` hacks on `/inbox`, `/map`, and `/calendar` with first-class full-height mode support in `DashboardLayout`.

**Architecture:** `DashboardLayout` gains an opt-in `FULL_HEIGHT_ROUTES` config with two modes — `padded` (12px gutters, clears topbar with 12px gap) and `bleed` (edge-to-edge, only clears topbar). `<main>` becomes a `flex flex-col overflow-hidden` container; normal scrollable pages keep their scroll inside the inner wrapper while full-height pages fill the remaining space via `flex-1 min-h-0`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS. No new dependencies. Type-check via `npm run type-check`, lint via `npm run lint`, visual verification in the dev server (`npm run dev`).

**Spec:** `docs/superpowers/specs/2026-04-21-full-height-pages-design.md`

---

## File Structure

Files touched (in execution order):

```
src/components/layouts/dashboard-layout.tsx    — (1) core infra: add FULL_HEIGHT_ROUTES, split main into flex column
src/app/(dashboard)/inbox/page.tsx              — (2) migrate to padded full-height mode
src/app/(dashboard)/map/page.tsx                — (3) migrate to bleed full-height mode
src/app/(dashboard)/calendar/page.tsx           — (4) migrate to padded full-height mode
```

No new files. No schema changes. No dependencies added.

**Commit strategy:** Each task produces one atomic commit that leaves the app in a working state. Task 1 lands the infrastructure with an empty route list (no behavior change for any page). Tasks 2–4 each add a route to the list and migrate the corresponding page in the same commit.

---

## Task 1: Add full-height mode infrastructure to DashboardLayout

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx`

**Goal of this task:** Refactor `<main>` into a flex column, introduce the `FULL_HEIGHT_ROUTES` config and `resolveFullHeightMode` helper, branch the inner wrapper on mode, and conditionally render the bottom gradient fade. Ship with an **empty** route map so behavior is unchanged for all existing pages. This is a pure refactor commit.

- [ ] **Step 1: Open the file and locate the render return block**

Read `src/components/layouts/dashboard-layout.tsx` lines 144–161 (the `return ( <div className="relative h-screen overflow-hidden bg-background"> ... )` block through the bottom gradient fade).

The current shape is:
```tsx
<div className="relative h-screen overflow-hidden bg-background">
  <main className="relative z-[1] h-screen w-full overflow-y-auto overflow-x-auto pl-0 md:pl-[72px]">
    <UnassignedRoleBanner />
    <div className="pt-[68px] pb-32 px-3 space-y-3">
      {children}
    </div>
  </main>

  <div
    className="fixed bottom-0 right-0 left-0 md:left-[72px] h-24 pointer-events-none z-[5]"
    style={{
      background:
        "linear-gradient(to bottom, transparent 0%, hsl(var(--background)) 100%)",
    }}
  />
  {/* ... rest of HUD overlays ... */}
</div>
```

- [ ] **Step 2: Add the `usePathname` import**

At the top of the file, `"next/navigation"` is already imported for `useRouter` (line 36). Extend that import to also pull in `usePathname`:

```tsx
// Before
import { useRouter } from "next/navigation";

// After
import { useRouter, usePathname } from "next/navigation";
```

- [ ] **Step 3: Add the full-height route config and resolver above the component**

Locate the end of the imports and the first function/component definition (around line 53, just above `ActionPromptsInitializer`). Add this block directly above the first helper function:

```tsx
// ─── Full-height page support ────────────────────────────────────────────────
//
// Pages listed here opt out of the normal scrollable layout and instead fill
// the viewport below the topbar. Two modes:
//
//   - "padded" — 12px gutters on all sides, 12px gap below topbar. Used when
//                the page has its own bordered panel/card that should breathe.
//   - "bleed"  — edge-to-edge, clears only the topbar. Used when the page
//                renders a background surface (e.g. a map) that should run
//                into the viewport edges.
//
// The inner wrapper applies `flex-1 min-h-0 flex flex-col` so children can
// use `h-full` and `flex-1 min-h-0` without re-deriving viewport math.

type FullHeightMode = "padded" | "bleed";

const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  // Populated per-task as pages are migrated. Empty for the infrastructure
  // commit so existing pages keep their current behavior.
};

function resolveFullHeightMode(pathname: string): FullHeightMode | null {
  for (const [route, mode] of Object.entries(FULL_HEIGHT_ROUTES)) {
    if (pathname === route || pathname.startsWith(route + "/")) return mode;
  }
  return null;
}
```

- [ ] **Step 4: Read the pathname inside the component**

Inside `DashboardLayout` (after the existing hook calls like `useRouter()` — around line 75–95 area), add:

```tsx
const pathname = usePathname();
const fullHeightMode = resolveFullHeightMode(pathname);
const isFullHeight = fullHeightMode !== null;
```

Place it after the other hook calls but before any conditional early returns (e.g. before the `if (needsOnboarding) { ... }` block at line 134).

- [ ] **Step 5: Replace the `<main>` block with the flex-column branching version**

Replace lines 144–161 of the current file (the `return (` through the closing of the bottom gradient fade `<div />`) with:

```tsx
  return (
    <div className="relative h-screen overflow-hidden bg-background">
      {/* Page content — full bleed to all edges except left (sidebar width).
          <main> is a flex column so scrollable and full-height pages can coexist:
          scrollable pages host their scroll on the inner wrapper; full-height
          pages use flex-1 min-h-0 to fill remaining space after the banner. */}
      <main className="relative z-[1] h-screen w-full pl-0 md:pl-[72px] flex flex-col overflow-hidden">
        <UnassignedRoleBanner />

        {fullHeightMode === "padded" ? (
          <div className="flex-1 min-h-0 pt-[68px] pb-3 px-3 flex flex-col">
            {children}
          </div>
        ) : fullHeightMode === "bleed" ? (
          <div className="flex-1 min-h-0 pt-[56px] flex flex-col">
            {children}
          </div>
        ) : (
          <div className="flex-1 min-h-0 pt-[68px] pb-32 px-3 space-y-3 overflow-y-auto overflow-x-auto">
            {children}
          </div>
        )}
      </main>

      {/* Bottom gradient fade — signals more content below the fold.
          Hidden on full-height pages where there is no fold. */}
      {!isFullHeight && (
        <div
          className="fixed bottom-0 right-0 left-0 md:left-[72px] h-24 pointer-events-none z-[5]"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, hsl(var(--background)) 100%)",
          }}
        />
      )}
```

Leave everything after the bottom gradient fade (topbar, sidebar, map background, HUD overlays) unchanged.

- [ ] **Step 6: Verify the file compiles**

Run:
```bash
cd /c/OPS/ops-web && npm run type-check
```

Expected: no errors. If the command reports unused-import or type mismatches, re-check Step 2 (import extension) and Step 3 (placement above the first helper).

- [ ] **Step 7: Run lint**

Run:
```bash
cd /c/OPS/ops-web && npm run lint
```

Expected: no new errors. `FULL_HEIGHT_ROUTES` is an empty object — ESLint may warn about unused keys. If that happens, the next task populates the record so the warning resolves naturally; leave it for now.

- [ ] **Step 8: Boot the dev server and regression-check a normal page**

Run in one terminal:
```bash
cd /c/OPS/ops-web && npm run dev
```

Open `http://localhost:3000/projects` in a browser. Verify:
- Page scrolls normally when content exceeds viewport
- Bottom gradient fade is visible at the bottom
- Topbar and sidebar render correctly
- No console errors
- `UnassignedRoleBanner` behavior unchanged (appears only for UNASSIGNED role)

Expected: identical behavior to main branch. This is a pure refactor — any user-visible change here is a bug.

Stop the dev server (`Ctrl+C`).

- [ ] **Step 9: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/layouts/dashboard-layout.tsx && git commit -m "$(cat <<'EOF'
refactor(layout): add full-height mode scaffolding to DashboardLayout

Prep for eliminating per-page h-[calc(100vh-...)] hacks on /inbox,
/map, /calendar. Adds FULL_HEIGHT_ROUTES + resolveFullHeightMode
helper, converts <main> to flex-col, and branches the inner wrapper
on mode. Route list is empty in this commit so all pages keep their
existing behavior — subsequent commits populate it as each page is
migrated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migrate `/inbox` to padded full-height mode

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx` (add `/inbox` to `FULL_HEIGHT_ROUTES`)
- Modify: `src/app/(dashboard)/inbox/page.tsx`

**Goal of this task:** Add `/inbox` to the route map, drop the outer `space-y-3` wrapper, and swap the inbox card's `h-[calc(100vh-68px-96px)]` for `flex-1 min-h-0`. One atomic commit keeps both changes in sync.

- [ ] **Step 1: Add `/inbox` to the route config**

In `src/components/layouts/dashboard-layout.tsx`, find `FULL_HEIGHT_ROUTES` (added in Task 1). Change it from:

```tsx
const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  // Populated per-task as pages are migrated. Empty for the infrastructure
  // commit so existing pages keep their current behavior.
};
```

to:

```tsx
const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  "/inbox": "padded",
};
```

- [ ] **Step 2: Open the inbox page**

Read `src/app/(dashboard)/inbox/page.tsx` lines 378–389 (the return block wrapper). The current shape is:

```tsx
return (
  <div className="space-y-3">
    <div
      className={cn(
        "flex h-[calc(100vh-68px-96px)] overflow-hidden",
        "rounded-panel border border-border glass-surface"
      )}
    >
      {/* ... left list / center detail / right context ... */}
```

- [ ] **Step 3: Replace the outer wrapper and inbox card classes**

Change the opening of the return block from:

```tsx
return (
  <div className="space-y-3">
    <div
      className={cn(
        "flex h-[calc(100vh-68px-96px)] overflow-hidden",
        "rounded-panel border border-border glass-surface"
      )}
    >
```

to:

```tsx
return (
  <>
    <div
      className={cn(
        "flex-1 min-h-0 flex overflow-hidden",
        "rounded-panel border border-border glass-surface"
      )}
    >
```

- [ ] **Step 4: Update the closing tags to match the fragment wrapper**

At the bottom of the return block (currently around line 627–628), the file ends with:

```tsx
      {/* Suppress unused — company may power future filters */}
      {company?.id ? null : null}
    </div>
  );
}
```

The `</div>` at the penultimate line closes the former `<div className="space-y-3">`. It must become `</>`:

```tsx
      {/* Suppress unused — company may power future filters */}
      {company?.id ? null : null}
    </>
  );
}
```

Do NOT change the `</div>` that closes the inbox card itself (which is several lines above, after `<ThreadContextPanel />`). Only the outermost `</div>` becomes `</>`.

- [ ] **Step 5: Type-check**

Run:
```bash
cd /c/OPS/ops-web && npm run type-check
```

Expected: no errors.

- [ ] **Step 6: Lint**

Run:
```bash
cd /c/OPS/ops-web && npm run lint
```

Expected: no new errors.

- [ ] **Step 7: Visual verification in dev server**

Run:
```bash
cd /c/OPS/ops-web && npm run dev
```

Open `http://localhost:3000/inbox`. Verify:

1. **No outer scrollbar** on the page (neither browser-level nor a `<main>`-level scrollbar on the right edge). The inbox list and thread detail can still scroll *internally*, but the page itself does not.
2. **Bottom gap** is ~12px between the bottom of the inbox card and the viewport bottom. Previously it was 128px.
3. **Top gap** is ~12px between the bottom of the topbar (at y=56) and the top of the inbox card (at y=68). Previously this was already correct.
4. **Resize the window** vertically — the inbox card should continuously shrink/grow, never producing a scrollbar on the page itself.
5. **Bottom gradient fade is gone** on this page (it was misleading; verify by checking other pages like `/projects` still have it).
6. **Console has no new errors**.
7. **The three sub-panels** (conversation list, thread detail, context panel) still function: select a thread, verify the list scrolls internally, verify the detail view scrolls internally, verify the context panel opens/closes.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/layouts/dashboard-layout.tsx src/app/\(dashboard\)/inbox/page.tsx && git commit -m "$(cat <<'EOF'
fix(inbox): migrate /inbox to padded full-height layout mode

Eliminates the h-[calc(100vh-68px-96px)] hack (off by 32px, caused
the page to scroll) and the 128px bottom margin from the parent's
pb-32. Uses the new full-height mode from DashboardLayout — inbox
card now uses flex-1 min-h-0 and auto-adapts to viewport changes
and the UnassignedRoleBanner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate `/map` to bleed full-height mode

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx` (extend `FULL_HEIGHT_ROUTES`)
- Modify: `src/app/(dashboard)/map/page.tsx`

**Goal of this task:** Add `/map` to the route map as `"bleed"`, drop the `-m-3` negative margin hack and the `h-[calc(100vh-68px)]` calc from the map page.

- [ ] **Step 1: Extend the route config**

In `src/components/layouts/dashboard-layout.tsx`, update `FULL_HEIGHT_ROUTES` to add `/map`:

```tsx
const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  "/inbox": "padded",
  "/map": "bleed",
};
```

- [ ] **Step 2: Open the map page**

Read `src/app/(dashboard)/map/page.tsx` line 185 and surrounding context. The current outer wrapper is:

```tsx
return (
  <div className="flex flex-col h-[calc(100vh-68px)] -m-3 relative">
    <div className="px-3 pt-3">
      <MetricsHeader ... />
    </div>
    <div className="flex flex-1 min-h-0 relative">
      {/* ... */}
    </div>
  </div>
);
```

- [ ] **Step 3: Update the outer wrapper**

Change line 185 from:

```tsx
<div className="flex flex-col h-[calc(100vh-68px)] -m-3 relative">
```

to:

```tsx
<div className="flex flex-col h-full relative">
```

Rationale:
- `h-full` — the parent (`DashboardLayout` inner wrapper in bleed mode) is `flex-1 min-h-0 pt-[56px] flex flex-col`. Its content box is exactly the viewport below the topbar. `h-full` fills it.
- `-m-3` dropped — bleed mode's wrapper has no `px-3` / `pb-32` padding to cancel.

- [ ] **Step 4: Type-check**

Run:
```bash
cd /c/OPS/ops-web && npm run type-check
```

Expected: no errors.

- [ ] **Step 5: Lint**

Run:
```bash
cd /c/OPS/ops-web && npm run lint
```

Expected: no new errors.

- [ ] **Step 6: Visual verification**

Run:
```bash
cd /c/OPS/ops-web && npm run dev
```

Open `http://localhost:3000/map`. Verify:

1. **Map content bleeds to viewport edges** (no visible gap between the map's left edge and the sidebar, no gap between the map's bottom edge and the viewport bottom). This matches the existing behavior — the change should be visually indistinguishable from before.
2. **Top of the map clears the topbar** — the MetricsHeader sits ~12px below the bottom of the topbar (its own `pt-3` padding).
3. **No outer page scroll**.
4. **Map sidebar collapse/expand** still works.
5. **Resize the window** — the map resizes continuously.
6. **Bottom gradient fade is hidden** on this page.
7. **Console has no new errors**.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/layouts/dashboard-layout.tsx src/app/\(dashboard\)/map/page.tsx && git commit -m "$(cat <<'EOF'
fix(map): migrate /map to bleed full-height layout mode

Drops the -m-3 negative-margin hack and the h-[calc(100vh-68px)]
calc. The layout now provides pt-[56px] + flex-1 min-h-0 via the
new bleed mode; the map page just uses h-full.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Migrate `/calendar` to padded full-height mode

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx` (extend `FULL_HEIGHT_ROUTES`)
- Modify: `src/app/(dashboard)/calendar/page.tsx`

**Goal of this task:** Add `/calendar` to the route map as `"padded"`, convert the outer `space-y-3` to a flex column, and swap the inner calendar block's `h-[calc(100vh-68px-128px)]` for `flex-1 min-h-0`.

- [ ] **Step 1: Extend the route config**

In `src/components/layouts/dashboard-layout.tsx`, update `FULL_HEIGHT_ROUTES`:

```tsx
const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  "/inbox": "padded",
  "/map": "bleed",
  "/calendar": "padded",
};
```

- [ ] **Step 2: Open the calendar page**

Read `src/app/(dashboard)/calendar/page.tsx` lines 211–215. The current outer structure is:

```tsx
return (
  <div className="space-y-3">
    <MetricsHeader ... />
    <div className="flex flex-col h-[calc(100vh-68px-128px)] gap-1.5">
      <CalendarHeader ... />
      <CalendarToolbar ... />
      {/* Main content area */}
      <div className="flex flex-1 min-h-0 gap-1.5">
        {/* Filter sidebar + main calendar grid */}
      </div>
    </div>
  </div>
);
```

- [ ] **Step 3: Convert the outer div to a flex column and swap the inner calc for flex-1**

Change line 212 from:

```tsx
<div className="space-y-3">
```

to:

```tsx
<div className="flex flex-col h-full gap-3">
```

And change line 214 from:

```tsx
<div className="flex flex-col h-[calc(100vh-68px-128px)] gap-1.5">
```

to:

```tsx
<div className="flex flex-col flex-1 min-h-0 gap-1.5">
```

Rationale:
- Outer `space-y-3` → `flex flex-col h-full gap-3` — enables `flex-1` on the inner calendar wrapper. `gap-3` preserves the 12px gap that `space-y-3` provided.
- Inner `h-[calc(100vh-68px-128px)]` → `flex flex-col flex-1 min-h-0` — fills remaining space after `MetricsHeader` takes its natural height.

- [ ] **Step 4: Type-check**

Run:
```bash
cd /c/OPS/ops-web && npm run type-check
```

Expected: no errors.

- [ ] **Step 5: Lint**

Run:
```bash
cd /c/OPS/ops-web && npm run lint
```

Expected: no new errors.

- [ ] **Step 6: Visual verification**

Run:
```bash
cd /c/OPS/ops-web && npm run dev
```

Open `http://localhost:3000/calendar`. Verify:

1. **MetricsHeader renders at the top** with 12px below the topbar.
2. **Calendar grid fills the rest of the viewport** down to ~12px above the viewport bottom.
3. **No outer page scroll**.
4. **12px gap** between MetricsHeader and the CalendarHeader row.
5. **All calendar interactions work** — view switching (day/week/month), event dragging, filter sidebar toggling.
6. **Resize the window** — grid resizes continuously.
7. **Bottom gradient fade is hidden** on this page.
8. **Console has no new errors**.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/layouts/dashboard-layout.tsx src/app/\(dashboard\)/calendar/page.tsx && git commit -m "$(cat <<'EOF'
fix(calendar): migrate /calendar to padded full-height layout mode

Drops the h-[calc(100vh-68px-128px)] calc. Outer wrapper becomes
a flex column so the calendar grid can flex-1 min-h-0 after the
MetricsHeader takes its natural height.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Cross-page regression sweep

**Files:** none (verification only)

**Goal of this task:** Confirm no regressions on scrollable pages, the `UnassignedRoleBanner` interaction, and sticky-header pages.

- [ ] **Step 1: Start the dev server**

```bash
cd /c/OPS/ops-web && npm run dev
```

- [ ] **Step 2: Smoke-test a representative scrollable page**

Open `http://localhost:3000/projects`. Verify:
- Page scrolls when content exceeds viewport (scroll with mouse wheel, confirm the scrollbar appears on the right edge of the content wrapper)
- Bottom gradient fade is visible when scrolled near the top
- Topbar stays fixed at the top during scroll
- No horizontal scrollbar

Repeat for:
- `http://localhost:3000/clients`
- `http://localhost:3000/pipeline`
- `http://localhost:3000/estimates`
- `http://localhost:3000/invoices`

Expected: identical behavior to main branch on every page.

- [ ] **Step 3: Verify sticky behavior**

Open any page with sticky column headers or sticky toolbars (e.g. `http://localhost:3000/pipeline` — the kanban columns have sticky headers). Scroll the page. Verify sticky elements still pin to the top of the scroll container.

Expected: sticky semantics unchanged. The scroll container is now the inner wrapper instead of `<main>`, but visually it fills the same bounds so sticky pins to the same screen coordinates.

- [ ] **Step 4: Banner interaction test (if possible)**

If you have access to a test user with `role_id = UNASSIGNED`, sign in and visit `/inbox`, `/map`, `/calendar`. Verify:
- Banner renders at the top below the topbar
- Full-height pages shrink by the banner's height (~40px) — no overflow
- Banner does not overlap topbar or the full-height content

If you don't have such a user, skip this step and flag it for manual QA.

- [ ] **Step 5: Stop the dev server**

`Ctrl+C`.

- [ ] **Step 6: No commit**

No files changed in this task.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|-------------------|------|
| Add `FULL_HEIGHT_ROUTES` + resolver | Task 1 (Steps 3–4) |
| `<main>` becomes flex column | Task 1 (Step 5) |
| Padded mode: `pt-[68px] pb-3 px-3` | Task 1 (Step 5) |
| Bleed mode: `pt-[56px]` only | Task 1 (Step 5) |
| Normal mode: scroll moves to inner wrapper | Task 1 (Step 5) |
| Bottom gradient fade hides on full-height | Task 1 (Step 5) |
| Banner sits above content wrapper | Task 1 (Step 5) — unchanged position |
| `/inbox` migration | Task 2 |
| `/map` migration | Task 3 |
| `/calendar` migration | Task 4 |
| `/testing-grounds` skipped | Non-goal, not in FULL_HEIGHT_ROUTES |
| Sticky semantics preserved | Task 5 (Step 3) |
| Banner interaction self-healing | Task 5 (Step 4) |

All spec requirements covered.

**Placeholder scan:** No TBDs, no "implement later", no "similar to Task N" without code. Every code step shows exact before/after. Every command shows the exact `npm run` invocation and expected result.

**Type consistency:** `FullHeightMode`, `FULL_HEIGHT_ROUTES`, and `resolveFullHeightMode` are defined once in Task 1 Step 3 and referenced by name (not re-declared) in Tasks 2, 3, 4. Class names on the migrated pages (`flex-1 min-h-0`, `h-full`, `flex flex-col h-full gap-3`) match the layout's expectations.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-full-height-pages.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
