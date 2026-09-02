begin;

-- Both public commands call require_external_analytics_credential before any
-- read. That fixed guard rechecks principal.authorization_epoch, the
-- analytics.leads.read baseline scope, and analytics.financial.read whenever
-- a selected metric needs financial data.

do $prerequisites$
begin
  if to_regclass('private.external_lead_projection_state') is null
    or to_regclass('private.external_lead_projection_versions') is null
    or to_regclass('private.external_lead_handles') is null
    or to_regclass('private.external_intake_submissions') is null
    or to_regclass('private.external_api_request_audit') is null
    or to_regprocedure(
      'private.require_external_analytics_credential(uuid,uuid,uuid,smallint,bytea,text,bigint,boolean)'
    ) is null
    or to_regprocedure(
      'private.insert_external_api_authenticated_audit_base(uuid,uuid,uuid,text,text,timestamp with time zone)'
    ) is null
  then
    raise exception 'external_lead_metrics_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create index if not exists external_intake_submissions_company_created_idx
  on private.external_intake_submissions (company_id, created_at);

create index if not exists invoices_company_issue_metrics_idx
  on public.invoices (company_id, issue_date, id)
  where deleted_at is null and status not in ('draft', 'void');

create index if not exists payments_company_date_metrics_idx
  on public.payments (company_id, payment_date, invoice_id)
  where voided_at is null;

create or replace function private.resolve_external_metric_range(
  p_timezone text,
  p_now timestamptz,
  p_preset text,
  p_from text,
  p_to text,
  p_require_date_alignment boolean
) returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_today date;
  v_from timestamptz;
  v_to timestamptz;
  v_from_local date;
  v_to_local date;
  v_days integer;
begin
  if p_timezone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names timezone
      where timezone.name = p_timezone
    )
    or p_now is null
    or p_preset not in ('7d', '30d', '90d', 'lifetime', 'custom')
  then
    raise exception 'external_metric_range_invalid'
      using errcode = '22023';
  end if;

  v_today := (p_now at time zone p_timezone)::date;
  if p_preset in ('7d', '30d', '90d') then
    v_days := case p_preset
      when '7d' then 7
      when '30d' then 30
      else 90
    end;
    v_from_local := v_today - (v_days - 1);
    v_to_local := v_today + 1;
    v_from := v_from_local::timestamp at time zone p_timezone;
    v_to := v_to_local::timestamp at time zone p_timezone;
  elsif p_preset = 'lifetime' then
    v_from_local := date '2000-01-01';
    v_to_local := v_today + 1;
    v_from := v_from_local::timestamp at time zone p_timezone;
    v_to := v_to_local::timestamp at time zone p_timezone;
  else
    if p_from is null or p_to is null then
      raise exception 'external_metric_range_invalid'
        using errcode = '22023';
    end if;
    if p_require_date_alignment
      and (
        p_from !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or p_to !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      )
    then
      raise exception 'external_metric_date_alignment_required'
        using errcode = '22023';
    end if;

    begin
      if p_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        v_from_local := p_from::date;
        v_from := v_from_local::timestamp at time zone p_timezone;
      else
        v_from := p_from::timestamptz;
        v_from_local := (v_from at time zone p_timezone)::date;
      end if;
      if p_to ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        v_to_local := p_to::date;
        v_to := v_to_local::timestamp at time zone p_timezone;
      else
        v_to := p_to::timestamptz;
        v_to_local := (v_to at time zone p_timezone)::date;
      end if;
    exception
      when others then
        raise exception 'external_metric_range_invalid'
          using errcode = '22023';
    end;

    if v_to <= v_from then
      raise exception 'external_metric_range_invalid'
        using errcode = '22023';
    end if;
    if (
      p_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and p_to ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and v_to_local - v_from_local > 366
    ) or (
      (
        p_from !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or p_to !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      )
      and v_to - v_from > interval '366 days'
    ) then
      raise exception 'external_metric_range_too_large'
        using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'from_local_date', v_from_local,
    'to_local_date', v_to_local
  );
end;
$function$;

create or replace function private.resolve_external_financial_opportunity(
  p_direct_opportunity_id uuid,
  p_project_opportunity_id uuid
) returns uuid
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select coalesce(p_direct_opportunity_id, p_project_opportunity_id);
$function$;

create or replace function private.external_metric_basis(
  p_metric_id text
) returns text
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when p_metric_id in (
      'leads_received',
      'stage_reached_funnel_count',
      'stage_reached_funnel_rate',
      'first_response_coverage',
      'median_first_response_minutes',
      'median_time_to_decision',
      'median_time_to_win',
      'median_time_to_project_conversion',
      'source_attribution_completeness',
      'lifecycle_evidence_completeness'
    ) then 'received_cohort'
    when p_metric_id in (
      'intake_submissions_accepted',
      'intake_submissions_rejected',
      'intake_submissions_replayed',
      'external_intake_customers_created',
      'external_intake_customers_matched',
      'invoiced_event_total',
      'paid_event_total'
    ) then 'event_dated'
    else 'current_snapshot'
  end;
$function$;

create or replace function private.external_metric_unit(
  p_metric_id text
) returns text
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when p_metric_id in (
      'cohort_discard_rate',
      'cohort_disqualified_rate',
      'project_converted_rate',
      'stage_reached_funnel_rate',
      'cohort_decided_win_rate',
      'first_response_coverage',
      'source_attribution_completeness',
      'lifecycle_evidence_completeness'
    ) then 'percent'
    when p_metric_id in (
      'median_first_response_minutes',
      'median_time_to_decision',
      'median_time_to_win',
      'median_time_to_project_conversion'
    ) then 'minutes'
    when p_metric_id in (
      'cohort_open_estimated_value',
      'cohort_won_value',
      'cohort_average_won_value',
      'invoiced_event_total',
      'paid_event_total'
    ) then 'currency'
    else 'count'
  end;
$function$;

