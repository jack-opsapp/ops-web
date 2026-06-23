# App Store Connect Analytics → Admin Panel (Phase 1 of Unified Attribution)

**Date:** 2026-06-22
**Surface:** `OPS-Web` admin → `Growth > App Store` (`/admin/app-store`)
**Status:** Design approved in brainstorming; ready for implementation-plan stage.
**Build posture:** OPS perfection standard — no stubs, no TODOs, no deferral. Every section is production-ready.

> **Review status.** This spec was grounded by a multi-agent investigation of the live OPS codebase + Supabase schema and current (2025–2026) Apple/attribution docs, then put through an adversarial critic pass. Three build-breaking issues the critic found are **already fixed in this document** (illegal stored generated column → read-time computed; NULL-distinct unique keys breaking idempotency → `NULLS NOT DISTINCT`; an undefined `asc_sync_status` table → full DDL added), plus five smaller corrections (RLS view comment, conversion summation rule, dependency provenance, "awaiting first report" state machine, and removal of a "likely-zero pre-orders" guess).

---

## The bigger picture (why this is "Phase 1," not a one-off)

The closing requirement — *"all our conversion, tracking, and ads data consolidated into a centralized analytics screen with drill-downs for attribution by channel"* — reframes this work. The App Store Connect connector is **the first brick of a warehouse-centric cross-channel attribution stack**, not a standalone screen. It is therefore built **attribution-ready from day one**: its facts carry a normalized `channel` dimension in the same canonical vocabulary the future unified screen uses, so App Store rows later flow into the unified fact **without re-ingestion**.

- **Part A** — Phase 1: the App Store Connect integration (this is what gets built now).
- **Part B** — North-star: the centralized cross-channel attribution screen and the warehouse layers beneath it.
- **Part C** — Phased roadmap to get from A to B.
- **Part D** — Canonical channel taxonomy (shared contract for every connector).
- **Part E** — Open questions for Jackson.

---

# PART A — Phase 1: App Store Connect Analytics Integration

## A0. What this delivers, in one sentence

A daily, idempotent pull of Apple's App Store Connect Analytics into Supabase, surfaced as a founder-grade admin screen showing how people find the app on the App Store (impressions → product-page views → downloads), the App Store conversion rate, where that traffic comes from (source type → normalized channel), and which territories drive it — with period-over-period deltas and a selectable date range + granularity.

## A1. Prerequisites (gathered once by Jackson, stored as Vercel secrets)

None of these are inventable; each is required by Apple's API.

### A1.1 App Store Connect API key — **Admin role**
App Store Connect → Users and Access → Integrations → App Store Connect API → generate a **Team key** with the **Admin** role.
- **Admin is required to *create*** an Analytics Report Request (`POST /v1/analyticsReportRequests`). Downloading generated reports later only needs *Sales and Reports* or *Finance*, but because we both create the ONGOING request and download, the key must be **Admin**.
- On generation Apple gives three things; the `.p8` **downloads exactly once**:
  - **Key ID** (`kid`, ~10 chars)
  - **Issuer ID** (`iss`, a UUID, shown once at the top of the Keys page)
  - **`.p8` private key** (ES256) — download immediately, store securely.

### A1.2 The app's numeric App Store ID (adamId)
The report request is scoped to one app via the `apps` relationship using the **numeric App Store app id** (the "Apple ID"/adamId on the App Information page), **not the bundle id**.

### A1.3 Analytics unlock latency (operational)
- After we issue the **ONGOING** request, Apple produces the **first report ~24–48 h later**, daily thereafter. The screen legitimately shows an "awaiting first Apple report" state until the first instance is processed (see A7.8).
- A **ONE_TIME_SNAPSHOT** returns all available history, but a *new* snapshot can only be requested roughly **every 31 days** — so we fire it exactly once at bootstrap.

### A1.4 Environment secrets (Vercel; mirror in `.env.local` for dev)

| Variable | Purpose |
|---|---|
| `ASC_KEY_ID` | App Store Connect key `kid` (JWT header) |
| `ASC_ISSUER_ID` | App Store Connect issuer id (JWT `iss`) |
| `ASC_PRIVATE_KEY` | Contents of the `.p8` (PEM; newlines as `\n`, parsed at runtime — same handling as `FIREBASE_ADMIN_PRIVATE_KEY`) |
| `ASC_APP_ID` | Numeric App Store app id (adamId) for the `apps` relationship |
| `CRON_SECRET` | **Already set** — reused. Cron route authorizes on `Authorization: Bearer ${CRON_SECRET}`, identical to `/api/cron/ads-sync`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Already set** — all reads/writes use the service-role admin client. |

An `isAppStoreConfigured()` guard (mirroring `isGoogleAdsConfigured()`) returns false when any of `ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY / ASC_APP_ID` is unset; the page then renders a **SETUP REQUIRED** state instead of erroring (same pattern as the Google Ads page).

### A1.5 Cost transparency
The App Store Connect Analytics Reports API is **free to call** with the existing Apple Developer Program membership — no per-request or subscription fee. The only marginal cost is Vercel function execution for **one cron run per day** (a handful of HTTP calls + a gzip parse, comparable to `ads-sync`). No new third-party service, no new database tier. **Net new recurring cost: ~$0.**

## A2. Authentication — minting the JWT

