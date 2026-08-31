-- Atomic daily replacement boundaries for restating aggregate analytics
-- sources. Only the service role can execute these functions; aggregate APIs
-- never receive direct table-write authority.

begin;

set local search_path = public, private, pg_temp;

insert into public.channel_map (
  source_system,
  raw_channel,
  raw_source,
  raw_medium,
  canonical_channel,
  is_paid,
  priority,
  classification_reason
) values
  ('search_console', 'Organic Search', 'google', 'organic', 'organic_search', false, 1, 'search_console_web_search'),
  ('ga4', 'Organic Search', null, null, 'organic_search', false, 10, 'ga4_default_channel_group'),
  ('ga4', 'Organic Social', null, null, 'organic_social', false, 10, 'ga4_default_channel_group'),
  ('ga4', 'Referral', null, null, 'referral', false, 10, 'ga4_default_channel_group'),
  ('ga4', 'Direct', null, null, 'direct', false, 10, 'ga4_default_channel_group'),
  ('ga4', 'Paid Search', 'google', null, 'google_ads', true, 1, 'ga4_google_paid_search'),
  ('ga4', 'Paid Social', 'facebook', null, 'meta_ads', true, 1, 'ga4_meta_paid_social'),
  ('ga4', 'Paid Social', 'instagram', null, 'meta_ads', true, 1, 'ga4_meta_paid_social'),
  ('ga4', 'Paid Social', 'meta', null, 'meta_ads', true, 1, 'ga4_meta_paid_social'),
  ('ga4', 'Paid Search', null, null, 'other', true, 50, 'ga4_other_paid_search'),
  ('ga4', 'Paid Social', null, null, 'other', true, 50, 'ga4_other_paid_social'),
  ('ga4', null, null, null, 'other', false, 1000, 'ga4_unclassified')
on conflict (source_system, raw_channel, raw_source, raw_medium)
do update set
  canonical_channel = excluded.canonical_channel,
  is_paid = excluded.is_paid,
  priority = excluded.priority,
  classification_reason = excluded.classification_reason,
  active = true,
  updated_at = pg_catalog.now();

