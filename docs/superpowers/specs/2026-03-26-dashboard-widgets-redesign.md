# Dashboard Widgets Redesign — Complete Specification

**Date**: 2026-03-26
**Status**: Design — awaiting review
**Scope**: OPS-Web dashboard widget library — audit, redesign, new widgets, composition patterns

---

## Executive Summary

The current dashboard has 54 widget type IDs, 33 component files, and a severe over-indexing on single-number stat tiles. 26 of 54 type IDs are stat-type widgets showing isolated numbers with no trend context, no comparison, and no interactivity. This redesign consolidates the library from 54 type IDs down to 27 — cutting redundancy, adding 6 high-value new widgets, and redesigning 8 existing widgets with interactivity, visual density, and no-scroll constraint compliance.

**Key changes:**
- 35 widget type IDs removed (absorbed into better visual widgets)
- 6 new widgets added (Profit Gauge, Cash Position, Win Rate, Backlog Depth, Booking Rate, Action Required)
- 8 widgets redesigned with hover tooltips, animated charts, and multi-size responsive layouts
- 12 widgets kept with minor polish
- Role-based default layouts (Owner, Admin, Operator, Crew)
- Shared tooltip infrastructure for all interactive widgets
- Skeleton loading states replacing spinner placeholders
- Preference store migration v11 → v12

---

## Constraints

1. **No scrolling within widgets.** Every widget must fit its content within its allocated grid cell. Content is truncated, limited, or linked to a detail page — never scrolled. Remove all `overflow-y-auto scrollbar-hide` from widget content areas.
2. **Row height: 140px.** This is fixed. Sizes `lg` get 280px (2 rows). Content must be designed to fit.
3. **Interactive, not passive.** Every data-bearing widget must support at minimum hover-for-detail on desktop and tap-for-detail on mobile.
4. **All sizes must be self-contained.** Each supported size is a complete, useful representation — not a truncated version of the next size up.
5. **Permission-gated.** Every widget specifies `requiredPermission`. Widgets invisible to users who lack permission. Tray hides them too.
6. **i18n required.** All user-facing strings via `useDictionary("dashboard")`. No hardcoded English.
7. **Reduced motion.** All animations have `prefers-reduced-motion` alternatives: 200ms opacity fade, no transform.

---

## Pixel Budget per Size

At 140px row height with 8px padding (card) + 24px header:

| Size | Usable Height | Usable Width (2xl) | Content Budget |
|------|--------------|-------------------|----------------|
| `xs` | ~140px total, ~100px content | 2 cols (~180px) | Big number + label + sparkline OR ring |
| `sm` | ~140px total, ~100px content | 3 cols (~270px) | Number + chart OR 3-4 list items |
| `md` | ~140px total, ~100px content | 6 cols (~540px) | Bar chart (80px) + summary OR 4-5 list items |
| `lg` | ~280px total, ~240px content | 6 cols (~540px) | Full chart + legend + detail list |
| `full` | ~140px total, ~100px content | 12 cols (~1080px) | Wide timeline or multi-column strip |

---

## Shared Infrastructure (build first)

### 1. Widget Tooltip Component

A shared, consistent tooltip for all chart hover interactions. Does not exist today.

**File**: `src/components/dashboard/widgets/shared/widget-tooltip.tsx`

**Behavior:**
- Appears in 150ms with `cubic-bezier(0.16, 1, 0.3, 1)` opacity + translateY(4px→0)
- Dismisses in 100ms with `cubic-bezier(0.4, 0, 1, 1)` opacity fade
- Positioned above hover target, flips below if near top edge
- Dark frosted glass surface: `rgba(10, 10, 10, 0.85)` + `backdrop-blur(12px)` + `1px solid rgba(255,255,255,0.12)`
- Max width: 200px, rounded-sm (2px radius)
- Content: primary value (mono, text-primary), label (kosugi, text-tertiary), optional delta (mono, color-coded)
- Z-index: 1000 (dropdown layer)
- Touch: tap to show, tap elsewhere to dismiss. No long-press.

**Props:**
```typescript
interface WidgetTooltipProps {
  visible: boolean;
  x: number;
  y: number;
  anchor?: "above" | "below";
  children: React.ReactNode;
}
```

### 2. Skeleton Loading Component

Replace all `<Loader2 className="animate-spin" />` with skeleton shapes matching the widget's final layout.

**File**: `src/components/dashboard/widgets/shared/widget-skeleton.tsx`

**Variants:**
- `stat`: Rounded rect for number + thin rect for label
- `bar-chart`: Series of vertical rects at varying heights
- `horizontal-bars`: Series of horizontal rects at varying widths
- `list`: 3-5 horizontal lines with circle (avatar) placeholders
- `ring`: Circle outline
- `funnel`: Trapezoid shapes narrowing
- `timeline`: Vertical line with horizontal ticks

**Animation:** Pulse shimmer — `rgba(255,255,255,0.04)` → `rgba(255,255,255,0.08)` → `rgba(255,255,255,0.04)`, 1.5s cycle, `ease-in-out`. Reduced motion: static `rgba(255,255,255,0.06)`.

### 3. Sparkline Component

Inline sparkline for stat-type displays at `xs`/`sm` sizes.

**File**: `src/components/dashboard/widgets/shared/sparkline.tsx`

**Implementation:** SVG `<polyline>` with `strokeLinecap="round"`, `strokeLinejoin="round"`, stroke width 1.5px, no fill. Color inherits from parent via CSS variable or prop. Draw animation: `stroke-dasharray` + `stroke-dashoffset` transition, 600ms, `cubic-bezier(0.16, 1, 0.3, 1)`. Reduced motion: instant render.

**Props:**
```typescript
interface SparklineProps {
  data: number[];
  width?: number;     // default 60
  height?: number;    // default 24
  color?: string;     // default "currentColor"
  className?: string;
}
```

### 4. Animated Count-Up (existing — keep)

The existing `useAnimatedValue` in `stat-card.tsx` is well-implemented. Extract to `shared/use-animated-value.ts` for reuse across all widgets. No changes to the hook itself.

### 5. useWidgetIntersection Hook

Intersection Observer hook so widgets only animate when they scroll into view (relevant for pages with many widgets where lower ones are off-screen on load).

**File**: `src/components/dashboard/widgets/shared/use-widget-intersection.ts`

```typescript
function useWidgetIntersection(ref: RefObject<HTMLElement>, threshold?: number): boolean;
```

Returns `true` once the element has intersected the viewport. Once true, stays true (no re-triggering).

---

## Complete Widget Catalog

### CATEGORY: MONEY — *"Am I making money?"*

---

#### 1. `revenue-pulse`

