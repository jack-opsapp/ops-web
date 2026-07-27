begin;

-- Complete the private projection foundation created by
-- 20260727102500_external_api_authorization_foundation.sql. This migration
-- exposes nothing directly: fixed service-role functions remain the only
-- database boundary used by the external analytics API.
-- projection_schema_version remains 1 for this contract.

do $prerequisites$
begin
  if to_regclass('private.external_lead_handles') is null
    or to_regclass('private.external_lead_projection_versions') is null
    or to_regclass('private.external_lead_projection_baselines') is null
    or to_regclass('private.external_lead_source_projections') is null
    or to_regclass('private.external_lead_lifecycle_facts') is null
    or to_regclass('private.external_lead_lifecycle_events') is null
    or to_regclass('public.opportunities') is null
    or to_regclass('public.opportunity_dispositions') is null
    or to_regclass('public.projects') is null
    or to_regclass('public.invoices') is null
    or to_regclass('public.payments') is null
    or to_regprocedure(
      'private.append_external_lead_projection_foundation(uuid,uuid,smallint,text,jsonb,jsonb,timestamp with time zone)'
    ) is null
    or to_regprocedure('private.external_opaque_uuid(text,uuid)') is null
    or to_regprocedure('private.require_external_api_service_role()') is null
  then
    raise exception 'external_lead_projection_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Projection primitives ----------------------------------------------------

create or replace function private.external_lead_projection_minute(
  p_value timestamptz
) returns text
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select to_char(
    date_trunc('minute', p_value at time zone 'UTC'),
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$function$;

create or replace function private.external_lead_empty_dimension()
returns jsonb
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select '{"present":false,"handle":null,"label":null}'::jsonb;
$function$;

create or replace function private.external_lead_generic_source_projection(
  p_source text,
  p_inquiry_received_at timestamptz,
  p_created_at timestamptz,
  p_inquiry_time_quality text
) returns jsonb
language plpgsql
immutable
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_channel text;
  v_integration text;
  v_timing_source text;
  v_timing_quality text;
  v_empty jsonb := private.external_lead_empty_dimension();
begin
  select
    case p_source
      when 'website' then 'website'
      when 'email' then 'email'
      when 'referral' then 'referral'
      when 'phone' then 'phone'
      when 'social_media' then 'social'
      when 'walk_in' then 'walk_in'
      when 'repeat_client' then 'repeat_business'
      when 'voice_log' then 'manual'
      when 'manual' then 'manual'
      else 'other'
    end,
    case p_source
      when 'email' then 'email_import'
      when 'referral' then 'referral'
      when 'phone' then 'phone'
      when 'social_media' then 'social'
      when 'walk_in' then 'walk_in'
      when 'repeat_client' then 'repeat_business'
      when 'voice_log' then 'manual'
      when 'manual' then 'manual'
      else 'other'
    end
  into v_channel, v_integration;

  select
    case p_inquiry_time_quality
      when 'exact' then 'authenticated_request'
      when 'provider' then 'provider_message'
      when 'manual' then 'manual'
      else 'creation_fallback'
    end,
    case p_inquiry_time_quality
      when 'exact' then 'exact'
      when 'provider' then 'provider_derived'
      when 'manual' then 'manual'
      else 'fallback'
    end
  into v_timing_source, v_timing_quality;

  return jsonb_build_object(
    'sourceChannel', v_channel,
    'sourceIntegrationType', v_integration,
    'sourceId', null,
    'sourceLabel', null,
    'siteHost', null,
    'siteLabel', null,
    'formId', null,
    'formLabel', null,
    'campaign', v_empty,
    'utm', jsonb_build_object(
      'source', v_empty,
      'medium', v_empty,
      'campaign', v_empty,
      'term', v_empty,
      'content', v_empty
    ),
    'click', jsonb_build_object(
      'providerCode', null,
      'captured', false
    ),
    'landingPage', null,
    'referrer', null,
    'inquiryReceivedAt',
      private.external_lead_projection_minute(p_inquiry_received_at),
    'leadCreatedAt',
      private.external_lead_projection_minute(p_created_at),
    'attributionCapturedAt',
      private.external_lead_projection_minute(p_inquiry_received_at),
    'timingSource', v_timing_source,
    'timingQuality', v_timing_quality,
    'completeness', jsonb_build_object(
      'channelKnown', v_channel <> 'other',
      'authenticatedSite', false,
      'configuredForm', false,
      'campaignObserved', false,
      'utmSetObserved', false,
      'landingPageObserved', false,
      'referrerObserved', false
    )
  );
end;
$function$;

-- This is the only public-payload allowlist. It deliberately reconstructs the
-- result and therefore strips any accidental internal, PII, storage, mailbox,
-- assignee, or raw attribution field before persistence.
create or replace function private.external_lead_projection_public_allowlist(
  p_projection jsonb,
  p_operation text
) returns jsonb
language plpgsql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if jsonb_typeof(p_projection) <> 'object' then
    raise exception 'external_lead_projection_payload_invalid'
      using errcode = '22023';
  end if;

  if p_operation = 'deletion' then
    -- Private version metadata is the pair 'operation', 'deletion'; the
    -- external tombstone deliberately serializes the verb as delete.
    return jsonb_build_object(
      'operation', 'delete',
      'publicLeadId', p_projection -> 'publicLeadId',
      'deletedAt', p_projection -> 'deletedAt'
    );
  end if;

  if p_operation not in ('upsert', 'merge') then
    raise exception 'external_lead_projection_operation_invalid'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'operation', p_operation,
    'publicLeadId', p_projection -> 'publicLeadId',
    'inquiryReceivedAt', p_projection -> 'inquiryReceivedAt',
    'createdAt', p_projection -> 'createdAt',
    'updatedAt', p_projection -> 'updatedAt',
    'currentStageEnteredAt', p_projection -> 'currentStageEnteredAt',
    'terminalAt', p_projection -> 'terminalAt',
    'currentStage', p_projection -> 'currentStage',
    'disposition', p_projection -> 'disposition',
    'recordState', p_projection -> 'recordState',
    'mergeTargetPublicLeadId', p_projection -> 'mergeTargetPublicLeadId',
    'source', p_projection -> 'source',
    'firstResponseAt', p_projection -> 'firstResponseAt',
    'firstResponseMinutes', p_projection -> 'firstResponseMinutes',
    'wonAt', p_projection -> 'wonAt',
    'lostAt', p_projection -> 'lostAt',
    'disqualifiedAt', p_projection -> 'disqualifiedAt',
    'discardedAt', p_projection -> 'discardedAt',
    'projectConvertedAt', p_projection -> 'projectConvertedAt',
    'minutesToDecision', p_projection -> 'minutesToDecision',
    'minutesToWin', p_projection -> 'minutesToWin',
    'minutesToProjectConversion',
      p_projection -> 'minutesToProjectConversion',
    'reached', p_projection -> 'reached',
    -- Financial data remains inside the private projection snapshot. Task 15
    -- strips this key unless the authenticated principal has the additive
    -- analytics.financial.read scope.
    'financial', p_projection -> 'financial'
  );
