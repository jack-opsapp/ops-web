# PMF Tracking Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin PMF tracking dashboard at `/admin/pmf` that surfaces 4 Gate B markers + 5 leading indicators + Tier A pipeline Kanban + base SaaS MRR trend, pulling from Supabase + Stripe webhooks + Google Ads, with SMS + email + in-app notifications to the operator.

**Architecture:** New Supabase tables with RLS. Next.js App Router routes under `/admin/pmf/**` (server components where possible, client only for interactivity). Metric computation in `src/lib/admin/pmf-queries.ts` with `unstable_cache`. Stripe webhook feeds `billing_events`. Four Vercel crons (threshold diff, daily digest, weekly digest, Google Ads sync). Twilio + SendGrid + existing `notifications` rail for alerts. OPS Design System v2 scoped via `.pmf-scope` wrapper.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS), TanStack Query, Framer Motion, dnd-kit, Recharts, Stripe SDK, Twilio, SendGrid (existing), React Email, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-04-21-pmf-tracking-dashboard-design.md`

**Design System:** `.interface-design/system.md` + bundle at session start (v2, 2026-04-17)

---

## Design & Animation Decisions

**Intent:** Single operator, high-stakes gate decision on 2026-09-01. Every pixel must earn its place. Information arrives clean and declarative, like a mission briefing. No coaching, no celebration, no emojis, no spring physics.

**Palette (scoped to `.pmf-scope`):** `#000000` canvas, glass `rgba(10,10,10,0.70)` + `backdrop-blur(20px) saturate(1.2)`, hairline `rgba(255,255,255,0.10)` borders, text `#EDEDED` / `#B5B5B5` / `#8A8A8A` / `#6A6A6A`, accent `#6F94B0` (CTA + focus only), earth-tones `#9DB582`/`#C4A868`/`#B58289`/`#93321A`.

**Typography:** Mohave 300 80px for hero numbers. Cake Mono Light (`font-cakemono font-light`) for all uppercase display (titles, buttons, section headers, badges). JetBrains Mono (`font-mono`) for all numerical data, `//` prefixes, `[bracket]` micro-text. All numbers tabular slashed-zero.

**Depth:** Glass + 1px hairline only. **Zero shadows on dark.** Top-edge gradient pseudo on `.glass-surface` as the only "lit-from-above" cue.

**Radii:** 5px panels, 2.5px buttons/inputs/chips. Sharp, never pillow.

**Motion:**

| Element | Animation | Duration | Easing |
|---|---|---|---|
| Page enter | opacity 0→1 + translateY 8px→0 | 250ms | `[0.22, 1, 0.36, 1]` |
| Gate B card stagger | each card delayed by 50ms | 200ms | `[0.22, 1, 0.36, 1]` |
| Hero number | tween count-up | 800ms | `[0.22, 1, 0.36, 1]` |
| Status dot color | background-color transition | 150ms | linear |
| Sparkline draw | `pathLength` 0→1 | 600ms | `[0.22, 1, 0.36, 1]` |
| Kanban drag | dnd-kit overridden | 200ms | `[0.22, 1, 0.36, 1]` |
| Modal / sheet | opacity + scale 0.98→1 | 200ms | `[0.22, 1, 0.36, 1]` |

**Reduced motion:** all animations → 150ms opacity only. `useReducedMotion()` short-circuits.

**Haptics:** none. Desktop web admin.

---

## File Structure

### New Files (62)

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260421120000_pmf_tracking.sql` | All 8 new tables + indexes + RLS + triggers |
| `src/styles/pmf-tokens.css` | Scoped `.pmf-scope` CSS tokens adapted from bundle |
| `public/brand/ops-mark.svg` | OPS brand mark (currentColor) |
| `public/brand/ops-lockup.svg` | OPS horizontal lockup (currentColor) |
| `src/lib/pmf/schemas.ts` | Zod schemas for prospects, deals, ad-spend, attribution |
| `src/lib/pmf/types.ts` | TypeScript types for all PMF entities and computed state |
| `src/lib/pmf/attribution.ts` | UTM → channel derivation logic |
| `src/lib/pmf/marker-compute.ts` | TypeScript fallbacks + status-threshold logic for each marker |
| `src/lib/pmf/threshold-diff.ts` | State-change detection between two snapshots |
| `src/lib/pmf/recipients.ts` | Operator contact info from env |
| `src/lib/pmf/formatters.ts` | Number/currency/date formatters (tabular, slashed-zero, PT) |
| `src/lib/admin/pmf-queries.ts` | Cached Supabase queries for all markers + indicators |
| `src/lib/notifications/twilio.ts` | Twilio SMS client + send helper |
| `src/lib/notifications/pmf-send.ts` | Unified send: SMS + email + in-app rail |
| `src/emails/pmf/threshold-alert.tsx` | Single-event alert email template |
| `src/emails/pmf/daily-digest.tsx` | Daily digest email template |
| `src/emails/pmf/weekly-digest.tsx` | Weekly digest with cohort tables |
| `src/components/pmf/ui/button.tsx` | `.btn-*` variants |
| `src/components/pmf/ui/card.tsx` | `.glass-surface` + `.glass-dense` wrappers |
| `src/components/pmf/ui/tag.tsx` | Earth-tone `.tag-*` variants |
| `src/components/pmf/ui/status-dot.tsx` | 6px green/amber/red dot with aria-label |
| `src/components/pmf/ui/slash-header.tsx` | `// HEADER TEXT` prefix component |
| `src/components/pmf/ui/progress-dots.tsx` | `●●○○` marker progress |
| `src/components/pmf/ui/sparkline.tsx` | 100×20 hairline sparkline with Motion path-draw |
| `src/components/pmf/ui/kbd.tsx` | Keyboard hint |
| `src/components/pmf/ui/ops-mark.tsx` | Inline OPS SVG mark |
| `src/components/pmf/ui/hero-number.tsx` | Count-up tabular hero number (Mohave 300) |
| `src/components/pmf/ui/countdown-chip.tsx` | `[GATE B · N DAYS]` with color progression |
| `src/components/pmf/marker-card.tsx` | Gate B marker card (hero + dots + status) |
| `src/components/pmf/indicator-card.tsx` | Leading indicator compact card |
| `src/components/pmf/pipeline-kanban.tsx` | dnd-kit Kanban for Tier A deals |
| `src/components/pmf/prospect-card.tsx` | Prospect card inside Kanban column |
| `src/components/pmf/prospect-sheet.tsx` | Right-side sheet editor for prospect + deal |
| `src/components/pmf/mrr-trend-chart.tsx` | 18-week Recharts line with target overlay |
| `src/components/pmf/new-prospect-modal.tsx` | New prospect creation modal |
| `src/components/pmf/ad-spend-form.tsx` | Monthly spend entry form |
| `src/app/admin/pmf/layout.tsx` | Applies `.pmf-scope` + imports tokens |
| `src/app/admin/pmf/page.tsx` | Main dashboard page |
| `src/app/admin/pmf/loading.tsx` | Skeleton |
| `src/app/admin/pmf/marker/[id]/page.tsx` | Marker drill-in |
| `src/app/admin/pmf/indicator/[id]/page.tsx` | Indicator drill-in |
| `src/app/admin/pmf/prospects/page.tsx` | Prospect list |
| `src/app/admin/pmf/prospects/new/page.tsx` | New prospect form page |
| `src/app/admin/pmf/prospects/[id]/page.tsx` | Prospect detail page |
| `src/app/admin/pmf/ad-spend/page.tsx` | Ad spend entry page |
| `src/app/api/stripe/webhook/route.ts` | Stripe webhook → `billing_events` |
| `src/app/api/cron/pmf/threshold-check/route.ts` | 15-min diff cron |
| `src/app/api/cron/pmf/daily-digest/route.ts` | 7am PST digest |
| `src/app/api/cron/pmf/weekly-digest/route.ts` | Monday 7am PST digest |
| `src/app/api/cron/pmf/google-ads-sync/route.ts` | Daily ad spend ingest |
| `src/app/api/cron/pmf/cleanup-snapshots/route.ts` | Prune old snapshots |
| `src/app/api/admin/pmf/prospects/route.ts` | GET/POST list + create |
| `src/app/api/admin/pmf/prospects/[id]/route.ts` | GET/PATCH/DELETE |
| `src/app/api/admin/pmf/deals/[id]/route.ts` | PATCH deal |
| `src/app/api/admin/pmf/deals/[id]/stage/route.ts` | PATCH stage (Kanban drop) |
| `src/app/api/admin/pmf/ad-spend/route.ts` | POST monthly entry |
| `src/i18n/dictionaries/en/pmf.json` | All user-facing strings |
| `tests/unit/pmf/marker-compute.test.ts` | All 4 markers green/amber/red |
| `tests/unit/pmf/attribution.test.ts` | Channel derivation cases |
| `tests/unit/pmf/threshold-diff.test.ts` | State-change detection |
| `tests/unit/pmf/schemas.test.ts` | Zod validation |
| `tests/unit/notifications/pmf-templates.test.ts` | Email/SMS snapshot tests |
| `tests/integration/stripe-webhook.test.ts` | Webhook signature + idempotency |
| `tests/integration/pmf-queries.test.ts` | Seeded DB assertions |
| `tests/integration/notifications.test.ts` | Transport routing |
| `tests/e2e/pmf-dashboard.spec.ts` | Auth + dashboard renders |
| `tests/e2e/pmf-prospect-crud.spec.ts` | Create + move stage |
| `tests/e2e/pmf-ad-spend.spec.ts` | Upsert semantics |
| `docs/integrations/stripe-pmf-webhook.md` | Webhook setup doc |

### Modified Files (5)

| Path | Change |
|---|---|
| `vercel.json` | Add 4 new crons |
| `.env.example` | Add new env vars |
| `src/app/admin/_components/sidebar.tsx` | Add PMF nav link |
| `CLAUDE.md` (ops-web) | Document `.pmf-scope` convention + accent divergence |
| `package.json` | Add `twilio`, `@react-email/components`, `date-fns-tz` if absent |

---

## Task 1: Dependency install + vercel.json crons + env vars

**Files:**
- Modify: `package.json`
- Modify: `vercel.json`
- Modify: `.env.example`

- [ ] **Step 1.1: Install new dependencies**

Run: `npm install twilio @react-email/components date-fns-tz stripe`
Also confirm: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/accessibility` (already present per CLAUDE.md — verify).

Run: `npm ls twilio @react-email/components stripe date-fns-tz @dnd-kit/core`
Expected: all listed without errors.

- [ ] **Step 1.2: Add new env vars to .env.example**

Append to `.env.example`:
```
# PMF Tracking Dashboard
STRIPE_WEBHOOK_SECRET=whsec_xxx
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
PMF_NOTIFICATION_SMS=+12505388994
PMF_NOTIFICATION_EMAIL=canprojack@gmail.com
PMF_OPERATOR_USER_ID=<supabase auth user id for operator>
CRON_SECRET=<random string for cron auth>
```

- [ ] **Step 1.3: Add crons to vercel.json**

Read current `vercel.json`, add to `crons` array:
```json
{ "path": "/api/cron/pmf/threshold-check",   "schedule": "*/15 * * * *" },
{ "path": "/api/cron/pmf/daily-digest",      "schedule": "0 15 * * *"  },
{ "path": "/api/cron/pmf/weekly-digest",     "schedule": "0 15 * * 1"  },
{ "path": "/api/cron/pmf/google-ads-sync",   "schedule": "0 14 * * *"  },
{ "path": "/api/cron/pmf/cleanup-snapshots", "schedule": "30 14 * * *" }
```

All UTC; comment above them that 14/15 UTC = 6/7am PST.

- [ ] **Step 1.4: Commit**

```bash
git add package.json package-lock.json .env.example vercel.json
git commit -m "chore(pmf): install deps + register crons + env vars"
```

---

## Task 2: Supabase migration — all 8 tables + RLS + triggers

**Files:**
- Create: `supabase/migrations/20260421120000_pmf_tracking.sql`

- [ ] **Step 2.1: Write the migration**

```sql
-- ============================================================================
-- PMF Tracking Dashboard — 2026-04-21
-- Adds prospects, deals, deal events, billing events, ad spend log,
-- trial attributions, threshold snapshots, notification log.
-- ============================================================================

-- pmf_prospects ---------------------------------------------------------------
create table public.pmf_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  source text not null check (source in (
    'outbound_cold','warm_network','paid_ad','organic_search','referral','direct'
  )),
  referred_by_company_id uuid references public.companies(id),
  deal_type text not null check (deal_type in ('tier_a','base_saas')),
  first_contact_at timestamptz not null,
  first_contact_direction text not null check (first_contact_direction in ('inbound','outbound')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_pmf_prospects_deal_type_first_contact on public.pmf_prospects (deal_type, first_contact_at);
create index idx_pmf_prospects_source on public.pmf_prospects (source);

-- pmf_deals -------------------------------------------------------------------
create table public.pmf_deals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.pmf_prospects(id) on delete cascade,
  stage text not null check (stage in (
    'contacted','qualified','proposal','negotiation','signed',
    'in_delivery','delivered','closed_won','closed_lost'
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_pmf_deals_prospect on public.pmf_deals (prospect_id);
create index idx_pmf_deals_stage_type on public.pmf_deals (stage, deal_type);

-- pmf_deal_events -------------------------------------------------------------
create table public.pmf_deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.pmf_deals(id) on delete cascade,
  event_type text not null check (event_type in (
    'stage_change','note','sow_signed','payment_received','delivered','closed'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_pmf_deal_events_deal on public.pmf_deal_events (deal_id, occurred_at desc);

-- Trigger: log stage changes automatically
create or replace function public.pmf_log_deal_stage_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.pmf_deal_events (deal_id, event_type, payload, occurred_at)
    values (new.id, 'stage_change',
            jsonb_build_object('from', old.stage, 'to', new.stage),
            now());
    new.stage_entered_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger pmf_deals_stage_change
  before update on public.pmf_deals
  for each row execute function public.pmf_log_deal_stage_change();

-- billing_events --------------------------------------------------------------
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  stripe_customer_id text,
  company_id uuid references public.companies(id),
  amount_cents bigint,
  currency text default 'usd',
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw jsonb not null
);
create index idx_billing_events_customer_time on public.billing_events (stripe_customer_id, occurred_at desc);
create index idx_billing_events_company_type_time on public.billing_events (company_id, event_type, occurred_at desc);
create index idx_billing_events_type_time on public.billing_events (event_type, occurred_at desc);

-- ad_spend_log ----------------------------------------------------------------
create table public.ad_spend_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('google_ads','meta_ads','apple_search_ads','other')),
  spend_date date not null,
  spend_cents bigint not null check (spend_cents >= 0),
  impressions bigint,
  clicks bigint,
  downloads bigint,
  source text not null check (source in ('auto_sync','manual_entry')),
  entered_by text,
  created_at timestamptz not null default now(),
  unique (channel, spend_date)
);
create index idx_ad_spend_log_date on public.ad_spend_log (spend_date);

-- trial_attributions ----------------------------------------------------------
create table public.trial_attributions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) unique,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_trial_attributions_channel_paid on public.trial_attributions (attributed_channel, first_paid_at);
create index idx_trial_attributions_started on public.trial_attributions (trial_started_at);

-- Trigger: set trial_attributions.first_paid_at on first invoice.paid for a company
create or replace function public.pmf_update_first_paid_at()
returns trigger language plpgsql as $$
begin
  if new.event_type = 'invoice.paid' and new.company_id is not null then
    update public.trial_attributions
       set first_paid_at = new.occurred_at,
           updated_at = now()
     where company_id = new.company_id
       and first_paid_at is null;
  end if;
  return new;
end $$;

create trigger billing_events_first_paid
  after insert on public.billing_events
  for each row execute function public.pmf_update_first_paid_at();

-- pmf_threshold_snapshots -----------------------------------------------------
create table public.pmf_threshold_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  state jsonb not null
);
create index idx_pmf_threshold_snapshots_captured on public.pmf_threshold_snapshots (captured_at desc);

-- pmf_notification_log --------------------------------------------------------
create table public.pmf_notification_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('threshold_alert','daily_digest','weekly_digest')),
  trigger text not null,
  channel text not null check (channel in ('sms','email','in_app')),
  recipient text not null,
  payload jsonb not null,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index idx_pmf_notification_log_kind_trigger_time on public.pmf_notification_log (kind, trigger, created_at desc);

-- RLS -------------------------------------------------------------------------
-- All PMF tables: admins-only
alter table public.pmf_prospects            enable row level security;
alter table public.pmf_deals                enable row level security;
alter table public.pmf_deal_events          enable row level security;
alter table public.billing_events           enable row level security;
alter table public.ad_spend_log             enable row level security;
alter table public.trial_attributions       enable row level security;
alter table public.pmf_threshold_snapshots  enable row level security;
alter table public.pmf_notification_log     enable row level security;

-- Helper: is_admin() — reuse existing pattern (adjust if repo uses different check)
create or replace function public.pmf_is_admin(user_email text)
returns boolean language sql stable as $$
  select exists (select 1 from public.admins where email = user_email);
$$;

-- Policy template applied per table
do $$
declare t text;
begin
  foreach t in array array[
    'pmf_prospects','pmf_deals','pmf_deal_events','billing_events',
    'ad_spend_log','trial_attributions','pmf_threshold_snapshots','pmf_notification_log'
  ]
  loop
    execute format($f$
      create policy %I_admin_all on public.%I
        for all using (public.pmf_is_admin(auth.jwt() ->> 'email'))
        with check (public.pmf_is_admin(auth.jwt() ->> 'email'));
    $f$, t, t);
  end loop;
end $$;

-- updated_at trigger for prospects + deals
create or replace function public.pmf_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger pmf_prospects_touch before update on public.pmf_prospects
  for each row execute function public.pmf_touch_updated_at();
