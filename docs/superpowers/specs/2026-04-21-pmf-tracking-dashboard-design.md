# PMF Tracking Dashboard — Design Spec

**Date:** 2026-04-21
**Target:** `ops-web` admin, new route `/admin/pmf`
**Gate date:** 2026-09-01 (133 days out)
**Build approach:** one-shot ship end of Month 1 (no phased releases)
**Visual foundation:** OPS Design System v2 (2026-04-17), applied scoped to `/admin/pmf/**`

**Outline**
1. Purpose · 2. Users · 3. Architecture · 4. Data Model · 5. Gate B Marker Computation · 6. Leading Indicators · 7. UI Specification · 8. Notification Layer · 9. Design System v2 Integration · 10. External Integrations · 11. Cross-cutting concerns · 12. Testing · 13. Environment & Secrets · 14. Rollout · 15. Open questions / assumptions · 16. Success criteria

---

## 1. Purpose

A single-screen PMF tracking deck that, on 2026-09-01, answers one question in under five seconds: **is Gate B pass or fail?** Three or four green markers → Path 4. Zero, one, or two → Path 2a. No interpretation, no spreadsheet, no rationalization.

Secondary purpose: surface leading indicators weekly so the operator can adjust mid-sprint instead of discovering the gate has already failed. Tertiary: capture clean cohort and CAC data as a permanent artifact — valuable whether Path 4 or Path 2a wins.

**Non-goals.** Full CRM replacement. Customer-facing analytics. Marketing-site dashboard. Time tracking (Indicator F is skipped in v1).

---

## 2. Users

Single operator (the founder). Admin-gated. Alerts fire to one phone (+1 250 538 8994) and one email (canprojack@gmail.com). Other admins can view the dashboard via the existing `admins`-table gate but don't receive notifications.

---

## 3. Architecture

### 3.1 Route layout

```
/admin/pmf                         — dashboard (Gate B row + indicator row + pipeline + MRR trend)
/admin/pmf/marker/[id]             — detail drill-in per Gate B marker (cohort tables, history)
/admin/pmf/indicator/[id]          — detail drill-in per indicator (12-week trend, cohort table)
/admin/pmf/prospects                — Tier A + base SaaS prospect list, filters, bulk actions
/admin/pmf/prospects/new           — create prospect form
/admin/pmf/prospects/[id]          — prospect detail + deal editor
/admin/pmf/ad-spend                 — manual spend entry form
```

### 3.2 Layers

| Layer | Location | Notes |
|---|---|---|
| UI | `src/app/admin/pmf/**` | Next.js Server Components where possible; client only for Kanban drag, forms, filters |
| Query | `src/lib/admin/pmf-queries.ts` | Mirrors existing `admin-queries.ts` pattern (`unstable_cache`, tagged revalidation). All metric logic lives here. |
| Persistence | new Supabase tables (§4) + existing `companies` | RLS: `admins`-only read/write |
| External ingest | `/api/stripe/webhook`, `/api/cron/pmf/google-ads-sync`, manual forms | Stripe webhook new; Google Ads client already exists |
| Notifications | `/api/cron/pmf/*` crons + `src/lib/notifications/{twilio,sendgrid}.ts` | Three Vercel cron schedules |

### 3.3 Auth

Existing admin gate (`src/app/admin/layout.tsx`): Firebase token → `isAdminEmail()` check against `admins` table. `/admin/pmf/**` inherits this gate via nested layout. No additional gating.

---

## 4. Data Model

All tables under schema `public`, RLS `admins`-only. One migration file: `supabase/migrations/YYYYMMDDHHMM_pmf_tracking.sql`.

### 4.1 `pmf_prospects`

```sql
create table pmf_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  source text not null check (source in (
    'outbound_cold','warm_network','paid_ad','organic_search','referral','direct'
  )),
  referred_by_company_id uuid references companies(id),
  deal_type text not null check (deal_type in ('tier_a','base_saas')),
  first_contact_at timestamptz not null,
  first_contact_direction text not null check (first_contact_direction in ('inbound','outbound')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on pmf_prospects (deal_type, first_contact_at);
create index on pmf_prospects (source);
```

### 4.2 `pmf_deals`

```sql
create table pmf_deals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references pmf_prospects(id) on delete cascade,
  stage text not null check (stage in (
    'contacted','qualified','proposal','negotiation','signed','in_delivery','delivered','closed_won','closed_lost'
  )),
  stage_entered_at timestamptz not null default now(),
  deal_type text not null check (deal_type in ('tier_a','base_saas')),
  sow_signed_at timestamptz,
  sow_url text,
  implementation_fee_cents bigint,
  deposit_paid_at timestamptz,
  deposit_amount_cents bigint,
  final_paid_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz,
  closed_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on pmf_deals (prospect_id);
create index on pmf_deals (stage, deal_type);
```

