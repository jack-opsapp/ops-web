# Widget Design System Spec — "HUD to Console"

> Date: 2026-03-30
> Status: Draft
> Scope: Dashboard widget infrastructure, design tokens, sizing system, anatomy standard, tooltip fix, gap fix, audit checklist, and a `widget-builder` skill for future enforcement and creation.

---

## 1. Problem Statement

The current dashboard widgets have no enforced design system:
- 22+ hardcoded hex colors across widgets instead of Tailwind tokens
- `md` and `lg` grid sizes are visually identical (same col-span classes)
- Tooltips clip inside `overflow-hidden` widget shells
- Gap configuration changes are invisible during customize mode
- No standard anatomy — each widget structures content differently
- No content budget per size tier — widgets squeeze content at small sizes instead of cutting it
- Undefined CSS classes (`border-border-primary`, `text-text-quaternary`) used in multiple widgets
- No scaffolding system for creating new widgets consistently

## 2. Design Philosophy

**"HUD to Console"** — The dashboard serves two modes depending on widget size:

- **XS/SM (HUD mode):** Glanceable KPIs. One hero metric, 2-second read time. The user scans these like instrument gauges. No charts, no lists, no interaction beyond tap-to-navigate.
- **MD (Transition):** Metric + visualization. First tier where charts and short lists appear. Interactive tooltips. Still primarily read-only.
- **LG/XL (Console mode):** Full operational detail with inline task execution. Send invoices, mark tasks complete, filter data, expand rows. These are mini-applications within the dashboard.

Every widget must work at multiple sizes. Content is **cut, not squeezed** — if it doesn't fit the tier's budget, it doesn't render.

## 3. Grid System

### 3.1 Grid Configuration

- **Column counts:** `grid-cols-2 md:grid-cols-4 xl:grid-cols-8 2xl:grid-cols-12`
- **Row height:** `gridAutoRows: 140px` (unchanged from current)
- **Gap:** User-configurable via preferences store (none/tight/normal/relaxed)
- **Auto flow:** `gridAutoFlow: dense`

### 3.2 Size Tiers

| Tier | 2xl (12-col) | xl (8-col) | md (4-col) | base (2-col) | Row Span | Pixel Height | Content Contract |
|------|-------------|-----------|-----------|-------------|----------|-------------|------------------|
| **XS** | 2 cols | 2 cols | 1 col | 1 col | 1 | 140px | Hero number + delta. Nothing else. |
| **SM** | 3 cols | 3 cols | 2 cols | 2 cols | 1 | 140px | Hero + supporting context (sparkline, secondary stat). 2-second glance. |
| **MD** | 6 cols | 4 cols | 4 cols | 2 cols | 2 | 288px | Metric + visualization. Up to 5 list items or a chart with axis labels. |
| **LG** | 6 cols | 4 cols | 4 cols | 2 cols | 4 | 584px | Full detail. Lists with inline actions. Expandable sections. Filters. |
| **XL** | 6 cols | 4 cols | 4 cols | 2 cols | 6 | 880px | Console panel. Same width as LG, more vertical depth. Data tables, full interactivity, bulk actions. Two XL widgets fit side-by-side. |

### 3.3 Grid Span Classes

```typescript
export const COL_SPAN_CLASSES: Record<WidgetSize, string> = {
  xs: "col-span-1 md:col-span-1 xl:col-span-2 2xl:col-span-2",
  sm: "col-span-2 md:col-span-2 xl:col-span-3 2xl:col-span-3",
  md: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
  lg: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
  xl: "col-span-2 md:col-span-4 xl:col-span-4 2xl:col-span-6",
};

export const ROW_SPAN_CLASSES: Record<WidgetSize, string> = {
  xs: "",
  sm: "",
  md: "row-span-2",
  lg: "row-span-4",
  xl: "row-span-6",
};
```

On mobile (base 2-col grid), XS widgets pair two-across (1 col each). Everything SM+ goes full-width.

### 3.4 WidgetSize Type Update

The `WidgetSize` type must be updated to replace `full` with `xl`:

```typescript
export type WidgetSize = "xs" | "sm" | "md" | "lg" | "xl";
```

All references to `full` in the registry, store, migration, and components must be updated to `xl`.

## 4. Widget Anatomy

Every widget at every size follows the same structural zones. Zones are **omitted** at smaller tiers, never rearranged:

