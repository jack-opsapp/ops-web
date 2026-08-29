begin;

set local timezone = 'UTC';

-- Task 15 canonical payment read body. Public access stays service-role-only;
-- every statement re-proves OAuth, full finance, invoice/job visibility,
-- exact revisions, bounded physical work, and privacy-safe projections.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_currency_minor_exponent_or_null(text)'),
      ('function', 'private.agent_p2_sales_hash_ref(text,jsonb)'),
      ('function', 'private.agent_p2_sales_money_minor_or_null_v1(numeric,text)'),
      ('function', 'private.agent_p2_sales_rfc3339_or_null_v1(timestamp with time zone)'),
      ('function', 'auth.role()'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_operational_read_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.clients'),
      ('table', 'public.opportunities'),
      ('table', 'public.projects'),
      ('table', 'public.invoices'),
      ('table', 'public.payments')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_payment_reads_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_payment_expected_candidate_v1(
  p_permissions jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_finance_scope text;
  v_invoice_scope text;
  v_pipeline_scope text;
  v_projects_scope text;
  v_resolved jsonb;
  v_groups jsonb;
begin
  if p_permissions is null
     or pg_catalog.jsonb_typeof(p_permissions) is distinct from 'object' then
    return null;
  end if;

  v_finance_scope := p_permissions ->> 'finances.view';
  v_invoice_scope := p_permissions ->> 'invoices.view';
  v_pipeline_scope := p_permissions ->> 'pipeline.view';
  v_projects_scope := p_permissions ->> 'projects.view';

  if v_finance_scope is distinct from 'all'
     or v_invoice_scope not in ('all', 'assigned') then
    return null;
  end if;

  v_resolved := pg_catalog.jsonb_build_object(
    'finances.view', 'all',
    'invoices.view', v_invoice_scope
  );
  if v_pipeline_scope in ('all', 'assigned') then
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'pipeline.view', v_pipeline_scope
    );
  end if;
  if v_projects_scope in ('all', 'assigned') then
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'projects.view', v_projects_scope
    );
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(candidate.group_index order by candidate.group_index),
           '[]'::jsonb
         )
    into v_groups
  from (
    select 0 as group_index
    where v_pipeline_scope in ('all', 'assigned')
    union all
    select 1
    where v_projects_scope in ('all', 'assigned')
    union all
    select 2
    where v_invoice_scope = 'all'
  ) candidate;

  if pg_catalog.jsonb_array_length(v_groups) = 0 then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'variant_key', 'payment',
    'required_oauth_scopes',
      pg_catalog.jsonb_build_array('ops.payments.read'),
    'resolved_permission_scopes', v_resolved,
    'satisfied_permission_group_indexes', v_groups
  );
end;
$function$;

