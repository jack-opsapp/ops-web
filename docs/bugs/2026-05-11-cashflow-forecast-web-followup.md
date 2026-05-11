# Cashflow Forecast — OPS-Web Follow-Up Required

**Date:** 2026-05-11
**Severity:** scoped follow-up — not a regression, not a current-day blocker
**Status:** open — needs separate plan + build pass

---

## Summary

A new **Cashflow Forecast** feature is being built iOS-first (spec at `/Users/jacksonsweet/Projects/OPS/docs/superpowers/specs/2026-05-11-cashflow-forecast-design.md`). It introduces a forward-looking running-balance projection with persistent dip-alert notifications. The data model and notification firing land in Supabase first (additive migrations + a Supabase-side recompute), so notifications **will fire on OPS-Web too** the moment the migrations apply — but the drill-in target does not yet exist on web.

This is logged so the OPS-Web team picks up the web build as a dedicated follow-up rather than letting it slip.

---

## What lands in shared infrastructure (web is affected)

The following migrate before the iOS feature ships and will be visible to OPS-Web users immediately:

1. **New table `recurring_expenses`** — owner-managed recurring outflows (rent, insurance, payroll, subscriptions). Schema: `id, company_id, name, amount, currency, cadence, next_due_date, end_date, category_id, created_by, created_at, updated_at, deleted_at`.
2. **New column `payment_milestones.expected_date`** — nullable date for forecasting milestone-driven inflows.
3. **New columns on `expense_settings`** (or a new `forecast_settings` row):
   - `forecast_low_water_threshold numeric(12,2)` default `5000`
   - `forecast_current_balance numeric(12,2)` nullable
   - `forecast_balance_updated_at timestamptz` nullable
4. **New table `forecast_alerts`** — anti-spam ledger for dip notifications (`company_id, last_dip_notified_at, last_dip_min_balance, last_cleared_at`).
5. **Persistent notification** of type `forecast_dip` fires into the `notifications` table whenever any week in the 13-week projection goes negative. Anti-spam rules: re-fire only if (a) >24h since last + min balance worsened by ≥10%, or (b) dip cleared.

OPS-Web users will see the `// CASH DIP PROJECTED` notification in their rail with no drill-in target. The notification's `action_url` will initially point to a placeholder web route (see Required Web Work, item 1).

---

## Required Web Work (separate plan)

### 1. Placeholder route — `/money/cashflow` (or wherever Books lives on web)
Render a simple "Cashflow Forecast is iPhone-only for now — open the OPS app to view your projection" panel. The notification `action_url` resolves to this. Lowest-effort, ships with the iOS feature.

### 2. Full web build — Cashflow Forecast on OPS-Web (the actual followup)
Mirror the iOS surface:
- **Card on the Books / Money dashboard** — running-balance sparkline, end-of-horizon number, lowest point, layer state badge.
- **Full forecast page** — 13-week running-balance line chart, week-by-week breakdown, layer toggles (Committed / Contracted / Pipeline / Recurring), 4w / 13w horizon zoom.
- **Drill-down** — per-week breakdown panel listing every contributing invoice / payment_milestone / recurring expense / opportunity. Each row links to the source entity.
- **Recurring expenses settings sheet** — CRUD on `recurring_expenses` for owners. Tax category picker (reuses existing `expense_categories`).
- **Current-balance update modal** — manual entry of `forecast_current_balance` with timestamp display ("AS OF [date]").
- **Notification deep-link target** — clicking the persistent dip notification opens the forecast page with the offending week pre-focused.

### Visual / brand
- Steel-blue `#6F94B0` for healthy state
- Tan/amber for low-water (sub-threshold) state — pull from existing earth-tone palette
- Brick `#93321A` for negative-projected dip state — entire chart shifts (line, fills, frame border, badge)
- Mohave / Cake Mono Light / JetBrains Mono per design system spec v2 — numbers always mono with tnum + slashed zero
- Single easing `cubic-bezier(0.22, 1, 0.36, 1)` for any color/state transitions; reduced-motion fallback is jump-cut

### Tech notes
- Read from same Supabase tables — no new web-side data layer needed
- Compute the projection in the browser (TypeScript port of the Swift `CashflowForecastEngine`) OR in a Supabase Edge Function called by web. Engine logic is small enough that browser-side is fine.
- TanStack Query hooks: `useCashflowForecast(companyId, settings)`, `useRecurringExpenses(companyId)`
- New widget in `src/components/dashboard/widgets/` for the card

### Out of scope for this followup
- Per-invoice late-payer override slider (still v2)
- Per-client days-to-payment learning (still v2)
- Auto-detection of recurring patterns (still v2)

---

## References

- iOS design spec: `/Users/jacksonsweet/Projects/OPS/docs/superpowers/specs/2026-05-11-cashflow-forecast-design.md`
- Bible section that lands with the iOS work: `ops-software-bible/09_FINANCIAL_SYSTEM.md` § Cashflow Forecast
- Persistent notification pattern reference: `ops-software-bible/07_SPECIALIZED_FEATURES.md` § 14
- Brand tokens for chart states: `ops-design-system/project/colors_and_type.css` (steel-blue, amber, brick)

---

## Owner

Unassigned. Pick up when iOS forecast feature merges and the Supabase migrations apply to production. Until then the placeholder route is the only required web work.
