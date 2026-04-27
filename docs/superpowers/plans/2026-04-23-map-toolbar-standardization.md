# Map Toolbar Standardization — Group E2

> **Bug covered**
> - `fba85c12-f9ae-48af-a28d-e2318b188051` — Map toolbar needs redesign to match the standardized toolbar design we've created (2026-04-15)

## Skills to load

- `interface-design` + `.interface-design/system.md`
- `animation-studio:animation-architect` (for the active-pill layoutId animation only)
- `frontend-design`

## Source of truth

- Canonical spec: `OPS-Web/.interface-design/system.md` §Toggles / Segment Controls, §Tactical Character, §Z-Index Scale
- **Pattern reference:** `OPS-Web/src/app/(dashboard)/projects/_components/project-floating-toolbar.tsx`
  — specifically the `ToolbarAction` sub-component at lines 391–415, the divider pattern `<div className="w-[1px] h-[18px] bg-border-subtle" />`, and the 13×13px icon + `font-mono text-micro uppercase tracking-wider` label convention.

## Files touched

| File | Purpose |
|------|---------|
| `OPS-Web/src/components/dashboard/map/map-filter-rail.tsx` | Rebuild against the `ToolbarAction` pattern. Keep feature parity (TODAY / ACTIVE / ALL / CREW / zoom in/out) and route gating (dashboard only). |

**Isolated.** No changes to any shared layout or other page. Zero collision risk with Groups A, B, C, D, E1.

## Diagnosis

`map-filter-rail.tsx` renders bottom-left on `/dashboard` only
(line 50 gate). Current markup diverges from the standardized floating
toolbar in two noticeable ways:

1. **"Manila folder" tab label** (lines 81–92) — sticks a label tab above the
   control bar with its own glass-dense + top-rounded corners. The project
   floating toolbar has no such tab; its identity comes from the icons +
   uppercase labels, plus a sidebar-edge context. The manila tab is a
   one-off shape in the app.
2. **Inline active-state with `layoutId` spring** (lines 117–127) — uses
   Framer `layoutId="map-filter-active"` with a `spring stiffness: 400,
   damping: 25` transition for the active highlight. Spec v2 forbids spring
   physics ("NO spring physics. NO bounce.") — the only allowed easing is
   `EASE_SMOOTH`. The standardized toolbar uses simple `transition-colors
   duration-150` on the active/inactive border swap (see `ToolbarAction`
   lines 404–409), no layoutId.

Both are visible regressions against spec v2. Replace with the
`ToolbarAction` pattern, lift `CREW` and zoom buttons into the same
`ToolbarAction` shape.

## Tasks

### Task E2.1 — Rebuild `MapFilterRail` using the standardized toolbar pattern (10 min)

**File:** `OPS-Web/src/components/dashboard/map/map-filter-rail.tsx`

**Replace the entire file contents with:**

```tsx
"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  CalendarClock,
  FolderKanban,
  Layers,
  Users,
  Plus,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useMapFilterStore,
  useMapInstanceStore,
  type MapViewFilter,
} from "@/stores/map-filter-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useDashboardCustomizeStore } from "@/stores/dashboard-customize-store";

// ── Config ──

interface FilterItem {
  id: string;
  value: MapViewFilter;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const VIEW_FILTERS: FilterItem[] = [
  { id: "today", value: "today", icon: CalendarClock, label: "TODAY" },
  { id: "active", value: "active", icon: FolderKanban, label: "ACTIVE" },
  { id: "all", value: "all", icon: Layers, label: "ALL" },
];

// ── Component ──

export function MapFilterRail() {
  const pathname = usePathname();
  const { view, showCrew, setView, toggleCrew } = useMapFilterStore();
  const map = useMapInstanceStore((s) => s.map);
  const userLocation = useMapInstanceStore((s) => s.userLocation);
  const can = usePermissionStore((s) => s.can);
  const dashboardCustomizing = useDashboardCustomizeStore((s) => s.isCustomizing);

  // Sidebar-fixed offset — matches bug-report-button.tsx (sidebarWidth = 72 + 12px gap)
  const sidebarWidth = 72;

  // Route-scoped: only render on the dashboard (where the map lives)
  if (pathname !== "/dashboard") return null;

  const showCrewToggle = can("team.view");

  function handleZoomIn() {
    if (!map) return;
    if (userLocation) {
      const nextZoom = Math.min(map.getZoom() + 1, map.getMaxZoom());
      map.setView(userLocation, nextZoom, { animate: true, duration: 0.3 });
    } else {
      map.zoomIn();
    }
  }

  function handleZoomOut() {
    map?.zoomOut();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{
        opacity: dashboardCustomizing ? 0 : 1,
        y: dashboardCustomizing ? 8 : 0,
      }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "fixed bottom-3 z-[5]", // content layer per spec v2 z-scale
        "flex items-center gap-[8px] px-[6px] py-[3px]",
        "glass-surface",
        dashboardCustomizing ? "pointer-events-none" : "pointer-events-auto"
      )}
      style={{ left: sidebarWidth + 12 }}
    >
      {/* View filters */}
      {VIEW_FILTERS.map((f) => {
        const Icon = f.icon;
        return (
          <ToolbarAction
            key={f.id}
            onClick={() => setView(f.value)}
            isActive={view === f.value}
            title={f.label}
          >
            <Icon className="w-[13px] h-[13px]" />
            <span className="font-mono text-micro uppercase tracking-wider">
              {f.label}
            </span>
          </ToolbarAction>
        );
      })}

      {showCrewToggle && (
        <>
          <div className="w-[1px] h-[18px] bg-border-subtle" />
          <ToolbarAction
            onClick={toggleCrew}
            isActive={showCrew}
            title="CREW"
          >
            <Users className="w-[13px] h-[13px]" />
            <span className="font-mono text-micro uppercase tracking-wider">
              CREW
            </span>
          </ToolbarAction>
        </>
      )}

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      {/* Zoom controls — icon-only ToolbarActions */}
      <ToolbarAction onClick={handleZoomIn} title="Zoom in">
        <Plus className="w-[13px] h-[13px]" />
      </ToolbarAction>
      <ToolbarAction onClick={handleZoomOut} title="Zoom out">
        <Minus className="w-[13px] h-[13px]" />
      </ToolbarAction>
    </motion.div>
  );
}

// ── Sub-component (spec v2 toolbar action — mirrors project-floating-toolbar.tsx:391) ──

function ToolbarAction({
  children,
  onClick,
  isActive,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  title?: string;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-[5px] px-[8px] py-[5px] rounded-sm transition-colors duration-150 cursor-pointer",
        isActive
          ? "text-text bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.18)]"
          : "text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.04)] border border-transparent"
      )}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
```

