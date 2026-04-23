# Widget Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "HUD to Console" widget design system — fix grid sizing, tooltip overflow, gap system, color tokens, and create a widget-builder skill for enforcing conventions on all current and future widgets.

**Architecture:** Infrastructure-first approach. Fix the grid system, tooltip portal, and gap configuration first (these affect all widgets). Then create the widget-builder skill. Then audit/rebuild individual widgets using the skill as the enforcement mechanism.

**Tech Stack:** Next.js 14, Tailwind CSS, Framer Motion, dnd-kit, Zustand (persisted), React portals

**Spec:** `docs/superpowers/specs/2026-03-30-widget-design-system.md`

---

## File Structure

### Files to Modify
- `src/lib/types/dashboard-widgets.ts` — WidgetSize type: `full` → `xl`, registry updates
- `src/components/dashboard/widget-shell.tsx` — COL_SPAN_CLASSES, ROW_SPAN_CLASSES
- `src/components/dashboard/widget-grid.tsx` — Gap logic fix
- `src/components/dashboard/widgets/shared/widget-tooltip.tsx` — Portal rendering
- `src/lib/utils/motion.ts` — Remove EDIT_MODE_GAP
- `src/stores/preferences-store.ts` — Version bump + `full` → `xl` migration
- `src/styles/globals.css` — CSS custom properties for widget colors
- `src/app/(dashboard)/dashboard/page.tsx` — WidgetSize references
- Individual widget files in `src/components/dashboard/widgets/`

### Files to Create
- `src/lib/widget-tokens.ts` — Shared color/typography constants for widgets

---

## Phase 1: Infrastructure

### Task 1: Add CSS Custom Properties for Widget Colors

**Files:**
- Modify: `src/styles/globals.css`

CSS custom properties are needed for inline styles (chart bars, SVG fills) where Tailwind classes can't be used. Currently only `--ops-accent-rgb` exists. Financial and status colors have no CSS variables.

- [ ] **Step 1: Add widget color CSS variables to globals.css**

Add to the `:root` block in `src/styles/globals.css`:

```css
/* Widget color tokens — for inline styles (charts, SVGs) */
/* Use Tailwind classes (text-status-warning, bg-financial-revenue) where possible. */
/* These variables are for cases where inline style={{ }} is required. */
--color-status-success: #A5B368;
--color-status-warning: #C4A868;
--color-status-error: #93321A;
--color-financial-revenue: #C4A868;
--color-financial-profit: #9DB582;
--color-financial-cost: #B58289;
--color-financial-receivables: #D4A574;
--color-financial-overdue: #93321A;
--color-ops-accent: rgb(var(--ops-accent-rgb));
```

- [ ] **Step 2: Create widget token constants file**

Create `src/lib/widget-tokens.ts`:

```typescript
/**
 * Widget design system tokens.
 *
 * RULES:
 * 1. Use Tailwind classes (text-status-warning, bg-financial-revenue) in className.
 * 2. Use these CSS variable references ONLY for inline style={{ }} (charts, SVGs).
 * 3. NEVER hardcode hex values in widget components.
 */

// ── CSS variable references for inline styles ──
export const WT = {
  // Financial
  revenue: "var(--color-financial-revenue)",
  profit: "var(--color-financial-profit)",
  cost: "var(--color-financial-cost)",
  receivables: "var(--color-financial-receivables)",
  overdue: "var(--color-financial-overdue)",
  // Status
  success: "var(--color-status-success)",
  warning: "var(--color-status-warning)",
  error: "var(--color-status-error)",
  // Accent
  accent: "var(--color-ops-accent)",
  accentMuted: "rgba(var(--ops-accent-rgb) / 0.4)",
  accentSubtle: "rgba(var(--ops-accent-rgb) / 0.15)",
  // Neutral
  muted: "rgba(255, 255, 255, 0.15)",
  faint: "rgba(255, 255, 255, 0.08)",
} as const;

// ── Hero number size by widget tier ──
export const HERO_SIZE_CLASS = {
  compact: "text-data-lg", // xs, sm
  expanded: "text-display", // md, lg, xl
} as const;

// ── Zone visibility helpers ──
export function isCompact(size: string): boolean {
  return size === "xs" || size === "sm";
}

export function showDetail(size: string): boolean {
  return size === "md" || size === "lg" || size === "xl";
}

export function showActions(size: string): boolean {
  return size === "lg" || size === "xl";
}

export function showFooter(size: string): boolean {
  return size !== "xs";
}
```

