# Dashboard Widgets Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 54 widget type IDs down to 27 — cutting redundancy, adding 6 new high-value widgets, redesigning 8 with interactivity, and adding shared tooltip/skeleton/sparkline infrastructure.

**Architecture:** Three-phase build: (1) shared infrastructure + type system + migration, (2) widget component implementations, (3) dashboard page/tray/defaults integration. Each widget is a self-contained `.tsx` file in `src/components/dashboard/widgets/` that receives `size` and optionally `config` + data props. All interactive widgets use a shared `WidgetTooltip` component. All widgets use `WidgetSkeleton` for loading states. No `overflow-y-auto` — content is truncated to fit 140px row height.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, Framer Motion, TanStack Query, Zustand, dnd-kit, Lucide React

**Spec:** `docs/superpowers/specs/2026-03-26-dashboard-widgets-redesign.md`

---

## File Structure

### New Files to Create
```
src/components/dashboard/widgets/shared/
├── widget-tooltip.tsx          # Shared hover tooltip for all chart interactions
├── widget-skeleton.tsx         # Skeleton loading shapes (stat, bar-chart, list, ring, etc.)
├── sparkline.tsx               # Inline SVG sparkline for xs/sm stat displays
├── use-animated-value.ts       # Extracted from stat-card.tsx (reusable count-up hook)
└── use-widget-intersection.ts  # IntersectionObserver hook for entry animations

src/components/dashboard/widgets/
├── revenue-pulse-widget.tsx    # REDESIGN of revenue-chart-widget.tsx
├── receivables-aging-widget.tsx # REDESIGN of invoice-aging-widget.tsx
├── profit-gauge-widget.tsx     # NEW
├── expense-tracker-widget.tsx  # REDESIGN of expense-summary-widget.tsx
├── cash-position-widget.tsx    # NEW
├── pipeline-funnel-widget.tsx  # REDESIGN (overwrite existing)
├── win-rate-widget.tsx         # NEW
├── backlog-depth-widget.tsx    # NEW
├── booking-rate-widget.tsx     # NEW
├── task-pulse-widget.tsx       # NEW
├── todays-schedule-widget.tsx  # REDESIGN of calendar-widget.tsx
├── crew-board-widget.tsx       # REDESIGN of crew-status-widget.tsx
├── top-clients-widget.tsx      # NEW (replaces client-revenue, ranking)
├── action-required-widget.tsx  # NEW
└── lead-sources-widget.tsx     # RENAME of pipeline-sources-widget.tsx
```

### Files to Modify
```
src/lib/types/dashboard-widgets.ts      # New type IDs, categories, registry entries
src/stores/preferences-store.ts         # v12 migration
src/lib/utils/widget-defaults.ts        # Role-based defaults
src/app/(dashboard)/dashboard/page.tsx  # New renderWidgetContent, imports
src/components/dashboard/widget-tray.tsx # New categories
src/i18n/dictionaries/en/dashboard.json # New i18n keys
src/i18n/dictionaries/es/dashboard.json # Spanish translations
```

### Files to Delete (after integration complete)
```
src/components/dashboard/widgets/revenue-chart-widget.tsx
src/components/dashboard/widgets/invoice-aging-widget.tsx
src/components/dashboard/widgets/expense-summary-widget.tsx
src/components/dashboard/widgets/calendar-widget.tsx
src/components/dashboard/widgets/crew-status-widget.tsx
src/components/dashboard/widgets/pipeline-sources-widget.tsx
src/components/dashboard/widgets/stat-card.tsx             # After extracting useAnimatedValue
src/components/dashboard/widgets/stat-widget.tsx
src/components/dashboard/widgets/ranking-widget.tsx
src/components/dashboard/widgets/project-status-chart-widget.tsx
src/components/dashboard/widgets/task-status-chart-widget.tsx
src/components/dashboard/widgets/overdue-tasks-widget.tsx
src/components/dashboard/widgets/past-due-invoices-widget.tsx
src/components/dashboard/widgets/follow-ups-due-widget.tsx
src/components/dashboard/widgets/client-revenue-widget.tsx
src/components/dashboard/widgets/client-activity-widget.tsx
src/components/dashboard/widgets/estimates-funnel-widget.tsx
src/components/dashboard/widgets/pipeline-value-widget.tsx
src/components/dashboard/widgets/pipeline-velocity-widget.tsx
src/components/dashboard/widgets/action-bar-widget.tsx
```

---

## PHASE 1: Foundation

### Task 1: Shared Infrastructure — Widget Tooltip

**Files:**
- Create: `src/components/dashboard/widgets/shared/widget-tooltip.tsx`

- [ ] **Step 1: Create the tooltip component**

```typescript
"use client";

import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface WidgetTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  anchor?: "above" | "below";
  children: React.ReactNode;
}

export function WidgetTooltip({ visible, x, y, anchor = "above", children }: WidgetTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!ref.current || !visible) return;
    const rect = ref.current.getBoundingClientRect();
    // Flip below if tooltip would overflow top of viewport
    setFlipped(anchor === "above" && rect.top < 8);
  }, [visible, y, anchor]);

  const resolvedAnchor = flipped ? "below" : anchor;

  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-[1000] pointer-events-none max-w-[200px] px-2 py-1.5 rounded-sm",
        "bg-[rgba(10,10,10,0.85)] backdrop-blur-[12px] border border-[rgba(255,255,255,0.12)]",
        "transition-all duration-150",
        visible
          ? "opacity-100 translate-y-0"
          : resolvedAnchor === "above"
            ? "opacity-0 translate-y-1"
            : "opacity-0 -translate-y-1"
      )}
      style={{
        left: `${x}px`,
        top: resolvedAnchor === "above" ? `${y - 8}px` : undefined,
        bottom: resolvedAnchor === "below" ? `calc(100% - ${y}px + 8px)` : undefined,
        transform: `translateX(-50%)${visible ? "" : ` translateY(${resolvedAnchor === "above" ? "4px" : "-4px"})`}`,
      }}
    >
      {children}
    </div>
  );
}

/** Standard tooltip content row */
export function TooltipRow({
  label,
  value,
  color,
  delta,
}: {
  label: string;
  value: string;
  color?: string;
  delta?: { value: string; direction: "up" | "down" | "neutral" };
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-[120px]">
      <div className="flex items-center gap-1">
        {color && <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: color }} />}
        <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider whitespace-nowrap">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="font-mono text-[11px] text-text-primary font-medium">{value}</span>
        {delta && (
          <span className={cn(
            "font-mono text-[9px]",
            delta.direction === "up" && "text-status-success",
            delta.direction === "down" && "text-ops-error",
            delta.direction === "neutral" && "text-text-tertiary"
          )}>
            {delta.direction === "up" ? "+" : delta.direction === "down" ? "-" : ""}{delta.value}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd OPS-Web && npx tsc --noEmit src/components/dashboard/widgets/shared/widget-tooltip.tsx 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/shared/widget-tooltip.tsx
git commit -m "feat(dashboard): add shared WidgetTooltip component for chart hover interactions"
```