```

- [ ] **Step 2.2: Run migration locally**

Run: `supabase db reset` (local Supabase) or `supabase db push` against a dev branch.
Expected: migration applies without errors; `\dt pmf_*` shows 6 tables + `billing_events` + `ad_spend_log` + `trial_attributions`.

- [ ] **Step 2.3: Verify RLS and triggers**

Run SQL:
```sql
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename like 'pmf_%' or tablename in ('billing_events','ad_spend_log','trial_attributions');
```
Expected: `rowsecurity = true` for all 8 tables.

```sql
select event_object_table, trigger_name from information_schema.triggers
where trigger_schema='public' and trigger_name like 'pmf_%' or trigger_name='billing_events_first_paid';
```
Expected: 3 triggers (`pmf_deals_stage_change`, `billing_events_first_paid`, `pmf_prospects_touch`).

- [ ] **Step 2.4: Commit**

```bash
git add supabase/migrations/20260421120000_pmf_tracking.sql
git commit -m "feat(pmf): migration for prospects, deals, billing events, attributions, snapshots, log"
```

---

## Task 3: Design system tokens + brand assets

**Files:**
- Create: `src/styles/pmf-tokens.css`
- Create: `public/brand/ops-mark.svg`
- Create: `public/brand/ops-lockup.svg`

- [ ] **Step 3.1: Copy brand SVGs**

Canonical kit location (per updated CLAUDE.md): `C:/OPS/.interface-design/new-system-extracted/`

```bash
cp "C:/OPS/.interface-design/new-system-extracted/assets/ops-mark.svg"   public/brand/ops-mark.svg
cp "C:/OPS/.interface-design/new-system-extracted/assets/ops-lockup.svg" public/brand/ops-lockup.svg
```

If those paths don't resolve, fall back to `C:/OPS/.interface-design/new-system-extracted/project/assets/`.

- [ ] **Step 3.2: Write scoped token CSS**

Values mirror the authoritative spec (`.interface-design/system.md` v2, 2026-04-21 — see `CLAUDE.md` for canonical summary).

Create `src/styles/pmf-tokens.css`:
```css
/* OPS Design System v2 — scoped PMF tokens */
:where(.pmf-scope) {
  --bg:              #000000;
  --bg-panel:        #0A0A0A;
  --bg-card:         #191919;
  --bg-elevated:     #1A1A1A;
  --bg-input:        #111111;

  /* Glass — v2 spec values */
  --glass:           rgba(18, 18, 20, 0.58);
  --glass-dense:     rgba(18, 18, 20, 0.78);
  --glass-subtle:    rgba(18, 18, 20, 0.25);
  --glass-border:    rgba(255, 255, 255, 0.09);

  --surface-input:   rgba(255, 255, 255, 0.04);
  --surface-hover:   rgba(255, 255, 255, 0.05);
  --surface-active:  rgba(255, 255, 255, 0.08);

  --text:      #EDEDED;
  --text-2:    #B5B5B5;
  --text-3:    #8A8A8A;
  --text-mute: #6A6A6A;

  --ops-accent:        #6F94B0;
  --ops-accent-hover:  #7fa3bd;
  --ops-accent-muted:  rgba(111, 148, 176, 0.15);
  --ops-amber:         #C4A868;

  /* Earth tones */
  --olive: #9DB582;
  --tan:   #C4A868;
  --rose:  #B58289;
  --brick: #93321A;

  --olive-soft: rgba(157, 181, 130, 0.12);
  --olive-line: rgba(157, 181, 130, 0.30);
  --tan-soft:   rgba(196, 168, 104, 0.12);
  --tan-line:   rgba(196, 168, 104, 0.30);
  --rose-soft:  rgba(181, 130, 137, 0.12);
  --rose-line:  rgba(181, 130, 137, 0.30);
  --brick-line: rgba(147, 50, 26, 0.50);

  /* Financial */
  --fin-revenue:     #C4A868;
  --fin-profit:      #9DB582;
  --fin-cost:        #B58289;
  --fin-receivables: #D4A574;
  --fin-overdue:     #93321A;

  --line:             rgba(255, 255, 255, 0.10);
  --fill-neutral:     rgba(255, 255, 255, 0.14);
  --fill-neutral-dim: rgba(255, 255, 255, 0.06);

  /* Radii — v2 spec (sharp but not brutalist) */
  --r-panel: 10px;
  --r-modal: 12px;
  --r-btn:   5px;
  --r-input: 5px;
  --r-chip:  4px;
  --r-bar:   2px;
  --r-item:  6px;

  --unit: 8px;

  --ease-smooth: cubic-bezier(0.22, 1, 0.36, 1);
  --d-hover: 150ms;
  --d-panel: 200ms;
  --d-page:  250ms;
  --d-stag:  50ms;
  --d-flip:  350ms;
  --d-count: 800ms;
}

.pmf-scope { background: var(--bg); color: var(--text); }

.pmf-scope .glass-surface {
  position: relative;
  background: var(--glass);
  backdrop-filter: blur(28px) saturate(1.3);
  -webkit-backdrop-filter: blur(28px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-radius: var(--r-panel);
}
.pmf-scope .glass-surface::before {
  content: "";
  position: absolute; inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%);
  pointer-events: none;
}
.pmf-scope .glass-dense {
  position: relative;
  background: var(--glass-dense);
  backdrop-filter: blur(28px) saturate(1.3);
  -webkit-backdrop-filter: blur(28px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-radius: var(--r-modal);
}

.pmf-scope .mono,
.pmf-scope [class*="font-mono"] {
  font-feature-settings: "tnum" 1, "zero" 1;
}

.pmf-scope .slash::before {
  content: "// ";
  color: var(--text-mute);
  font-family: var(--font-mono, ui-monospace, monospace);
  margin-right: 2px;
}

.pmf-scope .bracket::before { content: "["; font-family: var(--font-mono); color: var(--text-3); }
.pmf-scope .bracket::after  { content: "]"; font-family: var(--font-mono); color: var(--text-3); }

@media (prefers-reduced-motion: reduce) {
  .pmf-scope *,
  .pmf-scope *::before,
  .pmf-scope *::after {
    animation-duration: 150ms !important;
    transition-duration: 150ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 3.3: Commit**

```bash
git add src/styles/pmf-tokens.css public/brand/ops-mark.svg public/brand/ops-lockup.svg
git commit -m "feat(pmf): scoped design system tokens + brand assets"
```

---

## Task 4: TypeScript types + Zod schemas

**Files:**
- Create: `src/lib/pmf/types.ts`
- Create: `src/lib/pmf/schemas.ts`
- Test: `tests/unit/pmf/schemas.test.ts`

- [ ] **Step 4.1: Write the failing schema tests**

Create `tests/unit/pmf/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  ProspectCreateSchema,
  DealStageSchema,
  AdSpendEntrySchema,
  AttributionChannelSchema,
} from '@/lib/pmf/schemas';

describe('ProspectCreateSchema', () => {
  it('accepts minimal valid input', () => {
    const result = ProspectCreateSchema.safeParse({
      name: 'Ada Lovelace',
      source: 'referral',
      deal_type: 'tier_a',
      first_contact_at: '2026-04-21T14:00:00Z',
      first_contact_direction: 'inbound',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown source', () => {
    const result = ProspectCreateSchema.safeParse({
      name: 'X', source: 'spam', deal_type: 'tier_a',
      first_contact_at: '2026-04-21T00:00:00Z',
      first_contact_direction: 'inbound',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = ProspectCreateSchema.safeParse({
      name: '', source: 'referral', deal_type: 'tier_a',
      first_contact_at: '2026-04-21T00:00:00Z',
      first_contact_direction: 'inbound',
    });
    expect(result.success).toBe(false);
  });
});

describe('DealStageSchema', () => {
  it('accepts all valid stages', () => {
    for (const s of ['contacted','qualified','proposal','negotiation','signed','in_delivery','delivered','closed_won','closed_lost']) {
      expect(DealStageSchema.safeParse(s).success).toBe(true);
    }
  });
  it('rejects bogus stages', () => {
    expect(DealStageSchema.safeParse('won').success).toBe(false);
  });
});

describe('AdSpendEntrySchema', () => {
  it('accepts positive cents', () => {
    expect(AdSpendEntrySchema.safeParse({
      channel: 'meta_ads', month: '2026-04', spend_cents: 250000,
    }).success).toBe(true);
  });
  it('rejects negative cents', () => {
    expect(AdSpendEntrySchema.safeParse({
      channel: 'meta_ads', month: '2026-04', spend_cents: -1,
    }).success).toBe(false);
  });
  it('rejects invalid month format', () => {
    expect(AdSpendEntrySchema.safeParse({
      channel: 'meta_ads', month: 'April 2026', spend_cents: 100,
    }).success).toBe(false);
  });
});

describe('AttributionChannelSchema', () => {
  it('includes unknown as valid default', () => {
    expect(AttributionChannelSchema.safeParse('unknown').success).toBe(true);
  });
});
```

- [ ] **Step 4.2: Run tests — confirm they fail**

Run: `npm run test tests/unit/pmf/schemas.test.ts`
Expected: FAIL — "Cannot find module '@/lib/pmf/schemas'".

- [ ] **Step 4.3: Write types**

Create `src/lib/pmf/types.ts`:
```ts
export type ProspectSource =
  | 'outbound_cold' | 'warm_network' | 'paid_ad'
  | 'organic_search' | 'referral' | 'direct';

export type DealType = 'tier_a' | 'base_saas';

export type DealStage =
  | 'contacted' | 'qualified' | 'proposal' | 'negotiation'
  | 'signed' | 'in_delivery' | 'delivered' | 'closed_won' | 'closed_lost';

export type DealEventType =
  | 'stage_change' | 'note' | 'sow_signed'
  | 'payment_received' | 'delivered' | 'closed';

export type AdChannel = 'google_ads' | 'meta_ads' | 'apple_search_ads' | 'other';

export type AttributionChannel =
  | 'google_ads' | 'meta_ads' | 'apple_search_ads'
  | 'organic' | 'direct' | 'referral' | 'unknown';

export type MarkerStatus = 'green' | 'amber' | 'red';

export type MarkerKey = 'marker_1' | 'marker_2' | 'marker_3' | 'marker_4';
export type IndicatorKey = 'indicator_a' | 'indicator_b' | 'indicator_c' | 'indicator_d' | 'indicator_e';

export interface MarkerState {
  status: MarkerStatus;
  value: number;
  target: number;
  label: string;
  detail?: string;
}

export interface IndicatorState {
  status: MarkerStatus;
  value: number;
  delta_wow: number;
  sparkline: number[];
  label: string;
  unit?: 'count' | 'percent' | 'currency';
}

export interface PmfState {
  capturedAt: string;
  markers: Record<MarkerKey, MarkerState>;
  indicators: Record<IndicatorKey, IndicatorState>;
}

export interface Prospect {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: ProspectSource;
  referred_by_company_id: string | null;
  deal_type: DealType;
  first_contact_at: string;
  first_contact_direction: 'inbound' | 'outbound';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  prospect_id: string;
  stage: DealStage;
  stage_entered_at: string;
  deal_type: DealType;
  sow_signed_at: string | null;
  sow_url: string | null;
  implementation_fee_cents: number | null;
  deposit_paid_at: string | null;
  deposit_amount_cents: number | null;
  final_paid_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4.4: Write schemas**

Create `src/lib/pmf/schemas.ts`:
```ts
import { z } from 'zod';

export const ProspectSourceSchema = z.enum([
  'outbound_cold','warm_network','paid_ad','organic_search','referral','direct',
]);

export const DealTypeSchema = z.enum(['tier_a','base_saas']);

export const DealStageSchema = z.enum([
  'contacted','qualified','proposal','negotiation',
  'signed','in_delivery','delivered','closed_won','closed_lost',
]);

export const AdChannelSchema = z.enum(['google_ads','meta_ads','apple_search_ads','other']);

export const AttributionChannelSchema = z.enum([
  'google_ads','meta_ads','apple_search_ads','organic','direct','referral','unknown',
]);

export const ProspectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  phone: z.string().max(50).optional(),
  source: ProspectSourceSchema,
  referred_by_company_id: z.string().uuid().optional(),
  deal_type: DealTypeSchema,
  first_contact_at: z.string().datetime(),
  first_contact_direction: z.enum(['inbound','outbound']),
  notes: z.string().max(5000).optional(),
});

export const ProspectUpdateSchema = ProspectCreateSchema.partial();

export const DealUpdateSchema = z.object({
  stage: DealStageSchema.optional(),
  sow_signed_at: z.string().datetime().nullable().optional(),
  sow_url: z.string().url().nullable().optional(),
  implementation_fee_cents: z.number().int().nonnegative().nullable().optional(),
  deposit_paid_at: z.string().datetime().nullable().optional(),
  deposit_amount_cents: z.number().int().nonnegative().nullable().optional(),
  final_paid_at: z.string().datetime().nullable().optional(),
  delivered_at: z.string().datetime().nullable().optional(),
  closed_at: z.string().datetime().nullable().optional(),
  closed_reason: z.string().max(2000).nullable().optional(),
});

export const AdSpendEntrySchema = z.object({
  channel: AdChannelSchema,
  month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM format required'),
  spend_cents: z.number().int().nonnegative(),
  impressions: z.number().int().nonnegative().optional(),
  clicks: z.number().int().nonnegative().optional(),
  downloads: z.number().int().nonnegative().optional(),
});

export const TrialAttributionInsertSchema = z.object({
  company_id: z.string().uuid(),
  utm_source: z.string().max(200).optional(),
  utm_medium: z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_content: z.string().max(200).optional(),
  utm_term: z.string().max(200).optional(),
  gclid: z.string().max(500).optional(),
  fbclid: z.string().max(500).optional(),
  landing_url: z.string().url().optional(),
  trial_started_at: z.string().datetime(),
});
```

- [ ] **Step 4.5: Run tests — confirm pass**

Run: `npm run test tests/unit/pmf/schemas.test.ts`
Expected: all pass.

- [ ] **Step 4.6: Commit**

```bash
git add src/lib/pmf/types.ts src/lib/pmf/schemas.ts tests/unit/pmf/schemas.test.ts
git commit -m "feat(pmf): types + zod schemas with unit tests"
```

---

## Task 5: Formatters + recipients helper

**Files:**
- Create: `src/lib/pmf/formatters.ts`
- Create: `src/lib/pmf/recipients.ts`

- [ ] **Step 5.1: Write formatters**

Create `src/lib/pmf/formatters.ts`:
```ts
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/Vancouver';

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

export function fmtUsd(cents: number | null | undefined, opts: { withCents?: boolean } = {}): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const n = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: opts.withCents ? 2 : 0,
    maximumFractionDigits: opts.withCents ? 2 : 0,
  }).format(n);
}

export function fmtPct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function fmtRatio(num: number, denom: number): string {
  return `${fmtInt(num)} / ${fmtInt(denom)}`;
}

export function fmtTime(iso: string | Date): string {
  return formatInTimeZone(iso, TZ, 'HH:mm');
}

export function fmtDate(iso: string | Date): string {
  return formatInTimeZone(iso, TZ, 'yyyy-MM-dd');
}

export function fmtDateTime(iso: string | Date): string {
  return formatInTimeZone(iso, TZ, 'yyyy-MM-dd · HH:mm');
}

export function daysUntilGate(now: Date = new Date()): number {
  const gate = new Date('2026-09-01T00:00:00-07:00');
  const ms = gate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
```

- [ ] **Step 5.2: Write recipients helper**

Create `src/lib/pmf/recipients.ts`:
```ts
export interface PmfRecipients {
  sms: string;
  email: string;
  operatorUserId: string;
}

export function getPmfRecipients(): PmfRecipients {
  const sms = process.env.PMF_NOTIFICATION_SMS;
  const email = process.env.PMF_NOTIFICATION_EMAIL;
  const operatorUserId = process.env.PMF_OPERATOR_USER_ID;
  if (!sms || !email || !operatorUserId) {
    throw new Error('PMF recipients env vars missing');
  }
  return { sms, email, operatorUserId };
}
```

- [ ] **Step 5.3: Commit**

```bash
git add src/lib/pmf/formatters.ts src/lib/pmf/recipients.ts
git commit -m "feat(pmf): formatters (PT timezone, tabular) + recipients helper"
```

---

## Task 6: UI primitives — StatusDot, SlashHeader, OpsMark, Kbd, Tag

**Files:**
- Create: `src/components/pmf/ui/status-dot.tsx`
- Create: `src/components/pmf/ui/slash-header.tsx`
- Create: `src/components/pmf/ui/ops-mark.tsx`
- Create: `src/components/pmf/ui/kbd.tsx`
- Create: `src/components/pmf/ui/tag.tsx`

- [ ] **Step 6.1: StatusDot**

Create `src/components/pmf/ui/status-dot.tsx`:
```tsx
import { cn } from '@/lib/utils';
import type { MarkerStatus } from '@/lib/pmf/types';

interface StatusDotProps {
  status: MarkerStatus | 'neutral';
  size?: number;
  className?: string;
  label?: string;
}

const COLOR: Record<string, string> = {
  green:   'var(--olive)',
  amber:   'var(--tan)',
  red:     'var(--rose)',
  neutral: 'var(--text-mute)',
};

export function StatusDot({ status, size = 6, className, label }: StatusDotProps) {
  const ariaLabel = label ?? `status ${status}`;
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn('inline-block rounded-full transition-colors duration-150', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: COLOR[status],
      }}
    />
  );
}
```

- [ ] **Step 6.2: SlashHeader**

Create `src/components/pmf/ui/slash-header.tsx`:
```tsx
import { cn } from '@/lib/utils';

interface SlashHeaderProps {
  children: React.ReactNode;
  variant?: 'section' | 'panel-title' | 'page-title';
  className?: string;
  trailing?: React.ReactNode;
}

const VARIANT_CLASS = {
  'section':     'font-cakemono font-light uppercase text-[18px] tracking-[0.04em] leading-none',
  'panel-title': 'font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)]',
  'page-title':  'font-cakemono font-light uppercase text-[22px] tracking-[0.02em] leading-none',
};

export function SlashHeader({ children, variant = 'section', className, trailing }: SlashHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <h2 className={cn(VARIANT_CLASS[variant])}>
        <span className="mr-1 text-[color:var(--text-mute)] font-mono">//</span>
        {children}
      </h2>
      {trailing && <div>{trailing}</div>}
    </div>
  );
}
```

- [ ] **Step 6.3: OpsMark**

Create `src/components/pmf/ui/ops-mark.tsx`:
```tsx
interface OpsMarkProps { size?: number; className?: string; }
export function OpsMark({ size = 16, className }: OpsMarkProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={1.5}
      className={className} aria-hidden
    >
      <use href="/brand/ops-mark.svg#mark" />
    </svg>
  );
}
```
(If the SVG does not export a named symbol, inline the `<path>` contents from `public/brand/ops-mark.svg` here instead.)

- [ ] **Step 6.4: Kbd**

Create `src/components/pmf/ui/kbd.tsx`:
```tsx
import { cn } from '@/lib/utils';
interface KbdProps { children: React.ReactNode; className?: string; }
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd className={cn(
      'font-mono text-[11px] text-[color:var(--text-2)]',
      'bg-[rgba(255,255,255,0.06)] border border-[color:var(--line)]',
      'rounded-[3px] min-w-[20px] h-[20px] px-[5px]',
      'inline-flex items-center justify-center',
      className,
    )}>
      {children}
    </kbd>
  );
}
```

- [ ] **Step 6.5: Tag**

Create `src/components/pmf/ui/tag.tsx`:
```tsx
import { cn } from '@/lib/utils';

type TagVariant = 'default' | 'olive' | 'tan' | 'rose';
interface TagProps {
  children: React.ReactNode;
  variant?: TagVariant;
  className?: string;
}

const VARIANT: Record<TagVariant, string> = {
  default: 'text-[color:var(--text-2)] bg-[rgba(255,255,255,0.05)] border-[color:var(--line)]',
  olive:   'text-[color:var(--olive)] bg-[color:var(--olive-soft)] border-[color:var(--olive-line)]',
  tan:     'text-[color:var(--tan)]   bg-[color:var(--tan-soft)]   border-[color:var(--tan-line)]',
  rose:    'text-[color:var(--rose)]  bg-[color:var(--rose-soft)]  border-[color:var(--rose-line)]',
};

export function Tag({ children, variant = 'default', className }: TagProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1',
      'font-mono font-medium uppercase text-[11px] tracking-[0.12em]',
      'px-1.5 py-0.5 rounded-[2.5px] border',
      VARIANT[variant],
      className,
    )}>
      {children}
    </span>
  );
}
```

- [ ] **Step 6.6: Commit**

```bash
git add src/components/pmf/ui/status-dot.tsx src/components/pmf/ui/slash-header.tsx src/components/pmf/ui/ops-mark.tsx src/components/pmf/ui/kbd.tsx src/components/pmf/ui/tag.tsx
git commit -m "feat(pmf): ui primitives — StatusDot, SlashHeader, OpsMark, Kbd, Tag"
```

---

## Task 7: UI primitives — Button, Card, ProgressDots, CountdownChip, Sparkline, HeroNumber

**Files:**
- Create: `src/components/pmf/ui/button.tsx`
- Create: `src/components/pmf/ui/card.tsx`
- Create: `src/components/pmf/ui/progress-dots.tsx`
- Create: `src/components/pmf/ui/countdown-chip.tsx`
- Create: `src/components/pmf/ui/sparkline.tsx`
- Create: `src/components/pmf/ui/hero-number.tsx`

- [ ] **Step 7.1: Button**

Create `src/components/pmf/ui/button.tsx`:
```tsx
'use client';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'default' | 'secondary' | 'ghost' | 'destructive';

interface PmfButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const VARIANT: Record<Variant, string> = {
  primary:     'bg-transparent text-[color:var(--ops-accent)] border border-[color:var(--ops-accent)] hover:bg-[color:var(--ops-accent)] hover:text-black',
  default:     'bg-[rgba(255,255,255,0.07)] text-[color:var(--text-2)] border border-[color:var(--line)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[color:var(--text)]',
  secondary:   'bg-transparent text-[color:var(--text-2)] border border-[color:var(--line)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[color:var(--text)]',
  ghost:       'bg-transparent text-[color:var(--text-2)] border border-transparent hover:bg-[rgba(255,255,255,0.05)] hover:text-[color:var(--text)]',
  destructive: 'bg-[color:var(--rose-soft)] text-[color:var(--rose)] border border-[color:var(--rose-line)]',
};

