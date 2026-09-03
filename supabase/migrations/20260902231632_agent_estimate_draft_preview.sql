-- Inactive OPS MCP estimate-draft preview.
--
-- This migration extends the dormant additive authority bridge and exposes
-- one service-role-only, read-only source snapshot. It creates no estimate,
-- reserves no number, and cannot issue, approve, publish, send, or commit.

begin;

set local timezone = 'UTC';

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'public.clients',
    'public.companies',
    'public.estimates',
    'public.line_items',
    'public.opportunities',
    'public.projects',
    'public.tax_rates',
    'private.mcp_oauth_clients',
    'private.mcp_oauth_grants'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_estimate_draft_prerequisite_missing: %',
        v_relation using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.mcp_oauth_labels_for_scopes(text[],text)',
    'private.assert_agent_additive_exposure_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,text[],text[],boolean,text,text,text)',
    'private.assert_agent_recurring_service_price_change_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)',
    'extensions.digest(bytea,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_estimate_draft_prerequisite_missing: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

create or replace function private.mcp_oauth_labels_for_scopes(
  p_scopes text[],
  p_consent_catalog_revision text
) returns text[]
language sql
immutable
strict
set search_path = ''
as $function$
  with labelled as materialized (
    select requested.ordinal,
           case requested.scope
             when 'ops.jobs.read' then 'See your jobs and their status'
             when 'ops.schedule.read' then
               'See your schedule and who''s assigned'
             when 'ops.customers.read' then 'See your clients and their jobs'
             when 'ops.customer_contacts.read' then
               'See who to contact on a job and how to reach them'
             when 'ops.photos.read' then 'See which jobs are missing photos'
             when 'ops.correspondence.read' then
               'See client email history on your jobs'
             when 'ops.financials.read' then
               'See estimate and invoice summaries on your jobs'
             when 'ops.tasks.read' then
               'See tasks and work that needs attention'
             when 'ops.site_visits.read' then
               'See site visits and their evidence status'
             when 'ops.files.read' then
               'See authorized job photos, files, and documents'
             when 'ops.financial_documents.read' then
               'See estimates and invoices in detail'
             when 'ops.payments.read' then
               'See payment records on authorized invoices'
             when 'ops.expenses.read' then
               'See authorized expenses and reimbursements'
             when 'ops.catalog.read' then
               'See products, stock levels, and selling prices'
             when 'ops.purchasing.read' then 'See purchase orders'
             when 'ops.catalog_costs.read' then
               'See authorized supplier cost facts'
             when 'ops.company.read' then
               'See the company operating profile'
             when 'ops.team.read' then
               'See the team directory and company availability'
             when 'ops.integrations.read' then
               'See integration health without credentials'
             when 'ops.operations.read' then
               'See authorized work queues and operational summaries'
             when 'ops.financials.prepare' then case
               when p_consent_catalog_revision =
                 '2026-09-02.mcp-consent-catalog.v5'
                 then 'Prepare exact draft estimates from authorized past jobs'
             end
             when 'ops.operations.prepare' then case
               when p_consent_catalog_revision =
                 '2026-08-30.mcp-consent-catalog.v2'
                 then 'Prepare end-of-day closeouts and exact OPS filing previews'
               when p_consent_catalog_revision =
                 '2026-08-31.mcp-consent-catalog.v3'
                 then 'Prepare collections aging and customer drafts for approval'
               when p_consent_catalog_revision in (
                 '2026-09-01.mcp-consent-catalog.v4',
                 '2026-09-02.mcp-consent-catalog.v5'
               ) then 'Prepare recurring-service price-change previews and customer notice drafts'
             end
           end as label
    from pg_catalog.unnest(p_scopes) with ordinality
      as requested(scope, ordinal)
  )
  select case
    when p_consent_catalog_revision not in (
           '2026-08-22.mcp-consent-catalog.v1',
           '2026-08-30.mcp-consent-catalog.v2',
           '2026-08-31.mcp-consent-catalog.v3',
           '2026-09-01.mcp-consent-catalog.v4',
           '2026-09-02.mcp-consent-catalog.v5'
         )
      or pg_catalog.cardinality(p_scopes) not between 1 and 32
      or exists (
        select 1 from pg_catalog.unnest(p_scopes) scope(value)
        where scope.value is distinct from pg_catalog.btrim(scope.value)
           or nullif(scope.value, '') is null
           or pg_catalog.length(scope.value) > 128
      )
      or pg_catalog.cardinality(array(
           select distinct scope.value
           from pg_catalog.unnest(p_scopes) scope(value)
         )) <> pg_catalog.cardinality(p_scopes)
      or exists (select 1 from labelled where label is null)
      then null::text[]
    else array(
      select labelled.label from labelled order by labelled.ordinal
    )
  end