create or replace function private.agent_p2_payment_source_v1(
  p_company_id uuid,
  p_invoice_id uuid,
  p_client_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_start_date date,
  p_end_date date,
  p_method_categories text[],
  p_reconciliation_states text[],
  p_currency_code text,
  p_read_at timestamptz,
  p_source_limit integer
) returns table (
  payment_id uuid,
  payment_item jsonb,
  authority_path text,
  opportunity_id uuid,
  project_id uuid,
  source_invalid boolean,
  order_payment_date date
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', p_read_at
     )
     or extract(year from p_read_at at time zone 'UTC')
          not between 1 and 9999 then
    raise exception 'agent_payment_read_invalid' using errcode = '22023';
  end if;

  return query
  with bounded_source as materialized (
    select source.id,
           source.company_id,
           source.invoice_id,
           source.client_id,
           source.amount,
           source.payment_method,
           source.payment_date,
           source.voided_at,
           invoice.id as active_invoice_id,
           coalesce(invoice.client_ref, invoice.client_id)
             as invoice_client_id,
           invoice.client_ref as invoice_client_ref,
           invoice.client_id as invoice_legacy_client_id,
           invoice.opportunity_id as declared_opportunity_id,
           coalesce(invoice.project_ref, invoice.project_id)
             as declared_project_id,
           invoice.project_ref as invoice_project_ref,
           invoice.project_id as invoice_legacy_project_id,
           case
             when source.payment_method in ('ach', 'bank_transfer')
               then 'bank'
             when source.payment_method in (
               'credit_card', 'debit_card', 'stripe'
             ) then 'card'
             when source.payment_method = 'cash' then 'cash'
             when source.payment_method = 'check' then 'check'
             else 'other'
           end as normalized_method_category,
           case when source.voided_at is null
             then 'applied' else 'voided'
           end as normalized_reconciliation_state
    from public.payments source
    left join public.invoices invoice
      on invoice.id = source.invoice_id
     and invoice.company_id = p_company_id
     and invoice.deleted_at is null
    where source.company_id = p_company_id
      and (p_invoice_id is null or source.invoice_id = p_invoice_id)
      and (p_client_id is null or source.client_id = p_client_id)
      and (p_start_date is null or source.payment_date >= p_start_date)
      and (p_end_date is null or source.payment_date <= p_end_date)
      and case
            when source.payment_method in ('ach', 'bank_transfer')
              then 'bank'
            when source.payment_method in (
              'credit_card', 'debit_card', 'stripe'
            ) then 'card'
            when source.payment_method = 'cash' then 'cash'
            when source.payment_method = 'check' then 'check'
            else 'other'
          end = any(p_method_categories)
      and case when source.voided_at is null
            then 'applied' else 'voided'
          end = any(p_reconciliation_states)
      and (
        p_job_kind is null
        or p_job_kind = 'opportunity'
           and invoice.opportunity_id = p_job_id
           and coalesce(invoice.project_ref, invoice.project_id) is null
        or p_job_kind = 'project'
           and coalesce(invoice.project_ref, invoice.project_id) = p_job_id
      )
    order by source.payment_date desc, source.id
    limit p_source_limit
  ), joined_source as materialized (
    select source.*,
           client.id as active_client_id,
           opportunity.id as active_opportunity_id,
           project.id as active_project_id,
           case
             when project.id is not null then 'project'
             when opportunity.id is not null then 'opportunity'
             else 'unlinked'
           end as selected_authority_path,
           private.agent_p2_sales_money_minor_or_null_v1(
             source.amount,
             p_currency_code
           ) as amount_minor,
           case when source.voided_at is null then null
             else private.agent_p2_sales_rfc3339_or_null_v1(
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 source.voided_at,
                 timestamptz '2000-01-01 00:00:00+00'
               )
             )
           end as safe_voided_at
    from bounded_source source
    left join public.clients client
      on client.id = source.client_id
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    left join public.opportunities opportunity
      on opportunity.id = source.declared_opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    left join public.projects project
      on project.id = source.declared_project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
  )
  select source.id,
         pg_catalog.jsonb_build_object(
           'payment_ref', pg_catalog.jsonb_build_object(
             'kind', 'payment', 'id', source.id
           ),
           'invoice_ref', pg_catalog.jsonb_build_object(
             'kind', 'invoice', 'id', source.active_invoice_id
           ),
           'customer_ref', pg_catalog.jsonb_build_object(
             'kind', 'customer', 'id', source.active_client_id
           ),
           'job_ref', case source.selected_authority_path
             when 'project' then pg_catalog.jsonb_build_object(
               'kind', 'project', 'id', source.active_project_id
             )
             when 'opportunity' then pg_catalog.jsonb_build_object(
               'kind', 'opportunity', 'id', source.active_opportunity_id
             )
             else null
           end,
           'amount', pg_catalog.jsonb_build_object(
             'amount_minor', source.amount_minor,
             'currency', p_currency_code
           ),
           'payment_date', pg_catalog.to_char(
             source.payment_date, 'YYYY-MM-DD'
           ),
           'method_category', source.normalized_method_category,
           'reconciliation_state',
             source.normalized_reconciliation_state,
           'voided_at', source.safe_voided_at,
           'content_kind', 'untrusted_business_data'
         ),
         source.selected_authority_path,
         source.active_opportunity_id,
         source.active_project_id,
         source.active_invoice_id is null
           or source.active_client_id is null
           or source.invoice_client_id is null
           or source.invoice_client_id is distinct from source.client_id
           or source.invoice_client_ref is not null
              and source.invoice_legacy_client_id is not null
              and source.invoice_client_ref is distinct from
                    source.invoice_legacy_client_id
           or source.declared_project_id is not null
              and source.active_project_id is null
           or source.declared_opportunity_id is not null
              and source.active_opportunity_id is null
           or source.invoice_project_ref is not null
              and source.invoice_legacy_project_id is not null
              and source.invoice_project_ref is distinct from
                    source.invoice_legacy_project_id
           or source.payment_method is not null
              and source.payment_method not in (
                'credit_card', 'debit_card', 'ach', 'cash', 'check',
                'bank_transfer', 'stripe', 'other'
              )
           or source.amount is null
           or not (source.amount > 0)
           or source.amount_minor is null
           or source.payment_date is null
           or not pg_catalog.isfinite(source.payment_date)
           or extract(year from source.payment_date) not between 1 and 9999
           or source.voided_at is not null
              and (
                source.safe_voided_at is null
                or source.voided_at > p_read_at
              ),
         source.payment_date
  from joined_source source
  order by source.payment_date desc, source.id;