**Replaces**: `revenue-chart`, `stat-revenue`
**Label**: "Revenue"
**Description**: "Monthly revenue collected with trend"
**Category**: `financial`
**Tags**: `["essential", "finance"]`
**Icon**: `DollarSign`
**Supported sizes**: `["xs", "sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: false
**Config schema**:
```typescript
[{
  key: "period",
  label: "Period",
  type: "select",
  options: [
    { value: "6mo", label: "6 Months" },
    { value: "12mo", label: "12 Months" },
    { value: "ytd", label: "Year to Date" },
  ],
  defaultValue: "ytd",
}]
```
**Required permission**: `invoices.view`
**Data source**: `useInvoices()` → filter to paid, group by `paidAt` month

**Size layouts:**

| Size | Content | Max items |
|------|---------|-----------|
| `xs` | MTD collected (mono, 28px, amber) + trend arrow (up/down/flat vs prior month) + label "MTD Revenue" (kosugi, 9px) | — |
| `sm` | MTD collected (mono, 20px, amber) + 6-month sparkline (60×24px, amber stroke) + YTD total below (mono, 11px, tertiary) | — |
| `md` | Header: "Revenue" + year. Bar chart: one bar per month, 80px chart height, 70% bar width. Bars use `#C4A868` (current month full opacity, past months 60%). Below chart: MTD left, YTD right, separated by border-t. | Up to 12 bars |
| `lg` | Same as md + ghost overlay bars for same months last year at 20% opacity. Hover shows "Mar 2026: $12.4K vs Mar 2025: $8.1K (+53%)" tooltip. | Up to 12 bars |

**Interactions:**
- `md`/`lg`: Hover bar → tooltip with month name, amount, and % change vs same month last year
- `lg`: Ghost bars create instant YoY comparison without needing a second chart
- Click chart area → navigate to `/invoices?status=paid`

**Animation:**
- Bars rise from 0 height with 80ms stagger, 600ms per bar, `cubic-bezier(0.16, 1, 0.3, 1)`
- Count-up on MTD/YTD numbers: 1000ms, quadratic ease-out
- Ghost bars fade in after primary bars complete (200ms delay, 400ms opacity)

**Empty state:** "No paid invoices yet" + subtle DollarSign icon at 20% opacity

---

#### 2. `receivables-aging`

**Replaces**: `invoice-aging`, `stat-receivables`, `stat-collect`, `past-due-invoices`
**Label**: "Receivables"
**Description**: "Outstanding invoices by aging bucket"
**Category**: `financial`
**Tags**: `["essential", "finance"]`
**Icon**: `Clock`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: false
**Config schema**: `[]`
**Required permission**: `invoices.view`
**Data source**: `useInvoices()` → filter to unpaid (exclude Paid, Void, WrittenOff, Draft), bucket by days past due

**Aging buckets:**
| Bucket | Range | Color | Semantic |
|--------|-------|-------|----------|
| Current | Not yet due | `#597794` (accent steel) | Normal |
| 1-30 days | 1-30 past due | `#C4A868` (amber) | Attention |
| 31-60 days | 31-60 past due | `#F97316` (orange) | Warning |
| 61-90 days | 61-90 past due | `rgba(181,130,137,0.7)` (muted red) | Danger |
| 90+ days | >90 past due | `#B58289` (full red) | Critical |

**Size layouts:**

| Size | Content |
|------|---------|
| `sm` | Total outstanding (mono, 20px) + urgency indicator: colored dot matching worst non-empty bucket. Label "Outstanding" (kosugi, 9px). If 90+ bucket has items, text turns red. |
| `md` | Header: "Receivables" + total count · total amount. Stacked horizontal bar (20px tall, proportional by amount, not the current 8px). Below: bucket list — dot + label + count + amount per row. Max 5 rows (one per bucket). |
| `lg` | Same as md + below divider: top 3 overdue invoices from the worst bucket: client name + amount + days overdue. Clickable. |

**Interactions:**
- `md`/`lg`: Hover bar segment → tooltip: bucket name, count, amount, % of total
- `lg`: Click invoice row → navigate to invoice detail
- Click header → navigate to `/invoices?status=past_due`

**Animation:**
- Bar segments grow left-to-right with 60ms stagger, 500ms per segment
- Bucket list rows fade in with 40ms stagger after bar completes

**Empty state:** "All invoices current" with subtle checkmark

---

#### 3. `profit-gauge`

**NEW**
**Label**: "Profit"
**Description**: "Gross margin — revenue vs expenses"
**Category**: `financial`
**Tags**: `["finance"]`
**Icon**: `TrendingUp`
**Supported sizes**: `["xs", "sm", "md"]`
**Default size**: `sm`
**Allow multiple**: false
**Config schema**:
```typescript
[{
  key: "period",
  label: "Period",
  type: "select",
  options: [
    { value: "mtd", label: "Month to Date" },
    { value: "qtd", label: "Quarter to Date" },
    { value: "ytd", label: "Year to Date" },
  ],
  defaultValue: "mtd",
}]
```
**Required permission**: `invoices.view`
**Data source**: `useInvoices()` (collected revenue in period) + `useExpenses()` (approved expenses in period, from `expenses` table — NOT the placeholder)

**Gross margin calculation:**
```
revenue = sum of amountPaid from paid invoices in period
expenses = sum of amount from approved expenses in period
profit = revenue - expenses
margin% = (profit / revenue) * 100
```

**Color zones:**
| Margin | Color | Label |
|--------|-------|-------|
| >50% | `#6B8F71` (muted green) | Healthy |
| 40-50% | `#C4A868` (amber) | Watch |
| <40% | `#B58289` (muted red) | Low |

**Size layouts:**

| Size | Content |
|------|---------|
| `xs` | SVG ring (60px diameter, 6px stroke) filled to margin%. Center: margin% number (mono, 20px, color-coded). Label "Margin" (kosugi, 9px) below ring. |
| `sm` | Ring (50px) left-aligned + right: Revenue number (mono, 14px, text-primary) and Expenses number (mono, 14px, text-tertiary) stacked. Profit number below (mono, 14px, color-coded). |
| `md` | Horizontal waterfall chart: Revenue bar (full width = revenue) → minus Expenses bar (orange/red sections eating into it from right) → remaining = Profit (green section). Labels above each section. Margin% callout right-aligned. |

**Interactions:**
- `xs`: Hover ring → tooltip: revenue, expenses, profit, margin%
- `sm`: Hover revenue/expenses → tooltip with breakdown
- `md`: Hover waterfall segment → tooltip: category amount + % of revenue

**Animation:**
- Ring fill: 800ms, spring (stiffness: 60, damping: 15)
- Waterfall: bars grow left-to-right, 600ms, `cubic-bezier(0.16, 1, 0.3, 1)`
- Count-up on all numbers: 1000ms