$function$;

revoke all on function private.mcp_oauth_labels_for_scopes(text[], text)
  from public, anon, authenticated, service_role;

create or replace function private.assert_agent_additive_exposure_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_historical_manifest_revision text,
  p_historical_exposure_revision text,
  p_required_permissions text[],
  p_required_scopes text[],
  p_require_accepted_labels boolean,
  p_binding_error text,
  p_authority_error text,
  p_grant_error text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_permission_snapshot_revision text;
  v_required_permissions jsonb;
  v_is_v9 boolean :=
    p_capability_manifest_revision is not distinct from
      '2026-09-01.capability-manifest.v15'
    and p_exposure_revision is not distinct from
      '2026-09-01.mcp-exposure.v9';
  v_is_v10 boolean :=
    p_capability_manifest_revision is not distinct from
      '2026-09-02.capability-manifest.v16'
    and p_exposure_revision is not distinct from
      '2026-09-02.mcp-exposure.v10';
  v_v9_exposure_scope_ceiling constant text[] := array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.expenses.read',
    'ops.financial_documents.read', 'ops.financials.read', 'ops.jobs.read',
    'ops.operations.prepare', 'ops.operations.read', 'ops.payments.read',
    'ops.schedule.read', 'ops.site_visits.read', 'ops.tasks.read',
    'ops.team.read'
  ];
  v_v10_exposure_scope_ceiling constant text[] := array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.expenses.read',
    'ops.financial_documents.read', 'ops.financials.prepare',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.read',
    'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or nullif(pg_catalog.btrim(p_grant_revision), '') is null
     or p_granted_scope_ceiling is null
     or nullif(pg_catalog.btrim(p_permission_snapshot_revision), '') is null
     or p_required_permissions is null
     or p_required_scopes is null
     or p_require_accepted_labels is null
     or not (
       (
         p_capability_manifest_revision is not distinct from
           p_historical_manifest_revision
         and p_exposure_revision is not distinct from
           p_historical_exposure_revision
       ) or v_is_v9 or v_is_v10
     ) then
    raise exception '%', p_binding_error using errcode = '42501';
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'permission', required.permission,
               'scope', 'all'
             ) order by required.permission
           ),
           '[]'::jsonb
         )
    into v_required_permissions
  from pg_catalog.unnest(p_required_permissions) required(permission);

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    p_required_permissions
  ) authority
  where authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null
     or v_permission_snapshot_revision is distinct from
       p_permission_snapshot_revision then
    raise exception '%', p_authority_error using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and grant_record.scopes <@ client_record.scope_ceiling
     and grant_record.consent_catalog_revision =
       client_record.consent_catalog_revision
     and grant_record.exposure_revision = client_record.exposure_revision
     and (
       not (v_is_v9 or v_is_v10)
       or (
         client_record.scope_ceiling = case
           when v_is_v10 then v_v10_exposure_scope_ceiling
           else v_v9_exposure_scope_ceiling
         end
         and client_record.scope = pg_catalog.array_to_string(
           case when v_is_v10 then v_v10_exposure_scope_ceiling
                else v_v9_exposure_scope_ceiling end,
           ' '
         )
       )
     )
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = p_granted_scope_ceiling
      and grant_record.revoked_at is null
      and grant_record.exposure_revision = p_exposure_revision
      and (
        not (v_is_v9 or v_is_v10 or p_require_accepted_labels)
        or grant_record.accepted_labels =
          private.mcp_oauth_labels_for_scopes(
            grant_record.scopes,
            grant_record.consent_catalog_revision
          )
      )
      and (
        not v_is_v9
        or grant_record.consent_catalog_revision =
          '2026-09-01.mcp-consent-catalog.v4'
      )
      and (
        not v_is_v10
        or grant_record.consent_catalog_revision =
          '2026-09-02.mcp-consent-catalog.v5'
      )
      and p_required_scopes <@ grant_record.scopes
  ) then
    raise exception '%', p_grant_error using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_additive_exposure_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  text[], text[], boolean, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.assert_agent_recurring_service_price_change_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_required_scopes constant text[] := array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read',
    'ops.financial_documents.read', 'ops.operations.prepare',
    'ops.schedule.read'
  ];
