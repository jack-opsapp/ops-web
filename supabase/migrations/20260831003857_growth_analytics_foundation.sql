begin;

-- Growth analytics foundation. Aggregate discovery sources retain their native
-- grain; deterministic first-party attribution stays company-scoped; product
-- analytics remains diagnostic rather than the business source of truth.

alter table public.trial_attributions
  add column if not exists referrer text,
  add column if not exists first_touch_at timestamptz,
  add column if not exists self_reported_source text,
  add column if not exists attribution_basis text not null default 'unknown',
  add column if not exists attribution_confidence numeric(4, 3),
  add column if not exists classification_reason text,
  add column if not exists capture_version smallint not null default 1;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trial_attributions'::regclass
      and conname = 'trial_attributions_basis_check'
  ) then
    alter table public.trial_attributions
      add constraint trial_attributions_basis_check
      check (attribution_basis in (
        'verified_click_id',
        'deterministic_first_party',
        'utm_referrer',
        'app_store',
        'self_reported',
        'direct',
        'unknown'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trial_attributions'::regclass
      and conname = 'trial_attributions_confidence_check'
  ) then
    alter table public.trial_attributions
      add constraint trial_attributions_confidence_check
      check (
        attribution_confidence is null
        or attribution_confidence between 0 and 1
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trial_attributions'::regclass
      and conname = 'trial_attributions_capture_version_check'
  ) then
    alter table public.trial_attributions
      add constraint trial_attributions_capture_version_check
      check (capture_version > 0);
  end if;
end
$constraints$;

alter table public.analytics_events
  add column if not exists schema_version smallint,
  add column if not exists environment text,
  add column if not exists received_at timestamptz;

update public.analytics_events
set schema_version = coalesce(schema_version, 1),
    environment = coalesce(environment, 'production'),
    received_at = coalesce(received_at, created_at, now())
where schema_version is null
   or environment is null
   or received_at is null;

alter table public.analytics_events
  alter column schema_version set default 1,
  alter column schema_version set not null,
  alter column environment set default 'production',
  alter column environment set not null,
  alter column received_at set default now(),
  alter column received_at set not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.analytics_events'::regclass
      and conname = 'analytics_events_schema_version_check'
  ) then
    alter table public.analytics_events
      add constraint analytics_events_schema_version_check
      check (schema_version > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.analytics_events'::regclass
      and conname = 'analytics_events_environment_check'
  ) then
    alter table public.analytics_events
      add constraint analytics_events_environment_check
      check (environment in ('production', 'preview', 'development', 'test'));
  end if;
end
$constraints$;

create table if not exists public.search_console_daily (
  id uuid primary key default gen_random_uuid(),
  site_url text not null,
  reporting_date date not null,
  query text not null default '',
  page text not null,
  country text not null default '',
  device text not null default '',
  clicks bigint not null default 0 check (clicks >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  ctr numeric(12, 9) not null default 0 check (ctr between 0 and 1),
  position numeric(12, 6) not null default 0 check (position >= 0),
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_url, reporting_date, query, page, country, device)
);

create index if not exists search_console_daily_date_idx
  on public.search_console_daily (reporting_date desc);
create index if not exists search_console_daily_page_date_idx
  on public.search_console_daily (page, reporting_date desc);

create table if not exists public.ga4_daily_acquisition (
  id uuid primary key default gen_random_uuid(),
  property_key text not null check (property_key in ('marketing', 'web_app', 'ios_app')),
  property_id text not null check (property_id ~ '^[0-9]+$'),
  reporting_date date not null,
  default_channel_group text not null,
  source text not null,
  medium text not null,
  campaign text not null,
  landing_path text not null check (
    landing_path like '/%'
    and strpos(landing_path, '?') = 0
    and strpos(landing_path, '#') = 0
  ),
  sessions bigint not null default 0 check (sessions >= 0),
  engaged_sessions bigint not null default 0 check (engaged_sessions >= 0),
  new_users bigint not null default 0 check (new_users >= 0),
  total_users bigint not null default 0 check (total_users >= 0),
  key_events bigint not null default 0 check (key_events >= 0),
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    property_key,
    reporting_date,
    default_channel_group,
    source,
    medium,
    campaign,
    landing_path
  )
);