end;
$function$;

create or replace function private.agent_p2_payment_authorized_path_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_candidate jsonb,
  p_authority_path text,
  p_opportunity_id uuid,
  p_project_id uuid
) returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if p_actor_user_id is null
     or p_company_id is null
     or p_candidate is null
     or pg_catalog.jsonb_typeof(p_candidate) is distinct from 'object'
     or p_candidate ->> 'financeScope' is null
     or not (p_candidate ->> 'financeScope' = 'all')
     or p_candidate ->> 'invoiceScope' is null
     or p_candidate ->> 'invoiceScope' not in ('all', 'assigned')
     or p_authority_path not in ('opportunity', 'project', 'unlinked') then
    return false;
  end if;

  if p_authority_path = 'opportunity' then
    return p_opportunity_id is not null
      and p_project_id is null
      and p_candidate ->> 'pipelineScope' in ('all', 'assigned')
      and p_candidate -> 'satisfiedPermissionGroupIndexes' @> '[0]'::jsonb
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'opportunity',
        p_opportunity_id,
        'view'
      );
  end if;

  if p_authority_path = 'project' then
    return p_project_id is not null
      and p_candidate ->> 'projectsScope' in ('all', 'assigned')
      and p_candidate -> 'satisfiedPermissionGroupIndexes' @> '[1]'::jsonb
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        p_project_id,
        'view'
      );
  end if;

  return p_opportunity_id is null
    and p_project_id is null
    and p_candidate ->> 'invoiceScope' = 'all'
    and p_candidate -> 'satisfiedPermissionGroupIndexes' @> '[2]'::jsonb;
end;
$function$;

create or replace function private.agent_p2_payment_proof_candidate_v1(
  p_candidate jsonb
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select case
    when p_candidate is null
      or pg_catalog.jsonb_typeof(p_candidate) is distinct from 'object'
      then null
    else pg_catalog.jsonb_build_object(
      'variantKey', p_candidate ->> 'variant_key',
      'requiredOAuthScopes', p_candidate -> 'required_oauth_scopes',
      'resolvedPermissionScopes',
        p_candidate -> 'resolved_permission_scopes',
      'satisfiedPermissionGroupIndexes',
        p_candidate -> 'satisfied_permission_group_indexes',
      'financeScope',
        p_candidate -> 'resolved_permission_scopes' ->> 'finances.view',
      'invoiceScope',
        p_candidate -> 'resolved_permission_scopes' ->> 'invoices.view',
      'pipelineScope',
        p_candidate -> 'resolved_permission_scopes' ->> 'pipeline.view',
      'projectsScope',
        p_candidate -> 'resolved_permission_scopes' ->> 'projects.view'
    )
  end
$function$;

create or replace function private.agent_p2_payment_read_context_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidate jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_permissions jsonb;
  v_snapshot_revision text;
  v_expected_candidate jsonb;
  v_result jsonb;
begin
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_granted_scope_ceiling is null
     or pg_catalog.cardinality(p_granted_scope_ceiling) < 1
     or p_registered_permission_keys is null
     or p_authorization_candidate is null
     or pg_catalog.jsonb_typeof(p_authorization_candidate)
          is distinct from 'object'
     or not ('ops.payments.read' = any(p_granted_scope_ceiling))
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(scope.value order by scope.value)
       from (
         select distinct source.value
         from pg_catalog.unnest(p_granted_scope_ceiling) source(value)
       ) scope
     )
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from (
         select distinct source.value
         from pg_catalog.unnest(p_registered_permission_keys) source(value)
       ) key
     ) then
    return null;
  end if;

  select authority.permission_snapshot_revision,
         coalesce(
           pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',
             permission.value ->> 'scope'
             order by permission.value ->> 'permission'
           ) filter (
             where permission.value ->> 'permission' is not null
               and permission.value ->> 'scope' is not null
           ),
           '{}'::jsonb
         )
    into v_snapshot_revision, v_permissions
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    p_registered_permission_keys
  ) authority
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true
  group by authority.permission_snapshot_revision;

  v_expected_candidate :=
    private.agent_p2_payment_expected_candidate_v1(v_permissions);
  if v_snapshot_revision is distinct from p_permission_snapshot_revision
     or v_permissions ->> 'finances.view' is distinct from 'all'
     or v_permissions ->> 'invoices.view' not in ('all', 'assigned')
     or p_authorization_candidate is distinct from v_expected_candidate then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
           'permissions', v_permissions,
           'currency_code', pg_catalog.upper(company.currency_code),
           'minor_exponent',
             private.agent_currency_minor_exponent_or_null(
               pg_catalog.upper(company.currency_code)
             ),
           'source_revisions', pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'legacy_operational',
               'source_revision', legacy_revision.source_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'payments',
               'source_revision', payment_revision.source_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'sales_documents',
               'source_revision', sales_revision.source_revision
             )
           ),
           'proof_authorization_candidate',
             private.agent_p2_payment_proof_candidate_v1(
               v_expected_candidate
             )
         )
    into v_result
  from private.mcp_oauth_grants grant_row
  join private.mcp_oauth_clients oauth_client
    on oauth_client.client_id = grant_row.client_id
   and oauth_client.disabled_at is null
   and grant_row.scopes <@ oauth_client.scope_ceiling
   and grant_row.consent_catalog_revision =
         oauth_client.consent_catalog_revision
   and grant_row.exposure_revision = oauth_client.exposure_revision
  join public.companies company
    on company.id = p_company_id
   and company.deleted_at is null
  join private.agent_operational_read_revisions legacy_revision
    on legacy_revision.company_id = p_company_id
   and legacy_revision.source_revision between 0 and 9007199254740991
  join private.agent_read_domain_revisions payment_revision
    on payment_revision.company_id = p_company_id
   and payment_revision.domain = 'payments'
   and payment_revision.source_revision between 0 and 9007199254740991
  join private.agent_read_domain_revisions sales_revision
    on sales_revision.company_id = p_company_id
   and sales_revision.domain = 'sales_documents'
   and sales_revision.source_revision between 0 and 9007199254740991
  where grant_row.id = p_oauth_grant_id
    and grant_row.user_id = p_actor_user_id
    and grant_row.company_id = p_company_id
    and grant_row.client_id = p_oauth_client_id
    and grant_row.revision = p_grant_revision
    and grant_row.revoked_at is null
    and grant_row.scopes = p_granted_scope_ceiling
    and array['ops.payments.read']::text[] <@ grant_row.scopes
    and grant_row.accepted_labels =
      private.mcp_oauth_labels_for_scopes(
        grant_row.scopes,
        grant_row.consent_catalog_revision
      );

  if v_result -> 'proof_authorization_candidate' = 'null'::jsonb then
    return null;
  end if;
  return v_result;