```
┌─────────────────────────────────┐
│ HEADER                          │  Always present.
│                                 │  Kosugi, micro (11px), uppercase, tracking-wider, text-tertiary.
│                                 │  Widget title on left. Optional count badge on right.
├─────────────────────────────────┤
│ HERO ZONE                       │  Always present.
│                                 │  The single most important metric or visual.
│                                 │  XS/SM: This IS the widget. Nothing renders below.
│                                 │  Hero number: font-mono, data-lg (20px) at xs/sm, display (28px) at md+.
│                                 │  Hero label: font-mohave, caption-sm (12px), text-secondary.
│                                 │  Delta: font-mono, micro (11px), colored by direction.
├─────────────────────────────────┤
│ DETAIL ZONE                     │  MD+ only.
│                                 │  Chart, list, funnel, aging buckets.
│                                 │  overflow-y-auto scrollbar-hide if content exceeds zone.
│                                 │  Chart axes: font-kosugi, micro-sm (10px), uppercase, text-disabled.
├─────────────────────────────────┤
│ ACTION ZONE                     │  LG+ only.
│                                 │  Inline actions: send invoice, mark complete, toggle filters.
│                                 │  Action buttons: font-mohave, button-sm (14px).
│                                 │  This is what makes LG/XL "operational" — users execute here.
├─────────────────────────────────┤
│ FOOTER                          │  SM+ only.
│                                 │  Subtle link to detail page or last-updated timestamp.
│                                 │  Kosugi, micro (11px), uppercase, text-tertiary.
│                                 │  On hover: text-secondary.
└─────────────────────────────────┘
```

**Zone rules by size:**

| Tier | Header | Hero | Detail | Action | Footer |
|------|--------|------|--------|--------|--------|
| XS   | yes    | yes  | —      | —      | —      |
| SM   | yes    | yes  | —      | —      | yes    |
| MD   | yes    | yes  | yes    | —      | yes    |
| LG   | yes    | yes  | yes    | yes    | yes    |
| XL   | yes    | yes  | yes    | yes    | yes    |

## 5. Color Token Palette

**Rule: Zero hardcoded hex values in any widget.** Every color must reference a Tailwind design token.

### 5.1 Semantic Color Map

| Use Case | Tailwind Class | CSS Variable | Notes |
|----------|---------------|-------------|-------|
| Revenue / income | `text-financial-revenue` / `bg-financial-revenue` | `--color-financial-revenue` | Positive money in |
| Profit / margin | `text-financial-profit` / `bg-financial-profit` | `--color-financial-profit` | |
| Cost / expense | `text-financial-cost` / `bg-financial-cost` | `--color-financial-cost` | |
| Receivables | `text-financial-receivables` / `bg-financial-receivables` | `--color-financial-receivables` | |
| Overdue / past-due | `text-financial-overdue` / `bg-financial-overdue` | `--color-financial-overdue` | |
| Healthy / positive | `text-status-success` / `bg-status-success` | `--color-status-success` | |
| Warning / attention | `text-status-warning` / `bg-status-warning` | `--color-status-warning` | |
| Error / critical | `text-status-error` / `bg-status-error` | `--color-status-error` | |
| Accent (sparingly) | `text-ops-accent` / `bg-ops-accent` | `--color-ops-accent` | Not for decoration |
| Neutral chart bar | `bg-ops-accent/40` to `bg-ops-accent/60` | — | Use opacity variants |
| Card surface | `bg-background-card` | | #191919 |
| Elevated surface | `bg-background-elevated` | | #1A1A1A |

### 5.2 For Inline Styles (Charts, SVGs)

When Tailwind classes can't be used (e.g., SVG fills, chart bar backgrounds set via `style`), use CSS custom properties:

```tsx
// Correct:
style={{ backgroundColor: 'var(--color-status-warning)' }}
style={{ fill: 'var(--color-financial-revenue)' }}

// Wrong:
style={{ backgroundColor: '#C4A868' }}
style={{ fill: '#6B8F71' }}
```

If a needed CSS variable doesn't exist, add it to `tailwind.config.ts` and the global CSS — never hardcode.

### 5.3 Colors to Remove

These hardcoded values currently appear in widgets and must be replaced:

| Hardcoded Value | Replace With | Files |
|----------------|-------------|-------|
| `#C4A868` | `status-warning` | revenue-pulse, task-pulse, crew-board, action-required |
| `#B58289` | `status-error` | revenue-pulse, task-pulse, crew-board, action-required, receivables-aging |
| `#6B8F71` | `status-success` | revenue-pulse |
| `#C4976A` | `financial-receivables` (or add new token) | action-required, receivables-aging |
| `#6F94B0` | `ops-accent` | task-pulse, action-required, receivables-aging |
| `rgba(255,255,255,0.15)` | `border-subtle` or `text-disabled` opacity | task-pulse, crew-board |

