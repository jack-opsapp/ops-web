# Pipeline & Sales Widgets Redesign — Design Spec

**Date:** 2026-04-02
**Scope:** 5 widget files in `src/components/dashboard/widgets/`
**Constraint:** No modifications to `shared/`, `widget-tokens.ts`, or `dashboard/page.tsx`

---

## 1. Pipeline Funnel Widget (`pipeline-funnel-widget.tsx`)

### 1.1 Bug Fix: Data-Proportional Bar Widths

**Current bug:** Bars use hardcoded `maxWidth` percentages (100%, 80%, 60%, 45%) per stage regardless of actual data. A stage with 1 deal at `maxWidth: 45%` appears much narrower than a stage with 1 deal at `maxWidth: 100%`. The visual is decorative, not data-driven.

**Fix:** Remove the `FUNNEL_STAGES` constant with its hardcoded `maxWidth` values. All bars sized by `count / maxCount * 100`. The funnel shape emerges naturally from the data (earlier stages typically have more deals). When counts are equal, bars are equal width — honest representation.

### 1.2 MD: Vertical Funnel Visualization

Replace horizontal centered bars with a **vertical stacked bar layout** that uses full widget width:

- Bars stack top-to-bottom: earliest stage (New Lead / RFQ) at top, latest at bottom
- Each bar spans full container width; **height** is proportional to `count / total * availableHeight` with a minimum of 20px for non-empty stages
- Bar color: `PROJECT_STATUS_COLORS[stage.status]`
- **Adaptive labels:**
  - If bar height >= 28px → label renders **inside** the bar (left-aligned, `text-text-primary` for contrast against the colored bar, `font-mohave text-caption-sm`). Shows `{label} · {count}`.
  - If bar height < 28px → label renders **adjacent** to the right of the bar at vertical center. Shows `{label}` in `text-text-secondary` + `{count}` in `text-text-primary font-mono`.
- Tooltip on hover: stage name, count, percentage of pipeline.
- Click any bar → `onNavigate("/pipeline")`

### 1.3 LG: Vertical Funnel + Tabbed Stage Detail

**Top zone** (inside `WidgetHeroCollapse`, collapsed when a tab is active):
- Same vertical funnel as MD
- Clicking a bar selects the corresponding tab below

**Tab strip** (below funnel):
- One tab per non-empty stage, styled as inline pills matching `WidgetPeriodPicker` pattern:
  - Active: `bg-ops-accent/15 text-ops-accent border border-ops-accent/30`
  - Inactive: `text-text-tertiary hover:text-text-secondary border border-transparent`
- Tab label: stage name. Tab count badge: `font-mono text-micro-sm`.
- Default: no tab selected (funnel fully expanded). Clicking a bar or tab activates it. Clicking the active tab deselects it (funnel re-expands).

**Tab content** (inside `ScrollFade`):
- `WidgetLineItem` rows for each opportunity in the selected stage:
  - `indicator`: `{ type: "bar", color: PROJECT_STATUS_COLORS[stage.status] }`
  - `primary`: project title or "Untitled"
  - `secondary`: client name (if available)
  - `metric`: `formatCompactCurrency(estimatedValue)` if project has a linked value, otherwise days in status (`{n}d`)
  - `onClick`: `onNavigate(/projects/{id})`
  - `index` + `isVisible` + `reducedMotion` for staggered entrance
- `WidgetMoreButton` when items exceed 5 (collapsed by default)

**Conversion rates** remain below the tab content area (same as current).

### 1.4 XS / SM: No Changes

Current implementations are correct.

---

## 2. Win Rate Widget (`win-rate-widget.tsx`)

### 2.1 Win Rate Trend Data

New `useMemo` that computes monthly win rates for the last 6 months:

```
For each of the last 6 months:
  - Filter estimates where createdAt falls in that month AND status is Approved or Declined
  - winRate = approved / (approved + declined) * 100
  - If no decided estimates in that month, value = null (gap in sparkline)
```

This produces a `number[]` of length 6 for the sparkline.

### 2.2 SM: Background Sparkline

Replace current SM layout (hero + text + won/lost counts) with `WidgetBackgroundChart`:

```
<WidgetBackgroundChart
  chart={<Sparkline data={trendData} width={full-width} height={full-height} color={winRateColor} />}
  opacity={0.25}
>
  {/* Existing SM content: hero %, title, won/lost counts */}
</WidgetBackgroundChart>
```

- Sparkline fills the entire widget background
- Hero text layers on top at z-10
- Nav icon (ArrowUpRight) remains top-right

### 2.3 MD: Streamlined Layout