---

### Task 2: Shared Infrastructure — Widget Skeleton

**Files:**
- Create: `src/components/dashboard/widgets/shared/widget-skeleton.tsx`

- [ ] **Step 1: Create the skeleton component**

```typescript
"use client";

import { cn } from "@/lib/utils/cn";

type SkeletonVariant = "stat" | "bar-chart" | "horizontal-bars" | "list" | "ring" | "funnel" | "timeline";

interface WidgetSkeletonProps {
  variant: SkeletonVariant;
  className?: string;
}

const shimmerClass = "animate-pulse bg-[rgba(255,255,255,0.06)]";

export function WidgetSkeleton({ variant, className }: WidgetSkeletonProps) {
  return (
    <div className={cn("w-full h-full flex flex-col", className)}>
      {variant === "stat" && <StatSkeleton />}
      {variant === "bar-chart" && <BarChartSkeleton />}
      {variant === "horizontal-bars" && <HorizontalBarsSkeleton />}
      {variant === "list" && <ListSkeleton />}
      {variant === "ring" && <RingSkeleton />}
      {variant === "funnel" && <FunnelSkeleton />}
      {variant === "timeline" && <TimelineSkeleton />}
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className={cn(shimmerClass, "h-[10px] w-[60px] rounded-sm")} />
      <div className={cn(shimmerClass, "h-[28px] w-[100px] rounded-sm")} />
      <div className={cn(shimmerClass, "h-[10px] w-[80px] rounded-sm")} />
    </div>
  );
}

function BarChartSkeleton() {
  return (
    <div className="flex items-end gap-[6px] h-[80px] px-2 pt-6">
      {[40, 65, 55, 80, 45, 70, 30, 60, 50, 75, 35, 55].map((h, i) => (
        <div key={i} className={cn(shimmerClass, "flex-1 rounded-t-sm")} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function HorizontalBarsSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2 pt-6">
      {[85, 65, 45, 30, 20].map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={cn(shimmerClass, "h-[8px] rounded-full")} style={{ width: `${w}%` }} />
          <div className={cn(shimmerClass, "h-[10px] w-[40px] rounded-sm shrink-0")} />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-[6px] p-2 pt-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={cn(shimmerClass, "w-[24px] h-[24px] rounded-full shrink-0")} />
          <div className="flex-1 flex flex-col gap-1">
            <div className={cn(shimmerClass, "h-[12px] w-[70%] rounded-sm")} />
            <div className={cn(shimmerClass, "h-[10px] w-[40%] rounded-sm")} />
          </div>
          <div className={cn(shimmerClass, "h-[12px] w-[50px] rounded-sm shrink-0")} />
        </div>
      ))}
    </div>
  );
}

function RingSkeleton() {
  return (
    <div className="flex items-center justify-center p-4">
      <div className={cn(shimmerClass, "w-[60px] h-[60px] rounded-full border-[6px] border-[rgba(255,255,255,0.06)]")} style={{ background: "transparent" }} />
    </div>
  );
}

function FunnelSkeleton() {
  return (
    <div className="flex flex-col items-center gap-[3px] p-2 pt-6">
      {[100, 80, 60, 45].map((w, i) => (
        <div key={i} className={cn(shimmerClass, "h-[16px] rounded-sm")} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex gap-2 p-2 pt-6 h-full">
      <div className="flex flex-col gap-3 shrink-0">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={cn(shimmerClass, "h-[10px] w-[32px] rounded-sm")} />
        ))}
      </div>
      <div className={cn(shimmerClass, "w-[1px] shrink-0")} />
      <div className="flex-1 flex flex-col gap-2">
        {[60, 40, 30].map((h, i) => (
          <div key={i} className={cn(shimmerClass, "w-full rounded-sm")} style={{ height: `${h}px` }} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/widgets/shared/widget-skeleton.tsx
git commit -m "feat(dashboard): add WidgetSkeleton loading states for all chart types"
```

---

### Task 3: Shared Infrastructure — Sparkline + Hooks

**Files:**
- Create: `src/components/dashboard/widgets/shared/sparkline.tsx`
- Create: `src/components/dashboard/widgets/shared/use-animated-value.ts`
- Create: `src/components/dashboard/widgets/shared/use-widget-intersection.ts`

- [ ] **Step 1: Create sparkline component**

```typescript
"use client";

import { useMemo, useRef } from "react";
import { useWidgetIntersection } from "./use-widget-intersection";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({ data, width = 60, height = 24, color = "currentColor", className }: SparklineProps) {
  const ref = useRef<SVGSVGElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const pathD = useMemo(() => {
    if (data.length < 2) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    const usableW = width - padding * 2;
    const usableH = height - padding * 2;
    const stepX = usableW / (data.length - 1);

    return data
      .map((val, i) => {
        const x = padding + i * stepX;
        const y = padding + usableH - ((val - min) / range) * usableH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [data, width, height]);

  const totalLength = useMemo(() => {
    // Approximate path length for animation
    if (data.length < 2) return 0;
    return data.length * 10;
  }, [data]);

  if (data.length < 2) return null;

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Sparkline trend"
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: totalLength,
          strokeDashoffset: isVisible ? 0 : totalLength,
          transition: "stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
    </svg>
  );
}
```

- [ ] **Step 2: Extract useAnimatedValue from stat-card.tsx**

Read `src/components/dashboard/widgets/stat-card.tsx` lines 13-35 and copy the hook to a shared file:

```typescript
"use client";

import { useState, useEffect } from "react";

export function useAnimatedValue(target: number, duration = 1200) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let start: number | null = null;
    let raf: number;

    const step = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
```

- [ ] **Step 3: Create useWidgetIntersection hook**

```typescript
"use client";

import { useState, useEffect, type RefObject } from "react";

export function useWidgetIntersection(
  ref: RefObject<Element | null>,
  threshold = 0.1
): boolean {
  const [hasIntersected, setHasIntersected] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || hasIntersected) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setHasIntersected(true);
            observer.disconnect();
          }
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold, hasIntersected]);

  return hasIntersected;
}
```

- [ ] **Step 4: Create barrel export for shared components**