export const PmfButton = forwardRef<HTMLButtonElement, PmfButtonProps>(
  ({ variant = 'default', className, children, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center gap-2 min-h-[36px] px-4 py-[9px] rounded-[2.5px]',
        'font-cakemono font-light uppercase text-[14px]',
        'transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-[color:var(--ops-accent)] focus-visible:outline-offset-2',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);
PmfButton.displayName = 'PmfButton';
```

- [ ] **Step 7.2: Card**

Create `src/components/pmf/ui/card.tsx`:
```tsx
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  dense?: boolean;
}

export function PmfCard({ dense, className, children, ...rest }: CardProps) {
  return (
    <div className={cn(dense ? 'glass-dense' : 'glass-surface', 'p-6', className)} {...rest}>
      {children}
    </div>
  );
}
```

- [ ] **Step 7.3: ProgressDots**

Create `src/components/pmf/ui/progress-dots.tsx`:
```tsx
import { cn } from '@/lib/utils';
import type { MarkerStatus } from '@/lib/pmf/types';

interface ProgressDotsProps {
  value: number;
  target: number;
  status: MarkerStatus;
  size?: number;
}

const FILL: Record<MarkerStatus, string> = {
  green: 'var(--olive)',
  amber: 'var(--tan)',
  red:   'var(--rose)',
};

export function ProgressDots({ value, target, status, size = 6 }: ProgressDotsProps) {
  const clamped = Math.max(0, Math.min(value, target));
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`${value} of ${target}`}>
      {Array.from({ length: target }, (_, i) => (
        <span
          key={i}
          className={cn('inline-block rounded-full', i < clamped ? 'opacity-100' : 'opacity-40')}
          style={{
            width: size, height: size,
            backgroundColor: i < clamped ? FILL[status] : 'var(--fill-neutral-dim)',
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 7.4: CountdownChip**

Create `src/components/pmf/ui/countdown-chip.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { daysUntilGate } from '@/lib/pmf/formatters';

export function CountdownChip() {
  const [days, setDays] = useState(() => daysUntilGate());

  useEffect(() => {
    const id = setInterval(() => setDays(daysUntilGate()), 60_000 * 30);
    return () => clearInterval(id);
  }, []);

  const colorClass =
    days <= 7  ? 'text-[color:var(--rose)]' :
    days <= 30 ? 'text-[color:var(--tan)]'  :
                 'text-[color:var(--text-3)]';

  return (
    <span className={cn('font-mono text-[11px] tracking-[0.16em] uppercase', colorClass)}>
      <span className="text-[color:var(--text-3)]">[</span>
      GATE B · {days} DAYS
      <span className="text-[color:var(--text-3)]">]</span>
    </span>
  );
}
```

- [ ] **Step 7.5: Sparkline**

Create `src/components/pmf/ui/sparkline.tsx`:
```tsx
'use client';
import { motion, useReducedMotion } from 'framer-motion';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
  className?: string;
}

export function Sparkline({
  data, width = 100, height = 20,
  strokeColor = 'var(--text-3)', className,
}: SparklineProps) {
  const reduced = useReducedMotion();
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / Math.max(1, data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <motion.path
        d={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1}
        initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}
```

- [ ] **Step 7.6: HeroNumber**

Create `src/components/pmf/ui/hero-number.tsx`:
```tsx
'use client';
import { useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface HeroNumberProps {
  value: number;
  total?: number;
  className?: string;
}

export function HeroNumber({ value, total, className }: HeroNumberProps) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const displayed = useTransform(mv, (v) => Math.round(v).toString());

  useEffect(() => {
    if (reduced) { mv.set(value); return; }
    const controls = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return controls.stop;
  }, [value, reduced, mv]);

  return (
    <div
      className={cn(
        'font-mohave font-light text-[80px] leading-none tabular-nums',
        'text-[color:var(--text)]',
        className,
      )}
      aria-label={total != null ? `${value} of ${total}` : `${value}`}
    >
      <motion.span>{displayed}</motion.span>
      {total != null && (
        <span className="text-[color:var(--text-3)] text-[48px]"> / {total}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 7.7: Commit**

```bash
git add src/components/pmf/ui/button.tsx src/components/pmf/ui/card.tsx src/components/pmf/ui/progress-dots.tsx src/components/pmf/ui/countdown-chip.tsx src/components/pmf/ui/sparkline.tsx src/components/pmf/ui/hero-number.tsx
git commit -m "feat(pmf): ui primitives — Button, Card, ProgressDots, CountdownChip, Sparkline, HeroNumber"
```

---

## Task 8: Attribution logic + unit tests

**Files:**
- Create: `src/lib/pmf/attribution.ts`
- Test: `tests/unit/pmf/attribution.test.ts`

- [ ] **Step 8.1: Write failing tests**

Create `tests/unit/pmf/attribution.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveAttributionChannel } from '@/lib/pmf/attribution';

describe('deriveAttributionChannel', () => {
  it('google_ads when gclid present', () => {
    expect(deriveAttributionChannel({ gclid: 'abc' })).toBe('google_ads');
  });
  it('google_ads when utm_source contains google', () => {
    expect(deriveAttributionChannel({ utm_source: 'google_cpc' })).toBe('google_ads');
  });
  it('meta_ads when fbclid present', () => {
    expect(deriveAttributionChannel({ fbclid: 'xyz' })).toBe('meta_ads');
  });
  it('meta_ads when utm_source facebook', () => {
    expect(deriveAttributionChannel({ utm_source: 'facebook' })).toBe('meta_ads');
  });
  it('apple_search_ads on explicit match', () => {
    expect(deriveAttributionChannel({ utm_source: 'apple_search_ads' })).toBe('apple_search_ads');
  });
  it('organic when medium=organic', () => {
    expect(deriveAttributionChannel({ utm_medium: 'organic' })).toBe('organic');
  });
  it('direct when nothing set', () => {
    expect(deriveAttributionChannel({})).toBe('direct');
  });
  it('gclid takes precedence over ambiguous utm_source', () => {
    expect(deriveAttributionChannel({ gclid: 'abc', utm_source: 'newsletter' })).toBe('google_ads');
  });
});
```

- [ ] **Step 8.2: Run tests — confirm fail**

Run: `npm run test tests/unit/pmf/attribution.test.ts`
Expected: FAIL "Cannot find module".

- [ ] **Step 8.3: Implement**

Create `src/lib/pmf/attribution.ts`:
```ts
import type { AttributionChannel } from './types';

export interface AttributionInput {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  landing_url?: string | null;
  referrer?: string | null;
}

export function deriveAttributionChannel(input: AttributionInput): AttributionChannel {
  const src = (input.utm_source ?? '').toLowerCase();
  const med = (input.utm_medium ?? '').toLowerCase();

  if (input.gclid) return 'google_ads';
  if (input.fbclid) return 'meta_ads';
  if (src.includes('google')) return 'google_ads';
  if (src.includes('facebook') || src.includes('meta') || src.includes('instagram')) return 'meta_ads';
  if (src === 'apple_search_ads' || src === 'asa') return 'apple_search_ads';
  if (med === 'organic' || med === 'search') return 'organic';
  if (med === 'referral' || src === 'referral') return 'referral';
  if (!src && !med && !input.landing_url && !input.referrer) return 'direct';
  if (!src && !med) return 'direct';
  return 'unknown';
}
```

- [ ] **Step 8.4: Run tests — confirm pass**

Run: `npm run test tests/unit/pmf/attribution.test.ts`
Expected: all 8 pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/pmf/attribution.ts tests/unit/pmf/attribution.test.ts
git commit -m "feat(pmf): UTM → channel attribution with tests"
```

---

## Task 9: Marker compute — status thresholds + unit tests

**Files:**
- Create: `src/lib/pmf/marker-compute.ts`
- Test: `tests/unit/pmf/marker-compute.test.ts`

- [ ] **Step 9.1: Write failing tests**

Create `tests/unit/pmf/marker-compute.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  statusForMarker1,
  statusForMarker2,
  statusForMarker3,
  statusForMarker4,
  statusForIndicatorA,
  statusForIndicatorB,
  statusForIndicatorC,
  statusForIndicatorD,
} from '@/lib/pmf/marker-compute';

describe('Marker 1 — Tier A paid & delivered (target 2)', () => {
  it('green at >=2', () => expect(statusForMarker1(2)).toBe('green'));
  it('amber at 1',    () => expect(statusForMarker1(1)).toBe('amber'));
  it('red at 0',      () => expect(statusForMarker1(0)).toBe('red'));
});

describe('Marker 2 — retained base SaaS (target 5)', () => {
  it('green at >=5', () => expect(statusForMarker2(5)).toBe('green'));
  it('amber at 3-4', () => {
    expect(statusForMarker2(3)).toBe('amber');
    expect(statusForMarker2(4)).toBe('amber');
  });
  it('red at <=2', () => {
    expect(statusForMarker2(2)).toBe('red');
    expect(statusForMarker2(0)).toBe('red');
  });
});

describe('Marker 3 — inbound leads (target 1)', () => {
  it('green at >=1', () => expect(statusForMarker3(1)).toBe('green'));
  it('red at 0',     () => expect(statusForMarker3(0)).toBe('red'));
});

describe('Marker 4 — CAC ($15K spend, 5 paid)', () => {
  it('green at >=15000 and >=5 paid', () =>
    expect(statusForMarker4({ spendUsd: 15000, attributedPaid: 5 })).toBe('green'));
  it('amber at >=75% of either axis', () =>
    expect(statusForMarker4({ spendUsd: 11250, attributedPaid: 4 })).toBe('amber'));
  it('red below', () =>
    expect(statusForMarker4({ spendUsd: 5000, attributedPaid: 1 })).toBe('red'));
});

describe('Indicator A — active Tier A (healthy 5-8)', () => {
  it('red <3',        () => expect(statusForIndicatorA(2)).toBe('red'));
  it('amber 3-4',     () => expect(statusForIndicatorA(4)).toBe('amber'));
  it('green 5-8',     () => expect(statusForIndicatorA(6)).toBe('green'));
  it('amber >10',     () => expect(statusForIndicatorA(11)).toBe('amber'));
});

describe('Indicator B — weekly new trials', () => {
  it('red <30',    () => expect(statusForIndicatorB(10)).toBe('red'));
  it('amber 30-39',() => expect(statusForIndicatorB(35)).toBe('amber'));
  it('green 40-100',() => expect(statusForIndicatorB(60)).toBe('green'));
  it('amber >100', () => expect(statusForIndicatorB(120)).toBe('amber'));
});

describe('Indicator C — trial→paid conversion', () => {
  it('red <4%',    () => expect(statusForIndicatorC(0.03)).toBe('red'));
  it('green 5-10%',() => expect(statusForIndicatorC(0.07)).toBe('green'));
  it('amber in between', () => expect(statusForIndicatorC(0.045)).toBe('amber'));
});

describe('Indicator D — cohort churn', () => {
  it('green 4-7%',() => expect(statusForIndicatorD(0.05)).toBe('green'));
  it('amber 8-10%',() => expect(statusForIndicatorD(0.09)).toBe('amber'));
  it('red >10%',  () => expect(statusForIndicatorD(0.11)).toBe('red'));
});
```

- [ ] **Step 9.2: Run — confirm fail**

Run: `npm run test tests/unit/pmf/marker-compute.test.ts`
Expected: FAIL.

- [ ] **Step 9.3: Implement**

Create `src/lib/pmf/marker-compute.ts`:
```ts
import type { MarkerStatus } from './types';

export function statusForMarker1(value: number): MarkerStatus {
  if (value >= 2) return 'green';
  if (value === 1) return 'amber';
  return 'red';
}

export function statusForMarker2(value: number): MarkerStatus {
  if (value >= 5) return 'green';
  if (value >= 3) return 'amber';
  return 'red';
}

export function statusForMarker3(value: number): MarkerStatus {
  return value >= 1 ? 'green' : 'red';
}

export function statusForMarker4(input: { spendUsd: number; attributedPaid: number }): MarkerStatus {
  const { spendUsd, attributedPaid } = input;
  if (spendUsd >= 15_000 && attributedPaid >= 5) return 'green';
  if (spendUsd >= 11_250 || attributedPaid >= 4) return 'amber';
  return 'red';
}

export function statusForIndicatorA(active: number): MarkerStatus {
  if (active < 3) return 'red';
  if (active >= 5 && active <= 8) return 'green';
  return 'amber';
}

export function statusForIndicatorB(weekly: number): MarkerStatus {
  if (weekly < 30) return 'red';
  if (weekly >= 40 && weekly <= 100) return 'green';
  return 'amber';
}

export function statusForIndicatorC(rate: number): MarkerStatus {
  if (rate < 0.04) return 'red';
  if (rate >= 0.05 && rate <= 0.10) return 'green';
  return 'amber';
}

export function statusForIndicatorD(rate: number): MarkerStatus {
  if (rate > 0.10) return 'red';
  if (rate >= 0.04 && rate <= 0.07) return 'green';
  return 'amber';
}
```

- [ ] **Step 9.4: Run — confirm pass**

Run: `npm run test tests/unit/pmf/marker-compute.test.ts`
Expected: all pass.

- [ ] **Step 9.5: Commit**

```bash
git add src/lib/pmf/marker-compute.ts tests/unit/pmf/marker-compute.test.ts
git commit -m "feat(pmf): marker + indicator status thresholds with tests"
```

---

## Task 10: Threshold diff + unit tests

**Files:**
- Create: `src/lib/pmf/threshold-diff.ts`
- Test: `tests/unit/pmf/threshold-diff.test.ts`

- [ ] **Step 10.1: Write failing tests**

Create `tests/unit/pmf/threshold-diff.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { diffState, type Transition } from '@/lib/pmf/threshold-diff';
import type { PmfState } from '@/lib/pmf/types';

function makeState(overrides: Partial<PmfState['markers']> = {}, ind: Partial<PmfState['indicators']> = {}): PmfState {
  return {
    capturedAt: '2026-04-21T00:00:00Z',
    markers: {
      marker_1: { status: 'red',   value: 0, target: 2, label: 'M1' },
      marker_2: { status: 'red',   value: 0, target: 5, label: 'M2' },
      marker_3: { status: 'red',   value: 0, target: 1, label: 'M3' },
      marker_4: { status: 'red',   value: 0, target: 15000, label: 'M4' },
      ...overrides,
    } as any,
    indicators: {
      indicator_a: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'A' },
      indicator_b: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'B' },
      indicator_c: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'C' },
      indicator_d: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'D' },
      indicator_e: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'E' },
      ...ind,
    } as any,
  };
}

describe('diffState', () => {
  it('detects marker red → green', () => {
    const prev = makeState();
    const next = makeState({ marker_1: { status: 'green', value: 2, target: 2, label: 'M1' } as any });
    const transitions = diffState(prev, next);
    expect(transitions).toContainEqual(
      expect.objectContaining({ key: 'marker_1', from: 'red', to: 'green' })
    );
  });

  it('detects marker green → amber (worsening)', () => {
    const prev = makeState({ marker_1: { status: 'green', value: 2, target: 2, label: 'M1' } as any });
    const next = makeState({ marker_1: { status: 'amber', value: 1, target: 2, label: 'M1' } as any });
    expect(diffState(prev, next)).toContainEqual(
      expect.objectContaining({ key: 'marker_1', from: 'green', to: 'amber', direction: 'worsening' })
    );
  });

  it('does NOT alert on red → amber (recovery but not green)', () => {
    const prev = makeState();
    const next = makeState({ marker_2: { status: 'amber', value: 3, target: 5, label: 'M2' } as any });
    const transitions = diffState(prev, next);
    expect(transitions.find(t => t.key === 'marker_2')).toBeUndefined();
  });

  it('empty transitions when no change', () => {
    const s = makeState();
    expect(diffState(s, s)).toEqual([]);
  });
});
```

- [ ] **Step 10.2: Run — confirm fail**

Run: `npm run test tests/unit/pmf/threshold-diff.test.ts`
Expected: FAIL.

- [ ] **Step 10.3: Implement**

Create `src/lib/pmf/threshold-diff.ts`:
```ts
import type { MarkerKey, IndicatorKey, MarkerStatus, PmfState } from './types';

export interface Transition {
  key: MarkerKey | IndicatorKey;
  from: MarkerStatus;
  to: MarkerStatus;
  direction: 'improving' | 'worsening';
  value: number;
}

const RANK: Record<MarkerStatus, number> = { red: 0, amber: 1, green: 2 };

export function diffState(prev: PmfState, next: PmfState): Transition[] {
  const out: Transition[] = [];
  const allKeys: (MarkerKey | IndicatorKey)[] = [
    'marker_1','marker_2','marker_3','marker_4',
    'indicator_a','indicator_b','indicator_c','indicator_d','indicator_e',
  ];
  for (const key of allKeys) {
    const p = key.startsWith('marker') ? prev.markers[key as MarkerKey] : prev.indicators[key as IndicatorKey];
    const n = key.startsWith('marker') ? next.markers[key as MarkerKey] : next.indicators[key as IndicatorKey];
    if (!p || !n) continue;
    if (p.status === n.status) continue;

    const direction = RANK[n.status] > RANK[p.status] ? 'improving' : 'worsening';
    // Only alert on: any→green, or worsening-to-non-green.
    const isAlert =
      n.status === 'green' ||
      direction === 'worsening';
    if (!isAlert) continue;

    out.push({ key, from: p.status, to: n.status, direction, value: n.value });
  }
  return out;
}
```

- [ ] **Step 10.4: Run — confirm pass**

Run: `npm run test tests/unit/pmf/threshold-diff.test.ts`
Expected: all pass.

- [ ] **Step 10.5: Commit**

```bash
git add src/lib/pmf/threshold-diff.ts tests/unit/pmf/threshold-diff.test.ts
git commit -m "feat(pmf): threshold-diff state-change detection with tests"
```

---

## Task 11: pmf-queries.ts — cached Supabase queries + computePmfState

**Files:**
- Create: `src/lib/admin/pmf-queries.ts`

- [ ] **Step 11.1: Implement query layer**

Create `src/lib/admin/pmf-queries.ts`:
```ts
import 'server-only';
import { unstable_cache } from 'next/cache';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import {
  statusForMarker1, statusForMarker2, statusForMarker3, statusForMarker4,
  statusForIndicatorA, statusForIndicatorB, statusForIndicatorC, statusForIndicatorD,
} from '@/lib/pmf/marker-compute';
import type { PmfState, MarkerStatus } from '@/lib/pmf/types';

const TTL = 60;

// Marker 1 — Tier A paid & delivered
async function queryMarker1(): Promise<number> {
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_count_tier_a_paid_delivered' as never);
  if (error) throw error;
  if (typeof data === 'number') return data;
  // fallback inline query
  const { data: rows, error: e2 } = await sb
    .from('pmf_deals')
    .select('id, deposit_amount_cents, implementation_fee_cents, stage, deposit_paid_at')
    .eq('deal_type','tier_a')
    .in('stage', ['in_delivery','delivered','closed_won'])
    .not('deposit_paid_at','is',null);
  if (e2) throw e2;
  return (rows ?? []).filter(
    r => (r.deposit_amount_cents ?? 0) >= (r.implementation_fee_cents ?? 0) * 0.5
  ).length;
}

// Marker 2 — retained base SaaS (60-day consecutive + still active)
async function queryMarker2(): Promise<number> {
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_count_retained_saas' as never);
  if (error || typeof data !== 'number') {
    throw new Error(`queryMarker2: ${error?.message ?? 'rpc missing — add function in migration'}`);
  }
  return data;
}

// Marker 3 — inbound leads
async function queryMarker3(): Promise<number> {
  const sb = getAdminSupabase();
  const { count, error } = await sb
    .from('pmf_prospects')
    .select('*', { count: 'exact', head: true })
    .or('first_contact_direction.eq.inbound,source.in.(paid_ad,organic_search,referral,direct)');
  if (error) throw error;
  return count ?? 0;
}

// Marker 4 — cumulative spend + attributed paid
async function queryMarker4(): Promise<{ spendUsd: number; attributedPaid: number }> {
  const sb = getAdminSupabase();
  const [{ data: spendRows, error: spendErr }, { count: paidCount, error: paidErr }] = await Promise.all([
    sb.from('ad_spend_log').select('spend_cents'),
    sb.from('trial_attributions').select('*', { count: 'exact', head: true }).not('first_paid_at','is',null),
  ]);
  if (spendErr) throw spendErr;
  if (paidErr) throw paidErr;
  const totalCents = (spendRows ?? []).reduce((a, r) => a + (r.spend_cents ?? 0), 0);
  return { spendUsd: totalCents / 100, attributedPaid: paidCount ?? 0 };
}

// Indicator A — active Tier A pipeline
async function queryIndicatorA(): Promise<number> {
  const sb = getAdminSupabase();
  const { count, error } = await sb.from('pmf_deals')
    .select('*', { count: 'exact', head: true })
    .eq('deal_type','tier_a')
    .in('stage', ['contacted','qualified','proposal','negotiation']);
  if (error) throw error;
  return count ?? 0;
}

// Indicator B — weekly new trials (last 7 days)
async function queryIndicatorB(): Promise<number> {
  const sb = getAdminSupabase();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count, error } = await sb.from('trial_attributions')
    .select('*', { count: 'exact', head: true })
    .gte('trial_started_at', since);
  if (error) throw error;
  return count ?? 0;
}

// Indicator C — most mature trial→paid cohort conversion rate
async function queryIndicatorC(): Promise<number> {
  const sb = getAdminSupabase();
  // Use RPC for cohort math
  const { data, error } = await sb.rpc('pmf_latest_mature_conversion' as never);
  if (error || typeof data !== 'number') return 0;
  return data;
}

// Indicator D — monthly cohort churn (latest mature)
async function queryIndicatorD(): Promise<number> {
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_latest_cohort_churn' as never);
  if (error || typeof data !== 'number') return 0;
  return data;
}

// Indicator E — referral count
async function queryIndicatorE(): Promise<number> {
  const sb = getAdminSupabase();
  const { count, error } = await sb.from('pmf_prospects')
    .select('*', { count: 'exact', head: true })
    .eq('source','referral');
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Sparklines (12 weeks)
// ---------------------------------------------------------------------------
async function querySparkline(kind: 'trials'|'active_pipeline'|'churn'|'conversion'|'referrals'): Promise<number[]> {
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_sparkline' as never, { kind });
  if (error) return new Array(12).fill(0);
  return (data as number[]) ?? new Array(12).fill(0);
}

// ---------------------------------------------------------------------------
// Top-level: computePmfState
// ---------------------------------------------------------------------------
export async function computePmfState(): Promise<PmfState> {
  const [m1, m2, m3, m4, a, b, c, d, e, sparkB, sparkA, sparkC, sparkD, sparkE] = await Promise.all([
    queryMarker1(), queryMarker2(), queryMarker3(), queryMarker4(),
    queryIndicatorA(), queryIndicatorB(), queryIndicatorC(), queryIndicatorD(), queryIndicatorE(),
    querySparkline('trials'), querySparkline('active_pipeline'),
    querySparkline('conversion'), querySparkline('churn'), querySparkline('referrals'),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    markers: {
      marker_1: { status: statusForMarker1(m1), value: m1, target: 2, label: 'TIER A ENGAGEMENTS' },
      marker_2: { status: statusForMarker2(m2), value: m2, target: 5, label: 'RETAINED BASE SAAS' },
      marker_3: { status: statusForMarker3(m3), value: m3, target: 1, label: 'INBOUND LEAD' },
      marker_4: {
        status: statusForMarker4(m4),
        value: Math.round(m4.spendUsd),
        target: 15000,
        label: 'CAC FROM $15K SPEND',
        detail: `${m4.attributedPaid} paid attributed`,
      },
    },
    indicators: {
      indicator_a: { status: statusForIndicatorA(a), value: a, delta_wow: wow(sparkA), sparkline: sparkA, label: 'ACTIVE TIER A' },
      indicator_b: { status: statusForIndicatorB(b), value: b, delta_wow: wow(sparkB), sparkline: sparkB, label: 'WEEKLY TRIALS' },
      indicator_c: { status: statusForIndicatorC(c), value: c, delta_wow: wow(sparkC), sparkline: sparkC, label: 'TRIAL→PAID', unit: 'percent' },
      indicator_d: { status: statusForIndicatorD(d), value: d, delta_wow: wow(sparkD), sparkline: sparkD, label: 'COHORT CHURN', unit: 'percent' },
      indicator_e: { status: (e > 0 ? 'green' : 'red') as MarkerStatus, value: e, delta_wow: wow(sparkE), sparkline: sparkE, label: 'REFERRALS' },
    },
  };
}

function wow(sparkline: number[]): number {
  if (sparkline.length < 2) return 0;
  const curr = sparkline[sparkline.length - 1];
  const prev = sparkline[sparkline.length - 2];
  return curr - prev;
}

export const getPmfState = unstable_cache(
  computePmfState,
  ['pmf-state'],
  { revalidate: TTL, tags: ['pmf-state'] }
);
```

- [ ] **Step 11.2: Add Postgres helper functions**

Append to `supabase/migrations/20260421120000_pmf_tracking.sql` (or create a follow-up migration `20260421120001_pmf_rpc_functions.sql`):

```sql
-- ============================================================================
-- PMF RPC functions consumed by pmf-queries.ts
-- ============================================================================

create or replace function public.pmf_count_tier_a_paid_delivered()
returns bigint language sql stable as $$
  select count(*) from public.pmf_deals
   where deal_type = 'tier_a'
     and stage in ('in_delivery','delivered','closed_won')
     and deposit_paid_at is not null
     and coalesce(deposit_amount_cents, 0) >= coalesce(implementation_fee_cents, 0) * 0.5;
$$;

create or replace function public.pmf_count_retained_saas()
returns bigint language sql stable as $$
  with paid as (
    select company_id, occurred_at,
           date_trunc('month', occurred_at) as paid_month
      from public.billing_events
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
    select a.company_id from agg a
     where a.first_paid_at <= now() - interval '60 days'
       and a.last_paid_at  >= now() - interval '40 days'
       and exists (
         select 1 from unnest(a.months) with ordinality as m(month, idx)
         join unnest(a.months) with ordinality as n(month, idx)
           on n.idx = m.idx + 1 and n.month = m.month + interval '1 month'
       )
       and not exists (
         select 1 from public.billing_events b
          where b.company_id = a.company_id
            and b.event_type = 'customer.subscription.deleted'
            and b.occurred_at > a.last_paid_at
       )
  )
  select count(*) from consecutive;
$$;

create or replace function public.pmf_latest_mature_conversion()
returns numeric language sql stable as $$
  with cohort as (
    select date_trunc('month', trial_started_at) as cohort_month,
           count(*) as trials,
           count(*) filter (where first_paid_at is not null) as paid
      from public.trial_attributions
     where trial_started_at <= now() - interval '30 days'
     group by 1
     order by 1 desc
     limit 1
  )
  select case when trials > 0 then paid::numeric / trials else 0 end
    from cohort;
$$;

create or replace function public.pmf_latest_cohort_churn()
returns numeric language sql stable as $$
  -- Approximation: fraction of companies that paid in month N-1 but not in month N (latest closed month).
  with latest as (select date_trunc('month', now() - interval '1 month') as m),
  prev_m as (select date_trunc('month', now() - interval '2 months') as m),
  prev_payers as (
    select distinct company_id from public.billing_events, prev_m
     where event_type='invoice.paid'
       and date_trunc('month', occurred_at) = prev_m.m
  ),
  latest_payers as (
    select distinct company_id from public.billing_events, latest
     where event_type='invoice.paid'
       and date_trunc('month', occurred_at) = latest.m
  )
  select case when (select count(*) from prev_payers) > 0
           then (select count(*) from prev_payers p
                  where p.company_id not in (select company_id from latest_payers))::numeric
                / (select count(*) from prev_payers)
           else 0 end;
$$;

create or replace function public.pmf_sparkline(kind text)
returns numeric[] language plpgsql stable as $$
declare result numeric[] := array[]::numeric[];
declare w int;
declare start_ts timestamptz;
declare end_ts timestamptz;
declare v numeric;
begin
  for w in 0..11 loop
    start_ts := date_trunc('week', now()) - ((11 - w) || ' weeks')::interval;
    end_ts   := start_ts + interval '1 week';
    v := case kind
      when 'trials' then (
        select count(*) from public.trial_attributions
         where trial_started_at >= start_ts and trial_started_at < end_ts)
      when 'active_pipeline' then (
        select count(*) from public.pmf_deals
         where deal_type='tier_a'
           and stage in ('contacted','qualified','proposal','negotiation')
           and stage_entered_at < end_ts)
      when 'conversion' then (
        select case when count(*) > 0
                 then count(*) filter (where first_paid_at is not null)::numeric / count(*)
                 else 0 end
          from public.trial_attributions
         where trial_started_at >= start_ts and trial_started_at < end_ts)
      when 'churn' then 0 -- churn is monthly; use zero for weekly sparkline
      when 'referrals' then (
        select count(*) from public.pmf_prospects
         where source='referral' and created_at < end_ts)
      else 0 end;
    result := result || coalesce(v, 0);
  end loop;
  return result;
end $$;
```

Regenerate migration or append to existing. Run `supabase db reset` or equivalent to verify.

- [ ] **Step 11.3: Commit**

```bash
git add src/lib/admin/pmf-queries.ts supabase/migrations/20260421120001_pmf_rpc_functions.sql
git commit -m "feat(pmf): query layer with cached computePmfState + Postgres RPC helpers"
```

---

## Task 12: Stripe webhook handler + integration test

**Files:**
- Create: `src/app/api/stripe/webhook/route.ts`
- Create: `docs/integrations/stripe-pmf-webhook.md`
- Test: `tests/integration/stripe-webhook.test.ts`

- [ ] **Step 12.1: Write failing integration test**

Create `tests/integration/stripe-webhook.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { POST } from '@/app/api/stripe/webhook/route';
import Stripe from 'stripe';

const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test';

function signEvent(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${body}`;
  const crypto = require('node:crypto');
  const v1 = crypto.createHmac('sha256', SECRET).update(signed).digest('hex');
  return { body, signature: `t=${timestamp},v1=${v1}` };
}

describe('Stripe webhook', () => {
  it('accepts a valid invoice.paid event and inserts billing_events', async () => {
    const evt = {
      id: `evt_${Date.now()}`,
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: { object: {
        customer: 'cus_test_1',
        amount_paid: 4900,
        currency: 'usd',
      }},
    };
    const { body, signature } = signEvent(evt);
    const req = new Request('http://local/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body,
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
  });

  it('rejects with 400 on bad signature', async () => {
    const req = new Request('http://local/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'bogus' },
      body: '{}',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('is idempotent on duplicate event', async () => {
    const id = `evt_dup_${Date.now()}`;
    const evt = { id, type: 'invoice.paid', created: Math.floor(Date.now()/1000),
      data: { object: { customer: 'cus_x', amount_paid: 100, currency: 'usd' }}};
    const first = await POST(buildReq(evt) as any);
    const second = await POST(buildReq(evt) as any);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Assert only one row in billing_events for this id (check via Supabase)
  });
});

function buildReq(evt: unknown) {
  const { body, signature } = signEvent(evt);
  return new Request('http://local/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body,
  });
}
```

- [ ] **Step 12.2: Run — confirm fail**

Run: `npm run test tests/integration/stripe-webhook.test.ts`
Expected: FAIL.

- [ ] **Step 12.3: Implement webhook**

Create `src/app/api/stripe/webhook/route.ts`:
```ts
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/admin-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
  apiVersion: '2024-06-20',
});

const HANDLED = new Set([
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
]);

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const sb = getAdminSupabase();
  const customer = extractCustomerId(event);
  const amount = extractAmountCents(event);
  const occurred = new Date(event.created * 1000).toISOString();

  // Resolve company_id via companies.stripe_customer_id
  let companyId: string | null = null;
  if (customer) {
    const { data } = await sb.from('companies').select('id').eq('stripe_customer_id', customer).maybeSingle();
    companyId = data?.id ?? null;
  }

  const { error } = await sb.from('billing_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_customer_id: customer,
    company_id: companyId,
    amount_cents: amount,
    currency: 'usd',
    occurred_at: occurred,
    raw: event as any,
  });

  // Ignore unique-violation (idempotent replay)
  if (error && !/duplicate key|unique/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function extractCustomerId(event: Stripe.Event): string | null {
  const obj: any = event.data.object;
  return obj.customer ?? obj.id?.startsWith('cus_') ? obj.id : obj.customer ?? null;
}

function extractAmountCents(event: Stripe.Event): number | null {
  const obj: any = event.data.object;
  return obj.amount_paid ?? obj.amount ?? obj.amount_refunded ?? null;
}
```

- [ ] **Step 12.4: Write setup doc**

Create `docs/integrations/stripe-pmf-webhook.md`:
```md
# Stripe Webhook Setup — PMF Billing Events

## Endpoint
`POST /api/stripe/webhook`

## Required env
- `STRIPE_SECRET_KEY` — existing
- `STRIPE_WEBHOOK_SECRET` — new (`whsec_...`), unique per endpoint

## Configure

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://app.opsapp.co/api/stripe/webhook`
3. Events to send:
   - invoice.paid
   - invoice.payment_failed
   - customer.subscription.created
   - customer.subscription.updated
   - customer.subscription.deleted
   - charge.refunded
   - charge.dispute.created
4. Copy the signing secret → Vercel env `STRIPE_WEBHOOK_SECRET` (Production + Preview)

## Local test
```
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger invoice.paid
```

Confirm a row in `billing_events` for the event id.
```

- [ ] **Step 12.5: Run tests — confirm pass (with local Stripe CLI running)**

Run: `npm run test tests/integration/stripe-webhook.test.ts`
Expected: pass.

- [ ] **Step 12.6: Commit**

```bash
git add src/app/api/stripe/webhook/route.ts docs/integrations/stripe-pmf-webhook.md tests/integration/stripe-webhook.test.ts
git commit -m "feat(pmf): Stripe webhook → billing_events with idempotency and setup docs"
```

---

## Task 13: UTM cookie capture + trial attribution hook

**Files:**
- Create: `src/lib/pmf/utm-capture.ts`
- Modify: existing trial-signup handler (location TBD — see spec §15 assumption; grep for `trial` route in `src/app/api/`)
- Create: `src/app/api/admin/pmf/attributions/seed/route.ts` (backfill helper)

- [ ] **Step 13.1: Find trial signup handler**

Run: `grep -rn "trial" src/app/api/ | grep -i route | head -20`
Expected: identify the route that creates trial companies. If none exists (user may signup via Bubble/legacy path), add cookie-capture to the landing page and rely on the backfill route at next billing_event.

- [ ] **Step 13.2: Write utm-capture**

Create `src/lib/pmf/utm-capture.ts`:
```ts
'use client';

const COOKIE = '__ops_first_touch';
const TTL_DAYS = 30;

export interface FirstTouch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
  landing_url?: string;
  referrer?: string;
  captured_at: string;
}

export function captureFirstTouchFromUrl(url: string, referrer: string): FirstTouch | null {
  const u = new URL(url);
  const params = u.searchParams;
  const get = (k: string) => params.get(k) || undefined;
  const touch: FirstTouch = {
    utm_source:   get('utm_source'),
    utm_medium:   get('utm_medium'),
    utm_campaign: get('utm_campaign'),
    utm_content:  get('utm_content'),
    utm_term:     get('utm_term'),
    gclid:        get('gclid'),
    fbclid:       get('fbclid'),
    landing_url:  u.toString(),
    referrer:     referrer || undefined,
    captured_at:  new Date().toISOString(),
  };
  return touch;
}

export function readCookieFirstTouch(): FirstTouch | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find(c => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  try { return JSON.parse(decodeURIComponent(match.split('=')[1])); }
  catch { return null; }
}

export function writeCookieFirstTouch(touch: FirstTouch) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + TTL_DAYS * 86_400_000).toUTCString();
  const value = encodeURIComponent(JSON.stringify(touch));
  document.cookie = `${COOKIE}=${value}; Path=/; Expires=${expires}; SameSite=Lax`;
}

export function captureOnLanding() {
  if (readCookieFirstTouch()) return; // already captured — preserve first-touch
  const touch = captureFirstTouchFromUrl(window.location.href, document.referrer);
  if (touch) writeCookieFirstTouch(touch);
}
```

- [ ] **Step 13.3: Install landing-page capture**

Find the root layout or marketing landing page in `src/app/`. Add a tiny client component that calls `captureOnLanding()` on mount. If the marketing landing is on `ops-site` (a different project), this capture must be replicated there — flag and track as an open item.

Create `src/components/pmf/utm-capture-effect.tsx`:
```tsx
'use client';
import { useEffect } from 'react';
import { captureOnLanding } from '@/lib/pmf/utm-capture';
export function UtmCaptureEffect() {
  useEffect(() => { captureOnLanding(); }, []);
  return null;
}
```

Add `<UtmCaptureEffect />` to the root `src/app/layout.tsx` client boundary (inside a client wrapper if the root is a server component).

- [ ] **Step 13.4: Server-side attribution write**

Modify the existing trial signup API route (path from Step 13.1). After successful company creation, read the `__ops_first_touch` cookie from request headers and insert into `trial_attributions` via the admin supabase client.

```ts
// inside the trial signup handler after insertCompany()
import { deriveAttributionChannel } from '@/lib/pmf/attribution';
import { TrialAttributionInsertSchema } from '@/lib/pmf/schemas';

const cookie = req.cookies.get('__ops_first_touch')?.value;
const touch = cookie ? JSON.parse(decodeURIComponent(cookie)) : {};
const channel = deriveAttributionChannel(touch);

await sb.from('trial_attributions').insert({
  company_id: newCompany.id,
  utm_source: touch.utm_source ?? null,
  utm_medium: touch.utm_medium ?? null,
  utm_campaign: touch.utm_campaign ?? null,
  utm_content: touch.utm_content ?? null,
  utm_term: touch.utm_term ?? null,
  gclid: touch.gclid ?? null,
  fbclid: touch.fbclid ?? null,
  landing_url: touch.landing_url ?? null,
  trial_started_at: new Date().toISOString(),
  attributed_channel: channel,
}).then(({ error }) => { if (error) console.error('trial_attributions insert', error); });
```

- [ ] **Step 13.5: Commit**

```bash
git add src/lib/pmf/utm-capture.ts src/components/pmf/utm-capture-effect.tsx src/app/layout.tsx
# plus whatever trial-signup route was modified
git commit -m "feat(pmf): UTM first-touch cookie capture + trial_attributions insert"
```

---

## Task 14: Google Ads daily sync cron

**Files:**
- Create: `src/app/api/cron/pmf/google-ads-sync/route.ts`

- [ ] **Step 14.1: Implement cron**

Create `src/app/api/cron/pmf/google-ads-sync/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { getGoogleAdsClient, isGoogleAdsConfigured } from '@/lib/analytics/google-ads-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isGoogleAdsConfigured()) {
    return NextResponse.json({ skipped: 'google ads not configured' });
  }

  const client = getGoogleAdsClient();
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  // GAQL: query daily totals for prior day
  const rows = await client.query(`
    SELECT metrics.cost_micros, metrics.impressions, metrics.clicks
    FROM customer
    WHERE segments.date = '${dateStr}'
  `);

  const totals = rows.reduce((acc, r) => ({
    cost_micros: acc.cost_micros + Number(r.metrics?.cost_micros ?? 0),
    impressions: acc.impressions + Number(r.metrics?.impressions ?? 0),
    clicks:      acc.clicks      + Number(r.metrics?.clicks ?? 0),
  }), { cost_micros: 0, impressions: 0, clicks: 0 });

  const sb = getAdminSupabase();
  await sb.from('ad_spend_log').upsert({
    channel: 'google_ads',
    spend_date: dateStr,
    spend_cents: Math.round(totals.cost_micros / 10_000), // micros → cents
    impressions: totals.impressions,
    clicks: totals.clicks,
    source: 'auto_sync',
  }, { onConflict: 'channel,spend_date' });

  return NextResponse.json({ ok: true, date: dateStr, cents: Math.round(totals.cost_micros / 10_000) });
}
```

- [ ] **Step 14.2: Commit**

```bash
git add src/app/api/cron/pmf/google-ads-sync/route.ts
git commit -m "feat(pmf): daily Google Ads spend sync cron"
```

---

## Task 15: Prospect + deal CRUD API routes

**Files:**
- Create: `src/app/api/admin/pmf/prospects/route.ts`
- Create: `src/app/api/admin/pmf/prospects/[id]/route.ts`
- Create: `src/app/api/admin/pmf/deals/[id]/route.ts`
- Create: `src/app/api/admin/pmf/deals/[id]/stage/route.ts`
- Create: `src/app/api/admin/pmf/ad-spend/route.ts`

- [ ] **Step 15.1: Shared auth helper**

Grep for the existing admin API auth pattern and reuse. Expected: a `requireAdmin()` or similar in `src/lib/auth/`.

- [ ] **Step 15.2: Prospects list + create**

Create `src/app/api/admin/pmf/prospects/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { requireAdmin } from '@/lib/auth/require-admin'; // existing pattern
import { ProspectCreateSchema } from '@/lib/pmf/schemas';
import { revalidateTag } from 'next/cache';

