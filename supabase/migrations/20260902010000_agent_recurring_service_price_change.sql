-- Inactive OPS MCP recurring-service price-change preview.
--
-- This migration adds one private, explicit policy source plus a bounded read
-- RPC. The RPC prepares no durable state and cannot send correspondence,
-- change a price or contract, issue an invoice, or alter service delivery.

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
    'public.invoices',
    'public.line_items',
    'public.projects',
    'public.sub_clients',
    'public.task_recurrence_exceptions',
    'public.task_recurrences',
    'public.task_types',
    'public.tax_rates',
    'public.users',
    'private.agent_provider_delivery_sources',
    'private.mcp_oauth_clients',
    'private.mcp_oauth_grants'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_recurring_service_price_change_prerequisite_missing: %',
        v_relation using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.mcp_oauth_labels_for_scopes(text[],text)',
    'private.agent_prompt_text_is_safe(text,boolean)',
    'private.assert_agent_hiring_what_if_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text)',
    'private.assert_agent_promise_recovery_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)',
    'private.assert_agent_sales_truth_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)',
    'private.assert_agent_payroll_readiness_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)',
    'extensions.digest(bytea,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_recurring_service_price_change_prerequisite_missing: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

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
  v_v9_exposure_scope_ceiling constant text[] := array[
    'ops.catalog.read',
    'ops.company.read',
    'ops.correspondence.read',
    'ops.customer_contacts.read',
    'ops.customers.read',
    'ops.expenses.read',
    'ops.financial_documents.read',
    'ops.financials.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.payments.read',
    'ops.schedule.read',
    'ops.site_visits.read',
    'ops.tasks.read',
    'ops.team.read'
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
       )
       or (
         p_capability_manifest_revision is not distinct from
           '2026-09-01.capability-manifest.v15'
         and p_exposure_revision is not distinct from
           '2026-09-01.mcp-exposure.v9'
       )
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
       not v_is_v9
       or (
         client_record.scope_ceiling = v_v9_exposure_scope_ceiling
         and client_record.scope = pg_catalog.array_to_string(
           v_v9_exposure_scope_ceiling,
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
        not (v_is_v9 or p_require_accepted_labels)
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

create or replace function private.assert_agent_hiring_what_if_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text
) returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select private.assert_agent_additive_exposure_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision,
    '2026-08-31.capability-manifest.v11',
    '2026-08-31.mcp-exposure.v5',
    array[
      'calendar.view', 'expenses.view', 'invoices.view', 'projects.view',
      'projects.view_financials', 'reports.view', 'settings.company',
      'tasks.view', 'team.view'
    ],
    array[
      'ops.company.read', 'ops.expenses.read',
      'ops.financial_documents.read', 'ops.financials.read', 'ops.jobs.read',
      'ops.payments.read', 'ops.schedule.read', 'ops.site_visits.read',
      'ops.tasks.read', 'ops.team.read'
    ],
    true,
    'AGENT_HIRING_WHAT_IF_REVISION_INVALID',
    'AGENT_HIRING_WHAT_IF_AUTHORITY_STALE_OR_DENIED',
    'AGENT_HIRING_WHAT_IF_GRANT_STALE_OR_DENIED'
  )
$function$;

revoke all on function private.assert_agent_hiring_what_if_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.assert_agent_promise_recovery_authority(
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
begin
  if p_capability_id is distinct from 'check_customer_reply'
     or p_capability_revision is distinct from
       'check_customer_reply:2026-08-31.v1' then
    raise exception 'AGENT_PROMISE_RECOVERY_BINDING_INVALID'
      using errcode = '42501';
  end if;
  return private.assert_agent_additive_exposure_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision,
    '2026-09-01.capability-manifest.v12',
    '2026-09-01.mcp-exposure.v6',
    array['clients.view', 'email.view'],
    array[
      'ops.correspondence.read', 'ops.customer_contacts.read',
      'ops.customers.read'
    ],
    false,
    'AGENT_PROMISE_RECOVERY_BINDING_INVALID',
    'AGENT_PROMISE_RECOVERY_AUTHORITY_STALE_OR_DENIED',
    'AGENT_PROMISE_RECOVERY_GRANT_STALE_OR_DENIED'
  );
end;
$function$;

revoke all on function private.assert_agent_promise_recovery_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.assert_agent_sales_truth_authority(
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
begin
  if p_capability_id is distinct from 'analyze_sales_truth'
     or p_capability_revision is distinct from
       'analyze_sales_truth:2026-09-01.v1' then
    raise exception 'AGENT_SALES_TRUTH_BINDING_INVALID'
      using errcode = '42501';
  end if;
  return private.assert_agent_additive_exposure_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision,
    '2026-09-01.capability-manifest.v13',
    '2026-09-01.mcp-exposure.v7',
    array['email.view', 'pipeline.view'],
    array['ops.correspondence.read', 'ops.operations.read'],
    false,
    'AGENT_SALES_TRUTH_BINDING_INVALID',
    'AGENT_SALES_TRUTH_AUTHORITY_STALE_OR_DENIED',
    'AGENT_SALES_TRUTH_GRANT_STALE_OR_DENIED'
  );
end;
$function$;

revoke all on function private.assert_agent_sales_truth_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.assert_agent_payroll_readiness_authority(
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
begin
  if p_capability_id is distinct from 'check_payroll_readiness'
     or p_capability_revision is distinct from
       'check_payroll_readiness:2026-09-01.v1' then
    raise exception 'AGENT_PAYROLL_READINESS_BINDING_INVALID'
      using errcode = '42501';
  end if;
  return private.assert_agent_additive_exposure_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision,
    '2026-09-01.capability-manifest.v14',
    '2026-09-01.mcp-exposure.v8',
    array[
      'expenses.view', 'invoices.view', 'reports.view', 'settings.company'
    ],
    array[
      'ops.company.read', 'ops.expenses.read',
      'ops.financial_documents.read', 'ops.financials.read',
      'ops.payments.read'
    ],
    true,
    'AGENT_PAYROLL_READINESS_BINDING_INVALID',
    'AGENT_PAYROLL_READINESS_AUTHORITY_STALE_OR_DENIED',
    'AGENT_PAYROLL_READINESS_GRANT_STALE_OR_DENIED'
  );
end;
$function$;

revoke all on function private.assert_agent_payroll_readiness_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.agent_price_preview_label_is_safe(
  p_value text
) returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select private.agent_prompt_text_is_safe(p_value, false)
    and p_value !~* '\m(ignore|disregard|override) (all |any |the )?(previous|prior|above|system|developer) (instructions?|prompts?|messages?)\M'
    and p_value !~* '\m(system prompt|developer message)\M'
$function$;

revoke all on function private.agent_price_preview_label_is_safe(text)
  from public, anon, authenticated, service_role;

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
             when 'ops.operations.prepare' then case
               when p_consent_catalog_revision =
                 '2026-08-30.mcp-consent-catalog.v2'
                 then 'Prepare end-of-day closeouts and exact OPS filing previews'
               when p_consent_catalog_revision =
                 '2026-08-31.mcp-consent-catalog.v3'
                 then 'Prepare collections aging and customer drafts for approval'
               when p_consent_catalog_revision =
                 '2026-09-01.mcp-consent-catalog.v4'
                 then 'Prepare recurring-service price-change previews and customer notice drafts'
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
           '2026-09-01.mcp-consent-catalog.v4'
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

create table private.agent_recurring_service_price_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  task_type_id uuid not null references public.task_types(id) on delete restrict,
  price_source_line_item_id uuid not null
    references public.line_items(id) on delete restrict,
  price_source_sha256 text not null
    check (price_source_sha256 ~ '^[0-9a-f]{64}$'),
  notice_contact_kind text not null
    check (notice_contact_kind in ('client', 'sub_client')),
  notice_contact_id uuid not null,
  notice_period_days smallint not null
    check (notice_period_days between 0 and 730),
  adjustment_allowed boolean not null,
  authorized_increase_percent numeric(7,4) not null check (
    authorized_increase_percent > 0 and authorized_increase_percent <= 100
  ),
  authorized_effective_month date not null check (
    authorized_effective_month =
      pg_catalog.date_trunc('month', authorized_effective_month)::date
  ),
  grandfathered_until date,
  policy_source_ref text not null check (
    policy_source_ref = pg_catalog.btrim(policy_source_ref)
    and nullif(policy_source_ref, '') is not null
    and pg_catalog.length(policy_source_ref) between 3 and 240
    and private.agent_price_preview_label_is_safe(policy_source_ref)
  ),
  policy_source_sha256 text not null
    check (policy_source_sha256 ~ '^[0-9a-f]{64}$'),
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  unique (company_id, id),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index agent_recurring_service_price_policies_active_key
  on private.agent_recurring_service_price_policies (
    company_id, client_id, task_type_id
  ) where active;
create index agent_recurring_service_price_policies_price_source_idx
  on private.agent_recurring_service_price_policies (
    company_id, price_source_line_item_id
  );
create index task_recurrences_agent_service_account_idx
  on public.task_recurrences (company_id, task_type_id, client_id, project_id, id)
  where deleted_at is null;
create index task_recurrences_agent_service_bound_idx
  on public.task_recurrences (company_id, task_type_id, id)
  where deleted_at is null;
create index task_recurrences_agent_service_open_month_idx
  on public.task_recurrences (
    company_id, task_type_id, start_anchor, id
  ) include (project_id)
  where deleted_at is null and end_anchor is null;