**Header row:**
- Left: title label ("Win Rate")
- Right: `WidgetPeriodPicker` with options `[{ value: "90d", label: "90D" }, { value: "ytd", label: "YTD" }, { value: "all", label: "ALL" }]`
- Period change updates a local state `period` (currently read from `config.period` — add `useState` with config as initial value)

**Hero row:**
- Left: SVG ring gauge (keep current implementation, same sizing)
- Center text inside ring: `{animatedRate}%` (keep)
- **Remove** the duplicate `{animatedRate}%` text and "Win Rate" label that currently sits to the right of the ring
- Right of ring: `Sparkline` of win rate trend, filling remaining horizontal space (`flex-1`), height matching ring height

**Stat grid** (below hero):
- 3-column grid: Sent / Won / Lost
- Labels: `font-kosugi text-micro-sm text-text-disabled uppercase`
- Values: `font-mono text-data-sm font-medium` (upgrade from current size — makes counters more prominent)
- Won value colored `text-status-success`, Lost colored `text-status-error`, Sent colored `text-text-primary`

**Avg deal size** section: Keep as-is.

### 2.4 Cleanup

- Replace local `formatCurrency()` with `formatCompactCurrency` from `widget-utils.ts`
- Replace hardcoded easing `cubic-bezier(0.16, 1, 0.3, 1)` with `WIDGET_EASE_CSS` from `widget-motion.ts`

### 2.5 XS: No Changes

---

## 3. Lead Sources Widget (`lead-sources-widget.tsx`)

### 3.1 SM: Background Donut Chart

Replace current SM layout (hero + title + top source text) with `WidgetBackgroundChart` containing an SVG donut:

**Donut SVG:**
- Diameter fills widget height (minus padding)
- Positioned center-right of widget background
- Segments for top 4 sources by count, colored via `BAR_COLORS[i]`
- Remaining sources lumped into 5th "other" segment colored `WT.muted`
- Stroke-width: 8px. Inner radius large enough for the donut to look like a donut, not a pie.
- Each segment: `stroke-dasharray` + `stroke-dashoffset` for proportional arcs
- Animate in on intersection: segments draw from 0 to target offset

**Overlay content:**
- Hero number (total leads)
- Title ("Lead Sources")
- Top source label
- Nav icon (ArrowUpRight)

### 3.2 MD: No Changes

Current horizontal bar chart implementation is good.

### 3.3 LG: Source Trendlines

**Top zone** (inside `WidgetHeroCollapse`):
- Keep existing horizontal bar chart (compressed, collapsedHeight ~100px)

**Below: Per-source trend rows** (inside `ScrollFade`):

New `useMemo` that computes per-source monthly counts for last 6 months:
```
For each source:
  For each of the last 6 months:
    Count opportunities where source matches AND createdAt falls in that month
  → number[] of length 6
```

**Row layout:**
- Left: color dot (6px, `BAR_COLORS[i]`) + source label (`font-mohave text-caption-sm text-text-secondary`)
- Center: `Sparkline` (width: ~80px, height: 20px, color: `BAR_COLORS[i]`)
- Right: current count (`font-mono text-micro text-text-primary`)

- Show all sources (no truncation in LG — full vertical space)
- Rows use staggered entrance via `widgetLineItemStyle`

### 3.4 Cleanup

- Replace local `formatCurrency()` with `formatCompactCurrency` from `widget-utils.ts`
- Replace hardcoded easing with `WIDGET_EASE_CSS`

### 3.5 XS: No Changes

---

## 4. Pipeline List Widget (`pipeline-list-widget.tsx`)

### 4.1 All Sizes: Stage Distribution Bar

Add a thin horizontal stacked bar immediately below the header:

- Height: 6px, border-radius: 2px, overflow hidden
- Segments: one per active stage with `width: {stageCount / totalActive * 100}%`
- Color: `OPPORTUNITY_STAGE_COLORS[stage]`
- Animate width from 0% on intersection
- No labels — the bar is a compact visual summary

### 4.2 SM: Add Distribution Bar + Value

Current SM shows just count + filter label + total value. Add:
- Stage distribution bar below the hero count
- Keep total value display

### 4.3 MD & LG: Migrate to WidgetLineItem + Inline Actions

**Replace custom `OpportunityRow`** with `WidgetLineItem`:

```tsx
<WidgetLineItem
  indicator={{ type: "bar", color: OPPORTUNITY_STAGE_COLORS[opp.stage] }}
  primary={getOpportunityDisplayName(opp)}
  secondary={`${daysInStage(opp.stageEnteredAt)}d · ${getStageDisplayName(opp.stage)}`}
  metric={opp.estimatedValue != null ? formatCompactCurrency(opp.estimatedValue) : undefined}
  action={<PipelineInlineActions opportunity={opp} />}
  index={i}
  isVisible={isVisible}
  reducedMotion={reducedMotion}
  onClick={() => onNavigate(`/pipeline/${opp.id}`)}
/>
```

**`PipelineInlineActions` sub-component** (defined in the same file):

Two action buttons side by side in a flex row:

#### Advance Button
- Icon: `ChevronRight` from lucide-react
- `WidgetInlineAction` with `{ icon: ChevronRight, label: t("pipelineList.advance"), onAction: handleAdvance }`
- Hidden when `isTerminalStage(opp.stage)` or `nextOpportunityStage(opp.stage)` is a terminal stage (Won/Lost/Discarded)
- `handleAdvance`:
  1. Call `moveStage.mutate({ id: opp.id, stage: nextOpportunityStage(opp.stage), userId: user?.id })`
  2. Show `showWidgetActionToast({ label: t("pipelineList.advancedTo") + " " + getStageDisplayName(nextStage), onUndo: () => moveStage.mutate({ id: opp.id, stage: opp.stage, userId: user?.id }) })`

#### Follow Up Button
- Icon: `Mail` from lucide-react
- Behavior depends on prerequisites:

**Path A — Template + Connection exist:**
- Single-action `WidgetInlineAction`
- `onAction`:
  1. Fetch user's default `follow_up` category template via `EmailTemplateService.fetchTemplates(companyId, { category: "follow_up", limit: 1 })`
  2. Resolve merge fields: `resolveMergeFields(template.body, { clientName: opp.contactName ?? opp.client?.name, projectTitle: opp.title, companyName: company.name })`
  3. Send via `POST /api/integrations/email/send` with `{ to: [opp.contactEmail], subject: resolveMergeFields(template.subject, ctx), body: resolvedBody, format: "markdown", opportunityId: opp.id }`
  4. Show `showWidgetActionToast({ label: "Follow-up sent to " + (opp.contactName ?? opp.client?.name), onUndo: undoHandler })`
  5. Undo: The undo handler is best-effort — we cannot unsend an email. Instead, undo creates a "sent in error" activity note on the opportunity. Toast label should reflect this: "Sent · Undo will log a note".

**Path B — Connection exists, no template:**
- Multi-action `WidgetInlineAction` (but we need a custom popover, not the default multi-action list)
- Instead: use a `Popover` directly (matching existing widget popover patterns)
- Popover content: 
  - `<textarea>` (3 rows, placeholder: "Quick follow-up message...")
  - Send button (`font-kosugi text-micro uppercase`)
  - Merge field hint below textarea: "Use {{client_name}}, {{project_title}}"
- On send: same flow as Path A but using the inline-composed body
- Close popover after send, show toast

**Path C — No connection:**
- Single-action `WidgetInlineAction`
- `onAction`: Show `showWidgetActionToast({ label: "Connect your email in Settings to send follow-ups", onUndo: () => {} })` — but use toast.info() instead (informational, no undo). Actually, use the toast `action` button with label "Settings" that calls `onNavigate("/settings/email")`.

**Prerequisites check:** The widget needs to know if a connection and template exist:
- `useEmailConnections()` from `src/lib/hooks/use-email-connections.ts` — check `data?.some(c => c.status === "active")`
- `useEmailTemplates()` from `src/lib/hooks/use-email-templates.ts` — filter client-side: `data?.find(t => t.category === "follow_up" && t.isActive)` to get the first active follow-up template
- `resolveMergeFields()` and `MergeFieldContext` from `src/lib/types/email-template.ts`
- Send endpoint: `POST /api/integrations/email/send` with JSON body `{ userId, companyId, connectionId, to, subject, body, format: "markdown", opportunityId }`
- Connection ID for sending: use the first active connection's `id` from the connections query