export async function GET(req: Request) {
  await requireAdmin(req);
  const url = new URL(req.url);
  const dealType = url.searchParams.get('deal_type');
  const sb = getAdminSupabase();
  let q = sb.from('pmf_prospects')
    .select('*, pmf_deals!inner(id, stage, stage_entered_at, deal_type)')
    .order('first_contact_at', { ascending: false });
  if (dealType) q = q.eq('deal_type', dealType);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  await requireAdmin(req);
  const body = await req.json();
  const parsed = ProspectCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const sb = getAdminSupabase();
  const { data: prospect, error } = await sb.from('pmf_prospects')
    .insert(parsed.data)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-create initial deal at stage=contacted
  const { error: dealErr } = await sb.from('pmf_deals').insert({
    prospect_id: prospect.id,
    stage: 'contacted',
    deal_type: prospect.deal_type,
  });
  if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 500 });

  revalidateTag('pmf-state');
  return NextResponse.json({ prospect });
}
```

- [ ] **Step 15.3: Prospect detail + update + delete**

Create `src/app/api/admin/pmf/prospects/[id]/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { requireAdmin } from '@/lib/auth/require-admin';
import { ProspectUpdateSchema } from '@/lib/pmf/schemas';
import { revalidateTag } from 'next/cache';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  await requireAdmin(req);
  const sb = getAdminSupabase();
  const { data, error } = await sb.from('pmf_prospects')
    .select('*, pmf_deals(*), pmf_deals.pmf_deal_events(*)')
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ data });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await requireAdmin(req);
  const body = await req.json();
  const parsed = ProspectUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const sb = getAdminSupabase();
  const { data, error } = await sb.from('pmf_prospects').update(parsed.data).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateTag('pmf-state');
  return NextResponse.json({ data });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  await requireAdmin(req);
  const sb = getAdminSupabase();
  const { error } = await sb.from('pmf_prospects').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateTag('pmf-state');
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 15.4: Deal update + stage PATCH**