### 4.3 `pmf_deal_events`

```sql
create table pmf_deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references pmf_deals(id) on delete cascade,
  event_type text not null check (event_type in (
    'stage_change','note','sow_signed','payment_received','delivered','closed'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz default now()
);
create index on pmf_deal_events (deal_id, occurred_at desc);
```

Trigger: on `pmf_deals` update, insert corresponding event row with before/after `stage` in `payload` for `stage_change` events, etc. This table is the audit log and powers the "days from first contact to close" metric.

### 4.4 `billing_events`

```sql
create table billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  stripe_customer_id text,
  company_id uuid references companies(id),
  amount_cents bigint,
  currency text default 'usd',
  occurred_at timestamptz not null,
  received_at timestamptz default now(),
  raw jsonb not null
);
create index on billing_events (stripe_customer_id, occurred_at desc);
create index on billing_events (company_id, event_type, occurred_at desc);
create index on billing_events (event_type, occurred_at desc);
```

Handled events:
- `invoice.paid`, `invoice.payment_failed`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `charge.refunded`, `charge.dispute.created`

Idempotency enforced via `unique(stripe_event_id)`. Webhook signature verified with `STRIPE_WEBHOOK_SECRET`.

### 4.5 `ad_spend_log`

```sql
create table ad_spend_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('google_ads','meta_ads','apple_search_ads','other')),
  spend_date date not null,
  spend_cents bigint not null check (spend_cents >= 0),
  impressions bigint,
  clicks bigint,
  downloads bigint,
  source text not null check (source in ('auto_sync','manual_entry')),
  entered_by text,
  created_at timestamptz default now(),
  unique (channel, spend_date)
);
create index on ad_spend_log (spend_date);
```

Daily Google Ads sync upserts. Manual form upserts monthly totals split evenly across the month's days.

### 4.6 `trial_attributions`

```sql
create table trial_attributions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) unique,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  gclid text,
  fbclid text,
  landing_url text,
  trial_started_at timestamptz not null,
  first_paid_at timestamptz,
  attributed_channel text not null default 'unknown',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on trial_attributions (attributed_channel, first_paid_at);
create index on trial_attributions (trial_started_at);
```

One row per company, written at trial start. `first_paid_at` set by a trigger that fires on `billing_events` insert where `event_type='invoice.paid'` — updates the `trial_attributions` row for the matching `company_id` with the event's `occurred_at` if `first_paid_at IS NULL`.

### 4.7 `pmf_threshold_snapshots`

```sql
create table pmf_threshold_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz default now(),
  state jsonb not null
);
create index on pmf_threshold_snapshots (captured_at desc);
```

A rolling capture of the computed state of all 4 markers + 5 indicators. Every `threshold-check` cron run inserts one row with `state = {marker_1:{status,value}, ..., indicator_e:{...}}`. The alert-diff logic compares the newest row against the second-newest. Rows older than 30 days are pruned by a daily cleanup cron.

### 4.8 `pmf_notification_log`

```sql
create table pmf_notification_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('threshold_alert','daily_digest','weekly_digest')),
  trigger text not null,
  channel text not null check (channel in ('sms','email')),
  recipient text not null,
  payload jsonb not null,
  sent_at timestamptz,
  error text,
  created_at timestamptz default now()
);
create index on pmf_notification_log (kind, trigger, created_at desc);
```

Dedup logic: before sending a threshold alert, check for an existing row with same `trigger` in the last 4 hours — skip if present. Digests never dedup (daily/weekly are expected to fire on schedule regardless).

### 4.9 Materialized state (computed in TypeScript)

No Postgres materialized view — every cron run calls `computePmfState()` in `src/lib/admin/pmf-queries.ts`, which returns `{ markers: {1,2,3,4}, indicators: {A,B,C,D,E} }` by running the individual metric queries in parallel. The result is written to `pmf_threshold_snapshots.state`. This keeps marker logic in one place (TypeScript) rather than split between SQL functions and application code.

The threshold cron diffs `snapshots[0].state` against `snapshots[1].state`, identifies transitions, and emits alerts.

---

## 5. Gate B Marker Computation

All formulas implemented as Postgres functions + TypeScript fallbacks in `pmf-queries.ts`.

### 5.1 Marker 1 — Tier A engagements paid & delivered (target: ≥2)

```sql
select count(*) from pmf_deals
where deal_type = 'tier_a'
  and stage in ('in_delivery','delivered','closed_won')
  and deposit_paid_at is not null
  and deposit_amount_cents >= (implementation_fee_cents * 0.5);
```

**Status:** green ≥2, amber =1, red =0.
**Card supplementary:** for each qualifying deal, days-from-first-contact-to-close (from `pmf_deal_events` `stage_change` to `closed_won`).