- **Algorithm:** ES256, signed with the `.p8`.
- **Header:** `{ "alg": "ES256", "kid": ASC_KEY_ID, "typ": "JWT" }`
- **Payload:** `{ "iss": ASC_ISSUER_ID, "iat": now, "exp": now + 1140, "aud": "appstoreconnect-v1" }`
  - `exp` must be ≤ **20 min** (1200 s). We use **1140 s (19 min)** for clock-skew margin and mint **one token per cron run**.
- **Base URL:** `https://api.appstoreconnect.apple.com`
- Implemented in `OPS-Web/src/lib/analytics/app-store-client.ts` (peer of `google-ads-client.ts`). **`jose ^6.1.3` is a direct dependency in OPS-Web** (used for Firebase token verification) and supports ES256 signing. The client exposes `mintToken()`, `ascGet(path)`, and `downloadSegment(url)`.

## A3. Daily data flow (the pull pipeline)

Apple's Analytics Reports API is a **6-step pull**, not a single report endpoint. The connector implements all six steps and is **idempotent**.

### A3.1 Bootstrap (once, on first deploy)
On the first sync (detected because `asc_report_requests` is empty), issue **two** report requests against `ASC_APP_ID`:
1. **`accessType: "ONGOING"`** — recurring daily generation from the request date forward. **No historical backfill.** First report ~24–48 h later.
2. **`accessType: "ONE_TIME_SNAPSHOT"`** — all available history at request time. Fired **once**; the connector will not re-fire a snapshot if one exists in `asc_report_requests` younger than 31 days.

Both request ids, their `accessType`, and creation time persist in `asc_report_requests`.

### A3.2 Each daily run (the cron)
For each persisted request (ONGOING, and the SNAPSHOT until its instances are fully drained):
1. **`GET /v1/analyticsReportRequests/{id}/reports`** filtered by **category**:
   - `APP_STORE_ENGAGEMENT` → **App Store Discovery and Engagement** report (impressions + product page views).
   - `APP_STORE_COMMERCE` → **App Store Downloads** report (first-time vs redownloads, by source/page/device/territory).
   - Persist each report id + category in `asc_reports`.
2. **`GET /v1/analyticsReports/{id}/instances`** filtered by `granularity=DAILY` (+ `processingDate` for catch-up). Page with `limit=200`, follow `links.next`. Each instance = one reporting date. Persist in `asc_report_instances` with `state='discovered'`.
3. **`GET /v1/analyticsReportInstances/{id}/segments`** — each segment carries a signed `url`, a `checksum`, and `sizeInBytes`. Persist in `asc_report_segments`.
4. **Download** the segment `url` (signed, short-lived — download promptly). Payload is a **compressed, tab-delimited `.txt.gz`**.
5. **`gunzip`** → parse the tab-delimited text.
6. **Parse by header NAME, not column index** (A5), **normalize the source dimension to a canonical channel** (A6), **upsert idempotently** into the fact tables (A4), and mark the segment `processed` keyed on its `checksum`.

### A3.3 Idempotency & the 2-day restatement
- **Idempotency key per fact row:** `(report_kind, granularity, reporting_date, <full dimension tuple>)` enforced as a unique constraint **with `NULLS NOT DISTINCT`** (critical — Apple emits blank/absent dimensions; default UNIQUE treats NULLs as distinct, which would defeat `ON CONFLICT` and duplicate rows on every re-pull). All writes are `ON CONFLICT ... DO UPDATE`.
- **Segment-level skip:** if a segment's `checksum` already exists as `processed`, skip download+parse entirely.
- **Restatement:** Apple finalizes a reporting date's data **2 days after** that date (privacy thresholding drops rows with <5 users/devices and adds statistical noise; late rows restate earlier days). The cron **re-pulls the trailing 3 reporting dates every run** and re-upserts. The unique key + `DO UPDATE` (with NULLS NOT DISTINCT) makes re-processing safe and self-correcting.

### A3.4 The "2-day-complete" display rule
- `provisional` is **computed at read time** as `reporting_date > current_date - 2` — never stored (a stored generated column on `current_date` is illegal in Postgres). It is exposed by the conversion view and every query.
- The screen's headline KPIs and "complete through" caption use the most recent finalized date (`current_date - 2`) as the right edge of the trustworthy window. Provisional days still render in charts but dashed/muted with a "preliminary — Apple finalizes at +2 days" tooltip, so a founder never reads a half-finalized number as truth.

### A3.5 Scheduling (cron)
- New `vercel.json` cron entry appended to the existing `crons` array:
  ```json
  { "path": "/api/cron/app-store-sync", "schedule": "0 9 * * *" }
  ```
  **09:00 UTC daily** — one hour after `ads-sync` (`0 8 * * *`) to avoid stacking external pulls. Data is final at +2 days, so time-of-day is not load-bearing.
- Route authorizes on `Authorization: Bearer ${CRON_SECRET}` (verbatim `ads-sync` guard).
- **Rate limiting:** Apple's budget is ~3500–3600 req/hr rolling. One app × 2 categories × a handful of instances/segments is a few dozen calls per run — far under budget. The client mints a ≤19-min token, reads rate-limit headers, and on **429** applies exponential backoff with jitter and resumes (bookkeeping lets it resume mid-run next invocation).

## A4. Supabase data model (DDL)

