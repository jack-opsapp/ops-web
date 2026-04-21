# Full-Height Dashboard Pages — Design Spec

**Date:** 2026-04-21
**Status:** Proposed
**Scope:** Track A of the inbox UI polish pass — eliminates per-page `h-[calc(100vh-...)]` hacks that already exist on `/inbox`, `/map`, and `/calendar`

---

## Problem

Every dashboard page is wrapped by `DashboardLayout`, which applies:

```tsx
<main className="... h-screen overflow-y-auto ...">
  <UnassignedRoleBanner />
  <div className="pt-[68px] pb-32 px-3 space-y-3">
    {children}
  </div>
</main>
```

The padding (`pt-[68px] pb-32 px-3 space-y-3`) is correct for *scrollable* pages — 68px clears the fixed topbar, 128px leaves room for the bottom gradient fade and FAB, 12px side gutters align with the 8dp grid.

But several pages want the opposite: fill the viewport below the topbar, no outer scroll. Each one reinvented it with slightly-wrong math:

| Page | Current | Consequence |
|------|---------|-------------|
| `/inbox` | `h-[calc(100vh-68px-96px)]` | Off by 32px — page overflows and scrolls; bottom margin is 128px (too much) |
| `/map` | `h-[calc(100vh-68px)] -m-3` | Uses negative margin to bleed past `px-3` |
| `/calendar` | `h-[calc(100vh-68px-128px)]` | Correct math but inside a `space-y-3` wrapper with a `MetricsHeader` above — ends up scrolling on smaller viewports |

This is textbook drift. The fix is first-class support for full-height pages in `DashboardLayout`, not more local calcs.

---

## Decisions