### 5.2 Marker 2 — Retained base SaaS customers (target: ≥5)

The user spec: *"a customer counts once they have paid for 2 consecutive months… has been on a paid plan for 60+ days and is still active on day 60."*

Canonical definition, enforced in SQL:

1. Company has a first `invoice.paid` event ≥60 days ago, AND
2. Company has `invoice.paid` events in at least two distinct calendar months AND those months are consecutive (month N and month N+1), AND
3. Company has no `customer.subscription.deleted` event after its most recent `invoice.paid`, AND
4. Company's most recent `invoice.paid` is within the last 40 days (catches annual billing with a buffer; a company that paid once 60 days ago and once 31 days ago qualifies).

```sql
with paid as (
  select company_id,
         occurred_at,
         date_trunc('month', occurred_at) as paid_month
  from billing_events
  where event_type = 'invoice.paid' and company_id is not null
),
agg as (
  select company_id,
         min(occurred_at) as first_paid_at,
         max(occurred_at) as last_paid_at,
         array_agg(distinct paid_month order by paid_month) as months
  from paid
  group by company_id
),
consecutive as (
  select a.company_id, a.first_paid_at, a.last_paid_at
  from agg a
  where a.first_paid_at <= now() - interval '60 days'
    and a.last_paid_at  >= now() - interval '40 days'
    and exists (
      select 1 from unnest(a.months) with ordinality as m(month, idx)
      join unnest(a.months) with ordinality as n(month, idx)
        on n.idx = m.idx + 1
       and n.month = m.month + interval '1 month'
    )
    and not exists (
      select 1 from billing_events b
      where b.company_id = a.company_id
        and b.event_type = 'customer.subscription.deleted'
        and b.occurred_at > a.last_paid_at
    )
)
select count(*) from consecutive;
```

**Status:** green ≥5, amber 3-4, red ≤2.
**Drill-in** (`/admin/pmf/marker/2`): cohort retention table — rows are month-of-first-paid, columns are 30/60/90-day retention %.

### 5.3 Marker 3 — Inbound lead (target: ≥1)

```sql
select count(*) from pmf_prospects
where first_contact_direction = 'inbound'
   or source in ('paid_ad','organic_search','referral','direct');
```

**Status:** green ≥1, red =0. Binary.
**Drill-in:** list of inbound prospects with source, first-contact date, current deal stage.

### 5.4 Marker 4 — CAC data from ≥$15K spend (target: ≥$15K + ≥5 paid attributions)

```sql
with spend as (
  select sum(spend_cents) as cum_cents from ad_spend_log
),
paid as (
  select count(*) as n from trial_attributions where first_paid_at is not null
)
select
  spend.cum_cents / 100.0 as cumulative_spend_usd,
  paid.n as attributed_paid,
  case when paid.n > 0 then spend.cum_cents / paid.n / 100.0 else null end as blended_cac_usd
from spend, paid;
```

**Status:** green when `cumulative_spend_usd ≥ 15000 AND attributed_paid ≥ 5`. Amber at ≥75% of either axis. Red below.
**Card supplementary:** 5-month trend line of cumulative spend vs. target $15K.

---

## 6. Leading Indicators

All return `{ value: number, delta_wow: number, sparkline: number[12], status: 'green'|'amber'|'red' }`.

| ID | Name | Formula | Healthy |
|---|---|---|---|
| A | Active Tier A Pipeline | count(deals where type='tier_a' and stage in (contacted,qualified,proposal,negotiation)) | 5-8 green, 3-4 amber, <3 red, >10 amber |
| B | Weekly new trials | count(distinct company_id) from trial_attributions where trial_started_at in last 7 days | 40-100 green, 30-39 amber, <30 red, >100 amber |
| C | Trial→paid conversion | For most recent mature trial cohort (≥30d elapsed): paid / total | 5-10% green, <4% red |
| D | Monthly cohort churn | For most recent mature cohort: churned_count / cohort_size | 4-7% green, >10% red |
| E | Referral signal | count(pmf_prospects where source='referral') | non-zero by week 12 = strong |

Indicator F (weekly sprint hours) **not in v1**.

---

## 7. UI Specification

### 7.1 Page layout

Canvas `#000000`, padding `36px 44px`, max-width `1320px`, panel gap `24px`.

**Hero strip (fixed top):**
```
// PMF TRACKING DECK                     [GATE B · 133 DAYS]
```
- Left: `t-page-title` (Cake Mono 22px)
- Right: countdown chip, `t-metadata` in brackets; color `text-3` by default → `tan` at <30 days → `rose` at <7 days