> **DO NOT apply to prod without Jackson's explicit go-ahead.** Net-new infra; stage as a migration, recon read-only, then sign-off (OPS prod-migration policy). The migration is **additive only** (new tables) — safe under the iOS-sync constraint.

Design principles: faithful to the two source reports (one fact per report), header-name parsing with a raw JSONB landing column for forward-compat, an attribution-ready normalized `channel` on every fact, conversion computed (never stored), bookkeeping tables for resumable idempotent runs, and RLS locked to service-role writes / admin-gated server reads (the app runs as the **anon** role and `auth.uid()` is unusable under the Firebase bridge — so no client-facing table grants exist).

```sql
-- ============================================================================
-- App Store Connect Analytics — Phase 1 ingestion + facts
-- Additive migration. Service-role write, admin-gated server reads only.
-- ============================================================================

-- ---------- Bookkeeping: report requests (ONGOING + ONE_TIME_SNAPSHOT) -------
create table if not exists public.asc_report_requests (
  id              uuid primary key default gen_random_uuid(),
  asc_request_id  text not null unique,                 -- Apple's analyticsReportRequest id
  app_id          text not null,                        -- ASC_APP_ID (adamId)
  access_type     text not null check (access_type in ('ONGOING','ONE_TIME_SNAPSHOT')),
  created_at      timestamptz not null default now(),
  stopped_at      timestamptz
);

-- ---------- Bookkeeping: reports per request (by category) -------------------
create table if not exists public.asc_reports (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.asc_report_requests(id) on delete cascade,
  asc_report_id  text not null unique,
  category       text not null,                         -- APP_STORE_ENGAGEMENT | APP_STORE_COMMERCE
  report_name    text,
  created_at     timestamptz not null default now()
);

-- ---------- Bookkeeping: instances (one per reporting date/granularity) ------
create table if not exists public.asc_report_instances (
  id               uuid primary key default gen_random_uuid(),
  report_id        uuid not null references public.asc_reports(id) on delete cascade,
  asc_instance_id  text not null unique,
  granularity      text not null check (granularity in ('DAILY','WEEKLY','MONTHLY')),
  processing_date  date not null,
  state            text not null default 'discovered'
                     check (state in ('discovered','downloaded','processed','error')),
  error_detail     text,
  discovered_at    timestamptz not null default now(),
  processed_at     timestamptz
);

-- ---------- Bookkeeping: segments (downloadable gz parts, checksum-keyed) ----
create table if not exists public.asc_report_segments (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null references public.asc_report_instances(id) on delete cascade,
  checksum        text not null,                        -- Apple's segment checksum (idempotency)
  size_bytes      bigint,
  url             text,                                 -- signed, short-lived
  state           text not null default 'discovered'
                     check (state in ('discovered','processed','error')),
  rows_ingested   integer,
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (instance_id, checksum)
);

-- ---------- Raw landing (forward-compat: never lose an unknown column) -------
create table if not exists public.asc_raw_rows (
  id              bigint generated always as identity primary key,
  segment_id      uuid not null references public.asc_report_segments(id) on delete cascade,
  report_kind     text not null check (report_kind in ('discovery_engagement','downloads')),
  reporting_date  date not null,
  raw             jsonb not null,                       -- full header->value map, verbatim
  ingested_at     timestamptz not null default now()
);
create index if not exists asc_raw_rows_kind_date_idx
  on public.asc_raw_rows (report_kind, reporting_date);

-- ---------- FACT 1: App Store Discovery and Engagement ----------------------
create table if not exists public.asc_discovery_engagement (
  id                  bigint generated always as identity primary key,
  granularity         text not null default 'DAILY',
  reporting_date      date not null,
  engagement_type     text,        -- "Engagement Type" (Impression, Product Page View, Tap)
  page_type           text,        -- "Page Type"
  source_type         text,        -- "Source Type" (App Store Search, Browse, App Referrer, Web Referrer, App Clip, ...)
  source_info         text,        -- "Source Info"
  device              text,        -- "Device"
  platform_version    text,        -- "Platform Version"
  territory           text,        -- "Territory" (ISO country)
  channel             text not null default 'unknown',  -- canonical taxonomy (A6)
  counts              bigint not null default 0,         -- "Counts"
  unique_counts       bigint not null default 0,         -- "Unique Counts"
  segment_id          uuid references public.asc_report_segments(id) on delete set null,
  updated_at          timestamptz not null default now(),
  -- NULLS NOT DISTINCT: Apple emits blank dimensions; without this, ON CONFLICT
  -- never fires on NULL dims and the trailing-3-day re-pull duplicates rows.
  constraint asc_de_uk unique nulls not distinct
    (granularity, reporting_date, engagement_type, page_type,
     source_type, source_info, device, platform_version, territory)
);
create index if not exists asc_de_date_idx       on public.asc_discovery_engagement (reporting_date);
create index if not exists asc_de_channel_idx    on public.asc_discovery_engagement (channel, reporting_date);
create index if not exists asc_de_territory_idx  on public.asc_discovery_engagement (territory, reporting_date);

-- ---------- FACT 2: App Store Downloads -------------------------------------
create table if not exists public.asc_downloads (
  id                  bigint generated always as identity primary key,
  granularity         text not null default 'DAILY',
  reporting_date      date not null,
  download_type       text,        -- "Download Type" (First Time Download / Redownload / Total)
  page_type           text,        -- "Page Type"
  source_type         text,        -- "Source Type"
  source_info         text,        -- "Source Info"
  campaign            text,        -- "Campaign" (when present)
  device              text,        -- "Device"
  platform_version    text,        -- "Platform Version"
  territory           text,        -- "Territory"
  channel             text not null default 'unknown',
  counts              bigint not null default 0,         -- "Counts" (download count)
  unique_counts       bigint not null default 0,         -- "Unique Counts" (unique devices)
  segment_id          uuid references public.asc_report_segments(id) on delete set null,
  updated_at          timestamptz not null default now(),
  constraint asc_dl_uk unique nulls not distinct
    (granularity, reporting_date, download_type, page_type,
     source_type, source_info, campaign, device, platform_version, territory)
);
create index if not exists asc_dl_date_idx       on public.asc_downloads (reporting_date);
create index if not exists asc_dl_channel_idx    on public.asc_downloads (channel, reporting_date);
create index if not exists asc_dl_territory_idx  on public.asc_downloads (territory, reporting_date);

-- ---------- Bookkeeping: sync status (mirrors ads_sync_status) ---------------
create table if not exists public.asc_sync_status (
  job_name          text primary key,                   -- e.g. 'app-store-sync'
  status            text not null default 'idle'
                      check (status in ('idle','running','complete','failed')),
  last_synced_date  date,                                -- most recent reporting_date ingested
  last_run_at       timestamptz,
  error             text,
  updated_at        timestamptz not null default now()
);

-- ---------- DERIVED VIEW: conversion (never stored; provisional read-time) ---
-- Apple's definition: (Total Downloads + Pre-orders) / Unique Device Impressions.
-- Pre-orders are a separate report (out of Phase 1) — this is Apple's formula
-- MINUS the pre-order term; the UI labels it as such.
-- security_invoker=true so base-table RLS is enforced against the querying role
-- (defense-in-depth: the view is also never granted to anon/authenticated).
create or replace view public.asc_conversion_daily
with (security_invoker = true) as
with imp as (
  select reporting_date, territory, channel,
         sum(unique_counts) as unique_impressions
  from public.asc_discovery_engagement
  where lower(engagement_type) like '%impression%'
  group by reporting_date, territory, channel
),
dl as (
  -- Summation rule is PINNED during live validation (test #13): confirm whether
  -- Apple emits a discrete 'Total' download row per dimension tuple, OR only
  -- First Time + Redownload. Until pinned, sum the 'Total' rows when present.
  select reporting_date, territory, channel,
         sum(counts) as total_downloads
  from public.asc_downloads
  where download_type is null
     or lower(download_type) in ('total downloads','total')
  group by reporting_date, territory, channel
)
select
  coalesce(imp.reporting_date, dl.reporting_date) as reporting_date,
  coalesce(imp.territory, dl.territory)           as territory,
  coalesce(imp.channel, dl.channel)               as channel,
  coalesce(imp.unique_impressions, 0)             as unique_impressions,
  coalesce(dl.total_downloads, 0)                 as total_downloads,
  case when coalesce(imp.unique_impressions,0) > 0
       then coalesce(dl.total_downloads,0)::numeric / imp.unique_impressions
       else null end                              as conversion_rate,
  coalesce(imp.reporting_date, dl.reporting_date) > (current_date - 2) as provisional
from imp
full outer join dl
  on  imp.reporting_date = dl.reporting_date
  and imp.territory      = dl.territory
  and imp.channel        = dl.channel;

-- ---------- RLS: service-role write, deny anon/authenticated ----------------
-- The app executes as the anon role and auth.uid() is unusable under the
-- Firebase bridge, so NO table-level access is granted to clients. All UI
-- access is server-side via the service-role admin client behind isAdminEmail().
-- Service role bypasses RLS; enabling it with zero policies = default-deny,
-- explicit and auditable.
alter table public.asc_report_requests    enable row level security;
alter table public.asc_reports            enable row level security;
alter table public.asc_report_instances   enable row level security;
alter table public.asc_report_segments    enable row level security;
alter table public.asc_raw_rows           enable row level security;
alter table public.asc_discovery_engagement enable row level security;
alter table public.asc_downloads          enable row level security;
alter table public.asc_sync_status        enable row level security;
-- No CREATE POLICY ... TO anon/authenticated is issued anywhere → RLS denies all
-- client reads by default. asc_conversion_daily is read only by the service role;
-- security_invoker=true means base-table RLS would also apply if it were ever
-- exposed to a client role.
```

