# Financial Widgets Redesign Spec

**Date:** 2026-04-02
**Scope:** 7 financial dashboard widgets — redesign to use shared component library

## Global Rules

- **Shared components only:** WidgetPeriodPicker, WidgetLineItem, WidgetMoreButton, WidgetBackgroundChart, WidgetHeroCollapse, WidgetStatusBadge, WidgetEmptyState
- **Replace all local `formatCurrency`** with `formatCompactCurrency` from `widget-utils.ts`
- **Animation easing:** `cubic-bezier(0.22, 1, 0.36, 1)` only — no spring, no bounce
- **Reduced motion:** All animations must check `useReducedMotion()`
- **Do NOT modify:** `dashboard/page.tsx`, `widget-tokens.ts`, any file in `shared/`
- **i18n:** All new strings go to `dashboard.json` under clearly labeled sections

## 1. Revenue Pulse (`revenue-pulse-widget.tsx`)

| Size | Change |
|------|--------|
| XS | Keep as-is |
| SM | Replace sparkline with WidgetBackgroundChart — full-size bar chart behind text at reduced opacity |
| MD | Remove ScrollFade. Use WidgetBackgroundChart so chart is behind text. Add WidgetPeriodPicker (7d/30d/90d/YTD) |
| LG | Add same period picker as MD. WidgetHeroCollapse: on list scroll, animate bar chart to 0.5x height. WidgetMoreButton for client list |

## 2. Receivables Aging (`receivables-aging-widget.tsx`)

| Size | Change |
|------|--------|
| General | Change 31-60 bucket color for contrast (currently same warmth as 1-30). Use `WT.cost` (#B58289, muted rose) |
| XS | Keep as-is |
| SM | Add hover tooltips on stacked bar segments using WidgetTooltip |
| MD | Remove fixed 28px bar height — bars should fill available vertical space (use flex-1) |
| LG | Add dual-graphic: collected receivables bar alongside outstanding aging bars. Shows what's been recovered vs what's still aging |

## 3. Profit Gauge (`profit-gauge-widget.tsx`)

| Size | Change |
|------|--------|
| XS | Keep as-is |
| SM | Add visual breakdown: stacked horizontal bar (revenue segment + expense segment + profit result). Add WidgetPeriodPicker toggle (icon-only popover at SM) |
| MD | Add WidgetPeriodPicker (MTD/QTD/YTD). Waterfall chart: revenue bar full width, expense bar subtracted, profit bar = remainder. Visual reads as "revenue minus expenses equals profit" |

## 4. Expense Tracker (`expense-tracker-widget.tsx`)

| Size | Change |
|------|--------|
| MD | Category bars should use flex-1 to fill available vertical space. Remove fixed gap, use `justify-between` |
| LG | Add % of total per category label. Add team member breakdown section below categories — grouped by submitter with their total spend and % |

## 5. Cash Position (`cash-position-widget.tsx`)

| Size | Change |
|------|--------|
| XS | Keep as-is |
| SM | Wrap in WidgetBackgroundChart with a mini area/sparkline showing net cash flow trend |
| MD | Reduce bar height (14px instead of 20px). Ensure all content fits within widget bounds (no overflow). Add hover state on bars showing breakdown tooltip (payments in, expenses out) |

## 6. Invoice List (`invoice-list-widget.tsx`)

| Size | Change |
|------|--------|
| MD/LG | For PartiallyPaid invoices: show "63%" instead of "PARTIAL" status text (percentage of total paid). Add sort dropdown (Due Date / Amount / Client). Replace manual row markup with WidgetLineItem. Replace manual status badges with WidgetStatusBadge |

## 7. Payments Recent (`payments-recent-widget.tsx`)

| Size | Change |
|------|--------|
| All list sizes | Show % paid of parent invoice on each payment row (e.g. "of $12,500 (84%)") |
| MD/LG | Replace "+16 more" text with WidgetMoreButton — clickable to expand into scrollview. At bottom of expanded list or inline with +N more, add "View All Payments" button linking to /accounting |
| All | Replace manual row markup with WidgetLineItem |