- [ ] **Step 3: Commit**

```bash
git add src/styles/globals.css src/lib/widget-tokens.ts
git commit -m "feat: add CSS custom properties and token constants for widget design system"
```

---

### Task 2: Rename WidgetSize `full` → `xl`

**Files:**
- Modify: `src/lib/types/dashboard-widgets.ts:5`

- [ ] **Step 1: Update the WidgetSize type**

In `src/lib/types/dashboard-widgets.ts`, line 5, change:

```typescript
// Before:
export type WidgetSize = "xs" | "sm" | "md" | "lg" | "full";

// After:
export type WidgetSize = "xs" | "sm" | "md" | "lg" | "xl";
```

- [ ] **Step 2: Update all references to `"full"` in the same file**

Search the file for every occurrence of `"full"` and replace with `"xl"`:

- `WIDGET_SIZE_GRID_SPANS` — key `full` → `xl`
- `WIDGET_SIZE_LABELS` — key `full` → `xl`, value `"XL"` → `"XL"` (already correct)
- `WIDGET_TYPE_REGISTRY` — any `supportedSizes` or `defaultSize` that includes `"full"` → `"xl"`

In `WIDGET_SIZE_GRID_SPANS`:
```typescript
// Before:
full: { colSpan: 8, rowSpan: 1 },
// After:
xl: { colSpan: 6, rowSpan: 6 },
```

In `WIDGET_SIZE_LABELS`:
```typescript
// Before:
full: "XL",
// After:
xl: "XL",
```

- [ ] **Step 3: Update widget-shell.tsx grid classes**

In `src/components/dashboard/widget-shell.tsx`, replace lines 22-36 with the new grid classes from the spec:

```typescript
export const COL_SPAN_CLASSES: Record<WidgetSize, string> = {
  xs: "col-span-1 md:col-span-1 xl:col-span-2 2xl:col-span-2",
  sm: "col-span-2 md:col-span-2 xl:col-span-3 2xl:col-span-3",
  md: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
  lg: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
  xl: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
};

const ROW_SPAN_CLASSES: Record<WidgetSize, string> = {
  xs: "",
  sm: "",
  md: "row-span-2",
  lg: "row-span-4",
  xl: "row-span-6",
};
```

- [ ] **Step 4: Search and replace remaining `"full"` references**

Run a codebase search for `"full"` in widget-related files. Key files to check:

- `src/app/(dashboard)/dashboard/page.tsx` — any `case "full":` in the switch
- `src/components/dashboard/widget-grid.tsx` — any references to `"full"` size
- `src/components/dashboard/widget-tray.tsx` — size pills or labels
- `src/components/dashboard/widgets/*.tsx` — any widget that uses `full` size

Replace every occurrence of the string `"full"` (as a WidgetSize value) with `"xl"`.

- [ ] **Step 5: Verify TypeScript compilation**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors. The compiler will catch any missed `"full"` references.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename WidgetSize 'full' to 'xl', update grid span classes per design system spec"
```

---

### Task 3: Fix Gap System

**Files:**
- Modify: `src/components/dashboard/widget-grid.tsx:64-66`
- Modify: `src/lib/utils/motion.ts:24-25`

- [ ] **Step 1: Remove gap override in widget-grid.tsx**

In `src/components/dashboard/widget-grid.tsx`, replace lines 64-66:

```typescript
// Before:
// During customize mode, use the wider edit gap for comfortable dragging.
// In normal mode, use the user's preference.
const gap = isCustomizing ? EDIT_MODE_GAP : WIDGET_GAP_VALUES[widgetGap];