| Question | Decision |
|----------|----------|
| Where does the opt-in live? | A `FULL_HEIGHT_ROUTES` config in `dashboard-layout.tsx`, matched against `usePathname()`. Explicit allow-list, not implicit detection. |
| How do pages with bleed needs (map) differ from padded (inbox)? | Two modes: `"padded"` (12px all sides, clears topbar with 12px gap) and `"bleed"` (clears topbar only, page fills edge-to-edge). |
| Does scroll stay on `<main>` or move? | Moves. `<main>` becomes `flex flex-col overflow-hidden`. Scrollable pages scroll inside the inner wrapper. Full-height pages don't scroll at all. |
| Bottom gradient fade visibility | Hidden on any full-height route (misleading — suggests scrollable content that doesn't exist). |
| Banner (`UnassignedRoleBanner`) | Stays as a flex child above the content wrapper. Flex handles the math — if it appears, full-height content shrinks automatically. |
| Sticky elements on normal pages | Unaffected. Moving `overflow-y-auto` from `<main>` to the inner wrapper keeps the scroll container as the sticky reference — semantics identical. |

---

## Architecture

### `dashboard-layout.tsx`

```tsx
import { usePathname } from "next/navigation";

type FullHeightMode = "padded" | "bleed";

/**
 * Routes that should fill the viewport below the topbar instead of flowing
 * into the scroll column.
 *
 *   - "padded" — standard 12px gutter all sides (inbox, calendar)
 *   - "bleed"  — content sits flush against topbar bottom and viewport edges,
 *                page owns its own internal padding (map)
 */
const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  "/inbox": "padded",
  "/calendar": "padded",
  "/map": "bleed",
};

function resolveFullHeightMode(pathname: string): FullHeightMode | null {
  for (const [route, mode] of Object.entries(FULL_HEIGHT_ROUTES)) {
    if (pathname === route || pathname.startsWith(route + "/")) return mode;
  }
  return null;
}

// Inside DashboardLayout render:
const pathname = usePathname();
const fullHeightMode = resolveFullHeightMode(pathname);
const isFullHeight = fullHeightMode !== null;

return (
  <div className="relative h-screen overflow-hidden bg-background">
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

    {!isFullHeight && (
      <div
        className="fixed bottom-0 right-0 left-0 md:left-[72px] h-24 pointer-events-none z-[5]"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, hsl(var(--background)) 100%)",
        }}
      />
    )}

    {/* ... rest of HUD overlays unchanged ... */}
  </div>
);
```

### Why `<main>` loses its own scroll

Currently `<main>` is the scroll root (`h-screen overflow-y-auto`). Moving scroll to the inner wrapper:

1. Lets `<main>` host both scrollable and non-scrollable children coherently via flex.
2. Allows the full-height branch to use `flex-1 min-h-0` — the cleanest way to make a flex child fill remaining space after a shrink-0 sibling (the banner) takes its natural height.
3. Preserves existing scroll behavior for normal pages — the inner wrapper has the same bounds and scroll characteristics that `<main>` used to have.
4. `position: sticky` consumers on normal pages are unaffected: the scroll container still wraps them, just one element deeper.

---

## Migrations

### `src/app/(dashboard)/inbox/page.tsx`

**Before:**
```tsx
<div className="space-y-3">
  <div className={cn(
    "flex h-[calc(100vh-68px-96px)] overflow-hidden",
    "rounded-panel border border-border glass-surface"
  )}>
    {/* ... list / detail / context ... */}
  </div>
  <CommandPalette ... />
  <WritebackPreferenceModal ... />
  <ComposeEmailModal ... />
  <UndoToastHost />
</div>
```

**After:**
```tsx
<>
  <div className={cn(
    "flex-1 min-h-0 flex overflow-hidden",
    "rounded-panel border border-border glass-surface"
  )}>
    {/* ... list / detail / context ... unchanged inside ... */}
  </div>
  <CommandPalette ... />
  <WritebackPreferenceModal ... />
  <ComposeEmailModal ... />
  <UndoToastHost />
</>
```

Changes:
- Outer `<div className="space-y-3">` → fragment (`space-y-3` was a no-op; all following siblings are portaled).
- Height `calc(100vh-68px-96px)` → `flex-1 min-h-0`.
- `height` shrinks automatically if the `UnassignedRoleBanner` appears.

### `src/app/(dashboard)/map/page.tsx`

**Before:**
```tsx
<div className="flex flex-col h-[calc(100vh-68px)] -m-3 relative">
  <div className="px-3 pt-3">
    <MetricsHeader ... />
  </div>
  <div className="flex flex-1 min-h-0 relative">
    {/* ... */}
  </div>
</div>
```

**After:**
```tsx
<div className="flex flex-col h-full relative">
  <div className="px-3 pt-3">
    <MetricsHeader ... />
  </div>
  <div className="flex flex-1 min-h-0 relative">
    {/* ... */}
  </div>
</div>
```

Changes:
- `h-[calc(100vh-68px)]` → `h-full` (parent in bleed mode already gives us `pt-[56px]` to clear topbar).
- Remove `-m-3` — bleed mode doesn't apply `px-3`/`pb-32`, no margin to cancel.

### `src/app/(dashboard)/calendar/page.tsx`

**Before:**
```tsx
<div className="space-y-3">
  <MetricsHeader ... />
  <div className="flex flex-col h-[calc(100vh-68px-128px)] gap-1.5">
    <CalendarHeader ... />
    <CalendarToolbar ... />
    <div className="flex flex-1 min-h-0 gap-1.5">
      {/* ... */}
    </div>
  </div>
</div>
```

**After:**
```tsx
<div className="flex flex-col h-full gap-3">
  <MetricsHeader ... />
  <div className="flex flex-col flex-1 min-h-0 gap-1.5">
    <CalendarHeader ... />
    <CalendarToolbar ... />
    <div className="flex flex-1 min-h-0 gap-1.5">
      {/* ... */}
    </div>
  </div>
</div>
```

Changes:
- Outer `space-y-3` → `flex flex-col gap-3` (flex enables `flex-1` on the inner calendar wrapper).
- Inner `h-[calc(100vh-68px-128px)]` → `flex flex-col flex-1 min-h-0`.

---

## Files Touched

```
src/components/layouts/dashboard-layout.tsx    — add FULL_HEIGHT_ROUTES, switch main to flex column, branch on mode
src/app/(dashboard)/inbox/page.tsx              — simplify outer wrapper
src/app/(dashboard)/map/page.tsx                — drop -m-3, drop calc height
src/app/(dashboard)/calendar/page.tsx           — swap space-y-3 for flex-col, drop calc height
```

Four files. No new files. No dependencies added. No schema changes.

---

## Verification Plan

1. **Inbox:** load `/inbox`. Expect: no outer scrollbar on the page. Bottom edge of the inbox card ~12px from viewport bottom. Resize viewport — card resizes continuously, no overflow.
2. **Map:** load `/map`. Expect: map bleeds to viewport edges (matches current behavior). Topbar overlays cleanly. MetricsHeader sits at top.
3. **Calendar:** load `/calendar`. Expect: MetricsHeader at top, calendar grid fills remaining space, no outer scroll.
4. **Normal page regression:** load `/projects`, `/clients`, `/pipeline`. Expect: scrolling behavior identical to today. Bottom gradient fade still renders.
5. **Banner interaction:** force `UnassignedRoleBanner` (`role_id = UNASSIGNED`). Expect: banner renders at top, full-height pages shrink by the banner's height, no overflow.
6. **Sticky check:** visit a page with `position: sticky` headers (e.g., a list with sticky column headers). Expect: sticky still pins to top of the scroll container.

---

## Design System Compliance

- Bottom gutter in padded mode: `pb-3` = 12px = 1.5 × 8dp grid cell
- Top clearance: 56px topbar + 12px gap = 68px (matches existing convention)
- Side gutters: `px-3` = 12px (matches existing convention)
- No new colors, fonts, borders, or radii introduced
- No shadows (dark-theme borders-only discipline preserved)

---

## Non-Goals

- Not migrating `/testing-grounds` (internal dev tool, low priority)
- Not refactoring the banner's placement (stays where it is)
- Not changing the bottom gradient fade's design, just conditionally hiding it
- Not touching any per-page content (only wrapper structure)
- Not changing the sidebar's fixed-overlay positioning