**Row 1 — Gate B Primary Markers:**
- Section header `// GATE B · PRIMARY MARKERS` + right-aligned count `[N/4 ON TARGET]`
- Four marker cards, equal width, 12-column grid spanning 3 each
- Card: `.glass-surface`, radius 5px, padding 24px
  - Title: `// TIER A ENGAGEMENTS` — `t-section` Cake Mono 14px
  - Hero number: `1 / 2` — Mohave 300 80px tabular slashed-zero, right-aligned with target in `text-3`
  - Progress indicator: `●●○○` filled dots, 6px, `olive`/`tan`/`rose`
  - Footer line: `[AMBER · 50% OF TARGET]`
  - Status dot: 6px absolute top-right

**Row 2 — Leading Indicators:**
- Section header `// LEADING INDICATORS` + right-aligned `[WEEK 3 OF 18]`
- Five compact cards, equal width ~140px
  - Label: `// A · ACTIVE TIER A` — `t-panel-title`
  - Value: `5` — `t-data-lg` mono 20px tabular
  - Delta arrow + WoW: `↑ +2 WOW` — mono 11px, olive/rose/text-3
  - Inline sparkline: 100×20px, hairline stroke, `text-3`
  - Status dot: 6px

**Row 3 — Pipeline + MRR:**
- Left 60%: Tier A Pipeline Kanban (details §7.2)
- Right 40%: Base SaaS MRR line chart — 18-week Recharts line, actual in `text`, $15K burn line hairline `text-mute`

### 7.2 Tier A Pipeline Kanban

- 6 visible columns: `[CONTACTED]` `[QUALIFIED]` `[PROPOSAL]` `[NEGOTIATION]` `[SIGNED]` `[DELIVERED]`. Lost → collapsible drawer footer.
- Column header: Cake Mono 14px name + mono 11px bracket count
- Prospect card inside:
  - Company name — Mohave 500 13px, sentence case
  - Subtitle — days-in-stage + source — `t-metadata`
  - Source tag (right-aligned, `.tag` variants):
    - `referral` → `.tag-olive` (inbound, warmest)
    - `organic_search`, `direct` → `.tag-olive`
    - `paid_ad` → `.tag-tan` (inbound but paid-acquired)
    - `warm_network`, `outbound_cold` → default `.tag` (neutral, outbound)
- Drag-and-drop via `@dnd-kit/core`, easing `cubic-bezier(0.22, 1, 0.36, 1)`, duration 200ms, no bounce, spring disabled
- Click card → right-side sheet opens with full prospect + deal editor
- Drop on column → updates `pmf_deals.stage` + triggers inserts `pmf_deal_events`

### 7.3 New Prospect form

- Primary CTA button top-right: `NEW PROSPECT` — `.btn-primary` (outlined steel blue, fills on hover)
- Modal: `.glass-dense`, radius 5px
- Fields: name, company, email, phone, deal_type (tier_a/base_saas), source (dropdown), first_contact_direction (inbound/outbound), first_contact_at (datetime), notes
- Validation: zod schemas in `src/lib/pmf/schemas.ts`
- Submit → inserts `pmf_prospects` + a `pmf_deals` row at stage=contacted + emits `pmf_deal_events` note

### 7.4 Drill-in pages

Each of the 4 markers and 5 indicators has a detail page linked from its card. Detail page shows: historical trend (18-week line), relevant cohort table, raw data table with export button. Navigation via breadcrumbs.

### 7.5 Design system application

See §9 for file layout. Summary:

- Tokens from bundle's `colors_and_type.css` ported to `src/styles/pmf-tokens.css`, scoped via `.pmf-scope` wrapper
- `/admin/pmf/layout.tsx` applies `className="pmf-scope"` to its children container
- Cake Mono loaded via `next/font/local` in the PMF layout — not root — so non-PMF pages don't pull it
- Brand mark rendered as `<OpsMark />` React component using `currentColor`, 16px default
- All numbers mono tabular slashed-zero — enforced via `.font-mono` class with `font-feature-settings: "tnum" 1, "zero" 1`
- All titles uppercase Cake Mono — pseudo via `t-*` classes, never raw `text-transform: uppercase`
- All prefixes: `//` before section headers, `[]` around micro-text, `SYS::` for system lines
- No emoji, no shadows, no bounce, no spring

### 7.6 States

- **Empty:** hero value `—`, status dot `text-mute`, card body blank, no illustrations
- **Loading:** skeleton shimmer 150ms opacity, `.glass-subtle` fill
- **Error:** `// ERROR — <THING>` in `rose`, retry `.btn-ghost`
- **Reduced motion:** all animations → 150ms opacity only (`@media (prefers-reduced-motion)`)
- **Mobile / tablet:** admin is desktop-first; gracefully stacks at <768px — Gate B row becomes 2×2 grid, indicators wrap, Kanban becomes horizontal scroll

### 7.7 Copy