// After:
const gap = WIDGET_GAP_VALUES[widgetGap];
```

- [ ] **Step 2: Remove EDIT_MODE_GAP import from widget-grid.tsx**

Remove `EDIT_MODE_GAP` from the import statement on line 8:

```typescript
// Before:
import { gridVariants, EDIT_MODE_GAP, SPRING_REORDER } from "@/lib/utils/motion";

// After:
import { gridVariants, SPRING_REORDER } from "@/lib/utils/motion";
```

- [ ] **Step 3: Remove EDIT_MODE_GAP and NORMAL_GAP from motion.ts**

In `src/lib/utils/motion.ts`, remove lines 24-25:

```typescript
// Remove these lines:
export const EDIT_MODE_GAP = 12;
export const NORMAL_GAP = 8;
```

- [ ] **Step 4: Search for other references to EDIT_MODE_GAP or NORMAL_GAP**

```bash
grep -r "EDIT_MODE_GAP\|NORMAL_GAP" src/ --include="*.ts" --include="*.tsx"
```

Remove any remaining imports or usages.

- [ ] **Step 5: Verify the dev server still works**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/widget-grid.tsx src/lib/utils/motion.ts
git commit -m "fix: remove customize-mode gap override — user gap preference always visible"
```

---

### Task 4: Portal the Tooltip System

**Files:**
- Modify: `src/components/dashboard/widgets/shared/widget-tooltip.tsx`

The current tooltip uses absolute positioning within `overflow-hidden` widget shells, causing clipping. Fix: render via React portal to `document.body` with viewport-relative coordinates.

- [ ] **Step 1: Rewrite widget-tooltip.tsx with portal rendering**

Replace the entire contents of `src/components/dashboard/widgets/shared/widget-tooltip.tsx`:

```tsx
"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

// ── WidgetTooltip ──
// Renders via portal to document.body so it escapes overflow-hidden containers.
// Position is viewport-relative, calculated from the trigger's bounding rect.

interface WidgetTooltipProps {
  visible: boolean;
  /** Viewport-relative X coordinate (from getBoundingClientRect) */
  x: number;
  /** Viewport-relative Y coordinate (from getBoundingClientRect) */
  y: number;
  /** Reference element to calculate viewport position from. If provided, x/y are treated as offsets within this element. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchor?: "above" | "below";
  children: ReactNode;
}

export function WidgetTooltip({
  visible,
  x,
  y,
  anchorRef,
  anchor = "above",
  children,
}: WidgetTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [flippedAnchor, setFlippedAnchor] = useState(anchor);

  // Set portal target on mount (client-only)
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // Calculate viewport position and handle anchor flipping
  useEffect(() => {
    if (!visible || !ref.current) return;

    const el = ref.current;
    const tooltipRect = el.getBoundingClientRect();

    // Flip anchor if tooltip would go off-screen
    if (anchor === "above" && tooltipRect.top < 8) {
      setFlippedAnchor("below");
    } else if (anchor === "below" && tooltipRect.bottom > window.innerHeight - 8) {
      setFlippedAnchor("above");
    } else {
      setFlippedAnchor(anchor);
    }
  }, [visible, x, y, anchor]);

  if (!visible || !portalTarget) return null;

  // Calculate final viewport position
  let viewportX = x;
  let viewportY = y;

  if (anchorRef?.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    viewportX = rect.left + x;
    viewportY = rect.top + y;
  }

  const tooltip = (
    <div
      ref={ref}
      className={cn(
        "fixed z-[10000] pointer-events-none max-w-[220px]",
        "rounded-md px-[10px] py-[6px]",
        "font-mohave text-caption-sm text-text-primary",
        "transition-opacity duration-150",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{
        left: `${viewportX}px`,
        top: flippedAnchor === "above" ? `${viewportY - 8}px` : undefined,
        bottom: flippedAnchor === "below" ? `${window.innerHeight - viewportY + 8}px` : undefined,
        transform: "translateX(-50%)",
        background: "rgba(10, 10, 10, 0.90)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      {children}
    </div>
  );

  return createPortal(tooltip, portalTarget);
}

// ── TooltipRow ──
// Reusable content row for tooltips with label + value alignment.

interface TooltipRowProps {
  label: string;
  value: string | number;
  color?: string;
  bold?: boolean;
}

export function TooltipRow({ label, value, color, bold }: TooltipRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-[120px]">
      <div className="flex items-center gap-[6px]">
        {color && (
          <span
            className="w-[6px] h-[6px] rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="font-mohave text-micro text-text-tertiary">{label}</span>
      </div>
      <span className={cn("font-mono text-micro text-text-primary", bold && "font-bold")}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Update widgets that use WidgetTooltip to pass anchorRef**

Widgets that currently pass `x` and `y` as element-relative coordinates need to also pass `anchorRef` so the portal can calculate viewport position. Search for all usages:

```bash
grep -rn "WidgetTooltip" src/components/dashboard/widgets/ --include="*.tsx"
```

For each widget using `WidgetTooltip`, add a `ref` to the chart/content container and pass it as `anchorRef`:

```tsx
// Example pattern — add to each widget that uses WidgetTooltip:
const chartRef = useRef<HTMLDivElement>(null);