create or replace function public.replace_search_console_daily(
  p_site_url text,
  p_reporting_date date,
  p_rows jsonb,
  p_metrics jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_row_count integer;
  v_metric_count integer;
begin
  if nullif(pg_catalog.btrim(p_site_url), '') is null
     or p_reporting_date is null
     or p_rows is null
     or p_metrics is null
     or pg_catalog.jsonb_typeof(p_rows) <> 'array'
     or pg_catalog.jsonb_typeof(p_metrics) <> 'array'
     or pg_catalog.jsonb_array_length(p_rows) > 50000
     or pg_catalog.jsonb_array_length(p_metrics) > 100000
     or pg_catalog.octet_length(p_rows::text) > 52428800
     or pg_catalog.octet_length(p_metrics::text) > 52428800 then
    raise exception 'search_console_replace_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_rows) as row_value(
      site_url text,
      reporting_date date,
      query text,
      page text,
      country text,
      device text,
      clicks bigint,
      impressions bigint,
      ctr numeric,
      position numeric,
      source_updated_at timestamptz,
      updated_at timestamptz
    )
    where row_value.site_url is distinct from p_site_url
      or row_value.reporting_date is distinct from p_reporting_date
      or row_value.page is null
      or row_value.clicks < 0
      or row_value.impressions < 0
      or row_value.ctr not between 0 and 1
      or row_value.position < 0
  ) then
    raise exception 'search_console_row_identity_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_metrics) as metric(
      metric_date date,
      source_system text
    )
    where metric.metric_date is distinct from p_reporting_date
      or metric.source_system is distinct from 'search_console'
  ) then
    raise exception 'search_console_metric_identity_invalid' using errcode = '22023';
  end if;

  delete from public.search_console_daily
  where site_url = p_site_url
    and reporting_date = p_reporting_date;

  insert into public.search_console_daily (
    site_url,
    reporting_date,
    query,
    page,
    country,
    device,
    clicks,
    impressions,
    ctr,
    position,
    source_updated_at,
    updated_at
  )
  select
    row_value.site_url,
    row_value.reporting_date,
    coalesce(row_value.query, ''),
    row_value.page,
    coalesce(row_value.country, ''),
    coalesce(row_value.device, ''),
    coalesce(row_value.clicks, 0),
    coalesce(row_value.impressions, 0),
    coalesce(row_value.ctr, 0),
    coalesce(row_value.position, 0),
    coalesce(row_value.source_updated_at, pg_catalog.now()),
    coalesce(row_value.updated_at, pg_catalog.now())
  from pg_catalog.jsonb_to_recordset(p_rows) as row_value(
    site_url text,
    reporting_date date,
    query text,
    page text,
    country text,
    device text,
    clicks bigint,
    impressions bigint,
    ctr numeric,
    position numeric,
    source_updated_at timestamptz,
    updated_at timestamptz
  );
  get diagnostics v_row_count = row_count;

  delete from public.channel_metrics
  where source_system = 'search_console'
    and metric_date = p_reporting_date;

  insert into public.channel_metrics (
    metric_date,
    canonical_channel,
    sub_channel,
    campaign,
    territory,
    metric_type,
    metric_value,
    currency,
    source_system,
    source_grain,
    source_key,
    dimensions,
    as_of,
    updated_at
  )
  select
    metric.metric_date,
    metric.canonical_channel,
    metric.sub_channel,
    metric.campaign,
    metric.territory,
    metric.metric_type,
    metric.metric_value,
    metric.currency,
    metric.source_system,
    metric.source_grain,
    metric.source_key,
    coalesce(metric.dimensions, '{}'::jsonb),
    metric.as_of,
    coalesce(metric.updated_at, pg_catalog.now())
  from pg_catalog.jsonb_to_recordset(p_metrics) as metric(
    metric_date date,
    canonical_channel text,
    sub_channel text,
    campaign text,
    territory text,
    metric_type text,
    metric_value numeric,
    currency text,
    source_system text,
    source_grain text,
    source_key text,
    dimensions jsonb,
    as_of timestamptz,
    updated_at timestamptz
  )
  ;
  get diagnostics v_metric_count = row_count;

  return pg_catalog.jsonb_build_object(
    'row_count', v_row_count,
    'metric_count', v_metric_count
  );
end
$function$;