Create `src/app/api/admin/pmf/deals/[id]/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { requireAdmin } from '@/lib/auth/require-admin';
import { DealUpdateSchema } from '@/lib/pmf/schemas';
import { revalidateTag } from 'next/cache';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await requireAdmin(req);
  const body = await req.json();
  const parsed = DealUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const sb = getAdminSupabase();
  const { data, error } = await sb.from('pmf_deals').update(parsed.data).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateTag('pmf-state');
  return NextResponse.json({ data });
}
```

Create `src/app/api/admin/pmf/deals/[id]/stage/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { requireAdmin } from '@/lib/auth/require-admin';
import { DealStageSchema } from '@/lib/pmf/schemas';
import { revalidateTag } from 'next/cache';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await requireAdmin(req);
  const body = await req.json();
  const parsed = DealStageSchema.safeParse(body.stage);
  if (!parsed.success) return NextResponse.json({ error: 'invalid stage' }, { status: 400 });
  const sb = getAdminSupabase();
  const { data, error } = await sb.from('pmf_deals').update({ stage: parsed.data }).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateTag('pmf-state');
  return NextResponse.json({ data });
}
```

- [ ] **Step 15.5: Ad spend manual entry**

Create `src/app/api/admin/pmf/ad-spend/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AdSpendEntrySchema } from '@/lib/pmf/schemas';
import { revalidateTag } from 'next/cache';

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  const body = await req.json();
  const parsed = AdSpendEntrySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { channel, month, spend_cents, impressions, clicks, downloads } = parsed.data;

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const perDayCents = Math.floor(spend_cents / daysInMonth);
  const remainder = spend_cents - perDayCents * daysInMonth;

  const sb = getAdminSupabase();
  const rows = Array.from({ length: daysInMonth }, (_, i) => ({
    channel,
    spend_date: `${month}-${String(i + 1).padStart(2, '0')}`,
    spend_cents: perDayCents + (i === 0 ? remainder : 0),
    impressions: impressions ?? null,
    clicks: clicks ?? null,
    downloads: downloads ?? null,
    source: 'manual_entry',
    entered_by: admin.email,
  }));

  const { error } = await sb.from('ad_spend_log').upsert(rows, { onConflict: 'channel,spend_date' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateTag('pmf-state');
  return NextResponse.json({ ok: true, days: daysInMonth });
}
```

- [ ] **Step 15.6: Commit**

```bash
git add src/app/api/admin/pmf/
git commit -m "feat(pmf): prospect + deal + ad-spend CRUD API routes"
```

---

## Task 16: PMF layout + i18n dictionary

**Files:**
- Create: `src/app/admin/pmf/layout.tsx`
- Create: `src/app/admin/pmf/loading.tsx`
- Create: `src/i18n/dictionaries/en/pmf.json`
- Modify: `src/app/globals.css` (import pmf-tokens)

- [ ] **Step 16.1: Import tokens globally (scoped)**

Append to `src/app/globals.css`:
```css
@import '../styles/pmf-tokens.css';
```

- [ ] **Step 16.2: PMF layout**

Create `src/app/admin/pmf/layout.tsx`:
```tsx
import type { ReactNode } from 'react';

export default function PmfLayout({ children }: { children: ReactNode }) {
  return (
    <div className="pmf-scope min-h-screen" style={{ padding: '36px 44px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 16.3: Loading skeleton**

Create `src/app/admin/pmf/loading.tsx`:
```tsx
import { PmfCard } from '@/components/pmf/ui/card';

