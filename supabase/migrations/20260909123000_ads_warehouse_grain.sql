-- Google Ads engine, phase 1: warehouse extension to ad-group / ad / asset /
-- keyword / click grain, a daily entity snapshot, and the keyword funnel view.
--
-- The engine (phase 3) reasons over these tables, never over live API calls:
-- what exists (ads_entities), how each unit performed per day (ads_daily_*),
-- and which keyword bought which trial (ads_click_map → trial_attributions →
-- ads_conversion_events, exposed as ads_funnel_by_keyword).
--
-- Server-only, hardened like the existing ads_daily_* tables (RLS on, client
-- grants revoked, service_role bypasses). Idempotent except for the keyword
-- table, which is dropped and recreated on a new grain: it holds 0 rows in
-- production (verified 2026-09-09) and its old key (date, keyword) cannot hold
-- one keyword that lives in two ad groups.

begin;

-- ─── Ad group grain ──────────────────────────────────────────────────────────

create table if not exists public.ads_daily_ad_group (
  date date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  ad_group_id text not null,
  ad_group_name text not null default '',
  status text not null default '',
  spend numeric not null default 0,
  clicks integer not null default 0,
  impressions integer not null default 0,
  conversions numeric not null default 0,
  ctr numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (date, ad_group_id)
);
alter table public.ads_daily_ad_group enable row level security;
revoke all on public.ads_daily_ad_group from anon, authenticated;
create index if not exists ads_daily_ad_group_date_idx on public.ads_daily_ad_group (date desc);