end;
$function$;

create or replace function private.agent_p2_payment_list_v1(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidate jsonb,
  p_invoice_id uuid,
  p_client_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_start_date date,
  p_end_date date,
  p_method_categories text[],
  p_reconciliation_states text[],
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_payment_date date,
  p_after_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_currency_code text;
  v_read_at timestamptz;
  v_result jsonb;
begin
  if p_request_id is null
     or pg_catalog.char_length(p_request_id) not between 1 and 256
     or p_capability_manifest_revision is distinct from
          '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'list_payments'
     or p_capability_revision is distinct from
          'list_payments:2026-08-22.v1'
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or (p_job_kind is null) is distinct from (p_job_id is null)
     or p_job_kind is not null
        and p_job_kind not in ('opportunity', 'project')
     or (p_start_date is null) is distinct from (p_end_date is null)
     or p_start_date is not null and (
       not pg_catalog.isfinite(p_start_date)
       or not pg_catalog.isfinite(p_end_date)
       or extract(year from p_start_date) not between 1 and 9999
       or extract(year from p_end_date) not between 1 and 9999
       or p_start_date > p_end_date
       or p_end_date - p_start_date > 366
     )
     or p_method_categories is distinct from (
       select pg_catalog.array_agg(
                category.value
                order by pg_catalog.array_position(
                  array['bank','card','cash','check','other']::text[],
                  category.value
                )
              )
       from (
         select distinct source.value
         from pg_catalog.unnest(p_method_categories) source(value)
         where source.value = any(
           array['bank','card','cash','check','other']::text[]
         )
       ) category
     )
     or p_reconciliation_states is distinct from (
       select pg_catalog.array_agg(
                state.value
                order by pg_catalog.array_position(
                  array['applied','voided']::text[],
                  state.value
                )
              )
       from (
         select distinct source.value
         from pg_catalog.unnest(p_reconciliation_states) source(value)
         where source.value = any(array['applied','voided']::text[])
       ) state
     )
     or p_cursor_source_revisions is null
     or (p_cursor_read_at is null) is distinct from (
       p_after_payment_date is null
       and p_after_id is null
       and p_cursor_source_revisions = '[]'::jsonb
     )
     or p_cursor_read_at is not null and (
       not pg_catalog.isfinite(p_cursor_read_at)
       or p_cursor_read_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_cursor_read_at
       )
       or extract(year from p_cursor_read_at at time zone 'UTC')
            not between 1 and 9999
       or p_after_payment_date is null
       or not pg_catalog.isfinite(p_after_payment_date)
       or extract(year from p_after_payment_date) not between 1 and 9999
       or p_after_id is null
       or pg_catalog.jsonb_typeof(p_cursor_source_revisions)
            is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_cursor_source_revisions) <> 3
       or p_cursor_source_revisions #>> '{0,domain}' <>
            'legacy_operational'
       or p_cursor_source_revisions #>> '{1,domain}' <> 'payments'
       or p_cursor_source_revisions #>> '{2,domain}' <>
            'sales_documents'
       or pg_catalog.jsonb_typeof(
            p_cursor_source_revisions #> '{0,source_revision}'
          ) is distinct from 'number'
       or pg_catalog.jsonb_typeof(
            p_cursor_source_revisions #> '{1,source_revision}'
          ) is distinct from 'number'
       or pg_catalog.jsonb_typeof(
            p_cursor_source_revisions #> '{2,source_revision}'
          ) is distinct from 'number'
       or (p_cursor_source_revisions #>> '{0,source_revision}')
            !~ '^(0|[1-9][0-9]{0,15})$'
       or (p_cursor_source_revisions #>> '{1,source_revision}')
            !~ '^(0|[1-9][0-9]{0,15})$'
       or (p_cursor_source_revisions #>> '{2,source_revision}')
            !~ '^(0|[1-9][0-9]{0,15})$'
       or (p_cursor_source_revisions -> 0) -
            array['domain','source_revision']::text[] <> '{}'::jsonb
       or (p_cursor_source_revisions -> 1) -
            array['domain','source_revision']::text[] <> '{}'::jsonb
       or (p_cursor_source_revisions -> 2) -
            array['domain','source_revision']::text[] <> '{}'::jsonb
     ) then
    raise exception 'agent_payment_read_invalid' using errcode = '22023';
  end if;

  v_context := private.agent_p2_payment_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidate
  );
  if v_context is null then
    raise exception 'agent_payment_read_unauthorized' using errcode = '42501';
  end if;
  v_currency_code := v_context ->> 'currency_code';
  if v_context -> 'minor_exponent' = 'null'::jsonb
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'agent_payment_source_data_invalid'
      using errcode = '22000';
  end if;

  if p_cursor_read_at is not null
     and p_cursor_source_revisions is distinct from
       v_context -> 'source_revisions' then
    raise exception 'agent_payment_read_stale' using errcode = '40001';
  end if;
  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

  with raw_source as materialized (
    select source.*
    from private.agent_p2_payment_source_v1(
      p_company_id,
      p_invoice_id,
      p_client_id,
      p_job_kind,
      p_job_id,
      p_start_date,
      p_end_date,
      p_method_categories,
      p_reconciliation_states,
      v_currency_code,
      v_read_at,
      p_source_limit
    ) source
  ), raw_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from raw_source
  ), candidate_source as materialized (
    select source.*
    from raw_source source
    cross join raw_state state
    where state.source_count < p_source_limit
      and source.payment_item is not null
      and (
        p_after_payment_date is null
        or source.order_payment_date < p_after_payment_date
        or source.order_payment_date = p_after_payment_date
           and source.payment_id > p_after_id
      )
  ), authorized_source as materialized (
    select source.*
    from candidate_source source
    where private.agent_p2_payment_authorized_path_v1(
      p_actor_user_id,
      p_company_id,
      v_context -> 'proof_authorization_candidate',
      source.authority_path,
      source.opportunity_id,
      source.project_id
    )
  ), authorized_state as materialized (
    select coalesce(
             pg_catalog.bool_or(source.source_invalid),
             false
           ) as source_invalid
    from authorized_source source
  ), bounded_source as materialized (
    select source.*,
           pg_catalog.row_number() over (
             order by source.order_payment_date desc, source.payment_id
           ) as ordinality
    from authorized_source source
    where not source.source_invalid
    order by source.order_payment_date desc, source.payment_id
    limit p_page_fetch_limit
  ), page_state as materialized (
    select pg_catalog.count(*)::integer as fetched_count,
           pg_catalog.count(*) > p_item_limit as source_has_more
    from bounded_source
  ), query_projection as materialized (
    select pg_catalog.jsonb_build_object(
             'invoice_ref', case when p_invoice_id is null then null
               else pg_catalog.jsonb_build_object(
                 'kind', 'invoice', 'id', p_invoice_id
               )
             end,
             'customer_ref', case when p_client_id is null then null
               else pg_catalog.jsonb_build_object(
                 'kind', 'customer', 'id', p_client_id
               )
             end,
             'job_ref', case when p_job_id is null then null
               else pg_catalog.jsonb_build_object(
                 'kind', p_job_kind, 'id', p_job_id
               )
             end,
             'payment_date_window', case when p_start_date is null then null
               else pg_catalog.jsonb_build_object(
                 'start_date', pg_catalog.to_char(
                   p_start_date, 'YYYY-MM-DD'
                 ),
                 'end_date', pg_catalog.to_char(p_end_date, 'YYYY-MM-DD')
               )
             end,
             'method_categories',
               pg_catalog.to_jsonb(p_method_categories),
             'reconciliation_states',
               pg_catalog.to_jsonb(p_reconciliation_states)
           ) as query
  ), cursor_projection as materialized (
    select case when p_cursor_read_at is null then null::jsonb
           else pg_catalog.jsonb_build_object(
             'order', pg_catalog.jsonb_build_array(
               pg_catalog.to_char(p_after_payment_date, 'YYYY-MM-DD'),
               p_after_id
             ),
             'tie_breaker', p_after_id
           ) end as predecessor
  ), proof_context as materialized (
    select pg_catalog.jsonb_build_object(
             'company_id', p_company_id,
             'actor_user_id', p_actor_user_id,
             'oauth_grant_id', p_oauth_grant_id,
             'oauth_client_id', p_oauth_client_id,
             'grant_revision', p_grant_revision,
             'granted_scope_ceiling',
               pg_catalog.to_jsonb(p_granted_scope_ceiling),
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'ranking_revision', 'payment-ranking:2026-08-22.v1',
             'authorization_candidate',
               v_context -> 'proof_authorization_candidate',
             'query', query.query,
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at)
             end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', cursor.predecessor,
             'read_at', private.agent_rfc3339_utc(v_read_at),
             'source_revisions', v_context -> 'source_revisions',
             'source_inspected', raw.source_count,
             'source_has_more', page.source_has_more
           ) as context
    from query_projection query
    cross join cursor_projection cursor
    cross join raw_state raw
    cross join page_state page
  ), packaged_rows as materialized (
    select source.ordinality,
           source.payment_id,
           source.order_payment_date,
           source.payment_item,
           source.authority_path,
           private.agent_p2_sales_hash_ref(
             'ops_proof:v1:',
             proof.context || pg_catalog.jsonb_build_object(
               'proof_kind', 'payment_list_entity',
               'authority_path', source.authority_path,
               'item', source.payment_item
             )
           ) as proof_ref,
           private.agent_p2_sales_hash_ref(
             'ops_evidence:v1:',
             proof.context || pg_catalog.jsonb_build_object(
               'evidence_kind', 'payment_list_item',
               'authority_path', source.authority_path,
               'payment_ref', source.payment_item -> 'payment_ref',
               'payment_date', source.payment_item -> 'payment_date'
             )
           ) as evidence_ref
    from bounded_source source
    cross join proof_context proof
    where source.ordinality <= p_item_limit
  ), aggregate_rows as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'item', row.payment_item,
                 'authority_path', row.authority_path,
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref,
                 'predecessor', pg_catalog.jsonb_build_object(
                   'order', pg_catalog.jsonb_build_array(
                     pg_catalog.to_char(
                       row.order_payment_date, 'YYYY-MM-DD'
                     ),
                     row.payment_id
                   ),
                   'tie_breaker', row.payment_id
                 )
               ) order by row.ordinality
             ),
             '[]'::jsonb
           ) as rows,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'payment_ref', row.payment_item -> 'payment_ref',
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref
               ) order by row.ordinality
             ),
             '[]'::jsonb
           ) as children
    from packaged_rows row
  ), final_projection as materialized (
    select pg_catalog.jsonb_build_object(
             'company_id', p_company_id,
             'actor_user_id', p_actor_user_id,
             'oauth_grant_id', p_oauth_grant_id,
             'oauth_client_id', p_oauth_client_id,
             'grant_revision', p_grant_revision,
             'granted_scope_ceiling',
               pg_catalog.to_jsonb(p_granted_scope_ceiling),
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'authorization_candidate', p_authorization_candidate,
             'query', query.query,
             'ranking_revision', 'payment-ranking:2026-08-22.v1',
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at)
             end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', cursor.predecessor,
             'read_at', private.agent_rfc3339_utc(v_read_at),
             'source_revisions', v_context -> 'source_revisions',
             'source_inspected', raw.source_count,
             'source_has_more', page.source_has_more,
             'rows', aggregate.rows,
             'collection_proof_ref', private.agent_p2_sales_hash_ref(
               'ops_proof:v1:',
               proof.context || pg_catalog.jsonb_build_object(
                 'proof_kind', 'payment_list_collection',
                 'returned_count',
                   pg_catalog.jsonb_array_length(aggregate.rows),
                 'has_more', page.source_has_more,
                 'children', aggregate.children
               )
             ),
             '_source_bound', raw.source_count >= p_source_limit,
             '_source_invalid', authorized.source_invalid
           ) as projection
    from query_projection query
    cross join cursor_projection cursor
    cross join proof_context proof
    cross join raw_state raw
    cross join page_state page
    cross join authorized_state authorized
    cross join aggregate_rows aggregate
  )
  select projection into v_result from final_projection;

  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_payment_source_query_bound' using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_payment_source_data_invalid' using errcode = '22000';
  end if;
  return v_result - array['_source_bound','_source_invalid'];