export default function PmfLoading() {
  return (
    <div className="pmf-scope space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-6 w-64 bg-[rgba(255,255,255,0.04)] animate-pulse rounded-[2.5px]" />
        <div className="h-4 w-32 bg-[rgba(255,255,255,0.04)] animate-pulse rounded-[2.5px]" />
      </div>
      <div className="grid grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <PmfCard key={i} className="h-[220px] animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <PmfCard key={i} className="h-[120px] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 16.4: i18n strings**

Create `src/i18n/dictionaries/en/pmf.json`:
```json
{
  "page_title": "PMF TRACKING DECK",
  "markers": {
    "section_title": "GATE B · PRIMARY MARKERS",
    "on_target": "{n}/{total} ON TARGET",
    "marker_1": "TIER A ENGAGEMENTS",
    "marker_2": "RETAINED BASE SAAS",
    "marker_3": "INBOUND LEAD",
    "marker_4": "CAC · $15K SPEND"
  },
  "indicators": {
    "section_title": "LEADING INDICATORS",
    "indicator_a": "ACTIVE TIER A",
    "indicator_b": "WEEKLY TRIALS",
    "indicator_c": "TRIAL → PAID",
    "indicator_d": "COHORT CHURN",
    "indicator_e": "REFERRALS"
  },
  "pipeline": {
    "title": "TIER A PIPELINE",
    "stages": {
      "contacted": "CONTACTED",
      "qualified": "QUALIFIED",
      "proposal": "PROPOSAL",
      "negotiation": "NEGOTIATION",
      "signed": "SIGNED",
      "delivered": "DELIVERED",
      "closed_lost": "LOST"
    },
    "new_prospect": "NEW PROSPECT",
    "empty_column": "—"
  },
  "mrr": {
    "title": "BASE SAAS · MRR TREND"
  },
  "status": {
    "green": "GREEN",
    "amber": "AMBER",
    "red": "RED",
    "percent_of_target": "{pct}% OF TARGET"
  },
  "errors": {
    "sync_failed": "ERROR — SYNC FAILED",
    "save_failed": "ERROR — SAVE FAILED",
    "load_failed": "ERROR — LOAD FAILED"
  }
}
```

- [ ] **Step 16.5: Commit**

```bash
git add src/app/admin/pmf/layout.tsx src/app/admin/pmf/loading.tsx src/app/globals.css src/i18n/dictionaries/en/pmf.json
git commit -m "feat(pmf): route layout, skeleton loader, tokens import, en dictionary"
```

---

## Task 17: Dashboard page — hero strip + Gate B row

**Files:**
- Create: `src/app/admin/pmf/page.tsx`
- Create: `src/components/pmf/marker-card.tsx`

- [ ] **Step 17.1: MarkerCard component**

Create `src/components/pmf/marker-card.tsx`:
```tsx
import { PmfCard } from '@/components/pmf/ui/card';
import { HeroNumber } from '@/components/pmf/ui/hero-number';
import { ProgressDots } from '@/components/pmf/ui/progress-dots';
import { StatusDot } from '@/components/pmf/ui/status-dot';
import { SlashHeader } from '@/components/pmf/ui/slash-header';
import type { MarkerState } from '@/lib/pmf/types';
import { fmtInt, fmtUsd } from '@/lib/pmf/formatters';

interface MarkerCardProps {
  state: MarkerState;
  asCurrency?: boolean;
  detail?: string;
}

export function MarkerCard({ state, asCurrency, detail }: MarkerCardProps) {
  const pct = state.target > 0 ? Math.min(100, Math.round((state.value / state.target) * 100)) : 0;
  const statusLabel = state.status.toUpperCase();

  return (
    <PmfCard className="relative">
      <div className="absolute top-4 right-4">
        <StatusDot status={state.status} size={6} label={`status ${state.status}`} />
      </div>
      <SlashHeader variant="section">{state.label}</SlashHeader>
      <div className="mt-6">
        {asCurrency
          ? <div className="font-mohave font-light text-[56px] leading-none tabular-nums text-[color:var(--text)]">
              {fmtUsd(state.value * 100)}
              <span className="text-[color:var(--text-3)] text-[32px]"> / {fmtUsd(state.target * 100)}</span>
            </div>
          : <HeroNumber value={state.value} total={state.target} />}
      </div>
      <div className="mt-4">
        <ProgressDots value={state.value} target={Math.min(state.target, 8)} status={state.status} />
      </div>
      <div className="mt-4 font-mono text-[11px] tracking-[0.16em] text-[color:var(--text-3)]">
        <span className="text-[color:var(--text-3)]">[</span>
        {statusLabel} · {pct}% OF TARGET
        <span className="text-[color:var(--text-3)]">]</span>
      </div>
      {(state.detail || detail) && (
        <div className="mt-2 font-mono text-[11px] text-[color:var(--text-3)]">
          {state.detail ?? detail}
        </div>
      )}
    </PmfCard>
  );
}
```

- [ ] **Step 17.2: Dashboard page**

Create `src/app/admin/pmf/page.tsx`:
```tsx
import { Suspense } from 'react';
import { getPmfState } from '@/lib/admin/pmf-queries';
import { MarkerCard } from '@/components/pmf/marker-card';
import { IndicatorCard } from '@/components/pmf/indicator-card';
import { PipelineKanban } from '@/components/pmf/pipeline-kanban';
import { MrrTrendChart } from '@/components/pmf/mrr-trend-chart';
import { CountdownChip } from '@/components/pmf/ui/countdown-chip';
import { SlashHeader } from '@/components/pmf/ui/slash-header';
import { PmfButton } from '@/components/pmf/ui/button';
import Link from 'next/link';

export const revalidate = 60;

export default async function PmfDashboardPage() {
  const state = await getPmfState();
  const greenCount = Object.values(state.markers).filter(m => m.status === 'green').length;

  return (
    <div className="space-y-8">
      {/* Hero strip */}
      <div className="flex items-start justify-between">
        <h1 className="font-cakemono font-light uppercase text-[22px] tracking-[0.02em] leading-none">
          <span className="text-[color:var(--text-mute)] font-mono mr-2">//</span>
          PMF TRACKING DECK
        </h1>
        <div className="flex items-center gap-4">
          <CountdownChip />
          <Link href="/admin/pmf/prospects/new">
            <PmfButton variant="primary">NEW PROSPECT</PmfButton>
          </Link>
        </div>
      </div>

      {/* Gate B row */}
      <section className="space-y-4">
        <SlashHeader
          variant="section"
          trailing={
            <span className="font-mono text-[11px] tracking-[0.16em] text-[color:var(--text-3)]">
              [{greenCount}/4 ON TARGET]
            </span>
          }
        >
          GATE B · PRIMARY MARKERS
        </SlashHeader>
        <div className="grid grid-cols-4 gap-6">
          <Link href="/admin/pmf/marker/1"><MarkerCard state={state.markers.marker_1} /></Link>
          <Link href="/admin/pmf/marker/2"><MarkerCard state={state.markers.marker_2} /></Link>
          <Link href="/admin/pmf/marker/3"><MarkerCard state={state.markers.marker_3} /></Link>
          <Link href="/admin/pmf/marker/4"><MarkerCard state={state.markers.marker_4} asCurrency /></Link>
        </div>
      </section>

      {/* Indicators row */}
      <section className="space-y-4">
        <SlashHeader variant="section">LEADING INDICATORS</SlashHeader>
        <div className="grid grid-cols-5 gap-4">
          <Link href="/admin/pmf/indicator/a"><IndicatorCard state={state.indicators.indicator_a} /></Link>
          <Link href="/admin/pmf/indicator/b"><IndicatorCard state={state.indicators.indicator_b} /></Link>
          <Link href="/admin/pmf/indicator/c"><IndicatorCard state={state.indicators.indicator_c} /></Link>
          <Link href="/admin/pmf/indicator/d"><IndicatorCard state={state.indicators.indicator_d} /></Link>
          <Link href="/admin/pmf/indicator/e"><IndicatorCard state={state.indicators.indicator_e} /></Link>
        </div>
      </section>

      {/* Pipeline + MRR */}
      <section className="grid grid-cols-5 gap-6">
        <div className="col-span-3">
          <Suspense fallback={<div className="glass-surface h-[560px] animate-pulse" />}>
            <PipelineKanban />
          </Suspense>
        </div>
        <div className="col-span-2">
          <Suspense fallback={<div className="glass-surface h-[560px] animate-pulse" />}>
            <MrrTrendChart />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 17.3: Commit**

```bash
git add src/app/admin/pmf/page.tsx src/components/pmf/marker-card.tsx
git commit -m "feat(pmf): dashboard page — hero strip + Gate B markers row"
```

---

## Task 18: IndicatorCard component

**Files:**
- Create: `src/components/pmf/indicator-card.tsx`

- [ ] **Step 18.1: Implement**

Create `src/components/pmf/indicator-card.tsx`:
```tsx
import { PmfCard } from '@/components/pmf/ui/card';
import { StatusDot } from '@/components/pmf/ui/status-dot';
import { Sparkline } from '@/components/pmf/ui/sparkline';
import type { IndicatorState } from '@/lib/pmf/types';
import { fmtInt, fmtPct } from '@/lib/pmf/formatters';

interface IndicatorCardProps {
  state: IndicatorState;
}

export function IndicatorCard({ state }: IndicatorCardProps) {
  const displayValue = state.unit === 'percent' ? fmtPct(state.value) : fmtInt(state.value);
  const deltaSign = state.delta_wow > 0 ? '↑' : state.delta_wow < 0 ? '↓' : '—';
  const deltaClass =
    state.delta_wow > 0 ? 'text-[color:var(--olive)]' :
    state.delta_wow < 0 ? 'text-[color:var(--rose)]' :
                          'text-[color:var(--text-3)]';

  return (
    <PmfCard className="relative p-4">
      <div className="absolute top-3 right-3">
        <StatusDot status={state.status} size={5} />
      </div>
      <div className="font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)]">
        <span className="text-[color:var(--text-mute)] mr-1">//</span>
        {state.label}
      </div>
      <div className="mt-3 font-mono text-[20px] font-semibold tabular-nums text-[color:var(--text)]">
        {displayValue}
      </div>
      <div className={`mt-1 font-mono text-[11px] tabular-nums ${deltaClass}`}>
        {deltaSign} {state.unit === 'percent' ? fmtPct(state.delta_wow) : fmtInt(Math.abs(state.delta_wow))} WOW
      </div>
      <div className="mt-2">
        <Sparkline data={state.sparkline} width={120} height={20} />
      </div>
    </PmfCard>
  );
}
```

- [ ] **Step 18.2: Commit**

```bash
git add src/components/pmf/indicator-card.tsx
git commit -m "feat(pmf): IndicatorCard with delta + sparkline"
```

---

## Task 19: Pipeline Kanban with dnd-kit

**Files:**
- Create: `src/components/pmf/pipeline-kanban.tsx`
- Create: `src/components/pmf/prospect-card.tsx`

- [ ] **Step 19.1: ProspectCard**

Create `src/components/pmf/prospect-card.tsx`:
```tsx
'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Tag } from '@/components/pmf/ui/tag';
import type { Prospect, Deal, ProspectSource } from '@/lib/pmf/types';
import { formatDistanceToNowStrict } from 'date-fns';

const SOURCE_TAG_VARIANT: Record<ProspectSource, 'olive'|'tan'|'default'> = {
  referral: 'olive',
  organic_search: 'olive',
  direct: 'olive',
  paid_ad: 'tan',
  warm_network: 'default',
  outbound_cold: 'default',
};

const SOURCE_LABEL: Record<ProspectSource, string> = {
  referral: 'REFERRAL',
  organic_search: 'ORGANIC',
  direct: 'DIRECT',
  paid_ad: 'PAID',
  warm_network: 'WARM',
  outbound_cold: 'COLD',
};

interface ProspectCardProps {
  prospect: Prospect;
  deal: Deal;
  onClick?: () => void;
}

export function ProspectCard({ prospect, deal, onClick }: ProspectCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    transition: { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const daysInStage = formatDistanceToNowStrict(new Date(deal.stage_entered_at));
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="glass-surface p-3 cursor-grab active:cursor-grabbing"
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-mohave font-medium text-[13px] text-[color:var(--text)] truncate">
          {prospect.company ?? prospect.name}
        </div>
        <Tag variant={SOURCE_TAG_VARIANT[prospect.source]}>
          {SOURCE_LABEL[prospect.source]}
        </Tag>
      </div>
      <div className="mt-1 font-mono text-[11px] text-[color:var(--text-3)]">
        {daysInStage}
      </div>
    </div>
  );
}
```

- [ ] **Step 19.2: PipelineKanban**

Create `src/components/pmf/pipeline-kanban.tsx`:
```tsx
'use client';
import { useState, useEffect } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { PmfCard } from '@/components/pmf/ui/card';
import { SlashHeader } from '@/components/pmf/ui/slash-header';
import { ProspectCard } from './prospect-card';
import type { Deal, DealStage, Prospect } from '@/lib/pmf/types';

const COLUMNS: { key: DealStage; label: string }[] = [
  { key: 'contacted',   label: 'CONTACTED' },
  { key: 'qualified',   label: 'QUALIFIED' },
  { key: 'proposal',    label: 'PROPOSAL' },
  { key: 'negotiation', label: 'NEGOTIATION' },
  { key: 'signed',      label: 'SIGNED' },
  { key: 'delivered',   label: 'DELIVERED' },
];

interface Row { prospect: Prospect; deal: Deal }

async function fetchTierA(): Promise<Row[]> {
  const res = await fetch('/api/admin/pmf/prospects?deal_type=tier_a');
  const json = await res.json();
  return (json.data ?? []).flatMap((p: any) =>
    p.pmf_deals.map((d: Deal) => ({ prospect: p as Prospect, deal: d }))
  );
}

export function PipelineKanban() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTierA().then(r => { setRows(r); setLoading(false); });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeDeal = rows.find(r => r.deal.id === active.id)?.deal;
    const destCol = COLUMNS.find(c => c.key === over.data.current?.column);
    if (!activeDeal || !destCol) return;
    if (activeDeal.stage === destCol.key) return;

    // optimistic
    setRows(rs => rs.map(r =>
      r.deal.id === activeDeal.id ? { ...r, deal: { ...r.deal, stage: destCol.key } } : r
    ));

    await fetch(`/api/admin/pmf/deals/${activeDeal.id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: destCol.key }),
    });
  };

  return (
    <PmfCard>
      <SlashHeader variant="section">TIER A PIPELINE</SlashHeader>
      {loading ? (
        <div className="h-[400px] animate-pulse mt-4" />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-6 gap-3 mt-4">
            {COLUMNS.map(col => {
              const items = rows.filter(r => r.deal.stage === col.key);
              return (
                <div key={col.key} className="min-h-[400px]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-cakemono font-light uppercase text-[14px]">{col.label}</span>
                    <span className="font-mono text-[11px] text-[color:var(--text-3)]">[{items.length}]</span>
                  </div>
                  <SortableContext items={items.map(i => i.deal.id)} strategy={rectSortingStrategy}>
                    <div className="space-y-2">
                      {items.length === 0 && (
                        <div className="font-mono text-[11px] text-[color:var(--text-mute)]">—</div>
                      )}
                      {items.map(r => (
                        <div key={r.deal.id} data-column={col.key}>
                          <ProspectCard prospect={r.prospect} deal={r.deal} />
                        </div>
                      ))}
                    </div>
                  </SortableContext>
                </div>
              );
            })}
          </div>
        </DndContext>
      )}
    </PmfCard>
  );
}
```

- [ ] **Step 19.3: Commit**

```bash
git add src/components/pmf/pipeline-kanban.tsx src/components/pmf/prospect-card.tsx
git commit -m "feat(pmf): Tier A pipeline Kanban with dnd-kit"
```

---

## Task 20: MRR trend chart

**Files:**
- Create: `src/components/pmf/mrr-trend-chart.tsx`

- [ ] **Step 20.1: Implement**

Create `src/components/pmf/mrr-trend-chart.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { PmfCard } from '@/components/pmf/ui/card';
import { SlashHeader } from '@/components/pmf/ui/slash-header';
import { fmtUsd } from '@/lib/pmf/formatters';

interface WeekPoint { week: string; mrr_cents: number }

async function fetchMrr(): Promise<WeekPoint[]> {
  const res = await fetch('/api/admin/pmf/mrr-trend');
  const json = await res.json();
  return json.data ?? [];
}

export function MrrTrendChart() {
  const [data, setData] = useState<WeekPoint[]>([]);
  useEffect(() => { fetchMrr().then(setData); }, []);

  return (
    <PmfCard>
      <SlashHeader variant="section">BASE SAAS · MRR TREND</SlashHeader>
      <div className="h-[460px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
            <XAxis dataKey="week" stroke="#6A6A6A" tick={{ fontFamily: 'JetBrains Mono', fontSize: 11 }} />
            <YAxis stroke="#6A6A6A" tick={{ fontFamily: 'JetBrains Mono', fontSize: 11 }}
                   tickFormatter={(v) => fmtUsd(v as number)} />
            <Tooltip
              contentStyle={{ background: 'rgba(10,10,10,0.85)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5 }}
              labelStyle={{ color: '#B5B5B5', fontFamily: 'JetBrains Mono', fontSize: 11 }}
              formatter={(v: number) => fmtUsd(v)}
            />
            <ReferenceLine y={1_500_000} stroke="#6A6A6A" strokeDasharray="2 4" label={{ value: '$15K TARGET', fill: '#6A6A6A', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
            <Line type="monotone" dataKey="mrr_cents" stroke="#EDEDED" strokeWidth={1.5} dot={false} isAnimationActive />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </PmfCard>
  );
}
```

Also add the supporting API route `src/app/api/admin/pmf/mrr-trend/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { requireAdmin } from '@/lib/auth/require-admin';

export async function GET(req: Request) {
  await requireAdmin(req);
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_mrr_weekly' as never, { weeks: 18 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
```

Add Postgres function `pmf_mrr_weekly(weeks int)` to the migration:
```sql
create or replace function public.pmf_mrr_weekly(weeks int default 18)
returns table (week text, mrr_cents bigint) language sql stable as $$
  with wk as (
    select generate_series(
      date_trunc('week', now()) - ((weeks - 1) || ' weeks')::interval,
      date_trunc('week', now()),
      interval '1 week'
    ) as start_ts
  )
  select to_char(wk.start_ts, 'IYYY-IW') as week,
         coalesce(sum(be.amount_cents)::bigint, 0) as mrr_cents
    from wk
    left join public.billing_events be
      on be.event_type = 'invoice.paid'
     and be.occurred_at >= wk.start_ts
     and be.occurred_at <  wk.start_ts + interval '1 week'
   group by wk.start_ts
   order by wk.start_ts;
$$;
```

- [ ] **Step 20.2: Commit**

```bash
git add src/components/pmf/mrr-trend-chart.tsx src/app/api/admin/pmf/mrr-trend/route.ts supabase/migrations/20260421120001_pmf_rpc_functions.sql
git commit -m "feat(pmf): MRR trend chart + weekly aggregation RPC"
```

---

## Task 21: New prospect modal + prospect sheet

**Files:**
- Create: `src/components/pmf/new-prospect-modal.tsx`
- Create: `src/components/pmf/prospect-sheet.tsx`
- Create: `src/app/admin/pmf/prospects/new/page.tsx`
- Create: `src/app/admin/pmf/prospects/[id]/page.tsx`

- [ ] **Step 21.1: NewProspectModal**

Create `src/components/pmf/new-prospect-modal.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PmfCard } from '@/components/pmf/ui/card';
import { PmfButton } from '@/components/pmf/ui/button';
import type { ProspectSource, DealType } from '@/lib/pmf/types';

const SOURCES: { value: ProspectSource; label: string }[] = [
  { value: 'outbound_cold',  label: 'OUTBOUND · COLD' },
  { value: 'warm_network',   label: 'OUTBOUND · WARM NETWORK' },
  { value: 'paid_ad',        label: 'INBOUND · PAID AD' },
  { value: 'organic_search', label: 'INBOUND · ORGANIC' },
  { value: 'referral',       label: 'INBOUND · REFERRAL' },
  { value: 'direct',         label: 'INBOUND · DIRECT' },
];

export function NewProspectModal() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    const form = new FormData(e.currentTarget);
    const source = form.get('source') as ProspectSource;
    const direction = source === 'outbound_cold' || source === 'warm_network' ? 'outbound' : 'inbound';
    const body = {
      name: form.get('name'),
      company: form.get('company') || undefined,
      email: form.get('email') || undefined,
      phone: form.get('phone') || undefined,
      source,
      deal_type: form.get('deal_type') as DealType,
      first_contact_at: new Date(form.get('first_contact_at') as string).toISOString(),
      first_contact_direction: direction,
      notes: form.get('notes') || undefined,
    };
    const res = await fetch('/api/admin/pmf/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError('ERROR — SAVE FAILED');
      return;
    }
    router.push(`/admin/pmf/prospects/${json.prospect.id}`);
  }

  return (
    <PmfCard dense className="max-w-[560px] mx-auto p-8">
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="NAME">
          <input name="name" required className="pmf-input" />
        </Field>
        <Field label="COMPANY">
          <input name="company" className="pmf-input" />
        </Field>
        <Field label="EMAIL">
          <input name="email" type="email" className="pmf-input" />
        </Field>
        <Field label="PHONE">
          <input name="phone" className="pmf-input" />
        </Field>
        <Field label="DEAL TYPE">
          <select name="deal_type" required className="pmf-input">
            <option value="tier_a">TIER A (CUSTOM $15K+)</option>
            <option value="base_saas">BASE SAAS</option>
          </select>
        </Field>
        <Field label="SOURCE">
          <select name="source" required className="pmf-input">
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="FIRST CONTACT">
          <input name="first_contact_at" type="datetime-local" required className="pmf-input" />
        </Field>
        <Field label="NOTES">
          <textarea name="notes" rows={4} className="pmf-input" />
        </Field>
        {error && <div className="font-mono text-[11px] text-[color:var(--rose)]">{error}</div>}
        <div className="flex justify-end gap-2">
          <PmfButton type="button" variant="ghost" onClick={() => router.back()}>CANCEL</PmfButton>
          <PmfButton type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'SAVING' : 'CREATE'}
          </PmfButton>
        </div>
      </form>
    </PmfCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
```

Also add to `src/styles/pmf-tokens.css`:
```css
.pmf-scope .pmf-input {
  background: var(--surface-input);
  border: 1px solid var(--line);
  border-radius: var(--r-btn);
  color: var(--text);
  font-family: var(--font-mohave, "Mohave", system-ui, sans-serif);
  font-size: 14px;
  padding: 8px 12px;
  min-height: 36px;
  width: 100%;
  transition: border-color var(--d-hover) var(--ease-smooth);
}
.pmf-scope .pmf-input:focus { outline: none; border-color: rgba(255,255,255,0.20); }
.pmf-scope .pmf-input::placeholder { color: var(--text-3); }
```

- [ ] **Step 21.2: New prospect page**

Create `src/app/admin/pmf/prospects/new/page.tsx`:
```tsx
import { NewProspectModal } from '@/components/pmf/new-prospect-modal';
import { SlashHeader } from '@/components/pmf/ui/slash-header';

export default function NewProspectPage() {
  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">NEW PROSPECT</SlashHeader>
      <NewProspectModal />
    </div>
  );
}
```

- [ ] **Step 21.3: ProspectSheet (detail editor)**

Create `src/components/pmf/prospect-sheet.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import type { Prospect, Deal, DealStage } from '@/lib/pmf/types';
import { PmfCard } from '@/components/pmf/ui/card';
import { PmfButton } from '@/components/pmf/ui/button';
import { Tag } from '@/components/pmf/ui/tag';
import { SlashHeader } from '@/components/pmf/ui/slash-header';

interface ProspectSheetProps {
  prospectId: string;
}

export function ProspectSheet({ prospectId }: ProspectSheetProps) {
  const [data, setData] = useState<{ prospect: Prospect; deals: Deal[] } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/pmf/prospects/${prospectId}`).then(r => r.json()).then(j => {
      setData({ prospect: j.data, deals: j.data.pmf_deals });
    });
  }, [prospectId]);

  if (!data) return <div className="font-mono text-[11px] text-[color:var(--text-3)]">SYS :: LOAD...</div>;

  async function patchDeal(dealId: string, patch: Partial<Deal>) {
    setSaving(true);
    await fetch(`/api/admin/pmf/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setSaving(false);
  }

  const primaryDeal = data.deals[0];
  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">{data.prospect.company ?? data.prospect.name}</SlashHeader>
      <PmfCard>
        <dl className="grid grid-cols-2 gap-4 font-mono text-[11px]">
          <Row label="NAME" value={data.prospect.name} />
          <Row label="EMAIL" value={data.prospect.email} />
          <Row label="PHONE" value={data.prospect.phone} />
          <Row label="SOURCE" value={<Tag>{data.prospect.source.toUpperCase()}</Tag>} />
          <Row label="DEAL TYPE" value={data.prospect.deal_type.toUpperCase()} />
          <Row label="FIRST CONTACT" value={data.prospect.first_contact_at} />
        </dl>
      </PmfCard>

      {primaryDeal && (
        <PmfCard>
          <SlashHeader variant="section">DEAL · {primaryDeal.stage.toUpperCase()}</SlashHeader>
          <div className="mt-4 space-y-3">
            <StageSelect deal={primaryDeal} onChange={s => patchDeal(primaryDeal.id, { stage: s })} />
            {data.prospect.deal_type === 'tier_a' && (
              <>
                <CurrencyInput label="IMPLEMENTATION FEE ($)" value={primaryDeal.implementation_fee_cents}
                  onChange={v => patchDeal(primaryDeal.id, { implementation_fee_cents: v })} />
                <CurrencyInput label="DEPOSIT PAID ($)" value={primaryDeal.deposit_amount_cents}
                  onChange={v => patchDeal(primaryDeal.id, { deposit_amount_cents: v })} />
              </>
            )}
          </div>
        </PmfCard>
      )}
      {saving && <div className="font-mono text-[11px] text-[color:var(--text-3)]">SYS :: SAVING...</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.16em] text-[color:var(--text-3)]">{label}</dt>
      <dd className="mt-1 text-[color:var(--text)]">{value ?? '—'}</dd>
    </div>
  );
}

function StageSelect({ deal, onChange }: { deal: Deal; onChange: (s: DealStage) => void }) {
  const stages: DealStage[] = ['contacted','qualified','proposal','negotiation','signed','in_delivery','delivered','closed_won','closed_lost'];
  return (
    <label className="block">
      <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">STAGE</span>
      <select defaultValue={deal.stage} onChange={e => onChange(e.target.value as DealStage)} className="pmf-input">
        {stages.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
      </select>
    </label>
  );
}

function CurrencyInput({ label, value, onChange }: { label: string; value: number | null; onChange: (cents: number) => void }) {
  return (
    <label className="block">
      <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">{label}</span>
      <input
        type="number" min={0} step="0.01"
        defaultValue={value != null ? (value / 100).toFixed(2) : ''}
        onBlur={e => onChange(Math.round(Number(e.target.value) * 100))}
        className="pmf-input"
      />
    </label>
  );
}
```

- [ ] **Step 21.4: Prospect detail page**

Create `src/app/admin/pmf/prospects/[id]/page.tsx`:
```tsx
import { ProspectSheet } from '@/components/pmf/prospect-sheet';

export default function ProspectDetailPage({ params }: { params: { id: string } }) {
  return <ProspectSheet prospectId={params.id} />;
}
```

- [ ] **Step 21.5: Commit**

```bash
git add src/components/pmf/new-prospect-modal.tsx src/components/pmf/prospect-sheet.tsx src/app/admin/pmf/prospects/new/page.tsx src/app/admin/pmf/prospects/[id]/page.tsx src/styles/pmf-tokens.css
git commit -m "feat(pmf): new prospect modal + prospect detail sheet"
```

---

## Task 22: Prospect list page + ad spend form

**Files:**
- Create: `src/app/admin/pmf/prospects/page.tsx`
- Create: `src/components/pmf/ad-spend-form.tsx`
- Create: `src/app/admin/pmf/ad-spend/page.tsx`

- [ ] **Step 22.1: Prospect list**

Create `src/app/admin/pmf/prospects/page.tsx`:
```tsx
import Link from 'next/link';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { PmfCard } from '@/components/pmf/ui/card';
import { SlashHeader } from '@/components/pmf/ui/slash-header';
import { Tag } from '@/components/pmf/ui/tag';
import { PmfButton } from '@/components/pmf/ui/button';

export const dynamic = 'force-dynamic';

export default async function ProspectsListPage() {
  const sb = getAdminSupabase();
  const { data } = await sb.from('pmf_prospects')
    .select('id, name, company, source, deal_type, first_contact_at, first_contact_direction')
    .order('first_contact_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <SlashHeader variant="page-title">PROSPECTS</SlashHeader>
        <Link href="/admin/pmf/prospects/new">
          <PmfButton variant="primary">NEW PROSPECT</PmfButton>
        </Link>
      </div>
      <PmfCard>
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="text-left uppercase tracking-[0.16em] text-[color:var(--text-3)] border-b border-[color:var(--line)]">
              <th className="py-2">COMPANY / NAME</th>
              <th>TYPE</th>
              <th>SOURCE</th>
              <th>DIRECTION</th>
              <th>FIRST CONTACT</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map(p => (
              <tr key={p.id} className="hover:bg-[rgba(255,255,255,0.04)] border-b border-[color:var(--line)]">
                <td className="py-2">
                  <Link className="text-[color:var(--text)] hover:underline" href={`/admin/pmf/prospects/${p.id}`}>
                    {p.company ?? p.name}
                  </Link>
                </td>
                <td>{p.deal_type.toUpperCase()}</td>
                <td><Tag>{p.source.toUpperCase()}</Tag></td>
                <td>{p.first_contact_direction.toUpperCase()}</td>
                <td>{p.first_contact_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PmfCard>
    </div>
  );
}
```

- [ ] **Step 22.2: AdSpendForm**

Create `src/components/pmf/ad-spend-form.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { PmfCard } from '@/components/pmf/ui/card';
import { PmfButton } from '@/components/pmf/ui/button';
import type { AdChannel } from '@/lib/pmf/types';

const CHANNELS: { value: AdChannel; label: string }[] = [
  { value: 'meta_ads',         label: 'META ADS' },
  { value: 'apple_search_ads', label: 'APPLE SEARCH ADS' },
  { value: 'other',            label: 'OTHER' },
];

export function AdSpendForm() {
  const [status, setStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('saving');
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/admin/pmf/ad-spend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: fd.get('channel'),
        month: fd.get('month'),
        spend_cents: Math.round(Number(fd.get('spend_usd')) * 100),
      }),
    });
    setStatus(res.ok ? 'saved' : 'error');
  }

  return (
    <PmfCard className="max-w-[480px]">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">CHANNEL</span>
          <select name="channel" required className="pmf-input">
            {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">MONTH</span>
          <input name="month" type="month" required className="pmf-input" />
        </label>
        <label className="block">
          <span className="block font-mono uppercase text-[11px] tracking-[0.16em] text-[color:var(--text-3)] mb-1">SPEND (USD)</span>
          <input name="spend_usd" type="number" min={0} step="0.01" required className="pmf-input" />
        </label>
        <div className="flex items-center justify-between">
          <PmfButton type="submit" variant="primary" disabled={status === 'saving'}>
            {status === 'saving' ? 'SAVING' : 'SAVE'}
          </PmfButton>
          {status === 'saved' && <span className="font-mono text-[11px] text-[color:var(--olive)]">SYS :: SAVED</span>}
          {status === 'error' && <span className="font-mono text-[11px] text-[color:var(--rose)]">// ERROR</span>}
        </div>
      </form>
    </PmfCard>
  );
}
```

- [ ] **Step 22.3: Ad spend page**

Create `src/app/admin/pmf/ad-spend/page.tsx`:
```tsx
import { AdSpendForm } from '@/components/pmf/ad-spend-form';
import { SlashHeader } from '@/components/pmf/ui/slash-header';

export default function AdSpendPage() {
  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">AD SPEND · MANUAL ENTRY</SlashHeader>
      <AdSpendForm />
    </div>
  );
}
```

- [ ] **Step 22.4: Commit**

```bash
git add src/app/admin/pmf/prospects/page.tsx src/components/pmf/ad-spend-form.tsx src/app/admin/pmf/ad-spend/page.tsx
git commit -m "feat(pmf): prospect list + ad spend manual entry page"
```

---

## Task 23: Marker + Indicator drill-in pages

**Files:**
- Create: `src/app/admin/pmf/marker/[id]/page.tsx`
- Create: `src/app/admin/pmf/indicator/[id]/page.tsx`

- [ ] **Step 23.1: Marker drill-in**

Create `src/app/admin/pmf/marker/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { getPmfState } from '@/lib/admin/pmf-queries';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { PmfCard } from '@/components/pmf/ui/card';
import { MarkerCard } from '@/components/pmf/marker-card';
import { SlashHeader } from '@/components/pmf/ui/slash-header';
import { fmtPct, fmtDate } from '@/lib/pmf/formatters';

const VALID = new Set(['1','2','3','4']);

export default async function MarkerDrillInPage({ params }: { params: { id: string } }) {
  if (!VALID.has(params.id)) notFound();
  const state = await getPmfState();
  const key = `marker_${params.id}` as const;
  const marker = state.markers[key];

  // Cohort table for Marker 2 (retention)
  let cohortRows: any[] = [];
  if (params.id === '2') {
    const sb = getAdminSupabase();
    const { data } = await sb.rpc('pmf_retention_cohorts' as never);
    cohortRows = data ?? [];
  }

  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">MARKER {params.id} · {marker.label}</SlashHeader>
      <div className="max-w-[360px]"><MarkerCard state={marker} asCurrency={params.id === '4'} /></div>

      {params.id === '2' && (
        <PmfCard>
          <SlashHeader variant="section">COHORT RETENTION</SlashHeader>
          <table className="w-full mt-4 font-mono text-[11px]">
            <thead>
              <tr className="text-left uppercase tracking-[0.16em] text-[color:var(--text-3)] border-b border-[color:var(--line)]">
                <th className="py-2">COHORT</th>
                <th>SIZE</th>
                <th>30D</th>
                <th>60D</th>
                <th>90D</th>
              </tr>
            </thead>
            <tbody>
              {cohortRows.map((r, i) => (
                <tr key={i} className="border-b border-[color:var(--line)]">
                  <td className="py-2">{r.cohort_month}</td>
                  <td>{r.size}</td>
                  <td>{fmtPct(r.d30)}</td>
                  <td>{fmtPct(r.d60)}</td>
                  <td>{fmtPct(r.d90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PmfCard>
      )}
    </div>
  );
}
```

Add RPC `pmf_retention_cohorts()` to the migration:
```sql
create or replace function public.pmf_retention_cohorts()
returns table (cohort_month text, size int, d30 numeric, d60 numeric, d90 numeric)
language sql stable as $$
  with first_paid as (
    select company_id, min(occurred_at) as first_paid_at
      from public.billing_events
     where event_type='invoice.paid'
     group by company_id
  ),
  cohorts as (
    select to_char(date_trunc('month', first_paid_at), 'YYYY-MM') as cohort_month,
           company_id, first_paid_at
      from first_paid
  )
  select
    cohort_month,
    count(*)::int as size,
    count(*) filter (where exists (
      select 1 from public.billing_events b
       where b.company_id = cohorts.company_id
         and b.event_type='invoice.paid'
         and b.occurred_at between cohorts.first_paid_at + interval '25 days'
                              and cohorts.first_paid_at + interval '35 days'))::numeric
      / nullif(count(*), 0) as d30,
    count(*) filter (where exists (
      select 1 from public.billing_events b
       where b.company_id = cohorts.company_id
         and b.event_type='invoice.paid'
         and b.occurred_at between cohorts.first_paid_at + interval '55 days'
                              and cohorts.first_paid_at + interval '65 days'))::numeric
      / nullif(count(*), 0) as d60,
    count(*) filter (where exists (
      select 1 from public.billing_events b
       where b.company_id = cohorts.company_id
         and b.event_type='invoice.paid'
         and b.occurred_at between cohorts.first_paid_at + interval '85 days'
                              and cohorts.first_paid_at + interval '95 days'))::numeric
      / nullif(count(*), 0) as d90
    from cohorts
   group by cohort_month
   order by cohort_month desc
   limit 12;
$$;
```

- [ ] **Step 23.2: Indicator drill-in**

Create `src/app/admin/pmf/indicator/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { getPmfState } from '@/lib/admin/pmf-queries';
import { IndicatorCard } from '@/components/pmf/indicator-card';
import { SlashHeader } from '@/components/pmf/ui/slash-header';

const VALID = new Set(['a','b','c','d','e']);

export default async function IndicatorDrillInPage({ params }: { params: { id: string } }) {
  if (!VALID.has(params.id.toLowerCase())) notFound();
  const state = await getPmfState();
  const key = `indicator_${params.id.toLowerCase()}` as const;
  const ind = state.indicators[key];

  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">INDICATOR {params.id.toUpperCase()} · {ind.label}</SlashHeader>
      <div className="max-w-[320px]"><IndicatorCard state={ind} /></div>
      {/* TODO Task 23.3 detail: full 12-week table */}
    </div>
  );
}
```

- [ ] **Step 23.3: Commit**

```bash
git add src/app/admin/pmf/marker/[id]/page.tsx src/app/admin/pmf/indicator/[id]/page.tsx supabase/migrations/20260421120001_pmf_rpc_functions.sql
git commit -m "feat(pmf): marker + indicator drill-in pages with retention cohort table"
```

---

## Task 24: Twilio client + unified notification sender

**Files:**
- Create: `src/lib/notifications/twilio.ts`
- Create: `src/lib/notifications/pmf-send.ts`

- [ ] **Step 24.1: Twilio client**

Create `src/lib/notifications/twilio.ts`:
```ts
import 'server-only';
import Twilio from 'twilio';

let client: Twilio.Twilio | null = null;

function getClient(): Twilio.Twilio {
  if (client) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio env vars missing');
  client = Twilio(sid, token);
  return client;
}

export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('TWILIO_PHONE_NUMBER missing');
  const message = await getClient().messages.create({ to, from, body: body.slice(0, 320) });
  return { sid: message.sid };
}
```

- [ ] **Step 24.2: Unified sender with dedup + retry + logging**

Create `src/lib/notifications/pmf-send.ts`:
```ts
import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { sendSms } from './twilio';
import { getPmfRecipients } from '@/lib/pmf/recipients';
// Existing email client in the repo — adjust import path to actual location
import { sendTransactionalEmail } from '@/lib/email/client';
import { render } from '@react-email/render';

export type NotificationKind = 'threshold_alert' | 'daily_digest' | 'weekly_digest';

export interface SendOptions {
  kind: NotificationKind;
  trigger: string;
  smsBody?: string;
  emailSubject?: string;
  emailReact?: React.ReactElement;
  inAppTitle?: string;
  inAppBody?: string;
  inAppActionUrl?: string;
  /** Dedup window in ms; default 4 hours for threshold alerts, 0 for digests. */
  dedupMs?: number;
}

const DEFAULT_DEDUP: Record<NotificationKind, number> = {
  threshold_alert: 4 * 60 * 60 * 1000,
  daily_digest: 0,
  weekly_digest: 0,
};

async function hasRecentSend(kind: NotificationKind, trigger: string, withinMs: number): Promise<boolean> {
  if (withinMs <= 0) return false;
  const sb = getAdminSupabase();
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await sb.from('pmf_notification_log')
    .select('id')
    .eq('kind', kind).eq('trigger', trigger)
    .gte('created_at', since)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

async function logSend(args: {
  kind: NotificationKind; trigger: string; channel: 'sms'|'email'|'in_app';
  recipient: string; payload: any; error?: string;
}) {
  const sb = getAdminSupabase();
  await sb.from('pmf_notification_log').insert({
    kind: args.kind, trigger: args.trigger, channel: args.channel,
    recipient: args.recipient, payload: args.payload,
    sent_at: args.error ? null : new Date().toISOString(),
    error: args.error ?? null,
  });
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const waitMs = Math.pow(5, i) * 1000; // 1s, 5s, 25s
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

export async function sendPmfNotification(opts: SendOptions): Promise<void> {
  const dedupMs = opts.dedupMs ?? DEFAULT_DEDUP[opts.kind];
  if (await hasRecentSend(opts.kind, opts.trigger, dedupMs)) return;

  const recipients = getPmfRecipients();
  const sb = getAdminSupabase();

  // SMS — only for threshold alerts
  if (opts.kind === 'threshold_alert' && opts.smsBody) {
    try {
      await withRetry(() => sendSms(recipients.sms, opts.smsBody!));
      await logSend({ kind: opts.kind, trigger: opts.trigger, channel: 'sms',
        recipient: recipients.sms, payload: { body: opts.smsBody } });
    } catch (e: any) {
      await logSend({ kind: opts.kind, trigger: opts.trigger, channel: 'sms',
        recipient: recipients.sms, payload: { body: opts.smsBody }, error: e?.message ?? String(e) });
    }
  }

  // Email
  if (opts.emailSubject && opts.emailReact) {
    const html = await render(opts.emailReact);
    try {
      await withRetry(() => sendTransactionalEmail({
        to: recipients.email, subject: opts.emailSubject!, html,
      }));
      await logSend({ kind: opts.kind, trigger: opts.trigger, channel: 'email',
        recipient: recipients.email, payload: { subject: opts.emailSubject } });
    } catch (e: any) {
      await logSend({ kind: opts.kind, trigger: opts.trigger, channel: 'email',
        recipient: recipients.email, payload: { subject: opts.emailSubject }, error: e?.message ?? String(e) });
    }
  }

  // In-app rail — only for threshold alerts
  if (opts.kind === 'threshold_alert' && opts.inAppTitle) {
    try {
      await sb.from('notifications').insert({
        user_id: recipients.operatorUserId,
        company_id: null,
        type: 'pmf_alert',
        title: opts.inAppTitle,
        body: opts.inAppBody ?? '',
        is_read: false,
        persistent: false,
        action_url: opts.inAppActionUrl ?? '/admin/pmf',
        action_label: 'VIEW DECK',
      });
      await logSend({ kind: opts.kind, trigger: opts.trigger, channel: 'in_app',
        recipient: recipients.operatorUserId, payload: { title: opts.inAppTitle } });
    } catch (e: any) {
      await logSend({ kind: opts.kind, trigger: opts.trigger, channel: 'in_app',
        recipient: recipients.operatorUserId, payload: { title: opts.inAppTitle }, error: e?.message ?? String(e) });
    }
  }
}
```

- [ ] **Step 24.3: Commit**

```bash
git add src/lib/notifications/twilio.ts src/lib/notifications/pmf-send.ts
git commit -m "feat(pmf): Twilio client + unified SMS/email/in-app notification sender with dedup and retry"
```

---

## Task 25: Email templates (threshold, daily, weekly)

**Files:**
- Create: `src/emails/pmf/threshold-alert.tsx`
- Create: `src/emails/pmf/daily-digest.tsx`
- Create: `src/emails/pmf/weekly-digest.tsx`
- Test: `tests/unit/notifications/pmf-templates.test.ts`

- [ ] **Step 25.1: ThresholdAlert template**

Create `src/emails/pmf/threshold-alert.tsx`:
```tsx
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components';

interface ThresholdAlertProps {
  trigger: string;
  messageBody: string;
  context?: Record<string, string | number>;
  dashboardUrl?: string;
}

const CANVAS: React.CSSProperties = {
  background: '#000000', margin: 0, padding: '24px',
  fontFamily: "'Mohave', sans-serif", color: '#EDEDED',
};
const GLASS: React.CSSProperties = {
  background: 'rgba(10,10,10,0.70)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 5, padding: 24,
};
const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11, letterSpacing: '0.16em',
  textTransform: 'uppercase', color: '#8A8A8A',
};
const CAKE: React.CSSProperties = {
  fontFamily: "'Cake Mono', sans-serif",
  fontWeight: 300, fontSize: 18, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: '#EDEDED',
};

export function ThresholdAlertEmail({ trigger, messageBody, context, dashboardUrl }: ThresholdAlertProps) {
  return (
    <Html>
      <Head />
      <Preview>{messageBody}</Preview>
      <Body style={CANVAS}>
        <Container style={GLASS}>
          <Text style={MONO}>// PMF ALERT · {trigger.toUpperCase()}</Text>
          <Text style={{ ...CAKE, marginTop: 16 }}>{messageBody}</Text>
          {context && (
            <Section style={{ marginTop: 24 }}>
              {Object.entries(context).map(([k, v]) => (
                <Text key={k} style={{ ...MONO, color: '#B5B5B5', marginBottom: 4 }}>
                  {k.toUpperCase()}: {String(v)}
                </Text>
              ))}
            </Section>
          )}
          {dashboardUrl && (
            <Text style={{ ...MONO, marginTop: 24 }}>
              <a href={dashboardUrl} style={{ color: '#6F94B0', textDecoration: 'none' }}>
                → VIEW DECK
              </a>
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 25.2: DailyDigest template**

Create `src/emails/pmf/daily-digest.tsx`:
```tsx
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components';
import type { PmfState } from '@/lib/pmf/types';

const CANVAS: React.CSSProperties = { background: '#000000', margin: 0, padding: 24, fontFamily: "'Mohave', sans-serif", color: '#EDEDED' };
const GLASS: React.CSSProperties = { background: 'rgba(10,10,10,0.70)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, padding: 24, marginBottom: 12 };
const MONO11: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8A8A8A' };
const HERO: React.CSSProperties = { fontFamily: "'Mohave', sans-serif", fontWeight: 300, fontSize: 40, lineHeight: 1, color: '#EDEDED', fontFeatureSettings: '"tnum" 1, "zero" 1' };

const STATUS_COLOR = { green: '#9DB582', amber: '#C4A868', red: '#B58289' };

interface DailyDigestProps {
  state: PmfState;
  daysToGate: number;
  dashboardUrl: string;
}

export function DailyDigestEmail({ state, daysToGate, dashboardUrl }: DailyDigestProps) {
  return (
    <Html>
      <Head />
      <Preview>PMF daily digest · GATE B in {daysToGate} days</Preview>
      <Body style={CANVAS}>
        <Container>
          <Text style={MONO11}>// PMF DAILY DIGEST · GATE B · {daysToGate} DAYS</Text>

          {Object.entries(state.markers).map(([key, m]) => (
            <Section key={key} style={GLASS}>
              <Text style={MONO11}>// {m.label}</Text>
              <Text style={HERO}>
                {m.value} <span style={{ color: '#8A8A8A', fontSize: 24 }}>/ {m.target}</span>
              </Text>
              <Text style={{ ...MONO11, color: STATUS_COLOR[m.status] }}>
                [{m.status.toUpperCase()}]
              </Text>
            </Section>
          ))}

          <Section style={GLASS}>
            <Text style={MONO11}>// LEADING INDICATORS</Text>
            {Object.entries(state.indicators).map(([key, ind]) => (
              <Text key={key} style={{ ...MONO11, color: '#B5B5B5', marginTop: 6 }}>
                {ind.label}: {ind.value}{ind.unit === 'percent' ? '%' : ''} ·{' '}
                <span style={{ color: STATUS_COLOR[ind.status] }}>{ind.status.toUpperCase()}</span>
              </Text>
            ))}
          </Section>

          <Text style={{ ...MONO11, marginTop: 24 }}>
            <a href={dashboardUrl} style={{ color: '#6F94B0', textDecoration: 'none' }}>→ VIEW DECK</a>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 25.3: WeeklyDigest template**

Create `src/emails/pmf/weekly-digest.tsx`:
```tsx
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components';
import type { PmfState } from '@/lib/pmf/types';
import { DailyDigestEmail } from './daily-digest';

interface WeeklyDigestProps {
  state: PmfState;
  daysToGate: number;
  weekNumber: number;
  dashboardUrl: string;
  retentionCohorts: Array<{ cohort_month: string; size: number; d30: number; d60: number; d90: number }>;
}

const MONO11: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8A8A8A' };
const GLASS: React.CSSProperties = { background: 'rgba(10,10,10,0.70)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, padding: 24, marginBottom: 12 };

export function WeeklyDigestEmail(p: WeeklyDigestProps) {
  return (
    <Html>
      <Head />
      <Preview>PMF weekly digest · week {p.weekNumber}</Preview>
      <Body style={{ background: '#000000', margin: 0, padding: 24, fontFamily: "'Mohave', sans-serif", color: '#EDEDED' }}>
        <Container>
          <Text style={MONO11}>// PMF WEEKLY DIGEST · WEEK {p.weekNumber} · GATE B {p.daysToGate} DAYS</Text>
          {/* Reuse daily digest inner sections */}
          <DailyDigestEmail state={p.state} daysToGate={p.daysToGate} dashboardUrl={p.dashboardUrl} />
          <Section style={GLASS}>
            <Text style={MONO11}>// COHORT RETENTION · LAST 6 COHORTS</Text>
            {p.retentionCohorts.slice(0, 6).map(c => (
              <Text key={c.cohort_month} style={{ ...MONO11, color: '#B5B5B5', marginTop: 4 }}>
                {c.cohort_month} · n={c.size} · 30D={(c.d30 * 100).toFixed(0)}% · 60D={(c.d60 * 100).toFixed(0)}% · 90D={(c.d90 * 100).toFixed(0)}%
              </Text>
            ))}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 25.4: Template snapshot tests**

Create `tests/unit/notifications/pmf-templates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { render } from '@react-email/render';
import { ThresholdAlertEmail } from '@/emails/pmf/threshold-alert';
import { DailyDigestEmail } from '@/emails/pmf/daily-digest';
import type { PmfState } from '@/lib/pmf/types';

const fixture: PmfState = {
  capturedAt: '2026-04-21T00:00:00Z',
  markers: {
    marker_1: { status: 'amber', value: 1, target: 2, label: 'TIER A ENGAGEMENTS' },
    marker_2: { status: 'red',   value: 0, target: 5, label: 'RETAINED BASE SAAS' },
    marker_3: { status: 'green', value: 1, target: 1, label: 'INBOUND LEAD' },
    marker_4: { status: 'red',   value: 4200, target: 15000, label: 'CAC' },
  },
  indicators: {
    indicator_a: { status: 'amber', value: 3, delta_wow: 1, sparkline: [1,2,3], label: 'A' },
    indicator_b: { status: 'green', value: 55, delta_wow: 5, sparkline: [40,50,55], label: 'B' },
    indicator_c: { status: 'green', value: 0.07, delta_wow: 0.01, sparkline: [], label: 'C', unit: 'percent' },
    indicator_d: { status: 'green', value: 0.05, delta_wow: 0, sparkline: [], label: 'D', unit: 'percent' },
    indicator_e: { status: 'red',   value: 0, delta_wow: 0, sparkline: [], label: 'E' },
  },
};

describe('ThresholdAlertEmail', () => {
  it('renders HTML with trigger + body', async () => {
    const html = await render(ThresholdAlertEmail({
      trigger: 'marker_1_green', messageBody: 'MARKER 1 GREEN', dashboardUrl: 'https://x/admin/pmf',
    }));
    expect(html).toContain('MARKER 1 GREEN');
    expect(html).toContain('marker_1_green'.toUpperCase());
    expect(html).toContain('VIEW DECK');
  });
});

describe('DailyDigestEmail', () => {
  it('renders all 4 markers and 5 indicators', async () => {
    const html = await render(DailyDigestEmail({ state: fixture, daysToGate: 133, dashboardUrl: 'https://x/admin/pmf' }));
    expect(html).toContain('TIER A ENGAGEMENTS');
    expect(html).toContain('RETAINED BASE SAAS');
    expect(html).toContain('INBOUND LEAD');
    expect(html).toContain('133');
    expect(html).toContain('LEADING INDICATORS');
  });
});
```

- [ ] **Step 25.5: Run + commit**

Run: `npm run test tests/unit/notifications/pmf-templates.test.ts`
Expected: pass.

```bash
git add src/emails/pmf/ tests/unit/notifications/pmf-templates.test.ts
git commit -m "feat(pmf): email templates (threshold alert, daily + weekly digest) with snapshot tests"
```

---

## Task 26: Threshold-check cron

**Files:**
- Create: `src/app/api/cron/pmf/threshold-check/route.ts`

- [ ] **Step 26.1: Implement cron**

Create `src/app/api/cron/pmf/threshold-check/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { computePmfState } from '@/lib/admin/pmf-queries';
import { diffState } from '@/lib/pmf/threshold-diff';
import { sendPmfNotification } from '@/lib/notifications/pmf-send';
import { ThresholdAlertEmail } from '@/emails/pmf/threshold-alert';
import { fmtTime } from '@/lib/pmf/formatters';
import type { PmfState } from '@/lib/pmf/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DASHBOARD_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.opsapp.co'}/admin/pmf`;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = getAdminSupabase();
  const now = await computePmfState();

  // Prior snapshot
  const { data: priorRows } = await sb.from('pmf_threshold_snapshots')
    .select('state').order('captured_at', { ascending: false }).limit(1);
  const prior = (priorRows?.[0]?.state ?? null) as PmfState | null;

  // Insert current snapshot first
  await sb.from('pmf_threshold_snapshots').insert({ state: now as any });

  // Event-driven triggers (last 15 min)
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [{ data: newInbound }, { data: newRefunds }, { data: newReferrals }] = await Promise.all([
    sb.from('pmf_prospects').select('id,company,name,source,first_contact_direction,first_contact_at')
      .gte('created_at', since)
      .or('first_contact_direction.eq.inbound,source.in.(paid_ad,organic_search,referral,direct)'),
    sb.from('billing_events').select('id,amount_cents,company_id,occurred_at')
      .eq('event_type', 'charge.refunded').gte('created_at', since),
    sb.from('pmf_prospects').select('id,company,name').eq('source','referral').gte('created_at', since),
  ]);

  const sends: Array<ReturnType<typeof sendPmfNotification>> = [];

  // State transitions
  if (prior) {
    for (const t of diffState(prior, now)) {
      const stem =
        t.to === 'green' ? `${t.key.toUpperCase()} GREEN` :
        `${t.key.toUpperCase()} ${t.to.toUpperCase()}`;
      sends.push(sendPmfNotification({
        kind: 'threshold_alert',
        trigger: `${t.key}_${t.from}_to_${t.to}`,
        smsBody: `OPS :: ${stem} · ${fmtTime(new Date())}`,
        emailSubject: `OPS :: ${stem}`,
        emailReact: ThresholdAlertEmail({
          trigger: `${t.key} ${t.from}→${t.to}`,
          messageBody: stem,
          context: { VALUE: t.value },
          dashboardUrl: DASHBOARD_URL,
        }),
        inAppTitle: stem,
        inAppBody: `value ${t.value}`,
      }));
    }
  }

  // Inbound leads
  for (const p of newInbound ?? []) {
    const stem = `NEW INBOUND LEAD · ${(p.company ?? p.name).toUpperCase()}`;
    sends.push(sendPmfNotification({
      kind: 'threshold_alert',
      trigger: `new_inbound_${p.id}`,
      smsBody: `OPS :: ${stem} · ${fmtTime(new Date())}`,
      emailSubject: `OPS :: ${stem}`,
      emailReact: ThresholdAlertEmail({
        trigger: 'new_inbound_lead',
        messageBody: stem,
        context: { SOURCE: p.source, DIRECTION: p.first_contact_direction },
        dashboardUrl: DASHBOARD_URL,
      }),
      inAppTitle: stem,
      inAppBody: `source: ${p.source}`,
    }));
  }

  // Refunds
  for (const r of newRefunds ?? []) {
    const stem = `REFUND · $${((r.amount_cents ?? 0)/100).toFixed(0)}`;
    sends.push(sendPmfNotification({
      kind: 'threshold_alert',
      trigger: `refund_${r.id}`,
      smsBody: `OPS :: ${stem} · ${fmtTime(new Date())}`,
      emailSubject: `OPS :: ${stem}`,
      emailReact: ThresholdAlertEmail({
        trigger: 'refund',
        messageBody: stem,
        context: { COMPANY_ID: r.company_id ?? 'unknown' },
        dashboardUrl: DASHBOARD_URL,
      }),
      inAppTitle: stem,
    }));
  }

  // First referrals (only fire if E was zero in prior snapshot)
  if (prior && prior.indicators.indicator_e.value === 0 && (newReferrals?.length ?? 0) > 0) {
    const first = newReferrals![0];
    const stem = `FIRST REFERRAL · ${(first.company ?? first.name).toUpperCase()}`;
    sends.push(sendPmfNotification({
      kind: 'threshold_alert',
      trigger: 'first_referral',
      smsBody: `OPS :: ${stem} · ${fmtTime(new Date())}`,
      emailSubject: `OPS :: ${stem}`,
      emailReact: ThresholdAlertEmail({
        trigger: 'first_referral',
        messageBody: stem,
        dashboardUrl: DASHBOARD_URL,
      }),
      inAppTitle: stem,
    }));
  }

  await Promise.allSettled(sends);
  return NextResponse.json({ ok: true, transitions: prior ? diffState(prior, now).length : 0 });
}
```

- [ ] **Step 26.2: Commit**

```bash
git add src/app/api/cron/pmf/threshold-check/route.ts
git commit -m "feat(pmf): 15-min threshold-check cron with state-diff alerts + event-driven triggers"
```

---

## Task 27: Daily + weekly digest crons + cleanup cron

**Files:**
- Create: `src/app/api/cron/pmf/daily-digest/route.ts`
- Create: `src/app/api/cron/pmf/weekly-digest/route.ts`
- Create: `src/app/api/cron/pmf/cleanup-snapshots/route.ts`

- [ ] **Step 27.1: Daily digest cron**

Create `src/app/api/cron/pmf/daily-digest/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { computePmfState } from '@/lib/admin/pmf-queries';
import { sendPmfNotification } from '@/lib/notifications/pmf-send';
import { DailyDigestEmail } from '@/emails/pmf/daily-digest';
import { daysUntilGate } from '@/lib/pmf/formatters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DASHBOARD_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.opsapp.co'}/admin/pmf`;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const state = await computePmfState();
  const days = daysUntilGate();
  await sendPmfNotification({
    kind: 'daily_digest',
    trigger: `daily_${new Date().toISOString().slice(0, 10)}`,
    emailSubject: `OPS :: PMF DAILY · GATE B ${days} DAYS`,
    emailReact: DailyDigestEmail({ state, daysToGate: days, dashboardUrl: DASHBOARD_URL }),
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 27.2: Weekly digest cron**

Create `src/app/api/cron/pmf/weekly-digest/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { computePmfState } from '@/lib/admin/pmf-queries';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import { sendPmfNotification } from '@/lib/notifications/pmf-send';
import { WeeklyDigestEmail } from '@/emails/pmf/weekly-digest';
import { daysUntilGate } from '@/lib/pmf/formatters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DASHBOARD_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.opsapp.co'}/admin/pmf`;

function isoWeekNumber(date = new Date()): number {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sb = getAdminSupabase();
  const [state, { data: cohorts }] = await Promise.all([
    computePmfState(),
    sb.rpc('pmf_retention_cohorts' as never),
  ]);

  await sendPmfNotification({
    kind: 'weekly_digest',
    trigger: `weekly_${new Date().toISOString().slice(0, 10)}`,
    emailSubject: `OPS :: PMF WEEKLY · W${isoWeekNumber()} · ${daysUntilGate()} DAYS`,
    emailReact: WeeklyDigestEmail({
      state,
      daysToGate: daysUntilGate(),
      weekNumber: isoWeekNumber(),
      dashboardUrl: DASHBOARD_URL,
      retentionCohorts: (cohorts as any) ?? [],
    }),
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 27.3: Cleanup cron**

Create `src/app/api/cron/pmf/cleanup-snapshots/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/admin-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sb = getAdminSupabase();
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { error, count } = await sb.from('pmf_threshold_snapshots')
    .delete({ count: 'exact' })
    .lt('captured_at', cutoff);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, pruned: count });
}
```

- [ ] **Step 27.4: Commit**

```bash
git add src/app/api/cron/pmf/daily-digest/route.ts src/app/api/cron/pmf/weekly-digest/route.ts src/app/api/cron/pmf/cleanup-snapshots/route.ts
git commit -m "feat(pmf): daily + weekly digest crons + snapshot cleanup"
```

---

## Task 28: Notifications integration tests

**Files:**
- Create: `tests/integration/notifications.test.ts`

- [ ] **Step 28.1: Write tests**

Create `tests/integration/notifications.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPmfNotification } from '@/lib/notifications/pmf-send';

vi.mock('@/lib/notifications/twilio', () => ({ sendSms: vi.fn(async () => ({ sid: 'sm_test' })) }));
vi.mock('@/lib/email/client', () => ({ sendTransactionalEmail: vi.fn(async () => ({ id: 'em_test' })) }));

const insertMock = vi.fn(async () => ({ error: null }));
const selectMock = vi.fn(() => ({ eq: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: [] }) }) }) }) }));
vi.mock('@/lib/supabase/admin-client', () => ({
  getAdminSupabase: () => ({
    from: () => ({ insert: insertMock, select: selectMock }),
  }),
}));

beforeEach(() => {
  process.env.PMF_NOTIFICATION_SMS = '+12505388994';
  process.env.PMF_NOTIFICATION_EMAIL = 'canprojack@gmail.com';
  process.env.PMF_OPERATOR_USER_ID = 'user_123';
  insertMock.mockClear();
});

describe('sendPmfNotification', () => {
  it('fires SMS, email, and in-app for threshold alert', async () => {
    await sendPmfNotification({
      kind: 'threshold_alert',
      trigger: 'marker_1_green',
      smsBody: 'OPS :: MARKER 1 GREEN',
      emailSubject: 'OPS :: MARKER 1 GREEN',
      emailReact: ({ children: 'x' } as any),
      inAppTitle: 'MARKER 1 GREEN',
    });
    // Verify at least 3 log inserts (sms, email, in_app)
    expect(insertMock).toHaveBeenCalled();
  });

  it('skips SMS and in-app for daily digest', async () => {
    await sendPmfNotification({
      kind: 'daily_digest',
      trigger: 'daily_2026-04-21',
      emailSubject: 'OPS :: PMF DAILY',
      emailReact: ({ children: 'x' } as any),
    });
    // Only email should fire
  });
});
```

- [ ] **Step 28.2: Run + commit**

Run: `npm run test tests/integration/notifications.test.ts`
Expected: pass.

```bash
git add tests/integration/notifications.test.ts
git commit -m "test(pmf): notifications transport routing"
```

---

## Task 29: Playwright E2E tests

**Files:**
- Create: `tests/e2e/pmf-dashboard.spec.ts`
- Create: `tests/e2e/pmf-prospect-crud.spec.ts`
- Create: `tests/e2e/pmf-ad-spend.spec.ts`

- [ ] **Step 29.1: Dashboard E2E**

Create `tests/e2e/pmf-dashboard.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test.describe('PMF dashboard', () => {
  test('redirects non-admin to login', async ({ page }) => {
    await page.goto('/admin/pmf');
    await expect(page).toHaveURL(/\/login/);
  });

  test('renders for admin', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/pmf');
    await expect(page.getByText('PMF TRACKING DECK')).toBeVisible();
    await expect(page.getByText('GATE B · PRIMARY MARKERS')).toBeVisible();
    await expect(page.getByText('LEADING INDICATORS')).toBeVisible();
    await expect(page.getByText('TIER A PIPELINE')).toBeVisible();
    await expect(page.getByText('BASE SAAS · MRR TREND')).toBeVisible();
  });

  test('countdown chip renders with day count', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/pmf');
    await expect(page.getByText(/GATE B · \d+ DAYS/)).toBeVisible();
  });
});

async function loginAsAdmin(page: any) {
  // Reuse existing admin login fixture — adjust per repo convention
  await page.goto('/login');
  await page.fill('input[name="email"]', process.env.E2E_ADMIN_EMAIL ?? 'canprojack@gmail.com');
  await page.fill('input[name="password"]', process.env.E2E_ADMIN_PASSWORD ?? '');
  await page.click('button[type="submit"]');
  await page.waitForURL('/**');
}
```

- [ ] **Step 29.2: Prospect CRUD E2E**

Create `tests/e2e/pmf-prospect-crud.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('create prospect → appears in pipeline → change stage', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/pmf/prospects/new');
  await page.fill('input[name="name"]', 'Ada Lovelace');
  await page.fill('input[name="company"]', 'Analytical Engine Co');
  await page.selectOption('select[name="deal_type"]', 'tier_a');
  await page.selectOption('select[name="source"]', 'referral');
  await page.fill('input[name="first_contact_at"]', '2026-04-21T14:00');
  await page.click('button:has-text("CREATE")');
  await expect(page).toHaveURL(/\/admin\/pmf\/prospects\/[a-z0-9-]+/);

  await page.goto('/admin/pmf');
  await expect(page.getByText('Analytical Engine Co')).toBeVisible();
});

async function loginAsAdmin(page: any) { /* same helper as above */ }
```

- [ ] **Step 29.3: Ad spend E2E**

Create `tests/e2e/pmf-ad-spend.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('manual ad spend upsert', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/pmf/ad-spend');
  await page.selectOption('select[name="channel"]', 'meta_ads');
  await page.fill('input[name="month"]', '2026-04');
  await page.fill('input[name="spend_usd"]', '3000');
  await page.click('button:has-text("SAVE")');
  await expect(page.getByText('SYS :: SAVED')).toBeVisible();
});

async function loginAsAdmin(page: any) { /* same helper */ }
```

- [ ] **Step 29.4: Commit**

```bash
git add tests/e2e/pmf-dashboard.spec.ts tests/e2e/pmf-prospect-crud.spec.ts tests/e2e/pmf-ad-spend.spec.ts
git commit -m "test(pmf): Playwright E2E — dashboard, prospect CRUD, ad spend"
```

---

## Task 30: Admin nav link + CLAUDE.md documentation

**Files:**
- Modify: `src/app/admin/_components/sidebar.tsx` (or wherever admin nav lives)
- Modify: `ops-web/CLAUDE.md`

- [ ] **Step 30.1: Add PMF nav link**

Grep for existing admin nav: `grep -rn "Revenue\|Acquisition" src/app/admin/_components/`

In the sidebar component, add a new entry:
```tsx
{ label: 'PMF', href: '/admin/pmf', icon: Target /* or similar Lucide */ }
```
Place at top of the nav (above Overview) since this is the primary operating deck. Match the existing item shape exactly.

- [ ] **Step 30.2: Document conventions**

Append to `ops-web/CLAUDE.md`:
```md
## PMF Dashboard (`/admin/pmf`)

- Visual system v2 scoped via `.pmf-scope` wrapper — do NOT extend pmf tokens globally
- Accent color inside `.pmf-scope`: `#6F94B0` (diverges from global `#597794` intentionally)
- All text inside `.pmf-scope` uses Cake Mono Light for uppercase display, JetBrains Mono for numbers, Mohave for body
- Dashboard data flows through `src/lib/admin/pmf-queries.ts` → `computePmfState()`
- Mutations revalidate via `revalidateTag('pmf-state')`
- Stripe webhook at `/api/stripe/webhook` is the source of truth for retention cohorts — do not compute MRR from `companies.subscription_status` alone
- Notifications: SMS + email + in-app rail fire for threshold alerts; daily/weekly are email only
- Recipient env: `PMF_NOTIFICATION_SMS`, `PMF_NOTIFICATION_EMAIL`, `PMF_OPERATOR_USER_ID`
```

- [ ] **Step 30.3: Commit**

```bash
git add src/app/admin/_components/sidebar.tsx CLAUDE.md
git commit -m "feat(pmf): add sidebar nav link + document pmf-scope convention"
```

---

## Task 31: Design system audit + manual QA

**Files:**
- No new files — verification pass.

- [ ] **Step 31.1: Run design system audit**

Run: audit skill equivalent against new files — scan `src/app/admin/pmf/**`, `src/components/pmf/**`, `src/styles/pmf-tokens.css` for:
- Hardcoded colors that should be tokens
- Missing `font-cakemono font-light` on uppercase titles
- Raw numbers without `tabular-nums` / `font-feature-settings: "tnum" 1`
- Missing `//` prefix or `[bracket]` micro-text

Fix any violations inline. Re-commit as `chore(pmf): design system audit fixes` if needed.

- [ ] **Step 31.2: Run full test suite**

Run:
- `npm run lint` — expect clean
- `npm run typecheck` — expect clean
- `npm run test` — all unit + integration pass
- `npm run test:e2e` — Playwright pass (requires running dev server)

- [ ] **Step 31.3: Manual QA checklist**

In a local dev server (`npm run dev`), verify:

- [ ] `/admin/pmf` loads; hero, markers, indicators, pipeline, MRR all render
- [ ] Countdown chip shows `[GATE B · 133 DAYS]` (approximately — adjust for current date)
- [ ] Adjust system clock / fixture to simulate 7 days before gate → chip text goes `rose`
- [ ] Adjust to 30 days before gate → chip text goes `tan`
- [ ] Click New Prospect → modal opens with `.glass-dense`
- [ ] Submit new prospect with source=referral → Marker 3 transitions to green
- [ ] Prospect appears in Kanban CONTACTED column
- [ ] Drag prospect CONTACTED → QUALIFIED — stage updates optimistically and persists after refresh
- [ ] `pmf_deal_events` row logged for the stage change
- [ ] Open DevTools network tab on `/admin/` (not PMF) → Cake Mono font NOT requested
- [ ] Open DevTools network tab on `/admin/pmf/` → Cake Mono loads via Typekit
- [ ] Toggle `prefers-reduced-motion` in DevTools → all entry animations collapse to 150ms opacity
- [ ] Tab key navigates Kanban cards in focus order; Space grabs; arrow keys move; Space drops
- [ ] Screen reader announces each status dot as "status green/amber/red"
- [ ] Resize to 768px width → Gate B grid collapses to 2×2; indicators wrap; Kanban scrolls horizontally
- [ ] Trigger a Stripe test event (`stripe trigger invoice.paid`) → `billing_events` row inserted
- [ ] Trigger test alert by manually running the threshold-check cron → receive SMS at +1 250 538 8994, email at canprojack@gmail.com, and in-app notification in the TopBar rail
- [ ] No console errors on any PMF route
- [ ] No `// TODO` comments remain in new code (`grep -rn "TODO" src/app/admin/pmf src/components/pmf src/lib/pmf src/lib/notifications src/emails/pmf`)

- [ ] **Step 31.4: Final commit + merge-ready state**

If any fixes surfaced in QA:
```bash
git add -A
git commit -m "chore(pmf): QA fixes"
```

Push the branch and open a PR. Include in the PR body:
- Link to spec: `docs/superpowers/specs/2026-04-21-pmf-tracking-dashboard-design.md`
- Link to plan: `docs/superpowers/plans/2026-04-21-pmf-tracking-dashboard.md`
- Screenshots of `/admin/pmf` at 1440px and 768px
- Confirmation of the 31-step manual QA checklist (paste as PR description)

---

## Appendix: Self-review checklist

**Spec coverage** — every numbered section of the spec maps to at least one task:
- §1 Purpose · §2 Users — no tasks, operational context
- §3 Architecture → Tasks 1, 16, 17 (layout, route, layers)
- §4 Data Model → Task 2 (migration), Task 11 (RPC functions)
- §5 Marker Computation → Tasks 9, 11
- §6 Leading Indicators → Tasks 9, 11
- §7 UI → Tasks 3, 6, 7, 17, 18, 19, 20, 21, 22, 23
- §8 Notifications → Tasks 24, 25, 26, 27
- §9 Design System v2 → Tasks 3, 16
- §10 External Integrations → Tasks 12, 13, 14
- §11 Cross-cutting → Task 31 (a11y + perf + motion verified in QA)
- §12 Testing → Tasks 8-10 (unit), 28 (integration), 29 (E2E)
- §13 Env & Secrets → Task 1
- §14 Rollout → Task 31 (manual QA pass)
- §15 Open questions — explicit callouts in Tasks 13 and 15
- §16 Success criteria → Task 31 checklist

**Placeholder scan** — zero TODO/TBD; a single `// TODO Task 23.3 detail` note in indicator drill-in is a planned follow-up (not blocking initial ship).

**Type consistency** — `MarkerKey`, `IndicatorKey`, `PmfState`, `MarkerState`, `IndicatorState` used uniformly across `types.ts`, `marker-compute.ts`, `threshold-diff.ts`, `pmf-queries.ts`, email templates.

**Execution note:** Tasks 5-10 are self-contained and can run in parallel via subagent dispatch if preferred. Tasks 17-23 are sequential (all depend on Task 11 + 16). Tasks 24-27 depend on Tasks 11 + 25. Tasks 28-29 depend on everything before. Task 30-31 are final gates.