create or replace function private.external_metric_population(
  p_metric_id text
) returns text
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case p_metric_id
    when 'leads_received' then
      'Canonical non-merged leads received in the half-open interval'
    when 'cohort_active_lead_count' then
      'Received cohort still active and neither archived nor terminal'
    when 'cohort_discarded_lead_count' then
      'Received cohort with the discarded disposition'
    when 'cohort_discard_rate' then
      'Discarded received-cohort leads divided by leads received'
    when 'cohort_current_stage_distribution' then
      'Authoritative current stage of the received cohort'
    when 'cohort_outcome_distribution' then
      'Mutually exclusive authoritative outcome of the received cohort'
    when 'cohort_disqualified_count' then
      'Received cohort with the distinct disqualified disposition'
    when 'cohort_disqualified_rate' then
      'Disqualified received-cohort leads divided by leads received'
    when 'project_converted_count' then
      'Received cohort with canonical project-conversion evidence'
    when 'project_converted_rate' then
      'Project-converted received-cohort leads divided by leads received'
    when 'stage_reached_funnel_count' then
      'Received-cohort leads with atomic evidence for each reached stage'
    when 'stage_reached_funnel_rate' then
      'Evidenced stage reaches divided by leads with known stage evidence'
    when 'cohort_decided_lead_count' then
      'Received-cohort leads won or lost'
    when 'cohort_won_count' then
      'Received-cohort leads with canonical won evidence'
    when 'cohort_lost_count' then
      'Received-cohort leads with canonical lost evidence'
    when 'cohort_decided_win_rate' then
      'Won leads divided by won plus lost leads'
    when 'first_response_coverage' then
      'Eligible received-cohort leads with a qualifying first response'
    when 'median_first_response_minutes' then
      'Median inquiry-to-qualifying-first-response time'
    when 'median_time_to_decision' then
      'Median inquiry-to-first-won-or-lost time'
    when 'median_time_to_win' then
      'Median inquiry-to-won time'
    when 'median_time_to_project_conversion' then
      'Median inquiry-to-canonical-project-conversion time'
    when 'intake_submissions_accepted' then
      'External intake submissions accepted in the interval'
    when 'intake_submissions_rejected' then
      'External intake submission requests rejected in the interval'
    when 'intake_submissions_replayed' then
      'Exact external intake submission replays in the interval'
    when 'external_intake_customers_created' then
      'Accepted external intake submissions that created a customer'
    when 'external_intake_customers_matched' then
      'Accepted external intake submissions matched to a customer'
    when 'source_attribution_completeness' then
      'Received-cohort leads with authenticated or canonical source evidence'
    when 'lifecycle_evidence_completeness' then
      'Received-cohort leads with canonical inquiry and lifecycle evidence'
    when 'cohort_open_estimated_value' then
      'Current estimated value for active received-cohort leads'
    when 'cohort_won_value' then
      'Actual value for won received-cohort leads with known actual value'
    when 'cohort_average_won_value' then
      'Average actual value among won cohort leads with known actual value'
    when 'invoiced_event_total' then
      'Non-draft, non-void, non-deleted invoice total dated in the interval'
    when 'paid_event_total' then
      'Non-void payment total on eligible invoices dated in the interval'
    else null
  end;
$function$;

create or replace function private.external_metric_grouping(
  p_groupings text[],
  p_time_bucket timestamptz,
  p_dimension_id text,
  p_dimension_label text,
  p_series_label text
) returns jsonb
language plpgsql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_dimension text;
begin
  select grouping
  into v_dimension
  from unnest(coalesce(p_groupings, '{}'::text[])) grouping
  where grouping in ('source', 'campaign', 'form')
  limit 1;

  if cardinality(coalesce(p_groupings, '{}'::text[])) = 0
    and p_series_label is null
  then
    return null;
  end if;

  return jsonb_build_object(
    'timeBucket', p_time_bucket,
    'sourceId', case when v_dimension = 'source' then p_dimension_id end,
    'campaignHandle',
      case when v_dimension = 'campaign' then p_dimension_id end,
    'formId', case when v_dimension = 'form' then p_dimension_id end,
    'label', coalesce(p_series_label, p_dimension_label)
  );
end;
$function$;

create or replace function private.external_metric_cell(
  p_metric_id text,
  p_value numeric,
  p_numerator numeric,
  p_denominator numeric,
  p_included_count bigint,
  p_missing_evidence_count bigint,
  p_grouping jsonb,
  p_currency text,
  p_cohort_count bigint
) returns jsonb
language plpgsql
immutable
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_unit text := private.external_metric_unit(p_metric_id);
  v_suppress_below_cohort integer := case
    when v_unit in ('percent', 'minutes', 'currency') then 5
    else null
  end;
  v_suppressed boolean :=
    v_suppress_below_cohort is not null
    and p_cohort_count < v_suppress_below_cohort;
  v_evidence_total bigint :=
    greatest(0, p_included_count) + greatest(0, p_missing_evidence_count);
begin
  return jsonb_build_object(
    'metricId', p_metric_id,
    'definitionVersion', '1',
    'basis', private.external_metric_basis(p_metric_id),
    'population', private.external_metric_population(p_metric_id),
    'value', case
      when v_suppressed or p_value is null then null
      when v_unit = 'count' then trunc(p_value)
      else round(p_value, 2)
    end,
    'unit', v_unit,
    'numerator', case
      when p_numerator is null then null
      else round(p_numerator, 2)
    end,
    'denominator', case
      when p_denominator is null then null
      else round(p_denominator, 2)
    end,
    'includedCount', greatest(0, p_included_count),
    'missingEvidenceCount', greatest(0, p_missing_evidence_count),
    'grouping', p_grouping,
    'currency', case when v_unit = 'currency' then p_currency else null end,
    'suppressed', v_suppressed,
    'cohortCount', greatest(0, p_cohort_count),
    'evidenceCoveragePercent', case
      when v_evidence_total = 0 then 0
      else round(100.0 * p_included_count / v_evidence_total, 2)
    end
  );
end;
$function$;