// On the chart container:
<div ref={chartRef} className="relative">
  {/* chart bars */}
</div>

// On the tooltip:
<WidgetTooltip
  visible={tooltip.visible}
  x={tooltip.x}
  y={tooltip.y}
  anchorRef={chartRef}
  anchor="above"
>
  {/* tooltip content */}
</WidgetTooltip>
```

- [ ] **Step 3: Verify tooltips render outside widget boundaries**

Start the dev server and hover over chart bars in a widget (e.g., revenue-pulse). The tooltip should appear above/below the chart bar without being clipped by the widget card edges.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/widgets/shared/widget-tooltip.tsx
git add src/components/dashboard/widgets/*.tsx
git commit -m "fix: portal widget tooltips to document.body — escapes overflow-hidden containers"
```

---

### Task 5: Store Migration — Version 15

**Files:**
- Modify: `src/stores/preferences-store.ts:226-227`

Bump the store version so the `full` → `xl` rename and widget consolidation run for all users.

- [ ] **Step 1: Bump version to 15**

In `src/stores/preferences-store.ts`, line 226, change:

```typescript
// Before:
version: 14,

// After:
version: 15,
```

- [ ] **Step 2: Add `full` → `xl` migration to the unconditional block**

In the unconditional widget consolidation block (around line 235), add `"full"` to the `RENAME_MAP`:

```typescript
const RENAME_MAP: Record<string, string> = {
  "revenue-chart": "revenue-pulse",
  "invoice-aging": "receivables-aging",
  "expense-summary": "expense-tracker",
  "calendar": "todays-schedule",
  "crew-status": "crew-board",
  "pipeline-sources": "lead-sources",
};
```

This handles typeId renames but not size renames. Add a size migration pass after the typeId consolidation loop. After line 338 (`state.widgetInstances = migrated;`), add:

```typescript
// Rename size "full" → "xl" in all instances
const sizeRenamed = (state.widgetInstances as WidgetInstance[]).map((inst) => {
  if ((inst.size as string) === "full") {
    return { ...inst, size: "xl" as WidgetSize };
  }
  return inst;
});
state.widgetInstances = sizeRenamed;
```

- [ ] **Step 3: Update the Supabase migration for the user's remote data**

Run an SQL update to rename any `"full"` sizes in stored widget instances:

