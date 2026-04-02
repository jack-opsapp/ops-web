# Pipeline & Sales Widgets Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign 5 pipeline/sales dashboard widgets with data-accurate visualizations, shared component migration, inline actions, and standardized animations.

**Architecture:** Each widget is a self-contained file under `src/components/dashboard/widgets/`. Shared primitives (`WidgetLineItem`, `WidgetBackgroundChart`, `WidgetPeriodPicker`, etc.) imported from `shared/`. No modifications to shared components, `widget-tokens.ts`, or `dashboard/page.tsx`. i18n keys added to `en/dashboard.json`.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, TanStack Query, Framer Motion (via shared components), Lucide React icons, Sonner toasts.

**Spec:** `docs/superpowers/specs/2026-04-02-pipeline-sales-widgets-redesign.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/dashboard/widgets/booking-rate-widget.tsx` | Modify | SM: background chart. MD: bar tooltips. Easing fix. |
| `src/components/dashboard/widgets/win-rate-widget.tsx` | Modify | SM: background sparkline. MD: period picker, trend line, remove duplicate. Easing fix. |
| `src/components/dashboard/widgets/lead-sources-widget.tsx` | Modify | SM: background donut. LG: trendlines. Easing fix. |
| `src/components/dashboard/widgets/pipeline-funnel-widget.tsx` | Modify | Bug fix: data-proportional bars. MD: vertical funnel. LG: tabbed detail. Easing fix. |
| `src/components/dashboard/widgets/pipeline-list-widget.tsx` | Modify | Distribution bar. WidgetLineItem migration. Inline Advance + Follow Up actions. |
| `src/i18n/dictionaries/en/dashboard.json` | Modify | New i18n keys for all 5 widgets. |

---

## Task 1: Booking Rate Widget — SM Background Chart + MD Tooltips + i18n + Easing

**Files:**
- Modify: `src/components/dashboard/widgets/booking-rate-widget.tsx`
- Modify: `src/i18n/dictionaries/en/dashboard.json`

**Why this first:** Smallest scope, establishes the easing-fix and WidgetBackgroundChart patterns reused by later tasks.

- [ ] **Step 1: Add i18n keys for booking rate**

Open `src/i18n/dictionaries/en/dashboard.json`. The bookingRate keys already exist at lines 693-697. No new keys needed — they're already there. Verify they match what the widget uses: `bookingRate.title`, `bookingRate.thisMonth`, `bookingRate.noProjects`, `bookingRate.viewProjects`. Confirmed.

- [ ] **Step 2: Add imports and tooltip state to booking-rate-widget.tsx**

Replace the imports section (lines 1-17) with:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronUp, ChevronDown, ChevronRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
import type { Project } from "@/lib/types/models";
import { ProjectStatus } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
```

- [ ] **Step 3: Rewrite SM size block to use WidgetBackgroundChart**

Replace the SM block (the `if (size === "sm")` block, currently lines 149-188) with:

```tsx
  // ── SM: Hero + background sparkline + trend ────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={<Sparkline data={sparkData} width={200} height={100} color={WT.accent} />}
          opacity={0.25}
        >
          <div className="h-full flex flex-col p-3">
            {/* Row 1: Hero number + tiny nav icon */}
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
                {animatedCount}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/projects"); }}
                className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
              </button>
            </div>
            {/* Row 2: Title */}
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("bookingRate.title") ?? "Bookings"}
            </span>
            {/* Row 3: Trend indicator */}
            <div className="flex items-center gap-0.5 mt-1">
              {bookings.trend === "up" ? (
                <ChevronUp className="w-3 h-3" style={{ color: WT.success }} />
              ) : bookings.trend === "down" ? (
                <ChevronDown className="w-3 h-3" style={{ color: WT.error }} />
              ) : (
                <ChevronRight className="w-3 h-3 text-text-disabled" />
              )}
              <span className="font-mono text-micro-sm" style={{ color: trendColor }}>
                {bookings.delta !== 0 && `${Math.abs(bookings.delta)}%`}
              </span>
            </div>
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }
```

- [ ] **Step 4: Add tooltip state to component body**

After the existing `const sparkData = bookings.months.map((m) => m.count);` line, add:

```tsx
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    month: string;
    count: number;
  }>({ visible: false, x: 0, y: 0, month: "", count: 0 });