| Wrong | Right |
|---|---|
| Welcome to PMF tracking | `// PMF TRACKING DECK` |
| 133 days until Gate B | `[GATE B · 133 DAYS]` |
| 1 of 2 Tier A deals closed | `1 / 2` hero + `[AMBER · 50% OF TARGET]` footer |
| You have 3 new inbound leads | `3 INBOUND` |
| Loading… | skeleton (no text) |
| Oops! Something went wrong. | `// ERROR — SYNC FAILED` |
| No prospects yet! Add your first. | `—` + `NEW PROSPECT` button |
| Congratulations, Marker 2 passed! | `SYS :: MARKER 2 GREEN · 08:42` |

---

## 8. Notification Layer

### 8.1 Cron schedule (`vercel.json`)

```json
{
  "crons": [
    { "path": "/api/cron/pmf/daily-digest",       "schedule": "0 15 * * *" },
    { "path": "/api/cron/pmf/weekly-digest",      "schedule": "0 15 * * 1" },
    { "path": "/api/cron/pmf/threshold-check",    "schedule": "*/15 * * * *" },
    { "path": "/api/cron/pmf/google-ads-sync",    "schedule": "0 14 * * *" }
  ]
}
```

All times UTC. Daily digest fires 7am PST. Weekly 7am PST Monday. Google Ads sync runs 6am PST daily.

### 8.2 Threshold triggers

Fire an alert (SMS + email + in-app) when any of the following is true AND the same trigger hasn't fired in the last 4 hours:

| # | Condition | Message stem | Priority |
|---|---|---|---|
| 1 | Gate B marker transitions any → `green` | `MARKER <N> GREEN` | high |
| 2 | Gate B marker transitions `green` → `amber` or `amber` → `red` or `green` → `red` | `MARKER <N> <NEW>` | high |
| 3 | `pmf_prospects` insert with `first_contact_direction='inbound'` | `NEW INBOUND LEAD` | high |
| 4 | Indicator A value drops below 3 (red threshold) | `TIER A PIPELINE CRITICAL` | high |
| 5 | Indicator D value exceeds 10% | `CHURN SPIKE` | high |
| 6 | Indicator B drops below 30/week | `TRIAL FLOW BELOW TARGET` | medium |
| 7 | Indicator C cohort drops below 4% | `CONVERSION BELOW TARGET` | medium |
| 8 | `billing_events` insert with `event_type='charge.refunded'` | `REFUND` | high |
| 9 | Indicator E first non-zero referral | `FIRST REFERRAL` | high |

All are computed by the `threshold-check` cron from the diff between the two newest `pmf_threshold_snapshots` rows (for marker/indicator transitions), or by reacting to recent inserts in `pmf_prospects` / `billing_events` within the last 15 minutes (for event-driven triggers).