begin
  if p_capability_id is distinct from
       'prepare_recurring_service_price_change'
     or p_capability_revision is distinct from
       'prepare_recurring_service_price_change:2026-09-01.v1'
     or (
       p_capability_manifest_revision =
         '2026-09-01.capability-manifest.v15'
       and p_granted_scope_ceiling is distinct from v_required_scopes
     ) then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_BINDING_INVALID'
      using errcode = '42501';
  end if;

  return private.assert_agent_additive_exposure_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision,
    '2026-09-01.capability-manifest.v15',
    '2026-09-01.mcp-exposure.v9',
    array[
      'calendar.view', 'catalog.products.view', 'catalog.view',
      'clients.view', 'email.view', 'estimates.view', 'invoices.view',
      'settings.company'
    ],
    v_required_scopes,
    true,
    'AGENT_RECURRING_SERVICE_PRICE_CHANGE_BINDING_INVALID',
    'AGENT_RECURRING_SERVICE_PRICE_CHANGE_AUTHORITY_STALE_OR_DENIED',
    'AGENT_RECURRING_SERVICE_PRICE_CHANGE_GRANT_STALE_OR_DENIED'
  );
end;
$function$;

revoke all on function private.assert_agent_recurring_service_price_change_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.assert_agent_estimate_draft_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_required_scopes constant text[] := array[
    'ops.company.read', 'ops.customers.read',
    'ops.financial_documents.read', 'ops.financials.prepare',
    'ops.jobs.read'
  ];
begin
  if p_capability_manifest_revision is distinct from
       '2026-09-02.capability-manifest.v16'
     or p_exposure_revision is distinct from
       '2026-09-02.mcp-exposure.v10'
     or p_capability_id is distinct from
       'prepare_estimate_from_past_job'
     or p_capability_revision is distinct from
       'prepare_estimate_from_past_job:2026-09-02.v1' then
    raise exception 'AGENT_ESTIMATE_DRAFT_BINDING_INVALID'
      using errcode = '42501';
  end if;

  return private.assert_agent_additive_exposure_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision,
    '2026-09-02.capability-manifest.v16',
    '2026-09-02.mcp-exposure.v10',
    array[
      'clients.view', 'estimates.create', 'estimates.view', 'pipeline.view',
      'projects.view', 'settings.company'
    ],
    v_required_scopes,
    true,
    'AGENT_ESTIMATE_DRAFT_BINDING_INVALID',
    'AGENT_ESTIMATE_DRAFT_AUTHORITY_STALE_OR_DENIED',
    'AGENT_ESTIMATE_DRAFT_GRANT_STALE_OR_DENIED'
  );
end;
$function$;