end;
$function$;

create or replace function private.external_lead_project_id(
  p_opportunity_id uuid
) returns uuid
language sql
stable
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce(
    opportunity.project_ref,
    private.try_parse_uuid(opportunity.project_id)
  )
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id;
$function$;

create or replace function private.build_external_lead_public_projection(
  p_company_id uuid,
  p_opportunity_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_facts private.external_lead_lifecycle_facts%rowtype;
  v_handle private.external_lead_handles%rowtype;
  v_disposition text;
  v_terminal_at timestamptz;
  v_source jsonb;
  v_existing_normalized jsonb;
  v_merge_target_public uuid;
  v_project_id uuid;
  v_invoiced numeric := 0;
  v_paid numeric := 0;
  v_currency text;
  v_operation text;
  v_record_state text;
  v_projection jsonb;
  v_reached_qualifying boolean;
  v_reached_quoting boolean;
  v_reached_quoted boolean;
  v_reached_follow_up boolean;
  v_reached_negotiation boolean;
begin
  select opportunity.*
  into v_opportunity
  from public.opportunities opportunity
  where opportunity.company_id = p_company_id
    and opportunity.id = p_opportunity_id
  for share;

  if not found then
    raise exception 'external_lead_projection_opportunity_not_found'
      using errcode = 'P0002';
  end if;

  perform private.ensure_external_lead_lifecycle_facts(
    p_company_id,
    p_opportunity_id
  );

  select facts.*
  into strict v_facts
  from private.external_lead_lifecycle_facts facts
  where facts.company_id = p_company_id
    and facts.opportunity_id = p_opportunity_id;

  insert into private.external_lead_handles (
    company_id,
    opportunity_id
  ) values (
    p_company_id,
    p_opportunity_id
  )
  on conflict (company_id, opportunity_id) do nothing;

  select handle.*
  into strict v_handle
  from private.external_lead_handles handle
  where handle.company_id = p_company_id
    and handle.opportunity_id = p_opportunity_id;

  if v_opportunity.merged_into_opportunity_id is not null then
    insert into private.external_lead_handles (
      company_id,
      opportunity_id
    )
    select
      p_company_id,
      target.id
    from public.opportunities target
    where target.company_id = p_company_id
      and target.id = v_opportunity.merged_into_opportunity_id
    on conflict (company_id, opportunity_id) do nothing;

    select target_handle.public_lead_id
    into v_merge_target_public
    from private.external_lead_handles target_handle
    where target_handle.company_id = p_company_id
      and target_handle.opportunity_id =
        v_opportunity.merged_into_opportunity_id;

    if v_merge_target_public is null then
      raise exception 'external_lead_projection_merge_target_invalid'
        using errcode = '23503';
    end if;
  end if;

  if v_facts.deleted_at is not null
    and v_opportunity.merged_into_opportunity_id is null
  then
    return private.external_lead_projection_public_allowlist(
      jsonb_build_object(
        'operation', 'delete',
        'publicLeadId',
          private.external_opaque_uuid('lead', v_handle.public_lead_id),
        'deletedAt',
          private.external_lead_projection_minute(v_facts.deleted_at)
      ),
      'deletion'
    );
  end if;

  select disposition.disposition
  into v_disposition
  from public.opportunity_dispositions disposition
  where disposition.company_id = p_company_id
    and disposition.opportunity_id = p_opportunity_id
    and disposition.superseded_at is null
  order by disposition.created_at desc, disposition.id desc
  limit 1;

  if v_disposition = 'merged' then
    v_disposition := null;
  end if;

  select source_projection.normalized_source_projection
  into v_existing_normalized
  from private.external_lead_source_projections source_projection
  where source_projection.company_id = p_company_id
    and source_projection.opportunity_id = p_opportunity_id;

  if v_existing_normalized ? 'submission_id' then
    select baseline.public_projection -> 'source'
    into v_source
    from private.external_lead_projection_baselines baseline
    where baseline.company_id = p_company_id
      and baseline.handle_id = v_handle.id
      and baseline.public_projection #>> '{source,sourceIntegrationType}' =
        'external_intake';
  end if;

  if v_source is null then
    v_source := private.external_lead_generic_source_projection(
      v_opportunity.source,
      v_facts.inquiry_received_at,
      v_opportunity.created_at,
      v_facts.inquiry_time_quality
    );
  end if;

  v_project_id := private.external_lead_project_id(p_opportunity_id);

  select coalesce(sum(distinct_invoice.total), 0)
  into v_invoiced
  from (
    select invoice.id, invoice.total
    from public.invoices invoice
    where invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and invoice.status not in ('draft', 'void')
      and (
        invoice.opportunity_id = p_opportunity_id
        or (
          v_project_id is not null
          and invoice.project_id = v_project_id
        )
      )
  ) distinct_invoice;

  select coalesce(sum(payment.amount), 0)
  into v_paid
  from public.payments payment
  join public.invoices invoice
    on invoice.id = payment.invoice_id
   and invoice.company_id = payment.company_id
  where payment.company_id = p_company_id
    and payment.voided_at is null
    and invoice.deleted_at is null
    and invoice.status <> 'void'
    and (
      invoice.opportunity_id = p_opportunity_id
      or (
        v_project_id is not null
        and invoice.project_id = v_project_id
      )
    );

  select upper(company.currency_code)
  into v_currency
  from public.companies company
  where company.id = p_company_id;

  select
    exists (
      select 1
      from private.external_lead_lifecycle_events event
      where event.company_id = p_company_id
        and event.opportunity_id = p_opportunity_id
        and event.event_kind = 'stage_changed'
        and event.to_stage = 'qualifying'
    ),
    exists (
      select 1
      from private.external_lead_lifecycle_events event
      where event.company_id = p_company_id
        and event.opportunity_id = p_opportunity_id
        and event.event_kind = 'stage_changed'
        and event.to_stage = 'quoting'
    ),
    exists (
      select 1
      from private.external_lead_lifecycle_events event
      where event.company_id = p_company_id
        and event.opportunity_id = p_opportunity_id
        and event.event_kind = 'stage_changed'
        and event.to_stage = 'quoted'
    ),
    exists (
      select 1
      from private.external_lead_lifecycle_events event
      where event.company_id = p_company_id
        and event.opportunity_id = p_opportunity_id
        and event.event_kind = 'stage_changed'
        and event.to_stage = 'follow_up'
    ),
    exists (
      select 1
      from private.external_lead_lifecycle_events event
      where event.company_id = p_company_id
        and event.opportunity_id = p_opportunity_id
        and event.event_kind = 'stage_changed'
        and event.to_stage = 'negotiation'
    )
  into
    v_reached_qualifying,
    v_reached_quoting,
    v_reached_quoted,
    v_reached_follow_up,
    v_reached_negotiation;

  -- A merged survivor record is serialized as 'operation', 'merge'.
  v_operation := case
    when v_opportunity.merged_into_opportunity_id is not null then 'merge'
    else 'upsert'
  end;
  v_record_state := case
    when v_opportunity.merged_into_opportunity_id is not null then 'merged'
    when v_opportunity.archived_at is not null then 'archived'
    else 'active'
  end;
  v_terminal_at := case v_disposition
    when 'won' then v_facts.won_at
    when 'lost' then v_facts.lost_at
    when 'disqualified' then v_facts.disqualified_at
    when 'discarded' then v_facts.discarded_at
    when 'converted_to_project' then v_facts.converted_at
    else coalesce(v_facts.merged_at, v_facts.archived_at)
  end;

  v_projection := jsonb_build_object(
    'operation', v_operation,
    'publicLeadId',
      private.external_opaque_uuid('lead', v_handle.public_lead_id),
    'inquiryReceivedAt',
      private.external_lead_projection_minute(v_facts.inquiry_received_at),
    'createdAt',
      private.external_lead_projection_minute(v_opportunity.created_at),
    'updatedAt',
      private.external_lead_projection_minute(v_opportunity.updated_at),
    'currentStageEnteredAt',
      private.external_lead_projection_minute(
        greatest(
          v_opportunity.stage_entered_at,
          v_facts.inquiry_received_at
        )
      ),
    'terminalAt', case
      when v_terminal_at is null then null
      else private.external_lead_projection_minute(v_terminal_at)
    end,
    'currentStage', v_opportunity.stage,
    'disposition', v_disposition,
    'recordState', v_record_state,
    'mergeTargetPublicLeadId', case
      when v_merge_target_public is null then null
      else private.external_opaque_uuid('lead', v_merge_target_public)
    end,
    'source', v_source,
    'firstResponseAt', case
      when v_facts.first_response_at is null then null
      else private.external_lead_projection_minute(v_facts.first_response_at)
    end,
    'firstResponseMinutes', case
      when v_facts.first_response_at is null then null
      else greatest(
        0,
        floor(
          extract(
            epoch from (
              v_facts.first_response_at - v_facts.inquiry_received_at
            )
          ) / 60
        )::integer
      )
    end,
    'wonAt', case
      when v_facts.won_at is null then null
      else private.external_lead_projection_minute(v_facts.won_at)
    end,
    'lostAt', case
      when v_facts.lost_at is null then null
      else private.external_lead_projection_minute(v_facts.lost_at)
    end,
    'disqualifiedAt', case
      when v_facts.disqualified_at is null then null
      else private.external_lead_projection_minute(v_facts.disqualified_at)
    end,
    'discardedAt', case
      when v_facts.discarded_at is null then null
      else private.external_lead_projection_minute(v_facts.discarded_at)
    end,
    'projectConvertedAt', case
      when v_facts.converted_at is null then null
      else private.external_lead_projection_minute(v_facts.converted_at)
    end,
    'minutesToDecision', case
      when coalesce(v_facts.won_at, v_facts.lost_at) is null then null
      else greatest(
        0,
        floor(
          extract(
            epoch from (
              coalesce(v_facts.won_at, v_facts.lost_at)
              - v_facts.inquiry_received_at
            )
          ) / 60
        )::integer
      )
    end,
    'minutesToWin', case
      when v_facts.won_at is null then null
      else greatest(
        0,
        floor(
          extract(
            epoch from (
              v_facts.won_at - v_facts.inquiry_received_at
            )
          ) / 60
        )::integer
      )
    end,
    'minutesToProjectConversion', case
      when v_facts.converted_at is null then null
      else greatest(
        0,
        floor(
          extract(
            epoch from (
              v_facts.converted_at - v_facts.inquiry_received_at
            )
          ) / 60
        )::integer
      )
    end,
    'reached', jsonb_build_object(
      'qualifying',
        v_reached_qualifying
        or v_opportunity.stage in (
          'qualifying', 'quoting', 'quoted', 'follow_up',
          'negotiation', 'won', 'lost'
        ),
      'quoting',
        v_reached_quoting
        or v_opportunity.stage in (
          'quoting', 'quoted', 'follow_up', 'negotiation', 'won', 'lost'
        ),
      'quoted',
        v_reached_quoted
        or v_opportunity.stage in (
          'quoted', 'follow_up', 'negotiation', 'won', 'lost'
        ),
      'followUp',
        v_reached_follow_up
        or v_opportunity.stage in ('follow_up', 'negotiation', 'won', 'lost'),
      'negotiation',
        v_reached_negotiation
        or v_opportunity.stage in ('negotiation', 'won', 'lost'),
      'won', v_facts.won_at is not null,
      'lost', v_facts.lost_at is not null,
      'projectConverted', v_facts.converted_at is not null
    ),
    'financial', jsonb_build_object(
      'estimatedLeadValue', case
        when coalesce(
          v_opportunity.estimated_value,
          v_opportunity.detected_value
        ) is null then null
        else greatest(
          0,
          coalesce(
            v_opportunity.estimated_value,
            v_opportunity.detected_value
          )
        )
      end,
      'wonValue', case
        when v_facts.won_at is null
          or coalesce(
            v_opportunity.actual_value,
            v_opportunity.estimated_value,
            v_opportunity.detected_value
          ) is null
        then null
        else greatest(
          0,
          coalesce(
            v_opportunity.actual_value,
            v_opportunity.estimated_value,
            v_opportunity.detected_value
          )
        )
      end,
      'invoicedTotal', greatest(0, v_invoiced),
      'paidTotal', greatest(0, v_paid),
      'currency', coalesce(nullif(v_currency, ''), 'CAD')
    )
  );

  return private.external_lead_projection_public_allowlist(
    v_projection,
    v_operation
  );
end;
$function$;

create or replace function private.refresh_external_lead_projection_core(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_reason text
) returns table (
  public_lead_id text,
  change_sequence bigint,
  operation text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_projection constant jsonb :=
    private.build_external_lead_public_projection(
      p_company_id,
      p_opportunity_id
    );
  v_operation text := case v_projection ->> 'operation'
    when 'delete' then 'deletion'
    when 'merge' then 'merge'
    else 'upsert'
  end;
  v_normalized jsonb;
  v_result record;
  v_previous_guard text :=
    current_setting('ops.external_projection_refreshing', true);
begin
  if p_reason not in (
    'opportunity_changed',
    'lifecycle_changed',
    'source_changed',
    'project_changed',
    'financial_changed',
    'backfill'
  ) then
    raise exception 'external_lead_projection_reason_invalid'
      using errcode = '22023';
  end if;

  select source_projection.normalized_source_projection
  into v_normalized
  from private.external_lead_source_projections source_projection
  where source_projection.company_id = p_company_id
    and source_projection.opportunity_id = p_opportunity_id;

  v_normalized := coalesce(
    v_normalized,
    jsonb_build_object(
      'evidence', 'opportunity',
      'source', (
        select opportunity.source
        from public.opportunities opportunity
        where opportunity.company_id = p_company_id
          and opportunity.id = p_opportunity_id
      )
    )
  );

  perform set_config('ops.external_projection_refreshing', 'on', true);
  begin
    select
      projection.public_lead_id,
      projection.change_sequence
    into strict v_result
    from private.append_external_lead_projection_foundation(
      p_company_id,
      p_opportunity_id,
      1::smallint,
      v_operation,
      v_normalized,
      v_projection,
      clock_timestamp()
    ) projection;
  exception
    when others then
      perform set_config(
        'ops.external_projection_refreshing',
        coalesce(v_previous_guard, ''),
        true
      );
      raise;
  end;
  perform set_config(
    'ops.external_projection_refreshing',
    coalesce(v_previous_guard, ''),
    true
  );

  return query
  select
    private.external_opaque_uuid('lead', v_result.public_lead_id),
    v_result.change_sequence,
    v_operation;
end;
$function$;

create or replace function public.refresh_external_lead_projection_as_system(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_reason text
) returns table (
  public_lead_id text,
  change_sequence bigint,
  operation text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform private.require_external_api_service_role();
  return query
  select projection.*
  from private.refresh_external_lead_projection_core(
    p_company_id,
    p_opportunity_id,
    p_reason
  ) projection;
end;
$function$;

-- Same-transaction dependency refresh -------------------------------------

create or replace function private.refresh_external_lead_projection_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_opportunity_id uuid;
  v_reason text := coalesce(tg_argv[0], 'opportunity_changed');
begin
  if current_setting('ops.external_projection_refreshing', true) = 'on' then
    return coalesce(new, old);
  end if;

  v_company_id := case when tg_op = 'DELETE'
    then old.company_id else new.company_id end;
  v_opportunity_id := case
    when tg_table_name = 'external_lead_lifecycle_facts' then
      case when tg_op = 'DELETE'
        then old.opportunity_id else new.opportunity_id end
    when tg_table_name = 'external_lead_source_projections' then
      case when tg_op = 'DELETE'
        then old.opportunity_id else new.opportunity_id end
    when tg_table_name = 'opportunity_dispositions' then
      case when tg_op = 'DELETE'
        then old.opportunity_id else new.opportunity_id end
    else
      case when tg_op = 'DELETE' then old.id else new.id end
  end;

  perform 1
  from public.opportunities opportunity
  where opportunity.company_id = v_company_id
    and opportunity.id = v_opportunity_id;
  if found then
    perform private.refresh_external_lead_projection_core(
      v_company_id,
      v_opportunity_id,
      v_reason
    );
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists external_lead_projection_on_opportunity_insert
  on public.opportunities;
create trigger external_lead_projection_on_opportunity_insert
after insert on public.opportunities
for each row execute function
  private.refresh_external_lead_projection_trigger('opportunity_changed');

drop trigger if exists external_lead_projection_on_opportunity_update
  on public.opportunities;
create trigger external_lead_projection_on_opportunity_update
after update of
  stage,
  stage_entered_at,
  source,
  estimated_value,
  detected_value,
  actual_value,
  archived_at,
  deleted_at,
  merged_into_opportunity_id,
  project_id,
  project_ref,
  updated_at
on public.opportunities
for each row
when (
  old.stage is distinct from new.stage
  or old.stage_entered_at is distinct from new.stage_entered_at
  or old.source is distinct from new.source
  or old.estimated_value is distinct from new.estimated_value
  or old.detected_value is distinct from new.detected_value
  or old.actual_value is distinct from new.actual_value
  or old.archived_at is distinct from new.archived_at
  or old.deleted_at is distinct from new.deleted_at
  or old.merged_into_opportunity_id
    is distinct from new.merged_into_opportunity_id
  or old.project_id is distinct from new.project_id
  or old.project_ref is distinct from new.project_ref
)
execute function
  private.refresh_external_lead_projection_trigger('opportunity_changed');

drop trigger if exists external_lead_projection_on_lifecycle
  on private.external_lead_lifecycle_facts;
create trigger external_lead_projection_on_lifecycle
after insert or update on private.external_lead_lifecycle_facts
for each row execute function
  private.refresh_external_lead_projection_trigger('lifecycle_changed');

drop trigger if exists external_lead_projection_on_source
  on private.external_lead_source_projections;
create trigger external_lead_projection_on_source
after insert or update on private.external_lead_source_projections
for each row execute function
  private.refresh_external_lead_projection_trigger('source_changed');

drop trigger if exists external_lead_projection_on_disposition
  on public.opportunity_dispositions;
create trigger external_lead_projection_on_disposition
after insert or update on public.opportunity_dispositions
for each row execute function
  private.refresh_external_lead_projection_trigger('lifecycle_changed');

create or replace function private.refresh_external_lead_projection_for_project()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_project_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  v_company_id uuid :=
    case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  v_opportunity_id uuid;
begin
  for v_opportunity_id in
    select opportunity.id
    from public.opportunities opportunity
    where opportunity.company_id = v_company_id
      and (
        opportunity.project_ref = v_project_id
        or private.try_parse_uuid(opportunity.project_id) = v_project_id
        or opportunity.id = case
          when tg_op = 'DELETE' then coalesce(
            old.opportunity_ref,
            private.try_parse_uuid(old.opportunity_id)
          )
          else coalesce(
            new.opportunity_ref,
            private.try_parse_uuid(new.opportunity_id)
          )
        end
      )
  loop
    perform private.refresh_external_lead_projection_core(
      v_company_id,
      v_opportunity_id,
      'project_changed'
    );
  end loop;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists external_lead_projection_on_project
  on public.projects;
create trigger external_lead_projection_on_project
after insert or update or delete on public.projects
for each row execute function
  private.refresh_external_lead_projection_for_project();

create or replace function private.refresh_external_lead_projection_for_invoice()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_invoice record;
  v_opportunity_id uuid;
begin
  for v_invoice in
    select changed.company_id, changed.opportunity_id, changed.project_id
    from jsonb_to_recordset(
      case
        when tg_op = 'INSERT' then jsonb_build_array(
          jsonb_build_object(
            'company_id', new.company_id,
            'opportunity_id', new.opportunity_id,
            'project_id', new.project_id
          )
        )
        when tg_op = 'DELETE' then jsonb_build_array(
          jsonb_build_object(
            'company_id', old.company_id,
            'opportunity_id', old.opportunity_id,
            'project_id', old.project_id
          )
        )
        else jsonb_build_array(
          jsonb_build_object(
            'company_id', old.company_id,
            'opportunity_id', old.opportunity_id,
            'project_id', old.project_id
          ),
          jsonb_build_object(
            'company_id', new.company_id,
            'opportunity_id', new.opportunity_id,
            'project_id', new.project_id
          )
        )
      end
    ) as changed(
      company_id uuid,
      opportunity_id uuid,
      project_id uuid
    )
  loop
    for v_opportunity_id in
      select opportunity.id
      from public.opportunities opportunity
      where opportunity.company_id = v_invoice.company_id
        and (
          opportunity.id = v_invoice.opportunity_id
          or (
            v_invoice.project_id is not null
            and (
              opportunity.project_ref = v_invoice.project_id
              or private.try_parse_uuid(opportunity.project_id) =
                v_invoice.project_id
            )
          )
        )
    loop
      perform private.refresh_external_lead_projection_core(
        v_invoice.company_id,
        v_opportunity_id,
        'financial_changed'
      );
    end loop;
  end loop;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists external_lead_projection_on_invoice
  on public.invoices;
create trigger external_lead_projection_on_invoice
after insert or update or delete on public.invoices
for each row execute function
  private.refresh_external_lead_projection_for_invoice();

create or replace function private.refresh_external_lead_projection_for_payment()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_payment record;
  v_invoice public.invoices%rowtype;
  v_opportunity_id uuid;
begin
  for v_payment in
    select changed.company_id, changed.invoice_id
    from jsonb_to_recordset(
      case
        when tg_op = 'INSERT' then jsonb_build_array(
          jsonb_build_object(
            'company_id', new.company_id,
            'invoice_id', new.invoice_id
          )
        )
        when tg_op = 'DELETE' then jsonb_build_array(
          jsonb_build_object(
            'company_id', old.company_id,
            'invoice_id', old.invoice_id
          )
        )
        else jsonb_build_array(
          jsonb_build_object(
            'company_id', old.company_id,
            'invoice_id', old.invoice_id
          ),
          jsonb_build_object(
            'company_id', new.company_id,
            'invoice_id', new.invoice_id
          )
        )
      end
    ) as changed(company_id uuid, invoice_id uuid)
  loop
    select invoice.*
    into v_invoice
    from public.invoices invoice
    where invoice.company_id = v_payment.company_id
      and invoice.id = v_payment.invoice_id;

    if found then
      for v_opportunity_id in
        select opportunity.id
        from public.opportunities opportunity
        where opportunity.company_id = v_payment.company_id
          and (
            opportunity.id = v_invoice.opportunity_id
            or (
              v_invoice.project_id is not null
              and (
                opportunity.project_ref = v_invoice.project_id
                or private.try_parse_uuid(opportunity.project_id) =
                  v_invoice.project_id
              )
            )
          )
      loop
        perform private.refresh_external_lead_projection_core(
          v_payment.company_id,
          v_opportunity_id,
          'financial_changed'
        );
      end loop;
    end if;
  end loop;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists external_lead_projection_on_payment
  on public.payments;
create trigger external_lead_projection_on_payment
after insert or update or delete on public.payments
for each row execute function
  private.refresh_external_lead_projection_for_payment();

-- Retention with transaction-scoped write-token fencing --------------------

create table private.external_lead_projection_retention_tokens (
  transaction_id bigint primary key,
  token uuid not null unique,
  expires_at timestamptz not null
);

alter table private.external_lead_projection_retention_tokens
  enable row level security;

revoke all on table private.external_lead_projection_retention_tokens
  from public, anon, authenticated, service_role;

create or replace function private.reject_external_lead_projection_version_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_token_text text :=
    current_setting('ops.external_projection_retention_token', true);
begin
  if tg_op = 'DELETE'
    and v_token_text is not null
    and v_token_text <> ''
    and exists (
      select 1
      from private.external_lead_projection_retention_tokens token
      where token.transaction_id = txid_current()
        and token.token = v_token_text::uuid
        and token.expires_at >= clock_timestamp()
    )
  then
    return old;
  end if;

  raise exception 'external_lead_projection_versions_append_only'
    using errcode = '42501';
end;
$function$;

create or replace function public.prune_external_lead_projection_versions_as_system(
  p_now timestamptz default clock_timestamp()
) returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token uuid := gen_random_uuid();
  v_deleted bigint;
begin
  perform private.require_external_api_service_role();

  insert into private.external_lead_projection_retention_tokens (
    transaction_id,
    token,
    expires_at
  ) values (
    txid_current(),
    v_token,
    clock_timestamp() + interval '5 minutes'
  )
  on conflict (transaction_id)
  do update set
    token = excluded.token,
    expires_at = excluded.expires_at;

  perform set_config(
    'ops.external_projection_retention_token',
    v_token::text,
    true
  );

  delete from private.external_lead_projection_versions version
  where version.projected_at < p_now - interval '30 days'
    and not exists (
      select 1
      from private.external_lead_projection_baselines baseline
      where baseline.version_id = version.id
        and baseline.company_id = version.company_id
    );
  get diagnostics v_deleted = row_count;

  delete from private.external_lead_projection_retention_tokens token
  where token.transaction_id = txid_current()
    and token.token = v_token;
  perform set_config('ops.external_projection_retention_token', '', true);

  return v_deleted;
end;
$function$;

-- Resumable historical backfill -------------------------------------------

create table private.external_lead_projection_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid
    references public.companies (id) on delete restrict,
  status text not null default 'pending',
  checkpoint_opportunity_id uuid,
  canonical_lead_count bigint not null default 0,
  merged_lead_count bigint not null default 0,
  deleted_lead_count bigint not null default 0,
  processed_count bigint not null default 0,
  projected_count bigint not null default 0,
  business_row_checksum text not null,
  verified_business_row_checksum text,
  lease_token uuid,
  lease_generation bigint not null default 0,
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  last_error text,
  constraint external_lead_projection_backfill_status_check
    check (status in ('pending', 'running', 'complete', 'verified', 'failed')),
  constraint external_lead_projection_backfill_counts_check
    check (
      canonical_lead_count >= 0
      and merged_lead_count >= 0
      and deleted_lead_count >= 0
      and processed_count >= 0
      and projected_count >= 0
      and lease_generation >= 0
    )
);

create index external_lead_projection_backfill_claim_idx
  on private.external_lead_projection_backfill_runs (
    status,
    lease_expires_at,
    created_at
  );

alter table private.external_lead_projection_backfill_runs
  enable row level security;

revoke all on table private.external_lead_projection_backfill_runs
  from public, anon, authenticated, service_role;

create or replace function private.external_lead_projection_business_row_checksum(
  p_company_id uuid
) returns text
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  with protected_rows as (
    select
      'opportunity:' || opportunity.id::text as row_key,
      to_jsonb(opportunity) as row_value
    from public.opportunities opportunity
    where p_company_id is null
      or opportunity.company_id = p_company_id
    union all
    select
      'client:' || client.id::text,
      to_jsonb(client)
    from public.clients client
    where p_company_id is null
      or client.company_id = p_company_id
    union all
    select
      'sub_client:' || sub_client.id::text,
      to_jsonb(sub_client)
    from public.sub_clients sub_client
    where p_company_id is null
      or sub_client.company_id = p_company_id
    union all
    select
      'project:' || project.id::text,
      to_jsonb(project)
    from public.projects project
    where p_company_id is null
      or project.company_id = p_company_id
    union all
    select
      'invoice:' || invoice.id::text,
      to_jsonb(invoice)
    from public.invoices invoice
    where p_company_id is null
      or invoice.company_id = p_company_id
    union all
    select
      'payment:' || payment.id::text,
      to_jsonb(payment)
    from public.payments payment
    where p_company_id is null
      or payment.company_id = p_company_id
  )
  select md5(
    coalesce(
      string_agg(
        protected_rows.row_key || ':' ||
          md5(protected_rows.row_value::text),
        '|' order by protected_rows.row_key
      ),
      ''
    )
  )
  from protected_rows;
$function$;

create or replace function public.inspect_external_lead_projection_backfill_as_system(
  p_company_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  perform private.require_external_api_service_role();

  select jsonb_build_object(
    'company_id', p_company_id,
    'canonical_lead_count', count(*) filter (
      where opportunity.merged_into_opportunity_id is null
        and opportunity.deleted_at is null
    ),
    'merged_lead_count', count(*) filter (
      where opportunity.merged_into_opportunity_id is not null
    ),
    'deleted_lead_count', count(*) filter (
      where opportunity.deleted_at is not null
        and opportunity.merged_into_opportunity_id is null
    ),
    'missing_handle_count', count(*) filter (
      where handle.id is null
    ),
    'missing_baseline_count', count(*) filter (
      where baseline.handle_id is null
    ),
    'source_evidence_count', count(*) filter (
      where opportunity.source is not null
    ),
    'expected_write_count', count(*) filter (
      where baseline.handle_id is null
    ),
    'business_row_checksum',
      private.external_lead_projection_business_row_checksum(p_company_id),
    'current_checkpoint', (
      select to_jsonb(run)
      from private.external_lead_projection_backfill_runs run
      where run.company_id is not distinct from p_company_id
        and run.status in ('pending', 'running', 'complete')
      order by run.created_at desc
      limit 1
    )
  )
  into v_result
  from public.opportunities opportunity
  left join private.external_lead_handles handle
    on handle.company_id = opportunity.company_id
   and handle.opportunity_id = opportunity.id
  left join private.external_lead_projection_baselines baseline
    on baseline.company_id = handle.company_id
   and baseline.handle_id = handle.id
  where p_company_id is null
    or opportunity.company_id = p_company_id;

  return v_result;
end;
$function$;

create or replace function public.start_external_lead_projection_backfill_as_system(
  p_company_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_existing private.external_lead_projection_backfill_runs%rowtype;
  v_run private.external_lead_projection_backfill_runs%rowtype;
begin
  perform private.require_external_api_service_role();

  select run.*
  into v_existing
  from private.external_lead_projection_backfill_runs run
  where run.company_id is not distinct from p_company_id
    and run.status in ('pending', 'running', 'complete')
  order by run.created_at desc
  limit 1
  for update;

  if found then
    return to_jsonb(v_existing);
  end if;

  insert into private.external_lead_projection_backfill_runs (
    company_id,
    canonical_lead_count,
    merged_lead_count,
    deleted_lead_count,
    business_row_checksum
  )
  select
    p_company_id,
    count(*) filter (
      where opportunity.merged_into_opportunity_id is null
        and opportunity.deleted_at is null
    ),
    count(*) filter (
      where opportunity.merged_into_opportunity_id is not null
    ),
    count(*) filter (
      where opportunity.deleted_at is not null
        and opportunity.merged_into_opportunity_id is null
    ),
    private.external_lead_projection_business_row_checksum(p_company_id)
  from public.opportunities opportunity
  where p_company_id is null
    or opportunity.company_id = p_company_id
  returning * into v_run;

  return to_jsonb(v_run);
end;
$function$;

create or replace function public.claim_external_lead_projection_backfill_as_system(
  p_run_id uuid,
  p_lease_seconds integer default 60
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_run private.external_lead_projection_backfill_runs%rowtype;
begin
  perform private.require_external_api_service_role();
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'external_lead_projection_backfill_lease_invalid'
      using errcode = '22023';
  end if;

  select run.*
  into v_run
  from private.external_lead_projection_backfill_runs run
  where run.id = p_run_id
    and run.status in ('pending', 'running')
    and (
      run.lease_expires_at is null
      or run.lease_expires_at < clock_timestamp()
    )
  for update skip locked;

  if not found then
    raise exception 'external_lead_projection_backfill_not_claimable'
      using errcode = '55P03';
  end if;

  update private.external_lead_projection_backfill_runs run
  set status = 'running',
      started_at = coalesce(run.started_at, clock_timestamp()),
      lease_token = gen_random_uuid(),
      lease_generation = run.lease_generation + 1,
      lease_expires_at =
        clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_error = null
  where run.id = p_run_id
  returning * into v_run;

  return to_jsonb(v_run);
end;
$function$;

create or replace function public.process_external_lead_projection_backfill_as_system(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_generation bigint,
  p_batch_size integer default 100
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_run private.external_lead_projection_backfill_runs%rowtype;
  v_opportunity record;
  v_processed integer := 0;
  v_last_id uuid;
  v_has_more boolean;
begin
  perform private.require_external_api_service_role();
  if p_batch_size < 1 or p_batch_size > 500 then
    raise exception 'external_lead_projection_backfill_batch_invalid'
      using errcode = '22023';
  end if;

  select run.*
  into v_run
  from private.external_lead_projection_backfill_runs run
  where run.id = p_run_id
  for update;

  if not found
    or v_run.status <> 'running'
    or v_run.lease_token is distinct from p_lease_token
    or v_run.lease_generation <> p_lease_generation
    or v_run.lease_expires_at < clock_timestamp()
  then
    raise exception 'external_lead_projection_backfill_lease_lost'
      using errcode = '55P03';
  end if;

  for v_opportunity in
    select opportunity.company_id, opportunity.id
    from public.opportunities opportunity
    where (
        v_run.company_id is null
        or opportunity.company_id = v_run.company_id
      )
      and (
        v_run.checkpoint_opportunity_id is null
        or opportunity.id > v_run.checkpoint_opportunity_id
      )
    order by opportunity.id
    limit p_batch_size
  loop
    perform private.refresh_external_lead_projection_core(
      v_opportunity.company_id,
      v_opportunity.id,
      'backfill'
    );
    v_processed := v_processed + 1;
    v_last_id := v_opportunity.id;
  end loop;

  select exists (
    select 1
    from public.opportunities opportunity
    where (
        v_run.company_id is null
        or opportunity.company_id = v_run.company_id
      )
      and (
        coalesce(v_last_id, v_run.checkpoint_opportunity_id) is null
        or opportunity.id >
          coalesce(v_last_id, v_run.checkpoint_opportunity_id)
      )
  )
  into v_has_more;

  update private.external_lead_projection_backfill_runs run
  set checkpoint_opportunity_id =
        coalesce(v_last_id, run.checkpoint_opportunity_id),
      processed_count = run.processed_count + v_processed,
      projected_count = run.projected_count + v_processed,
      status = case when v_has_more then 'running' else 'complete' end,
      completed_at = case
        when v_has_more then null else clock_timestamp()
      end,
      lease_expires_at = case
        when v_has_more then clock_timestamp() + interval '60 seconds'
        else null
      end,
      lease_token = case when v_has_more then run.lease_token else null end
  where run.id = p_run_id
  returning * into v_run;

  return to_jsonb(v_run);
end;
$function$;

create or replace function public.verify_external_lead_projection_backfill_as_system(
  p_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_run private.external_lead_projection_backfill_runs%rowtype;
  v_checksum text;
  v_missing_handles bigint;
  v_missing_baselines bigint;
  v_sequence_failures bigint;
  v_tombstone_failures bigint;
begin
  perform private.require_external_api_service_role();

  select run.*
  into v_run
  from private.external_lead_projection_backfill_runs run
  where run.id = p_run_id
  for update;

  if not found or v_run.status not in ('complete', 'verified') then
    raise exception 'external_lead_projection_backfill_incomplete'
      using errcode = '55000';
  end if;

  select count(*)
  into v_missing_handles
  from public.opportunities opportunity
  left join private.external_lead_handles handle
    on handle.company_id = opportunity.company_id
   and handle.opportunity_id = opportunity.id
  where (
      v_run.company_id is null
      or opportunity.company_id = v_run.company_id
    )
    and handle.id is null;

  select count(*)
  into v_missing_baselines
  from private.external_lead_handles handle
  left join private.external_lead_projection_baselines baseline
    on baseline.company_id = handle.company_id
   and baseline.handle_id = handle.id
  where (
      v_run.company_id is null
      or handle.company_id = v_run.company_id
    )
    and baseline.handle_id is null;

  select count(*)
  into v_sequence_failures
  from (
    select
      state.company_id,
      state.high_water_sequence,
      count(version.id) as version_count,
      coalesce(min(version.change_sequence), 0) as minimum_sequence,
      coalesce(max(version.change_sequence), 0) as maximum_sequence
    from private.external_lead_projection_state state
    left join private.external_lead_projection_versions version
      on version.company_id = state.company_id
    where v_run.company_id is null
      or state.company_id = v_run.company_id
    group by state.company_id, state.high_water_sequence
  ) sequence_check
  where sequence_check.high_water_sequence <>
      sequence_check.maximum_sequence
    or (
      sequence_check.version_count > 0
      and sequence_check.minimum_sequence <> 1
    )
    or sequence_check.version_count <>
      sequence_check.high_water_sequence;

  select count(*)
  into v_tombstone_failures
  from public.opportunities opportunity
  join private.external_lead_handles handle
    on handle.company_id = opportunity.company_id
   and handle.opportunity_id = opportunity.id
  join private.external_lead_projection_baselines baseline
    on baseline.company_id = handle.company_id
   and baseline.handle_id = handle.id
  where (
      v_run.company_id is null
      or opportunity.company_id = v_run.company_id
    )
    and (
      (
        opportunity.deleted_at is not null
        and opportunity.merged_into_opportunity_id is null
        and (
          baseline.operation <> 'deletion'
          or baseline.public_projection ?& array[
            'operation', 'publicLeadId', 'deletedAt'
          ] is not true
          or jsonb_object_length(baseline.public_projection) <> 3
        )
      )
      or (
        opportunity.merged_into_opportunity_id is not null
        and (
          baseline.operation <> 'merge'
          or baseline.public_projection ->> 'recordState' <> 'merged'
          or baseline.public_projection ->> 'mergeTargetPublicLeadId' is null
        )
      )
    );

  v_checksum :=
    private.external_lead_projection_business_row_checksum(v_run.company_id);

  if v_missing_handles <> 0
    or v_missing_baselines <> 0
    or v_sequence_failures <> 0
    or v_tombstone_failures <> 0
    or v_checksum is distinct from v_run.business_row_checksum
  then
    raise exception 'external_lead_projection_backfill_verification_failed'
      using errcode = '55000',
        detail = jsonb_build_object(
          'missing_handles', v_missing_handles,
          'missing_baselines', v_missing_baselines,
          'sequence_failures', v_sequence_failures,
          'tombstone_failures', v_tombstone_failures,
          'business_rows_unchanged',
            v_checksum is not distinct from v_run.business_row_checksum
        )::text;
  end if;

  update private.external_lead_projection_backfill_runs run
  set status = 'verified',
      verified_business_row_checksum = v_checksum,
      verified_at = clock_timestamp()
  where run.id = p_run_id
  returning * into v_run;

  return jsonb_build_object(
    'run_id', v_run.id,
    'status', v_run.status,
    'stable_public_handle', true,
    'current_baseline_complete', true,
    'company_monotonic_sequence', true,
    'tombstones_valid', true,
    'business_rows_unchanged', true,
    'processed_count', v_run.processed_count,
    'verified_at', v_run.verified_at
  );
end;
$function$;

-- ACLs ---------------------------------------------------------------------

revoke all on function private.external_lead_projection_minute(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.external_lead_empty_dimension()
  from public, anon, authenticated, service_role;
revoke all on function private.external_lead_generic_source_projection(
  text, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function private.external_lead_projection_public_allowlist(
  jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function private.external_lead_project_id(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.build_external_lead_public_projection(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_external_lead_projection_core(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.refresh_external_lead_projection_trigger()
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_external_lead_projection_for_project()
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_external_lead_projection_for_invoice()
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_external_lead_projection_for_payment()
  from public, anon, authenticated, service_role;
revoke all on function
  private.external_lead_projection_business_row_checksum(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.refresh_external_lead_projection_as_system(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.refresh_external_lead_projection_as_system(
  uuid, uuid, text
) to service_role;

revoke all on function
  public.prune_external_lead_projection_versions_as_system(timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.prune_external_lead_projection_versions_as_system(timestamptz)
  to service_role;

revoke all on function public.inspect_external_lead_projection_backfill_as_system(uuid)
  from public, anon, authenticated;
grant execute on function public.inspect_external_lead_projection_backfill_as_system(uuid) to service_role;

revoke all on function public.start_external_lead_projection_backfill_as_system(uuid)
  from public, anon, authenticated;
grant execute on function public.start_external_lead_projection_backfill_as_system(uuid) to service_role;

revoke all on function public.claim_external_lead_projection_backfill_as_system(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_external_lead_projection_backfill_as_system(uuid, integer) to service_role;

revoke all on function public.process_external_lead_projection_backfill_as_system(
  uuid, uuid, bigint, integer
) from public, anon, authenticated;
grant execute on function public.process_external_lead_projection_backfill_as_system(
  uuid, uuid, bigint, integer
) to service_role;

revoke all on function public.verify_external_lead_projection_backfill_as_system(uuid)
  from public, anon, authenticated;
grant execute on function public.verify_external_lead_projection_backfill_as_system(uuid) to service_role;

comment on function private.build_external_lead_public_projection(uuid, uuid)
is 'Builds the version-1 privacy-safe lead projection from canonical evidence; raw attribution, PII, storage keys, mailbox data, and internal identifiers are excluded.';

comment on table private.external_lead_projection_backfill_runs
is 'Leased and resumable checkpoint state for the no-invention external lead projection backfill. Protected business rows are checksum-verified unchanged.';

commit;
