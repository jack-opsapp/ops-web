begin;

-- New writes must carry bounded, decision-useful properties only. NOT VALID
-- keeps legacy rows visible to the health scanner instead of making this
-- additive migration fail; PostgreSQL still enforces the check for every new
-- insert and update.
create or replace function public.analytics_properties_are_safe(
  p_properties jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $function$
  select
    pg_catalog.jsonb_typeof(p_properties) = 'object'
    and not exists (
      select 1
      from pg_catalog.jsonb_each(p_properties) as property(key, value)
      cross join lateral pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(property.value) = 'array'
            then property.value
          else pg_catalog.jsonb_build_array(property.value)
        end
      ) as item(value)
      where
        (
          lower(property.key) !~ '^has_'
          and lower(property.key) ~
            '(^|_)(email|phone|address|token|secret|password|client_id|customer_id|contact_id|user_id|company_id|project_id|task_id|opportunity_id|invoice_id|estimate_id|file_name)(_|$)'
        )
        or lower(property.key) ~
          '^(name|first_name|last_name|full_name|client_name|customer_name|contact_name|user_name|company_name|message|description|note|notes|title)$'
        or pg_catalog.jsonb_typeof(item.value) in ('object', 'array')
        or (
          pg_catalog.jsonb_typeof(item.value) = 'string'
          and (
            (item.value #>> '{}') ~*
              '(^|[^[:alnum:]._%+-])[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}([^[:alnum:]._%+-]|$)'
            or (item.value #>> '{}') ~* '(https?://|www\.)'
            or (item.value #>> '{}') ~*
              '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
            or (
              (item.value #>> '{}') ~ '[+() .-]'
              and pg_catalog.length(
                pg_catalog.regexp_replace(
                  item.value #>> '{}',
                  '[^0-9]',
                  '',
                  'g'
                )
              ) between 10 and 15
            )
          )
        )
    )
$function$;

revoke all on function public.analytics_properties_are_safe(jsonb)
  from public, anon, authenticated;
grant execute on function public.analytics_properties_are_safe(jsonb)
  to anon, authenticated, service_role;

alter table public.analytics_events
  drop constraint if exists analytics_events_properties_privacy_check;
alter table public.analytics_events
  add constraint analytics_events_properties_privacy_check
  check (
    coalesce(public.analytics_properties_are_safe(properties), false)
  ) not valid;

create table if not exists public.analytics_health_states (
  source text primary key check (source in (
    'ga_marketing',
    'ga_web_app',
    'ga_ios_app',
    'search_console',
    'app_store',
    'web_product',
    'attribution',
    'business_truth',
    'privacy'
  )),
  state text check (state is null or state in ('healthy', 'failed')),
  last_observed_state text not null check (
    last_observed_state in ('healthy', 'failed', 'expected_latency')
  ),
  details jsonb not null default '{}'::jsonb check (
    jsonb_typeof(details) = 'object'
    and octet_length(details::text) <= 16384
  ),
  checked_at timestamptz not null default now(),
  state_changed_at timestamptz,
  open_notification_id uuid references public.notifications(id)
    on delete set null
);

create unique index if not exists notifications_analytics_source_open_unique
  on public.notifications (user_id, company_id, type, dedupe_key)
  where type = 'analytics_source_failed'
    and resolved_at is null;

alter table public.analytics_health_states enable row level security;
revoke all on table public.analytics_health_states
  from public, anon, authenticated;
grant all on table public.analytics_health_states to service_role;

create table if not exists public.analytics_events_daily (
  event_date date not null,
  platform text not null,
  environment text not null,
  event_type text not null,
  event_name text not null,
  app_version text not null default '',
  event_count bigint not null check (event_count >= 0),
  session_count bigint not null check (session_count >= 0),
  duration_ms_total bigint not null check (duration_ms_total >= 0),
  first_event_at timestamptz not null,
  last_event_at timestamptz not null,
  aggregated_at timestamptz not null default now(),
  primary key (
    event_date,
    platform,
    environment,
    event_type,
    event_name,
    app_version
  ),
  check (last_event_at >= first_event_at)
);

create index if not exists analytics_events_daily_name_date_idx
  on public.analytics_events_daily (event_name, event_date desc);

alter table public.analytics_events_daily enable row level security;
revoke all on table public.analytics_events_daily
  from public, anon, authenticated;
grant all on table public.analytics_events_daily to service_role;

create or replace function public.get_growth_analytics_health_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required'
      using errcode = '42501';
  end if;

  with latest_search_console as (
    select run.status, run.source_max_date
    from public.analytics_sync_runs as run
    where run.source = 'search_console'
    order by run.started_at desc, run.id desc
    limit 1
  ), latest_ga4_marketing as (
    select run.status, run.source_max_date
    from public.analytics_sync_runs as run
    where run.source = 'ga4_marketing'
    order by run.started_at desc, run.id desc
    limit 1
  ), latest_ga4_web_app as (
    select run.status, run.source_max_date
    from public.analytics_sync_runs as run
    where run.source = 'ga4_web_app'
    order by run.started_at desc, run.id desc
    limit 1
  ), latest_app_store as (
    select sync.status, sync.last_synced_date
    from public.asc_sync_status as sync
    where sync.job_name = 'app-store-sync'
    limit 1
  ), eligible_attributions as (
    select attribution.*
    from public.trial_attributions as attribution
    join public.companies as company
      on company.id = attribution.company_id
    where company.deleted_at is null
      and company.trial_start_date is not null
  ), unknown_reasons as (
    select
      coalesce(
        nullif(btrim(attribution.classification_reason), ''),
        'unexplained'
      ) as reason,
      count(*)::bigint as count
    from eligible_attributions as attribution
    where attribution.attribution_basis = 'unknown'
    group by 1
  ), reconciliation as (
    select
      (
        (select count(*) from eligible_attributions)
        -
        (select count(*) from public.companies
          where deleted_at is null and trial_start_date is not null)
      )::bigint as trial_delta,
      (
        coalesce((select sum(activated_companies)
          from public.growth_funnel_daily), 0)
        -
        (select count(*) from public.growth_company_milestones
          where activated_at is not null)
      )::bigint as activation_delta,
      (
        coalesce((select sum(paid_companies)
          from public.growth_funnel_daily), 0)
        -
        (select count(*) from public.growth_company_milestones
          where first_paid_at is not null)
      )::bigint as paid_delta,
      (
        coalesce((select sum(revenue_cents)
          from public.growth_funnel_daily), 0)
        -
        (select coalesce(sum(amount_cents), 0)
          from public.billing_events
          where company_id is not null
            and event_type = 'invoice.paid'
            and amount_cents > 0)
      )::bigint as revenue_cents_delta
  )
  select jsonb_build_object(
    'search_console', jsonb_build_object(
      'status', coalesce(
        (select status from latest_search_console),
        'missing'
      ),
      'finalized_through',
        (select source_max_date from latest_search_console)
    ),
    'ga4_marketing', jsonb_build_object(
      'status', coalesce(
        (select status from latest_ga4_marketing),
        'missing'
      ),
      'finalized_through',
        (select source_max_date from latest_ga4_marketing)
    ),
    'ga4_web_app', jsonb_build_object(
      'status', coalesce(
        (select status from latest_ga4_web_app),
        'missing'
      ),
      'finalized_through',
        (select source_max_date from latest_ga4_web_app)
    ),
    'app_store', jsonb_build_object(
      'status', coalesce((select status from latest_app_store), 'missing'),
      'finalized_through', (
        select max(download.reporting_date)
        from public.asc_downloads as download
      ),
      'commerce_report_count', (
        select count(*) from public.asc_reports as report
        where report.category = 'APP_STORE_COMMERCE'
      ),
      'download_row_count', (
        select count(*) from public.asc_downloads
      )
    ),
    'web_product', jsonb_build_object(
      'warehouse_sessions', coalesce((
        select sum(fact.sessions)
        from public.ga4_daily_acquisition as fact
        where fact.property_key = 'web_app'
          and fact.reporting_date >= current_date - 7
      ), 0),
      'latest_event_at', (
        select max(event.received_at)
        from public.analytics_events as event
        where event.platform = 'web'
          and event.environment = 'production'
      )
    ),
    'event_quality', jsonb_build_object(
      'schema_invalid_count', (
        select count(*) from public.analytics_events as event
        where event.schema_version <> 1
          or event.environment not in (
            'production', 'preview', 'development', 'test'
          )
      ),
      'duplicate_event_id_count', (
        select count(*) - count(distinct event.id)
        from public.analytics_events as event
      ),
      'pii_finding_count', (
        select count(*) from public.analytics_events as event
        where not coalesce(
          public.analytics_properties_are_safe(event.properties),
          false
        )
      )
    ),
    'attribution', jsonb_build_object(
      'unknown_count', (
        select count(*) from eligible_attributions as attribution
        where attribution.attribution_basis = 'unknown'
      ),
      'reasons', coalesce((
        select jsonb_agg(
          jsonb_build_object('reason', reason, 'count', count)
          order by count desc, reason
        )
        from unknown_reasons
      ), '[]'::jsonb)
    ),
    'reconciliation', (
      select to_jsonb(reconciliation) from reconciliation
    )
  ) into v_result;

  return v_result;
end
$function$;

revoke all on function public.get_growth_analytics_health_snapshot()
  from public, anon, authenticated;
grant execute on function public.get_growth_analytics_health_snapshot()
  to service_role;

create or replace function public.apply_analytics_health_source(
  p_source text,
  p_state text,
  p_details jsonb,
  p_user_id uuid,
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_source text := nullif(btrim(p_source), '');
  v_dedupe_key text;
  v_label text;
  v_previous public.analytics_health_states%rowtype;
  v_had_previous boolean := false;
  v_notification_id uuid;
  v_created boolean := false;
  v_transition text := 'none';
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required'
      using errcode = '42501';
  end if;

  if v_source is null or v_source not in (
    'ga_marketing',
    'ga_web_app',
    'ga_ios_app',
    'search_console',
    'app_store',
    'web_product',
    'attribution',
    'business_truth',
    'privacy'
  ) then
    raise exception 'analytics health source is invalid'
      using errcode = '22023';
  end if;
  if p_state not in ('healthy', 'failed', 'expected_latency') then
    raise exception 'analytics health state is invalid'
      using errcode = '22023';
  end if;
  if p_details is null
     or jsonb_typeof(p_details) <> 'object'
     or octet_length(p_details::text) > 16384 then
    raise exception 'analytics health details are invalid'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users as operator
    join public.companies as company
      on company.id = operator.company_id
    where operator.id = p_user_id
      and operator.company_id = p_company_id
      and operator.deleted_at is null
      and operator.is_active is true
      and company.deleted_at is null
      and (
        operator.is_company_admin is true
        or company.account_holder_id = operator.id::text
        or operator.id::text = any(coalesce(company.admin_ids, '{}'::text[]))
      )
  ) then
    raise exception 'analytics alert recipient is unavailable'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('analytics-health|' || v_source, 0)
  );

  select * into v_previous
  from public.analytics_health_states as previous
  where previous.source = v_source
  for update;
  v_had_previous := found;

  if p_state = 'expected_latency' then
    insert into public.analytics_health_states (
      source,
      state,
      last_observed_state,
      details,
      checked_at,
      state_changed_at,
      open_notification_id
    ) values (
      v_source,
      null,
      p_state,
      p_details,
      clock_timestamp(),
      null,
      null
    )
    on conflict (source) do update
      set last_observed_state = excluded.last_observed_state,
          details = excluded.details,
          checked_at = excluded.checked_at;

    return jsonb_build_object(
      'source', v_source,
      'state', p_state,
      'transition', 'expected_latency',
      'notification_created', false
    );
  end if;

  v_dedupe_key := 'analytics-health:' || v_source;
  v_label := case v_source
    when 'ga_marketing' then 'Marketing analytics'
    when 'ga_web_app' then 'Web app analytics'
    when 'ga_ios_app' then 'iOS analytics'
    when 'search_console' then 'Search Console'
    when 'app_store' then 'App Store analytics'
    when 'web_product' then 'Web product telemetry'
    when 'attribution' then 'Attribution coverage'
    when 'business_truth' then 'Growth reconciliation'
    when 'privacy' then 'Analytics privacy'
  end;

  if v_had_previous
     and v_previous.state = 'healthy'
     and p_state = 'failed' then
    insert into public.notifications as notification (
      user_id,
      company_id,
      type,
      title,
      body,
      is_read,
      persistent,
      action_url,
      action_label,
      deep_link_type,
      dedupe_key
    ) values (
      p_user_id::text,
      p_company_id::text,
      'analytics_source_failed',
      'ANALYTICS FEED FAILED',
      v_label || ' failed its health check.',
      false,
      true,
      '/admin/acquisition',
      'CHECK SOURCE',
      'admin_growth_analytics',
      v_dedupe_key
    )
    on conflict do nothing
    returning notification.id into v_notification_id;

    v_created := v_notification_id is not null;
    if v_notification_id is null then
      select notification.id into v_notification_id
      from public.notifications as notification
      where notification.user_id = p_user_id::text
        and notification.company_id = p_company_id::text
        and notification.type = 'analytics_source_failed'
        and notification.dedupe_key = v_dedupe_key
        and notification.resolved_at is null
      order by notification.created_at desc, notification.id desc
      limit 1;
    end if;
    if v_notification_id is null then
      raise exception 'analytics health notification could not be reconciled'
        using errcode = '55000';
    end if;
    v_transition := 'healthy_to_failed';
  elsif v_had_previous
        and v_previous.state = 'failed'
        and p_state = 'healthy' then
    update public.notifications as notification
       set is_read = true,
           resolved_at = clock_timestamp(),
           resolved_by = null,
           resolution_reason = 'analytics_source_recovered'
     where notification.id = v_previous.open_notification_id
       and notification.user_id = p_user_id::text
       and notification.company_id = p_company_id::text
       and notification.type = 'analytics_source_failed'
       and notification.dedupe_key = v_dedupe_key
       and notification.resolved_at is null;
    v_transition := 'failed_to_healthy';
    v_notification_id := null;
  elsif v_had_previous and v_previous.state is distinct from p_state then
    v_transition := coalesce(v_previous.state, 'unsettled') || '_to_' || p_state;
    v_notification_id := v_previous.open_notification_id;
  else
    v_notification_id := v_previous.open_notification_id;
  end if;

  insert into public.analytics_health_states (
    source,
    state,
    last_observed_state,
    details,
    checked_at,
    state_changed_at,
    open_notification_id
  ) values (
    v_source,
    p_state,
    p_state,
    p_details,
    clock_timestamp(),
    clock_timestamp(),
    v_notification_id
  )
  on conflict (source) do update
    set state = excluded.state,
        last_observed_state = excluded.last_observed_state,
        details = excluded.details,
        checked_at = excluded.checked_at,
        state_changed_at = case
          when public.analytics_health_states.state is distinct from excluded.state
            then excluded.state_changed_at
          else public.analytics_health_states.state_changed_at
        end,
        open_notification_id = excluded.open_notification_id;

  return jsonb_build_object(
    'source', v_source,
    'state', p_state,
    'transition', v_transition,
    'notification_created', v_created,
    'notification_id', v_notification_id
  );
end
$function$;

revoke all on function public.apply_analytics_health_source(
  text,
  text,
  jsonb,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.apply_analytics_health_source(
  text,
  text,
  jsonb,
  uuid,
  uuid
) to service_role;

-- Replace the earlier scrub-only routine: the classified attribution already
-- lives on trial_attributions, so the raw touchpoint itself can disappear at
-- the end of the approved 30-day window.
create or replace function public.expire_attribution_click_ids(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_trial_rows bigint;
  v_touchpoint_rows bigint;
begin
  update public.trial_attributions
     set gclid = null,
         fbclid = null,
         updated_at = clock_timestamp()
   where first_touch_at < p_now - interval '30 days'
     and (gclid is not null or fbclid is not null);
  get diagnostics v_trial_rows = row_count;

  delete from public.touchpoints as touchpoint
   where touchpoint.expires_at is not null
     and touchpoint.expires_at <= p_now;
  get diagnostics v_touchpoint_rows = row_count;

  return jsonb_build_object(
    'trial_rows_scrubbed', v_trial_rows,
    'touchpoint_rows_deleted', v_touchpoint_rows
  );
end
$function$;

revoke all on function public.expire_attribution_click_ids(timestamptz)
  from public, anon, authenticated;
grant execute on function public.expire_attribution_click_ids(timestamptz)
  to service_role;

create or replace function public.enforce_analytics_retention(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_cutoff timestamptz := date_trunc(
    'day',
    p_now - interval '12 months'
  );
  v_aggregate_groups bigint;
  v_event_rows bigint;
  v_attribution jsonb;
begin
  insert into public.analytics_events_daily as daily (
    event_date,
    platform,
    environment,
    event_type,
    event_name,
    app_version,
    event_count,
    session_count,
    duration_ms_total,
    first_event_at,
    last_event_at,
    aggregated_at
  )
  select
    event.created_at::date,
    event.platform,
    event.environment,
    event.event_type,
    event.event_name,
    coalesce(event.app_version, ''),
    count(*)::bigint,
    count(distinct event.session_id)::bigint,
    coalesce(sum(event.duration_ms), 0)::bigint,
    min(event.created_at),
    max(event.created_at),
    p_now
  from public.analytics_events as event
  where event.created_at < v_cutoff
  group by
    event.created_at::date,
    event.platform,
    event.environment,
    event.event_type,
    event.event_name,
    coalesce(event.app_version, '')
  on conflict (
    event_date,
    platform,
    environment,
    event_type,
    event_name,
    app_version
  ) do update
    set event_count = daily.event_count + excluded.event_count,
        session_count = daily.session_count + excluded.session_count,
        duration_ms_total =
          daily.duration_ms_total + excluded.duration_ms_total,
        first_event_at = least(daily.first_event_at, excluded.first_event_at),
        last_event_at = greatest(daily.last_event_at, excluded.last_event_at),
        aggregated_at = excluded.aggregated_at;
  get diagnostics v_aggregate_groups = row_count;

  delete from public.analytics_events as event
   where event.created_at < v_cutoff;
  get diagnostics v_event_rows = row_count;

  v_attribution := public.expire_attribution_click_ids(p_now);

  return jsonb_build_object(
    'cutoff', v_cutoff,
    'aggregate_groups_written', v_aggregate_groups,
    'event_rows_deleted', v_event_rows,
    'attribution', v_attribution
  );
end
$function$;

revoke all on function public.enforce_analytics_retention(timestamptz)
  from public, anon, authenticated;
grant execute on function public.enforce_analytics_retention(timestamptz)
  to service_role;

do $schedule$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule(
      'analytics-retention',
      '47 4 * * *',
      'select public.enforce_analytics_retention();'
    );
  end if;
end
$schedule$;

comment on table public.analytics_health_states is
  'Settled source health and open notification identity. Expected source latency updates observation metadata without erasing the last settled state.';
comment on table public.analytics_events_daily is
  'Non-identifying daily product-event aggregates retained after the 12-month raw-event boundary.';
comment on function public.get_growth_analytics_health_snapshot() is
  'Service-only bounded analytics health facts. Source failures remain explicit and are never converted to zero traffic.';
comment on function public.apply_analytics_health_source(text, text, jsonb, uuid, uuid) is
  'Atomically records source health, creates one persistent notification on healthy-to-failed, and resolves it on recovery.';
comment on function public.enforce_analytics_retention(timestamptz) is
  'Aggregates and deletes raw analytics events older than 12 months, then removes expired raw first-touch evidence.';

commit;