Direction matters for markers: `any → green` and `better → worse` both alert; `worse → better (but not green)` does not (too noisy — a bounce from red to amber isn't worth a page).

State comparison: `threshold-check` cron refreshes `pmf_marker_state` materialized view, then diffs current vs. last-known values stored from the prior `threshold-check` run (persisted in a small `pmf_threshold_snapshots` table).

### 8.3 Transport

Every threshold trigger fires on **three** channels: SMS, email, and in-app notification rail. Digests fire on email only (SMS/in-app would be too noisy for the daily and weekly summaries).

**Twilio (SMS)**
- New module: `src/lib/notifications/twilio.ts`
- Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- Destination: `+12505388994` (env `PMF_NOTIFICATION_SMS`)
- Message shape: `OPS :: <EVENT> · <DETAIL> · <HH:MM>`, max 320 chars
- Examples:
  - `OPS :: MARKER 1 GREEN · TIER A 2/2 · 08:42`
  - `OPS :: NEW INBOUND LEAD · ACME ROOFING · 14:09`
  - `OPS :: INDICATOR A RED · ACTIVE TIER A 2/5 · 09:00`
  - `OPS :: REFUND $199 · HUDSON PLUMBING · 11:33`

**SendGrid (email)**
- Reuses existing client
- Destination: `canprojack@gmail.com`
- Templates in `src/emails/pmf/` as React Email components:
  - `pmf-threshold-alert.tsx` — single-event alert
  - `pmf-daily-digest.tsx` — all 10 metrics + countdown + new activity since last digest
  - `pmf-weekly-digest.tsx` — daily digest contents + cohort tables + narrative summary
- Visual: dark canvas `#000`, glass surfaces, Cake Mono page title, earth-tone status dots, all copy per §7.7

**In-app notification rail (existing system)**
- Reuses the `notifications` table and `NotificationService` pattern documented in `ops-web/CLAUDE.md`
- Inserts `{ user_id: <admin user id>, type: 'pmf_alert', title: <tactical>, body: <detail>, persistent: false, action_url: '/admin/pmf', action_label: 'VIEW DECK' }`
- `user_id` resolved from the operator's email `canprojack@gmail.com` → `users` table lookup at send time
- Targets only the operator; other admins don't get pinged
- Visible in the TopBar notification rail for fast triage without leaving the current page

### 8.4 Logging

Every send logged to `pmf_notification_log` with `sent_at`, `error` (null on success). Retries on transient failures: 3 attempts with exponential backoff (1s, 5s, 25s).

---

## 9. Design System v2 Integration

### 9.1 Files added

Cake Mono is already loaded globally in ops-web via Adobe Typekit (kit `dbh0pet`, family `cake-mono`, weights 300/400/700). We do **not** copy the bundle's woff files into `public/fonts/` — the Typekit load is the source of truth and already covers all three weights. PMF dashboard just consumes `font-cakemono font-light`.

```
public/brand/ops-mark.svg
public/brand/ops-lockup.svg

src/styles/pmf-tokens.css           ← adapted from bundle colors_and_type.css, scoped via .pmf-scope
src/app/admin/pmf/layout.tsx        ← imports pmf-tokens.css, applies .pmf-scope wrapper
src/components/pmf/ui/
  button.tsx
  card.tsx
  tag.tsx
  status-dot.tsx
  slash-header.tsx
  progress-dots.tsx
  sparkline.tsx
  kbd.tsx
  ops-mark.tsx
  hero-number.tsx
  countdown-chip.tsx
src/components/pmf/
  marker-card.tsx
  indicator-card.tsx
  pipeline-kanban.tsx
  prospect-card.tsx
  prospect-sheet.tsx
  mrr-trend-chart.tsx
  new-prospect-modal.tsx
  ad-spend-form.tsx
src/lib/admin/pmf-queries.ts
src/lib/pmf/
  schemas.ts
  attribution.ts
  marker-compute.ts
  threshold-diff.ts
src/lib/notifications/
  twilio.ts
  pmf-recipients.ts
  pmf-templates.ts
src/emails/pmf/
  pmf-threshold-alert.tsx
  pmf-daily-digest.tsx
  pmf-weekly-digest.tsx
```

### 9.2 Token scoping

Bundle's `colors_and_type.css` is the source. Ported to `src/styles/pmf-tokens.css` with these adaptations:
- All `:root` CSS variables wrapped in `:where(.pmf-scope) { ... }` so they don't leak into existing admin globals
- `@font-face` declarations point to `/fonts/CakeMono-*.woff2` paths
- All utility classes (`.glass-surface`, `.btn`, `.tag`, `.input`, `.kbd`, `.t-*`) defined within the scope

Existing ops-web global tokens (`#6F94B0` accent, `#C4A868` amber, etc.) are NOT modified. PMF dashboard runs on the new scoped layer.

### 9.3 Font loading

No new font loading code. Cake Mono, Mohave, and JetBrains Mono are already loaded globally in ops-web (Cake Mono via Adobe Typekit `dbh0pet`, others via Google Fonts). The PMF dashboard consumes the existing font stack with:
- `font-mohave` — body, hero numbers
- `font-mono` — all numerical data, tactical brackets, `//` prefixes
- `font-cakemono font-light` — uppercase display voice (page titles, section headers, buttons, badges)

Weight `font-light` (300) is required for Cake Mono per repo convention; Regular (400) and Bold (700) are never used in product UI.

### 9.4 Accent color — divergence from existing admin

Existing ops-web admin uses accent `#6F94B0`. The v2 design bundle specifies `#6F94B0` (a brighter steel blue). The bundle is the newer source of truth and the user explicitly requested it for the PMF dashboard. Resolution:
- PMF dashboard uses `#6F94B0` inside the `.pmf-scope` wrapper
- Non-PMF admin pages keep `#6F94B0` (no global change)
- Document the divergence in `ops-web/CLAUDE.md` so the next contributor understands why two accents exist

### 9.5 Tailwind additions

Scoped via `.pmf-scope` descendant selectors in `src/styles/pmf-tokens.css`. No changes to `tailwind.config.ts` for the token palette — all PMF-specific color use goes through CSS variables (`var(--ops-accent)`, `var(--olive)`, etc.) consumed via Tailwind's arbitrary value syntax where needed: `bg-[var(--ops-accent)]`. This avoids polluting the global Tailwind theme.

Exception: `pmf-scope` itself is registered as a Tailwind `@layer components` rule so `className="pmf-scope"` is recognized.

---

## 10. External Integrations

### 10.1 Stripe webhook

- Route: `src/app/api/stripe/webhook/route.ts` (new)
- Verifies signature via `STRIPE_WEBHOOK_SECRET`
- Handles event types in §4.4
- Upserts into `billing_events` keyed by `stripe_event_id` (idempotent)
- Resolves `company_id` from `stripe_customer_id` via lookup against `companies.stripe_customer_id`

Configure webhook endpoint in Stripe dashboard; document in `ops-web/docs/integrations/stripe-pmf-webhook.md`.

### 10.2 Google Ads sync

- Cron: `/api/cron/pmf/google-ads-sync` (6am PST daily)
- Reuses existing `src/lib/analytics/google-ads-client.ts`
- Pulls prior day's `spend_cents`, `impressions`, `clicks` (downloads attribution separate via UTM)
- Upserts `ad_spend_log` with `source='auto_sync'` keyed on `(channel='google_ads', spend_date)`

### 10.3 UTM capture at trial start

- Client-side: on first landing-page load, capture `utm_*` + `gclid` + `fbclid` from `searchParams` + `document.referrer` into cookie `__ops_first_touch` (30-day TTL, HttpOnly=false, SameSite=Lax)
- Server-side: existing trial-signup handler (`src/app/api/trials/create/route.ts` or equivalent — confirm location during exploration) reads cookie, inserts `trial_attributions` row
- Attribution channel derived at insert time via rules in `src/lib/pmf/attribution.ts`

---

---

## 11. Cross-cutting concerns

### 11.1 Motion implementation

Framer Motion (already in ops-web deps) is the animation tool. Reuse existing variants from `src/lib/utils/motion.ts` where they match. New PMF-specific motion:

| Element | Motion | Duration | Easing |
|---|---|---|---|
| Page enter | opacity 0→1 + translateY 8px→0 | 250ms | `[0.22, 1, 0.36, 1]` |
| Card stagger (Gate B row) | each card delayed by 50ms | 200ms | `[0.22, 1, 0.36, 1]` |
| Hero number count-up | tweened value, Mohave 300 | 800ms | `[0.22, 1, 0.36, 1]` |
| Status-dot color change | background-color transition | 150ms | linear |
| Sparkline path draw | `pathLength` 0→1 (Motion) | 600ms | `[0.22, 1, 0.36, 1]` |
| Kanban card drag | `dnd-kit` default, overridden to match easing | 200ms | `[0.22, 1, 0.36, 1]` |
| Modal / sheet open | opacity + scale 0.98→1 | 200ms | `[0.22, 1, 0.36, 1]` |

**No spring. No bounce. No elastic.** Single easing curve `cubic-bezier(0.22, 1, 0.36, 1)` everywhere. `useReducedMotion()` short-circuits all of the above to a plain 150ms opacity transition.

### 11.2 Z-index

Per the scale in `ops-web/CLAUDE.md`:
- Dashboard content → `base` (0)
- Dropdowns, autocomplete → `1000`
- New prospect modal / side sheet → `3000` (portaled Radix)
- Notification toasts (existing) → untouched

No new z-index layers introduced.

### 11.3 i18n

The admin dashboard is internal-only and English-only in practice. Per ops-web convention, user-facing strings should be in dictionaries. PMF dashboard strings will land in `src/i18n/dictionaries/en/pmf.json` (English only, no Spanish translation in v1). Tactical copy (`// PMF TRACKING DECK`, `[GATE B · 133 DAYS]`, `SYS :: ...`) is not translated — by design, the tactical voice is English-specific.

### 11.4 Accessibility

- All status dots have `role="img"` with `aria-label="Status: green / amber / red"`
- Kanban: full keyboard navigation via `@dnd-kit/accessibility` — Tab to focus card, Space to grab, arrow keys to move, Space to drop, Escape to cancel. Announced via `aria-live` region.
- Hero numbers: render the numeric value in a `<span>` with `aria-label="1 of 2 Tier A engagements closed"` alongside the visual glyph
- Color is never the sole carrier of information — every status dot is paired with a text label
- Focus ring: 1.5px `#6F94B0` outline, 2px offset from `#000` — present on every interactive element
- Reduced motion: all animations fall back to 150ms opacity transitions

### 11.5 Performance

- All page loads are Server Components where possible; client components only where interactivity is required
- `pmf-queries.ts` uses `unstable_cache` with 60-second TTL per query and tag-based revalidation on mutations (same pattern as `admin-queries.ts`)
- Materialized `pmf_threshold_snapshots` insert every 15 min means 96 rows/day, ~35K rows/year — cleanup cron prunes rows older than 30 days
- Recharts line/sparkline charts use `ResponsiveContainer` with debounced resize
- Stripe webhook: respond within 1s with `200`, then process async via `waitUntil()` (Vercel's background task API) to avoid webhook retries

### 11.6 Timezone handling

- All Postgres columns are `timestamptz`; always stored UTC
- All display formatting via `formatInTimeZone(date, 'America/Vancouver', pattern)` using `date-fns-tz` (install if not present) — operator is in Pacific time
- Countdown to Gate B computed against `2026-09-01T00:00:00-07:00` (PDT on that date)
- Cron `schedule` values in `vercel.json` are UTC; annotated with the PST equivalent in comments

### 11.7 Data privacy

- `billing_events.raw` stores the full Stripe payload which may contain PII (email, card last-4). Access to this table is `admins`-only via RLS; no API route exposes it raw.
- Twilio/SendGrid transports receive only tactical summary text — no card numbers, no full customer records
- `pmf_notification_log.payload` stores the rendered message only — not the source data

---

## 12. Testing

### 11.1 Unit (Vitest)

- `src/lib/pmf/marker-compute.test.ts` — 4 markers × healthy/amber/red fixture cases
- `src/lib/pmf/attribution.test.ts` — all 7 attribution channels + edge cases (both gclid + utm_source, conflicting values)
- `src/lib/pmf/threshold-diff.test.ts` — state-change detection, dedup window
- `src/lib/notifications/pmf-templates.test.ts` — snapshot tests on email HTML + SMS string shapes

### 11.2 Integration

- `tests/integration/stripe-webhook.test.ts` — mock Stripe signatures, POST to webhook, assert `billing_events` insert + idempotency on replay
- `tests/integration/pmf-queries.test.ts` — seeded Supabase DB, assert each marker query
- `tests/integration/notifications.test.ts` — mock Twilio + SendGrid, assert correct payload routing per trigger type

### 11.3 E2E (Playwright)

- `tests/e2e/pmf-dashboard.spec.ts` — admin auth gate; dashboard loads; Gate B cards render
- `tests/e2e/pmf-prospect-crud.spec.ts` — create prospect; appears in Kanban; drag stage; event logged
- `tests/e2e/pmf-ad-spend.spec.ts` — manual spend form upsert semantics

### 11.4 Manual QA checklist (in plan)

- Design system audit (`audit-design-system`) — zero hardcoded tokens in new code
- September-1 countdown color transitions at 30d / 7d thresholds
- Every indicator status dot transition (green ↔ amber ↔ red) against fixture data
- Reduced-motion: all animations fall back to 150ms opacity
- Mobile / tablet: Gate B 2×2, indicators wrap, Kanban horizontal scroll
- Cake Mono loaded only on `/admin/pmf/**` (check network tab on `/admin/`)
- Notification dedup: same trigger within 4 hours fires once
- Weekly digest narrative summary renders readable email on dark background

---

## 13. Environment & Secrets

New env vars (documented in `.env.example`):
```
STRIPE_WEBHOOK_SECRET=whsec_...
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_FROM_NUMBER=+1...
PMF_NOTIFICATION_SMS=+12505388994
PMF_NOTIFICATION_EMAIL=canprojack@gmail.com
```

Recipient env vars used instead of hardcoding — easier to add a second recipient later without a deploy.

---

## 14. Rollout

Approach B (single-shot). No phased launch. All work lands on a single feature branch, single PR.

**Pre-merge checklist:**
- All tests pass (unit + integration + E2E)
- Design system audit clean
- Manual QA checklist complete
- Supabase migration tested on a staging branch
- Stripe webhook tested against Stripe CLI local forwarding
- Twilio test SMS sent successfully
- SendGrid test email renders on Gmail dark mode

**Post-merge, first-hour checks:**
- Cron schedules registered in Vercel
- First threshold-check cron run logs successfully
- Daily digest cron manually triggered once, email received
- Stripe webhook registered and ping-tested

---

## 15. Open questions / assumptions

| Assumption | Impact if wrong |
|---|---|
| Existing trial-signup handler can be modified to write `trial_attributions` | If no trial handler exists yet, attribution capture fails — need to identify or build one |
| Stripe is already connected to production `companies` via `stripe_customer_id` | If not, retention cohort is empty until customers are re-linked |
| Google Ads integration returns daily granularity | If weekly only, ad_spend_log needs date-range semantics |
| Monday 7am PST weekly digest aligns with operator's sprint review | Easy to change cron schedule |
| 4-hour dedup window for threshold alerts is right | Tuneable per trigger if too noisy/quiet |

---

## 16. Success criteria

On 2026-09-01 at 00:00 PST, the operator opens `/admin/pmf`. The page answers Gate B pass/fail in under 5 seconds with zero interpretation required. The data underneath is clean enough that if Path 2a wins, the cohort and CAC numbers are defensible to any future investor or acquirer.

**Hard quality bar:** zero tolerance for sloppiness. Every number tabular mono. Every title Cake Mono uppercase. Every border hairline. Zero shadows on dark. No emoji. No spring. No bounce. The dashboard must read as "military tactical minimalist" per the system spec — not a 2019 SaaS template.