**Guard: No contact email.** If `opp.contactEmail` is null, the Follow Up button should be hidden (can't send an email without a recipient).

### 4.4 Props & Navigation

Current props: `{ size, config }` — the widget self-fetches via `useOpportunities()`. **Props stay the same** (no `onNavigate` — the call sites in `dashboard/page.tsx` and `widget-preview.tsx` pass only `size` + `config` and we cannot modify those files).

Navigation: use `useRouter()` from `next/navigation` internally. Define a local `navigate` helper:
```tsx
const router = useRouter();
const navigate = (path: string) => router.push(path);
```

Additional hooks needed: `useMoveOpportunityStage`, `useAuthStore`, `useReducedMotion`, `useWidgetIntersection`.

### 4.5 LG Specifics

- Max visible items: 7 (current) → increase to 10 with `WidgetMoreButton` for overflow
- Keep stage-grouped layout but replace raw divs with `WidgetLineItem`
- Stage group headers remain (color dot + stage name + count)

---

## 5. Booking Rate Widget (`booking-rate-widget.tsx`)

### 5.1 SM: WidgetBackgroundChart

Replace current SM layout (hero + inline sparkline + trend arrow) with `WidgetBackgroundChart`:

```tsx
<WidgetBackgroundChart
  chart={<Sparkline data={sparkData} width={containerWidth} height={containerHeight} color={WT.accent} />}
  opacity={0.25}
>
  {/* Hero count, title, trend arrow */}
</WidgetBackgroundChart>
```

- Sparkline fills entire widget background (use 100% width/height via a ref or fixed values matching SM widget dimensions)
- Remove the small inline `<Sparkline width={60} height={20}>` — the background chart replaces it
- Keep trend arrow and delta percentage overlay

### 5.2 MD: Hover Tooltips on Bar Chart

Add tooltip state and handlers to the bar chart:

```tsx
const [tooltip, setTooltip] = useState<{
  visible: boolean;
  x: number;
  y: number;
  month: string;
  count: number;
}>({ visible: false, x: 0, y: 0, month: "", count: 0 });
```

Each bar div gets:
- `onMouseEnter`: Calculate position relative to widget ref, set tooltip visible with month label + count
- `onMouseLeave`: Hide tooltip

Render `WidgetTooltip` + `TooltipRow` (from `shared/widget-tooltip`) above the bar chart:
```tsx
<WidgetTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} anchorRef={ref} anchor="above">
  <TooltipRow label={tooltip.month} value={`${tooltip.count}`} />
</WidgetTooltip>
```

### 5.3 i18n Keys

Add to `src/i18n/dictionaries/en/dashboard.json` under a clearly labeled section:

```json
"bookingRate.title": "Bookings",
"bookingRate.thisMonth": "This month",
"bookingRate.noProjects": "No projects yet",
"bookingRate.viewProjects": "View Projects"
```

### 5.4 Cleanup

- Replace hardcoded easing `cubic-bezier(0.16, 1, 0.3, 1)` with `WIDGET_EASE_CSS`

### 5.5 XS: No Changes

---

## Cross-Cutting Concerns

### Animation Easing

All 5 widgets currently use `cubic-bezier(0.16, 1, 0.3, 1)` in various inline styles. Replace ALL instances with `WIDGET_EASE_CSS` (`cubic-bezier(0.22, 1, 0.36, 1)`) from `widget-motion.ts`. This is the mandated easing curve.

### Reduced Motion

All new animations must check `useReducedMotion()`. When true:
- Skip entrance animations (render at final state)
- Transitions use `WIDGET_DURATION_FAST` (150ms) with linear easing, or `none`
- Sparklines render immediately (no draw animation)

### Shared Utility Usage

| Instead of | Use |
|------------|-----|
| Local `formatCurrency()` | `formatCompactCurrency` from `widget-utils.ts` |
| Hardcoded easing strings | `WIDGET_EASE_CSS` from `widget-motion.ts` |
| Custom row divs | `WidgetLineItem` from `shared/widget-line-item.tsx` |
| Inline `+N more` text | `WidgetMoreButton` from `shared/widget-more-button.tsx` |

### i18n

All new user-facing strings must be added to `src/i18n/dictionaries/en/dashboard.json`. Group new keys under clearly labeled comment sections:

```
// ── Pipeline Funnel (new keys) ──
// ── Win Rate (new keys) ──
// ── Lead Sources (new keys) ──
// ── Pipeline List (new keys) ──
// ── Booking Rate (new keys) ──
```

### Files Modified (5 only)

1. `src/components/dashboard/widgets/pipeline-funnel-widget.tsx`
2. `src/components/dashboard/widgets/win-rate-widget.tsx`
3. `src/components/dashboard/widgets/lead-sources-widget.tsx`
4. `src/components/dashboard/widgets/pipeline-list-widget.tsx`
5. `src/components/dashboard/widgets/booking-rate-widget.tsx`
6. `src/i18n/dictionaries/en/dashboard.json` (i18n keys only)

### Files NOT Modified

- `src/components/dashboard/widgets/shared/*` — all shared components used as-is
- `src/lib/widget-tokens.ts` — tokens used as-is
- `src/app/(dashboard)/page.tsx` — dashboard page untouched