```sql
UPDATE user_dashboard_preferences
SET widget_instances = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'size' = 'full'
      THEN jsonb_set(elem, '{size}', '"xl"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(widget_instances) AS elem
)
WHERE widget_instances::text LIKE '%"full"%';
```

- [ ] **Step 4: Commit**

```bash
git add src/stores/preferences-store.ts
git commit -m "feat: bump preferences store to v15 — migrate WidgetSize 'full' to 'xl'"
```

---

## Phase 2: Widget Builder Skill

### Task 6: Create the widget-builder Skill

**Files:**
- Create: Custom skill file for the widget-builder

This skill enforces the widget design system and guides widget creation. It should be created using the `plugin-dev:skill-development` approach or placed in the custom-skills directory.

- [ ] **Step 1: Identify the correct skill location**

Check the custom-skills plugin structure:

```bash
ls -la ~/.claude/plugins/*/skills/ 2>/dev/null || echo "Check plugin structure"
```

The skill should be placed in the custom-skills plugin alongside existing skills like `interface-design`, `wireframe`, etc.

- [ ] **Step 2: Create the skill file**

Create the skill SKILL.md with:
- **Frontmatter:** name, description, metadata (filePattern, bashPattern, priority)
- **Trigger patterns:** `src/components/dashboard/widgets/**`, `*-widget.tsx`
- **Prompt signals:** "widget", "dashboard widget", "create widget", "audit widget"
- **Content:** The complete widget design system rules including:
  - Size tier table with content contracts
  - Zone anatomy with tier rules
  - Color token palette (reference `src/lib/widget-tokens.ts`)
  - Typography rules table
  - 10-point audit checklist
  - Widget component template scaffold
  - Instructions to load `interface-design`, `animation-studio:animation-architect`, `animation-studio:data-visualization`, and `ops-copywriter` as dependencies
  - Registry entry guidance for new widgets

The skill content should be the authoritative reference — an agent reading only this skill should be able to create or audit any widget correctly.

- [ ] **Step 3: Verify the skill loads**

Create a test by opening a widget file and confirming the skill triggers.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: create widget-builder skill — enforces HUD-to-Console design system"
```

---

## Phase 3: Widget Audits

Each widget audit follows the same process:
1. Read the widget file
2. Run the 10-point checklist
3. Fix every violation
4. Verify at each supported size tier

These tasks are designed for parallel subagent execution — each is fully self-contained.

### Task 7: Audit revenue-pulse-widget

**Files:**
- Modify: `src/components/dashboard/widgets/revenue-pulse-widget.tsx`

**Known violations from audit:**
- Lines 19-20: Hardcoded `#C4A868`, `rgba(196, 168, 104, 0.6)`
- Line 172: Uses undefined `text-text-quaternary`
- Line 188: Hardcoded `#6B8F71`, `#B58289`
- Line 312: Uses undefined `border-border-primary`
- Chart bar colors use inline hex

- [ ] **Step 1: Read the full widget file and identify all violations**

Read `src/components/dashboard/widgets/revenue-pulse-widget.tsx` completely. Check against the 10-point audit checklist from the spec. List every violation with line number.

- [ ] **Step 2: Replace all hardcoded colors**

Import `WT` from `@/lib/widget-tokens`:

```typescript
import { WT, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
```

Replace every hardcoded hex:
- `#C4A868` → `WT.warning` or `WT.revenue`
- `rgba(196, 168, 104, 0.6)` → `WT.accentMuted`
- `#6B8F71` → `WT.success`
- `#B58289` → `WT.error`
- `#6F94B0` → `WT.accent`

Replace in className:
- `border-border-primary` → `border-border` or `border-border-subtle`
- `text-text-quaternary` → `text-text-disabled`

- [ ] **Step 3: Enforce zone anatomy per size tier**