Notes on what changed:
- **Manila folder tab removed.** The toolbar is self-identifying from its
  content (map filters are obvious). No precedent for the tab shape in spec v2.
- **`layoutId` spring animation removed.** Active state is now a
  border-subtle swap with `transition-colors duration-150`. Matches
  `ToolbarAction` one-to-one.
- **Single `.glass-surface` wrapper.** Previous file had a glass-dense manila
  tab stacked on top of a `.glass-surface` control bar — two separate glass
  surfaces that looked detached. One surface now.
- **Dividers** use the canonical `w-[1px] h-[18px] bg-border-subtle` pattern
  instead of the one-off `w-px h-4 bg-[rgba(255,255,255,0.06)] mx-1`.
- **Motion easing** explicitly uses `[0.22, 1, 0.36, 1]` — inline rather
  than importing `EASE_SMOOTH` for consistency with the file before this
  change (the old file also used the literal). If a follow-up lifts all
  inline easings to the constant, do it repo-wide in one pass.
- **Z-index `z-[5]`** preserved (content layer per spec v2). Map filter rail
  sits below the FAB (`floating-ui` 1500–1600) and topbar (sidebar `nav`
  500).
- **Icon size 13×13px** to match `ToolbarAction` in `project-floating-toolbar.tsx`
  (was 14×14 in the old map rail — marginally different; align to pattern).

**Commit:**
```sh
git add src/components/dashboard/map/map-filter-rail.tsx
git commit -m "refactor(map): rebuild MapFilterRail on the ToolbarAction pattern

Bug fba85c12 — map toolbar diverged from the standardized floating
toolbar (project-floating-toolbar.tsx) with a one-off manila folder
label tab and a layoutId spring active-state animation (forbidden by
spec v2 — no spring physics). Rebuild against the ToolbarAction sub-
component: single glass-surface wrapper, divider-subtle separators,
13x13px icons, transition-colors active state, EASE_SMOOTH motion."
```

### Task E2.2 — Browser verify (3 min)

1. `cd OPS-Web && npm run dev`
2. Navigate to `/dashboard` (the one with the map).
3. **Visual parity check**: open `/projects` in another tab, scroll to the
   canvas. Compare the project floating toolbar and the map filter rail —
   active pill, hover, typography should match.
4. **Interaction**:
   - Click TODAY / ACTIVE / ALL → active state swaps with `transition-colors`
     (no spring bounce). The `layoutId` visual "slide" is gone.
   - If user has `team.view` permission, toggle CREW — active state works.
   - Click `+` / `−` zoom buttons — map zooms.
5. **Dashboard customize mode**: enter customize mode via the dashboard
   settings; the toolbar fades out (`opacity: 0`, `pointer-events: none`).
6. **Reduced motion**: toggle system "Reduce motion" — the entrance animation
   falls back to instant (Framer handles via `transition` duration 0.25
   being ignored in favor of the default).
7. **Route gate**: navigate away from `/dashboard` to `/calendar` → the
   toolbar unmounts.

**If visual parity with the project toolbar fails at any hover/active state:**
do not commit. Open both side-by-side, adjust the button padding/border
values until they match.

**Commit (verification):**
```sh
git commit --allow-empty -m "chore(map): browser-verified group E2 fix

MapFilterRail renders with ToolbarAction parity vs project-floating-
toolbar.tsx — active/hover/layout/typography all match spec v2."
```

## Acceptance criteria

- [ ] Bug_reports row `fba85c12` manually resolved on review
- [ ] No `layoutId` with spring transition in the file
- [ ] No "manila folder" tab pattern remaining
- [ ] Active / hover states visually match `ToolbarAction` in `project-floating-toolbar.tsx`
- [ ] Zero TypeScript errors, lint clean
- [ ] Reduced-motion path tested

## Non-goals / out of scope

- Changing which filters exist (TODAY / ACTIVE / ALL / CREW) or their
  semantics
- Touching `useMapFilterStore` or `useMapInstanceStore`
- Migrating `project-floating-toolbar.tsx`'s inline easing constants to the
  `EASE_SMOOTH` symbol (separate cleanup pass if desired)