Create `src/components/dashboard/widgets/shared/index.ts`:

```typescript
export { WidgetTooltip, TooltipRow } from "./widget-tooltip";
export { WidgetSkeleton } from "./widget-skeleton";
export { Sparkline } from "./sparkline";
export { useAnimatedValue } from "./use-animated-value";
export { useWidgetIntersection } from "./use-widget-intersection";
```

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/widgets/shared/
git commit -m "feat(dashboard): add sparkline, useAnimatedValue, useWidgetIntersection shared utils"
```

---

### Task 4: Type System — New Widget Registry

**Files:**
- Modify: `src/lib/types/dashboard-widgets.ts`

This is the largest single task. It rewrites the type IDs, categories, and entire registry.

- [ ] **Step 1: Read the current file fully**

Read `src/lib/types/dashboard-widgets.ts` in its entirety to understand every registry entry.

- [ ] **Step 2: Update WidgetCategory type (line 11)**

Replace the existing `WidgetCategory` type:

```typescript
export type WidgetCategory =
  | "layout"
  | "money"
  | "pipeline"
  | "operations"
  | "clients"
  | "alerts";
```

- [ ] **Step 3: Update WidgetTag type (line 23)**

Keep existing tags — they're still used by the setup questionnaire:

```typescript
export type WidgetTag =
  | "essential"
  | "scheduling"
  | "finance"
  | "field-ops"
  | "office"
  | "pipeline"
  | "clients"
  | "estimates";
```

- [ ] **Step 4: Replace WidgetTypeId union (lines 37-107)**

```typescript
export type WidgetTypeId =
  // Layout
  | "spacer"
  // Money (7)
  | "revenue-pulse"
  | "receivables-aging"
  | "profit-gauge"
  | "expense-tracker"
  | "cash-position"
  | "invoice-list"
  | "payments-recent"
  // Pipeline (5)
  | "pipeline-funnel"
  | "win-rate"
  | "backlog-depth"
  | "booking-rate"
  | "estimates-overview"
  // Operations (6)
  | "task-pulse"
  | "todays-schedule"
  | "task-list"
  | "crew-board"
  | "crew-locations"
  | "site-visits"
  // Clients (3)
  | "top-clients"
  | "client-attention"
  | "client-list"
  // Alerts & Activity (3)
  | "action-required"
  | "activity-feed"
  | "notifications"
  // Pipeline Detail (2)
  | "pipeline-list"
  | "lead-sources";
```

- [ ] **Step 5: Update CATEGORY_LABELS and CATEGORY_ORDER**

```typescript
export const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  layout: "Layout",
  money: "Money",
  pipeline: "Pipeline",
  operations: "Operations",
  clients: "Clients",
  alerts: "Alerts & Activity",
};

export const CATEGORY_ORDER: WidgetCategory[] = [
  "layout",
  "money",
  "pipeline",
  "operations",
  "clients",
  "alerts",
];
```

- [ ] **Step 6: Replace WIDGET_TYPE_REGISTRY with all 27 entries**

Replace the entire `WIDGET_TYPE_REGISTRY` object. Every entry must include label, description, category, tags, icon, supportedSizes, defaultSize, configSchema, allowMultiple, and requiredPermission. Copy exact entries from the spec document `docs/superpowers/specs/2026-03-26-dashboard-widgets-redesign.md` — each widget's registry entry is fully defined there. The implementation agent should read the spec and create each entry matching the sizes, configs, permissions, and categories specified.

Key entries that differ significantly from existing:

```typescript
"revenue-pulse": {
  label: "Revenue",
  description: "Monthly revenue collected with trend",
  category: "money",
  tags: ["essential", "finance"],
  icon: "DollarSign",
  supportedSizes: ["xs", "sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [{
    key: "period",
    label: "Period",
    type: "select",
    options: [
      { value: "6mo", label: "6 Months" },
      { value: "12mo", label: "12 Months" },
      { value: "ytd", label: "Year to Date" },
    ],
    defaultValue: "ytd",
  }],
  allowMultiple: false,
  requiredPermission: "invoices.view",
},

"task-pulse": {
  label: "Tasks",
  description: "Task status overview with urgency",
  category: "operations",
  tags: ["essential", "scheduling"],
  icon: "CheckSquare",
  supportedSizes: ["xs", "sm", "md"],
  defaultSize: "sm",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "tasks.view",
},

