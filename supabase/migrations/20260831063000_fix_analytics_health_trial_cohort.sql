begin;

-- Health reconciliation compares the canonical active-trial cohort on both
-- sides. Historical attribution rows remain retained, but deleted companies
-- and companies without a trial start cannot create false production drift.
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

comment on function public.get_growth_analytics_health_snapshot() is
  'Service-only bounded analytics health facts. Reconciliation is scoped to active companies with a canonical trial start.';

commit;