end;
$function$;

create or replace function private.agent_p2_payment_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidate jsonb,
  p_read_at timestamptz,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_source_count integer;
  v_source_invalid boolean;
  v_totals_invalid boolean;
  v_summaries jsonb;
begin
  if p_source_limit is distinct from 501
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', p_read_at
     )
     or extract(year from p_read_at at time zone 'UTC')
          not between 1 and 9999 then
    raise exception 'agent_payment_read_invalid' using errcode = '22023';
  end if;

  v_context := private.agent_p2_payment_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidate
  );
  if v_context is null then
    raise exception 'agent_payment_read_unauthorized' using errcode = '42501';
  end if;
  if v_context -> 'minor_exponent' = 'null'::jsonb
     or v_context ->> 'currency_code' is null
     or v_context ->> 'currency_code' !~ '^[A-Z]{3}$' then
    raise exception 'agent_payment_source_data_invalid'
      using errcode = '22000';
  end if;

  with raw_source as materialized (
    select source.*
    from private.agent_p2_payment_source_v1(
      p_company_id,
      null,
      null,
      null,
      null,
      null,
      null,
      array['bank','card','cash','check','other']::text[],
      array['applied','voided']::text[],
      v_context ->> 'currency_code',
      p_read_at,
      p_source_limit
    ) source
  ), authorized_source as materialized (
    select source.*
    from raw_source source
    where private.agent_p2_payment_authorized_path_v1(
      p_actor_user_id,
      p_company_id,
      v_context -> 'proof_authorization_candidate',
      source.authority_path,
      source.opportunity_id,
      source.project_id
    )
  ), states(reconciliation_state) as (
    values ('applied'::text), ('voided'::text)
  ), totals as materialized (
    select state.reconciliation_state,
           pg_catalog.count(source.payment_id)::integer as payment_count,
           coalesce(
             pg_catalog.sum(
               (source.payment_item #>> '{amount,amount_minor}')::numeric
             ),
             0::numeric
           ) as amount_minor
    from states state
    left join authorized_source source
      on source.payment_item ->> 'reconciliation_state' =
           state.reconciliation_state
     and not source.source_invalid
    group by state.reconciliation_state
  )
  select (select pg_catalog.count(*)::integer from raw_source),
         coalesce(
           (select pg_catalog.bool_or(source.source_invalid)
            from authorized_source source),
           false
         ),
         coalesce(
           pg_catalog.bool_or(
             total.amount_minor <> pg_catalog.trunc(total.amount_minor)
             or total.amount_minor < 0
             or total.amount_minor > 9007199254740991
           ),
           false
         ),
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'reconciliation_state', total.reconciliation_state,
               'payment_count', total.payment_count,
               'amount', pg_catalog.jsonb_build_object(
                 'amount_minor', total.amount_minor::bigint,
                 'currency', v_context ->> 'currency_code'
               )
             ) order by case total.reconciliation_state
               when 'applied' then 0 else 1
             end
           ),
           '[]'::jsonb
         )
    into v_source_count,
         v_source_invalid,
         v_totals_invalid,
         v_summaries
  from totals total;

  if v_source_count >= p_source_limit then
    raise exception 'agent_payment_source_query_bound' using errcode = '54000';
  end if;
  if v_source_invalid or v_totals_invalid then
    raise exception 'agent_payment_source_data_invalid' using errcode = '22000';
  end if;

  return pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_revisions', v_context -> 'source_revisions',
    'source_inspected', v_source_count,
    'summaries', v_summaries,
    'content_kind', 'untrusted_business_data'
  );