"action-required": {
  label: "Action Required",
  description: "Unified priority alerts",
  category: "alerts",
  tags: ["essential"],
  icon: "AlertCircle",
  supportedSizes: ["sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "tasks.view",
},

"profit-gauge": {
  label: "Profit",
  description: "Gross margin — revenue vs expenses",
  category: "money",
  tags: ["finance"],
  icon: "TrendingUp",
  supportedSizes: ["xs", "sm", "md"],
  defaultSize: "sm",
  configSchema: [{
    key: "period",
    label: "Period",
    type: "select",
    options: [
      { value: "mtd", label: "Month to Date" },
      { value: "qtd", label: "Quarter to Date" },
      { value: "ytd", label: "Year to Date" },
    ],
    defaultValue: "mtd",
  }],
  allowMultiple: false,
  requiredPermission: "invoices.view",
},

"pipeline-funnel": {
  label: "Pipeline",
  description: "Project pipeline by stage",
  category: "pipeline",
  tags: ["essential", "pipeline"],
  icon: "Filter",
  supportedSizes: ["sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "projects.view",
},

"win-rate": {
  label: "Win Rate",
  description: "Estimate conversion rate",
  category: "pipeline",
  tags: ["pipeline", "estimates"],
  icon: "Target",
  supportedSizes: ["xs", "sm"],
  defaultSize: "sm",
  configSchema: [{
    key: "period",
    label: "Period",
    type: "select",
    options: [
      { value: "90d", label: "Last 90 Days" },
      { value: "ytd", label: "Year to Date" },
      { value: "all", label: "All Time" },
    ],
    defaultValue: "90d",
  }],
  allowMultiple: false,
  requiredPermission: "estimates.view",
},

"backlog-depth": {
  label: "Backlog",
  description: "Weeks of signed work ahead",
  category: "pipeline",
  tags: ["essential", "pipeline"],
  icon: "Layers",
  supportedSizes: ["xs", "sm", "md"],
  defaultSize: "sm",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "projects.view",
},

"booking-rate": {
  label: "Bookings",
  description: "New projects per month",
  category: "pipeline",
  tags: ["pipeline"],
  icon: "CalendarPlus",
  supportedSizes: ["xs", "sm"],
  defaultSize: "sm",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "projects.view",
},

"cash-position": {
  label: "Cash Flow",
  description: "Net cash flow — collected vs spent",
  category: "money",
  tags: ["finance"],
  icon: "ArrowUpDown",
  supportedSizes: ["sm", "md"],
  defaultSize: "sm",
  configSchema: [{
    key: "period",
    label: "Period",
    type: "select",
    options: [
      { value: "this-month", label: "This Month" },
      { value: "last-month", label: "Last Month" },
    ],
    defaultValue: "this-month",
  }],
  allowMultiple: false,
  requiredPermission: "invoices.view",
},

"top-clients": {
  label: "Top Clients",
  description: "Clients ranked by revenue",
  category: "clients",
  tags: ["clients"],
  icon: "Award",
  supportedSizes: ["sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [
    {
      key: "metric",
      label: "Rank By",
      type: "select",
      options: [
        { value: "revenue", label: "Revenue" },
        { value: "outstanding", label: "Outstanding" },
        { value: "projects", label: "Project Count" },
      ],
      defaultValue: "revenue",
    },
    {
      key: "period",
      label: "Period",
      type: "select",
      options: [
        { value: "ytd", label: "Year to Date" },
        { value: "all", label: "All Time" },
      ],
      defaultValue: "ytd",
    },
  ],
  allowMultiple: false,
  requiredPermission: "clients.view",
},

"todays-schedule": {
  label: "Schedule",
  description: "Today's timeline",
  category: "operations",
  tags: ["essential", "scheduling"],
  icon: "Calendar",
  supportedSizes: ["sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [{
    key: "scope",
    label: "Scope",
    type: "select",
    options: [
      { value: "personal", label: "My Schedule" },
      { value: "team", label: "Team Schedule" },
    ],
    defaultValue: "team",
  }],
  allowMultiple: false,
  requiredPermission: "calendar.view",
},

"crew-board": {
  label: "Crew",
  description: "Team status and workload",
  category: "operations",
  tags: ["essential", "field-ops"],
  icon: "Users",
  supportedSizes: ["sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "team.view",
},

"expense-tracker": {
  label: "Expenses",
  description: "Expense breakdown by category",
  category: "money",
  tags: ["finance"],
  icon: "Receipt",
  supportedSizes: ["sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [{
    key: "period",
    label: "Period",
    type: "select",
    options: [
      { value: "this-month", label: "This Month" },
      { value: "last-month", label: "Last Month" },
      { value: "ytd", label: "Year to Date" },
    ],
    defaultValue: "this-month",
  }],
  allowMultiple: false,
  requiredPermission: "expenses.view",
},

"receivables-aging": {
  label: "Receivables",
  description: "Outstanding invoices by aging bucket",
  category: "money",
  tags: ["essential", "finance"],
  icon: "Clock",
  supportedSizes: ["sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "invoices.view",
},

"lead-sources": {
  label: "Lead Sources",
  description: "Lead source distribution",
  category: "pipeline",
  tags: ["pipeline"],
  icon: "Radio",
  supportedSizes: ["md"],
  defaultSize: "md",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "pipeline.view",
},
```

For KEPT widgets (spacer, invoice-list, payments-recent, estimates-overview, task-list, crew-locations, site-visits, client-attention, client-list, activity-feed, notifications, pipeline-list), copy their existing registry entries but update the `category` field to match the new categories:
- `invoice-list`: category → `"money"`
- `payments-recent`: category → `"money"`
- `estimates-overview`: category → `"pipeline"`
- `task-list`: category → `"operations"`
- `crew-locations`: category → `"operations"`
- `site-visits`: category → `"operations"`
- `client-attention`: category → `"clients"`
- `client-list`: category → `"clients"`
- `activity-feed`: category → `"alerts"`
- `notifications`: category → `"alerts"`
- `pipeline-list`: category → `"pipeline"`

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd OPS-Web && npx tsc --noEmit src/lib/types/dashboard-widgets.ts 2>&1 | head -30`

Fix any type errors. The dashboard page and widget-tray will have errors (referencing removed type IDs) — that's expected and will be fixed in Phase 3.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types/dashboard-widgets.ts
git commit -m "feat(dashboard): replace widget type registry — 27 widget types, 6 categories"
```

---

### Task 5: Preferences Store Migration v11 → v12

**Files:**
- Modify: `src/stores/preferences-store.ts`

- [ ] **Step 1: Read the current file**

Read `src/stores/preferences-store.ts` in its entirety.

- [ ] **Step 2: Update DEFAULT_WIDGET_INSTANCES (line 44)**

Replace with the Owner default from the spec:

```typescript
const DEFAULT_WIDGET_INSTANCES: WidgetInstance[] = [
  createWidgetInstance("revenue-pulse", { period: "ytd" }, "sm"),
  createWidgetInstance("profit-gauge", { period: "mtd" }, "xs"),
  createWidgetInstance("win-rate", { period: "90d" }, "xs"),
  createWidgetInstance("backlog-depth", {}, "xs"),
  createWidgetInstance("pipeline-funnel", {}, "md"),
  createWidgetInstance("receivables-aging", {}, "md"),
  createWidgetInstance("task-pulse", {}, "sm"),
  createWidgetInstance("crew-board", {}, "md"),
  createWidgetInstance("action-required", {}, "md"),
  createWidgetInstance("activity-feed", { entityFilter: "all" }, "sm"),
];
```

- [ ] **Step 3: Bump version to 12 and add migration**

Change `version: 11` to `version: 12` in the persist config.

Add the v11→v12 migration block inside the `migrate` function (after the v10→v11 block). Use the exact migration code from the spec document section "Preferences Store Migration: v11 → v12" — it handles renaming, removal, and replacement injection.

- [ ] **Step 4: Verify compilation**

Run: `cd OPS-Web && npx tsc --noEmit src/stores/preferences-store.ts 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/stores/preferences-store.ts
git commit -m "feat(dashboard): preferences store v12 migration — widget consolidation"
```

---

## PHASE 2: Widget Components

Each task creates one widget component. The implementation agent should read the full widget specification from `docs/superpowers/specs/2026-03-26-dashboard-widgets-redesign.md` for exact size layouts, interactions, animation timing, color values, empty states, and data source details.

**Pattern for every widget:**
1. Read the spec entry for that widget
2. Create the component file following the pattern established by existing widgets (Card + CardHeader + CardContent, size-based rendering, i18n via `useDictionary("dashboard")`)
3. Use `WidgetSkeleton` for loading states instead of `<Loader2 className="animate-spin" />`
4. Use `WidgetTooltip` for hover interactions
5. Use `Sparkline` for inline trend visualizations
6. Use `useAnimatedValue` for count-up numbers
7. **NO** `overflow-y-auto` or `scrollbar-hide` — content is truncated to fit
8. All user-facing strings via `useDictionary("dashboard")`
9. Commit after each widget

### Task 6: Task Pulse Widget

**Files:**
- Create: `src/components/dashboard/widgets/task-pulse-widget.tsx`

- [ ] **Step 1: Read spec section for task-pulse**

Read `docs/superpowers/specs/2026-03-26-dashboard-widgets-redesign.md` — search for `#### 13. \`task-pulse\``

- [ ] **Step 2: Implement the component**

The component receives `size`, `tasks` (ProjectTask[]), `isLoading`, and `onNavigate`. It:
- Categorizes tasks into overdue, due-today, in-progress, upcoming
- At `xs`: shows overdue count (red) or total open (accent)
- At `sm`: shows segmented horizontal bar (20px tall, proportional) + count labels
- At `md`: adds top 4 actionable tasks below the bar as clickable rows

Segment colors: Overdue `#B58289`, Due today `#C4A868`, In progress `#6F94B0`, Upcoming `rgba(255,255,255,0.15)`.

Use `WidgetSkeleton variant="horizontal-bars"` for loading state.

Overdue segment pulses once on entry (opacity keyframe 1→0.7→1 over 600ms). Respect `prefers-reduced-motion`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/task-pulse-widget.tsx
git commit -m "feat(dashboard): add TaskPulse widget — task status overview with urgency segments"
```

---

### Task 7: Action Required Widget

**Files:**
- Create: `src/components/dashboard/widgets/action-required-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 22. \`action-required\``

- [ ] **Step 2: Implement**

Receives: `size`, `tasks` (overdue), `invoices` (past-due), `opportunities` (stale follow-ups), `estimates` (expiring), `isLoading`, `onNavigate`.

Merge all items into a single priority-ranked list (spec defines 6 priority tiers). Each item has: type icon, description (truncated), age label ("3d overdue"), amount if financial.

At `sm`: total count + category dots. At `md`: top 5 items. At `lg`: grouped by type with section headers.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/action-required-widget.tsx
git commit -m "feat(dashboard): add ActionRequired widget — unified priority alerts"
```

---

### Task 8: Pipeline Funnel Widget Redesign

**Files:**
- Modify: `src/components/dashboard/widgets/pipeline-funnel-widget.tsx` (overwrite)

- [ ] **Step 1: Read spec section** — search for `#### 8. \`pipeline-funnel\``

- [ ] **Step 2: Rewrite the component**

Replace the thin 8px stacked bar with stacked horizontal bars creating a funnel shape:
- RFQ: 100% max-width
- Estimated: 80% max-width
- Accepted: 60% max-width
- In Progress: 45% max-width

Each bar is 16px tall. Actual bar width within max-width is proportional to count. Bars slide in from left with 80ms stagger.

At `sm`: funnel only. At `md`: funnel + stage labels + counts + values. At `lg`: funnel + per-stage top 2 project names.

Add hover tooltips using `WidgetTooltip` showing: stage name, count, total value, avg days in stage, % of pipeline.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/pipeline-funnel-widget.tsx
git commit -m "feat(dashboard): redesign PipelineFunnel — real funnel shape with hover tooltips"
```

---

### Task 9: Top Clients Widget

**Files:**
- Create: `src/components/dashboard/widgets/top-clients-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 19. \`top-clients\``

- [ ] **Step 2: Implement**

Receives: `size`, `config` (metric + period), `clients`, `invoices`, `isLoading`, `onNavigate`.

Aggregates the chosen metric per client, sorts descending. Renders proportional horizontal bars behind client names.

At `sm`: top 3. At `md`: top 5 with last-activity dot. At `lg`: top 8 with secondary detail line.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/top-clients-widget.tsx
git commit -m "feat(dashboard): add TopClients widget — ranked client revenue with activity indicators"
```

---

### Task 10: Profit Gauge Widget

**Files:**
- Create: `src/components/dashboard/widgets/profit-gauge-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 3. \`profit-gauge\``

- [ ] **Step 2: Implement**

Receives: `size`, `config` (period), `invoices`, `expenses`, `isLoading`.

Computes gross margin from paid invoices (revenue) vs approved expenses (costs) in the configured period.

At `xs`: SVG ring (60px, 6px stroke) filled to margin%, center number color-coded by zone (green >50%, amber 40-50%, red <40%).
At `sm`: ring + revenue/expenses/profit numbers.
At `md`: horizontal waterfall chart.

Ring fill animation: 800ms, spring (stiffness: 60, damping: 15). Numbers count up: 1000ms.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/profit-gauge-widget.tsx
git commit -m "feat(dashboard): add ProfitGauge widget — gross margin ring and waterfall chart"
```

---

### Task 11: Expense Tracker Widget

**Files:**
- Create: `src/components/dashboard/widgets/expense-tracker-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 4. \`expense-tracker\``

- [ ] **Step 2: Implement**

Receives: `size`, `config` (period), `isLoading`. Fetches expense data from the **actual expenses table** using `useExpenseBatches()` or a new hook that queries approved expenses grouped by category.

At `sm`: total + top category. At `md`: horizontal bars per category (top 5). At `lg`: bars + per-category sparklines.

**Critical**: This replaces the broken placeholder. Must query real expense data, not show "Connect accounting."

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/expense-tracker-widget.tsx
git commit -m "feat(dashboard): add ExpenseTracker widget — real expense data by category"
```

---

### Task 12: Revenue Pulse Widget

**Files:**
- Create: `src/components/dashboard/widgets/revenue-pulse-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 1. \`revenue-pulse\``

- [ ] **Step 2: Implement**

Based on the existing `revenue-chart-widget.tsx` data logic but redesigned:
- `xs`: MTD number + trend arrow
- `sm`: MTD + sparkline + YTD
- `md`: monthly bar chart with hover tooltips
- `lg`: bars + YoY ghost overlay (same months last year at 20% opacity)

Bars use `#C4A868` amber. Bars rise with 80ms stagger, 600ms each. Hover shows month + amount + YoY delta via `WidgetTooltip`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/revenue-pulse-widget.tsx
git commit -m "feat(dashboard): add RevenuePulse widget — interactive bar chart with YoY overlay"
```

---

### Task 13: Receivables Aging Widget

**Files:**
- Create: `src/components/dashboard/widgets/receivables-aging-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 2. \`receivables-aging\``

- [ ] **Step 2: Implement**

Based on existing `invoice-aging-widget.tsx` data logic but redesigned:
- Stacked bar is now 20px tall (not 8px)
- `sm`: total outstanding + urgency dot
- `md`: bar + bucket list
- `lg`: bar + buckets + top 3 overdue invoices

Color escalation: accent→amber→orange→muted red→full red. Hover bar segment → tooltip with bucket detail.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/receivables-aging-widget.tsx
git commit -m "feat(dashboard): add ReceivablesAging widget — proportional aging bar with hover detail"
```

---

### Task 14: Cash Position Widget

**Files:**
- Create: `src/components/dashboard/widgets/cash-position-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 5. \`cash-position\``

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/cash-position-widget.tsx
git commit -m "feat(dashboard): add CashPosition widget — net cash flow visualization"
```

---

### Task 15: Win Rate Widget

**Files:**
- Create: `src/components/dashboard/widgets/win-rate-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 9. \`win-rate\``

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/win-rate-widget.tsx
git commit -m "feat(dashboard): add WinRate widget — estimate conversion rate with mini funnel"
```

---

### Task 16: Backlog Depth Widget

**Files:**
- Create: `src/components/dashboard/widgets/backlog-depth-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 10. \`backlog-depth\``

- [ ] **Step 2: Implement**

The backlog estimation logic is defined in the spec. Compute weeks from accepted projects' task date spans, or fall back to avg project duration × count / 5.

Color zones: green 3-6wk, amber 1-2 or 7-8, red <1 or >8.

`xs`: weeks number. `sm`: bullet gauge with zone bands. `md`: gauge + sparkline.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/backlog-depth-widget.tsx
git commit -m "feat(dashboard): add BacklogDepth widget — work queue health gauge"
```

---

### Task 17: Booking Rate Widget

**Files:**
- Create: `src/components/dashboard/widgets/booking-rate-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 11. \`booking-rate\``

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/booking-rate-widget.tsx
git commit -m "feat(dashboard): add BookingRate widget — monthly project bookings trend"
```

---

### Task 18: Crew Board Widget

**Files:**
- Create: `src/components/dashboard/widgets/crew-board-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 16. \`crew-board\``

- [ ] **Step 2: Implement**

Redesign of crew-status-widget.tsx with utilization bars. Receives `teamMembers`, `tasks` (for assigned count per member).

`sm`: avg utilization + avatar row. `md`: per-member utilization bars (max 4). `lg`: bars + current task + location (max 7).

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/crew-board-widget.tsx
git commit -m "feat(dashboard): add CrewBoard widget — team utilization bars with workload visualization"
```

---

### Task 19: Today's Schedule Widget

**Files:**
- Create: `src/components/dashboard/widgets/todays-schedule-widget.tsx`

- [ ] **Step 1: Read spec section** — search for `#### 14. \`todays-schedule\``

- [ ] **Step 2: Implement**

`sm`: next event preview + count. `md`: vertical timeline strip (time axis, colored blocks). `lg`: today + tomorrow two-column.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/todays-schedule-widget.tsx
git commit -m "feat(dashboard): add TodaysSchedule widget — vertical timeline strip with event blocks"
```

---

### Task 20: Lead Sources Widget (Rename + Enhance)

**Files:**
- Create: `src/components/dashboard/widgets/lead-sources-widget.tsx`

- [ ] **Step 1: Read existing `pipeline-sources-widget.tsx`**

- [ ] **Step 2: Copy and enhance**

Copy existing component, rename export to `LeadSourcesWidget`, add `WidgetTooltip` on bar hover showing count, %, and total pipeline value from that source.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/lead-sources-widget.tsx
git commit -m "feat(dashboard): rename PipelineSources to LeadSources with hover tooltips"
```

---

## PHASE 3: Integration

### Task 21: Polish Existing Kept Widgets

**Files:**
- Modify: `src/components/dashboard/widgets/invoice-list-widget.tsx`
- Modify: `src/components/dashboard/widgets/payments-recent-widget.tsx`
- Modify: `src/components/dashboard/widgets/estimates-overview-widget.tsx`
- Modify: `src/components/dashboard/widgets/task-list-widget.tsx`
- Modify: `src/components/dashboard/widgets/site-visits-widget.tsx`
- Modify: `src/components/dashboard/widgets/client-attention-widget.tsx`
- Modify: `src/components/dashboard/widgets/client-list-widget.tsx`
- Modify: `src/components/dashboard/widgets/activity-feed-widget.tsx`
- Modify: `src/components/dashboard/widgets/notifications-widget.tsx`
- Modify: `src/components/dashboard/widgets/pipeline-list-widget.tsx`

For EACH kept widget:

- [ ] **Step 1: Remove `overflow-y-auto scrollbar-hide`** from CardContent and any content wrappers. Replace with `overflow-hidden`.

- [ ] **Step 2: Enforce max-item limits** based on size. Add explicit `.slice(0, maxItems)` where items exceed the no-scroll budget (spec defines limits per widget per size).

- [ ] **Step 3: Replace `<Loader2 className="animate-spin" />` with `<WidgetSkeleton variant="list" />`** (or appropriate variant).

- [ ] **Step 4: Add "+N more" link** at bottom when items are truncated, linking to the relevant detail page.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/widgets/invoice-list-widget.tsx src/components/dashboard/widgets/payments-recent-widget.tsx src/components/dashboard/widgets/estimates-overview-widget.tsx src/components/dashboard/widgets/task-list-widget.tsx src/components/dashboard/widgets/site-visits-widget.tsx src/components/dashboard/widgets/client-attention-widget.tsx src/components/dashboard/widgets/client-list-widget.tsx src/components/dashboard/widgets/activity-feed-widget.tsx src/components/dashboard/widgets/notifications-widget.tsx src/components/dashboard/widgets/pipeline-list-widget.tsx
git commit -m "fix(dashboard): remove scrolling from kept widgets, add skeleton loading, enforce item limits"
```

---

### Task 22: Update Dashboard Page

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

This is the critical integration task. The implementation agent MUST read the current file in full before making changes.

- [ ] **Step 1: Read the current dashboard page**

Read the entire file — particularly the imports (lines 62-95), data fetching hooks (lines ~120-180), the permission gate arrays (lines 505-523), and the `renderWidgetContent` function (lines 501-705).

- [ ] **Step 2: Replace widget imports**

Remove all imports for deleted widget components. Add imports for all new widget components:

```typescript
// New/redesigned widgets
import { RevenuePulseWidget } from "@/components/dashboard/widgets/revenue-pulse-widget";
import { ReceivablesAgingWidget } from "@/components/dashboard/widgets/receivables-aging-widget";
import { ProfitGaugeWidget } from "@/components/dashboard/widgets/profit-gauge-widget";
import { ExpenseTrackerWidget } from "@/components/dashboard/widgets/expense-tracker-widget";
import { CashPositionWidget } from "@/components/dashboard/widgets/cash-position-widget";
import { PipelineFunnelWidget } from "@/components/dashboard/widgets/pipeline-funnel-widget";
import { WinRateWidget } from "@/components/dashboard/widgets/win-rate-widget";
import { BacklogDepthWidget } from "@/components/dashboard/widgets/backlog-depth-widget";
import { BookingRateWidget } from "@/components/dashboard/widgets/booking-rate-widget";
import { TaskPulseWidget } from "@/components/dashboard/widgets/task-pulse-widget";
import { TodaysScheduleWidget } from "@/components/dashboard/widgets/todays-schedule-widget";
import { CrewBoardWidget } from "@/components/dashboard/widgets/crew-board-widget";
import { TopClientsWidget } from "@/components/dashboard/widgets/top-clients-widget";
import { ActionRequiredWidget } from "@/components/dashboard/widgets/action-required-widget";
import { LeadSourcesWidget } from "@/components/dashboard/widgets/lead-sources-widget";

// Kept widgets (keep existing imports)
import { TaskListWidget } from "@/components/dashboard/widgets/task-list-widget";
import { InvoiceListWidget } from "@/components/dashboard/widgets/invoice-list-widget";
// ... etc for all kept widgets
```

- [ ] **Step 3: Add expense data hook**

Add `useExpenseBatches` or appropriate expense hook to the data fetching section. The profit-gauge and expense-tracker widgets need expense data.

- [ ] **Step 4: Update permission gate arrays**

Replace FINANCIAL_WIDGETS, PIPELINE_WIDGETS, CLIENT_WIDGETS with new widget type IDs:

```typescript
const FINANCIAL_WIDGETS: string[] = [
  "revenue-pulse", "receivables-aging", "profit-gauge", "expense-tracker",
  "cash-position", "invoice-list", "payments-recent",
];
const PIPELINE_WIDGETS: string[] = [
  "pipeline-funnel", "win-rate", "backlog-depth", "booking-rate",
  "estimates-overview", "pipeline-list", "lead-sources",
];
const CLIENT_WIDGETS: string[] = [
  "top-clients", "client-attention", "client-list",
];
```

- [ ] **Step 5: Rewrite renderWidgetContent switch**

Replace the entire switch statement with cases for the 27 new widget type IDs. Each case renders the appropriate component with its required props. Example cases:

```typescript
case "revenue-pulse":
  return <RevenuePulseWidget size={size} config={config} />;

case "task-pulse":
  return <TaskPulseWidget size={size} tasks={tasks} isLoading={tasksLoading} onNavigate={navigate} />;

case "action-required":
  return <ActionRequiredWidget size={size} tasks={overdueTasks} invoices={pastDueInvoices} opportunities={staleFollowUps} estimates={expiringEstimates} isLoading={tasksLoading || invoicesLoading} onNavigate={navigate} />;

case "pipeline-funnel":
  return <PipelineFunnelWidget size={size} projects={projects} isLoading={projectsLoading} onNavigate={navigate} />;

case "profit-gauge":
  return <ProfitGaugeWidget size={size} config={config} invoices={invoices} expenses={expenses} isLoading={invoicesLoading || expensesLoading} />;

case "crew-board":
  return <CrewBoardWidget size={size} teamMembers={teamMembers} tasks={tasks} isLoading={teamLoading || tasksLoading} onNavigate={navigate} />;

// ... all 27 cases
```

- [ ] **Step 6: Verify compilation**

Run: `cd OPS-Web && npx tsc --noEmit 2>&1 | head -50`

Fix any type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/\\(dashboard\\)/dashboard/page.tsx
git commit -m "feat(dashboard): integrate all new widgets into dashboard page"
```

---

### Task 23: Update Widget Tray

**Files:**
- Modify: `src/components/dashboard/widget-tray.tsx`

- [ ] **Step 1: Read the current file**

- [ ] **Step 2: Update category references**

The tray uses `CATEGORY_ORDER` and `CATEGORY_LABELS` from `dashboard-widgets.ts` — these were already updated in Task 4. The tray should automatically pick up new categories.

Verify that the tray's category filtering, search, and widget grouping work correctly with the new categories by reading through the grouping logic.

If the tray hardcodes any old category names or widget type IDs, update them.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widget-tray.tsx
git commit -m "fix(dashboard): update widget tray for new categories"
```

---

### Task 24: Update Widget Defaults

**Files:**
- Modify: `src/lib/utils/widget-defaults.ts`

- [ ] **Step 1: Read the current file**

- [ ] **Step 2: Add role-based default function**

Add the four role-based default layouts from the spec (Owner, Admin, Operator, Crew) and a `getDefaultWidgetInstances(userRole: UserRole)` function that selects the right layout.

- [ ] **Step 3: Update the tag-based default function**

Update `getDefaultWidgetInstancesFromSetup()` to reference only the 27 new widget type IDs. Replace any references to removed widget IDs with their replacements (e.g., `"stat-projects-rfq"` → `"pipeline-funnel"`, `"overdue-tasks"` → `"action-required"`, etc.).

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils/widget-defaults.ts
git commit -m "feat(dashboard): role-based default layouts + updated tag-based defaults"
```

---

### Task 25: i18n — Dashboard Dictionary Updates

**Files:**
- Modify: `src/i18n/dictionaries/en/dashboard.json`
- Modify: `src/i18n/dictionaries/es/dashboard.json`

- [ ] **Step 1: Add keys for all new widgets**

Add i18n keys for every new widget's labels, tooltips, empty states, loading text, and section headers. Namespace by widget:

```json
{
  "taskPulse": {
    "overdue": "Overdue",
    "dueToday": "Due Today",
    "inProgress": "In Progress",
    "upcoming": "Upcoming",
    "allClear": "All clear",
    "openTasks": "Open Tasks"
  },
  "actionRequired": {
    "title": "Action Required",
    "allClear": "All clear — no items need attention",
    "overdueTask": "overdue",
    "pastDueInvoice": "past due",
    "expiringEstimate": "expires soon",
    "staleFollowUp": "follow-up overdue"
  },
  "revenuePulse": {
    "title": "Revenue",
    "mtdRevenue": "MTD Revenue",
    "ytdTotal": "YTD Total",
    "ytd": "YTD",
    "vsLastYear": "vs {{prevYear}}"
  },
  "profitGauge": {
    "title": "Profit",
    "margin": "Margin",
    "revenue": "Revenue",
    "expenses": "Expenses",
    "profit": "Profit",
    "noData": "No data for this period"
  },
  "expenseTracker": {
    "title": "Expenses",
    "noExpenses": "No expenses recorded",
    "categories": "Categories",
    "ofTotal": "of total"
  },
  "cashPosition": {
    "title": "Cash Flow",
    "netCashFlow": "Net Cash Flow",
    "collected": "Collected",
    "spent": "Spent",
    "noTransactions": "No transactions this period"
  },
  "winRate": {
    "title": "Win Rate",
    "sent": "Sent",
    "won": "Won",
    "lost": "Lost",
    "noEstimates": "No estimates in period"
  },
  "backlogDepth": {
    "title": "Backlog",
    "weeks": "wk",
    "projects": "projects",
    "noPending": "No signed projects pending",
    "healthy": "Healthy",
    "caution": "Caution",
    "risk": "Risk"
  },
  "bookingRate": {
    "title": "Bookings",
    "thisMonth": "This month",
    "vsLastMonth": "vs last month",
    "noProjects": "No projects yet"
  },
  "todaysSchedule": {
    "title": "Schedule",
    "noEvents": "No events today",
    "moreToday": "more today",
    "tomorrow": "Tomorrow"
  },
  "crewBoard": {
    "title": "Crew",
    "utilization": "Utilization",
    "tasks": "tasks",
    "noMembers": "No team members"
  },
  "topClients": {
    "title": "Top Clients",
    "noData": "No client data yet",
    "projects": "projects",
    "lastActive": "Last active"
  },
  "leadSources": {
    "title": "Lead Sources",
    "ofTotal": "of total"
  }
}
```

- [ ] **Step 2: Add Spanish translations**

Add equivalent keys to `es/dashboard.json`. Use professional Spanish translations.

- [ ] **Step 3: Remove i18n keys for deleted widgets**

Remove keys for: `stats.*` (per-status labels), old `revenue.*` keys, old `pipelineFunnel.*` keys, etc. Only remove keys that are no longer referenced by any widget.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/dictionaries/en/dashboard.json src/i18n/dictionaries/es/dashboard.json
git commit -m "feat(i18n): add dashboard dictionary keys for all new widgets"
```

---

### Task 26: Delete Removed Widget Files

**Files:**
- Delete: all files listed in "Files to Delete" section above

- [ ] **Step 1: Verify no imports reference deleted files**

Run: `cd OPS-Web && grep -r "stat-widget\|stat-card\|ranking-widget\|project-status-chart\|task-status-chart\|overdue-tasks-widget\|past-due-invoices-widget\|follow-ups-due-widget\|client-revenue-widget\|client-activity-widget\|estimates-funnel-widget\|pipeline-value-widget\|pipeline-velocity-widget\|action-bar-widget\|revenue-chart-widget\|invoice-aging-widget\|expense-summary-widget\|calendar-widget\|crew-status-widget\|pipeline-sources-widget" src/ --include="*.ts" --include="*.tsx" -l`

If any files still import these, fix the imports first.

- [ ] **Step 2: Delete the files**

```bash
cd OPS-Web
rm src/components/dashboard/widgets/stat-card.tsx
rm src/components/dashboard/widgets/stat-widget.tsx
rm src/components/dashboard/widgets/ranking-widget.tsx
rm src/components/dashboard/widgets/project-status-chart-widget.tsx
rm src/components/dashboard/widgets/task-status-chart-widget.tsx
rm src/components/dashboard/widgets/overdue-tasks-widget.tsx
rm src/components/dashboard/widgets/past-due-invoices-widget.tsx
rm src/components/dashboard/widgets/follow-ups-due-widget.tsx
rm src/components/dashboard/widgets/client-revenue-widget.tsx
rm src/components/dashboard/widgets/client-activity-widget.tsx
rm src/components/dashboard/widgets/estimates-funnel-widget.tsx
rm src/components/dashboard/widgets/pipeline-value-widget.tsx
rm src/components/dashboard/widgets/pipeline-velocity-widget.tsx
rm src/components/dashboard/widgets/action-bar-widget.tsx
rm src/components/dashboard/widgets/revenue-chart-widget.tsx
rm src/components/dashboard/widgets/invoice-aging-widget.tsx
rm src/components/dashboard/widgets/expense-summary-widget.tsx
rm src/components/dashboard/widgets/calendar-widget.tsx
rm src/components/dashboard/widgets/crew-status-widget.tsx
rm src/components/dashboard/widgets/pipeline-sources-widget.tsx
```

- [ ] **Step 3: Verify compilation**

Run: `cd OPS-Web && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add -A src/components/dashboard/widgets/
git commit -m "chore(dashboard): delete 20 removed widget component files"
```

---

### Task 27: Dashboard Entry Stagger Choreography

**Files:**
- Modify: `src/components/dashboard/widget-grid.tsx`

- [ ] **Step 1: Read the current widget-grid.tsx**

- [ ] **Step 2: Add stagger animation to widget entry**

Wrap each widget in a container that applies stagger-delayed entry animation. Widgets appear in order of their position in the grid (top-left first, bottom-right last).

```typescript
// Per-widget entry style
const getEntryStyle = (index: number, isVisible: boolean, reducedMotion: boolean): React.CSSProperties => ({
  opacity: isVisible ? 1 : 0,
  transform: isVisible ? "translateY(0)" : "translateY(12px)",
  transition: reducedMotion
    ? "opacity 200ms ease"
    : `opacity 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 60}ms, transform 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 60}ms`,
});
```

Use a `useState(false)` → `useEffect(() => setHasEntered(true), [])` pattern to trigger entry on mount.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widget-grid.tsx
git commit -m "feat(dashboard): add staggered entry animation to widget grid"
```

---

## Verification

### Final Checklist

After all tasks complete:

- [ ] Run `cd OPS-Web && npx tsc --noEmit` — zero errors
- [ ] Run `cd OPS-Web && npm run dev` — dashboard loads without crashes
- [ ] Verify: Owner default layout shows 10 widgets in correct order
- [ ] Verify: Customize mode → tray shows 6 categories with correct widgets
- [ ] Verify: Adding/removing/resizing widgets works
- [ ] Verify: No widget requires scrolling at any supported size
- [ ] Verify: Hover tooltips appear on chart widgets
- [ ] Verify: Skeleton loading shows when data is loading
- [ ] Verify: Empty states show when no data exists
- [ ] Verify: Stagger animation plays on dashboard entry
- [ ] Verify: `prefers-reduced-motion` disables transform animations
- [ ] Verify: Migration from v11 layout preserves user customizations where possible