create index if not exists ga4_daily_acquisition_property_date_idx
  on public.ga4_daily_acquisition (property_key, reporting_date desc);
create index if not exists ga4_daily_acquisition_channel_date_idx
  on public.ga4_daily_acquisition (default_channel_group, reporting_date desc);

create table if not exists public.channel_map (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  raw_channel text,
  raw_source text,
  raw_medium text,
  canonical_channel text not null,
  is_paid boolean not null default false,
  priority integer not null default 100 check (priority >= 0),
  classification_reason text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_map_identity_uk
  on public.channel_map (
    source_system,
    raw_channel,
    raw_source,
    raw_medium
  ) nulls not distinct;
create index if not exists channel_map_lookup_idx
  on public.channel_map (source_system, active, priority);

create table if not exists public.channel_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  canonical_channel text not null,
  sub_channel text,
  campaign text,
  territory text,
  metric_type text not null,
  metric_value numeric(20, 6) not null check (metric_value >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  source_system text not null,
  source_grain text not null,
  source_key text not null,
  dimensions jsonb not null default '{}'::jsonb,
  as_of timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_key, metric_type, metric_date)
);

create index if not exists channel_metrics_channel_date_idx
  on public.channel_metrics (canonical_channel, metric_date desc);
create index if not exists channel_metrics_source_date_idx
  on public.channel_metrics (source_system, metric_date desc);
create index if not exists channel_metrics_metric_date_idx
  on public.channel_metrics (metric_type, metric_date desc);

create table if not exists public.touchpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  anonymous_id text,
  occurred_at timestamptz not null,
  canonical_channel text not null,
  sub_channel text,
  campaign text,
  landing_path text check (
    landing_path is null
    or (
      landing_path like '/%'
      and strpos(landing_path, '?') = 0
      and strpos(landing_path, '#') = 0
    )
  ),
  referrer_domain text,
  click_ids jsonb not null default '{}'::jsonb,
  raw_source jsonb not null default '{}'::jsonb,
  attribution_basis text not null check (attribution_basis in (
    'verified_click_id',
    'deterministic_first_party',
    'utm_referrer',
    'direct'
  )),
  attribution_confidence numeric(4, 3) not null check (
    attribution_confidence between 0 and 1
  ),
  capture_version smallint not null check (capture_version > 0),
  dedupe_key text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (company_id is not null or anonymous_id is not null)
);

create index if not exists touchpoints_company_occurred_idx
  on public.touchpoints (company_id, occurred_at desc)
  where company_id is not null;
create index if not exists touchpoints_anonymous_occurred_idx
  on public.touchpoints (anonymous_id, occurred_at desc)
  where anonymous_id is not null;
create index if not exists touchpoints_expiry_idx
  on public.touchpoints (expires_at)
  where expires_at is not null;

create table if not exists public.analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (
    status in ('running', 'complete', 'partial', 'failed')
  ),
  source_max_date date,
  row_count bigint not null default 0 check (row_count >= 0),
  error_code text,
  error_message text,
  cursor text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (finished_at is null or finished_at >= started_at),
  check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

create index if not exists analytics_sync_runs_source_started_idx
  on public.analytics_sync_runs (source, started_at desc);
create index if not exists analytics_sync_runs_failed_idx
  on public.analytics_sync_runs (started_at desc)
  where status = 'failed';

alter table public.search_console_daily enable row level security;
alter table public.ga4_daily_acquisition enable row level security;
alter table public.channel_map enable row level security;
alter table public.channel_metrics enable row level security;
alter table public.touchpoints enable row level security;
alter table public.analytics_sync_runs enable row level security;

revoke all on table public.search_console_daily from public, anon, authenticated;
revoke all on table public.ga4_daily_acquisition from public, anon, authenticated;
revoke all on table public.channel_map from public, anon, authenticated;
revoke all on table public.channel_metrics from public, anon, authenticated;
revoke all on table public.touchpoints from public, anon, authenticated;
revoke all on table public.analytics_sync_runs from public, anon, authenticated;

grant all on table public.search_console_daily to service_role;
grant all on table public.ga4_daily_acquisition to service_role;
grant all on table public.channel_map to service_role;
grant all on table public.channel_metrics to service_role;
grant all on table public.touchpoints to service_role;
grant all on table public.analytics_sync_runs to service_role;