end;
$function$;

create or replace function public.read_agent_payments_as_system(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidate jsonb,
  p_invoice_id uuid,
  p_client_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_start_date date,
  p_end_date date,
  p_method_categories text[],
  p_reconciliation_states text[],
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_payment_date date,
  p_after_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'agent_payment_service_role_required'
      using errcode = '42501';
  end if;
  return private.agent_p2_payment_list_v1(
    p_request_id,
    p_company_id,
    p_actor_user_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_manifest_revision,
    p_capability_id,
    p_capability_revision,
    p_authorization_candidate,
    p_invoice_id,
    p_client_id,
    p_job_kind,
    p_job_id,
    p_start_date,
    p_end_date,
    p_method_categories,
    p_reconciliation_states,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_payment_date,
    p_after_id
  );
end;
$function$;

revoke all on function private.agent_p2_payment_expected_candidate_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_payment_source_v1(
  uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,
  timestamp with time zone,integer
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_payment_authorized_path_v1(
  uuid,uuid,jsonb,text,uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_payment_proof_candidate_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_payment_read_context_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_payment_list_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,
  timestamp with time zone,jsonb,date,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_payment_attention_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,
  timestamp with time zone,integer
) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_payments_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,
  timestamp with time zone,jsonb,date,uuid
) from public, anon, authenticated, service_role;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_payment_expected_candidate_v1(jsonb)',
    'private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)',
    'private.agent_p2_payment_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)',
    'private.agent_p2_payment_proof_candidate_v1(jsonb)',
    'private.agent_p2_payment_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb)',
    'private.agent_p2_payment_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'private.agent_p2_payment_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,timestamp with time zone,integer)',
    'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_payment_acl_function_missing:%', v_signature
        using errcode = '55000';
    end if;
    execute pg_catalog.format(
      'alter function %s owner to current_user', v_signature
    );
    select function_row.proowner
      into v_function_owner
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_function_oid;

    for v_acl in
      select distinct acl.grantee,
             case when acl.grantee = 0 then 'public'
               else role_row.rolname end as role_name
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> v_function_owner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_payment_acl_role_missing:%', v_signature
          using errcode = '55000';
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name) end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_payments_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,
  timestamp with time zone,jsonb,date,uuid
) to service_role;