```

- [ ] **Step 5: Add tooltip + hover handlers to MD bar chart**

In the MD return block, wrap the bar chart `<div className="flex items-end gap-[4px]" ...>` section inside a `<div className="relative">` and add the `WidgetTooltip` above it. Replace the entire `{showDetail(size) && (` block with:

```tsx
        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade className="relative">
            <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={tooltip.month} value={`${tooltip.count}`} />
            </WidgetTooltip>

            {/* Bar chart */}
            <div className="flex items-end gap-[4px]" style={{ height: `${chartHeight}px` }}>
              {bookings.months.map((m, i) => {
                const barH = (m.count / bookings.maxCount) * chartHeight;
                const isCurrent = i === bookings.months.length - 1;

                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center justify-end"
                    style={{ height: `${chartHeight}px` }}
                    onMouseEnter={(e) => {
                      const parentRect = ref.current?.getBoundingClientRect();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      if (!parentRect) return;
                      setTooltip({
                        visible: true,
                        x: rect.left - parentRect.left + rect.width / 2,
                        y: rect.top - parentRect.top,
                        month: m.label,
                        count: m.count,
                      });
                    }}
                    onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                  >
                    <div
                      className="w-[70%] rounded-t-sm"
                      style={{
                        height: isVisible ? `${Math.max(barH, m.count > 0 ? 2 : 0)}px` : "0px",
                        backgroundColor: WT.accent,
                        opacity: isCurrent ? 1 : 0.5,
                        transitionProperty: "height, opacity",
                        transitionDuration: reducedMotion ? "200ms" : "600ms",
                        transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                        transitionTimingFunction: WIDGET_EASE_CSS,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            {/* Month labels */}
            <div className="flex gap-[4px] mt-1">
              {bookings.months.map((m, i) => (
                <span key={i} className="flex-1 text-center font-kosugi text-micro-sm text-text-disabled uppercase">
                  {m.label}
                </span>
              ))}
            </div>
          </ScrollFade>
        )}
```

- [ ] **Step 6: Fix all easing references in the file**

Search for any remaining `cubic-bezier(0.16, 1, 0.3, 1)` in the file and replace with `WIDGET_EASE_CSS`. The XS block has no easing. The SM block was just rewritten. The MD block was just rewritten. Check the empty state and loading blocks — they have no easing. Done.

- [ ] **Step 7: Verify build**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx next build --no-lint 2>&1 | tail -20`

Check for TypeScript errors in `booking-rate-widget.tsx`. If errors, fix them.

- [ ] **Step 8: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add src/components/dashboard/widgets/booking-rate-widget.tsx
git commit -m "feat(widget): booking rate — background chart SM, bar tooltips MD, easing fix"
```

---

## Task 2: Win Rate Widget — SM Sparkline + MD Period Picker & Trend + Easing

**Files:**
- Modify: `src/components/dashboard/widgets/win-rate-widget.tsx`
- Modify: `src/i18n/dictionaries/en/dashboard.json`

- [ ] **Step 1: Add new i18n keys**

In `src/i18n/dictionaries/en/dashboard.json`, after the existing `"winRate.avgDealSize": "Avg Deal Size"` line (line 679), add:

```json
  "winRate.period90d": "90D",
  "winRate.periodYtd": "YTD",
  "winRate.periodAll": "ALL",
```

- [ ] **Step 2: Update imports**

Replace the imports section (lines 1-14) with:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { WidgetPeriodPicker } from "./shared/widget-period-picker";
import { Sparkline } from "./shared/sparkline";
import { useAnimatedValue } from "./shared/use-animated-value";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showFooter } from "@/lib/widget-tokens";
import { formatCompactCurrency } from "./shared/widget-utils";
import type { Estimate } from "@/lib/types/pipeline";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
```

- [ ] **Step 3: Remove local formatCurrency, add period state and trend data**

Delete the local `formatCurrency` function (lines 38-42 in original). 

In the component body, after the existing `const period = ...` line, add local state for period control:

```tsx
  const [activePeriod, setActivePeriod] = useState(period);
  const periodStart = getPeriodStart(activePeriod);
```

And update `stats` useMemo to use `activePeriod` instead of reading `periodStart` from the outer scope — change its dependency array to `[estimates, activePeriod]` and compute `periodStart` inside it.

After the `stats` useMemo, add the trend data computation:

```tsx
  // ── Monthly win rate trend (last 6 months) ────────────────────────────
  const trendData = useMemo(() => {
    const now = new Date();
    const points: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthEstimates = estimates.filter((e) => {
        if (e.deletedAt) return false;
        const created = new Date(e.createdAt);
        return created >= monthStart && created < monthEnd;
      });
      const won = monthEstimates.filter((e) => e.status === EstimateStatus.Approved).length;
      const lost = monthEstimates.filter((e) => e.status === EstimateStatus.Declined).length;
      const decided = won + lost;
      points.push(decided > 0 ? Math.round((won / decided) * 100) : 0);
    }
    return points;
  }, [estimates]);
```

- [ ] **Step 4: Add period picker options constant**

Above the component function, add:

```tsx
const PERIOD_OPTIONS = [
  { value: "90d", label: "90D" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "ALL" },
];
```

- [ ] **Step 5: Rewrite SM block with WidgetBackgroundChart**

Replace the SM `if (size === "sm")` block with:

```tsx
  // ── SM: Hero + background sparkline ──────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={<Sparkline data={trendData} width={200} height={100} color={color} />}
          opacity={0.25}
        >
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none" style={{ color }}>
                {animatedRate}%
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/estimates"); }}
                className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
              </button>
            </div>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("winRate.title") ?? "Win Rate"}
            </span>
            <span className="font-mono text-micro-sm text-text-tertiary mt-0.5">
              {stats.won}/{stats.sent} {t("winRate.won") ?? "won"} · {stats.lost} {t("winRate.lost") ?? "lost"}
            </span>
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }
```

- [ ] **Step 6: Rewrite MD/LG return block**

Replace the entire MD/LG return (from `const ringSize = ...` through the end of the component) with:

```tsx
  // ── Ring SVG ────────────────────────────────────────────────────────────
  const ringSize = 64;
  const strokeWidth = 6;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - stats.winRate / 100);
  const fontSize = 18;

  // ── MD/LG: Ring + trend sparkline + stat grid ──────────────────────────
  return (
    <Card className="h-full" ref={ref}>
      <div className="h-full flex flex-col px-3 py-2">
        {/* HEADER — title + period picker */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("winRate.title") ?? "Win Rate"}
          </span>
          <WidgetPeriodPicker
            options={PERIOD_OPTIONS}
            value={activePeriod}
            onChange={setActivePeriod}
            size={size}
          />
        </div>

        {/* HERO — ring gauge + trend sparkline */}
        <div className="flex items-center gap-4 mb-3">
          <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} className="shrink-0">
            <circle
              cx={ringSize / 2} cy={ringSize / 2} r={radius}
              fill="none" strokeWidth={strokeWidth}
              style={{ stroke: WT.faint }}
            />
            <circle
              cx={ringSize / 2} cy={ringSize / 2} r={radius}
              fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={isVisible && !reducedMotion ? dashOffset : circumference}
              style={{
                stroke: color,
                transition: reducedMotion ? "none" : `stroke-dashoffset 800ms ${WIDGET_EASE_CSS}`,
                transform: "rotate(-90deg)", transformOrigin: "center",
              }}
            />
            <text
              x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
              fontSize={fontSize} fontFamily="var(--font-mono)" fontWeight="600"
              style={{ fill: color }}
            >
              {animatedRate}%
            </text>
          </svg>

          {/* Trend sparkline — fills remaining space */}
          <div className="flex-1 min-w-0">
            <Sparkline data={trendData} width={120} height={ringSize} color={color} />
          </div>
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade>
            {/* Stat grid */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div>
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">{t("winRate.sent") ?? "Sent"}</span>
                <p className="font-mono text-data-sm text-text-primary font-medium">{stats.sent}</p>
              </div>
              <div>
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">{t("winRate.won") ?? "Won"}</span>
                <p className="font-mono text-data-sm text-status-success font-medium">{stats.won}</p>
              </div>
              <div>
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">{t("winRate.lost") ?? "Lost"}</span>
                <p className="font-mono text-data-sm text-status-error font-medium">{stats.lost}</p>
              </div>
            </div>

            {/* Avg deal size */}
            {stats.avgDealSize > 0 && (
              <div className="pt-2 border-t border-border-subtle">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                  {t("winRate.avgDealSize") ?? "Avg Deal Size"}
                </span>
                <p className="font-mono text-data-sm text-text-primary font-medium">
                  {formatCompactCurrency(stats.avgDealSize)}
                </p>
              </div>
            )}
          </ScrollFade>
        )}

        {/* FOOTER */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/estimates")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("winRate.viewEstimates") ?? "View Estimates"}
          </button>
        )}
      </div>
    </Card>
  );
```

- [ ] **Step 7: Verify build**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx next build --no-lint 2>&1 | tail -20`

- [ ] **Step 8: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add src/components/dashboard/widgets/win-rate-widget.tsx src/i18n/dictionaries/en/dashboard.json
git commit -m "feat(widget): win rate — background sparkline SM, period picker + trend MD, easing fix"
```

---

## Task 3: Lead Sources Widget — SM Donut + LG Trendlines + Easing

**Files:**
- Modify: `src/components/dashboard/widgets/lead-sources-widget.tsx`
- Modify: `src/i18n/dictionaries/en/dashboard.json`

- [ ] **Step 1: Add new i18n keys**

In `src/i18n/dictionaries/en/dashboard.json`, after `"leadSources.more": "more"` (line 729), add:

```json
  "leadSources.trend": "Trend",
  "leadSources.other": "Other",
```

- [ ] **Step 2: Update imports**

Replace imports section with:

```tsx
"use client";

import { useMemo, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetBackgroundChart } from "./shared/widget-background-chart";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { Sparkline } from "./shared/sparkline";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS, WIDGET_STAGGER_DELAY, WIDGET_DURATION_NORMAL } from "./shared/widget-motion";
import { widgetLineItemStyle } from "./shared/widget-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import { formatCompactCurrency } from "./shared/widget-utils";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Opportunity } from "@/lib/types/pipeline";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
```

- [ ] **Step 3: Remove local formatCurrency function**

Delete the `formatCurrency` helper function. Replace any usage with `formatCompactCurrency` from imports.

- [ ] **Step 4: Add per-source trend computation**

After the existing `sourceData` useMemo, add:

```tsx
  // ── Per-source monthly trends (LG only) ─────────────────────────────
  const sourceTrends = useMemo(() => {
    if (!showActions(size)) return new Map<string, number[]>();
    const now = new Date();
    const trends = new Map<string, number[]>();
    for (const src of sourceData.sources) {
      const points: number[] = [];
      for (let i = 5; i >= 0; i--) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const count = opportunities.filter((o) => {
          if (o.deletedAt) return false;
          const source = o.source ?? "other";
          if (source !== src.source) return false;
          const created = new Date(o.createdAt);
          return created >= monthStart && created < monthEnd;
        }).length;
        points.push(count);
      }
      trends.set(src.source, points);
    }
    return trends;
  }, [opportunities, sourceData.sources, size]);
```

- [ ] **Step 5: Build SM donut SVG helper**

Add this helper function above the component:

```tsx
function DonutChart({
  segments,
  size: diameter,
  strokeWidth = 8,
  isVisible,
  reducedMotion,
}: {
  segments: { value: number; color: string }[];
  size: number;
  strokeWidth?: number;
  isVisible: boolean;
  reducedMotion: boolean | null;
}) {
  const radius = (diameter - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  let accumulated = 0;

  return (
    <svg width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`}>
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        const dashLen = circumference * pct;
        const dashGap = circumference - dashLen;
        const offset = -circumference * accumulated;
        accumulated += pct;

        return (
          <circle
            key={i}
            cx={diameter / 2}
            cy={diameter / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            style={{
              stroke: seg.color,
              strokeDasharray: `${dashLen} ${dashGap}`,
              strokeDashoffset: isVisible || reducedMotion ? offset : circumference,
              transition: reducedMotion ? "none" : `stroke-dashoffset 600ms ${WIDGET_EASE_CSS} ${i * 60}ms`,
              transform: "rotate(-90deg)",
              transformOrigin: "center",
            }}
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 6: Rewrite SM block with background donut**

Replace the SM `if (size === "sm")` block with:

```tsx
  // ── SM: Hero + background donut ──────────────────────────────────────
  if (size === "sm") {
    const top = sourceData.sources[0];
    const donutSegments = sourceData.sources.slice(0, 4).map((s, i) => ({
      value: s.count,
      color: BAR_COLORS[i % BAR_COLORS.length],
    }));
    const otherCount = sourceData.sources.slice(4).reduce((sum, s) => sum + s.count, 0);
    if (otherCount > 0) donutSegments.push({ value: otherCount, color: WT.muted });

    return (
      <Card className="h-full p-0" ref={ref}>
        <WidgetBackgroundChart
          chart={
            <div className="h-full w-full flex items-center justify-end pr-2">
              <DonutChart
                segments={donutSegments}
                size={80}
                isVisible={isVisible}
                reducedMotion={reducedMotion}
              />
            </div>
          }
          opacity={0.35}
        >
          <div className="h-full flex flex-col p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
                {sourceData.total}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate("/pipeline"); }}
                className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              >
                <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
              </button>
            </div>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("leadSources.title") ?? "Lead Sources"}
            </span>
            {top && (
              <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
                #1: {top.label} ({top.count})
              </span>
            )}
          </div>
        </WidgetBackgroundChart>
      </Card>
    );
  }
```

- [ ] **Step 7: Add LG trendlines section**

In the MD/LG return block, find the closing of the `showDetail(size)` section (the `</ScrollFade>` before the footer). Wrap the existing bar chart in `WidgetHeroCollapse` for LG, and add trend rows after it. Replace the entire `{showDetail(size) && (` block with:

```tsx
        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade className="relative">
            <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
              <TooltipRow label={tooltip.source} value={`${tooltip.count}`} />
              <TooltipRow label={t("leadSources.ofTotal") ?? "of total"} value={`${tooltip.pct}%`} />
              {tooltip.value > 0 && (
                <TooltipRow label={t("leadSources.pipelineValue") ?? "Pipeline value"} value={formatCompactCurrency(tooltip.value)} />
              )}
            </WidgetTooltip>

            {/* Bar chart — compressed in LG when trends visible */}
            <WidgetHeroCollapse collapsed={showActions(size)} collapsedHeight="80px">
              <div className="flex flex-col gap-[6px]">
                {sourceData.sources.slice(0, maxBars).map((s, i) => {
                  const barWidth = Math.max((s.count / maxCount) * 100, 4);
                  const barColor = BAR_COLORS[i % BAR_COLORS.length];

                  return (
                    <div
                      key={s.source}
                      onMouseEnter={(e) => {
                        const parentRect = ref.current?.getBoundingClientRect();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        if (!parentRect) return;
                        setTooltip({
                          visible: true,
                          x: rect.left - parentRect.left + rect.width / 2,
                          y: rect.top - parentRect.top,
                          source: s.label,
                          count: s.count,
                          pct: s.pct,
                          value: s.value,
                        });
                      }}
                      onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                    >
                      <div className="flex items-center justify-between mb-[2px]">
                        <span className="font-mohave text-caption-sm text-text-secondary">{s.label}</span>
                        <span className="font-mono text-micro text-text-tertiary">{s.count}</span>
                      </div>
                      <div className="rounded-sm overflow-hidden" style={{ height: `${barHeight}px`, backgroundColor: WT.faint }}>
                        <div
                          className="h-full rounded-sm"
                          style={{
                            width: isVisible ? `${barWidth}%` : "0%",
                            backgroundColor: barColor,
                            transitionProperty: "width",
                            transitionDuration: reducedMotion ? "200ms" : "500ms",
                            transitionDelay: reducedMotion ? "0ms" : `${i * 60}ms`,
                            transitionTimingFunction: WIDGET_EASE_CSS,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                {sourceData.sources.length > maxBars && !showActions(size) && (
                  <span className="font-mono text-micro-sm text-text-tertiary">
                    +{sourceData.sources.length - maxBars} {t("leadSources.more") ?? "more"}
                  </span>
                )}
              </div>
            </WidgetHeroCollapse>

            {/* LG: Per-source trendlines */}
            {showActions(size) && (
              <div className="mt-2 pt-2 border-t border-border-subtle flex flex-col gap-[6px]">
                {sourceData.sources.map((s, i) => {
                  const trend = sourceTrends.get(s.source) ?? [];
                  const barColor = BAR_COLORS[i % BAR_COLORS.length];
                  return (
                    <div
                      key={s.source}
                      className="flex items-center gap-2"
                      style={widgetLineItemStyle(i, isVisible, reducedMotion)}
                    >
                      <span
                        className="w-[6px] h-[6px] rounded-full shrink-0"
                        style={{ backgroundColor: barColor }}
                      />
                      <span className="font-mohave text-caption-sm text-text-secondary truncate min-w-0 flex-1">
                        {s.label}
                      </span>
                      <Sparkline data={trend} width={80} height={20} color={barColor} />
                      <span className="font-mono text-micro text-text-primary shrink-0 w-[24px] text-right">
                        {s.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollFade>
        )}
```

- [ ] **Step 8: Fix remaining easing references**

Search for any remaining `cubic-bezier(0.16, 1, 0.3, 1)` and replace with `WIDGET_EASE_CSS`.

- [ ] **Step 9: Verify build**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx next build --no-lint 2>&1 | tail -20`

- [ ] **Step 10: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add src/components/dashboard/widgets/lead-sources-widget.tsx src/i18n/dictionaries/en/dashboard.json
git commit -m "feat(widget): lead sources — background donut SM, per-source trendlines LG, easing fix"
```

---

## Task 4: Pipeline Funnel Widget — Data Fix + Vertical Funnel + LG Tabs

**Files:**
- Modify: `src/components/dashboard/widgets/pipeline-funnel-widget.tsx`
- Modify: `src/i18n/dictionaries/en/dashboard.json`

- [ ] **Step 1: Add new i18n keys**

In `src/i18n/dictionaries/en/dashboard.json`, after `"pipelineFunnel.conversionRate": "Conversion"` (line 570), add:

```json
  "pipelineFunnel.stageTab": "Stage",
  "pipelineFunnel.deals": "deals",
```

- [ ] **Step 2: Update imports**

Replace the imports section with:

```tsx
"use client";

import { useMemo, useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetHeroCollapse } from "./shared/widget-hero-collapse";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import { formatCompactCurrency } from "./shared/widget-utils";
import type { Project } from "@/lib/types/models";
import {
  ProjectStatus,
  isActiveProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { cn } from "@/lib/utils/cn";
```

- [ ] **Step 3: Replace FUNNEL_STAGES with data-driven stages**

Remove the old `FUNNEL_STAGES` constant. Replace with:

```tsx
const PIPELINE_STAGES = [
  { status: ProjectStatus.RFQ, label: "RFQ" },
  { status: ProjectStatus.Estimated, label: "Estimated" },
  { status: ProjectStatus.Accepted, label: "Accepted" },
  { status: ProjectStatus.InProgress, label: "In Progress" },
] as const;
```

- [ ] **Step 4: Fix data computation in useMemo**

Replace the stages `useMemo` with:

```tsx
  const stages = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => !p.deletedAt && isActiveProjectStatus(p.status)
    );
    const total = activeProjects.length;
    const maxCount = Math.max(
      ...PIPELINE_STAGES.map((s) => activeProjects.filter((p) => p.status === s.status).length),
      1
    );

    return PIPELINE_STAGES.map((stage) => {
      const stageProjects = activeProjects.filter((p) => p.status === stage.status);
      const count = stageProjects.length;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      const widthPct = maxCount > 0 ? Math.max((count / maxCount) * 100, count > 0 ? 8 : 0) : 0;
      return {
        ...stage,
        count,
        pct,
        widthPct,
        color: PROJECT_STATUS_COLORS[stage.status],
        projects: stageProjects,
      };
    });
  }, [projects]);
```

Note: `widthPct` replaces both `fillPct` and `maxWidth` — it's purely data-driven. Minimum 8% for non-empty stages so they remain visible.

- [ ] **Step 5: Add tab state for LG**

After the tooltip state, add:

```tsx
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [showAllItems, setShowAllItems] = useState(false);
```

- [ ] **Step 6: Fix SM block easing**

In the SM block, replace `transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)"` with `transitionTimingFunction: WIDGET_EASE_CSS`. Also replace the `maxWidth` style with `widthPct`:

Change `style={{ maxWidth: \`${stage.maxWidth}%\` }}` to use the data-driven width. Replace the SM bar rendering with:

```tsx
          <div className="flex-1 flex flex-col items-center justify-center gap-[3px] px-3">
            {stages.map((stage, i) => (
              <div key={i} className="w-full flex justify-center">
                <div
                  className="rounded-sm"
                  style={{
                    height: `${barHeight}px`,
                    width: isVisible ? `${stage.widthPct}%` : "0%",
                    backgroundColor: stage.color,
                    transitionProperty: "width",
                    transitionDuration: reducedMotion ? "200ms" : "500ms",
                    transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
                    transitionTimingFunction: WIDGET_EASE_CSS,
                  }}
                />
              </div>
            ))}
          </div>
```

- [ ] **Step 7: Rewrite MD/LG return block with vertical funnel + tabs**

Replace the entire MD/LG return block (from `return (` after the SM block) with:

```tsx
  // ── Helper: Vertical funnel bars ────────────────────────────────────────
  const nonEmptyStages = stages.filter((s) => s.count > 0);
  const availableHeight = showActions(size) ? 120 : 160;

  const renderVerticalFunnel = () => (
    <div className="flex flex-col gap-[2px]" style={{ minHeight: `${Math.min(availableHeight, nonEmptyStages.length * 28)}px` }}>
      {stages.map((stage, i) => {
        if (stage.count === 0) return null;
        const heightPct = totalProjects > 0 ? Math.max((stage.count / totalProjects) * availableHeight, 20) : 20;
        const isWide = heightPct >= 28;

        return (
          <div
            key={i}
            className={cn(
              "relative w-full rounded-sm cursor-pointer transition-opacity",
              showActions(size) && activeTab && activeTab !== stage.status && "opacity-40"
            )}
            style={{
              height: `${heightPct}px`,
              backgroundColor: stage.color,
              opacity: isVisible ? undefined : 0,
              transitionProperty: "opacity",
              transitionDuration: reducedMotion ? "200ms" : "500ms",
              transitionDelay: reducedMotion ? "0ms" : `${i * 80}ms`,
              transitionTimingFunction: WIDGET_EASE_CSS,
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (showActions(size)) {
                setActiveTab((prev) => prev === stage.status ? null : stage.status);
                setShowAllItems(false);
              } else {
                onNavigate("/pipeline");
              }
            }}
            onMouseEnter={(e) => handleBarHover(e, stage)}
            onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
          >
            {isWide ? (
              <div className="absolute inset-0 flex items-center justify-between px-2">
                <span className="font-mohave text-caption-sm text-text-primary">{stage.label} · {stage.count}</span>
              </div>
            ) : (
              <div className="absolute left-full top-1/2 -translate-y-1/2 flex items-center gap-1 ml-2 whitespace-nowrap">
                <span className="font-mohave text-micro text-text-secondary">{stage.label}</span>
                <span className="font-mono text-micro text-text-primary font-medium">{stage.count}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Active tab content (LG) ─────────────────────────────────────────────
  const activeStageData = showActions(size) && activeTab
    ? stages.find((s) => s.status === activeTab)
    : null;
  const MAX_VISIBLE_ITEMS = 5;

  // ── MD / LG: Vertical funnel + optional tab detail ──────────────────────
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("pipelineFunnel.title") ?? "Pipeline"}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {totalProjects}
          </span>
        </div>

        {/* Detail zone */}
        <ScrollFade>
          <WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
            <TooltipRow label={tooltip.stage} value={`${tooltip.count}`} />
            <TooltipRow label={t("pipelineFunnel.ofPipeline") ?? "Of pipeline"} value={`${tooltip.pct}%`} />
          </WidgetTooltip>

          {/* Vertical funnel — collapses in LG when tab active */}
          {showActions(size) ? (
            <WidgetHeroCollapse collapsed={!!activeTab} collapsedHeight="60px">
              {renderVerticalFunnel()}
            </WidgetHeroCollapse>
          ) : (
            renderVerticalFunnel()
          )}

          {/* LG: Tab strip */}
          {showActions(size) && (
            <div className="flex items-center gap-[3px] mt-2 flex-wrap">
              {nonEmptyStages.map((stage) => (
                <button
                  key={stage.status}
                  onClick={() => {
                    setActiveTab((prev) => prev === stage.status ? null : stage.status);
                    setShowAllItems(false);
                  }}
                  className={cn(
                    "font-kosugi text-micro-sm uppercase tracking-wider px-1.5 py-[1px] rounded-sm transition-colors",
                    activeTab === stage.status
                      ? "bg-ops-accent/15 text-ops-accent border border-ops-accent/30"
                      : "text-text-tertiary hover:text-text-secondary border border-transparent"
                  )}
                >
                  {stage.label}
                  <span className="font-mono ml-0.5">{stage.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* LG: Tab content — WidgetLineItem rows */}
          {activeStageData && (
            <div className="mt-2 pt-2 border-t border-border-subtle">
              {(showAllItems ? activeStageData.projects : activeStageData.projects.slice(0, MAX_VISIBLE_ITEMS)).map((p, i) => (
                <WidgetLineItem
                  key={p.id}
                  indicator={{ type: "bar", color: activeStageData.color }}
                  primary={p.title || (t("pipelineFunnel.untitled") ?? "Untitled")}
                  secondary={p.client?.name}
                  metric={p.estimatedValue != null ? formatCompactCurrency(p.estimatedValue) : undefined}
                  onClick={() => onNavigate(`/projects/${p.id}`)}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                />
              ))}
              {activeStageData.projects.length > MAX_VISIBLE_ITEMS && (
                <WidgetMoreButton
                  remaining={activeStageData.projects.length - MAX_VISIBLE_ITEMS}
                  expanded={showAllItems}
                  onToggle={() => setShowAllItems((prev) => !prev)}
                />
              )}
            </div>
          )}

          {/* LG: Conversion rates (shown when no tab active) */}
          {showActions(size) && !activeTab && conversionRates.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border-subtle">
              <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
                {t("pipelineFunnel.conversionRate") ?? "Conversion"}
              </span>
              <div className="flex flex-col gap-1 mt-1">
                {conversionRates.map((cr, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="font-mohave text-caption-sm text-text-secondary">
                      {cr.from} → {cr.to}
                    </span>
                    <span className="font-mono text-micro-sm text-text-primary">{cr.rate}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ScrollFade>

        {/* Footer */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/pipeline")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("pipelineFunnel.viewPipeline") ?? "View Pipeline"}
          </button>
        )}
      </div>
    </Card>
  );
```

- [ ] **Step 8: Remove the old LG per-stage project names section**

The old LG section that rendered `stage.projects.slice(0, 2)` with raw divs is now replaced by the tab content above. Ensure no duplicate code remains.

- [ ] **Step 9: Verify build**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx next build --no-lint 2>&1 | tail -20`

- [ ] **Step 10: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add src/components/dashboard/widgets/pipeline-funnel-widget.tsx src/i18n/dictionaries/en/dashboard.json
git commit -m "feat(widget): pipeline funnel — data-proportional bars, vertical funnel, tabbed LG detail"
```

---

## Task 5: Pipeline List Widget — Distribution Bar + WidgetLineItem + Inline Actions

**Files:**
- Modify: `src/components/dashboard/widgets/pipeline-list-widget.tsx`
- Modify: `src/i18n/dictionaries/en/dashboard.json`

This is the most complex task. It adds the stage distribution bar, migrates to `WidgetLineItem`, and implements inline Advance + Follow Up actions with email integration.

- [ ] **Step 1: Add new i18n keys**

In `src/i18n/dictionaries/en/dashboard.json`, after `"pipelineList.more": "more"` (line 315), add:

```json
  "pipelineList.advance": "Advance",
  "pipelineList.advancedTo": "Advanced to",
  "pipelineList.followUp": "Follow Up",
  "pipelineList.followUpSent": "Follow-up sent to",
  "pipelineList.followUpSentUndo": "Undo will log a note",
  "pipelineList.noConnection": "Connect your email in Settings to send follow-ups",
  "pipelineList.settings": "Settings",
  "pipelineList.composePlaceholder": "Quick follow-up message...",
  "pipelineList.send": "Send",
  "pipelineList.mergeHint": "Use {{client_name}}, {{project_title}}",
  "pipelineList.sentInError": "Follow-up sent in error (undone from dashboard)",
```

- [ ] **Step 2: Rewrite imports**

Replace the entire imports section with:

```tsx
"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronRight, Mail } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { showWidgetActionToast } from "./shared/widget-action-toast";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { showActions } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import {
  OpportunityStage,
  getStageDisplayName,
  getActiveStages,
  nextOpportunityStage,
  isTerminalStage,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import type { Opportunity } from "@/lib/types/pipeline";
import { resolveMergeFields } from "@/lib/types/email-template";
import type { EmailTemplate } from "@/lib/types/email-template";
import { useOpportunities, useClientMap, useMoveOpportunityStage, useCreateActivity } from "@/lib/hooks";
import { useEmailConnections } from "@/lib/hooks/use-email-connections";
import { useEmailTemplates } from "@/lib/hooks/use-email-templates";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
```

- [ ] **Step 3: Add distribution bar sub-component**

Below the existing helpers section, add:

```tsx
// ---------------------------------------------------------------------------
// Stage Distribution Bar
// ---------------------------------------------------------------------------

function StageDistributionBar({
  opportunities,
  isVisible,
  reducedMotion,
}: {
  opportunities: Opportunity[];
  isVisible: boolean;
  reducedMotion: boolean | null;
}) {
  const activeStages = getActiveStages();
  const active = opportunities.filter(
    (o) => !o.deletedAt && !isTerminalStage(o.stage)
  );
  const total = active.length;
  if (total === 0) return null;

  const segments = activeStages
    .map((stage) => ({
      stage,
      count: active.filter((o) => o.stage === stage).length,
      color: OPPORTUNITY_STAGE_COLORS[stage],
    }))
    .filter((s) => s.count > 0);

  return (
    <div className="flex h-[6px] rounded-sm overflow-hidden mb-2">
      {segments.map((seg) => (
        <div
          key={seg.stage}
          style={{
            width: isVisible ? `${(seg.count / total) * 100}%` : "0%",
            backgroundColor: seg.color,
            transitionProperty: "width",
            transitionDuration: reducedMotion ? "200ms" : "500ms",
            transitionTimingFunction: WIDGET_EASE_CSS,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add PipelineInlineActions sub-component**

Below the distribution bar, add the inline actions component:

```tsx
// ---------------------------------------------------------------------------
// Inline Actions (Advance + Follow Up)
// ---------------------------------------------------------------------------

function PipelineInlineActions({
  opportunity,
  navigate,
}: {
  opportunity: Opportunity;
  navigate: (path: string) => void;
}) {
  const { t } = useDictionary("dashboard");
  const { currentUser: user, company } = useAuthStore();
  const moveStage = useMoveOpportunityStage();
  const createActivity = useCreateActivity();
  const { data: connections } = useEmailConnections();
  const { data: templates } = useEmailTemplates();
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);

  const activeConnection = connections?.find((c) => c.status === "active");
  const followUpTemplate = templates?.find(
    (tmpl) => tmpl.category === "follow_up" && tmpl.isActive
  );

  const nextStage = nextOpportunityStage(opportunity.stage);
  const canAdvance = nextStage && !isTerminalStage(nextStage);
  const hasEmail = !!opportunity.contactEmail;

  const handleAdvance = useCallback(() => {
    if (!nextStage || !canAdvance) return;
    const previousStage = opportunity.stage;
    moveStage.mutate(
      { id: opportunity.id, stage: nextStage, userId: user?.id },
    );
    showWidgetActionToast({
      label: `${t("pipelineList.advancedTo") ?? "Advanced to"} ${getStageDisplayName(nextStage)}`,
      onUndo: () => {
        moveStage.mutate({ id: opportunity.id, stage: previousStage, userId: user?.id });
      },
    });
  }, [opportunity, nextStage, canAdvance, moveStage, user, t]);

  const sendFollowUp = useCallback(async (body: string, subject: string) => {
    if (!activeConnection || !opportunity.contactEmail || !company) return;
    setSending(true);
    try {
      const res = await fetch("/api/integrations/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user?.id,
          companyId: company.id,
          connectionId: activeConnection.id,
          to: [opportunity.contactEmail],
          subject,
          body,
          format: "markdown",
          opportunityId: opportunity.id,
        }),
      });
      if (!res.ok) throw new Error("Send failed");

      const recipientName = opportunity.contactName ?? opportunity.client?.name ?? opportunity.contactEmail;
      showWidgetActionToast({
        label: `${t("pipelineList.followUpSent") ?? "Follow-up sent to"} ${recipientName}`,
        onUndo: () => {
          // Best-effort: log a "sent in error" activity note
          createActivity.mutate({
            opportunityId: opportunity.id,
            companyId: company.id,
            type: "note",
            body: t("pipelineList.sentInError") ?? "Follow-up sent in error (undone from dashboard)",
            createdBy: user?.id,
          });
        },
      });
    } catch {
      toast.error("Failed to send follow-up");
    } finally {
      setSending(false);
      setComposeOpen(false);
      setComposeText("");
    }
  }, [activeConnection, opportunity, company, user, createActivity, t]);

  const handleFollowUp = useCallback(() => {
    if (!activeConnection) {
      toast(t("pipelineList.noConnection") ?? "Connect your email in Settings to send follow-ups", {
        action: {
          label: t("pipelineList.settings") ?? "Settings",
          onClick: () => navigate("/settings/email"),
        },
      });
      return;
    }
    if (followUpTemplate) {
      const ctx = {
        clientName: opportunity.contactName ?? opportunity.client?.name,
        projectTitle: opportunity.title,
        companyName: company?.name,
      };
      const resolvedBody = resolveMergeFields(followUpTemplate.body, ctx);
      const resolvedSubject = resolveMergeFields(followUpTemplate.subject, ctx);
      sendFollowUp(resolvedBody, resolvedSubject);
    }
    // Path B handled by popover (composeOpen state)
  }, [activeConnection, followUpTemplate, opportunity, company, sendFollowUp, navigate, t]);

  return (
    <div className="flex items-center gap-0.5">
      {canAdvance && (
        <WidgetInlineAction
          icon={ChevronRight}
          label={t("pipelineList.advance") ?? "Advance"}
          onAction={handleAdvance}
        />
      )}
      {hasEmail && activeConnection && !followUpTemplate ? (
        // Path B: inline compose popover
        <Popover open={composeOpen} onOpenChange={setComposeOpen}>
          <PopoverTrigger asChild>
            <button
              className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors text-text-disabled hover:text-text-secondary"
              title={t("pipelineList.followUp") ?? "Follow Up"}
            >
              <Mail className="w-[14px] h-[14px]" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[260px] p-2">
            <textarea
              className="w-full bg-transparent border border-border-subtle rounded-sm p-1.5 font-mohave text-caption-sm text-text-primary resize-none focus:outline-none focus:border-ops-accent/50"
              rows={3}
              placeholder={t("pipelineList.composePlaceholder") ?? "Quick follow-up message..."}
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="font-kosugi text-micro-sm text-text-disabled">
                {t("pipelineList.mergeHint") ?? "Use {{client_name}}, {{project_title}}"}
              </span>
              <button
                onClick={() => {
                  if (!composeText.trim()) return;
                  const ctx = {
                    clientName: opportunity.contactName ?? opportunity.client?.name,
                    projectTitle: opportunity.title,
                    companyName: company?.name,
                  };
                  sendFollowUp(
                    resolveMergeFields(composeText, ctx),
                    `Follow up: ${opportunity.title || "Your project"}`
                  );
                }}
                disabled={!composeText.trim() || sending}
                className={cn(
                  "font-kosugi text-micro uppercase tracking-wider px-2 py-[2px] rounded-sm transition-colors",
                  composeText.trim() && !sending
                    ? "text-ops-accent hover:bg-ops-accent/15"
                    : "text-text-disabled cursor-not-allowed"
                )}
              >
                {sending ? "..." : (t("pipelineList.send") ?? "Send")}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : hasEmail ? (
        // Path A (template exists) or Path C (no connection) — single action button
        <WidgetInlineAction
          icon={Mail}
          label={t("pipelineList.followUp") ?? "Follow Up"}
          onAction={handleFollowUp}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite PipelineListWidget component**

Replace the main `PipelineListWidget` function body. Keep the `filterOpportunities`, `daysInStage`, `getOpportunityDisplayName` helpers. Replace the component:

```tsx
export function PipelineListWidget({ size, config }: PipelineListWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const navigate = (path: string) => router.push(path);
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const filter = (config.stageFilter as StageFilter) ?? "all-active";
  const { data: rawOpportunities, isLoading } = useOpportunities();
  const clientMap = useClientMap();

  const filtered = useMemo(() => {
    if (!rawOpportunities) return [];
    const enriched = rawOpportunities.map((opp) => {
      if (opp.client?.name) return opp;
      const c = opp.clientId ? clientMap.get(opp.clientId) : undefined;
      return c ? { ...opp, client: c as Opportunity["client"] } : opp;
    });
    return filterOpportunities(enriched, filter);
  }, [rawOpportunities, filter, clientMap]);

  const totalValue = useMemo(
    () => filtered.reduce((sum, o) => sum + (o.estimatedValue ?? 0), 0),
    [filtered]
  );

  const [showAllItems, setShowAllItems] = useState(false);

  // ── SM: Hero + distribution bar + value ─────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
            {isLoading ? "—" : filtered.length}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t(FILTER_LABEL_KEYS[filter])}
          </span>
          {!isLoading && rawOpportunities && (
            <StageDistributionBar
              opportunities={rawOpportunities}
              isVisible={isVisible}
              reducedMotion={reducedMotion}
            />
          )}
          {!isLoading && (
            <span className="font-mono text-micro-sm text-text-tertiary mt-0.5">
              {formatCompactCurrency(totalValue)}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── LG: Grouped by stage ───────────────────────────────────────────────
  if (size === "lg") {
    const activeStageList = getActiveStages();
    const grouped = activeStageList
      .map((stage) => ({
        stage,
        label: getStageDisplayName(stage),
        color: OPPORTUNITY_STAGE_COLORS[stage],
        items: filtered.filter((o) => o.stage === stage),
      }))
      .filter((g) => g.items.length > 0);

    const MAX_VISIBLE = 10;
    let remainingSlots = showAllItems ? Infinity : MAX_VISIBLE;
    let totalRendered = 0;

    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
              {t(FILTER_LABEL_KEYS[filter])}
            </span>
            <span className="font-mono text-micro text-text-tertiary">
              {isLoading ? "..." : `${filtered.length} · ${formatCompactCurrency(totalValue)}`}
            </span>
          </div>
          {!isLoading && rawOpportunities && (
            <StageDistributionBar
              opportunities={rawOpportunities}
              isVisible={isVisible}
              reducedMotion={reducedMotion}
            />
          )}
          <ScrollFade>
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
                <span className="font-mono text-[11px] text-text-disabled ml-1">
                  {t("pipelineList.loading")}
                </span>
              </div>
            ) : filtered.length === 0 ? (
              <p className="font-mohave text-body-sm text-text-disabled py-2">
                {t("pipelineList.empty")}
              </p>
            ) : (
              <div className="space-y-2">
                {grouped.map((group) => {
                  if (remainingSlots <= 0) return null;
                  const visibleItems = group.items.slice(0, remainingSlots);
                  remainingSlots -= visibleItems.length;

                  return (
                    <div key={group.stage}>
                      <div className="flex items-center gap-1 mb-0.5 px-1">
                        <span
                          className="w-[8px] h-[8px] rounded-sm shrink-0"
                          style={{ backgroundColor: group.color }}
                        />
                        <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-secondary">
                          {group.label}
                        </span>
                        <span className="font-mono text-[11px] text-text-disabled ml-auto">
                          {group.items.length}
                        </span>
                      </div>
                      {visibleItems.map((opp, i) => {
                        totalRendered++;
                        return (
                          <WidgetLineItem
                            key={opp.id}
                            indicator={{ type: "bar", color: group.color }}
                            primary={getOpportunityDisplayName(opp)}
                            secondary={`${daysInStage(opp.stageEnteredAt)}d · ${getStageDisplayName(opp.stage)}`}
                            metric={opp.estimatedValue != null ? formatCompactCurrency(opp.estimatedValue) : undefined}
                            action={showActions(size) ? <PipelineInlineActions opportunity={opp} navigate={navigate} /> : undefined}
                            index={i}
                            isVisible={isVisible}
                            reducedMotion={reducedMotion}
                            onClick={() => navigate(`/pipeline/${opp.id}`)}
                          />
                        );
                      })}
                      {group.items.length > visibleItems.length && (
                        <span className="font-mono text-[11px] text-text-disabled block px-1">
                          +{group.items.length - visibleItems.length} {t("pipelineList.more")}
                        </span>
                      )}
                    </div>
                  );
                })}
                {filtered.length > MAX_VISIBLE && (
                  <WidgetMoreButton
                    remaining={filtered.length - MAX_VISIBLE}
                    expanded={showAllItems}
                    onToggle={() => setShowAllItems((prev) => !prev)}
                  />
                )}
              </div>
            )}
          </ScrollFade>
        </div>
      </Card>
    );
  }

  // ── MD: List of opportunities ──────────────────────────────────────────
  const MAX_MD_ITEMS = 5;
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t(FILTER_LABEL_KEYS[filter])}
          </span>
          <span className="font-mono text-micro text-text-tertiary">
            {isLoading ? "..." : `${filtered.length} · ${formatCompactCurrency(totalValue)}`}
          </span>
        </div>
        {!isLoading && rawOpportunities && (
          <StageDistributionBar
            opportunities={rawOpportunities}
            isVisible={isVisible}
            reducedMotion={reducedMotion}
          />
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("pipelineList.loading")}
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            {t("pipelineList.empty")}
          </p>
        ) : (
          <>
            {filtered.slice(0, MAX_MD_ITEMS).map((opp, i) => (
              <WidgetLineItem
                key={opp.id}
                indicator={{ type: "bar", color: OPPORTUNITY_STAGE_COLORS[opp.stage] }}
                primary={getOpportunityDisplayName(opp)}
                secondary={`${daysInStage(opp.stageEnteredAt)}d · ${getStageDisplayName(opp.stage)}`}
                metric={opp.estimatedValue != null ? formatCompactCurrency(opp.estimatedValue) : undefined}
                action={showActions(size) ? <PipelineInlineActions opportunity={opp} navigate={navigate} /> : undefined}
                index={i}
                isVisible={isVisible}
                reducedMotion={reducedMotion}
                onClick={() => navigate(`/pipeline/${opp.id}`)}
              />
            ))}
            {filtered.length > MAX_MD_ITEMS && (
              <WidgetMoreButton
                remaining={filtered.length - MAX_MD_ITEMS}
                expanded={false}
                onToggle={() => navigate("/pipeline")}
              />
            )}
          </>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 6: Remove the old OpportunityRow component**

Delete the `OpportunityRow` function and its `getOpportunityDisplayName` helper is kept (it's reused). Remove the old component entirely.

- [ ] **Step 7: Verify useCreateActivity exists in hooks**

Run: `grep -n "export function useCreateActivity" /Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/hooks/use-opportunities.ts`

If it exists, good. If not, use `useCreateFollowUp` or call OpportunityService.createActivity directly. The import may need adjusting — verify the exact export name in the hooks index file.

- [ ] **Step 8: Verify build**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npx next build --no-lint 2>&1 | tail -30`

This widget has the most complex import set — likely to surface TypeScript issues. Fix any errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add src/components/dashboard/widgets/pipeline-list-widget.tsx src/i18n/dictionaries/en/dashboard.json
git commit -m "feat(widget): pipeline list — distribution bar, WidgetLineItem, inline Advance + Follow Up email"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Pipeline Funnel §1.1 data fix → Task 4 Step 3-4
- [x] Pipeline Funnel §1.2 vertical MD → Task 4 Step 7
- [x] Pipeline Funnel §1.3 LG tabs → Task 4 Step 7
- [x] Win Rate §2.1 trend data → Task 2 Step 3
- [x] Win Rate §2.2 SM background → Task 2 Step 5
- [x] Win Rate §2.3 MD streamlined → Task 2 Step 6
- [x] Win Rate §2.4 cleanup → Task 2 Step 2-3
- [x] Lead Sources §3.1 SM donut → Task 3 Step 5-6
- [x] Lead Sources §3.3 LG trendlines → Task 3 Step 4, 7
- [x] Lead Sources §3.4 cleanup → Task 3 Step 2-3, 8
- [x] Pipeline List §4.1 distribution bar → Task 5 Step 3
- [x] Pipeline List §4.3 WidgetLineItem + actions → Task 5 Step 4-5
- [x] Pipeline List §4.4 props/navigation → Task 5 Step 5 (useRouter)
- [x] Booking Rate §5.1 SM background → Task 1 Step 3
- [x] Booking Rate §5.2 MD tooltips → Task 1 Step 4-5
- [x] Booking Rate §5.3 i18n → Task 1 Step 1
- [x] Cross-cutting easing → All tasks
- [x] Cross-cutting shared utils → All tasks
- [x] Cross-cutting i18n → All tasks

**Placeholder scan:** No TBDs, TODOs, or "implement later" found.

**Type consistency:** Verified — `WidgetLineItem`, `WidgetInlineAction`, `WidgetBackgroundChart`, `WidgetPeriodPicker`, `WidgetHeroCollapse`, `WidgetMoreButton`, `showWidgetActionToast`, `formatCompactCurrency`, `WIDGET_EASE_CSS`, `widgetLineItemStyle` all match their actual exported signatures from the shared/ directory as read in the codebase exploration phase.