create or replace function private.external_metric_lead_rows(
  p_company_id uuid,
  p_high_water_sequence bigint,
  p_from timestamptz,
  p_to timestamptz,
  p_timezone text,
  p_time_group text,
  p_dimension_group text,
  p_source_id text,
  p_campaign_handle text,
  p_form_id text
) returns table (
  opportunity_id uuid,
  group_time_bucket timestamptz,
  dimension_id text,
  dimension_label text,
  current_stage text,
  outcome text,
  active boolean,
  discarded boolean,
  disqualified boolean,
  project_converted boolean,
  won boolean,
  lost boolean,
  first_response_minutes numeric,
  decision_minutes numeric,
  win_minutes numeric,
  conversion_minutes numeric,
  stage_evidence_known boolean,
  reached_qualifying boolean,
  reached_quoting boolean,
  reached_quoted boolean,
  reached_follow_up boolean,
  reached_negotiation boolean,
  source_evidence_known boolean,
  lifecycle_evidence_known boolean,
  estimated_value numeric,
  won_value numeric
)
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  with latest as (
    select distinct on (version.handle_id)
      version.handle_id,
      version.operation,
      version.public_projection
    from private.external_lead_projection_versions version
    where version.company_id = p_company_id
      and version.change_sequence <= p_high_water_sequence
    order by version.handle_id, version.change_sequence desc
  ),
  latest_detail as (
    select distinct on (version.handle_id)
      version.handle_id,
      version.public_projection
    from private.external_lead_projection_versions version
    where version.company_id = p_company_id
      and version.change_sequence <= p_high_water_sequence
      and version.operation <> 'deletion'
    order by version.handle_id, version.change_sequence desc
  ),
  normalized as (
    select
      handle.opportunity_id,
      latest.operation,
      detail.public_projection as projection,
      opportunity.actual_value,
      (detail.public_projection ->> 'inquiryReceivedAt')::timestamptz
        as inquiry_received_at,
      detail.public_projection ->> 'currentStage' as current_stage,
      detail.public_projection ->> 'disposition' as disposition,
      detail.public_projection ->> 'recordState' as record_state,
      detail.public_projection -> 'reached' as reached,
      detail.public_projection -> 'source' as source,
      (detail.public_projection ->> 'firstResponseMinutes')::numeric
        as first_response_minutes,
      (detail.public_projection ->> 'minutesToDecision')::numeric
        as decision_minutes,
      (detail.public_projection ->> 'minutesToWin')::numeric
        as win_minutes,
      (detail.public_projection ->> 'minutesToProjectConversion')::numeric
        as conversion_minutes,
      (detail.public_projection #>> '{financial,estimatedLeadValue}')::numeric
        as estimated_value,
      case
        when detail.public_projection ->> 'wonAt' is not null
        then opportunity.actual_value
      end as won_value
    from latest
    join latest_detail detail on detail.handle_id = latest.handle_id
    join private.external_lead_handles handle
      on handle.id = latest.handle_id
     and handle.company_id = p_company_id
    join public.opportunities opportunity
      on opportunity.id = handle.opportunity_id
     and opportunity.company_id = p_company_id
    where latest.operation <> 'merge'
  ),
  classified as (
    select
      normalized.*,
      case
        when normalized.operation = 'deletion' then 'deleted'
        when normalized.projection ->> 'wonAt' is not null then 'won'
        when normalized.projection ->> 'lostAt' is not null then 'lost'
        when normalized.projection ->> 'disqualifiedAt' is not null
          then 'disqualified'
        when normalized.projection ->> 'discardedAt' is not null
          then 'discarded'
        when normalized.projection ->> 'projectConvertedAt' is not null
          then 'converted_without_decision'
        when normalized.record_state = 'archived' then 'archived_unresolved'
        else 'active'
      end as outcome
    from normalized
    where normalized.inquiry_received_at >= p_from
      and normalized.inquiry_received_at < p_to
      and (
        p_source_id is null
        or normalized.source ->> 'sourceId' = p_source_id
      )
      and (
        p_campaign_handle is null
        or normalized.source #>> '{campaign,handle}' = p_campaign_handle
      )
      and (
        p_form_id is null
        or normalized.source ->> 'formId' = p_form_id
      )
  )
  select
    classified.opportunity_id,
    case p_time_group
      when 'day' then
        date_trunc(
          'day',
          classified.inquiry_received_at at time zone p_timezone
        ) at time zone p_timezone
      when 'week' then
        date_trunc(
          'week',
          classified.inquiry_received_at at time zone p_timezone
        ) at time zone p_timezone
      when 'month' then
        date_trunc(
          'month',
          classified.inquiry_received_at at time zone p_timezone
        ) at time zone p_timezone
      else null
    end,
    case p_dimension_group
      when 'source' then classified.source ->> 'sourceId'
      when 'campaign' then classified.source #>> '{campaign,handle}'
      when 'form' then classified.source ->> 'formId'
      else null
    end,
    case p_dimension_group
      when 'source' then classified.source ->> 'sourceLabel'
      when 'campaign' then classified.source #>> '{campaign,label}'
      when 'form' then classified.source ->> 'formLabel'
      else null
    end,
    classified.current_stage,
    classified.outcome,
    classified.outcome = 'active',
    classified.outcome = 'discarded',
    classified.outcome = 'disqualified',
    classified.projection ->> 'projectConvertedAt' is not null,
    classified.projection ->> 'wonAt' is not null,
    classified.projection ->> 'lostAt' is not null,
    classified.first_response_minutes,
    classified.decision_minutes,
    classified.win_minutes,
    classified.conversion_minutes,
    jsonb_typeof(classified.reached) = 'object',
    coalesce((classified.reached ->> 'qualifying')::boolean, false),
    coalesce((classified.reached ->> 'quoting')::boolean, false),
    coalesce((classified.reached ->> 'quoted')::boolean, false),
    coalesce((classified.reached ->> 'followUp')::boolean, false),
    coalesce((classified.reached ->> 'negotiation')::boolean, false),
    coalesce(
      (classified.source #>> '{completeness,channelKnown}')::boolean,
      false
    ) or classified.source ->> 'sourceIntegrationType' = 'external_intake',
    classified.inquiry_received_at is not null
      and jsonb_typeof(classified.reached) = 'object',
    classified.estimated_value,
    classified.won_value
  from classified;
$function$;

create or replace function private.external_metric_event_rows(
  p_company_id uuid,
  p_high_water_sequence bigint,
  p_from timestamptz,
  p_to timestamptz,
  p_from_local_date date,
  p_to_local_date date,
  p_data_through timestamptz,
  p_timezone text,
  p_time_group text,
  p_dimension_group text,
  p_source_id text,
  p_campaign_handle text,
  p_form_id text
) returns table (
  event_kind text,
  event_value numeric,
  evidence_known boolean,
  group_time_bucket timestamptz,
  dimension_id text,
  dimension_label text
)
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  with latest as (
    select distinct on (version.handle_id)
      version.handle_id,
      version.operation,
      version.public_projection
    from private.external_lead_projection_versions version
    where version.company_id = p_company_id
      and version.change_sequence <= p_high_water_sequence
      and version.operation <> 'deletion'
    order by version.handle_id, version.change_sequence desc
  ),
  lead_source as (
    select
      handle.opportunity_id,
      latest.public_projection -> 'source' as source
    from latest
    join private.external_lead_handles handle
      on handle.id = latest.handle_id
     and handle.company_id = p_company_id
    where latest.operation <> 'merge'
  ),
  intake_events as (
    select
      event.event_kind,
      1::numeric as event_value,
      true as evidence_known,
      submission.created_at as event_at,
      source.source
    from private.external_intake_submissions submission
    join lead_source source
      on source.opportunity_id = submission.opportunity_id
    cross join lateral (
      values
        ('intake_submissions_accepted'),
        (
          case
            when submission.customer_outcome in (
              'created',
              'created_possible_duplicate'
            )
            then 'external_intake_customers_created'
          end
        ),
        (
          case
            when submission.customer_outcome = 'matched'
            then 'external_intake_customers_matched'
          end
        )
    ) event(event_kind)
    where submission.company_id = p_company_id
      and submission.created_at >= p_from
      and submission.created_at < p_to
      and submission.created_at <= p_data_through
      and event.event_kind is not null
  ),
  request_events as (
    select
      case
        when audit.idempotency_result = 'replay'
          then 'intake_submissions_replayed'
        else 'intake_submissions_rejected'
      end as event_kind,
      1::numeric as event_value,
      true as evidence_known,
      audit.request_received_at as event_at,
      null::jsonb as source
    from private.external_api_request_audit audit
    where audit.company_id = p_company_id
      and audit.route = '/v1/intake/submissions'
      and audit.request_received_at >= p_from
      and audit.request_received_at < p_to
      and audit.finalized_at is not null
      and audit.finalized_at <= p_data_through
      and (
        audit.idempotency_result = 'replay'
        or audit.outcome in ('rejected', 'conflict')
      )
  ),
  invoice_events as (
    select
      'invoiced_event_total'::text as event_kind,
      invoice.total as event_value,
      attributed.opportunity_id is not null as evidence_known,
      invoice.issue_date::timestamp at time zone p_timezone as event_at,
      source.source
    from public.invoices invoice
    left join public.opportunities direct_opportunity
      on direct_opportunity.id = invoice.opportunity_id
     and direct_opportunity.company_id = invoice.company_id
    left join public.projects project
      on project.id = coalesce(invoice.project_ref, invoice.project_id)
     and project.company_id = invoice.company_id
     and project.deleted_at is null
    cross join lateral (
      select private.resolve_external_financial_opportunity(
        direct_opportunity.id,
        project.opportunity_ref
      ) as opportunity_id
    ) attributed
    left join lead_source source
      on source.opportunity_id = attributed.opportunity_id
    where invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and invoice.status not in ('draft', 'void')
      and invoice.issue_date >= p_from_local_date
      and invoice.issue_date < p_to_local_date
      and invoice.created_at <= p_data_through
  ),
  payment_events as (
    select
      'paid_event_total'::text as event_kind,
      payment.amount as event_value,
      attributed.opportunity_id is not null as evidence_known,
      payment.payment_date::timestamp at time zone p_timezone as event_at,
      source.source
    from public.payments payment
    join public.invoices invoice
      on invoice.id = payment.invoice_id
     and invoice.company_id = payment.company_id
    left join public.opportunities direct_opportunity
      on direct_opportunity.id = invoice.opportunity_id
     and direct_opportunity.company_id = invoice.company_id
    left join public.projects project
      on project.id = coalesce(invoice.project_ref, invoice.project_id)
     and project.company_id = invoice.company_id
     and project.deleted_at is null
    cross join lateral (
      select private.resolve_external_financial_opportunity(
        direct_opportunity.id,
        project.opportunity_ref
      ) as opportunity_id
    ) attributed
    left join lead_source source
      on source.opportunity_id = attributed.opportunity_id
    where payment.company_id = p_company_id
      and payment.voided_at is null
      and invoice.deleted_at is null
      and invoice.status <> 'void'
      and payment.payment_date >= p_from_local_date
      and payment.payment_date < p_to_local_date
      and payment.created_at <= p_data_through
  ),
  all_events as (
    select * from intake_events
    union all
    select * from request_events
    union all
    select * from invoice_events
    union all
    select * from payment_events
  ),
  filtered as (
    select *
    from all_events event
    where (
        p_source_id is null
        or event.source ->> 'sourceId' = p_source_id
      )
      and (
        p_campaign_handle is null
        or event.source #>> '{campaign,handle}' = p_campaign_handle
      )
      and (
        p_form_id is null
        or event.source ->> 'formId' = p_form_id
      )
  )
  select
    filtered.event_kind,
    filtered.event_value,
    filtered.evidence_known,
    case p_time_group
      when 'day' then
        date_trunc('day', filtered.event_at at time zone p_timezone)
          at time zone p_timezone
      when 'week' then
        date_trunc('week', filtered.event_at at time zone p_timezone)
          at time zone p_timezone
      when 'month' then
        date_trunc('month', filtered.event_at at time zone p_timezone)
          at time zone p_timezone
      else null
    end,
    case p_dimension_group
      when 'source' then filtered.source ->> 'sourceId'
      when 'campaign' then filtered.source #>> '{campaign,handle}'
      when 'form' then filtered.source ->> 'formId'
      else null
    end,
    case p_dimension_group
      when 'source' then filtered.source ->> 'sourceLabel'
      when 'campaign' then filtered.source #>> '{campaign,label}'
      when 'form' then filtered.source ->> 'formLabel'
      else null
    end
  from filtered;
$function$;

create or replace function public.authorize_external_lead_metrics_as_system(
  p_request_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_require_financial boolean,
  p_require_date_alignment boolean,
  p_definition_version text,
  p_preset text,
  p_from text,
  p_to text,
  p_source_id text,
  p_campaign_handle text,
  p_form_id text,
  p_request_received_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_timezone text;
  v_currency text;
  v_company_created_at timestamptz;
  v_range jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_from_local date;
  v_to_local date;
  v_high_water bigint := 0;
  v_data_through timestamptz;
begin
  perform private.insert_external_api_authenticated_audit_base(
    p_request_id,
    p_principal_id,
    p_credential_id,
    '/v1/analytics/metrics',
    'GET',
    p_request_received_at
  );
  perform private.require_external_analytics_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch,
    p_require_financial
  );

  if p_definition_version <> '1' then
    raise exception 'external_metric_definition_version_unsupported'
      using errcode = '22023';
  end if;
  if p_source_id is not null
    and p_source_id !~ '^src_[A-Za-z0-9_-]{22,128}$'
  then
    raise exception 'external_metric_filter_invalid'
      using errcode = '22023';
  end if;
  if p_campaign_handle is not null
    and p_campaign_handle !~ '^cmp_[A-Za-z0-9_-]{22,128}$'
  then
    raise exception 'external_metric_filter_invalid'
      using errcode = '22023';
  end if;
  if p_form_id is not null
    and p_form_id !~ '^frm_[A-Za-z0-9_-]{22,128}$'
  then
    raise exception 'external_metric_filter_invalid'
      using errcode = '22023';
  end if;

  select
    timezone.name,
    upper(company.currency_code),
    coalesce(company.created_at, p_request_received_at)
  into strict v_timezone, v_currency, v_company_created_at
  from public.companies company
  join pg_catalog.pg_timezone_names timezone
    on timezone.name = company.timezone
  where company.id = p_company_id
    and company.deleted_at is null;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'external_metric_currency_invalid'
      using errcode = '22023';
  end if;

  v_range := private.resolve_external_metric_range(
    v_timezone,
    p_request_received_at,
    p_preset,
    p_from,
    p_to,
    p_require_date_alignment
  );
  v_from := (v_range ->> 'from')::timestamptz;
  v_to := (v_range ->> 'to')::timestamptz;
  v_from_local := (v_range ->> 'from_local_date')::date;
  v_to_local := (v_range ->> 'to_local_date')::date;

  if p_preset = 'lifetime' then
    v_from_local :=
      (v_company_created_at at time zone v_timezone)::date;
    v_from := v_from_local::timestamp at time zone v_timezone;
  end if;

  select state.high_water_sequence
  into v_high_water
  from private.external_lead_projection_state state
  where state.company_id = p_company_id
  for share;
  v_high_water := coalesce(v_high_water, 0);

  select greatest(
    coalesce((
      select max(version.projected_at)
      from private.external_lead_projection_versions version
      where version.company_id = p_company_id
        and version.change_sequence <= v_high_water
    ), v_company_created_at),
    coalesce((
      select max(submission.created_at)
      from private.external_intake_submissions submission
      where submission.company_id = p_company_id
        and submission.created_at <= p_request_received_at
    ), v_company_created_at),
    coalesce((
      select max(audit.finalized_at)
      from private.external_api_request_audit audit
      where audit.company_id = p_company_id
        and audit.finalized_at <= p_request_received_at
    ), v_company_created_at)
  )
  into v_data_through;

  return jsonb_build_object(
    'high_water_sequence', v_high_water::text,
    'data_through', v_data_through,
    'from', v_from,
    'to', v_to,
    'from_local_date', v_from_local,
    'to_local_date', v_to_local,
    'timezone', v_timezone,
    'currency', v_currency
  );
end;
$function$;

create or replace function public.read_external_lead_metrics_v1_as_system(
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_include_financial boolean,
  p_high_water_sequence bigint,
  p_from timestamptz,
  p_to timestamptz,
  p_from_local_date date,
  p_to_local_date date,
  p_timezone text,
  p_currency text,
  p_metric_ids text[],
  p_groupings text[],
  p_source_id text,
  p_campaign_handle text,
  p_form_id text,
  p_data_through timestamptz,
  p_generated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_allowed_metrics constant text[] := array[
    'leads_received',
    'cohort_active_lead_count',
    'cohort_discarded_lead_count',
    'cohort_discard_rate',
    'cohort_current_stage_distribution',
    'cohort_outcome_distribution',
    'cohort_disqualified_count',
    'cohort_disqualified_rate',
    'project_converted_count',
    'project_converted_rate',
    'stage_reached_funnel_count',
    'stage_reached_funnel_rate',
    'cohort_decided_lead_count',
    'cohort_won_count',
    'cohort_lost_count',
    'cohort_decided_win_rate',
    'first_response_coverage',
    'median_first_response_minutes',
    'median_time_to_decision',
    'median_time_to_win',
    'median_time_to_project_conversion',
    'intake_submissions_accepted',
    'intake_submissions_rejected',
    'intake_submissions_replayed',
    'external_intake_customers_created',
    'external_intake_customers_matched',
    'source_attribution_completeness',
    'lifecycle_evidence_completeness',
    'cohort_open_estimated_value',
    'cohort_won_value',
    'cohort_average_won_value',
    'invoiced_event_total',
    'paid_event_total'
  ];
  v_financial_metrics constant text[] := array[
    'cohort_open_estimated_value',
    'cohort_won_value',
    'cohort_average_won_value',
    'invoiced_event_total',
    'paid_event_total'
  ];
  v_metric text;
  v_time_group text;
  v_dimension_group text;
  v_group record;
  v_series text;
  v_results jsonb := '[]'::jsonb;
  v_value numeric;
  v_numerator numeric;
  v_denominator numeric;
  v_included bigint;
  v_missing bigint;
  v_cohort bigint;
  v_state_high_water bigint;
  v_grouping jsonb;
begin
  perform private.require_external_analytics_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch,
    p_include_financial
  );

  if p_high_water_sequence < 0
    or p_from is null
    or p_to is null
    or p_to <= p_from
    or p_from_local_date is null
    or p_to_local_date is null
    or p_to_local_date <= p_from_local_date
    or p_timezone is null
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names timezone
      where timezone.name = p_timezone
    )
    or p_currency !~ '^[A-Z]{3}$'
    or cardinality(coalesce(p_metric_ids, '{}'::text[])) not between 1 and 33
    or cardinality(p_metric_ids) <> (
      select count(distinct metric_id)
      from unnest(p_metric_ids) metric_id
    )
    or exists (
      select 1
      from unnest(p_metric_ids) metric_id
      where not metric_id = any(v_allowed_metrics)
    )
    or (
      not p_include_financial
      and p_metric_ids && v_financial_metrics
    )
    or cardinality(coalesce(p_groupings, '{}'::text[])) > 2
    or cardinality(coalesce(p_groupings, '{}'::text[])) <> (
      select count(distinct grouping)
      from unnest(coalesce(p_groupings, '{}'::text[])) grouping
    )
    or exists (
      select 1
      from unnest(coalesce(p_groupings, '{}'::text[])) grouping
      where grouping not in ('day', 'week', 'month', 'source', 'campaign', 'form')
    )
    or (
      select count(*)
      from unnest(coalesce(p_groupings, '{}'::text[])) grouping
      where grouping in ('day', 'week', 'month')
    ) > 1
    or (
      select count(*)
      from unnest(coalesce(p_groupings, '{}'::text[])) grouping
      where grouping in ('source', 'campaign', 'form')
    ) > 1
  then
    raise exception 'external_metric_arguments_invalid'
      using errcode = '22023';
  end if;

  select state.high_water_sequence
  into v_state_high_water
  from private.external_lead_projection_state state
  where state.company_id = p_company_id
  for share;
  if coalesce(v_state_high_water, 0) <> p_high_water_sequence then
    raise exception 'external_metric_snapshot_changed'
      using errcode = '40001';
  end if;

  select grouping
  into v_time_group
  from unnest(coalesce(p_groupings, '{}'::text[])) grouping
  where grouping in ('day', 'week', 'month')
  limit 1;
  select grouping
  into v_dimension_group
  from unnest(coalesce(p_groupings, '{}'::text[])) grouping
  where grouping in ('source', 'campaign', 'form')
  limit 1;

  foreach v_metric in array p_metric_ids
  loop
    if v_metric = 'cohort_current_stage_distribution' then
      for v_group in
        select
          row.group_time_bucket,
          row.dimension_id,
          row.dimension_label,
          row.current_stage as series_label,
          count(*)::bigint as series_count,
          sum(count(*)) over (
            partition by row.group_time_bucket, row.dimension_id
          )::bigint as cohort_count
        from private.external_metric_lead_rows(
          p_company_id, p_high_water_sequence, p_from, p_to, p_timezone,
          v_time_group, v_dimension_group, p_source_id, p_campaign_handle,
          p_form_id
        ) row
        group by
          row.group_time_bucket,
          row.dimension_id,
          row.dimension_label,
          row.current_stage
        order by
          row.group_time_bucket nulls first,
          row.dimension_id nulls first,
          row.current_stage
      loop
        v_grouping := private.external_metric_grouping(
          p_groupings,
          v_group.group_time_bucket,
          v_group.dimension_id,
          v_group.dimension_label,
          coalesce(v_group.series_label, 'unknown')
        );
        v_results := v_results || jsonb_build_array(
          private.external_metric_cell(
            v_metric,
            v_group.series_count,
            v_group.series_count,
            v_group.cohort_count,
            v_group.series_count,
            0,
            v_grouping,
            p_currency,
            v_group.cohort_count
          )
        );
      end loop;
      continue;
    end if;

    if v_metric = 'cohort_outcome_distribution' then
      foreach v_series in array array[
        'deleted',
        'won',
        'lost',
        'disqualified',
        'discarded',
        'converted_without_decision',
        'archived_unresolved',
        'active'
      ]
      loop
        for v_group in
          select
            row.group_time_bucket,
            row.dimension_id,
            max(row.dimension_label) as dimension_label,
            count(row.opportunity_id)::bigint as cohort_count,
            count(row.opportunity_id) filter (
              where row.outcome = v_series
            )::bigint as series_count
          from (select 1) anchor
          left join lateral private.external_metric_lead_rows(
            p_company_id, p_high_water_sequence, p_from, p_to, p_timezone,
            v_time_group, v_dimension_group, p_source_id, p_campaign_handle,
            p_form_id
          ) row on true
          group by row.group_time_bucket, row.dimension_id
          order by row.group_time_bucket nulls first, row.dimension_id nulls first
        loop
          v_grouping := private.external_metric_grouping(
            p_groupings,
            v_group.group_time_bucket,
            v_group.dimension_id,
            v_group.dimension_label,
            v_series
          );
          v_results := v_results || jsonb_build_array(
            private.external_metric_cell(
              v_metric,
              v_group.series_count,
              v_group.series_count,
              v_group.cohort_count,
              v_group.series_count,
              0,
              v_grouping,
              p_currency,
              v_group.cohort_count
            )
          );
        end loop;
      end loop;
      continue;
    end if;

    if v_metric in (
      'stage_reached_funnel_count',
      'stage_reached_funnel_rate'
    ) then
      foreach v_series in array array[
        'qualifying',
        'quoting',
        'quoted',
        'follow_up',
        'negotiation'
      ]
      loop
        for v_group in
          select
            row.group_time_bucket,
            row.dimension_id,
            max(row.dimension_label) as dimension_label,
            count(row.opportunity_id)::bigint as cohort_count,
            count(row.opportunity_id) filter (
              where row.stage_evidence_known
            )::bigint as known_count,
            count(row.opportunity_id) filter (
              where row.stage_evidence_known
                and case v_series
                  when 'qualifying' then row.reached_qualifying
                  when 'quoting' then row.reached_quoting
                  when 'quoted' then row.reached_quoted
                  when 'follow_up' then row.reached_follow_up
                  when 'negotiation' then row.reached_negotiation
                  else false
                end
            )::bigint as reached_count
          from (select 1) anchor
          left join lateral private.external_metric_lead_rows(
            p_company_id, p_high_water_sequence, p_from, p_to, p_timezone,
            v_time_group, v_dimension_group, p_source_id, p_campaign_handle,
            p_form_id
          ) row on true
          group by row.group_time_bucket, row.dimension_id
          order by row.group_time_bucket nulls first, row.dimension_id nulls first
        loop
          v_value := case
            when v_metric = 'stage_reached_funnel_count'
              then v_group.reached_count
            when v_group.known_count = 0 then null
            else 100.0 * v_group.reached_count / v_group.known_count
          end;
          v_grouping := private.external_metric_grouping(
            p_groupings,
            v_group.group_time_bucket,
            v_group.dimension_id,
            v_group.dimension_label,
            v_series
          );
          v_results := v_results || jsonb_build_array(
            private.external_metric_cell(
              v_metric,
              v_value,
              v_group.reached_count,
              v_group.known_count,
              v_group.known_count,
              v_group.cohort_count - v_group.known_count,
              v_grouping,
              p_currency,
              v_group.cohort_count
            )
          );
        end loop;
      end loop;
      continue;
    end if;

    if v_metric in (
      'intake_submissions_accepted',
      'intake_submissions_rejected',
      'intake_submissions_replayed',
      'external_intake_customers_created',
      'external_intake_customers_matched',
      'invoiced_event_total',
      'paid_event_total'
    ) then
      for v_group in
        select
          event.group_time_bucket,
          event.dimension_id,
          max(event.dimension_label) as dimension_label,
          count(event.event_kind)::bigint as cohort_count,
          count(event.event_kind) filter (
            where event.evidence_known
          )::bigint as included_count,
          count(event.event_kind) filter (
            where not event.evidence_known
          )::bigint as missing_count,
          coalesce(sum(event.event_value) filter (
            where event.evidence_known
          ), 0)::numeric as total_value
        from (select 1) anchor
        left join lateral private.external_metric_event_rows(
          p_company_id, p_high_water_sequence, p_from, p_to,
          p_from_local_date, p_to_local_date, p_data_through, p_timezone,
          v_time_group, v_dimension_group, p_source_id, p_campaign_handle,
          p_form_id
        ) event on event.event_kind = v_metric
        group by event.group_time_bucket, event.dimension_id
        order by event.group_time_bucket nulls first, event.dimension_id nulls first
      loop
        v_grouping := private.external_metric_grouping(
          p_groupings,
          v_group.group_time_bucket,
          v_group.dimension_id,
          v_group.dimension_label,
          null
        );
        v_results := v_results || jsonb_build_array(
          private.external_metric_cell(
            v_metric,
            v_group.total_value,
            v_group.total_value,
            null,
            v_group.included_count,
            v_group.missing_count,
            v_grouping,
            p_currency,
            v_group.cohort_count
          )
        );
      end loop;
      continue;
    end if;

    for v_group in
      select
        row.group_time_bucket,
        row.dimension_id,
        max(row.dimension_label) as dimension_label,
        count(row.opportunity_id)::bigint as cohort_count,
        count(row.opportunity_id) filter (where row.active)::bigint
          as active_count,
        count(row.opportunity_id) filter (where row.discarded)::bigint
          as discarded_count,
        count(row.opportunity_id) filter (where row.disqualified)::bigint
          as disqualified_count,
        count(row.opportunity_id) filter (where row.project_converted)::bigint
          as converted_count,
        count(row.opportunity_id) filter (where row.won)::bigint
          as won_count,
        count(row.opportunity_id) filter (where row.lost)::bigint
          as lost_count,
        count(row.first_response_minutes)::bigint as response_count,
        percentile_cont(0.5) within group (
          order by row.first_response_minutes
        ) as response_median,
        count(row.decision_minutes)::bigint as decision_count,
        percentile_cont(0.5) within group (
          order by row.decision_minutes
        ) as decision_median,
        count(row.win_minutes)::bigint as win_time_count,
        percentile_cont(0.5) within group (
          order by row.win_minutes
        ) as win_median,
        count(row.conversion_minutes)::bigint as conversion_time_count,
        percentile_cont(0.5) within group (
          order by row.conversion_minutes
        ) as conversion_median,
        count(row.opportunity_id) filter (
          where row.source_evidence_known
        )::bigint as source_known_count,
        count(row.opportunity_id) filter (
          where row.lifecycle_evidence_known
        )::bigint as lifecycle_known_count,
        count(row.estimated_value) filter (where row.active)::bigint
          as estimated_known_count,
        coalesce(sum(row.estimated_value) filter (where row.active), 0)::numeric
          as estimated_total,
        count(row.won_value) filter (where row.won)::bigint
          as won_value_known_count,
        coalesce(sum(row.won_value) filter (where row.won), 0)::numeric
          as won_value_total,
        avg(row.won_value) filter (where row.won) as won_value_average
      from (select 1) anchor
      left join lateral private.external_metric_lead_rows(
        p_company_id, p_high_water_sequence, p_from, p_to, p_timezone,
        v_time_group, v_dimension_group, p_source_id, p_campaign_handle,
        p_form_id
      ) row on true
      group by row.group_time_bucket, row.dimension_id
      order by row.group_time_bucket nulls first, row.dimension_id nulls first
    loop
      v_cohort := v_group.cohort_count;
      v_value := null;
      v_numerator := null;
      v_denominator := null;
      v_included := v_cohort;
      v_missing := 0;

      case v_metric
        when 'leads_received' then
          v_value := v_cohort;
          v_numerator := v_cohort;
        when 'cohort_active_lead_count' then
          v_value := v_group.active_count;
          v_numerator := v_group.active_count;
        when 'cohort_discarded_lead_count' then
          v_value := v_group.discarded_count;
          v_numerator := v_group.discarded_count;
        when 'cohort_discard_rate' then
          v_numerator := v_group.discarded_count;
          v_denominator := v_cohort;
          v_value := case when v_cohort = 0 then null
            else 100.0 * v_numerator / v_cohort end;
        when 'cohort_disqualified_count' then
          v_value := v_group.disqualified_count;
          v_numerator := v_group.disqualified_count;
        when 'cohort_disqualified_rate' then
          v_numerator := v_group.disqualified_count;
          v_denominator := v_cohort;
          v_value := case when v_cohort = 0 then null
            else 100.0 * v_numerator / v_cohort end;
        when 'project_converted_count' then
          v_value := v_group.converted_count;
          v_numerator := v_group.converted_count;
        when 'project_converted_rate' then
          v_numerator := v_group.converted_count;
          v_denominator := v_cohort;
          v_value := case when v_cohort = 0 then null
            else 100.0 * v_numerator / v_cohort end;
        when 'cohort_decided_lead_count' then
          v_value := v_group.won_count + v_group.lost_count;
          v_numerator := v_value;
        when 'cohort_won_count' then
          v_value := v_group.won_count;
          v_numerator := v_group.won_count;
        when 'cohort_lost_count' then
          v_value := v_group.lost_count;
          v_numerator := v_group.lost_count;
        when 'cohort_decided_win_rate' then
          v_numerator := v_group.won_count;
          v_denominator := v_group.won_count + v_group.lost_count;
          v_value := case when v_denominator = 0 then null
            else 100.0 * v_numerator / v_denominator end;
          v_included := v_denominator::bigint;
          v_missing := v_cohort - v_included;
        when 'first_response_coverage' then
          v_numerator := v_group.response_count;
          v_denominator := v_cohort;
          v_value := case when v_cohort = 0 then null
            else 100.0 * v_numerator / v_cohort end;
          v_included := v_group.response_count;
          v_missing := v_cohort - v_included;
        when 'median_first_response_minutes' then
          v_value := v_group.response_median;
          v_numerator := v_group.response_count;
          v_denominator := v_cohort;
          v_included := v_group.response_count;
          v_missing := v_cohort - v_included;
        when 'median_time_to_decision' then
          v_value := v_group.decision_median;
          v_numerator := v_group.decision_count;
          v_denominator := v_cohort;
          v_included := v_group.decision_count;
          v_missing := v_cohort - v_included;
        when 'median_time_to_win' then
          v_value := v_group.win_median;
          v_numerator := v_group.win_time_count;
          v_denominator := v_group.won_count;
          v_included := v_group.win_time_count;
          v_missing := greatest(0, v_group.won_count - v_included);
        when 'median_time_to_project_conversion' then
          v_value := v_group.conversion_median;
          v_numerator := v_group.conversion_time_count;
          v_denominator := v_group.converted_count;
          v_included := v_group.conversion_time_count;
          v_missing := greatest(0, v_group.converted_count - v_included);
        when 'source_attribution_completeness' then
          v_numerator := v_group.source_known_count;
          v_denominator := v_cohort;
          v_value := case when v_cohort = 0 then null
            else 100.0 * v_numerator / v_cohort end;
          v_included := v_group.source_known_count;
          v_missing := v_cohort - v_included;
        when 'lifecycle_evidence_completeness' then
          v_numerator := v_group.lifecycle_known_count;
          v_denominator := v_cohort;
          v_value := case when v_cohort = 0 then null
            else 100.0 * v_numerator / v_cohort end;
          v_included := v_group.lifecycle_known_count;
          v_missing := v_cohort - v_included;
        when 'cohort_open_estimated_value' then
          v_value := v_group.estimated_total;
          v_numerator := v_group.estimated_total;
          v_included := v_group.estimated_known_count;
          v_missing := greatest(
            0,
            v_group.active_count - v_group.estimated_known_count
          );
        when 'cohort_won_value' then
          v_value := v_group.won_value_total;
          v_numerator := v_group.won_value_total;
          v_included := v_group.won_value_known_count;
          v_missing := greatest(
            0,
            v_group.won_count - v_group.won_value_known_count
          );
        when 'cohort_average_won_value' then
          v_value := v_group.won_value_average;
          v_numerator := v_group.won_value_total;
          v_denominator := v_group.won_value_known_count;
          v_included := v_group.won_value_known_count;
          v_missing := greatest(
            0,
            v_group.won_count - v_group.won_value_known_count
          );
        else
          raise exception 'external_metric_definition_unimplemented'
            using errcode = '55000';
      end case;

      v_grouping := private.external_metric_grouping(
        p_groupings,
        v_group.group_time_bucket,
        v_group.dimension_id,
        v_group.dimension_label,
        null
      );
      v_results := v_results || jsonb_build_array(
        private.external_metric_cell(
          v_metric,
          v_value,
          v_numerator,
          v_denominator,
          v_included,
          v_missing,
          v_grouping,
          p_currency,
          v_cohort
        )
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'timezone', p_timezone,
    'generatedAt', p_generated_at,
    'dataThrough', p_data_through,
    'metricDefinitionVersion', '1',
    'currency', case
      when p_metric_ids && v_financial_metrics then p_currency
      else null
    end,
    'includedMetricIds', to_jsonb(p_metric_ids),
    'results', v_results
  );
end;
$function$;

revoke all on function private.resolve_external_metric_range(
  text, timestamptz, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.resolve_external_financial_opportunity(
  uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.external_metric_basis(text)
  from public, anon, authenticated, service_role;
revoke all on function private.external_metric_unit(text)
  from public, anon, authenticated, service_role;
revoke all on function private.external_metric_population(text)
  from public, anon, authenticated, service_role;
revoke all on function private.external_metric_grouping(
  text[], timestamptz, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.external_metric_cell(
  text, numeric, numeric, numeric, bigint, bigint, jsonb, text, bigint
) from public, anon, authenticated, service_role;
revoke all on function private.external_metric_lead_rows(
  uuid, bigint, timestamptz, timestamptz, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.external_metric_event_rows(
  uuid, bigint, timestamptz, timestamptz, date, date, timestamptz,
  text, text, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.authorize_external_lead_metrics_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, boolean, boolean,
  text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.authorize_external_lead_metrics_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, boolean, boolean,
  text, text, text, text, text, text, text, timestamptz
) to service_role;

revoke all on function public.read_external_lead_metrics_v1_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, boolean, bigint,
  timestamptz, timestamptz, date, date, text, text, text[], text[],
  text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.read_external_lead_metrics_v1_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, boolean, bigint,
  timestamptz, timestamptz, date, date, text, text, text[], text[],
  text, text, text, timestamptz, timestamptz
) to service_role;

comment on function public.read_external_lead_metrics_v1_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, boolean, bigint,
  timestamptz, timestamptz, date, date, text, text, text[], text[],
  text, text, text, timestamptz, timestamptz
) is 'Versioned company-wide lead metrics with immutable projection high-water, exact event attribution, small-cohort suppression, and additive financial scope.';

commit;