revoke all on function private.assert_agent_estimate_draft_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.build_agent_estimate_draft_snapshot(
  p_company_id uuid,
  p_target_opportunity_id uuid,
  p_source_estimate_id uuid,
  p_observed_at timestamptz,
  p_line_item_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_company public.companies%rowtype;
  v_target public.opportunities%rowtype;
  v_target_client public.clients%rowtype;
  v_estimate public.estimates%rowtype;
  v_source_project public.projects%rowtype;
  v_source_client public.clients%rowtype;
  v_tax_rate public.tax_rates%rowtype;
  v_tax_rate_count integer;
  v_line_count integer;
  v_has_selected_taxable boolean;
  v_context jsonb;
  v_target_json jsonb;
  v_source_json jsonb;
  v_tax_json jsonb;
  v_lines jsonb;
  v_identity jsonb;
  v_result jsonb;
  v_source_revision text;
begin
  if p_company_id is null
     or p_target_opportunity_id is null
     or p_source_estimate_id is null
     or p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_observed_at < pg_catalog.statement_timestamp() - interval '5 minutes'
     or p_observed_at > pg_catalog.statement_timestamp() + interval '5 minutes'
     or p_line_item_limit is distinct from 101 then
    raise exception 'AGENT_ESTIMATE_DRAFT_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select * into v_company
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;
  if not found
     or v_company.name is distinct from pg_catalog.btrim(v_company.name)
     or pg_catalog.length(v_company.name) not between 1 and 240
     or v_company.timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_company.timezone
     )
     or pg_catalog.upper(pg_catalog.btrim(v_company.currency_code)) !~
       '^[A-Z]{3}$' then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  select * into v_target
  from public.opportunities opportunity
  where opportunity.id = p_target_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
    and opportunity.merged_into_opportunity_id is null
    and opportunity.archived_at is null
    and opportunity.client_id is not null
    and opportunity.stage in (
      'new_lead', 'qualifying', 'quoting', 'quoted', 'negotiation', 'follow_up'
    );
  if not found
     or v_target.title is distinct from pg_catalog.btrim(v_target.title)
     or pg_catalog.length(v_target.title) not between 1 and 240
     or (
       v_target.client_ref is not null
       and v_target.client_ref is distinct from v_target.client_id::text
     ) then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  select * into v_target_client
  from public.clients client
  where client.id = v_target.client_id
    and client.company_id = p_company_id
    and client.deleted_at is null
    and client.merged_into_client_id is null;
  if not found
     or v_target_client.name is distinct from
       pg_catalog.btrim(v_target_client.name)
     or pg_catalog.length(v_target_client.name) not between 1 and 240 then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  select * into v_estimate
  from public.estimates estimate
  where estimate.id = p_source_estimate_id
    and estimate.company_id = p_company_id
    and estimate.deleted_at is null
    and estimate.status in ('approved', 'converted')
    and estimate.project_id is not null;
  if not found
     or v_estimate.title is null
     or v_estimate.title is distinct from pg_catalog.btrim(v_estimate.title)
     or pg_catalog.length(v_estimate.title) not between 1 and 240
     or v_estimate.estimate_number is distinct from
       pg_catalog.btrim(v_estimate.estimate_number)
     or pg_catalog.length(v_estimate.estimate_number) not between 1 and 100
     or v_estimate.discount_type is not null
     or v_estimate.discount_value is not null
     or v_estimate.subtotal < 0
     or v_estimate.discount_amount < 0
     or v_estimate.tax_amount < 0
     or v_estimate.total < 0
     or (
       v_estimate.client_ref is not null
       and v_estimate.client_ref is distinct from v_estimate.client_id::text
     )
     or (
       v_estimate.project_ref is not null
       and v_estimate.project_ref is distinct from v_estimate.project_id::text
     )
     or not (
       (
         v_estimate.deposit_type is null
         and v_estimate.deposit_value is null
         and v_estimate.deposit_amount is null
       ) or (
         v_estimate.deposit_type in ('fixed', 'percentage')
         and v_estimate.deposit_value is not null
         and v_estimate.deposit_value >= 0
         and v_estimate.deposit_amount is not null
         and v_estimate.deposit_amount >= 0
         and (
           v_estimate.deposit_type = 'fixed'
           or v_estimate.deposit_value <= 100
         )
       )
     ) then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  select * into v_source_project
  from public.projects project
  where project.id = v_estimate.project_id
    and project.company_id = p_company_id
    and project.client_id = v_estimate.client_id
    and project.deleted_at is null
    and project.status in ('completed', 'closed')
    and project.completed_at is not null;
  if not found
     or v_source_project.title is distinct from
       pg_catalog.btrim(v_source_project.title)
     or pg_catalog.length(v_source_project.title) not between 1 and 240 then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  select * into v_source_client
  from public.clients client
  where client.id = v_estimate.client_id
    and client.company_id = p_company_id
    and client.deleted_at is null
    and client.merged_into_client_id is null;
  if not found
     or v_source_client.name is distinct from
       pg_catalog.btrim(v_source_client.name)
     or pg_catalog.length(v_source_client.name) not between 1 and 240 then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  select count(*)::integer into v_tax_rate_count
  from (
    select tax_rate.id
    from public.tax_rates tax_rate
    where tax_rate.company_id = p_company_id
      and tax_rate.is_active is true
      and tax_rate.is_default is true
    limit 2
  ) bounded_tax_rates;
  if v_tax_rate_count > 1 then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;
  if v_tax_rate_count = 1 then
    select * into v_tax_rate
    from public.tax_rates tax_rate
    where tax_rate.company_id = p_company_id
      and tax_rate.is_active is true
      and tax_rate.is_default is true;
    if v_tax_rate.name is distinct from pg_catalog.btrim(v_tax_rate.name)
       or pg_catalog.length(v_tax_rate.name) not between 1 and 240
       or v_tax_rate.rate < 0
       or v_tax_rate.rate > 1 then
      raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
        using errcode = '55000';
    end if;
  end if;

  if exists (
    select 1
    from public.line_items line_item
    where line_item.estimate_id = p_source_estimate_id
      and (
        line_item.company_id is distinct from p_company_id
        or line_item.invoice_id is not null
        or line_item.name is distinct from pg_catalog.btrim(line_item.name)
        or pg_catalog.length(line_item.name) not between 1 and 240
        or (
          line_item.description is not null
          and (
            line_item.description is distinct from
              pg_catalog.btrim(line_item.description)
            or pg_catalog.length(line_item.description) not between 1 and 4000
          )
        )
        or line_item.quantity <= 0
        or line_item.unit_price < 0
        or coalesce(line_item.discount_percent, 0) not between 0 and 100
        or (
          line_item.minimum_charge_snapshot is not null
          and line_item.minimum_charge_snapshot < 0
        )
        or line_item.is_taxable is null
        or line_item.is_optional is null
        or line_item.is_selected is null
        or line_item.line_total is null
        or line_item.line_total < 0
        or line_item.sort_order not between 0 and 10000
        or (
          line_item.unit is not null
          and (
            line_item.unit is distinct from pg_catalog.btrim(line_item.unit)
            or pg_catalog.length(line_item.unit) not between 1 and 80
          )
        )
        or (
          line_item.category is not null
          and (
            line_item.category is distinct from
              pg_catalog.btrim(line_item.category)
            or pg_catalog.length(line_item.category) not between 1 and 120
          )
        )
        or line_item.type is distinct from pg_catalog.btrim(line_item.type)
        or pg_catalog.length(line_item.type) not between 1 and 80
        or (
          line_item.resolved_options_label is not null
          and (
            line_item.resolved_options_label is distinct from
              pg_catalog.btrim(line_item.resolved_options_label)
            or pg_catalog.length(line_item.resolved_options_label)
              not between 1 and 1000
          )
        )
        or (
          line_item.parent_line_item_id is not null
          and not exists (
            select 1
            from public.line_items parent_line
            where parent_line.id = line_item.parent_line_item_id
              and parent_line.estimate_id = p_source_estimate_id
              and parent_line.company_id = p_company_id
          )
        )
      )
  ) or exists (
    select 1
    from public.line_items line_item
    where line_item.estimate_id = p_source_estimate_id
      and line_item.company_id = p_company_id
    group by line_item.sort_order
    having count(*) > 1
  ) then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  with bounded_lines as materialized (
    select line_item.*
    from public.line_items line_item
    where line_item.estimate_id = p_source_estimate_id
      and line_item.company_id = p_company_id
    order by line_item.sort_order, line_item.id
    limit p_line_item_limit
  ), line_payloads as materialized (
    select line_item.sort_order,
           pg_catalog.jsonb_build_object(
             'line_item_id', line_item.id,
             'parent_line_item_id', line_item.parent_line_item_id,
             'product_id', line_item.product_id,
             'task_type_ref', line_item.task_type_ref,
             'unit_id', line_item.unit_id,
             'name', line_item.name,
             'description', line_item.description,
             'quantity', pg_catalog.trim_scale(line_item.quantity)::text,
             'unit', line_item.unit,
             'unit_price', pg_catalog.trim_scale(line_item.unit_price)::text,
             'discount_percent',
               pg_catalog.trim_scale(coalesce(line_item.discount_percent, 0))::text,
             'minimum_charge', case
               when line_item.minimum_charge_snapshot is null then null
               else pg_catalog.trim_scale(
                 line_item.minimum_charge_snapshot
               )::text
             end,
             'is_taxable', line_item.is_taxable,
             'is_optional', line_item.is_optional,
             'is_selected', line_item.is_selected,
             'sort_order', line_item.sort_order,
             'category', line_item.category,
             'type', line_item.type,
             'resolved_options_label', line_item.resolved_options_label,
             'source_line_total',
               pg_catalog.trim_scale(line_item.line_total)::text
           ) as payload
    from bounded_lines line_item
  )
  select count(*)::integer,
         coalesce(
           pg_catalog.jsonb_agg(
             payload || pg_catalog.jsonb_build_object(
               'source_sha256', pg_catalog.encode(
                 extensions.digest(
                   pg_catalog.convert_to(payload::text, 'UTF8'),
                   'sha256'
                 ),
                 'hex'
               )
             ) order by sort_order, payload->>'line_item_id'
           ),
           '[]'::jsonb
         )
    into v_line_count, v_lines
  from line_payloads;

  if v_line_count = 0 then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;
  if v_line_count >= p_line_item_limit then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_BOUND'
      using errcode = '54000';
  end if;

  select exists (
    select 1
    from public.line_items line_item
    where line_item.estimate_id = p_source_estimate_id
      and line_item.company_id = p_company_id
      and line_item.is_taxable is true
      and (line_item.is_optional is false or line_item.is_selected is true)
  ) into v_has_selected_taxable;
  if v_has_selected_taxable
     and (
       v_tax_rate_count <> 1
       or v_estimate.tax_rate is null
       or v_estimate.tax_rate < 0
       or v_estimate.tax_rate > 1
     ) then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;
  if v_estimate.tax_rate is not null
     and (v_estimate.tax_rate < 0 or v_estimate.tax_rate > 1) then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  v_context := pg_catalog.jsonb_build_object(
    'company_id', v_company.id,
    'company_name', v_company.name,
    'timezone', v_company.timezone,
    'currency_code', pg_catalog.upper(pg_catalog.btrim(v_company.currency_code)),
    'currency_minor_exponent', 2,
    'source_sha256', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(pg_catalog.jsonb_build_object(
          'id', v_company.id, 'name', v_company.name,
          'timezone', v_company.timezone,
          'currency_code', v_company.currency_code,
          'updated_at', v_company.updated_at
        )::text, 'UTF8'), 'sha256'
      ), 'hex'
    )
  );
  v_target_json := pg_catalog.jsonb_build_object(
    'opportunity_id', v_target.id,
    'title', v_target.title,
    'stage', v_target.stage,
    'client_id', v_target_client.id,
    'client_name', v_target_client.name,
    'source_sha256', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(pg_catalog.jsonb_build_object(
          'id', v_target.id, 'title', v_target.title,
          'stage', v_target.stage, 'client_id', v_target.client_id,
          'opportunity_updated_at', v_target.updated_at,
          'client_name', v_target_client.name,
          'client_updated_at', v_target_client.updated_at
        )::text, 'UTF8'), 'sha256'
      ), 'hex'
    )
  );
  v_source_json := pg_catalog.jsonb_build_object(
    'estimate_id', v_estimate.id,
    'estimate_number', v_estimate.estimate_number,
    'title', v_estimate.title,
    'status', v_estimate.status,
    'client_id', v_source_client.id,
    'client_name', v_source_client.name,
    'project_id', v_source_project.id,
    'project_title', v_source_project.title,
    'project_status', v_source_project.status,
    'completed_at', pg_catalog.to_char(
      v_source_project.completed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'subtotal', pg_catalog.trim_scale(v_estimate.subtotal)::text,
    'discount_type', v_estimate.discount_type,
    'discount_value', case when v_estimate.discount_value is null then null
      else pg_catalog.trim_scale(v_estimate.discount_value)::text end,
    'discount_amount',
      pg_catalog.trim_scale(v_estimate.discount_amount)::text,
    'tax_rate', case when v_estimate.tax_rate is null then null
      else pg_catalog.trim_scale(v_estimate.tax_rate)::text end,
    'tax_amount', pg_catalog.trim_scale(v_estimate.tax_amount)::text,
    'total', pg_catalog.trim_scale(v_estimate.total)::text,
    'deposit_type', v_estimate.deposit_type,
    'deposit_value', case when v_estimate.deposit_value is null then null
      else pg_catalog.trim_scale(v_estimate.deposit_value)::text end,
    'deposit_amount', case when v_estimate.deposit_amount is null then null
      else pg_catalog.trim_scale(v_estimate.deposit_amount)::text end
  );
  v_source_json := v_source_json || pg_catalog.jsonb_build_object(
    'source_sha256', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to((v_source_json || pg_catalog.jsonb_build_object(
          'estimate_updated_at', v_estimate.updated_at,
          'project_updated_at', v_source_project.updated_at,
          'client_updated_at', v_source_client.updated_at
        ))::text, 'UTF8'), 'sha256'
      ), 'hex'
    )
  );
  if v_tax_rate_count = 1 then
    v_tax_json := pg_catalog.jsonb_build_object(
      'tax_rate_id', v_tax_rate.id,
      'name', v_tax_rate.name,
      'rate', pg_catalog.trim_scale(v_tax_rate.rate)::text,
      'source_sha256', pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(pg_catalog.jsonb_build_object(
            'id', v_tax_rate.id, 'name', v_tax_rate.name,
            'rate', v_tax_rate.rate, 'is_active', v_tax_rate.is_active,
            'is_default', v_tax_rate.is_default,
            'created_at', v_tax_rate.created_at
          )::text, 'UTF8'), 'sha256'
        ), 'hex'
      )
    );
  else
    v_tax_json := null;
  end if;

  v_identity := pg_catalog.jsonb_build_object(
    'context', v_context,
    'target', v_target_json,
    'source', v_source_json,
    'default_tax_rate', v_tax_json,
    'default_tax_rate_count', v_tax_rate_count,
    'line_items', v_lines
  );
  v_source_revision := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_identity::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_result := v_identity || pg_catalog.jsonb_build_object(
    'observed_at', pg_catalog.to_char(
      p_observed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'source_revision', v_source_revision
  );
  if pg_catalog.octet_length(
       pg_catalog.convert_to(v_result::text, 'UTF8')
     ) > 1000000 then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_BOUND'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.build_agent_estimate_draft_snapshot(
  uuid, uuid, uuid, timestamptz, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_estimate_draft_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_observed_at timestamptz,
  p_target_opportunity_id uuid,
  p_source_estimate_id uuid,
  p_line_item_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.assert_agent_estimate_draft_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision, p_capability_id, p_capability_revision
  );
  return private.build_agent_estimate_draft_snapshot(
    p_company_id, p_target_opportunity_id, p_source_estimate_id,
    p_observed_at, p_line_item_limit
  );