**Empty state:** Ring at 0% with "--" center. "No data for this period"

---

#### 4. `expense-tracker`

**Replaces**: `expense-summary` (currently a non-functional placeholder)
**Label**: "Expenses"
**Description**: "Expense breakdown by category"
**Category**: `financial`
**Tags**: `["finance"]`
**Icon**: `Receipt`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: false
**Config schema**:
```typescript
[{
  key: "period",
  label: "Period",
  type: "select",
  options: [
    { value: "this-month", label: "This Month" },
    { value: "last-month", label: "Last Month" },
    { value: "ytd", label: "Year to Date" },
  ],
  defaultValue: "this-month",
}]
```
**Required permission**: `expenses.view`
**Data source**: `useExpenses()` — query the actual `expenses` table filtered by period, group by `category`. Categories from DB: Materials, Equipment, Fuel, Subcontractor, Permits, Tools, Safety, Office, Other.

**Category colors** (9 categories, from the design system neutral spectrum + accent):
| Category | Color |
|----------|-------|
| Materials | `#597794` (accent steel) |
| Equipment | `#C4A868` (amber) |
| Fuel | `#8B7355` (earth brown) |
| Subcontractor | `#7A8B6F` (sage) |
| Permits | `#9B8BA0` (dusty mauve) |
| Tools | `#6B7B8D` (slate) |
| Safety | `#6B8F71` (muted green) |
| Office | `#8195B5` (light steel) |
| Other | `rgba(255,255,255,0.3)` (neutral) |

**Size layouts:**

| Size | Content |
|------|---------|
| `sm` | Total expenses (mono, 20px) + top category name + amount (mono, 11px, tertiary). Delta vs prior period as arrow + % (mono, 11px, color-coded). |
| `md` | Header: "Expenses" + period label + total. Horizontal bars per category (top 5 by amount), proportional width, sorted descending. Bar label left + amount right. Categories with <5% of total grouped as "Other". |
| `lg` | Same as md (top 7 categories) + per-category 3-month sparkline (40×16px) showing trend. Below: total this period vs last period comparison with delta. |

**Interactions:**
- `md`/`lg`: Hover bar → tooltip: category, amount, % of total, count of expenses
- `lg`: Hover sparkline → tooltip: month + amount
- Click category → navigate to `/expenses?category=<cat>`

**Animation:**
- Bars grow left-to-right with 60ms stagger, 500ms per bar
- Sparklines draw after bars complete (200ms delay)

**Empty state:** "No expenses recorded" + Receipt icon at 20% opacity. NOT "Connect accounting" — expenses are tracked natively.

---

#### 5. `cash-position`

**NEW**
**Label**: "Cash Flow"
**Description**: "Net cash flow — collected vs spent"
**Category**: `financial`
**Tags**: `["finance"]`
**Icon**: `ArrowUpDown`
**Supported sizes**: `["sm", "md"]`
**Default size**: `sm`
**Allow multiple**: false
**Config schema**:
```typescript
[{
  key: "period",
  label: "Period",
  type: "select",
  options: [
    { value: "this-month", label: "This Month" },
    { value: "last-month", label: "Last Month" },
  ],
  defaultValue: "this-month",
}]
```
**Required permission**: `invoices.view`
**Data source**: `useInvoices()` (sum of amountPaid where paidAt in period) + `useExpenses()` (sum of amount where approved in period)

**Size layouts:**

| Size | Content |
|------|---------|
| `sm` | Net cash flow as signed number (mono, 24px). Green with "+" prefix if positive, red with "-" prefix if negative. Label "Net Cash Flow" (kosugi, 9px). Below: "In: $X · Out: $X" (mono, 11px, tertiary). |
| `md` | Header: "Cash Flow" + period. Two horizontal bars: "Collected" (green, proportional) and "Spent" (red, proportional). Net labeled between with signed value + color. |

**Interactions:**
- `sm`: Hover → tooltip: collected amount, spent amount, net
- `md`: Hover bar → tooltip: breakdown (collected from X invoices, spent across Y expenses)

**Animation:**
- Bars grow simultaneously, 500ms, `cubic-bezier(0.16, 1, 0.3, 1)`
- Net number counts up: 1000ms

**Empty state:** "$0" in neutral with "No transactions this period"

---

#### 6. `invoice-list`

**KEEP** (minor polish: add skeleton loading, remove `overflow-y-auto`)
**Label**: "Invoices"
**Category**: `financial`
**Tags**: `["essential", "finance"]`
**Icon**: `FileText`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: true
**Config schema**: `[{ key: "statusFilter", ... }]` (existing)
**Required permission**: `invoices.view`

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `sm` | 3 invoices |
| `md` | 4 invoices |
| `lg` | 8 invoices |

Overflow: "+N more" link → navigates to `/invoices`

---

#### 7. `payments-recent`

**KEEP** (minor polish: skeleton loading, remove `overflow-y-auto`)
**Label**: "Recent Payments"
**Category**: `financial`
**Tags**: `["finance"]`
**Icon**: `CreditCard`
**Supported sizes**: `["sm", "md"]`
**Default size**: `sm`
**Allow multiple**: false
**Required permission**: `invoices.record_payment`

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `sm` | 3 payments |
| `md` | 4 payments |

---

### CATEGORY: PIPELINE — *"Is work coming in?"*

---

#### 8. `pipeline-funnel`

**REDESIGN** — replaces thin stacked bar with real funnel shape
**Absorbs**: `stat-projects-*` (5), `stat-projects`, `stat-opportunities`, `pipeline-value`, `pipeline-velocity`, `project-status-chart`
**Label**: "Pipeline"
**Description**: "Project pipeline by stage"
**Category**: `pipeline`
**Tags**: `["essential", "pipeline"]`
**Icon**: `Filter`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: false
**Config schema**: `[]`
**Required permission**: `projects.view`
**Data source**: `useProjects()` → filter active, group by status (RFQ, Estimated, Accepted, In Progress)

**Funnel visual:**
Instead of a thin 8px stacked bar, render as stacked horizontal bars with decreasing max-width to create a funnel/trapezoid shape. Each stage bar is full-height (16px), but max-width decreases per stage:
- RFQ: 100% max-width
- Estimated: 80% max-width
- Accepted: 60% max-width
- In Progress: 45% max-width

Actual bar width within the max-width is proportional to count. Color per stage from `PROJECT_STATUS_COLORS`.

**Size layouts:**

| Size | Content |
|------|---------|
| `sm` | Funnel visual (4 bars, 12px each, centered) + total count right-aligned in header. |
| `md` | Header: "Pipeline" + total count + total estimated value. Funnel visual (4 bars, 16px each). Right of each bar: stage label + count + "($Xk)" value. |
| `lg` | Same as md funnel. Below divider: per-stage top 2 project names (truncated) as clickable rows with client name + estimated value. |