revoke all on function public.replace_search_console_daily(
  text, date, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_search_console_daily(
  text, date, jsonb, jsonb
) to service_role;

create or replace function public.replace_ga4_daily_acquisition(
  p_property_key text,
  p_property_id text,
  p_reporting_date date,
  p_rows jsonb,
  p_metrics jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_row_count integer;
  v_metric_count integer;
begin
  if p_property_key not in ('marketing', 'web_app')
     or p_property_id !~ '^[0-9]+$'
     or p_reporting_date is null
     or p_rows is null
     or p_metrics is null
     or pg_catalog.jsonb_typeof(p_rows) <> 'array'
     or pg_catalog.jsonb_typeof(p_metrics) <> 'array'
     or pg_catalog.jsonb_array_length(p_rows) > 100000
     or pg_catalog.jsonb_array_length(p_metrics) > 500000
     or pg_catalog.octet_length(p_rows::text) > 52428800
     or pg_catalog.octet_length(p_metrics::text) > 104857600 then
    raise exception 'ga4_replace_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_rows) as row_value(
      property_key text,
      property_id text,
      reporting_date date,
      default_channel_group text,
      source text,
      medium text,
      campaign text,
      landing_path text,
      sessions bigint,
      engaged_sessions bigint,
      new_users bigint,
      total_users bigint,
      key_events bigint,
      source_updated_at timestamptz,
      updated_at timestamptz
    )
    where row_value.property_key is distinct from p_property_key
      or row_value.property_id is distinct from p_property_id
      or row_value.reporting_date is distinct from p_reporting_date
      or row_value.sessions < 0
      or row_value.engaged_sessions < 0
      or row_value.new_users < 0
      or row_value.total_users < 0
      or row_value.key_events < 0
      or row_value.landing_path is null
      or row_value.landing_path not like '/%'
      or pg_catalog.strpos(row_value.landing_path, '?') > 0
      or pg_catalog.strpos(row_value.landing_path, '#') > 0
  ) then
    raise exception 'ga4_row_identity_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_metrics) as metric(
      metric_date date,
      source_system text,
      dimensions jsonb
    )
    where metric.metric_date is distinct from p_reporting_date
      or metric.source_system is distinct from 'ga4'
      or metric.dimensions ->> 'property_key' is distinct from p_property_key
      or metric.dimensions ->> 'property_id' is distinct from p_property_id
  ) then
    raise exception 'ga4_metric_identity_invalid' using errcode = '22023';
  end if;

  delete from public.ga4_daily_acquisition
  where property_key = p_property_key
    and reporting_date = p_reporting_date;

  insert into public.ga4_daily_acquisition (
    property_key,
    property_id,
    reporting_date,
    default_channel_group,
    source,
    medium,
    campaign,
    landing_path,
    sessions,
    engaged_sessions,
    new_users,
    total_users,
    key_events,
    source_updated_at,
    updated_at
  )
  select
    row_value.property_key,
    row_value.property_id,
    row_value.reporting_date,
    row_value.default_channel_group,
    row_value.source,
    row_value.medium,
    row_value.campaign,
    row_value.landing_path,
    coalesce(row_value.sessions, 0),
    coalesce(row_value.engaged_sessions, 0),
    coalesce(row_value.new_users, 0),
    coalesce(row_value.total_users, 0),
    coalesce(row_value.key_events, 0),
    coalesce(row_value.source_updated_at, pg_catalog.now()),
    coalesce(row_value.updated_at, pg_catalog.now())
  from pg_catalog.jsonb_to_recordset(p_rows) as row_value(
    property_key text,
    property_id text,
    reporting_date date,
    default_channel_group text,
    source text,
    medium text,
    campaign text,
    landing_path text,
    sessions bigint,
    engaged_sessions bigint,
    new_users bigint,
    total_users bigint,
    key_events bigint,
    source_updated_at timestamptz,
    updated_at timestamptz
  );
  get diagnostics v_row_count = row_count;

  delete from public.channel_metrics
  where source_system = 'ga4'
    and metric_date = p_reporting_date
    and dimensions ->> 'property_key' = p_property_key;

  insert into public.channel_metrics (
    metric_date,
    canonical_channel,
    sub_channel,
    campaign,
    territory,
    metric_type,
    metric_value,
    currency,
    source_system,
    source_grain,
    source_key,
    dimensions,
    as_of,
    updated_at
  )
  select
    metric.metric_date,
    metric.canonical_channel,
    metric.sub_channel,
    metric.campaign,
    metric.territory,
    metric.metric_type,
    metric.metric_value,
    metric.currency,
    metric.source_system,
    metric.source_grain,
    metric.source_key,
    coalesce(metric.dimensions, '{}'::jsonb),
    metric.as_of,
    coalesce(metric.updated_at, pg_catalog.now())
  from pg_catalog.jsonb_to_recordset(p_metrics) as metric(
    metric_date date,
    canonical_channel text,
    sub_channel text,
    campaign text,
    territory text,
    metric_type text,
    metric_value numeric,
    currency text,
    source_system text,
    source_grain text,
    source_key text,
    dimensions jsonb,
    as_of timestamptz,
    updated_at timestamptz
  )
  ;
  get diagnostics v_metric_count = row_count;

  return pg_catalog.jsonb_build_object(
    'row_count', v_row_count,
    'metric_count', v_metric_count
  );
end
$function$;

revoke all on function public.replace_ga4_daily_acquisition(
  text, text, date, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_ga4_daily_acquisition(
  text, text, date, jsonb, jsonb
) to service_role;

commit;