### 5.4 Invalid Token References to Fix

| Invalid Reference | Replace With |
|------------------|-------------|
| `border-border-primary` | `border-border` or `border-border-subtle` |
| `text-text-quaternary` | `text-text-disabled` |

## 6. Typography Rules

| Element | Font Class | Size Token | Additional |
|---------|-----------|-----------|------------|
| Widget title | `font-kosugi` | `text-micro` (11px) | `uppercase tracking-wider text-text-tertiary` |
| Hero number | `font-mono` | `text-data-lg` (20px) xs/sm, `text-display` (28px) md+ | `font-bold text-text-primary` |
| Hero label | `font-mohave` | `text-caption-sm` (12px) | `text-text-secondary` |
| Delta indicator | `font-mono` | `text-micro` (11px) | Color by direction (success/error) |
| Supporting stat | `font-mono` | `text-data-sm` (13px) | `text-text-secondary` |
| List item primary | `font-mohave` | `text-card-body` (14px) | `font-medium text-text-primary` |
| List item secondary | `font-mohave` | `text-caption-sm` (12px) | `text-text-tertiary` |
| Chart axis label | `font-kosugi` | `text-micro-sm` (10px) | `uppercase text-text-disabled` |
| Footer link | `font-kosugi` | `text-micro` (11px) | `uppercase text-text-tertiary hover:text-text-secondary` |
| Action button text | `font-mohave` | `text-button-sm` (14px) | |
| Empty state message | `font-mohave` | `text-caption-sm` (12px) | `text-text-disabled` |

## 7. Infrastructure Fixes

### 7.1 Tooltip Portal

**Problem:** `WidgetTooltip` uses absolute positioning within `overflow-hidden` widget shells, causing tooltips to clip at widget edges.

**Fix:** Render tooltips through a React portal to `document.body`.

- Calculate position using `getBoundingClientRect()` on the trigger element (viewport-relative coordinates)
- Portal renders at the root level, outside all overflow contexts
- Widget shell keeps `overflow-hidden` for content (scrollable lists, charts)
- Tooltip style: frosted glass surface matching the OPS design system

### 7.2 Gap System

**Problem:** During customize mode, the gap is overridden to `EDIT_MODE_GAP`, making user gap changes invisible.

**Fix:** Remove the customize-mode override:

```typescript
// Before (widget-grid.tsx):
const gap = isCustomizing ? EDIT_MODE_GAP : WIDGET_GAP_VALUES[widgetGap];

// After:
const gap = WIDGET_GAP_VALUES[widgetGap];
```

The `EDIT_MODE_GAP` constant can be removed from `motion.ts`. The user's chosen gap is always visible.

### 7.3 Widget Shell Overflow

The widget shell root element has `overflow-hidden`. This is correct for content containment but must not affect tooltips (handled by portaling). The Detail zone within widgets should use `overflow-y-auto scrollbar-hide` for scrollable content.

## 8. Widget Audit Checklist

Every widget must pass all 10 checks before shipping:

1. **Colors** — Zero hardcoded hex values. All colors from approved Tailwind tokens (Section 5).
2. **Typography** — Correct font family and size token per the typography table (Section 6).
3. **Anatomy** — Follows the zone system. Each size tier renders only its allowed zones (Section 4).
4. **Content budget** — XS/SM are genuinely glanceable (2-second read max). No squeezed charts at small sizes.
5. **Overflow** — Detail zone uses `overflow-y-auto scrollbar-hide`. No content clipping visible to the user.
6. **Tooltips** — Uses portaled `WidgetTooltip`. No inline absolute-positioned tooltips within overflow containers.
7. **Navigation** — XS/SM tap navigates to the relevant detail page. `onNavigate` prop wired and functional.
8. **Loading** — Skeleton state renders at every supported size tier.
9. **Empty state** — Graceful display when data is empty/zero. No blank white space. Message + suggestion.
10. **Reduced motion** — All animations respect `prefers-reduced-motion: reduce`.

## 9. Widget Builder Skill

A custom skill that enforces the design system and guides widget creation/auditing.

### 9.1 Trigger Conditions

**File patterns:**
- `src/components/dashboard/widgets/**`
- `*-widget.tsx`

**Prompt signals:**
- "widget", "dashboard widget", "create widget", "build widget", "audit widget", "fix widget"

### 9.2 Skill Responsibilities

**When creating a new widget:**