-- ─── Ad grain (with Google's own quality verdicts) ───────────────────────────

create table if not exists public.ads_daily_ad (
  date date not null,
  ad_group_id text not null,
  ad_id text not null,
  ad_type text not null default '',
  status text not null default '',
  ad_strength text,
  approval_status text,
  review_status text,
  final_url text,
  spend numeric not null default 0,
  clicks integer not null default 0,
  impressions integer not null default 0,
  conversions numeric not null default 0,
  ctr numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (date, ad_id)
);
alter table public.ads_daily_ad enable row level security;
revoke all on public.ads_daily_ad from anon, authenticated;
create index if not exists ads_daily_ad_date_idx on public.ads_daily_ad (date desc);

-- ─── Asset grain (RSA headlines / descriptions with performance labels) ─────

create table if not exists public.ads_daily_asset (
  date date not null,
  ad_id text not null,
  asset_id text not null,
  field_type text not null,
  performance_label text,
  pinned_field text,
  text text,
  impressions integer not null default 0,
  clicks integer not null default 0,
  conversions numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (date, ad_id, asset_id, field_type)
);
alter table public.ads_daily_asset enable row level security;
revoke all on public.ads_daily_asset from anon, authenticated;
create index if not exists ads_daily_asset_date_idx on public.ads_daily_asset (date desc);

-- ─── Keyword grain (recreated on the ad-group + criterion key) ──────────────

drop table if exists public.ads_daily_keyword;
create table public.ads_daily_keyword (
  date date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  ad_group_id text not null,
  ad_group_name text not null default '',
  criterion_id text not null,
  keyword text not null,
  match_type text not null default '',
  status text not null default '',
  quality_score integer,
  spend numeric not null default 0,
  clicks integer not null default 0,
  impressions integer not null default 0,
  conversions numeric not null default 0,
  average_cpc numeric,
  synced_at timestamptz not null default now(),
  primary key (date, ad_group_id, criterion_id)
);
alter table public.ads_daily_keyword enable row level security;
revoke all on public.ads_daily_keyword from anon, authenticated;
create index if not exists ads_daily_keyword_date_idx on public.ads_daily_keyword (date desc);
create index if not exists ads_daily_keyword_spend_idx on public.ads_daily_keyword (spend desc);

-- ─── Entity snapshot (what exists, keyed by Google resource name) ───────────

create table if not exists public.ads_entities (
  resource_name text primary key,
  entity_type text not null check (entity_type in (
    'campaign', 'campaign_budget', 'ad_group', 'ad', 'keyword',
    'negative_keyword', 'shared_set', 'shared_criterion', 'label'
  )),
  parent_resource_name text,
  name text not null default '',
  status text not null default '',
  payload jsonb not null default '{}'::jsonb,
  labels text[] not null default '{}'::text[],
  snapshot_at timestamptz not null default now()
);
alter table public.ads_entities enable row level security;
revoke all on public.ads_entities from anon, authenticated;
create index if not exists ads_entities_type_idx on public.ads_entities (entity_type, parent_resource_name);

-- ─── Click map (gclid → campaign / ad group / ad / keyword / day) ───────────
-- Google exposes click_view for the trailing 90 days; synced daily, kept forever.

create table if not exists public.ads_click_map (
  gclid text primary key,
  click_date date not null,
  campaign_id text,
  ad_group_id text,
  ad_id text,
  criterion_id text,
  keyword text,
  synced_at timestamptz not null default now()
);
alter table public.ads_click_map enable row level security;
revoke all on public.ads_click_map from anon, authenticated;
create index if not exists ads_click_map_click_date_idx on public.ads_click_map (click_date desc);

-- ─── Funnel by keyword ───────────────────────────────────────────────────────
-- Keyword grain (campaign / ad group / criterion). Clicks and spend from
-- ads_daily_keyword; trials are companies whose trial_attributions.gclid maps
-- to the keyword through ads_click_map; activated = a trial_activated event
-- exists (any delivery state — the moment happened); paid = first_paid_at set.
-- Owner-run (no security_invoker): service-role only, like the tables.

create or replace view public.ads_funnel_by_keyword as
with keyword_metrics as (
  select
    k.campaign_id,
    max(k.campaign_name) as campaign_name,
    k.ad_group_id,
    max(k.ad_group_name) as ad_group_name,
    k.criterion_id,
    max(k.keyword) as keyword,
    max(k.match_type) as match_type,
    sum(k.clicks)::bigint as clicks,
    sum(k.spend)::numeric as spend
  from public.ads_daily_keyword k
  group by k.campaign_id, k.ad_group_id, k.criterion_id
),
attributed as (
  select
    m.campaign_id,
    m.ad_group_id,
    m.criterion_id,
    t.company_id,
    t.first_paid_at,
    exists (
      select 1
        from public.ads_conversion_events e
       where e.company_id = t.company_id
         and e.kind = 'trial_activated'
    ) as activated
  from public.trial_attributions t
  join public.ads_click_map m on m.gclid = t.gclid
  where t.gclid is not null
),
funnel as (
  select
    campaign_id,
    ad_group_id,
    criterion_id,
    count(distinct company_id)::bigint as trials,
    count(distinct company_id) filter (where activated)::bigint as activated,
    count(distinct company_id) filter (where first_paid_at is not null)::bigint as paid
  from attributed
  group by campaign_id, ad_group_id, criterion_id
)
select
  coalesce(k.campaign_id, f.campaign_id) as campaign_id,
  k.campaign_name,
  coalesce(k.ad_group_id, f.ad_group_id) as ad_group_id,
  k.ad_group_name,
  coalesce(k.criterion_id, f.criterion_id) as criterion_id,
  k.keyword,
  k.match_type,
  coalesce(k.clicks, 0) as clicks,
  coalesce(k.spend, 0) as spend,
  coalesce(f.trials, 0) as trials,
  coalesce(f.activated, 0) as activated,
  coalesce(f.paid, 0) as paid,
  case when coalesce(f.trials, 0) > 0 then round(coalesce(k.spend, 0) / f.trials, 2) end as cost_per_trial,
  case when coalesce(f.paid, 0) > 0 then round(coalesce(k.spend, 0) / f.paid, 2) end as cost_per_paid
from keyword_metrics k
full outer join funnel f
  on f.campaign_id = k.campaign_id
 and f.ad_group_id = k.ad_group_id
 and f.criterion_id = k.criterion_id;

revoke all on public.ads_funnel_by_keyword from public, anon, authenticated;
grant select on public.ads_funnel_by_keyword to service_role;

commit;
