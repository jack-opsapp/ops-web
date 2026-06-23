-- App Store Connect Analytics — Phase 1 ingestion + facts
-- Applied to prod (ops-app / ijeekuhbatykdomumfjx) 2026-06-22 via MCP apply_migration.
-- Additive only. Service-role write, admin-gated server reads only (no client grants).
-- Provisional is computed at read time (NOT a stored generated column on current_date).
-- Fact unique constraints use NULLS NOT DISTINCT (Apple emits blank dimensions).

create table if not exists public.asc_report_requests (
  id              uuid primary key default gen_random_uuid(),
  asc_request_id  text not null unique,
  app_id          text not null,
  access_type     text not null check (access_type in ('ONGOING','ONE_TIME_SNAPSHOT')),
  created_at      timestamptz not null default now(),
  stopped_at      timestamptz
);

create table if not exists public.asc_reports (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.asc_report_requests(id) on delete cascade,
  asc_report_id  text not null unique,
  category       text not null,
  report_name    text,
  created_at     timestamptz not null default now()
);

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

create table if not exists public.asc_report_segments (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null references public.asc_report_instances(id) on delete cascade,
  checksum        text not null,
  size_bytes      bigint,
  url             text,
  state           text not null default 'discovered'
                     check (state in ('discovered','processed','error')),
  rows_ingested   integer,
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (instance_id, checksum)
);

create table if not exists public.asc_raw_rows (
  id              bigint generated always as identity primary key,
  segment_id      uuid not null references public.asc_report_segments(id) on delete cascade,
  report_kind     text not null check (report_kind in ('discovery_engagement','downloads')),
  reporting_date  date not null,
  raw             jsonb not null,
  ingested_at     timestamptz not null default now()
);
create index if not exists asc_raw_rows_kind_date_idx on public.asc_raw_rows (report_kind, reporting_date);

create table if not exists public.asc_discovery_engagement (
  id                  bigint generated always as identity primary key,
  granularity         text not null default 'DAILY',
  reporting_date      date not null,
  engagement_type     text,
  page_type           text,
  source_type         text,
  source_info         text,
  device              text,
  platform_version    text,
  territory           text,
  channel             text not null default 'unknown',
  counts              bigint not null default 0,
  unique_counts       bigint not null default 0,
  segment_id          uuid references public.asc_report_segments(id) on delete set null,
  updated_at          timestamptz not null default now(),
  constraint asc_de_uk unique nulls not distinct
    (granularity, reporting_date, engagement_type, page_type,
     source_type, source_info, device, platform_version, territory)
);
create index if not exists asc_de_date_idx      on public.asc_discovery_engagement (reporting_date);
create index if not exists asc_de_channel_idx   on public.asc_discovery_engagement (channel, reporting_date);
create index if not exists asc_de_territory_idx on public.asc_discovery_engagement (territory, reporting_date);

create table if not exists public.asc_downloads (
  id                  bigint generated always as identity primary key,
  granularity         text not null default 'DAILY',
  reporting_date      date not null,
  download_type       text,
  page_type           text,
  source_type         text,
  source_info         text,
  campaign            text,
  device              text,
  platform_version    text,
  territory           text,
  channel             text not null default 'unknown',
  counts              bigint not null default 0,
  unique_counts       bigint not null default 0,
  segment_id          uuid references public.asc_report_segments(id) on delete set null,
  updated_at          timestamptz not null default now(),
  constraint asc_dl_uk unique nulls not distinct
    (granularity, reporting_date, download_type, page_type,
     source_type, source_info, campaign, device, platform_version, territory)
);
create index if not exists asc_dl_date_idx      on public.asc_downloads (reporting_date);
create index if not exists asc_dl_channel_idx   on public.asc_downloads (channel, reporting_date);
create index if not exists asc_dl_territory_idx on public.asc_downloads (territory, reporting_date);

create table if not exists public.asc_sync_status (
  job_name          text primary key,
  status            text not null default 'idle'
                      check (status in ('idle','running','complete','failed')),
  last_synced_date  date,
  last_run_at       timestamptz,
  error             text,
  updated_at        timestamptz not null default now()
);

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

alter table public.asc_report_requests      enable row level security;
alter table public.asc_reports              enable row level security;
alter table public.asc_report_instances     enable row level security;
alter table public.asc_report_segments      enable row level security;
alter table public.asc_raw_rows             enable row level security;
alter table public.asc_discovery_engagement enable row level security;
alter table public.asc_downloads            enable row level security;
alter table public.asc_sync_status          enable row level security;