exception
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range then
    raise exception 'AGENT_ESTIMATE_DRAFT_INPUT_INVALID'
      using errcode = '22023';
end;
$function$;

revoke all on function public.read_agent_estimate_draft_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function public.read_agent_estimate_draft_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, uuid, uuid, integer
) to service_role;

create or replace function public.assert_agent_estimate_draft_authority_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_target_opportunity_id uuid,
  p_source_estimate_id uuid,
  p_expected_source_revision text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_permission_snapshot_revision text;
  v_snapshot jsonb;
begin
  if p_expected_source_revision is null
     or p_expected_source_revision !~ '^[0-9a-f]{64}$' then
    raise exception 'AGENT_ESTIMATE_DRAFT_INPUT_INVALID'
      using errcode = '22023';
  end if;
  v_permission_snapshot_revision :=
    private.assert_agent_estimate_draft_authority(
      p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
      p_grant_revision, p_granted_scope_ceiling,
      p_permission_snapshot_revision, p_capability_manifest_revision,
      p_exposure_revision, p_capability_id, p_capability_revision
    );
  v_snapshot := private.build_agent_estimate_draft_snapshot(
    p_company_id, p_target_opportunity_id, p_source_estimate_id,
    pg_catalog.statement_timestamp(), 101
  );
  if v_snapshot->>'source_revision' is distinct from
       p_expected_source_revision then
    raise exception 'AGENT_ESTIMATE_DRAFT_SOURCE_STALE'
      using errcode = '55000';
  end if;
  return pg_catalog.jsonb_build_object(
    'permission_snapshot_revision', v_permission_snapshot_revision,
    'source_revision', v_snapshot->>'source_revision'
  );