create index task_recurrences_agent_service_ended_month_idx
  on public.task_recurrences (
    company_id, task_type_id, end_anchor, start_anchor, id
  ) include (project_id)
  where deleted_at is null and end_anchor is not null;
create index if not exists task_types_agent_service_selector_idx
  on public.task_types (
    company_id, (pg_catalog.lower(pg_catalog.btrim(display))), id
  ) where deleted_at is null;
create index line_items_agent_service_price_idx
  on public.line_items (company_id, task_type_ref, id);
create index if not exists task_recurrence_exceptions_agent_original_date_idx
  on public.task_recurrence_exceptions (
    recurrence_id, original_date, id
  );
create index if not exists task_recurrence_exceptions_agent_new_date_idx
  on public.task_recurrence_exceptions (
    recurrence_id, new_date, original_date, id
  ) where new_date is not null;
create index task_recurrence_exceptions_agent_reschedule_month_idx
  on public.task_recurrence_exceptions (
    new_date, recurrence_id, original_date, id
  ) where new_date is not null and action = 'reschedule';
create index if not exists invoices_agent_client_due_idx
  on public.invoices (company_id, client_id, due_date desc, id)
  include (status, paid_at, total, balance_due)
  where deleted_at is null and due_date is not null;
create index if not exists clients_agent_active_normalized_email_idx
  on public.clients (
    company_id,
    (pg_catalog.lower(pg_catalog.btrim(email))),
    id
  )
  where deleted_at is null and merged_into_client_id is null;
create index if not exists sub_clients_agent_active_normalized_email_idx
  on public.sub_clients (
    company_id,
    (pg_catalog.lower(pg_catalog.btrim(email))),
    id
  )
  where deleted_at is null;
create index if not exists agent_provider_delivery_sources_sender_delivered_idx
  on private.agent_provider_delivery_sources (
    company_id, sender_identity, delivered_at desc, id desc
  );
create index if not exists agent_provider_delivery_sources_tenant_delivered_idx
  on private.agent_provider_delivery_sources (
    company_id, delivered_at desc, id desc
  );
create index if not exists agent_provider_delivery_sources_recipients_gin_idx
  on private.agent_provider_delivery_sources using gin (recipient_identities);
create index if not exists agent_provider_delivery_sources_cc_recipients_gin_idx
  on private.agent_provider_delivery_sources using gin (cc_recipient_identities);

alter table private.agent_recurring_service_price_policies
  enable row level security;
revoke all on table private.agent_recurring_service_price_policies
  from public, anon, authenticated, service_role;

comment on table private.agent_recurring_service_price_policies is
  'Explicit source-pinned terms required for fail-closed recurring-service price-change previews. No public writer or mutation RPC exists.';

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
  v_permission_snapshot_revision text;
  v_required_permissions constant jsonb := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('permission', 'calendar.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'catalog.products.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'catalog.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'clients.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'email.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'estimates.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'settings.company', 'scope', 'all')
  );
  v_required_scopes constant text[] := array[
    'ops.catalog.read',
    'ops.company.read',
    'ops.correspondence.read',
    'ops.customer_contacts.read',
    'ops.customers.read',
    'ops.financial_documents.read',
    'ops.operations.prepare',
    'ops.schedule.read'
  ];
  v_exposure_scope_ceiling constant text[] := array[
    'ops.catalog.read',
    'ops.company.read',
    'ops.correspondence.read',
    'ops.customer_contacts.read',
    'ops.customers.read',
    'ops.expenses.read',
    'ops.financial_documents.read',
    'ops.financials.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.payments.read',
    'ops.schedule.read',
    'ops.site_visits.read',
    'ops.tasks.read',
    'ops.team.read'
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
     or nullif(pg_catalog.btrim(p_permission_snapshot_revision), '') is null
     or p_granted_scope_ceiling is distinct from v_required_scopes
     or p_capability_manifest_revision is distinct from
       '2026-09-01.capability-manifest.v15'
     or p_exposure_revision is distinct from
       '2026-09-01.mcp-exposure.v9'
     or p_capability_id is distinct from
       'prepare_recurring_service_price_change'
     or p_capability_revision is distinct from
       'prepare_recurring_service_price_change:2026-09-01.v1' then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_BINDING_INVALID'
      using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array[
      'calendar.view', 'catalog.products.view', 'catalog.view', 'clients.view',
      'email.view', 'estimates.view', 'invoices.view', 'settings.company'
    ]
  ) authority
  where authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null
     or v_permission_snapshot_revision is distinct from
       p_permission_snapshot_revision then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
     on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and client_record.scope_ceiling = v_exposure_scope_ceiling
     and client_record.scope = pg_catalog.array_to_string(
       v_exposure_scope_ceiling,
       ' '
     )
     and grant_record.scopes <@ client_record.scope_ceiling
     and grant_record.consent_catalog_revision =
       client_record.consent_catalog_revision
     and grant_record.exposure_revision = client_record.exposure_revision
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = v_required_scopes
       and grant_record.revoked_at is null
       and grant_record.consent_catalog_revision =
         '2026-09-01.mcp-consent-catalog.v4'
       and grant_record.exposure_revision = '2026-09-01.mcp-exposure.v9'
      and grant_record.accepted_labels =
        private.mcp_oauth_labels_for_scopes(
          grant_record.scopes,
          grant_record.consent_catalog_revision
        )
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_recurring_service_price_change_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.assert_agent_recurring_service_price_change_authority_as_system(
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
language sql
stable
security definer
set search_path = ''
as $function$
  select private.assert_agent_recurring_service_price_change_authority(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_capability_manifest_revision,
    p_exposure_revision,
    p_capability_id,
    p_capability_revision
  )
$function$;

revoke all on function public.assert_agent_recurring_service_price_change_authority_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.assert_agent_recurring_service_price_change_authority_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) to service_role;