**Interactions:**
- `md`/`lg`: Hover stage bar → tooltip: stage name, count, total value, avg days in stage, % of pipeline
- `lg`: Click project row → navigate to `/projects/<id>`
- Click funnel area → navigate to `/pipeline`

**Animation:**
- Funnel bars slide in from left with 80ms stagger, 500ms per bar, `cubic-bezier(0.16, 1, 0.3, 1)`
- Width animates from 0 to final proportional width

**Empty state:** Empty funnel outline (dashed borders at each stage width) + "No active projects"

---

#### 9. `win-rate`

**NEW** — replaces `estimates-funnel`
**Label**: "Win Rate"
**Description**: "Estimate conversion rate"
**Category**: `pipeline`
**Tags**: `["pipeline", "estimates"]`
**Icon**: `Target`
**Supported sizes**: `["xs", "sm"]`
**Default size**: `sm`
**Allow multiple**: false
**Config schema**:
```typescript
[{
  key: "period",
  label: "Period",
  type: "select",
  options: [
    { value: "90d", label: "Last 90 Days" },
    { value: "ytd", label: "Year to Date" },
    { value: "all", label: "All Time" },
  ],
  defaultValue: "90d",
}]
```
**Required permission**: `estimates.view`
**Data source**: `useEstimates()` → count where status is Sent/Viewed/Approved/Declined in period. Win rate = approved / (approved + declined). Exclude Draft and Expired.

**Color zones:**
| Rate | Color |
|------|-------|
| >40% | `#6B8F71` (muted green) |
| 25-40% | `#C4A868` (amber) |
| <25% | `#B58289` (muted red) |

**Size layouts:**

| Size | Content |
|------|---------|
| `xs` | Win rate % (mono, 28px, color-coded) + label "Win Rate" (kosugi, 9px). Left border colored to match zone. |
| `sm` | Win rate % (mono, 20px, color-coded) + mini funnel: two connected bars — "Sent: N" (full width) → "Won: N" (proportional width). Below: "N sent · N won · N lost" (mono, 10px, tertiary). |

**Interactions:**
- Hover → tooltip: sent count, approved count, declined count, pending count, period label
- Click → navigate to `/estimates`

**Animation:**
- Number count-up: 1000ms
- Mini funnel bars grow: 500ms with 100ms stagger

**Empty state:** "--%" with "No estimates in period"

---

#### 10. `backlog-depth`