1. **Data requirements** — Identify which existing hooks to use (`useInvoices`, `useTasks`, etc.) or whether a new service/query is needed.
2. **Registry entry** — Define the `WIDGET_TYPE_REGISTRY` entry: category, tags, supported sizes, default size, config schema, required permission, `allowMultiple`.
3. **Content design per tier** — Specify what renders in each zone at each supported size. XS hero content. SM supporting context. MD visualization type. LG action capabilities.
4. **Component implementation** — Scaffold from the standard widget template with correct imports, zone structure, size-conditional rendering, and token usage.
5. **Audit gate** — Run the 10-point checklist before marking complete.

**When auditing an existing widget:**

1. Run the 10-point checklist against the widget code.
2. Flag every violation with file, line number, and the specific rule broken.
3. Provide the corrected code for each violation.

### 9.3 Skill Dependencies

The widget-builder skill must reference and load:

| Skill | When |
|-------|------|
| `interface-design` | Always — surface, spacing, border rules |
| `animation-studio:animation-architect` | When the widget includes transitions or motion |
| `animation-studio:data-visualization` | When the widget includes charts, gauges, sparklines, or metric displays |
| `ops-copywriter` | When writing user-facing labels, empty states, or error messages |

### 9.4 Widget Component Template

The skill includes a scaffold template that new widgets are built from:

```tsx
"use client";

import { useMemo } from "react";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

// ── Props ──
interface [WidgetName]WidgetProps {
  size: WidgetSize;
  config?: Record<string, unknown>;
  // data props from parent
  isLoading?: boolean;
  onNavigate?: (path: string) => void;
}

export function [WidgetName]Widget({
  size,
  config,
  isLoading,
  onNavigate,
}: [WidgetName]WidgetProps) {
  const isCompact = size === "xs" || size === "sm";
  const showDetail = size === "md" || size === "lg" || size === "xl";
  const showActions = size === "lg" || size === "xl";
  const showFooter = size !== "xs";

  // ── Data computation ──
  // ...

  // ── Loading state ──
  if (isLoading) {
    return <WidgetSkeleton size={size} />;
  }

  return (
    <div className="h-full flex flex-col p-3">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
          {/* Widget Title */}
        </span>
      </div>

      {/* HERO ZONE */}
      <div className="flex items-baseline gap-2">
        <span className={`font-mono font-bold text-text-primary ${isCompact ? 'text-data-lg' : 'text-display'}`}>
          {/* Hero Number */}
        </span>
        {/* Delta indicator */}
      </div>

      {/* DETAIL ZONE — MD+ only */}
      {showDetail && (
        <div className="flex-1 mt-3 overflow-y-auto scrollbar-hide">
          {/* Chart, list, funnel, etc. */}
        </div>
      )}

      {/* ACTION ZONE — LG+ only */}
      {showActions && (
        <div className="mt-3 pt-2 border-t border-border-subtle">
          {/* Inline actions, filters */}
        </div>
      )}

      {/* FOOTER — SM+ only */}
      {showFooter && (
        <div className="mt-auto pt-2">
          <button
            onClick={() => onNavigate?.("/detail-page")}
            className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors"
          >
            View All
          </button>
        </div>
      )}
    </div>
  );
}
```

## 10. Migration Plan

### 10.1 WidgetSize Type Change

Rename `full` → `xl` across:
- `src/lib/types/dashboard-widgets.ts` (type definition + registry)
- `src/components/dashboard/widget-shell.tsx` (grid classes + row classes)
- `src/stores/preferences-store.ts` (migration for persisted data)
- All widget components that reference the `full` size
- Supabase `user_dashboard_preferences.widget_instances` (data migration for any stored `"full"` sizes)

### 10.2 Store Version Bump

Bump preferences store version to 15. Migration function:
- Replace any `size: "full"` with `size: "xl"` in persisted `widgetInstances`

### 10.3 Existing Widget Audit Order

Priority order for auditing/fixing existing widgets (by usage frequency):

1. revenue-pulse-widget (money — most viewed)
2. task-pulse-widget (operations — daily use)
3. pipeline-funnel-widget (pipeline — sales flow)
4. action-required-widget (alerts — drives action)
5. crew-board-widget (operations — field management)
6. receivables-aging-widget (money — collections)
7. top-clients-widget (clients)
8. activity-feed-widget (alerts)
9. All remaining widgets

## 11. Deliverables

1. **Widget Design System Spec** — This document (committed)
2. **`widget-builder` skill** — Custom skill with triggers, template, checklist, and skill dependencies
3. **Infrastructure fixes** — Grid classes, tooltip portal, gap system, `full` → `xl` rename
4. **Widget audit + rebuild** — Each widget updated to pass the 10-point checklist
5. **Tailwind token additions** — Any missing CSS custom properties for inline chart styles