Verify the widget uses conditional rendering by size:
- XS: Header + Hero only (single revenue number + delta)
- SM: Header + Hero + Footer
- MD: Header + Hero + bar chart + Footer
- LG: Header + Hero + bar chart + action row + Footer

Use the `isCompact`, `showDetail`, `showActions`, `showFooter` helpers from widget-tokens.

- [ ] **Step 4: Verify typography**

Check every text element against the typography table:
- Widget title: `font-kosugi text-micro uppercase tracking-wider text-text-tertiary`
- Hero number: `font-mono font-bold` + size-conditional class
- Chart axis: `font-kosugi text-micro-sm uppercase text-text-disabled`

- [ ] **Step 5: Verify loading and empty states**

Ensure the widget renders a skeleton at every supported size when `isLoading` is true. Ensure an empty state renders when `invoices` is empty.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/widgets/revenue-pulse-widget.tsx
git commit -m "fix(widget): audit revenue-pulse — design system compliance"
```

---

### Task 8: Audit task-pulse-widget

**Files:**
- Modify: `src/components/dashboard/widgets/task-pulse-widget.tsx`

**Known violations:**
- Lines 18-22: `SEGMENT_COLORS` with hardcoded `#B58289`, `#C4A868`, `#6F94B0`, `rgba(255,255,255,0.15)`

- [ ] **Step 1: Read the full widget and list all violations**

Read `src/components/dashboard/widgets/task-pulse-widget.tsx`. Check all 10 points.

- [ ] **Step 2: Replace SEGMENT_COLORS with token references**

```typescript
import { WT } from "@/lib/widget-tokens";

const SEGMENT_COLORS = {
  overdue: WT.error,
  dueToday: WT.warning,
  inProgress: WT.accent,
  upcoming: WT.muted,
} as const;
```

- [ ] **Step 3: Enforce zone anatomy and typography**

Apply the same zone rules and typography checks as Task 7.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/widgets/task-pulse-widget.tsx
git commit -m "fix(widget): audit task-pulse — design system compliance"
```

---

### Task 9: Audit pipeline-funnel-widget

**Files:**
- Modify: `src/components/dashboard/widgets/pipeline-funnel-widget.tsx`

- [ ] **Step 1: Read the full widget and list all violations**

Read `src/components/dashboard/widgets/pipeline-funnel-widget.tsx`. Check all 10 points. Note any hardcoded colors, wrong fonts, or missing zone enforcement.

- [ ] **Step 2: Fix all color violations**

Replace any hardcoded hex values or inline rgba with `WT.*` tokens. Replace `border-[rgba(255,255,255,0.12)]` with `border-border-subtle`.

- [ ] **Step 3: Enforce zone anatomy and typography**

Apply zone rules. Verify XS shows only a hero count, SM adds supporting text, MD shows the funnel visualization.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/widgets/pipeline-funnel-widget.tsx
git commit -m "fix(widget): audit pipeline-funnel — design system compliance"
```

---

### Task 10: Audit action-required-widget

**Files:**
- Modify: `src/components/dashboard/widgets/action-required-widget.tsx`

**Known violations:**
- Lines 29-32: `TYPE_CONFIG` with hardcoded `#B58289`, `#C4976A`, `#C4A868`, `#6F94B0`

- [ ] **Step 1: Read and list violations**
- [ ] **Step 2: Replace TYPE_CONFIG colors with WT tokens**

```typescript
import { WT } from "@/lib/widget-tokens";

const TYPE_CONFIG = {
  "overdue-task": { color: WT.error, /* ... */ },
  "past-due-invoice": { color: WT.receivables, /* ... */ },
  "expiring-estimate": { color: WT.warning, /* ... */ },
  "stale-follow-up": { color: WT.accent, /* ... */ },
};
```

