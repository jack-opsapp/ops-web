\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.jwt() returns jsonb
language sql stable as $$ select '{"role":"service_role"}'::jsonb $$;

create table public.companies (
  id uuid primary key,
  account_holder_id text,
  admin_ids text[],
  deleted_at timestamptz,
  trial_start_date timestamptz
);
create table public.users (
  id uuid primary key,
  company_id uuid references public.companies(id),
  is_company_admin boolean,
  is_active boolean,
  deleted_at timestamptz
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  company_id text not null,
  type text not null,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  persistent boolean,
  action_url text,
  action_label text,
  deep_link_type text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_reason text
);
create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  company_id uuid,
  role text,
  plan text,
  event_type text not null,
  event_name text not null,
  platform text not null,
  app_version text,
  device_type text,
  os_version text,
  session_id uuid not null,
  properties jsonb default '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now(),
  schema_version smallint not null default 1,
  environment text not null default 'production',
  received_at timestamptz not null default now()
);
create table public.analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  status text not null,
  source_max_date date
);
create table public.asc_sync_status (
  job_name text primary key,
  status text not null,
  last_synced_date date
);
create table public.asc_downloads (
  id bigint generated always as identity primary key,
  reporting_date date not null
);
create table public.asc_reports (
  id uuid primary key default gen_random_uuid(),
  category text not null
);
create table public.trial_attributions (
  company_id uuid primary key,
  attribution_basis text not null default 'unknown',
  classification_reason text,
  first_touch_at timestamptz,
  gclid text,
  fbclid text,
  updated_at timestamptz not null default now()
);
create table public.touchpoints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  expires_at timestamptz
);
create table public.growth_funnel_daily (
  activated_companies bigint,
  first_value_companies bigint,
  paid_companies bigint,
  revenue_cents bigint
);
create table public.growth_company_milestones (
  activated_at timestamptz,
  first_value_at timestamptz,
  first_paid_at timestamptz
);
create table public.billing_events (
  company_id uuid,
  event_type text,
  amount_cents bigint
);
create table public.ga4_daily_acquisition (
  property_key text,
  reporting_date date,
  sessions bigint
);

\ir ../../supabase/migrations/20260831060000_analytics_health_and_retention.sql

insert into public.companies (
  id, account_holder_id, admin_ids, trial_start_date
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  now()
);
insert into public.users (
  id, company_id, is_company_admin, is_active
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true,
  true
);

select public.apply_analytics_health_source(
  'search_console',
  'healthy',
  '{"checks":[]}'::jsonb,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
select public.apply_analytics_health_source(
  'search_console',
  'expected_latency',
  '{"checks":[]}'::jsonb,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
select public.apply_analytics_health_source(
  'search_console',
  'failed',
  '{"checks":[{"key":"finalized","state":"failed"}]}'::jsonb,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
select public.apply_analytics_health_source(
  'search_console',
  'failed',
  '{"checks":[{"key":"finalized","state":"failed"}]}'::jsonb,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);

do $assert_failure$
begin
  if (select count(*) from public.notifications
      where type = 'analytics_source_failed' and resolved_at is null) <> 1 then
    raise exception 'healthy-to-failed did not create exactly one open notification';
  end if;
  if (select state from public.analytics_health_states
      where source = 'search_console') <> 'failed' then
    raise exception 'expected latency erased or corrupted settled health state';
  end if;
end
$assert_failure$;

select public.apply_analytics_health_source(
  'search_console',
  'healthy',
  '{"checks":[]}'::jsonb,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);

do $assert_recovery$
begin
  if (select count(*) from public.notifications
      where type = 'analytics_source_failed' and resolved_at is null) <> 0 then
    raise exception 'recovery did not resolve the open notification';
  end if;
  if (select resolution_reason from public.notifications
      where type = 'analytics_source_failed') <> 'analytics_source_recovered' then
    raise exception 'recovery reason was not recorded';
  end if;
end
$assert_recovery$;

insert into public.analytics_events (
  id,
  event_type,
  event_name,
  platform,
  session_id,
  properties,
  created_at,
  received_at
) values (
  '11111111-1111-4111-8111-111111111111',
  'action',
  'safe_event',
  'web',
  '22222222-2222-4222-8222-222222222222',
  '{"action":"archive"}',
  now() - interval '13 months',
  now() - interval '13 months'
);
insert into public.touchpoints (company_id, expires_at) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  now() - interval '1 day'
);
insert into public.trial_attributions (
  company_id, first_touch_at, gclid, fbclid
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  now() - interval '31 days',
  'gclid-test',
  'fbclid-test'
);

select public.enforce_analytics_retention(now());

do $assert_retention$
begin
  if (select count(*) from public.analytics_events) <> 0 then
    raise exception 'expired raw event survived retention';
  end if;
  if (select event_count from public.analytics_events_daily
      where event_name = 'safe_event') <> 1 then
    raise exception 'daily aggregate was not retained';
  end if;
  if (select count(*) from public.touchpoints) <> 0 then
    raise exception 'expired raw touchpoint survived retention';
  end if;
  if exists (select 1 from public.trial_attributions
      where gclid is not null or fbclid is not null) then
    raise exception 'expired click ids survived retention';
  end if;
end
$assert_retention$;

do $assert_privacy$
begin
  begin
    insert into public.analytics_events (
      event_type,
      event_name,
      platform,
      session_id,
      properties
    ) values (
      'action',
      'unsafe_event',
      'web',
      '33333333-3333-4333-8333-333333333333',
      '{"project_id":"44444444-4444-4444-8444-444444444444"}'
    );
    raise exception 'unsafe property insert unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end
$assert_privacy$;

select public.get_growth_analytics_health_snapshot();