**NEW**
**Label**: "Backlog"
**Description**: "Weeks of signed work ahead"
**Category**: `pipeline`
**Tags**: `["essential", "pipeline"]`
**Icon**: `Layers`
**Supported sizes**: `["xs", "sm", "md"]`
**Default size**: `sm`
**Allow multiple**: false
**Config schema**: `[]`
**Required permission**: `projects.view`
**Data source**: `useProjects()` → filter status=Accepted (signed but not In Progress). Estimate weeks from task date spans or project count × average project duration (computed from completed projects' date ranges).

**Backlog estimation logic:**
```
acceptedProjects = projects where status === "Accepted" && !deletedAt
If tasks have date ranges:
  totalScheduledDays = sum of (endDate - startDate) for all tasks across accepted projects
  backlogWeeks = totalScheduledDays / 5 (working days per week)
Else (no task dates):
  avgProjectDuration = avg(endDate - startDate) of completed projects (last 12 months), default 10 days
  backlogWeeks = (acceptedProjects.length * avgProjectDuration) / 5
```

**Color zones:**
| Weeks | Color | Zone |
|-------|-------|------|
| 3-6 | `#6B8F71` (muted green) | Healthy |
| 1-2 or 7-8 | `#C4A868` (amber) | Caution |
| <1 or >8 | `#B58289` (muted red) | Risk |

**Size layouts:**

| Size | Content |
|------|---------|
| `xs` | Weeks number (mono, 28px, color-coded) + "wk" suffix (mono, 14px) + label "Backlog" (kosugi, 9px). Left border color-coded. |
| `sm` | Bullet gauge: horizontal bar with green zone (3-6wk) marked, amber zones (1-2, 7-8) flanking, red zones at edges. Marker dot at current value. Below: "N weeks · N projects" (mono, 11px). |
| `md` | Bullet gauge (same as sm but wider) + 6-month sparkline of historical backlog depth below. Trend context: "vs N weeks last month" with delta arrow. |

**Interactions:**
- Hover gauge → tooltip: exact weeks, project count, estimated total days
- `md`: Hover sparkline → tooltip: month + weeks + project count
- Click → navigate to `/projects?status=accepted`

**Animation:**
- Gauge marker slides from 0 to position: 600ms, `cubic-bezier(0.16, 1, 0.3, 1)`
- Sparkline draws: 600ms after gauge completes

**Empty state:** Gauge at 0 with "No signed projects pending"

---

#### 11. `booking-rate`

**NEW**
**Label**: "Bookings"
**Description**: "New projects per month"
**Category**: `pipeline`
**Tags**: `["pipeline"]`
**Icon**: `CalendarPlus`
**Supported sizes**: `["xs", "sm"]`
**Default size**: `sm`
**Allow multiple**: false
**Config schema**: `[]`
**Required permission**: `projects.view`
**Data source**: `useProjects()` → count by `createdAt` month (last 6 months)

**Size layouts:**

| Size | Content |
|------|---------|
| `xs` | This month's count (mono, 28px) + delta vs last month (mono, 11px, color-coded arrow). Label "Bookings" (kosugi, 9px). |
| `sm` | Mini bar chart: 6 bars (one per month, last 6 months), 60px chart height. Current month highlighted (full accent, others 40% opacity). Below: "This month: N" + "vs last month: +/-N" (mono, 11px). |

**Interactions:**
- `sm`: Hover bar → tooltip: month name + count
- Click → navigate to `/projects`

**Animation:**
- Bars rise with 60ms stagger, 500ms per bar
- Count-up: 800ms

**Empty state:** All bars at 0 height with "No projects yet"

---

#### 12. `estimates-overview`

**KEEP** (minor polish: skeleton loading, remove `overflow-y-auto`, enforce max items)
**Label**: "Estimates"
**Category**: `estimates`
**Tags**: `["essential", "estimates"]`
**Icon**: `FileSpreadsheet`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: true
**Config schema**: `[{ key: "statusFilter", ... }]` (existing)
**Required permission**: `estimates.view`

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `sm` | 3 |
| `md` | 4 |
| `lg` | 8 |

---

### CATEGORY: OPERATIONS — *"What's happening today?"*

---

#### 13. `task-pulse`

**NEW** — replaces `stat-tasks`, `stat-tasks-*` (4), `task-status-chart`, `overdue-tasks`
**Label**: "Tasks"
**Description**: "Task status overview with urgency"
**Category**: `schedule`
**Tags**: `["essential", "scheduling"]`
**Icon**: `CheckSquare`
**Supported sizes**: `["xs", "sm", "md"]`
**Default size**: `sm`
**Allow multiple**: false
**Config schema**: `[]`
**Required permission**: `tasks.view`
**Data source**: `useTasks()` → active tasks. Categorize:
- Overdue: `startDate < today && status !== Completed/Cancelled`
- Due today: `startDate === today`
- In progress: `status === InProgress && not overdue`
- Upcoming: `startDate > today && startDate <= today + 7d`

**Segment colors:**
| Segment | Color |
|---------|-------|
| Overdue | `#B58289` (red) |
| Due today | `#C4A868` (amber) |
| In progress | `#597794` (accent steel) |
| Upcoming | `rgba(255,255,255,0.15)` (muted) |

**Size layouts:**

| Size | Content |
|------|---------|
| `xs` | If overdue > 0: overdue count (mono, 28px, red) + label "Overdue" (kosugi, 9px, red). If none overdue: total open count (mono, 28px, accent) + label "Open Tasks" (kosugi, 9px). |
| `sm` | Segmented horizontal bar (20px tall): overdue | due today | in progress | upcoming. Proportional widths. Below bar: count per segment as "N overdue · N today · N active · N upcoming" (mono, 10px, each segment color). |
| `md` | Segmented bar (same as sm). Below: top 4 actionable tasks — overdue first (red left border), then due-today (amber left border). Each: task name (truncated) + project name + assignee initials circle. Clickable. |

**Interactions:**
- Hover bar segment → tooltip: segment label + count + "% of open tasks"
- `md`: Hover task row → highlight `rgba(255,255,255,0.04)`. Click → navigate to project.
- Click bar → navigate to `/calendar`

**Animation:**
- Bar segments fill left-to-right: 100ms stagger, 400ms per segment
- `md` task rows: 40ms stagger after bar, 300ms fade+slide
- Overdue segment pulses once on entry (subtle opacity 1→0.7→1 over 600ms) then stops. Reduced motion: no pulse.

**Empty state:** Full bar in muted green with "All clear" label

---

#### 14. `todays-schedule`

**REDESIGN** of `calendar`
**Label**: "Schedule"
**Description**: "Today's timeline"
**Category**: `schedule`
**Tags**: `["essential", "scheduling"]`
**Icon**: `Calendar`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: false
**Config schema**:
```typescript
[{
  key: "scope",
  label: "Scope",
  type: "select",
  options: [
    { value: "personal", label: "My Schedule" },
    { value: "team", label: "Team Schedule" },
  ],
  defaultValue: "team",
}]
```
**Required permission**: `calendar.view`
**Data source**: `useTasks()` + `useCalendarEvents()` → filter to today (and tomorrow for `lg`)

**Size layouts:**

| Size | Content |
|------|---------|
| `sm` | Next event/task: colored left border + title (truncated) + time + type icon. Below: "N more today" (mono, 11px, tertiary). |
| `md` | Vertical timeline strip: time axis (7am-6pm, compact labels every 2h), colored blocks for tasks/events positioned by start time. Block height proportional to duration (min 12px). Max ~5 visible blocks. Current time indicator (thin horizontal red line). |
| `lg` | Two-column: Today (left, full timeline as md) + Tomorrow (right, same but muted). Current time indicator on today only. |

**Interactions:**
- Hover block → tooltip: title, time range, assignee, project, type
- Click block → navigate to project or calendar event detail
- Click empty timeline area → navigate to `/calendar`

**Animation:**
- Timeline blocks fade in with 40ms stagger from top, 300ms each
- Current time indicator slides down to position: 500ms, ease-out
- Reduced motion: instant render

**Empty state:** Empty timeline with "No events today" centered. Thin dotted hour lines still visible for context.

---

#### 15. `task-list`

**KEEP** — excellent existing implementation with one-click complete, project/client enrichment, and day grouping. Polish only: replace spinner with skeleton, enforce no-scroll limits strictly, remove `overflow-y-auto`.

**No-scroll limits (already implemented correctly):**
| Size | Max items |
|------|-----------|
| `sm` | 1 (next task) |
| `md` | 3 |
| `lg` | 6 |

---

#### 16. `crew-board`

**REDESIGN** of `crew-status` — adds utilization visualization
**Absorbs**: `stat-team`
**Label**: "Crew"
**Description**: "Team status and workload"
**Category**: `team`
**Tags**: `["essential", "field-ops"]`
**Icon**: `Users`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: false
**Config schema**: `[]`
**Required permission**: `team.view`
**Data source**: `useTeamMembers()` + `useTasks()` (active tasks per member)

**Utilization calculation:**
```
tasksAssigned = tasks where assignedUserIds includes member.id && status !== Completed/Cancelled
capacityTarget = 3 tasks per day (configurable in future)
utilization = min(tasksAssigned.length / capacityTarget, 1.0)
```

**Utilization colors:**
| Level | Color |
|-------|-------|
| 0-50% (under) | `rgba(255,255,255,0.15)` (muted — available) |
| 50-85% (healthy) | `#6B8F71` (muted green) |
| 85-100% (full) | `#C4A868` (amber) |
| >100% (overloaded) | `#B58289` (red) |

**Size layouts:**

| Size | Content |
|------|---------|
| `sm` | Team avg utilization % (mono, 20px) + stacked avatar row (existing, max 6) + active count. |
| `md` | Header: "Crew" + active count. Per-member row (max 4): avatar (24px) + name (truncated) + horizontal utilization bar (proportional fill, color-coded) + task count. |
| `lg` | Per-member row (max 7): avatar + name + utilization bar + current task name (truncated, tertiary) + location icon if available. Online/offline dot on avatar. |

**Interactions:**
- Hover utilization bar → tooltip: member name, tasks assigned (list of task names), utilization %
- `lg`: Hover location icon → tooltip: location name
- Click member row → navigate to `/team`

**Animation:**
- Utilization bars grow from 0 with 60ms stagger, 400ms per bar
- Avatars fade in: 40ms stagger, 200ms each

**Empty state:** "No team members" + invite prompt

---

#### 17. `crew-locations`

**KEEP** — unique map value, no changes needed beyond skeleton loading.
**Sizes**: `["md", "lg"]`
**Permission**: `map.view_crew_locations`

---

#### 18. `site-visits`

**KEEP** (minor polish)
**Sizes**: `["sm", "md"]`
**Permission**: `calendar.view`

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `sm` | 2 |
| `md` | 4 |

---

### CATEGORY: CLIENTS — *"How are my relationships?"*

---

#### 19. `top-clients`

**NEW** — replaces `client-revenue`, `stat-client-ranking`, `stat-project-ranking`, `stat-clients`, `stat-clients-active`, `client-activity`
**Label**: "Top Clients"
**Description**: "Clients ranked by revenue"
**Category**: `clients`
**Tags**: `["clients"]`
**Icon**: `Award`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: false
**Config schema**:
```typescript
[
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
]
```
**Required permission**: `clients.view`
**Data source**: `useClients()` + `useInvoices()` → aggregate metric per client, sort descending

**Size layouts:**

| Size | Content |
|------|---------|
| `sm` | Top 3 clients: rank number (mono, 11px, tertiary) + client name (truncated) + metric value (mono, 11px, right-aligned). Proportional horizontal bar behind each row (subtle, 4px, at row bottom). |
| `md` | Top 5 clients: rank + name + proportional bar (8px, right of name) + metric value. Last activity dot: green (<7d), amber (7-30d), red (>30d) or muted (never). |
| `lg` | Top 8 clients: rank + name + bar + metric value + secondary: "N projects · Last active Xd ago" (mono, 10px, tertiary). |

**Interactions:**
- Hover row → tooltip: client name, total revenue, outstanding balance, project count, last activity date
- Click row → navigate to `/clients/<id>`

**Animation:**
- Rows slide in from left with 50ms stagger, 300ms each
- Bars grow from 0 width: 500ms, `cubic-bezier(0.16, 1, 0.3, 1)`

**Empty state:** "No client data yet"

---

#### 20. `client-attention`

**KEEP** (enhanced with reason tags)
**Label**: "Needs Attention"
**Category**: `clients`
**Tags**: `["clients"]`
**Icon**: `AlertTriangle`
**Supported sizes**: `["sm", "md"]`
**Default size**: `md`
**Required permission**: `clients.view`

**Enhancement:** Each client row shows a reason tag: "Overdue invoice", "No contact 30d+", "Stale follow-up", "Expiring estimate". Tags color-coded by severity.

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `sm` | 2 |
| `md` | 4 |

---

#### 21. `client-list`

**KEEP** (minor polish)
**Sizes**: `["sm", "md", "lg"]`
**Allow multiple**: true
**Permission**: `clients.view`

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `sm` | 3 |
| `md` | 4 |
| `lg` | 8 |

---

### CATEGORY: ALERTS & ACTIVITY — *"What needs my attention?"*

---

#### 22. `action-required`

**NEW** — replaces `overdue-tasks`, `past-due-invoices`, `follow-ups-due`
**Label**: "Action Required"
**Description**: "Unified priority alerts"
**Category**: `alerts`
**Tags**: `["essential"]`
**Icon**: `AlertCircle`
**Supported sizes**: `["sm", "md", "lg"]`
**Default size**: `md`
**Allow multiple**: false
**Config schema**: `[]`
**Required permission**: `tasks.view`
**Data source**: Multiple hooks merged + priority-sorted:
- `useTasks()` → overdue tasks (status active, startDate < today)
- `useInvoices()` → past-due invoices (status not Paid/Void/WrittenOff/Draft, dueDate < today)
- Follow-ups from `useOpportunities()` → where nextFollowUpAt < today
- `useEstimates()` → where expirationDate is within 7 days and status is Sent/Viewed

**Priority ranking:**
1. Past-due invoices >90 days (critical — money at risk)
2. Overdue tasks (operational failure)
3. Past-due invoices 30-90 days
4. Expiring estimates (revenue at risk)
5. Stale follow-ups (pipeline at risk)
6. Past-due invoices <30 days

**Item type icons:**
| Type | Icon | Color |
|------|------|-------|
| Overdue task | `CheckSquare` | `#B58289` |
| Past-due invoice | `FileText` | `#F97316` |
| Expiring estimate | `FileSpreadsheet` | `#C4A868` |
| Stale follow-up | `Phone` | `#597794` |

**Size layouts:**

| Size | Content |
|------|---------|
| `sm` | Total action items (mono, 24px, color-coded: red if >5, amber if 1-5, green if 0). Below: category dots with counts — task dot + count, invoice dot + count, etc. If 0: "All clear" in muted green. |
| `md` | Header: "Action Required" + total count badge. Priority-ranked list of top 5 items: type icon + description (truncated) + age ("3d overdue", "Due in 2d") + amount if financial. |
| `lg` | Grouped by type with section headers: "Overdue Tasks (N)" → 3 items, "Past Due Invoices (N)" → 3 items, "Follow-ups (N)" → 2 items. Each item clickable. |

**Interactions:**
- `md`/`lg`: Hover row → highlight. Click → navigate to relevant entity
- `sm`: Click → navigate to the most urgent item
- `md`: Click item → navigate to `/projects/<id>` or `/invoices/<id>` or `/pipeline/<id>`

**Animation:**
- Items enter with 50ms stagger, 300ms each
- The most urgent item (first in list) has a single subtle pulse on entry: opacity 0.7→1 over 400ms. Reduced motion: no pulse.

**Empty state:** Muted green checkmark + "All clear — no items need attention"

---

#### 23. `activity-feed`

**KEEP** (minor polish)
**Sizes**: `["sm", "md", "lg"]`
**Permission**: `projects.view`
**Config**: `[{ key: "entityFilter", ... }]` (existing)

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `sm` | 3 |
| `md` | 5 |
| `lg` | 8 |

---

#### 24. `notifications`

**KEEP**
**Sizes**: `["md", "lg"]`
**Config**: `[{ key: "sortBy", ... }]` (existing)

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `md` | 4 |
| `lg` | 8 |

---

### CATEGORY: PIPELINE DETAIL

---

#### 25. `pipeline-list`

**KEEP** (minor polish)
**Sizes**: `["sm", "md", "lg"]`
**Allow multiple**: true
**Permission**: `pipeline.view`

**No-scroll limits:**
| Size | Max items |
|------|-----------|
| `sm` | 3 |
| `md` | 4 |
| `lg` | 8 |

---

#### 26. `lead-sources`

**RENAME** from `pipeline-sources`
**Label**: "Lead Sources"
**Sizes**: `["md"]`
**Permission**: `pipeline.view`

**Enhancement:** Add hover tooltips to bars showing count, % of total, and total pipeline value from that source.

---

### CATEGORY: LAYOUT

---

#### 27. `spacer`

**KEEP** — unchanged
**Sizes**: All
**Allow multiple**: true

---

## Widget Tray Category Changes

Old categories → New categories:

| Old | New | Contents |
|-----|-----|----------|
| layout | Layout | spacer |
| stats (26 widgets!) | *(dissolved — absorbed into other categories)* | — |
| schedule | Operations | task-pulse, todays-schedule, task-list, crew-board, crew-locations, site-visits |
| financial | Money | revenue-pulse, receivables-aging, profit-gauge, expense-tracker, cash-position, invoice-list, payments-recent |
| pipeline | Pipeline | pipeline-funnel, win-rate, backlog-depth, booking-rate, estimates-overview, pipeline-list, lead-sources |
| team | *(merged into Operations)* | — |
| estimates | *(merged into Pipeline)* | — |
| clients | Clients | top-clients, client-attention, client-list |
| activity | *(merged into Alerts)* | — |
| alerts | Alerts & Activity | action-required, activity-feed, notifications |

**New category order for tray:**
```typescript
export const CATEGORY_ORDER: WidgetCategory[] = [
  "layout",
  "money",
  "pipeline",
  "operations",
  "clients",
  "alerts",
];
```

---

## Role-Based Default Layouts

### Owner Default

```typescript
const OWNER_DEFAULT: WidgetInstance[] = [
  // Row 1: Headline numbers
  createWidgetInstance("revenue-pulse", { period: "ytd" }, "sm"),
  createWidgetInstance("profit-gauge", { period: "mtd" }, "xs"),
  createWidgetInstance("win-rate", { period: "90d" }, "xs"),
  createWidgetInstance("backlog-depth", {}, "xs"),
  // Row 2: Pipeline + Receivables
  createWidgetInstance("pipeline-funnel", {}, "md"),
  createWidgetInstance("receivables-aging", {}, "md"),
  // Row 3: Operations
  createWidgetInstance("task-pulse", {}, "sm"),
  createWidgetInstance("crew-board", {}, "md"),
  // Row 4: Alerts + Activity
  createWidgetInstance("action-required", {}, "md"),
  createWidgetInstance("activity-feed", { entityFilter: "all" }, "sm"),
];
```

### Admin Default

```typescript
const ADMIN_DEFAULT: WidgetInstance[] = [
  // Row 1: Operations
  createWidgetInstance("task-pulse", {}, "sm"),
  createWidgetInstance("todays-schedule", { scope: "team" }, "md"),
  // Row 2: Alerts + Crew
  createWidgetInstance("action-required", {}, "md"),
  createWidgetInstance("crew-board", {}, "md"),
  // Row 3: Financial
  createWidgetInstance("estimates-overview", {}, "md"),
  createWidgetInstance("invoice-list", { statusFilter: "all-open" }, "md"),
  // Row 4: Clients + Activity
  createWidgetInstance("activity-feed", { entityFilter: "all" }, "sm"),
  createWidgetInstance("client-attention", {}, "sm"),
  createWidgetInstance("notifications", {}, "sm"),
];
```

### Operator Default

```typescript
const OPERATOR_DEFAULT: WidgetInstance[] = [
  // Row 1: Tasks + Crew
  createWidgetInstance("task-pulse", {}, "sm"),
  createWidgetInstance("crew-board", {}, "md"),
  // Row 2: Schedule + Locations
  createWidgetInstance("todays-schedule", { scope: "team" }, "lg"),
  createWidgetInstance("crew-locations", {}, "md"),
  // Row 3: Action + Activity
  createWidgetInstance("action-required", {}, "sm"),
  createWidgetInstance("site-visits", {}, "sm"),
  createWidgetInstance("activity-feed", { entityFilter: "all" }, "sm"),
];
```

### Crew Default

```typescript
const CREW_DEFAULT: WidgetInstance[] = [
  // Row 1: My pulse
  createWidgetInstance("task-pulse", {}, "xs"),
  createWidgetInstance("todays-schedule", { scope: "personal" }, "sm"),
  // Row 2: My tasks
  createWidgetInstance("task-list", { filter: "due-today" }, "md"),
  createWidgetInstance("site-visits", { filter: "upcoming" }, "sm"),
];
```

### Default Selection Logic

In `widget-defaults.ts`, update `getDefaultWidgetInstancesFromSetup()`:

```typescript
function getDefaultWidgetInstances(userRole: UserRole): WidgetInstance[] {
  switch (userRole) {
    case UserRole.Owner:
      return OWNER_DEFAULT.map(clone);
    case UserRole.Admin:
      return ADMIN_DEFAULT.map(clone);
    case UserRole.Operator:
      return OPERATOR_DEFAULT.map(clone);
    case UserRole.Crew:
    case UserRole.Unassigned:
      return CREW_DEFAULT.map(clone);
    case UserRole.Office:
      return ADMIN_DEFAULT.map(clone); // Office uses Admin layout
    default:
      return OWNER_DEFAULT.map(clone);
  }
}
```

The existing setup questionnaire tag system (essential, scheduling, finance, field-ops, etc.) is preserved for users who complete onboarding — it overrides the role-based default. For users who skip onboarding, role-based defaults apply.

---

## Preferences Store Migration: v11 → v12

**File**: `src/stores/preferences-store.ts`
**Version bump**: 11 → 12

### Migration logic:

```typescript
// v11 → v12: Dashboard widget consolidation
if (version < 12) {
  const instances = state.widgetInstances as WidgetInstance[] | undefined;
  if (instances && Array.isArray(instances)) {
    // 1. Map renamed widget type IDs
    const RENAME_MAP: Record<string, string> = {
      "revenue-chart": "revenue-pulse",
      "invoice-aging": "receivables-aging",
      "expense-summary": "expense-tracker",
      "calendar": "todays-schedule",
      "crew-status": "crew-board",
      "pipeline-sources": "lead-sources",
    };

    // 2. Widget IDs that are removed entirely
    const REMOVED_IDS = new Set([
      "stat-projects", "stat-tasks", "stat-events", "stat-clients",
      "stat-team", "stat-revenue", "stat-invoices", "stat-estimates",
      "stat-opportunities", "stat-projects-rfq", "stat-projects-estimated",
      "stat-projects-accepted", "stat-projects-in-progress",
      "stat-projects-completed", "stat-tasks-booked",
      "stat-tasks-in-progress", "stat-tasks-completed",
      "stat-tasks-overdue", "stat-clients-active", "stat-receivables",
      "stat-collect", "stat-profit-mtd", "stat-projected-profit",
      "stat-client-ranking", "stat-project-ranking",
      "project-status-chart", "task-status-chart",
      "pipeline-value", "pipeline-velocity", "estimates-funnel",
      "client-revenue", "client-activity",
      "follow-ups-due", "overdue-tasks", "past-due-invoices",
    ]);

    // 3. Replacement widgets to inject if removed widgets were present
    const REPLACEMENT_MAP: Record<string, string> = {
      // If any project stat was present, inject pipeline-funnel
      "stat-projects-rfq": "pipeline-funnel",
      "stat-projects-estimated": "pipeline-funnel",
      "stat-projects-accepted": "pipeline-funnel",
      "stat-projects-in-progress": "pipeline-funnel",
      "project-status-chart": "pipeline-funnel",
      // If any task stat was present, inject task-pulse
      "stat-tasks-booked": "task-pulse",
      "stat-tasks-in-progress": "task-pulse",
      "stat-tasks-completed": "task-pulse",
      "stat-tasks-overdue": "task-pulse",
      "task-status-chart": "task-pulse",
      // If any alert was present, inject action-required
      "overdue-tasks": "action-required",
      "past-due-invoices": "action-required",
      "follow-ups-due": "action-required",
      // Financial stats → their replacements
      "stat-receivables": "receivables-aging",
      "stat-collect": "receivables-aging",
      "stat-profit-mtd": "profit-gauge",
      "stat-projected-profit": "profit-gauge",
      // Client stats → top-clients
      "stat-client-ranking": "top-clients",
      "stat-project-ranking": "top-clients",
      "client-revenue": "top-clients",
      "client-activity": "top-clients",
      // Estimates
      "estimates-funnel": "win-rate",
    };

    // Process: rename, remove, inject replacements
    const replacementsToInject = new Set<string>();
    const migrated: WidgetInstance[] = [];

    for (const inst of instances) {
      // Rename
      if (inst.typeId in RENAME_MAP) {
        migrated.push({ ...inst, typeId: RENAME_MAP[inst.typeId] });
        continue;
      }
      // Remove + track replacement
      if (REMOVED_IDS.has(inst.typeId)) {
        const replacement = REPLACEMENT_MAP[inst.typeId];
        if (replacement) replacementsToInject.add(replacement);
        continue; // Skip removed widget
      }
      // Keep
      migrated.push(inst);
    }

    // Inject replacement widgets (only if not already present)
    const presentTypeIds = new Set(migrated.map(i => i.typeId));
    for (const typeId of replacementsToInject) {
      if (!presentTypeIds.has(typeId)) {
        migrated.push(createWidgetInstance(typeId as WidgetTypeId));
        presentTypeIds.add(typeId);
      }
    }

    state.widgetInstances = migrated;
  }
}
```

---

## Composition Patterns — Compounding Visual Effect

### Design Principle

Adjacent widgets should amplify each other's meaning. A revenue number next to a profit gauge tells a richer story than either alone. A pipeline funnel next to receivables aging shows where future money lives AND where current money is stuck.

### Cross-Widget Visual Harmony

1. **Consistent color semantics**: Revenue amber (`#C4A868`) appears in revenue-pulse AND cash-position AND profit-gauge — always meaning "money." Pipeline stage colors appear in pipeline-funnel AND pipeline-list AND backlog-depth — always meaning "project status." This lets the user's eye pattern-match across widgets without reading labels.

2. **Stagger choreography**: Dashboard entry animates widgets in information-hierarchy order. Primary KPIs (row 1) appear first, supporting visuals (row 2) next, detail lists (row 3+) last. Stagger: 60ms between widgets, 400ms per widget entry.

3. **Shared animation language**: All bars grow left-to-right or bottom-to-top. All rings fill clockwise. All numbers count up. All lists stagger top-to-bottom. Consistency in motion direction creates a unified "living system" feel.

4. **Size adjacency rules**: In the default layouts, `xs` widgets are grouped horizontally (4 headline numbers across), `md` widgets are paired (two half-width), and `lg` widgets are never adjacent (too much vertical real estate). This creates visual rhythm: dense number strip → visual pair → visual pair → list section.

### Recommended Pairings

| Pair | Why |
|------|-----|
| Revenue Pulse + Profit Gauge | Revenue without margin is misleading. Together: "Are we making money AND keeping it?" |
| Pipeline Funnel + Receivables Aging | Pipeline is future money; receivables is stuck money. Together: "What's coming in and what's stuck?" |
| Task Pulse + Crew Board | Task urgency + team capacity. Together: "Is there a problem AND who can fix it?" |
| Win Rate + Booking Rate | Conversion efficiency + volume. Together: "Are we getting enough work AND closing it?" |
| Action Required + Activity Feed | What needs doing + what just happened. Together: "What's urgent AND what's the context?" |
| Backlog Depth + Pipeline Funnel | Signed backlog + prospect pipeline. Together: "How much work do we have AND how much is coming?" |
| Cash Position + Receivables Aging | Net flow + who owes us. Together: "How's our cash AND why?" |

---

## Implementation Order

### Phase 1: Shared Infrastructure (build first, everything depends on this)
1. `shared/widget-tooltip.tsx`
2. `shared/widget-skeleton.tsx` (all variants)
3. `shared/sparkline.tsx`
4. Extract `shared/use-animated-value.ts` from stat-card.tsx
5. `shared/use-widget-intersection.ts`

### Phase 2: Type System + Migration
6. Update `dashboard-widgets.ts` — new type IDs, remove old, new categories
7. Update `preferences-store.ts` — v12 migration
8. Update `widget-defaults.ts` — role-based defaults

### Phase 3: New Widgets (highest value first)
9. `task-pulse` (replaces 7 widgets — biggest consolidation)
10. `action-required` (replaces 3 widgets)
11. `pipeline-funnel` redesign (replaces 8 widgets)
12. `top-clients` (replaces 6 widgets)
13. `profit-gauge` (new, uses expense data)
14. `expense-tracker` (fixes broken placeholder)
15. `receivables-aging` redesign
16. `revenue-pulse` redesign
17. `crew-board` redesign
18. `todays-schedule` redesign
19. `cash-position` (new)
20. `win-rate` (new)
21. `backlog-depth` (new)
22. `booking-rate` (new)
23. `lead-sources` rename + tooltip enhancement

### Phase 4: Polish Existing Widgets
24. Remove `overflow-y-auto` from all kept widgets, enforce max-item limits
25. Replace all Loader2 spinners with skeleton variants
26. Add hover tooltips to all interactive elements

### Phase 5: Dashboard Page + Tray
27. Update `dashboard/page.tsx` — new `renderWidgetContent()` cases, remove old widget imports
28. Update `widget-tray.tsx` — new categories, updated category order
29. Update `widget-shell.tsx` — verify size classes still correct
30. Delete removed widget component files

### Phase 6: i18n
31. Add all new dictionary keys to `en/dashboard.json` and `es/dashboard.json`

### Phase 7: Entry Choreography
32. Implement dashboard stagger system in `widget-grid.tsx`
33. Wire `useWidgetIntersection` to trigger per-widget animations