**Faithfulness notes / stated assumptions (not guesses):**
- Apple does not publish a stable, versioned header list and reorders/renames columns over time. The parser maps by **normalized header name** via an alias table and lands every row's full header→value map in `asc_raw_rows.raw`. The fact columns are the documented dimensions; unknown/extra columns survive in `raw` (no data loss) and are mapped in later without re-ingestion.
- **Unique Impressions** (the conversion denominator): the view assumes the safe superset — `sum(unique_counts) where engagement_type LIKE '%impression%'`. **Validate against a real downloaded file (test #13) before pinning**; adjust if Apple exposes a discrete column.
- **Download summation rule** is explicitly pinned during live validation (test #13): confirm whether a discrete `Total` row exists per dimension tuple or whether totals are `First Time + Redownload`, then make the view's `download_type` handling a single explicit rule (not a tolerant OR that could double-count or miss). The `NULLS NOT DISTINCT` key prevents numerator double-counting regardless.
- **Pre-orders** are excluded (separate report, out of Phase 1). The conversion view is Apple's formula minus the pre-order term; the UI labels it. (See Part E open question — Jackson confirms whether pre-orders were ever used rather than assuming zero.)

## A5. Header-name-based parsing (column-drift defense)

In `OPS-Web/src/lib/admin/app-store-sync.ts`:
1. Read **row 1** of each decompressed file as the header.
2. Build `normalize(h) -> rawIndex` (`normalize`: lowercase, strip, collapse internal whitespace).
3. Resolve each canonical column via an **alias table**, e.g. `reporting_date ← date`; `engagement_type ← engagement type | event | event type`; `download_type ← download type`; `source_type ← source type`; `source_info ← source info | source`; `page_type ← page type`; `device ← device`; `platform_version ← platform version`; `territory ← territory | country / region`; `campaign ← campaign`; `counts ← counts`; `unique_counts ← unique counts | unique devices`.
4. Any header with no alias is preserved in `raw` and ignored for facts (never dropped).
5. Numeric fields parse with thousands-separator tolerance, missing → `0`; dimension fields missing → `NULL`.

## A6. Normalized channel mapping (attribution-ready)

`mapAppStoreSourceToChannel(sourceType, sourceInfo)` maps Apple's `Source Type` (+ `Source Info`) to the canonical taxonomy at ingest:

| Apple Source Type | Canonical `channel` |
|---|---|
| App Store Search | `app_store_search` *(bundles ORGANIC keyword search AND Apple Search Ads — split later via ASA join)* |
| App Store Browse | `app_store_browse` |
| App Referrer | `app_referrer` |
| Web Referrer | `web_referrer` |
| App Clip | `app_clip` |
| Institutional Purchase | `institutional` |
| Unavailable / blank | `unavailable` |
| anything else | `other` |

Same canonical vocabulary as the future unified fact → these rows join to marketing spend without re-ingestion. **App Store "Search" is never treated as fully organic** — it's split into ASA-paid vs organic only once Apple Ads campaign data is joined (later phase); until then it carries `app_store_search` and the UI annotates the caveat.

## A7. The `Growth > App Store` page

**Route:** `OPS-Web/src/app/admin/app-store/page.tsx` (async RSC) + `app-store/_components/app-store-content.tsx` (`'use client'`, TanStack Query). Modeled on `/admin/app-analytics`, **not** `/admin/analytics` (which is GA4 website traffic). Auth inherits the `admin/layout.tsx` `isAdminEmail()` gate.

> **UI build runs through the design-skill stack** — `frontend-design` + `interface-design`/`ui-ux-pro-max` + `ops-design` token reads + `wireframe`, with all copy via `ops-copywriter`. Visuals are not improvised here.

### A7.0 Data fetch & cache pattern
- Query fns in `OPS-Web/src/lib/admin/app-store-queries.ts`, each using `getAdminSupabase()` wrapped in `unstable_cache(fn, [key, ...args], { revalidate: 300 })`.
- **Fix the known app-analytics sharp edge:** include `from`, `to`, and `granularity` **in the cache key array** so dated variants don't collide (app-analytics omits args — do not replicate that bug; a test guards it).
- RSC fetches the default (last 30 days, daily) via `Promise.all` over the cached fns in a `try/catch` that renders error + stack (matching app-analytics/revenue). Results pass to the client as `initialData`; client `useQuery` seeds `initialData` only when params match the RSC default.

### A7.1 Header
`AdminPageHeader`, cakemono title `APP STORE`, mono caption `[ APP STORE CONNECT · ACQUISITION FUNNEL ]`, and `COMPLETE THROUGH {finalized_date}` (= `current_date - 2`) with provisional days flagged.

### A7.2 Controls
`DateRangeControl` + `useDateRange` (presets today/7d/14d/30d/90d/12m/all with `AUTO_GRANULARITY` + override). Daily default; weekly/monthly bucketing via `bucketize()`/`bucketizeAggregate()` from `date-utils.ts`.

### A7.3 KPI tiles (`StatCard` row, server-rendered)
Four tiles, each with period-over-period delta (current vs immediately-preceding equal-length range), trend arrow, inline `Sparkline`. Numbers JetBrains Mono, tabular, formatted; empty = `—`.
1. **Conversion Rate** — `total_downloads / unique_impressions` over the range (from `asc_conversion_daily`). Hero metric; tooltip "Apple formula, excludes pre-orders."
2. **Impressions** — sum `unique_counts` where engagement = impression.
3. **Product Page Views** — sum `counts` where engagement = product page view.
4. **Downloads** — sum total downloads.

### A7.4 Conversion-rate hero chart
`AdminLineChart` of daily `conversion_rate`. Provisional (last-2-day) points dashed/muted with the +2-day tooltip. The centerpiece.

### A7.5 Traffic chart
`AdminLineChart` (or stacked area via `stacked-bar-chart.tsx`) of **impressions vs product page views vs downloads** over time. Optionally a `FunnelChart` (impressions → product page views → downloads) for the range showing drop-off %.

### A7.6 Source breakdown
`AdminDonutChart` of downloads by normalized `channel` for the range. Legend uses canonical labels; "App Store Search" carries an "(includes Apple Search Ads)" footnote.

### A7.7 Territory table
`SortableTableHeader` + `useSortState`: rows = territory; columns = Impressions, Product Page Views, Downloads, Conversion Rate, each with an inline `Sparkline`. Default sort: Downloads desc. Verbs stay out of the scan surface (read table).

### A7.8 States
- **SETUP REQUIRED** — `isAppStoreConfigured()` false: mirror the Google Ads setup card with what to add.
- **AWAITING FIRST APPLE REPORT** — configured but no facts yet **and no instance has reached `processed` state**. Driven by the `asc_report_instances` state machine, **not** a hard <48 h clock, so a slightly-late first Apple report never renders as an error. Calm telemetry-style panel ("Apple generates the first report 24–48 h after connection"). Copy via `ops-copywriter`.
- **Provisional banner** — when the range's right edge is within 2 days, a quiet inline note that the last two days are preliminary.

### A7.9 Design-system compliance
- Reuse existing chart wrappers but **replace the stale `fontFamily: 'Kosugi'` axis-tick references** in `line-chart.tsx`/`bar-chart.tsx` with the current mono token (JetBrains Mono / `font-mono`), and trace hardcoded hexes to design-system rules. **Accent on a data series is a leak** — accent is user-customizable; verify at runtime that data series use the neutral data palette, not `--ops-accent`.
- All copy through `ops-copywriter`: terse/tactical, sentence case for content, UPPERCASE for authority, no emoji, no exclamation points, `—` for empty.

### A7.10 Navigation registration
Add to the **GROWTH** section of `_components/sidebar.tsx` (a GROWTH section already holds ACQUISITION/GOOGLE ADS/A-B TESTING/ONBOARDING — this is an acquisition surface, so GROWTH is the coherent IA, after GOOGLE ADS):
```ts
{ type: "item", href: "/admin/app-store", label: "APP STORE" },
```

## A8. API routes

Under `OPS-Web/src/app/api/admin/app-store/`, uniform shape:
```ts
export const GET = withAdmin(async (req) => {
  await requireAdmin(req);
  const { from, to, granularity } = parseRange(req); // defaults: 30d / daily
  const data = await <cachedQueryFn>(from, to, granularity);
  return NextResponse.json({ data });
});
```
Routes: `kpis`, `conversion-series`, `traffic-series`, `source-breakdown`, `territories`. Client unwraps `res.json().data`. Auth via shared `requireAdmin`/`withAdmin` (401 no email, 403 not in `admins`, 500 uncaught).

Cron: `OPS-Web/src/app/api/cron/app-store-sync/route.ts` (`maxDuration = 60`, `Bearer ${CRON_SECRET}` guard, writes the `app-store-sync` row to `asc_sync_status` via an `updateAscSyncStatus` helper mirroring the ads one — running/complete/failed + last_synced_date + error).

## A9. Testing plan

**Unit (Vitest):**
1. **Header-name parser** — fixtures with (a) documented header order, (b) reordered columns, (c) renamed + unknown extra column. Facts map correctly in all three; unknown column survives in `raw`. (Highest value — column drift is the #1 risk.)
2. **`mapAppStoreSourceToChannel`** — every source type → expected channel, incl. blank/unknown.
3. **Conversion view math** — seeded impressions/downloads → expected `conversion_rate` + null-on-zero-denominator.
4. **JWT mint** — `exp ≤ 1200 s`, `aud = appstoreconnect-v1`, `alg = ES256`, `kid`/`iss` present.
5. **Idempotency, including NULL dimensions** — process the same segment twice (with some NULL dims) → zero duplicate rows (NULLS NOT DISTINCT key + checksum skip); a restated value updates in place.
6. **Provisional flag** — rows within 2 days flagged, older not (computed at read time).

**Integration (mocked Apple):**
7. Full 6-step pipeline with recorded fixtures → bookkeeping transitions `discovered → processed`, facts upsert, second run is a no-op except the trailing-3-day re-pull.
8. **Cron auth** — wrong/empty `CRON_SECRET` → 401; correct → runs.
9. **429 backoff** — 429 then 200 → backoff + resume, no data loss.

**Page/route:**
10. **Admin gate** — non-admin → 403 on every `/api/admin/app-store/*`; redirect from `/admin/app-store`.
11. **Cache key** — assert `from/to/granularity` in the `unstable_cache` key (regression guard).
12. **States** — not configured → SETUP REQUIRED; configured + no processed instance → AWAITING FIRST REPORT; provisional range → banner.

**Live validation (post-deploy, one-time, gated on Jackson):**
13. After bootstrap, **download one real segment and byte-confirm header strings**, pin/extend the alias table, **and pin the Unique-Impressions denominator + the download summation rule** (discrete Total row vs first-time+redownload).
14. Spot-check one date's conversion rate against the App Store Connect dashboard (expect a small delta from privacy noise + the excluded pre-order term; document the expected direction).

---

# PART B — North-Star: Centralized Cross-Channel Attribution

## B1. Thesis (why warehouse-centric, not four dashboards)
OPS will **not** ask the founder to reconcile Google Ads', Apple's, GA4's, and Meta's self-serving dashboards (summed, ad platforms routinely "drive" 200–250%+ of actual revenue). Instead:

```
RAW per-channel tables  ->  NORMALIZED fact(s)  ->  ATTRIBUTION model in SQL  ->  ONE founder dashboard
```

Supabase/Postgres **is** the warehouse. Every channel's claim reconciles against **one revenue source of truth** — Stripe + App Store proceeds, blended — never against ad-platform self-reported conversions.

## B2. What OPS actually has today (honest inventory)
**Already real:**
- **Google Ads pipeline** — live REST v23 client, daily cron + 2-year backfill into `ads_daily_account/campaign/keyword/search_term`, an AI briefing. **BUT the developer token is test-only (`DEVELOPER_TOKEN_NOT_APPROVED`); every sync fails; all ads tables are 0 rows.** Code works; data blocked on token approval.
- **GA4** — GA4 Data API (server) drives `/admin/acquisition`; client `gtag.js` on OPS-Web + ops-site.
- **Channel/attribution schema** — `trial_attributions` (utm_*/gclid/fbclid/landing_url/trial_started_at/first_paid_at/`attributed_channel`), `ad_spend_log`, `deriveAttributionChannel()`. **But `trial_attributions` has 0 rows** — only a manual admin backfill writes it; live signup paths never do.
- **iOS** — Firebase Analytics fires `sign_up/login/begin_trial/subscribe/complete_onboarding/create_first_project`. **No AppsFlyer/Adjust/Branch, no AdServices token, no ATT/IDFA.**
- **`companies.referral_method`** — free-text "how did you hear," the only first-party acquisition signal in the DB — populated for ~7 of 57 companies.
- **`analytics_events`** — ~8,175 rows, 99.6% iOS, product telemetry, **zero** utm/source/channel keys.

**Net-new:** the App Store connector (Part A); any non-Google ingestion (Meta, ASA); a unified cross-channel fact joining spend → revenue; identity stitching web-click → install → paying-company.

## B3. The identity-stitching reality (told straight)
- The funnel is **iOS-first** (App Store install) bridged to Firebase; the cross-system id is the **Firebase UID (non-UUID)**; `auth.uid()` is unusable under that bridge.
- **No UTM/click-id crosses the App Store install boundary** — no SDK carries `gclid`/`fbclid`/utm from a web ad click into the installed app, and no web-visitor ↔ app-user bridge. So **deterministic ad-click → install → paying-company attribution is impossible today** and can't be reconstructed from existing data.
- **ATT/SKAN:** ~70–75% of iOS users decline tracking; SKAN/AdAttributionKit is **aggregate-only**. Ad platforms never see trial → paid → renewal (it happens in Apple billing days later).

**Deliberate target:** channel-level/aggregate attribution is the guaranteed floor (especially paid iOS); user-level attribution only where genuinely deterministic (web signup → Stripe customer, logged-in web sessions, deferred deep links); **Apple's AdServices token** is the one deterministic install→Apple-Ads-campaign link (requires shipping iOS capture code — later phase); the dark funnel is recovered with a self-reported "How did you hear about us?" on web + iOS onboarding.

> Honest summary for the founder: **OPS can answer "which channels are working" at the channel level reliably, and "which exact ad produced this paying company" only for the web/deterministic slice plus Apple Ads via AdServices. That bar is achievable today and is enough to allocate budget.**

## B4. Warehouse layers
- **Layer 0 — Raw, per-source** (verbatim, JSONB-preserved): `asc_*` (Part A), `ads_daily_*` (Google), `asa_*` (Apple Search Ads), `meta_*` (conditional), GA4 pulls, `trial_attributions`/`companies.referral_method`, `billing_events`/Stripe + App Store proceeds.
- **Layer 1 — Normalized facts** (extend, don't rebuild `ad_spend_log`/`trial_attributions`):
  - **`channel_metrics`** `(date, channel, sub_channel, campaign, territory, metric_type[spend|traffic|impression|click|install], value, currency, source_system, as_of)` — monetary normalized to **integer cents** at ingest (Google micros ÷1e6; Apple/Meta decimals; App Store proceeds).
  - **`touchpoints`** `(touchpoint_id, occurred_at, identity_key[nullable when aggregate-only], channel, sub_channel, campaign, territory, click_id_set, raw_source)`.
  - Dims `dim_channel/dim_campaign/dim_date/dim_company`; an enforced **`channel_map`** table (raw source → canonical) as a first-class DB object.
- **Layer 2 — Attribution model in SQL (model is a dimension, not a migration):** compute every model in parallel at conversion time (`first_touch_credit`, `last_touch_credit`, `paid_aware_last_touch_credit`, `linear_credit`, `position_credit` 40/20/40). **Headline default: paid-aware last-touch.** **No data-driven attribution** at OPS's volume (needs ~100 conversions/channel/month; revisit then). Attribution window matches the real trades sales cycle (weeks-to-months), parameterized via `occurred_at`. Materialized SQL views: `attribution_by_channel`, `attribution_by_campaign`, `cohort_spend_to_revenue`.
- **Layer 3 — One founder-grade dashboard** (five sections): (1) top-line funnel, (2) channel comparison table — the centerpiece, model selector is a **filter not a recompute**, (3) campaign drill-down (the Part-A App Store screen is the App-Store channel's drill-down), (4) cost + ROAS/CAC **only where spend exists**, (5) cohort/trend. A visible **"attributed vs total revenue" reconciliation bar** against blended Stripe + App Store proceeds makes over-counting impossible to hide.

---

# PART C — Phased Roadmap (dependency order)

Each phase ships value alone and is a brick in the warehouse. All ad/analytics APIs are **free to call** (you pay only ad spend + incidental cloud usage).

- **Phase 1 — App Store Connect connector (this spec).** Daily ASC ingestion → facts + conversion view + the `Growth > App Store` screen, attribution-ready. Depends on nothing built (needs Admin ASC key, adamId, 24–48 h unlock). **~$0.** First because it's net-new, self-contained, useful, and seeds the canonical channel vocabulary.
- **Phase 2 — Attribution-capture foundation.** Wire first-party signal + the warehouse skeleton: write `trial_attributions` at web company-creation (read existing `__ops_first_touch` cookie + `deriveAttributionChannel()`); make ops-site middleware actually write the first-touch cookie; add "How did you hear about us?" to web + iOS onboarding; have the Stripe webhook stamp `first_paid_at`; stand up `channel_metrics` + `touchpoints` + `channel_map` + parallel credit columns; backfill Phase-1 rows into them. **~$0.** Cheapest, highest-leverage unlock — without capture, every connector has spend but nothing to attribute it to.
- **Phase 3 — Ads connectors (spend side).** **3a** Unblock + harden Google Ads (apply for Basic/Standard API access — token is test-only today; **start this application now**, ~5 business days). **3b** GA4 Data API as a first-class warehouse source. **3c** Apple Search Ads Campaign Management API (conditional on real ASA spend; lets App Store "Search" split into paid vs organic). **3d** Apple AdServices token capture in iOS (deterministic install→campaign; ships on App Store cadence; only worth it once ASA spend exists). **3e** Meta Marketing API (LAST, conditional on Meta ads existing; mind the Jan 12 2026 view-window/retention cutover). Each free to call; pay only ad spend.
- **Phase 4 — Unified cross-channel attribution screen (north-star).** The five-section founder dashboard + model selector (paid-aware last-touch default) + reconciliation bar. Built once; lights up channels as Phase 3 connectors fill `channel_metrics`. Depends on Phase 2 + ≥ 3a/3b. **~$0** (no paid ELT/attribution vendor proposed; any such cost goes to Jackson first).

**Critical path:** start *now in parallel* — Phase 1 build **+** the Google Ads Basic-access token application (3a's ~5-day gate) **+** Phase 2 web/site capture wiring (independent). Phase 4's UI shell can begin once Phase 2 facts exist.

---

# PART D — Canonical Channel Taxonomy

Every connector normalizes into this shared vocabulary:

`app_store_search`, `app_store_browse`, `app_referrer`, `web_referrer`, `app_clip`, `institutional`, `unavailable`, `google_ads`, `apple_search_ads`, `meta_ads`, `organic_search`, `organic_social`, `paid_social`, `email`, `direct`, `referral`, `other`.

---

# PART E — Open Questions for Jackson

1. **Attribution model** — confirm **paid-aware last-touch** as the headline default (computed alongside first-touch + position-based 40/20/40), data-driven explicitly deferred until ~100+ conversions/channel/month. (Recommended yes — early numbers will be rule-based, not algorithmic.)
2. **Meta ads?** — does OPS run Meta ads at all? (No Meta API client exists; `meta_ads` is manual-entry only.) If no, Phase 3e is skipped until it does.
3. **Apple Search Ads?** — does OPS run ASA with real spend? (ASA is a string literal today — no client, no AdServices capture.) Phases 3c/3d are conditional on real ASA spend.
4. **Add UTM/source capture at signup NOW (Phase 2)?** — cheap wiring of existing primitives, the single highest-leverage unlock for all future attribution, but it touches the live signup path (`/api/auth/sync-user`, `create_company_for_owner`) and ops-site middleware. Approve proceeding in parallel with Phase 1?
5. **Start the Google Ads Basic/Standard API access application now?** — token is test-only (every sync fails); approval ~5 business days; nothing in the Google slice produces data until it lands. (Recommended: start in parallel with Phase 1.)
6. **ASC key + adamId** — Jackson generates an **Admin-role** ASC API key (download the `.p8` once) and provides `ASC_APP_ID`. Confirm who has App Store Connect Admin access to do this.
7. **"How did you hear about us?" on iOS onboarding** — web has `companies.referral_method` (7/57 filled). Adding it to iOS onboarding ships on the App Store release cadence and adds an onboarding step. Acceptable given the OPS "invisible helpfulness" bar? (Recommended: one optional, skippable field.)
8. **Pre-orders** — Apple's true conversion formula includes pre-orders (a separate third report, out of Phase 1). **Confirm whether the app has *ever* used App Store pre-orders.** If unconfirmed, the conversion view's "minus pre-order term" caveat stays visible (we do not assume zero).
9. **Screen placement** — confirm `Growth > App Store` (recommended — a GROWTH section already exists and this is an acquisition surface) vs the ANALYTICS section.
10. **Migration posture** — per the low-tenant prod policy, the additive ASC migration could go directly to prod after read-only recon + sign-off. Confirm direct prod application (with explicit go-ahead) vs staging elsewhere.