create or replace view public.growth_funnel_daily
with (security_invoker = true) as
with first_project as (
  select company_id, min(created_at) as first_project_at
  from public.projects
  where deleted_at is null
  group by company_id
)
select
  ta.trial_started_at::date as reporting_date,
  'trial_start_cohort'::text as grain,
  count(*)::bigint as trials_started,
  count(*) filter (
    where ta.attributed_channel <> 'unknown'
      and ta.attribution_basis <> 'unknown'
  )::bigint as classified_trials,
  count(*) filter (where fp.first_project_at is not null)::bigint
    as first_project_companies,
  count(*) filter (where ta.first_paid_at is not null)::bigint
    as paid_companies
from public.trial_attributions ta
left join first_project fp on fp.company_id = ta.company_id
group by ta.trial_started_at::date;

create or replace view public.growth_channel_performance
with (security_invoker = true) as
with first_project as (
  select company_id, min(created_at) as first_project_at
  from public.projects
  where deleted_at is null
  group by company_id
), paid_revenue as (
  select
    company_id,
    sum(amount_cents) filter (where amount_cents > 0) as revenue_cents
  from public.billing_events
  where event_type = 'invoice.paid'
    and company_id is not null
  group by company_id
)
select
  ta.trial_started_at::date as reporting_date,
  'trial_start_cohort'::text as grain,
  ta.attributed_channel as canonical_channel,
  ta.attribution_basis,
  count(*)::bigint as trials_started,
  count(*) filter (where fp.first_project_at is not null)::bigint
    as first_project_companies,
  count(*) filter (where ta.first_paid_at is not null)::bigint
    as paid_companies,
  coalesce(sum(pr.revenue_cents), 0)::bigint as revenue_cents
from public.trial_attributions ta
left join first_project fp on fp.company_id = ta.company_id
left join paid_revenue pr on pr.company_id = ta.company_id
group by
  ta.trial_started_at::date,
  ta.attributed_channel,
  ta.attribution_basis;

create or replace view public.growth_attribution_coverage
with (security_invoker = true) as
select
  trial_started_at::date as reporting_date,
  count(*)::bigint as total_trials,
  count(*) filter (
    where attribution_basis in (
      'verified_click_id',
      'deterministic_first_party',
      'utm_referrer',
      'app_store'
    )
  )::bigint as deterministic_trials,
  count(*) filter (where attribution_basis = 'self_reported')::bigint
    as self_reported_trials,
  count(*) filter (where attribution_basis = 'direct')::bigint
    as direct_trials,
  count(*) filter (where attribution_basis = 'unknown')::bigint
    as unknown_trials,
  round(
    count(*) filter (where attribution_basis <> 'unknown')::numeric
      / nullif(count(*), 0),
    4
  ) as coverage_ratio
from public.trial_attributions
group by trial_started_at::date;

create or replace view public.growth_data_health
with (security_invoker = true) as
select distinct on (source)
  source,
  status,
  started_at,
  finished_at,
  source_max_date,
  row_count,
  error_code,
  error_message,
  metadata
from public.analytics_sync_runs
order by source, started_at desc;

revoke all on table public.growth_funnel_daily from public, anon, authenticated;
revoke all on table public.growth_channel_performance from public, anon, authenticated;
revoke all on table public.growth_attribution_coverage from public, anon, authenticated;
revoke all on table public.growth_data_health from public, anon, authenticated;

grant select on table public.growth_funnel_daily to service_role;
grant select on table public.growth_channel_performance to service_role;
grant select on table public.growth_attribution_coverage to service_role;
grant select on table public.growth_data_health to service_role;

comment on table public.search_console_daily is
  'Search Console native-grain daily facts. Privacy-suppressed queries remain absent.';
comment on table public.ga4_daily_acquisition is
  'GA4 acquisition facts kept separate by explicit property identity.';
comment on table public.channel_metrics is
  'Long-form aggregate metrics with source system, source key, and exact grain.';
comment on table public.touchpoints is
  'Deterministic first-party touches only; aggregate sources never create rows here.';
comment on table public.analytics_sync_runs is
  'Observable source-ingestion outcomes; API failures are persisted rather than rendered as zero.';

commit;