do $postflight$
declare
  v_signature text;
  v_valid boolean;
begin
  foreach v_signature in array array[
    'private.agent_p2_payment_expected_candidate_v1(jsonb)',
    'private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)',
    'private.agent_p2_payment_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)',
    'private.agent_p2_payment_proof_candidate_v1(jsonb)',
    'private.agent_p2_payment_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb)',
    'private.agent_p2_payment_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'private.agent_p2_payment_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,timestamp with time zone,integer)',
    'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_payment_reads_postflight_missing:%', v_signature
        using errcode = '55000';
    end if;
  end loop;

  select pg_catalog.count(*) = 7
     and pg_catalog.bool_and(not procedure.prosecdef)
     and pg_catalog.bool_and(procedure.provolatile = 's')
     and pg_catalog.bool_and(
       procedure.proconfig @> array['search_path=""']::text[]
     )
    into v_valid
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname in (
      'agent_p2_payment_expected_candidate_v1',
      'agent_p2_payment_source_v1',
      'agent_p2_payment_authorized_path_v1',
      'agent_p2_payment_proof_candidate_v1',
      'agent_p2_payment_read_context_v1',
      'agent_p2_payment_list_v1',
      'agent_p2_payment_attention_v1'
    );
  if not coalesce(v_valid, false) then
    raise exception 'agent_payment_private_function_catalog_invalid'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*) = 1
     and pg_catalog.bool_and(procedure.prosecdef)
     and pg_catalog.bool_and(procedure.provolatile = 's')
     and pg_catalog.bool_and(
       procedure.proconfig @> array['search_path=""']::text[]
     )
    into v_valid
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'read_agent_payments_as_system';
  if not coalesce(v_valid, false)
     or pg_catalog.has_function_privilege(
       'public',
       'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
       'EXECUTE'
     ) then
    raise exception 'agent_payment_public_function_acl_invalid'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