create or replace function public.read_agent_recurring_service_price_change_as_system(
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
  p_service_selector text,
  p_increase_percent text,
  p_effective_month text,
  p_account_limit integer,
  p_read_phase text,
  p_selected_recurrence_ids uuid[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_timezone text;
  v_currency_code text;
  v_company_name text;
  v_business_date date;
  v_effective_month date;
  v_normalized_selector text;
  v_service_count integer := 0;
  v_task_type_id uuid;
  v_service_name text;
  v_recurrence_ids uuid[] := '{}'::uuid[];
  v_catalog_recurrences jsonb := '[]'::jsonb;
  v_catalog jsonb;
  v_catalog_recurrence_count integer := 0;
  v_catalog_construction_estimate bigint := 0;
  v_target_exception_count integer := 0;
  v_accounts jsonb := '[]'::jsonb;
  v_account_count integer := 0;
  v_detail_response jsonb;
begin
  perform private.assert_agent_recurring_service_price_change_authority(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_capability_manifest_revision,
    p_exposure_revision,
    p_capability_id,
    p_capability_revision
  );

  if p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_observed_at < pg_catalog.statement_timestamp() - interval '5 minutes'
     or p_observed_at > pg_catalog.statement_timestamp() + interval '5 minutes'
     or p_service_selector is null
     or p_service_selector is distinct from pg_catalog.btrim(p_service_selector)
     or pg_catalog.length(p_service_selector) not between 1 and 120
     or not private.agent_price_preview_label_is_safe(p_service_selector)
     or p_increase_percent is null
     or p_increase_percent !~
       '^(0\.[0-9]{0,3}[1-9]|[1-9][0-9]{0,2}(\.[0-9]{0,3}[1-9])?)$'
     or p_increase_percent::numeric <= 0
     or p_increase_percent::numeric > 100
     or p_effective_month is null
     or p_effective_month !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
     or p_account_limit is distinct from 101
     or p_read_phase is null
     or p_read_phase not in ('catalog', 'detail')
     or p_selected_recurrence_ids is null
     or pg_catalog.cardinality(p_selected_recurrence_ids) > 10000
     or (
       p_read_phase = 'catalog'
       and pg_catalog.cardinality(p_selected_recurrence_ids) <> 0
     )
     or p_selected_recurrence_ids is distinct from array(
       select selected.recurrence_id
       from pg_catalog.unnest(p_selected_recurrence_ids)
         selected(recurrence_id)
       where selected.recurrence_id is not null
       group by selected.recurrence_id
       order by selected.recurrence_id
     ) then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  v_effective_month := (p_effective_month || '-01')::date;
  v_normalized_selector := pg_catalog.lower(pg_catalog.btrim(p_service_selector));

  select company.name,
         company.timezone,
         pg_catalog.upper(pg_catalog.btrim(company.currency_code))
    into v_company_name, v_timezone, v_currency_code
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;

  if nullif(pg_catalog.btrim(v_company_name), '') is null
     or pg_catalog.length(v_company_name) > 240
     or not private.agent_price_preview_label_is_safe(v_company_name)
     or v_timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_timezone
     )
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_COMPANY_CONTEXT_INVALID'
      using errcode = '22000';
  end if;

  v_business_date := (p_observed_at at time zone v_timezone)::date;
  if v_effective_month < pg_catalog.date_trunc('month', v_business_date)::date
     or v_effective_month >
       (pg_catalog.date_trunc('month', v_business_date) + interval '24 months')::date
  then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_MONTH_INVALID'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.task_types task_type
    where task_type.company_id = p_company_id
      and task_type.deleted_at is null
      and pg_catalog.lower(pg_catalog.btrim(task_type.display)) =
        v_normalized_selector
      and (
        pg_catalog.length(task_type.display) not between 1 and 240
        or not private.agent_price_preview_label_is_safe(task_type.display)
      )
  ) then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_INVALID'
      using errcode = '55000';
  end if;

  with bounded_services as materialized (
    select task_type.id, task_type.display
    from public.task_types task_type
    where task_type.company_id = p_company_id
      and task_type.deleted_at is null
      and pg_catalog.lower(pg_catalog.btrim(task_type.display)) =
        v_normalized_selector
      and pg_catalog.length(task_type.display) between 1 and 240
      and private.agent_price_preview_label_is_safe(task_type.display)
    order by task_type.id
    limit 2
  )
  select pg_catalog.count(*)::integer,
         pg_catalog.min(bounded.id::text)::uuid,
         pg_catalog.min(bounded.display)
    into v_service_count, v_task_type_id, v_service_name
  from bounded_services bounded;

  if v_service_count <> 1 then
    v_task_type_id := null;
    v_service_name := null;
  else
    select coalesce(
             pg_catalog.array_agg(bounded.recurrence_id order by bounded.recurrence_id),
             '{}'::uuid[]
           )
      into v_recurrence_ids
    from (
      select recurrence.id as recurrence_id
      from (
        select relevant.recurrence_id
        from (
          (
            select recurrence.id as recurrence_id
            from public.task_recurrences recurrence
            left join public.projects project
              on project.id = recurrence.project_id
             and project.company_id = p_company_id
            where recurrence.company_id = p_company_id
              and recurrence.task_type_id = v_task_type_id
              and recurrence.deleted_at is null
              and recurrence.end_anchor is null
              and recurrence.start_anchor <
                (v_effective_month + interval '1 month')::date
              and (
                project.deleted_at is null
                and project.status in ('accepted', 'in_progress')
                or recurrence.project_id is null
                or project.id is null
                or project.status not in (
                  'rfq', 'estimated', 'accepted', 'in_progress',
                  'completed', 'closed', 'archived'
                )
              )
            order by recurrence.start_anchor, recurrence.id
            limit 10001
          )
          union all
          (
            select recurrence.id as recurrence_id
            from public.task_recurrences recurrence
            left join public.projects project
              on project.id = recurrence.project_id
             and project.company_id = p_company_id
            where recurrence.company_id = p_company_id
              and recurrence.task_type_id = v_task_type_id
              and recurrence.deleted_at is null
              and recurrence.end_anchor is not null
              and recurrence.end_anchor >= v_effective_month
              and recurrence.start_anchor <
                (v_effective_month + interval '1 month')::date
              and (
                project.deleted_at is null
                and project.status in ('accepted', 'in_progress')
                or recurrence.project_id is null
                or project.id is null
                or project.status not in (
                  'rfq', 'estimated', 'accepted', 'in_progress',
                  'completed', 'closed', 'archived'
                )
              )
            order by recurrence.end_anchor, recurrence.start_anchor,
              recurrence.id
            limit 10001
          )
          union all
          (
            select recurrence.id as recurrence_id
            from public.task_recurrence_exceptions relevance_exception
            join public.task_recurrences recurrence
              on recurrence.id = relevance_exception.recurrence_id
             and recurrence.company_id = p_company_id
             and recurrence.task_type_id = v_task_type_id
             and recurrence.deleted_at is null
            left join public.projects project
              on project.id = recurrence.project_id
             and project.company_id = p_company_id
            where relevance_exception.action = 'reschedule'
              and relevance_exception.new_date >= v_effective_month
              and relevance_exception.new_date <
                (v_effective_month + interval '1 month')::date
              and (
                project.deleted_at is null
                and project.status in ('accepted', 'in_progress')
                or recurrence.project_id is null
                or project.id is null
                or project.status not in (
                  'rfq', 'estimated', 'accepted', 'in_progress',
                  'completed', 'closed', 'archived'
                )
              )
            group by recurrence.id
            order by recurrence.id
            limit 10001
          )
        ) relevant
        group by relevant.recurrence_id
        order by relevant.recurrence_id
      ) relevant
      join public.task_recurrences recurrence
        on recurrence.id = relevant.recurrence_id
      left join public.projects project
        on project.id = recurrence.project_id
       and project.company_id = p_company_id
      left join public.clients client
        on client.id = coalesce(recurrence.client_id, project.client_id)
       and client.company_id = p_company_id
       and client.deleted_at is null
       and client.merged_into_client_id is null
      where recurrence.company_id = p_company_id
        and recurrence.task_type_id = v_task_type_id
        and recurrence.deleted_at is null
        and (
          project.deleted_at is null
          and project.status in ('accepted', 'in_progress')
          or recurrence.project_id is null
          or project.id is null
          or project.status not in (
            'rfq', 'estimated', 'accepted', 'in_progress',
            'completed', 'closed', 'archived'
          )
          or project.deleted_at is null
             and project.status in ('accepted', 'in_progress')
             and (
               client.id is null
               or project.client_id is distinct from client.id
               or recurrence.client_id is not null
                  and recurrence.client_id is distinct from client.id
               or pg_catalog.length(recurrence.rrule) not between 1 and 2000
               or recurrence.rrule !~ '^[A-Z0-9=;,+-]+$'
               or pg_catalog.length(client.name) not between 1 and 240
               or not private.agent_price_preview_label_is_safe(client.name)
             )
        )
      order by recurrence.id
      limit 10001
    ) bounded;

    if exists (
      select 1
      from public.task_recurrences recurrence
      left join public.projects project
        on project.id = recurrence.project_id
       and project.company_id = p_company_id
      left join public.clients client
        on client.id = coalesce(recurrence.client_id, project.client_id)
       and client.company_id = p_company_id
       and client.deleted_at is null
       and client.merged_into_client_id is null
      where recurrence.company_id = p_company_id
        and recurrence.task_type_id = v_task_type_id
        and recurrence.deleted_at is null
        and recurrence.id = any(v_recurrence_ids)
        and (
          recurrence.project_id is null
          or project.id is null
          or project.status not in (
            'rfq', 'estimated', 'accepted', 'in_progress',
            'completed', 'closed', 'archived'
          )
          or project.deleted_at is null
             and project.status in ('accepted', 'in_progress')
             and (
               client.id is null
               or project.client_id is distinct from client.id
               or recurrence.client_id is not null
                  and recurrence.client_id is distinct from client.id
               or pg_catalog.length(recurrence.rrule) not between 1 and 2000
               or recurrence.rrule !~ '^[A-Z0-9=;,+-]+$'
               or pg_catalog.length(client.name) not between 1 and 240
               or not private.agent_price_preview_label_is_safe(client.name)
             )
        )
    ) then
      raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_INVALID'
        using errcode = '55000';
    end if;

    select coalesce(
             pg_catalog.sum(
               pg_catalog.octet_length(recurrence.rrule) + 512
             ),
             0
           )
      into v_catalog_construction_estimate
    from public.task_recurrences recurrence
    where recurrence.id = any(v_recurrence_ids);
    select pg_catalog.count(*)::integer
      into v_target_exception_count
    from (
      select bounded.id
      from (
        (
          select exception.id
          from public.task_recurrence_exceptions exception
          where exception.recurrence_id = any(v_recurrence_ids)
            and exception.original_date >= v_effective_month
            and exception.original_date <
              v_effective_month + interval '1 month'
          order by exception.id
          limit 10001
        )
        union
        (
          select exception.id
          from public.task_recurrence_exceptions exception
          where exception.recurrence_id = any(v_recurrence_ids)
            and exception.new_date >= v_effective_month
            and exception.new_date <
              v_effective_month + interval '1 month'
          order by exception.id
          limit 10001
        )
        order by id
        limit 10001
      ) bounded
    ) counted;
    if v_target_exception_count = 10001
       or v_catalog_construction_estimate +
            v_target_exception_count::bigint * 192 > 3500000 then
      raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_BOUND'
        using errcode = '54000';
    end if;

    with catalog_candidates as materialized (
      select recurrence.id as recurrence_id,
             recurrence.project_id,
             recurrence.client_id as recurrence_client_id,
             recurrence.rrule,
             recurrence.start_anchor,
             recurrence.end_anchor,
             client.id as client_id
      from public.task_recurrences recurrence
      join public.projects project
        on project.id = recurrence.project_id
       and project.company_id = p_company_id
       and project.deleted_at is null
       and project.status in ('accepted', 'in_progress')
      join public.clients client
        on client.id = coalesce(recurrence.client_id, project.client_id)
       and client.company_id = p_company_id
       and client.deleted_at is null
       and client.merged_into_client_id is null
       and project.client_id = client.id
      where recurrence.company_id = p_company_id
        and recurrence.task_type_id = v_task_type_id
        and recurrence.deleted_at is null
        and recurrence.id = any(v_recurrence_ids)
        and recurrence.project_id is not null
        and (recurrence.client_id is null or recurrence.client_id = client.id)
        and pg_catalog.length(recurrence.rrule) between 1 and 2000
        and recurrence.rrule ~ '^[A-Z0-9=;,+-]+$'
      order by recurrence.id
    ), catalog_payloads as materialized (
      select candidate.client_id,
             candidate.recurrence_id,
             pg_catalog.jsonb_build_object(
               'client_id', candidate.client_id,
               'recurrence', pg_catalog.jsonb_build_object(
                 'recurrence_id', candidate.recurrence_id,
                 'project_id', candidate.project_id,
                 'rrule', candidate.rrule,
                 'start_anchor', candidate.start_anchor,
                 'end_anchor', candidate.end_anchor,
                 'exceptions', coalesce(exceptions.items, '[]'::jsonb),
                 'source_sha256', pg_catalog.encode(
                   extensions.digest(
                     pg_catalog.convert_to(
                       pg_catalog.concat_ws('|',
                         candidate.recurrence_id::text,
                         candidate.project_id::text,
                         coalesce(candidate.recurrence_client_id::text, ''),
                         candidate.rrule,
                         candidate.start_anchor::text,
                         coalesce(candidate.end_anchor::text, ''),
                         coalesce(exceptions.items, '[]'::jsonb)::text
                       ),
                       'UTF8'
                     ),
                     'sha256'
                   ),
                   'hex'
                 )
               )
             ) as payload
      from catalog_candidates candidate
      left join lateral (
        select aggregated.items
        from (
          select pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object(
                     'original_date', bounded.original_date,
                     'action', bounded.action,
                     'new_date', bounded.new_date
                   ) order by bounded.original_date
                 ) as items
          from (
            (
              select exception.id,
                     exception.original_date,
                     exception.action,
                     exception.new_date
              from public.task_recurrence_exceptions exception
              where exception.recurrence_id = candidate.recurrence_id
                and exception.original_date >= v_effective_month
                and exception.original_date <
                  v_effective_month + interval '1 month'
              order by exception.original_date, exception.id
              limit 101
            )
            union
            (
              select exception.id,
                     exception.original_date,
                     exception.action,
                     exception.new_date
              from public.task_recurrence_exceptions exception
              where exception.recurrence_id = candidate.recurrence_id
                and exception.new_date >= v_effective_month
                and exception.new_date <
                  v_effective_month + interval '1 month'
              order by exception.new_date, exception.original_date,
                exception.id
              limit 101
            )
            order by original_date, id
            limit 101
          ) bounded
        ) aggregated
      ) exceptions on true
    )
    select coalesce(
             pg_catalog.jsonb_agg(
               payload.payload order by payload.recurrence_id
             ),
             '[]'::jsonb
           ),
           pg_catalog.count(*)::integer
      into v_catalog_recurrences, v_catalog_recurrence_count
    from catalog_payloads payload;

    v_catalog := pg_catalog.jsonb_build_object(
      'schema_revision', '2026-09-01.v1',
      'observed_at', pg_catalog.to_char(
        p_observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'business_date', v_business_date,
      'request', pg_catalog.jsonb_build_object(
        'service_selector', p_service_selector,
        'normalized_service_selector', v_normalized_selector,
        'increase_percent', p_increase_percent,
        'effective_month', p_effective_month
      ),
      'context', pg_catalog.jsonb_build_object(
        'company_id', p_company_id,
        'company_name', v_company_name,
        'timezone', v_timezone,
        'currency_code', v_currency_code
      ),
      'service_resolution', pg_catalog.jsonb_build_object(
        'state', 'exact',
        'match_count', 1,
        'task_type_id', v_task_type_id,
        'service_name', v_service_name
      ),
      'recurrences', v_catalog_recurrences,
      'recurrence_count', v_catalog_recurrence_count,
      'overflow', v_catalog_recurrence_count > 10000
    );

    if pg_catalog.octet_length(
         pg_catalog.convert_to(v_catalog::text, 'UTF8')
       ) > 4000000 then
      raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_BOUND'
        using errcode = '54000';
    end if;

    if p_read_phase = 'catalog' then
      return v_catalog;
    end if;
    if v_catalog_recurrence_count > 10000
       or exists (
         select 1
         from pg_catalog.unnest(p_selected_recurrence_ids)
           selected(recurrence_id)
         where not selected.recurrence_id = any(v_recurrence_ids)
       ) then
      raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_SELECTION_STALE'
        using errcode = '55000';
    end if;
    v_recurrence_ids := p_selected_recurrence_ids;

    with candidate_recurrences as materialized (
      select recurrence.id as recurrence_id,
             recurrence.project_id,
             recurrence.client_id as recurrence_client_id,
             recurrence.rrule,
             recurrence.start_anchor,
             recurrence.end_anchor,
             client.id as client_id,
             client.name as client_name
      from public.task_recurrences recurrence
      join public.projects project
        on project.id = recurrence.project_id
       and project.company_id = p_company_id
       and project.deleted_at is null
       and project.status in ('accepted', 'in_progress')
      join public.clients client
        on client.id = coalesce(recurrence.client_id, project.client_id)
       and client.company_id = p_company_id
       and client.deleted_at is null
       and client.merged_into_client_id is null
       and project.client_id = client.id
      where recurrence.company_id = p_company_id
        and recurrence.task_type_id = v_task_type_id
        and recurrence.deleted_at is null
        and recurrence.id = any(v_recurrence_ids)
        and recurrence.project_id is not null
        and (recurrence.client_id is null or recurrence.client_id = client.id)
        and pg_catalog.length(recurrence.rrule) between 1 and 2000
        and recurrence.rrule ~ '^[A-Z0-9=;,+-]+$'
        and pg_catalog.length(client.name) between 1 and 240
        and private.agent_price_preview_label_is_safe(client.name)
      order by client.id, recurrence.id
    ), candidate_identities as materialized (
      select candidate.client_id,
             pg_catalog.min(candidate.recurrence_id::text)::uuid
               as recurrence_id,
             least(pg_catalog.count(*), 2::bigint)::integer
               as recurrence_match_count
      from candidate_recurrences candidate
      group by candidate.client_id
      order by candidate.client_id
      limit 101
    ), candidate_accounts as materialized (
      select candidate.*,
             identity.recurrence_match_count
      from candidate_identities identity
      join candidate_recurrences candidate
        on candidate.client_id = identity.client_id
       and candidate.recurrence_id = identity.recurrence_id
      order by candidate.client_id
    ), account_payloads as materialized (
      select candidate.client_id,
             candidate.recurrence_id,
             pg_catalog.jsonb_build_object(
               'client_id', candidate.client_id,
               'client_name', candidate.client_name,
               'task_type_id', v_task_type_id,
               'service_name', v_service_name,
               'recurrence_match_count',
                 candidate.recurrence_match_count,
               'recurrence', pg_catalog.jsonb_build_object(
                 'recurrence_id', candidate.recurrence_id,
                 'project_id', candidate.project_id,
                 'rrule', candidate.rrule,
                 'start_anchor', candidate.start_anchor,
                 'end_anchor', candidate.end_anchor,
                 'exceptions', coalesce(
                   exceptions.items, '[]'::jsonb
                 ),
                 'source_sha256', exceptions.recurrence_source_sha256
               ),
               'additional_recurrence_sources', coalesce(
                 ambiguity.items, '[]'::jsonb
               ),
               'policy', policy.payload,
               'pricing', pricing.payload,
               'contact', contact.payload,
               'correspondence', pg_catalog.jsonb_build_object(
                 'normalization_revision',
                   'ops.correspondence.normalized-text.v2',
                 'lookback_days', 365,
                 'total_count', coalesce(correspondence.total_count, 0),
                 'readable_count',
                   coalesce(correspondence.readable_count, 0),
                 'unreadable_count',
                   coalesce(correspondence.unreadable_count, 0),
                 'inbound_count',
                   coalesce(correspondence.inbound_count, 0),
                 'outbound_count',
                   coalesce(correspondence.outbound_count, 0),
                 'overflow', coalesce(correspondence.overflow, false),
                 'oversized_text_count',
                   coalesce(correspondence.oversized_text_count, 0),
                 'latest_outbound_source_ref',
                   correspondence.latest_outbound_source_ref,
                 'latest_outbound_source_sha256',
                   correspondence.latest_outbound_source_sha256,
                 'risk_signals', coalesce(
                   correspondence.risk_signals, '[]'::jsonb
                 )
               ),
               'late_payment_evidence', coalesce(
                 late_payments.items, '[]'::jsonb
               )
             ) as payload
      from candidate_accounts candidate
      left join lateral (
        select pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'recurrence_id', bounded.recurrence_id,
                   'source_sha256', bounded.source_sha256
                 ) order by bounded.recurrence_id
               ) as items
        from (
          select (entry.value #>> '{recurrence,recurrence_id}')::uuid
                   as recurrence_id,
                 entry.value #>> '{recurrence,source_sha256}'
                   as source_sha256
          from pg_catalog.jsonb_array_elements(
            v_catalog -> 'recurrences'
          ) entry(value)
          where (entry.value ->> 'client_id')::uuid = candidate.client_id
            and (entry.value #>> '{recurrence,recurrence_id}')::uuid <>
              candidate.recurrence_id
            and (entry.value #>> '{recurrence,recurrence_id}')::uuid =
              any(v_recurrence_ids)
          order by (entry.value #>> '{recurrence,recurrence_id}')::uuid
          limit 1
        ) bounded
      ) ambiguity on true
      left join lateral (
        select aggregated.items,
               pg_catalog.encode(
                 extensions.digest(
                   pg_catalog.convert_to(
                     pg_catalog.concat_ws('|',
                       candidate.recurrence_id::text,
                       candidate.project_id::text,
                       coalesce(candidate.recurrence_client_id::text, ''),
                       candidate.rrule,
                       candidate.start_anchor::text,
                       coalesce(candidate.end_anchor::text, ''),
                       coalesce(aggregated.items, '[]'::jsonb)::text
                     ),
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               ) as recurrence_source_sha256
        from (
          select pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object(
                     'original_date', bounded.original_date,
                     'action', bounded.action,
                     'new_date', bounded.new_date
                   ) order by bounded.original_date
                 ) as items
          from (
            (
              select exception.id,
                     exception.original_date,
                     exception.action,
                     exception.new_date
              from public.task_recurrence_exceptions exception
              where exception.recurrence_id = candidate.recurrence_id
                and exception.original_date >= v_effective_month
                and exception.original_date <
                  v_effective_month + interval '1 month'
              order by exception.original_date, exception.id
              limit 101
            )
            union
            (
              select exception.id,
                     exception.original_date,
                     exception.action,
                     exception.new_date
              from public.task_recurrence_exceptions exception
              where exception.recurrence_id = candidate.recurrence_id
                and exception.new_date >= v_effective_month
                and exception.new_date <
                  v_effective_month + interval '1 month'
              order by exception.new_date, exception.original_date,
                exception.id
              limit 101
            )
            order by original_date, id
            limit 101
          ) bounded
        ) aggregated
      ) exceptions on true
      left join lateral (
        select policy_row.*,
               pg_catalog.jsonb_build_object(
                 'policy_id', policy_row.id,
                 'notice_period_days', policy_row.notice_period_days,
                 'adjustment_allowed', policy_row.adjustment_allowed,
                 'authorized_increase_percent',
                   pg_catalog.trim_scale(
                     policy_row.authorized_increase_percent
                   )::text,
                 'authorized_effective_month', pg_catalog.to_char(
                   policy_row.authorized_effective_month, 'YYYY-MM'
                 ),
                 'grandfathered_until', policy_row.grandfathered_until,
                 'price_source_line_item_id',
                   policy_row.price_source_line_item_id,
                 'price_source_sha256', policy_row.price_source_sha256,
                 'notice_contact_kind', policy_row.notice_contact_kind,
                 'notice_contact_id', policy_row.notice_contact_id,
                 'policy_source_ref', policy_row.policy_source_ref,
                 'policy_source_sha256', policy_row.policy_source_sha256,
                 'effective_from', policy_row.effective_from,
                 'effective_to', policy_row.effective_to
               ) as payload
        from private.agent_recurring_service_price_policies policy_row
        where policy_row.company_id = p_company_id
          and policy_row.client_id = candidate.client_id
          and policy_row.task_type_id = v_task_type_id
          and policy_row.active
          and private.agent_price_preview_label_is_safe(
            policy_row.policy_source_ref
          )
        limit 1
      ) policy on true
      left join lateral (
        select pg_catalog.jsonb_build_object(
                 'line_item_id', price.line_item_id,
                 'document_kind', price.document_kind,
                 'document_id', price.document_id,
                 'document_status', price.document_status,
                 'unit_price', price.unit_price,
                 'unit_label', price.unit_label,
                 'quantity', price.quantity,
                 'discount_percent', price.discount_percent,
                 'minimum_charge', price.minimum_charge,
                 'is_taxable', price.is_taxable,
                 'tax_rate_id', price.tax_rate_id,
                 'tax_rate_name', price.tax_rate_name,
                 'tax_rate_percent', price.tax_rate_percent,
                 'tax_rate_source_sha256',
                   price.tax_rate_source_sha256,
                 'source_sha256', price.source_sha256
               ) as payload
        from (
          select line_item.id as line_item_id,
                 case when estimate.id is not null then 'estimate'
                      else 'invoice' end as document_kind,
                 coalesce(estimate.id, invoice.id) as document_id,
                 coalesce(estimate.status, invoice.status)
                   as document_status,
                 coalesce(estimate.discount_type, invoice.discount_type)
                   as document_discount_type,
                 coalesce(estimate.discount_value, invoice.discount_value)
                   as document_discount_value,
                 coalesce(estimate.discount_amount, invoice.discount_amount)
                   as document_discount_amount,
                 line_item.unit_price::text as unit_price,
                 nullif(pg_catalog.btrim(line_item.unit), '') as unit_label,
                 pg_catalog.trim_scale(line_item.quantity)::text as quantity,
                 pg_catalog.trim_scale(
                   coalesce(line_item.discount_percent, 0)
                 )::text
                   as discount_percent,
                 pg_catalog.trim_scale(
                   line_item.minimum_charge_snapshot
                 )::text as minimum_charge,
                 line_item.is_taxable,
                 case when tax_rate.preview_valid
                   then tax_rate.id else null end as tax_rate_id,
                 case when tax_rate.preview_valid
                   then tax_rate.name else null end as tax_rate_name,
                 case when tax_rate.preview_valid
                   then pg_catalog.trim_scale(tax_rate.rate * 100)::text
                   else null end as tax_rate_percent,
                 case when not coalesce(tax_rate.preview_valid, false)
                   then null else
                   pg_catalog.encode(
                     extensions.digest(
                       pg_catalog.convert_to(
                         pg_catalog.concat_ws('|',
                           tax_rate.id::text,
                           tax_rate.name,
                           tax_rate.rate::text,
                           tax_rate.is_active::text
                         ),
                         'UTF8'
                       ),
                       'sha256'
                     ),
                     'hex'
                   )
                 end as tax_rate_source_sha256,
                 pg_catalog.encode(
                   extensions.digest(
                     pg_catalog.convert_to(
                       pg_catalog.concat_ws('|',
                         line_item.id::text,
                         case when estimate.id is not null
                           then 'estimate' else 'invoice' end,
                         coalesce(estimate.id, invoice.id)::text,
                         coalesce(estimate.status, invoice.status),
                         coalesce(
                           estimate.discount_type, invoice.discount_type, ''
                         ),
                         coalesce(
                           estimate.discount_value,
                           invoice.discount_value,
                           0
                         )::text,
                         coalesce(
                           estimate.discount_amount,
                           invoice.discount_amount
                         )::text,
                         line_item.unit_price::text,
                         coalesce(line_item.unit, ''),
                         pg_catalog.trim_scale(line_item.quantity)::text,
                         pg_catalog.trim_scale(
                           coalesce(line_item.discount_percent, 0)
                         )::text,
                         coalesce(
                           pg_catalog.trim_scale(
                             line_item.minimum_charge_snapshot
                           )::text,
                           ''
                         ),
                         line_item.is_taxable::text,
                         line_item.is_optional::text,
                         line_item.is_selected::text,
                         coalesce(tax_rate.id::text, ''),
                         coalesce(tax_rate.name, ''),
                         coalesce(tax_rate.rate::text, '')
                       ),
                       'UTF8'
                     ),
                     'sha256'
                   ),
                   'hex'
                 ) as source_sha256
          from public.line_items line_item
          left join public.estimates estimate
            on estimate.id = line_item.estimate_id
           and estimate.company_id = p_company_id
           and estimate.client_id = candidate.client_id
           and estimate.deleted_at is null
           and estimate.status in ('approved', 'converted')
          left join public.invoices invoice
            on invoice.id = line_item.invoice_id
           and invoice.company_id = p_company_id
           and invoice.client_id = candidate.client_id
           and invoice.deleted_at is null
           and invoice.status in (
             'sent', 'awaiting_payment', 'partially_paid', 'paid', 'past_due'
           )
          left join lateral (
            select source_tax_rate.id,
                   source_tax_rate.name,
                   source_tax_rate.rate,
                   source_tax_rate.is_active,
                   source_tax_rate.is_active is true
                     and pg_catalog.length(
                       pg_catalog.btrim(source_tax_rate.name)
                     ) between 1 and 120
                     and private.agent_price_preview_label_is_safe(
                       pg_catalog.btrim(source_tax_rate.name)
                     )
                     and source_tax_rate.rate between 0 and 1
                       as preview_valid
            from public.tax_rates source_tax_rate
            where source_tax_rate.id = line_item.tax_rate_id
              and source_tax_rate.company_id = p_company_id
            limit 1
          ) tax_rate on line_item.is_taxable is true
          where policy.id is not null
            and line_item.id = policy.price_source_line_item_id
            and line_item.company_id = p_company_id
            and line_item.task_type_ref = v_task_type_id
            and (line_item.estimate_id is null) <>
                (line_item.invoice_id is null)
            and (estimate.id is not null) <>
                (invoice.id is not null)
            and coalesce(
                  estimate.discount_amount, invoice.discount_amount
                ) = 0
            and coalesce(
                  estimate.discount_value, invoice.discount_value, 0
                ) = 0
            and line_item.unit_price >= 0
            and line_item.quantity >= 0
            and line_item.is_taxable is not null
            and line_item.is_optional is not null
            and line_item.is_selected is not null
            and coalesce(line_item.discount_percent, 0) >= 0
            and (
              not line_item.is_optional
              or line_item.is_selected
            )
            and (
              line_item.unit is null
              or pg_catalog.length(pg_catalog.btrim(line_item.unit))
                   between 1 and 80
                 and private.agent_price_preview_label_is_safe(
                   pg_catalog.btrim(line_item.unit)
                 )
            )
        ) price
        limit 1
      ) pricing on true
      left join lateral (
        select pg_catalog.jsonb_build_object(
                 'contact_kind', identified.kind,
                 'contact_id', identified.id,
                 'display_name', identified.display_name,
                 'normalized_email', identified.normalized_email,
                 'active_identity_count', identified.active_identity_count,
                 'source_sha256', pg_catalog.encode(
                   extensions.digest(
                     pg_catalog.convert_to(
                       pg_catalog.concat_ws('|',
                         identified.kind,
                         identified.id::text,
                         identified.display_name,
                         identified.normalized_email,
                         identified.active_identity_count::text
                       ),
                       'UTF8'
                     ),
                     'sha256'
                   ),
                   'hex'
                 )
               ) as payload,
               identified.normalized_email
        from lateral (
          select selected.*,
                 (
                   select pg_catalog.count(*)::integer
                   from (
                     (
                       select active_client.id, 'client'::text as kind
                       from public.clients active_client
                       where active_client.company_id = p_company_id
                         and active_client.deleted_at is null
                         and active_client.merged_into_client_id is null
                         and pg_catalog.lower(
                           pg_catalog.btrim(active_client.email)
                         ) = selected.normalized_email
                       order by active_client.id
                       limit 2
                     )
                     union all
                     (
                       select active_sub_client.id, 'sub_client'::text
                       from public.sub_clients active_sub_client
                       join public.clients owner
                         on owner.id = active_sub_client.client_id
                        and owner.company_id = p_company_id
                        and owner.deleted_at is null
                        and owner.merged_into_client_id is null
                       where active_sub_client.company_id = p_company_id
                         and active_sub_client.deleted_at is null
                         and pg_catalog.lower(
                           pg_catalog.btrim(active_sub_client.email)
                         ) = selected.normalized_email
                       order by active_sub_client.id
                       limit 2
                     )
                     order by kind, id
                     limit 2
                   ) active_identity
                 ) as active_identity_count
          from (
          select 'client'::text as kind,
                 client.id,
                 client.name as display_name,
                 pg_catalog.lower(pg_catalog.btrim(client.email))
                   as normalized_email
          from public.clients client
          where policy.notice_contact_kind = 'client'
            and client.id = policy.notice_contact_id
            and client.id = candidate.client_id
            and client.company_id = p_company_id
            and client.deleted_at is null
            and client.merged_into_client_id is null
          union all
          select 'sub_client'::text,
                 sub_client.id,
                 sub_client.name,
                 pg_catalog.lower(pg_catalog.btrim(sub_client.email))
          from public.sub_clients sub_client
          where policy.notice_contact_kind = 'sub_client'
            and sub_client.id = policy.notice_contact_id
            and sub_client.client_id = candidate.client_id
            and sub_client.company_id = p_company_id
            and sub_client.deleted_at is null
          ) selected
        ) identified
        where pg_catalog.length(identified.display_name) between 1 and 240
          and private.agent_price_preview_label_is_safe(
            identified.display_name
          )
           and pg_catalog.length(identified.normalized_email) between 3 and 320
           and identified.normalized_email !~ '^[.]'
           and identified.normalized_email !~ '[.][.]'
           and identified.normalized_email ~
             '^[a-z0-9_+''.-]*[a-z0-9_+-]@([a-z0-9][a-z0-9-]*[.])+[a-z]{2,}$'
         limit 1
      ) contact on true
      left join lateral (
        with provider_match_ids as materialized (
          (
            select source.id
            from private.agent_provider_delivery_sources source
            where contact.normalized_email is not null
              and source.company_id = p_company_id
              and source.delivered_at >= p_observed_at - interval '8760 hours'
              and source.delivered_at <= p_observed_at
              and source.sender_identity = contact.normalized_email
            order by source.delivered_at desc, source.id desc
            limit 1001
          )
          union all
          (
            select source.id
            from private.agent_provider_delivery_sources source
            where contact.normalized_email is not null
              and source.company_id = p_company_id
              and source.delivered_at >= p_observed_at - interval '8760 hours'
              and source.delivered_at <= p_observed_at
              and source.recipient_identities @>
                array[contact.normalized_email]::text[]
            order by source.delivered_at desc, source.id desc
            limit 1001
          )
          union all
          (
            select source.id
            from private.agent_provider_delivery_sources source
            where contact.normalized_email is not null
              and source.company_id = p_company_id
              and source.delivered_at >= p_observed_at - interval '8760 hours'
              and source.delivered_at <= p_observed_at
              and source.cc_recipient_identities @>
                array[contact.normalized_email]::text[]
            order by source.delivered_at desc, source.id desc
            limit 1001
          )
        ), provider_candidates as materialized (
          select source.id,
                 source.direction,
                 source.delivered_at,
                 source.normalization_status,
                 source.normalization_revision,
                 source.sender_identity,
                 source.recipient_identities,
                 source.cc_recipient_identities,
                 source.source_sha256,
                 pg_catalog.octet_length(source.normalized_plain_text)
                   <= 20000 as body_within_bound,
                 case when pg_catalog.octet_length(
                   source.normalized_plain_text
                 ) <= 20000 then source.normalized_plain_text end
                   as bounded_plain_text
          from (
            select distinct matched.id
            from provider_match_ids matched
          ) matched
          join private.agent_provider_delivery_sources source
            on source.id = matched.id
          order by source.delivered_at desc, source.id desc
          limit 1001
        ), bounded_source as materialized (
          select * from provider_candidates
          order by delivered_at desc, id desc
          limit 1000
        ), stats as (
          select pg_catalog.count(*)::integer as total_count,
                 pg_catalog.count(*) filter (
                   where source.normalization_status = 'normalized'
                     and source.normalization_revision =
                       'ops.correspondence.normalized-text.v2'
                     and source.body_within_bound
                     and nullif(
                       pg_catalog.btrim(source.bounded_plain_text), ''
                     ) is not null
                 )::integer as readable_count,
                 pg_catalog.count(*) filter (
                   where source.normalization_status <> 'normalized'
                      or source.normalization_revision <>
                        'ops.correspondence.normalized-text.v2'
                      or not source.body_within_bound
                      or nullif(
                        pg_catalog.btrim(source.bounded_plain_text), ''
                      ) is null
                 )::integer as unreadable_count,
                 pg_catalog.count(*) filter (
                   where source.direction = 'inbound'
                 )::integer as inbound_count,
                 pg_catalog.count(*) filter (
                   where source.direction = 'outbound'
                 )::integer as outbound_count,
                 pg_catalog.count(*) filter (
                   where not source.body_within_bound
                 )::integer as oversized_text_count
          from bounded_source source
        ), latest as (
          select 'provider_delivery:' || source.id::text as source_ref,
                 pg_catalog.substr(source.source_sha256, 8)
                   as source_sha256
          from bounded_source source
          where source.direction = 'outbound'
            and source.normalization_status = 'normalized'
            and source.normalization_revision =
              'ops.correspondence.normalized-text.v2'
            and source.body_within_bound
            and nullif(pg_catalog.btrim(source.bounded_plain_text), '')
              is not null
            and (
              contact.normalized_email = any(source.recipient_identities)
              or contact.normalized_email = any(
                source.cc_recipient_identities
              )
            )
          order by source.delivered_at desc, source.id desc
          limit 1
        ), matched as (
          select classification.category,
                 classification.code,
                 'provider_delivery:' || source.id::text as source_ref,
                 pg_catalog.substr(source.source_sha256, 8)
                   as source_sha256,
                 source.delivered_at as occurred_at
          from bounded_source source
          cross join lateral (
            values
              (
                'cancellation',
                case
                  when source.bounded_plain_text ~*
                    '((do not|don''t|never|not going to|no longer want to) (want to )?(cancel|terminate)|(do not|don''t|never) plan to (cancel|terminate)|(keep|continue) (my|our|the) (recurring )?(service|agreement|account|contract|maintenance)( plan)? active)'
                    then 'cancellation_resolved'
                  when source.bounded_plain_text !~*
                    '(cancel|terminate) (my|our|the) service (([[:alnum:]-]+ ){0,3})?(appointment|visit|call|request|booking|ticket|work order)'
                   and source.bounded_plain_text ~*
                    '((please |want to |going to |will )?(cancel|terminate) (my|our|the) (service|agreement|account|contract|maintenance)|(won''t|will not) renew (my|our|the) (service|agreement|contract|maintenance))'
                    then 'explicit_cancellation'
                end
              ),
              (
                'price',
                case
                  when source.bounded_plain_text ~*
                    '((service|maintenance|price|rate|increase|price increase|rate increase|service cost|maintenance cost) (is|seems|feels) not too expensive|can afford (this|the|our|your) (service|maintenance|price|rate|increase|price increase|rate increase|service cost|maintenance cost)|(do not|don''t) object to (the )?(price|rate)( increase)?|will accept (the )?(price|rate) increase|agree with (the )?(price|rate) increase)'
                    then 'price_resolved'
                  when source.bounded_plain_text !~*
                    'can(''t|not) afford (this|the|our|your) service (interruption|outage|downtime)|can(''t|not) afford (this|the|our|your) (service|maintenance) (([[:alnum:]-]+ ){0,3})?(appointment|visit|call|request|booking|ticket|work order)'
                   and source.bounded_plain_text ~*
                    '((service|maintenance|price|rate|increase|price increase|rate increase|service cost|maintenance cost) (is|seems|feels) too expensive|can(''t|not) afford (this|the|our|your) (service|maintenance|price|rate|increase|price increase|rate increase|service cost|maintenance cost)|object to (the )?(price|rate)|unacceptable (price|rate)|(price|rate) increase is too high|won''t accept (the )?(price|rate) increase)'
                    then 'price_objection'
                end
              ),
              (
                'service',
                case
                  when source.bounded_plain_text ~*
                    '(not (unhappy|disappointed)|(service is|service was) not (poor|bad)|not (poor|bad) service|(service|work|maintenance) (is|was|has been) (excellent|good|great|satisfactory))'
                    then 'service_resolved'
                  when source.bounded_plain_text !~*
                    '(unhappy|disappointed) (with|in|about) (the |your |our )?service (([[:alnum:]-]+ ){0,3})?(appointment|visit|call|request|booking|ticket|work order|timing)'
                   and source.bounded_plain_text ~*
                    '((unhappy|disappointed) (with|in|about) (the |your |our )?(service|work|maintenance|crew)|(service|work|maintenance) (made us |has us )?(unhappy|disappointed)|poor service|bad service)'
                    then 'service_complaint'
                end
              ),
              (
                'overcharge',
                case
                  when source.bounded_plain_text ~*
                    '(not (overcharged|charged too much)|(invoice|bill|charge|payment) (amount )?(is|was) (not wrong|correct))'
                    then 'overcharge_resolved'
                  when source.bounded_plain_text ~*
                    '(overcharged|charged too much|(invoice|bill|charge|payment) (has|had|shows|showed|is|was) (the )?wrong amount|wrong (invoice|bill|charge|payment) amount)'
                    then 'overcharge_complaint'
                end
              )
          ) classification(category, code)
          where source.direction = 'inbound'
            and source.sender_identity = contact.normalized_email
            and source.normalization_status = 'normalized'
            and source.normalization_revision =
              'ops.correspondence.normalized-text.v2'
            and source.body_within_bound
            and nullif(pg_catalog.btrim(source.bounded_plain_text), '')
              is not null
            and classification.code is not null
        ), latest_signal_state as (
          select matched.category,
                 pg_catalog.max(matched.occurred_at) as occurred_at
          from matched
          group by matched.category
        ), signals as (
          select distinct on (matched.category)
                 matched.code,
                 matched.source_ref,
                 matched.source_sha256,
                 matched.occurred_at
          from matched
          join latest_signal_state latest
            on latest.category = matched.category
           and latest.occurred_at = matched.occurred_at
          where matched.code in (
                  'explicit_cancellation', 'price_objection',
                  'service_complaint', 'overcharge_complaint'
                )
            and not exists (
              select 1
              from matched resolution
              where resolution.category = matched.category
                and resolution.occurred_at = matched.occurred_at
                and resolution.code like '%_resolved'
            )
          order by matched.category, matched.source_ref
        )
        select stats.total_count,
               stats.readable_count,
               stats.unreadable_count,
               stats.inbound_count,
               stats.outbound_count,
               (
                 select pg_catalog.count(*) > 1000
                 from provider_candidates
               ) as overflow,
               stats.oversized_text_count,
               latest.source_ref as latest_outbound_source_ref,
               latest.source_sha256 as latest_outbound_source_sha256,
               (
                 select pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object(
                     'code', signal.code,
                     'source_ref', signal.source_ref,
                     'source_sha256', signal.source_sha256,
                     'occurred_at', pg_catalog.to_char(
                       signal.occurred_at at time zone 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                     )
                   ) order by
                     case signal.code
                       when 'explicit_cancellation' then 1
                       when 'price_objection' then 2
                       when 'service_complaint' then 3
                       when 'overcharge_complaint' then 4
                       else 5
                     end,
                     signal.occurred_at desc,
                     signal.source_ref
                 )
                 from signals signal
               ) as risk_signals
        from stats
        left join latest on true
      ) correspondence on true
      left join lateral (
        select pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'source_ref', evidence.source_ref,
                   'source_sha256', evidence.source_sha256,
                   'due_date', evidence.due_date,
                   'paid_at', case when evidence.paid_at is null then null else
                     pg_catalog.to_char(
                       evidence.paid_at at time zone 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                     ) end,
                   'days_late', evidence.days_late
                 ) order by evidence.due_date desc, evidence.source_ref
               ) as items
        from (
          select 'invoice:' || invoice.id::text as source_ref,
                 pg_catalog.encode(
                   extensions.digest(
                     pg_catalog.convert_to(
                       pg_catalog.concat_ws('|',
                         invoice.id::text, invoice.status,
                         invoice.due_date::text,
                         coalesce(pg_catalog.to_char(
                           invoice.paid_at at time zone 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                         ), ''),
                         invoice.total::text, invoice.balance_due::text
                       ),
                       'UTF8'
                     ),
                     'sha256'
                   ),
                   'hex'
                 ) as source_sha256,
                 invoice.due_date,
                 invoice.paid_at,
                 (
                   coalesce(
                     (invoice.paid_at at time zone v_timezone)::date,
                     v_business_date
                   ) - invoice.due_date
                 )::integer as days_late
          from public.invoices invoice
          where invoice.company_id = p_company_id
            and invoice.client_id = candidate.client_id
            and invoice.deleted_at is null
            and invoice.due_date is not null
            and invoice.due_date >= v_business_date - 365
            and invoice.due_date <= v_business_date
            and (
              invoice.paid_at is null
              or invoice.paid_at <= p_observed_at
            )
            and (
              invoice.status in (
                'sent', 'awaiting_payment', 'partially_paid', 'past_due'
              )
              and invoice.paid_at is null
              and invoice.total > 0
              and invoice.balance_due > 0
              and invoice.balance_due <= invoice.total
              and v_business_date > invoice.due_date
              or invoice.status = 'paid'
                 and invoice.paid_at is not null
                 and invoice.total > 0
                 and coalesce(invoice.balance_due, 0) = 0
                 and (invoice.paid_at at time zone v_timezone)::date >
                   invoice.due_date
            )
          order by invoice.due_date desc, invoice.id
          limit 20
        ) evidence
      ) late_payments on true
    ), finalized as materialized (
      select payloads.client_id,
             payloads.recurrence_id,
             payloads.payload || pg_catalog.jsonb_build_object(
               'source_revision', pg_catalog.encode(
                 extensions.digest(
                   pg_catalog.convert_to(payloads.payload::text, 'UTF8'),
                   'sha256'
                 ),
                 'hex'
               )
             ) as payload
      from account_payloads payloads
    )
    select coalesce(
             pg_catalog.jsonb_agg(
               finalized.payload order by finalized.client_id,
                 finalized.recurrence_id
             ),
             '[]'::jsonb
           ),
           pg_catalog.count(*)::integer
      into v_accounts, v_account_count
    from finalized;
  end if;

  if v_catalog is null then
    v_catalog := pg_catalog.jsonb_build_object(
      'schema_revision', '2026-09-01.v1',
      'observed_at', pg_catalog.to_char(
        p_observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'business_date', v_business_date,
      'request', pg_catalog.jsonb_build_object(
        'service_selector', p_service_selector,
        'normalized_service_selector', v_normalized_selector,
        'increase_percent', p_increase_percent,
        'effective_month', p_effective_month
      ),
      'context', pg_catalog.jsonb_build_object(
        'company_id', p_company_id,
        'company_name', v_company_name,
        'timezone', v_timezone,
        'currency_code', v_currency_code
      ),
      'service_resolution', pg_catalog.jsonb_build_object(
        'state', case when v_service_count = 0 then 'not_found'
                      else 'ambiguous' end,
        'match_count', v_service_count,
        'task_type_id', null,
        'service_name', null
      ),
      'recurrences', '[]'::jsonb,
      'recurrence_count', 0,
      'overflow', false
    );
  end if;
  if p_read_phase = 'catalog' then
    return v_catalog;
  end if;

  v_detail_response := pg_catalog.jsonb_build_object(
    'catalog', v_catalog,
    'snapshot', pg_catalog.jsonb_build_object(
      'schema_revision', '2026-09-01.v1',
      'observed_at', pg_catalog.to_char(
        p_observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'business_date', v_business_date,
      'request', pg_catalog.jsonb_build_object(
        'service_selector', p_service_selector,
        'normalized_service_selector', v_normalized_selector,
        'increase_percent', p_increase_percent,
        'effective_month', p_effective_month
      ),
      'context', pg_catalog.jsonb_build_object(
        'company_id', p_company_id,
        'company_name', v_company_name,
        'timezone', v_timezone,
        'currency_code', v_currency_code
      ),
      'service_resolution', pg_catalog.jsonb_build_object(
        'state', case when v_service_count = 1 then 'exact'
                      when v_service_count = 0 then 'not_found'
                      else 'ambiguous' end,
        'match_count', v_service_count,
        'task_type_id', v_task_type_id,
        'service_name', v_service_name
      ),
      'accounts', v_accounts,
      'account_count', v_account_count,
      'overflow', v_account_count > 100
    )
  );
  if pg_catalog.octet_length(
       pg_catalog.convert_to(v_detail_response::text, 'UTF8')
     ) > 4000000 then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_BOUND'
      using errcode = '54000';
  end if;
  return v_detail_response;
exception
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_INPUT_INVALID'
      using errcode = '22023';
end;
$function$;

revoke all on function public.read_agent_recurring_service_price_change_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, text, text, text, integer, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.read_agent_recurring_service_price_change_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, text, text, text, integer, text, uuid[]
) to service_role;

create or replace function private.assert_agent_recurring_service_price_change_catalog()
returns void
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_invalid_indexes text[];
begin
  select pg_catalog.array_agg(expected.index_name order by expected.index_name)
    into v_invalid_indexes
  from (
    values
      (
        'public', 'clients_agent_active_normalized_email_idx', 'clients',
        'btree', false,
        array['company_id', 'lower(btrim(email))', 'id']::text[], 3,
        array[0, 0, 0]::smallint[],
        'deleted_at IS NULL AND merged_into_client_id IS NULL'
      ),
      (
        'public', 'sub_clients_agent_active_normalized_email_idx',
        'sub_clients', 'btree', false,
        array['company_id', 'lower(btrim(email))', 'id']::text[], 3,
        array[0, 0, 0]::smallint[],
        'deleted_at IS NULL'
      ),
      (
        'public', 'task_types_agent_service_selector_idx', 'task_types',
        'btree', false,
        array['company_id', 'lower(btrim(display))', 'id']::text[], 3,
        array[0, 0, 0]::smallint[],
        'deleted_at IS NULL'
      ),
      (
        'public', 'task_recurrences_agent_service_open_month_idx',
        'task_recurrences', 'btree', false,
        array[
          'company_id', 'task_type_id', 'start_anchor', 'id', 'project_id'
        ]::text[], 4, array[0, 0, 0, 0]::smallint[],
        'deleted_at IS NULL AND end_anchor IS NULL'
      ),
      (
        'public', 'task_recurrences_agent_service_ended_month_idx',
        'task_recurrences', 'btree', false,
        array[
          'company_id', 'task_type_id', 'end_anchor', 'start_anchor', 'id',
          'project_id'
        ]::text[], 5, array[0, 0, 0, 0, 0]::smallint[],
        'deleted_at IS NULL AND end_anchor IS NOT NULL'
      ),
      (
        'public', 'task_recurrence_exceptions_agent_original_date_idx',
        'task_recurrence_exceptions', 'btree', false,
        array['recurrence_id', 'original_date', 'id']::text[], 3,
        array[0, 0, 0]::smallint[], null
      ),
      (
        'private', 'agent_provider_delivery_sources_sender_delivered_idx',
        'agent_provider_delivery_sources', 'btree', false,
        array[
          'company_id', 'sender_identity', 'delivered_at', 'id'
        ]::text[], 4, array[0, 0, 3, 3]::smallint[], null
      ),
      (
        'private', 'agent_provider_delivery_sources_tenant_delivered_idx',
        'agent_provider_delivery_sources', 'btree', false,
        array['company_id', 'delivered_at', 'id']::text[], 3,
        array[0, 3, 3]::smallint[], null
      ),
      (
        'private', 'agent_provider_delivery_sources_recipients_gin_idx',
        'agent_provider_delivery_sources', 'gin', false,
        array['recipient_identities']::text[], 1,
        array[0]::smallint[], null
      ),
      (
        'private', 'agent_provider_delivery_sources_cc_recipients_gin_idx',
        'agent_provider_delivery_sources', 'gin', false,
        array['cc_recipient_identities']::text[], 1,
        array[0]::smallint[], null
      ),
      (
        'public', 'task_recurrence_exceptions_agent_new_date_idx',
        'task_recurrence_exceptions', 'btree', false,
        array['recurrence_id', 'new_date', 'original_date', 'id']::text[], 4,
        array[0, 0, 0, 0]::smallint[],
        'new_date IS NOT NULL'
      ),
      (
        'public', 'task_recurrence_exceptions_agent_reschedule_month_idx',
        'task_recurrence_exceptions', 'btree', false,
        array[
          'new_date', 'recurrence_id', 'original_date', 'id'
        ]::text[], 4, array[0, 0, 0, 0]::smallint[],
        'new_date IS NOT NULL AND action = ''reschedule''::text'
      ),
      (
        'public', 'invoices_agent_client_due_idx', 'invoices', 'btree', false,
        array[
          'company_id', 'client_id', 'due_date', 'id', 'status',
          'paid_at', 'total', 'balance_due'
        ]::text[], 4,
        array[0, 0, 3, 0]::smallint[],
        'deleted_at IS NULL AND due_date IS NOT NULL'
      ),
      (
        'private', 'agent_recurring_service_price_policies_active_key',
        'agent_recurring_service_price_policies', 'btree', true,
        array['company_id', 'client_id', 'task_type_id']::text[], 3,
        array[0, 0, 0]::smallint[], 'active'
      ),
      (
        'private', 'agent_recurring_service_price_policies_price_source_idx',
        'agent_recurring_service_price_policies', 'btree', false,
        array['company_id', 'price_source_line_item_id']::text[], 2,
        array[0, 0]::smallint[], null
      ),
      (
        'public', 'task_recurrences_agent_service_account_idx',
        'task_recurrences', 'btree', false,
        array[
          'company_id', 'task_type_id', 'client_id', 'project_id', 'id'
        ]::text[], 5, array[0, 0, 0, 0, 0]::smallint[],
        'deleted_at IS NULL'
      ),
      (
        'public', 'task_recurrences_agent_service_bound_idx',
        'task_recurrences', 'btree', false,
        array['company_id', 'task_type_id', 'id']::text[], 3,
        array[0, 0, 0]::smallint[], 'deleted_at IS NULL'
      ),
      (
        'public', 'line_items_agent_service_price_idx', 'line_items',
        'btree', false,
        array['company_id', 'task_type_ref', 'id']::text[], 3,
        array[0, 0, 0]::smallint[], null
      )
  ) expected(
    schema_name, index_name, table_name, access_method, is_unique, columns,
    key_count, order_options, predicate
  )
  where not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_class relation
      on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_am method
      on method.oid = index_relation.relam
    where namespace.nspname = expected.schema_name
      and relation.relname = expected.table_name
      and index_relation.relname = expected.index_name
      and method.amname = expected.access_method
      and index_row.indisunique = expected.is_unique
      and not index_row.indisprimary
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indislive
      and index_row.indnkeyatts = expected.key_count
      and (
        select pg_catalog.array_agg(
          index_row.indoption[ordinal.position - 1]
          order by ordinal.position
        )
        from pg_catalog.generate_series(
          1, expected.key_count
        ) ordinal(position)
      ) = expected.order_options
      and index_row.indnatts = pg_catalog.array_length(expected.columns, 1)
      and index_relation.reloptions is null
      and (
        select pg_catalog.array_agg(
          pg_catalog.pg_get_indexdef(
            index_row.indexrelid,
            ordinal.position,
            true
          ) order by ordinal.position
        )
        from pg_catalog.generate_series(
          1,
          pg_catalog.array_length(expected.columns, 1)
        ) ordinal(position)
      ) = expected.columns
      and pg_catalog.pg_get_expr(
        index_row.indpred, index_row.indrelid, true
      ) is not distinct from expected.predicate
  );

  if v_invalid_indexes is not null then
    raise exception
      'AGENT_RECURRING_SERVICE_PRICE_CHANGE_INDEX_INVALID: % :: %',
      pg_catalog.array_to_string(v_invalid_indexes, ','),
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', index_relation.relname,
            'definition', pg_catalog.pg_get_indexdef(index_relation.oid),
            'columns', (
              select pg_catalog.jsonb_agg(
                pg_catalog.pg_get_indexdef(
                  index_row.indexrelid, ordinal.position, true
                ) order by ordinal.position
              )
              from pg_catalog.generate_series(
                1, index_row.indnatts
              ) ordinal(position)
            ),
            'key_count', index_row.indnkeyatts,
            'attribute_count', index_row.indnatts,
            'predicate', pg_catalog.pg_get_expr(
              index_row.indpred, index_row.indrelid, true
            )
          ) order by index_relation.relname
        )
        from pg_catalog.pg_class index_relation
        join pg_catalog.pg_index index_row
          on index_row.indexrelid = index_relation.oid
        where index_relation.relname = any(v_invalid_indexes)
      )
      using errcode = '55000';
  end if;

  if not (
       select relation.relrowsecurity
       from pg_catalog.pg_class relation
       where relation.oid =
         'private.agent_recurring_service_price_policies'::regclass
     )
     or exists (
       select 1
       from pg_catalog.pg_policy policy
       where policy.polrelid =
         'private.agent_recurring_service_price_policies'::regclass
     )
     or exists (
       select 1
       from pg_catalog.pg_class relation
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           relation.relacl,
           pg_catalog.acldefault('r', relation.relowner)
         )
       ) access
       where relation.oid =
         'private.agent_recurring_service_price_policies'::regclass
         and access.grantee <> relation.relowner
     ) then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_POLICY_ACL_INVALID'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'private.assert_agent_additive_exposure_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,text[],text[],boolean,text,text,text)'::regprocedure,
      'private.assert_agent_hiring_what_if_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text)'::regprocedure,
      'private.assert_agent_promise_recovery_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.assert_agent_sales_truth_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.assert_agent_payroll_readiness_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure
    )
      and (
        procedure.provolatile <> 's'
        or not procedure.prosecdef
        or procedure.proconfig is distinct from array['search_path=""']::text[]
      )
  ) then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_BRIDGE_SHAPE_INVALID'
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
      'private.assert_agent_hiring_what_if_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text)'::regprocedure,
      'private.assert_agent_promise_recovery_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.assert_agent_sales_truth_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.assert_agent_payroll_readiness_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.assert_agent_recurring_service_price_change_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.mcp_oauth_labels_for_scopes(text[],text)'::regprocedure,
      'private.agent_price_preview_label_is_safe(text)'::regprocedure,
      'private.assert_agent_recurring_service_price_change_catalog()'::regprocedure
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
      'public.assert_agent_recurring_service_price_change_authority_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'public.read_agent_recurring_service_price_change_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,text,text,text,integer,text,uuid[])'::regprocedure
    )
      and access.privilege_type = 'EXECUTE'
      and access.grantee <> procedure.proowner
      and access.grantee is distinct from 'service_role'::regrole::oid
  ) then
    raise exception 'AGENT_RECURRING_SERVICE_PRICE_CHANGE_FUNCTION_ACL_INVALID'
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_agent_recurring_service_price_change_catalog()
  from public, anon, authenticated, service_role;

select private.assert_agent_recurring_service_price_change_catalog();

commit;