end;
$function$;

revoke all on function public.assert_agent_estimate_draft_authority_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.assert_agent_estimate_draft_authority_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  uuid, uuid, text
) to service_role;

create or replace function private.assert_agent_estimate_draft_catalog()
returns void
language plpgsql
stable
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'private.assert_agent_additive_exposure_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,text[],text[],boolean,text,text,text)'::regprocedure,
      'private.assert_agent_recurring_service_price_change_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.assert_agent_estimate_draft_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.build_agent_estimate_draft_snapshot(uuid,uuid,uuid,timestamp with time zone,integer)'::regprocedure,
      'public.read_agent_estimate_draft_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,uuid,uuid,integer)'::regprocedure,
      'public.assert_agent_estimate_draft_authority_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,uuid,uuid,text)'::regprocedure
    ) and (
      procedure.provolatile <> 's'
      or not procedure.prosecdef
      or procedure.proconfig is distinct from array['search_path=""']::text[]
    )
  ) then
    raise exception 'AGENT_ESTIMATE_DRAFT_FUNCTION_SHAPE_INVALID'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) access
    where procedure.oid in (
      'private.assert_agent_additive_exposure_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,text[],text[],boolean,text,text,text)'::regprocedure,
      'private.assert_agent_recurring_service_price_change_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.assert_agent_estimate_draft_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.build_agent_estimate_draft_snapshot(uuid,uuid,uuid,timestamp with time zone,integer)'::regprocedure,
      'private.mcp_oauth_labels_for_scopes(text[],text)'::regprocedure,
      'private.assert_agent_estimate_draft_catalog()'::regprocedure
    )
      and access.privilege_type = 'EXECUTE'
      and access.grantee <> procedure.proowner
  ) or exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) access
    where procedure.oid in (
      'public.read_agent_estimate_draft_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,uuid,uuid,integer)'::regprocedure,
      'public.assert_agent_estimate_draft_authority_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,uuid,uuid,text)'::regprocedure
    )
      and access.privilege_type = 'EXECUTE'
      and access.grantee <> procedure.proowner
      and access.grantee is distinct from 'service_role'::regrole::oid
  ) then
    raise exception 'AGENT_ESTIMATE_DRAFT_FUNCTION_ACL_INVALID'
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_agent_estimate_draft_catalog()
  from public, anon, authenticated, service_role;

select private.assert_agent_estimate_draft_catalog();

commit;