- [ ] **Step 3: Enforce zone anatomy, typography, empty state**
- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/widgets/action-required-widget.tsx
git commit -m "fix(widget): audit action-required — design system compliance"
```

---

### Task 11: Audit crew-board-widget

**Files:**
- Modify: `src/components/dashboard/widgets/crew-board-widget.tsx`

**Known violations:**
- Lines 28-32: `utilizationColor()` with hardcoded `#B58289`, `#6B8F71`, `#C4A868`, `rgba(255,255,255,0.2)`

- [ ] **Step 1: Read and list violations**
- [ ] **Step 2: Replace utilizationColor with WT tokens**

```typescript
import { WT } from "@/lib/widget-tokens";

function utilizationColor(pct: number): string {
  if (pct > 100) return WT.error;
  if (pct >= 60) return WT.success;
  if (pct >= 20) return WT.warning;
  return WT.muted;
}
```

- [ ] **Step 3: Enforce zone anatomy, typography, empty state**
- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/widgets/crew-board-widget.tsx
git commit -m "fix(widget): audit crew-board — design system compliance"
```

---

### Task 12: Audit receivables-aging-widget

**Files:**
- Modify: `src/components/dashboard/widgets/receivables-aging-widget.tsx`

**Known violations:**
- Lines 18-23: `BUCKETS` array with hardcoded colors
- Line 197: Fixed `h-[20px]` bar height not scaled by size
- Uses undefined `border-border-primary`

- [ ] **Step 1: Read and list violations**
- [ ] **Step 2: Replace BUCKETS colors with WT tokens**

```typescript
import { WT } from "@/lib/widget-tokens";

const BUCKETS = [
  { label: "Current", color: WT.accent, /* ... */ },
  { label: "1-30", color: WT.warning, /* ... */ },
  { label: "31-60", color: WT.receivables, /* ... */ },
  { label: "61-90", color: WT.cost, /* ... */ },
  { label: "90+", color: WT.error, /* ... */ },
];
```

- [ ] **Step 3: Scale bar height by size**

```typescript
const barHeight = isCompact(size) ? "h-[14px]" : size === "md" ? "h-[20px]" : "h-[24px]";
```

- [ ] **Step 4: Fix border class and enforce zone anatomy**
- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/widgets/receivables-aging-widget.tsx
git commit -m "fix(widget): audit receivables-aging — design system compliance"
```

---

### Task 13: Audit Remaining Widgets

**Files:**
- All remaining widget files in `src/components/dashboard/widgets/`

For each remaining widget, run the same audit process:

1. Read the widget file completely
2. Check against the 10-point checklist
3. Replace hardcoded colors with `WT.*` tokens
4. Enforce zone anatomy per size tier
5. Verify typography against the table
6. Verify loading skeleton and empty state
7. Commit

**Remaining widgets to audit:**
- `top-clients-widget.tsx`
- `win-rate-widget.tsx`
- `backlog-depth-widget.tsx`
- `booking-rate-widget.tsx`
- `expense-tracker-widget.tsx`
- `cash-position-widget.tsx`
- `profit-gauge-widget.tsx`
- `lead-sources-widget.tsx`
- `todays-schedule-widget.tsx`
- `invoice-list-widget.tsx`
- `payments-recent-widget.tsx`
- `estimates-overview-widget.tsx`
- `pipeline-list-widget.tsx`
- `client-list-widget.tsx`
- `client-attention-widget.tsx`
- `activity-feed-widget.tsx`
- `notifications-widget.tsx`
- `site-visits-widget.tsx`
- `crew-locations-widget.tsx`
- `spacer-widget.tsx`

Each widget audit is independent and can be executed in parallel by separate subagents.

---

## Execution Notes

- **Phase 1 (Tasks 1-5) must run sequentially** — each task builds on the previous
- **Phase 2 (Task 6) depends on Phase 1** — the skill references infrastructure created in Phase 1
- **Phase 3 (Tasks 7-13) can run in parallel** — each widget audit is independent after infrastructure is in place
- The widget-builder skill (Task 6) should be loaded by agents executing Phase 3 tasks
