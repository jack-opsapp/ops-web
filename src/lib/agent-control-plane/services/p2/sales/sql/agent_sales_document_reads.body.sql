begin;

set local timezone = 'UTC';

-- Task 14 canonical sales-document read body. Public functions remain
-- service-role-only; every private projection re-proves current authority,
-- revisions, bounded physical work, canonical money, and safe output fields.
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
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_read_domain_uuid_from_text(text)'),
      ('function', 'private.agent_currency_minor_exponent_or_null(text)'),
      ('function', 'private.agent_money_to_minor_units(numeric,text)'),
      ('function', 'auth.role()'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_operational_read_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.clients'),
      ('table', 'public.opportunities'),
      ('table', 'public.projects'),
      ('table', 'public.estimates'),
      ('table', 'public.invoices'),
      ('table', 'public.line_items'),
      ('table', 'public.payment_milestones')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_sales_document_reads_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_sales_hash_ref(
  p_prefix text,
  p_material jsonb
) returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
begin
  if p_prefix not in ('ops_proof:v1:', 'ops_evidence:v1:') then
    raise exception 'invalid_agent_sales_document_hash_prefix'
      using errcode = '22023';
  end if;
  return p_prefix || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(p_material),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

create or replace function private.agent_p2_sales_expected_candidate_v1(
  p_document_kind text,
  p_permissions jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_document_permission text;
  v_document_scope text;
  v_pipeline_scope text;
  v_projects_scope text;
  v_financial_scope text;
  v_resolved jsonb;
  v_groups jsonb;
begin
  if p_document_kind not in ('estimate', 'invoice')
     or p_permissions is null
     or pg_catalog.jsonb_typeof(p_permissions) is distinct from 'object' then
    return null;
  end if;

  v_document_permission := case p_document_kind
    when 'estimate' then 'estimates.view'
    else 'invoices.view'
  end;
  v_document_scope := p_permissions ->> v_document_permission;
  v_pipeline_scope := p_permissions ->> 'pipeline.view';
  v_projects_scope := p_permissions ->> 'projects.view';
  v_financial_scope := p_permissions ->> 'projects.view_financials';

  if v_document_scope not in ('all', 'assigned') then
    return null;
  end if;

  v_resolved := pg_catalog.jsonb_build_object(
    v_document_permission, v_document_scope
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
  if v_financial_scope = 'all' then
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'projects.view_financials', 'all'
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
      and v_financial_scope = 'all'
    union all
    select 2
    where v_document_scope = 'all'
  ) candidate;

  return pg_catalog.jsonb_build_object(
    'variant_key', p_document_kind,
    'required_oauth_scopes',
      pg_catalog.jsonb_build_array('ops.financial_documents.read'),
    'resolved_permission_scopes', v_resolved,
    'satisfied_permission_group_indexes', v_groups
  );
end;
$function$;

create or replace function private.agent_p2_sales_proof_candidates_v1(
  p_authorization_candidates jsonb,
  p_permissions jsonb
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variantKey', candidate.value ->> 'variant_key',
        'requiredOAuthScopes',
          candidate.value -> 'required_oauth_scopes',
        'resolvedPermissionScopes',
          candidate.value -> 'resolved_permission_scopes',
        'satisfiedPermissionGroupIndexes',
          candidate.value -> 'satisfied_permission_group_indexes',
        'documentScope',
          candidate.value -> 'resolved_permission_scopes' ->>
            case candidate.value ->> 'variant_key'
              when 'estimate' then 'estimates.view'
              else 'invoices.view'
            end,
        'pipelineScope',
          candidate.value -> 'resolved_permission_scopes' ->>
            'pipeline.view',
        'projectsScope',
          candidate.value -> 'resolved_permission_scopes' ->>
            'projects.view',
        'projectFinancialsScope',
          candidate.value -> 'resolved_permission_scopes' ->>
            'projects.view_financials'
      ) order by candidate.ordinality
    ),
    '[]'::jsonb
  )
  from pg_catalog.jsonb_array_elements(p_authorization_candidates)
    with ordinality candidate(value, ordinality)
  where candidate.value is not distinct from
    private.agent_p2_sales_expected_candidate_v1(
      candidate.value ->> 'variant_key',
      p_permissions
    );
$function$;

create or replace function private.agent_p2_sales_read_context_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidates jsonb,
  p_document_kinds text[]
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_permissions jsonb;
  v_snapshot_revision text;
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
     or p_registered_permission_keys is null
     or p_authorization_candidates is null
     or pg_catalog.jsonb_typeof(p_authorization_candidates)
          is distinct from 'array'
     or p_document_kinds is null
     or pg_catalog.cardinality(p_document_kinds) not between 1 and 2
     or not p_document_kinds <@ array['estimate', 'invoice']::text[]
     or p_document_kinds is distinct from (
       select pg_catalog.array_agg(kind.value order by kind.value)
       from (
         select distinct source.value
         from pg_catalog.unnest(p_document_kinds) source(value)
       ) kind
     )
     or pg_catalog.jsonb_array_length(p_authorization_candidates)
          <> pg_catalog.cardinality(p_document_kinds)
     or not ('ops.financial_documents.read' = any(p_granted_scope_ceiling))
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(
         scope.value order by scope.value collate "C"
       )
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

  if v_snapshot_revision is distinct from p_permission_snapshot_revision
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_authorization_candidates)
         with ordinality candidate(value, ordinality)
       where candidate.ordinality > pg_catalog.cardinality(p_document_kinds)
          or candidate.value is distinct from
               private.agent_p2_sales_expected_candidate_v1(
                 p_document_kinds[candidate.ordinality::integer],
                 v_permissions
               )
     ) then
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
               'domain', 'sales_documents',
               'source_revision', sales_revision.source_revision
             )
           ),
           'proof_authorization_candidates',
             private.agent_p2_sales_proof_candidates_v1(
               p_authorization_candidates,
               v_permissions
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
    and array['ops.financial_documents.read']::text[] <@ grant_row.scopes
    and grant_row.accepted_labels =
      private.mcp_oauth_labels_for_scopes(
        grant_row.scopes,
        grant_row.consent_catalog_revision
      );

  return v_result;
end;
$function$;

create or replace function private.agent_p2_sales_money_minor_or_null_v1(
  p_amount numeric,
  p_currency_code text
) returns bigint
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
begin
  return private.agent_money_to_minor_units(p_amount, p_currency_code);
exception
  when sqlstate '22003' or sqlstate '22023' then
    return null;
end;
$function$;

create or replace function private.agent_p2_sales_rfc3339_or_null_v1(
  p_value timestamptz
) returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.isfinite(p_value)
     or extract(year from p_value at time zone 'UTC') not between 1 and 9999
  then
    return null;
  end if;
  return private.agent_rfc3339_utc(p_value);
end;
$function$;

create or replace function private.agent_p2_sales_document_header_source_v1(
  p_company_id uuid,
  p_document_kinds text[],
  p_customer_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_document_id uuid,
  p_currency_code text,
  p_source_limit integer
) returns table (
  document_kind text,
  document_id uuid,
  document_header jsonb,
  authority_path text,
  opportunity_id uuid,
  project_id uuid,
  source_invalid boolean,
  order_updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  return query
  with source_union as materialized (
    (
    select 'estimate'::text as source_kind,
           estimate.id as source_id,
           estimate.company_id,
           estimate.opportunity_id as declared_opportunity_id,
           coalesce(
             estimate.project_ref,
             private.agent_read_domain_uuid_from_text(estimate.project_id)
           ) as declared_project_id,
           estimate.project_ref,
           estimate.project_id as legacy_project_id,
           coalesce(
             estimate.client_ref,
             estimate.client_id
           ) as declared_client_id,
           estimate.client_ref,
           estimate.client_id,
           estimate.estimate_number as document_number,
           estimate.title as title_value,
           estimate.status,
           estimate.issue_date,
           estimate.expiration_date,
           null::date as due_date,
           null::timestamptz as paid_at,
           estimate.total::numeric as total,
           null::numeric as amount_paid,
           null::numeric as balance_due,
           pg_catalog.date_bin(
             interval '1 millisecond',
             estimate.updated_at,
             timestamptz '2000-01-01 00:00:00+00'
           ) as updated_at
    from public.estimates estimate
    where 'estimate' = any(p_document_kinds)
      and estimate.company_id = p_company_id
      and estimate.deleted_at is null
      and not exists (
        select 1
        from public.clients parent_client
        where parent_client.id = coalesce(
                estimate.client_ref,
                estimate.client_id
              )
          and parent_client.company_id = p_company_id
          and (
            parent_client.deleted_at is not null
               and parent_client.merged_into_client_id is null
            or parent_client.merged_into_client_id is not null
               and exists (
                 select 1
                 from public.clients merge_target
                 where merge_target.id =
                       parent_client.merged_into_client_id
                   and merge_target.id is distinct from parent_client.id
                   and merge_target.company_id = p_company_id
                   and merge_target.deleted_at is null
                   and merge_target.merged_into_client_id is null
               )
          )
          and (
            estimate.client_ref is null
            or estimate.client_id is null
            or estimate.client_ref = estimate.client_id
          )
      )
      and (p_document_id is null or estimate.id = p_document_id)
    order by pg_catalog.date_bin(
               interval '1 millisecond',
               estimate.updated_at,
               timestamptz '2000-01-01 00:00:00+00'
             ) desc,
             estimate.id
    limit p_source_limit
    )

    union all

    (
    select 'invoice',
           invoice.id,
           invoice.company_id,
           invoice.opportunity_id,
           coalesce(invoice.project_ref, invoice.project_id),
           invoice.project_ref,
           invoice.project_id::text,
           coalesce(invoice.client_ref, invoice.client_id),
           invoice.client_ref,
           invoice.client_id,
           invoice.invoice_number,
           invoice.subject,
           invoice.status,
           invoice.issue_date,
           null::date,
           invoice.due_date,
           invoice.paid_at,
           invoice.total::numeric,
           invoice.amount_paid::numeric,
           invoice.balance_due::numeric,
           pg_catalog.date_bin(
             interval '1 millisecond',
             invoice.updated_at,
             timestamptz '2000-01-01 00:00:00+00'
           )
    from public.invoices invoice
    where 'invoice' = any(p_document_kinds)
      and invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and not exists (
        select 1
        from public.clients parent_client
        where parent_client.id = coalesce(
                invoice.client_ref,
                invoice.client_id
              )
          and parent_client.company_id = p_company_id
          and (
            parent_client.deleted_at is not null
               and parent_client.merged_into_client_id is null
            or parent_client.merged_into_client_id is not null
               and exists (
                 select 1
                 from public.clients merge_target
                 where merge_target.id =
                       parent_client.merged_into_client_id
                   and merge_target.id is distinct from parent_client.id
                   and merge_target.company_id = p_company_id
                   and merge_target.deleted_at is null
                   and merge_target.merged_into_client_id is null
               )
          )
          and (
            invoice.client_ref is null
            or invoice.client_id is null
            or invoice.client_ref = invoice.client_id
          )
      )
      and (p_document_id is null or invoice.id = p_document_id)
    order by pg_catalog.date_bin(
               interval '1 millisecond',
               invoice.updated_at,
               timestamptz '2000-01-01 00:00:00+00'
             ) desc,
             invoice.id
    limit p_source_limit
    )
  ), bounded_union as materialized (
    select source.*
    from source_union source
    order by source.updated_at desc, source.source_kind, source.source_id
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
           private.agent_p2_optional_canonical_text(
             source.document_number, 256, 1024, true
           ) as safe_document_number,
           case when source.title_value is null then null
             else private.agent_p2_optional_canonical_text(
               source.title_value, 256, 1024, true
             )
           end as safe_title
    from bounded_union source
    left join public.clients client
      on client.id = source.declared_client_id
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
  ), projected_source as materialized (
    select source.*,
           (p_customer_id is null
              or source.declared_client_id = p_customer_id)
           and (
             p_job_kind is null
             or p_job_kind = source.selected_authority_path
                and p_job_id = case p_job_kind
                  when 'project' then source.active_project_id
                  else source.active_opportunity_id
                end
           ) as matches_filter
    from joined_source source
  )
  select source.source_kind,
         source.source_id,
         case when source.matches_filter then case source.source_kind
           when 'estimate' then pg_catalog.jsonb_build_object(
             'document_ref', pg_catalog.jsonb_build_object(
               'kind', 'estimate', 'id', source.source_id
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
             'document_number', source.safe_document_number,
             'title', source.safe_title,
             'status', source.status,
             'issue_date', pg_catalog.to_char(source.issue_date, 'YYYY-MM-DD'),
             'expiration_date', case when source.expiration_date is null
               then null
               else pg_catalog.to_char(
                 source.expiration_date, 'YYYY-MM-DD'
               )
             end,
             'total', pg_catalog.jsonb_build_object(
               'amount_minor',
                 private.agent_p2_sales_money_minor_or_null_v1(
                   source.total, p_currency_code
                 ),
               'currency', p_currency_code
             ),
             'updated_at',
               private.agent_p2_sales_rfc3339_or_null_v1(source.updated_at),
             'content_kind', 'untrusted_business_data'
           )
           else pg_catalog.jsonb_build_object(
             'document_ref', pg_catalog.jsonb_build_object(
               'kind', 'invoice', 'id', source.source_id
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
             'document_number', source.safe_document_number,
             'title', source.safe_title,
             'status', source.status,
             'issue_date', pg_catalog.to_char(source.issue_date, 'YYYY-MM-DD'),
             'due_date', pg_catalog.to_char(source.due_date, 'YYYY-MM-DD'),
             'paid_at', case when source.paid_at is null then null
               else private.agent_p2_sales_rfc3339_or_null_v1(source.paid_at)
             end,
             'total', pg_catalog.jsonb_build_object(
               'amount_minor',
                 private.agent_p2_sales_money_minor_or_null_v1(
                   source.total, p_currency_code
                 ),
               'currency', p_currency_code
             ),
             'amount_paid', pg_catalog.jsonb_build_object(
               'amount_minor',
                 private.agent_p2_sales_money_minor_or_null_v1(
                   source.amount_paid, p_currency_code
                 ),
               'currency', p_currency_code
             ),
             'balance_due', pg_catalog.jsonb_build_object(
               'amount_minor',
                 private.agent_p2_sales_money_minor_or_null_v1(
                   source.balance_due, p_currency_code
                 ),
               'currency', p_currency_code
             ),
             'updated_at',
               private.agent_p2_sales_rfc3339_or_null_v1(source.updated_at),
             'content_kind', 'untrusted_business_data'
           )
         end else null end,
         source.selected_authority_path,
         source.active_opportunity_id,
         source.active_project_id,
         source.active_client_id is null
           or source.client_ref is not null
              and source.client_id is not null
              and source.client_ref is distinct from source.client_id
           or source.declared_project_id is not null
              and source.active_project_id is null
           or source.declared_opportunity_id is not null
              and source.active_opportunity_id is null
           or source.source_kind = 'estimate'
              and source.legacy_project_id is not null
              and private.agent_read_domain_uuid_from_text(
                source.legacy_project_id
              ) is null
           or source.project_ref is not null
              and source.legacy_project_id is not null
              and private.agent_read_domain_uuid_from_text(
                source.legacy_project_id
              ) is distinct from source.project_ref
           or source.safe_document_number is null
           or source.title_value is not null and source.safe_title is null
           or source.status is null
           or source.source_kind = 'estimate'
              and source.status not in (
                'approved', 'changes_requested', 'converted', 'declined',
                'draft', 'expired', 'sent', 'superseded', 'viewed'
              )
           or source.source_kind = 'invoice'
              and source.status not in (
                'awaiting_payment', 'draft', 'partially_paid', 'past_due',
                'paid', 'sent', 'void', 'written_off'
              )
           or source.issue_date is null
           or not pg_catalog.isfinite(source.issue_date)
           or extract(year from source.issue_date) not between 1 and 9999
           or source.total is null
           or private.agent_p2_sales_money_minor_or_null_v1(
                source.total, p_currency_code
              ) is null
           or source.source_kind = 'invoice' and (
                source.due_date is null
                or not pg_catalog.isfinite(source.due_date)
                or extract(year from source.due_date) not between 1 and 9999
                or source.amount_paid is null
                or source.balance_due is null
                or private.agent_p2_sales_money_minor_or_null_v1(
                     source.amount_paid, p_currency_code
                   ) is null
                or private.agent_p2_sales_money_minor_or_null_v1(
                     source.balance_due, p_currency_code
                   ) is null
              )
           or source.expiration_date is not null
              and (
                not pg_catalog.isfinite(source.expiration_date)
                or extract(year from source.expiration_date)
                     not between 1 and 9999
              )
           or private.agent_p2_sales_rfc3339_or_null_v1(
                source.updated_at
              ) is null
           or source.paid_at is not null
              and private.agent_p2_sales_rfc3339_or_null_v1(
                    source.paid_at
                  ) is null,
         source.updated_at
  from projected_source source
  order by source.updated_at desc, source.source_kind, source.source_id;
end;
$function$;

revoke all on function private.agent_p2_sales_hash_ref(text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_sales_money_minor_or_null_v1(numeric,text)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_sales_rfc3339_or_null_v1(timestamp with time zone)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_sales_expected_candidate_v1(text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_sales_proof_candidates_v1(jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_sales_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[])
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_sales_authorized_path_v1(
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
      and p_candidate ->> 'projectFinancialsScope' = 'all'
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
    and p_candidate ->> 'documentScope' = 'all'
    and p_candidate -> 'satisfiedPermissionGroupIndexes' @> '[2]'::jsonb;
end;
$function$;

revoke all on function private.agent_p2_sales_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_sales_document_list_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_document_kinds text[],
  p_customer_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_updated_at timestamptz,
  p_after_document_kind text,
  p_after_document_id uuid
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
  if p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'list_sales_documents'
     or p_capability_revision is distinct from
       'list_sales_documents:2026-08-22.v1'
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or (p_job_kind is null) is distinct from (p_job_id is null)
     or p_job_kind is not null and p_job_kind not in ('opportunity', 'project')
     or p_cursor_source_revisions is null
     or (p_cursor_read_at is null) is distinct from (
       p_after_updated_at is null
       and p_after_document_kind is null
       and p_after_document_id is null
       and p_cursor_source_revisions = '[]'::jsonb
     )
     or p_cursor_read_at is not null and (
       not pg_catalog.isfinite(p_cursor_read_at)
       or p_cursor_read_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_cursor_read_at
       )
       or extract(year from p_cursor_read_at at time zone 'UTC')
            not between 1 and 9999
       or p_after_updated_at is null
       or not pg_catalog.isfinite(p_after_updated_at)
       or p_after_updated_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_after_updated_at
       )
       or extract(year from p_after_updated_at at time zone 'UTC')
            not between 1 and 9999
       or p_after_document_kind not in ('estimate', 'invoice')
       or p_after_document_id is null
       or pg_catalog.jsonb_typeof(p_cursor_source_revisions)
            is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_cursor_source_revisions) <> 2
       or p_cursor_source_revisions #>> '{0,domain}' <>
            'legacy_operational'
       or p_cursor_source_revisions #>> '{1,domain}' <> 'sales_documents'
       or pg_catalog.jsonb_typeof(
            p_cursor_source_revisions #> '{0,source_revision}'
          ) is distinct from 'number'
       or pg_catalog.jsonb_typeof(
            p_cursor_source_revisions #> '{1,source_revision}'
          ) is distinct from 'number'
       or (p_cursor_source_revisions #>> '{0,source_revision}')
            !~ '^(0|[1-9][0-9]{0,15})$'
       or (p_cursor_source_revisions #>> '{1,source_revision}')
            !~ '^(0|[1-9][0-9]{0,15})$'
       or (p_cursor_source_revisions -> 0) -
            array['domain', 'source_revision']::text[] <> '{}'::jsonb
       or (p_cursor_source_revisions -> 1) -
            array['domain', 'source_revision']::text[] <> '{}'::jsonb
     ) then
    raise exception 'invalid_agent_sales_document_list_request'
      using errcode = '22023';
  end if;

  v_context := private.agent_p2_sales_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidates,
    p_document_kinds
  );
  if v_context is null then
    raise exception 'agent_sales_document_not_authorized'
      using errcode = '42501';
  end if;

  v_currency_code := v_context ->> 'currency_code';
  if v_context -> 'minor_exponent' = 'null'::jsonb
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'agent_sales_document_source_data_invalid'
      using errcode = '22023';
  end if;

  if p_cursor_read_at is not null
     and p_cursor_source_revisions is distinct from
       v_context -> 'source_revisions' then
    raise exception 'agent_sales_document_read_stale'
      using errcode = '40001';
  end if;
  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

  with raw_source as materialized (
    select source.*
    from private.agent_p2_sales_document_header_source_v1(
      p_company_id,
      p_document_kinds,
      p_customer_id,
      p_job_kind,
      p_job_id,
      null,
      v_currency_code,
      p_source_limit
    ) source
  ), raw_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from raw_source
  ), candidate_source as materialized (
    select source.*,
           candidate.value as selected_authorization
    from raw_source source
    cross join lateral (
      select proof.value
      from pg_catalog.jsonb_array_elements(
        v_context -> 'proof_authorization_candidates'
      ) proof(value)
      where proof.value ->> 'variantKey' = source.document_kind
      limit 1
    ) candidate
    cross join raw_state state
    where state.source_count < p_source_limit
      and source.document_header is not null
      and (
        p_after_updated_at is null
        or source.order_updated_at < p_after_updated_at
        or source.order_updated_at = p_after_updated_at
           and (source.document_kind, source.document_id) >
               (p_after_document_kind, p_after_document_id)
      )
  ), authorized_source as materialized (
    select source.*
    from candidate_source source
    where private.agent_p2_sales_authorized_path_v1(
      p_actor_user_id,
      p_company_id,
      source.selected_authorization,
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
             order by source.order_updated_at desc,
                      source.document_kind,
                      source.document_id
           ) as ordinality
    from authorized_source source
    where not source.source_invalid
    order by source.order_updated_at desc,
             source.document_kind,
             source.document_id
    limit p_page_fetch_limit
  ), page_state as materialized (
    select pg_catalog.count(*)::integer as fetched_count,
           pg_catalog.count(*) > p_item_limit as source_has_more
    from bounded_source
  ), query_projection as materialized (
    select pg_catalog.jsonb_build_object(
             'document_kinds', pg_catalog.to_jsonb(p_document_kinds),
             'limit', p_item_limit
           )
           || case when p_customer_id is null then '{}'::jsonb
                else pg_catalog.jsonb_build_object(
                  'customer_ref', pg_catalog.jsonb_build_object(
                    'kind', 'customer', 'id', p_customer_id
                  )
                )
              end
           || case when p_job_id is null then '{}'::jsonb
                else pg_catalog.jsonb_build_object(
                  'job_ref', pg_catalog.jsonb_build_object(
                    'kind', p_job_kind, 'id', p_job_id
                  )
                )
              end as query
  ), cursor_projection as materialized (
    select case when p_cursor_read_at is null then null::jsonb
           else pg_catalog.jsonb_build_object(
             'order', pg_catalog.jsonb_build_array(
               private.agent_rfc3339_utc(p_after_updated_at),
               p_after_document_kind,
               p_after_document_id
             ),
             'tie_breaker', p_after_document_id
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
             'ranking_revision',
               'sales-document-ranking:2026-08-22.v1',
             'authorization_candidates',
               v_context -> 'proof_authorization_candidates',
             'query', query.query,
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
           source.document_id,
           source.document_kind,
           source.order_updated_at,
           source.document_header,
           source.selected_authorization,
           source.authority_path,
           private.agent_p2_sales_hash_ref(
             'ops_proof:v1:',
             proof.context || pg_catalog.jsonb_build_object(
               'proof_kind', 'sales_document_list_entity',
               'selected_authorization', source.selected_authorization,
               'authority_path', source.authority_path,
               'item', source.document_header
             )
           ) as proof_ref,
           private.agent_p2_sales_hash_ref(
             'ops_evidence:v1:',
             proof.context || pg_catalog.jsonb_build_object(
               'evidence_kind', 'sales_document_list_item',
               'selected_authorization', source.selected_authorization,
               'authority_path', source.authority_path,
               'document_ref', source.document_header -> 'document_ref',
               'updated_at', source.document_header -> 'updated_at'
             )
           ) as evidence_ref
    from bounded_source source
    cross join proof_context proof
    where source.ordinality <= p_item_limit
  ), aggregate_rows as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'item', row.document_header,
                 'selected_authorization_variant', row.document_kind,
                 'authority_path', row.authority_path,
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref,
                 'predecessor', pg_catalog.jsonb_build_object(
                   'order', pg_catalog.jsonb_build_array(
                     private.agent_rfc3339_utc(row.order_updated_at),
                     row.document_kind,
                     row.document_id
                   ),
                   'tie_breaker', row.document_id
                 )
               ) order by row.ordinality
             ),
             '[]'::jsonb
           ) as rows,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'document_ref', row.document_header -> 'document_ref',
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
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'authorization_candidates', p_authorization_candidates,
             'query', query.query,
             'ranking_revision',
               'sales-document-ranking:2026-08-22.v1',
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
                 'proof_kind', 'sales_document_list_collection',
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
    raise exception 'agent_sales_document_source_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_sales_document_source_data_invalid'
      using errcode = '22023';
  end if;
  return v_result - array['_source_bound', '_source_invalid'];
end;
$function$;

revoke all on function private.agent_p2_sales_document_list_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,
  text,uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,uuid
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_sales_document_lines_v1(
  p_company_id uuid,
  p_document_kind text,
  p_document_id uuid,
  p_currency_code text,
  p_line_fetch_limit integer
) returns table (
  line_id uuid,
  sort_order integer,
  line_item jsonb,
  source_invalid boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  return query
  with raw_lines as materialized (
    select line.id,
           line.company_id,
           line.estimate_id,
           line.invoice_id,
           line.name,
           line.description,
           line.quantity::numeric as quantity,
           line.unit,
           line.unit_price::numeric as unit_price,
           line.line_total::numeric as line_total,
           line.discount_percent::numeric as discount_percent,
           line.is_taxable,
           line.is_optional,
           line.is_selected,
           line.sort_order,
           private.agent_p2_optional_canonical_text(
             line.name, 256, 1024, true
           ) as safe_name,
           case when line.description is null then null
             else private.agent_p2_optional_canonical_text(
               line.description, 4000, 16000, true
             )
           end as safe_description,
           case when line.unit is null then null
             else private.agent_p2_optional_canonical_text(
               line.unit, 64, 256, false
             )
           end as safe_unit
    from public.line_items line
    where line.company_id = p_company_id
      and case p_document_kind
        when 'estimate' then
          line.estimate_id = p_document_id and line.invoice_id is null
        else
          line.invoice_id = p_document_id and line.estimate_id is null
      end
    order by line.sort_order, line.id
    limit p_line_fetch_limit
  )
  select line.id,
         line.sort_order,
         pg_catalog.jsonb_build_object(
           'line_ref', pg_catalog.jsonb_build_object(
             'kind', 'sales_document_line', 'id', line.id
           ),
           'name', line.safe_name,
           'description', line.safe_description,
           'quantity_milliunits', case
             when line.quantity is not null
              and line.quantity >= 0
              and pg_catalog.trunc(line.quantity * 1000::numeric) =
                    line.quantity * 1000::numeric
              and line.quantity * 1000::numeric <=
                    9007199254740991::numeric
             then (line.quantity * 1000::numeric)::bigint
             else null
           end,
           'unit', line.safe_unit,
           'unit_price', pg_catalog.jsonb_build_object(
             'amount_minor', private.agent_money_to_minor_units(
               line.unit_price, p_currency_code
             ),
             'currency', p_currency_code
           ),
           'line_total', pg_catalog.jsonb_build_object(
             'amount_minor', private.agent_money_to_minor_units(
               line.line_total, p_currency_code
             ),
             'currency', p_currency_code
           ),
           'discount_basis_points', case
             when line.discount_percent is not null
              and line.discount_percent between 0 and 100
              and pg_catalog.trunc(
                    line.discount_percent * 100::numeric
                  ) = line.discount_percent * 100::numeric
             then (line.discount_percent * 100::numeric)::integer
             else null
           end,
           'is_taxable', line.is_taxable,
           'is_optional', line.is_optional,
           'is_selected', line.is_selected,
           'sort_order', line.sort_order,
           'content_kind', 'untrusted_business_data'
         ),
         line.company_id is distinct from p_company_id
           or line.safe_name is null
           or line.description is not null and line.safe_description is null
           or line.unit is not null and line.safe_unit is null
           or line.quantity is null
           or line.quantity < 0
           or pg_catalog.trunc(line.quantity * 1000::numeric) is distinct from
                line.quantity * 1000::numeric
           or line.quantity * 1000::numeric > 9007199254740991::numeric
           or line.unit_price is null
           or line.line_total is null
           or line.discount_percent is null
           or line.discount_percent not between 0 and 100
           or pg_catalog.trunc(
                line.discount_percent * 100::numeric
              ) is distinct from line.discount_percent * 100::numeric
           or line.is_taxable is null
           or line.is_optional is null
           or line.is_selected is null
           or line.sort_order is null
           or line.sort_order < 0
  from raw_lines line
  order by line.sort_order, line.id;
end;
$function$;

revoke all on function private.agent_p2_sales_document_lines_v1(uuid,text,uuid,text,integer)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_sales_document_milestones_v1(
  p_company_id uuid,
  p_estimate_id uuid,
  p_currency_code text,
  p_milestone_fetch_limit integer
) returns table (
  milestone_id uuid,
  sort_order integer,
  milestone_item jsonb,
  source_invalid boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  return query
  with raw_milestones as materialized (
    select milestone.id,
           milestone.name,
           milestone.type,
           milestone.value::numeric as schedule_value,
           milestone.amount::numeric as amount,
           milestone.expected_date,
           milestone.invoice_id,
           milestone.paid_at,
           milestone.sort_order,
           linked_invoice.id as active_invoice_id,
           private.agent_p2_optional_canonical_text(
             milestone.name, 256, 1024, true
           ) as safe_name
    from public.payment_milestones milestone
    join public.estimates estimate
      on estimate.id = milestone.estimate_id
     and estimate.company_id = p_company_id
     and estimate.deleted_at is null
    left join public.invoices linked_invoice
      on linked_invoice.id = milestone.invoice_id
     and linked_invoice.company_id = p_company_id
     and linked_invoice.deleted_at is null
    where milestone.estimate_id = p_estimate_id
    order by milestone.sort_order, milestone.id
    limit p_milestone_fetch_limit
  )
  select milestone.id,
         milestone.sort_order,
         pg_catalog.jsonb_build_object(
           'milestone_ref', pg_catalog.jsonb_build_object(
             'kind', 'estimate_payment_milestone', 'id', milestone.id
           ),
           'name', milestone.safe_name,
           'schedule_value', case milestone.type
             when 'percentage' then pg_catalog.jsonb_build_object(
               'kind', 'percentage',
               'basis_points', case
                 when milestone.schedule_value between 0 and 100
                  and pg_catalog.trunc(
                        milestone.schedule_value * 100::numeric
                      ) = milestone.schedule_value * 100::numeric
                 then (milestone.schedule_value * 100::numeric)::integer
                 else null
               end
             )
             when 'fixed' then pg_catalog.jsonb_build_object(
               'kind', 'fixed',
               'amount', pg_catalog.jsonb_build_object(
                 'amount_minor', private.agent_money_to_minor_units(
                   milestone.schedule_value, p_currency_code
                 ),
                 'currency', p_currency_code
               )
             )
             else null
           end,
           'amount', pg_catalog.jsonb_build_object(
             'amount_minor', private.agent_money_to_minor_units(
               milestone.amount, p_currency_code
             ),
             'currency', p_currency_code
           ),
           'expected_date', case when milestone.expected_date is null then null
             else pg_catalog.to_char(
               milestone.expected_date, 'YYYY-MM-DD'
             )
           end,
           'state', case
             when milestone.paid_at is not null then 'paid'
             when milestone.invoice_id is not null then 'invoiced'
             else 'pending'
           end,
           'paid_at', case when milestone.paid_at is null then null
             else private.agent_rfc3339_utc(
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 milestone.paid_at,
                 timestamptz '2000-01-01 00:00:00+00'
               )
             )
           end,
           'sort_order', milestone.sort_order,
           'content_kind', 'untrusted_business_data'
         ),
         milestone.safe_name is null
           or milestone.type not in ('percentage', 'fixed')
           or milestone.schedule_value is null
           or milestone.type = 'percentage' and (
                milestone.schedule_value not between 0 and 100
                or pg_catalog.trunc(
                     milestone.schedule_value * 100::numeric
                   ) is distinct from milestone.schedule_value * 100::numeric
              )
           or milestone.amount is null
           or milestone.expected_date is not null
              and (
                not pg_catalog.isfinite(milestone.expected_date)
                or extract(year from milestone.expected_date)
                     not between 1 and 9999
              )
           or milestone.invoice_id is not null
              and milestone.active_invoice_id is null
           or milestone.paid_at is not null and (
                not pg_catalog.isfinite(milestone.paid_at)
                or extract(year from milestone.paid_at at time zone 'UTC')
                     not between 1 and 9999
              )
           or milestone.sort_order is null
           or milestone.sort_order < 0
  from raw_milestones milestone
  order by milestone.sort_order, milestone.id;
end;
$function$;

revoke all on function private.agent_p2_sales_document_milestones_v1(uuid,uuid,text,integer)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_sales_document_detail_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_document_kind text,
  p_document_id uuid,
  p_source_limit integer,
  p_line_limit integer,
  p_line_fetch_limit integer,
  p_milestone_limit integer,
  p_milestone_fetch_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_currency_code text;
  v_document record;
  v_selected_authorization jsonb;
  v_read_at timestamptz;
  v_line_count integer;
  v_milestone_count integer;
  v_lines jsonb;
  v_milestones jsonb;
  v_client_text jsonb;
  v_client_text_invalid boolean;
  v_result_source jsonb;
  v_source_inspected jsonb;
  v_proof_context jsonb;
  v_proof_ref text;
  v_evidence_ref text;
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'get_sales_document'
     or p_capability_revision is distinct from
       'get_sales_document:2026-08-22.v1'
     or p_document_kind not in ('estimate', 'invoice')
     or p_document_id is null
     or p_source_limit is distinct from 501
     or p_line_limit is distinct from 50
     or p_line_fetch_limit is distinct from 51
     or p_milestone_limit is distinct from 32
     or p_milestone_fetch_limit is distinct from 33 then
    raise exception 'invalid_agent_sales_document_detail_request'
      using errcode = '22023';
  end if;

  v_context := private.agent_p2_sales_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidates,
    array[p_document_kind]::text[]
  );
  if v_context is null then
    raise exception 'agent_sales_document_not_authorized'
      using errcode = '42501';
  end if;
  v_currency_code := v_context ->> 'currency_code';
  if v_context -> 'minor_exponent' = 'null'::jsonb
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'agent_sales_document_source_data_invalid'
      using errcode = '22023';
  end if;

  select source.*
    into v_document
  from private.agent_p2_sales_document_header_source_v1(
    p_company_id,
    array[p_document_kind]::text[],
    null,
    null,
    null,
    p_document_id,
    v_currency_code,
    p_source_limit
  ) source;
  if not found then
    return null;
  end if;

  select candidate.value
    into v_selected_authorization
  from pg_catalog.jsonb_array_elements(
    v_context -> 'proof_authorization_candidates'
  ) candidate(value)
  where candidate.value ->> 'variantKey' = p_document_kind
  limit 1;
  if v_selected_authorization is null
     or not private.agent_p2_sales_authorized_path_v1(
       p_actor_user_id,
       p_company_id,
       v_selected_authorization,
       v_document.authority_path,
       v_document.opportunity_id,
       v_document.project_id
     ) then
    return null;
  end if;
  if v_document.source_invalid then
    raise exception 'agent_sales_document_source_data_invalid'
      using errcode = '22023';
  end if;

  with line_source as materialized (
    select line.*
    from private.agent_p2_sales_document_lines_v1(
      p_company_id,
      p_document_kind,
      p_document_id,
      v_currency_code,
      p_line_fetch_limit
    ) line
  )
  select pg_catalog.count(*)::integer,
         coalesce(
           pg_catalog.jsonb_agg(
             line.line_item order by line.sort_order, line.line_id
           ) filter (where not line.source_invalid),
           '[]'::jsonb
         ),
         coalesce(
           pg_catalog.bool_or(line.source_invalid), false
         )
    into v_line_count, v_lines, v_client_text_invalid
  from line_source line;
  if v_line_count >= p_line_fetch_limit then
    raise exception 'agent_sales_document_result_bound'
      using errcode = '54000';
  end if;
  if v_client_text_invalid then
    raise exception 'agent_sales_document_source_data_invalid'
      using errcode = '22023';
  end if;

  v_milestone_count := 0;
  v_milestones := '[]'::jsonb;
  if p_document_kind = 'estimate' then
    with milestone_source as materialized (
      select milestone.*
      from private.agent_p2_sales_document_milestones_v1(
        p_company_id,
        p_document_id,
        v_currency_code,
        p_milestone_fetch_limit
      ) milestone
    )
    select pg_catalog.count(*)::integer,
           coalesce(
             pg_catalog.jsonb_agg(
               milestone.milestone_item
               order by milestone.sort_order, milestone.milestone_id
             ) filter (where not milestone.source_invalid),
             '[]'::jsonb
           ),
           coalesce(
             pg_catalog.bool_or(milestone.source_invalid), false
           )
      into v_milestone_count, v_milestones, v_client_text_invalid
    from milestone_source milestone;
    if v_milestone_count >= p_milestone_fetch_limit then
      raise exception 'agent_sales_document_result_bound'
        using errcode = '54000';
    end if;
    if v_client_text_invalid then
      raise exception 'agent_sales_document_source_data_invalid'
        using errcode = '22023';
    end if;
  end if;

  with source_text as materialized (
    select document.client_message,
           document.terms,
           document.footer
    from (
      select estimate.client_message,
             estimate.terms,
             null::text as footer
      from public.estimates estimate
      where p_document_kind = 'estimate'
        and estimate.id = p_document_id
        and estimate.company_id = p_company_id
        and estimate.deleted_at is null
      union all
      select invoice.client_message,
             invoice.terms,
             invoice.footer
      from public.invoices invoice
      where p_document_kind = 'invoice'
        and invoice.id = p_document_id
        and invoice.company_id = p_company_id
        and invoice.deleted_at is null
    ) document
  ), normalized_text as materialized (
    select source.*,
           case when source.client_message is null then null
             else private.agent_p2_optional_canonical_text(
               source.client_message, 4000, 16000, true
             )
           end as safe_message,
           case when source.terms is null then null
             else private.agent_p2_optional_canonical_text(
               source.terms, 4000, 16000, true
             )
           end as safe_terms,
           case when source.footer is null then null
             else private.agent_p2_optional_canonical_text(
               source.footer, 4000, 16000, true
             )
           end as safe_footer
    from source_text source
  ), text_items as materialized (
    select 0 as ordinality,
           pg_catalog.jsonb_build_object(
             'kind', 'message',
             'text', text.safe_message,
             'content_kind', 'untrusted_business_data'
           ) as item
    from normalized_text text
    where text.safe_message is not null
    union all
    select 1,
           pg_catalog.jsonb_build_object(
             'kind', 'terms',
             'text', text.safe_terms,
             'content_kind', 'untrusted_business_data'
           )
    from normalized_text text
    where text.safe_terms is not null
    union all
    select 2,
           pg_catalog.jsonb_build_object(
             'kind', 'footer',
             'text', text.safe_footer,
             'content_kind', 'untrusted_business_data'
           )
    from normalized_text text
    where text.safe_footer is not null
  )
  select coalesce(
           pg_catalog.jsonb_agg(
             item.item order by item.ordinality
           ) filter (where item.item is not null),
           '[]'::jsonb
         ),
         text.client_message is not null and text.safe_message is null
           or text.terms is not null and text.safe_terms is null
           or text.footer is not null and text.safe_footer is null
    into v_client_text, v_client_text_invalid
  from normalized_text text
  left join text_items item on true
  group by text.client_message, text.safe_message,
           text.terms, text.safe_terms, text.footer, text.safe_footer;
  if v_client_text is null or v_client_text_invalid then
    raise exception 'agent_sales_document_source_data_invalid'
      using errcode = '22023';
  end if;

  v_result_source := pg_catalog.jsonb_build_object(
    'document', v_document.document_header,
    'client_text', v_client_text,
    'lines', v_lines
  ) || case when p_document_kind = 'estimate'
    then pg_catalog.jsonb_build_object('milestones', v_milestones)
    else '{}'::jsonb
  end;
  v_source_inspected := pg_catalog.jsonb_build_object(
    'documents', 1,
    'lines', v_line_count,
    'milestones', v_milestone_count
  );
  v_read_at := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp()
  );
  v_proof_context := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'selected_authorization', v_selected_authorization,
    'authority_path', v_document.authority_path,
    'query', pg_catalog.jsonb_build_object(
      'document_ref', pg_catalog.jsonb_build_object(
        'kind', p_document_kind, 'id', p_document_id
      )
    ),
    'read_at', private.agent_rfc3339_utc(v_read_at),
    'source_revisions', v_context -> 'source_revisions',
    'source_inspected', v_source_inspected
  );
  v_proof_ref := private.agent_p2_sales_hash_ref(
    'ops_proof:v1:',
    v_proof_context || pg_catalog.jsonb_build_object(
      'proof_kind', 'sales_document_detail_entity',
      'result', v_result_source
    )
  );
  v_evidence_ref := private.agent_p2_sales_hash_ref(
    'ops_evidence:v1:',
    pg_catalog.jsonb_build_object(
      'evidence_kind', 'sales_document_detail',
      'company_id', p_company_id,
      'document_ref', v_document.document_header -> 'document_ref',
      'updated_at', v_document.document_header -> 'updated_at'
    )
  );

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'authorization_candidates', p_authorization_candidates,
    'query', pg_catalog.jsonb_build_object(
      'document_ref', pg_catalog.jsonb_build_object(
        'kind', p_document_kind, 'id', p_document_id
      )
    ),
    'read_at', private.agent_rfc3339_utc(v_read_at),
    'source_revisions', v_context -> 'source_revisions',
    'selected_authorization_variant', p_document_kind,
    'authority_path', v_document.authority_path,
    'source_inspected', v_source_inspected,
    'result', v_result_source,
    'proof_ref', v_proof_ref,
    'evidence_ref', v_evidence_ref
  );
end;
$function$;

revoke all on function private.agent_p2_sales_document_detail_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,
  integer,integer,integer,integer,integer
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_sales_document_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidates jsonb,
  p_document_kinds text[],
  p_as_of timestamptz,
  p_source_limit integer,
  p_item_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_currency_code text;
  v_result jsonb;
begin
  if p_as_of is null
     or not pg_catalog.isfinite(p_as_of)
     or p_as_of is distinct from pg_catalog.date_trunc(
       'milliseconds', p_as_of
     )
     or extract(year from p_as_of at time zone 'UTC') not between 1 and 9999
     or p_source_limit is distinct from 501
     or p_item_limit not between 1 and 25 then
    raise exception 'invalid_agent_sales_document_attention_request'
      using errcode = '22023';
  end if;

  v_context := private.agent_p2_sales_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidates,
    p_document_kinds
  );
  if v_context is null then
    raise exception 'agent_sales_document_not_authorized'
      using errcode = '42501';
  end if;
  v_currency_code := v_context ->> 'currency_code';
  if v_context -> 'minor_exponent' = 'null'::jsonb
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'agent_sales_document_source_data_invalid'
      using errcode = '22023';
  end if;

  with raw_source as materialized (
    select source.*
    from private.agent_p2_sales_document_header_source_v1(
      p_company_id,
      p_document_kinds,
      null,
      null,
      null,
      null,
      v_currency_code,
      p_source_limit
    ) source
  ), raw_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from raw_source
  ), authorized_source as materialized (
    select source.*,
           candidate.value as selected_authorization
    from raw_source source
    cross join lateral (
      select proof.value
      from pg_catalog.jsonb_array_elements(
        v_context -> 'proof_authorization_candidates'
      ) proof(value)
      where proof.value ->> 'variantKey' = source.document_kind
      limit 1
    ) candidate
    cross join raw_state state
    where state.source_count < p_source_limit
      and private.agent_p2_sales_authorized_path_v1(
        p_actor_user_id,
        p_company_id,
        candidate.value,
        source.authority_path,
        source.opportunity_id,
        source.project_id
      )
  ), authorized_state as materialized (
    select coalesce(
             pg_catalog.bool_or(source.source_invalid), false
           ) as source_invalid
    from authorized_source source
  ), attention_source as materialized (
    select source.*,
           case
             when source.document_kind = 'invoice'
              and source.document_header ->> 'status' in (
                'awaiting_payment', 'partially_paid', 'past_due', 'sent'
              )
              and (source.document_header ->> 'due_date')::date <
                    (p_as_of at time zone 'UTC')::date
             then 'invoice_overdue'
             when source.document_kind = 'invoice'
              and source.document_header ->> 'status' in (
                'awaiting_payment', 'partially_paid', 'sent'
              )
              and (source.document_header ->> 'due_date')::date between
                    (p_as_of at time zone 'UTC')::date
                    and (p_as_of at time zone 'UTC')::date + 7
             then 'invoice_due'
             when source.document_kind = 'estimate'
              and source.document_header ->> 'status' = 'expired'
             then 'estimate_expired'
             when source.document_kind = 'estimate'
              and source.document_header ->> 'status' in (
                'sent', 'viewed', 'changes_requested'
              )
             then 'estimate_approval_pending'
             else null
           end as attention_kind,
           case source.document_kind
             when 'invoice' then source.document_header ->> 'due_date'
             else source.document_header ->> 'expiration_date'
           end as due_on
    from authorized_source source
    where not source.source_invalid
  ), bounded_source as materialized (
    select source.*
    from attention_source source
    where source.attention_kind is not null
    order by source.due_on asc nulls last,
             source.attention_kind,
             source.document_kind,
             source.document_id
    limit p_item_limit
  ), aggregate_cards as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'document_ref', source.document_header -> 'document_ref',
                 'customer_ref', source.document_header -> 'customer_ref',
                 'job_ref', source.document_header -> 'job_ref',
                 'document_number',
                   source.document_header -> 'document_number',
                 'attention_kind', source.attention_kind,
                 'due_on', source.due_on,
                 'status', source.document_header -> 'status',
                 'total', source.document_header -> 'total',
                 'content_kind', 'untrusted_business_data'
               ) order by source.due_on asc nulls last,
                          source.attention_kind,
                          source.document_kind,
                          source.document_id
             ),
             '[]'::jsonb
           ) as cards
    from bounded_source source
  )
  select pg_catalog.jsonb_build_object(
           'company_id', p_company_id,
           'actor_user_id', p_actor_user_id,
           'oauth_grant_id', p_oauth_grant_id,
           'oauth_client_id', p_oauth_client_id,
           'grant_revision', p_grant_revision,
           'granted_scope_ceiling',
             pg_catalog.to_jsonb(p_granted_scope_ceiling),
           'permission_snapshot_revision', p_permission_snapshot_revision,
           'authorization_candidates', p_authorization_candidates,
           'read_at', private.agent_rfc3339_utc(p_as_of),
           'source_revisions', v_context -> 'source_revisions',
           'source_inspected', raw.source_count,
           'cards', cards.cards,
           '_source_bound', raw.source_count >= p_source_limit,
           '_source_invalid', authorized.source_invalid
         )
    into v_result
  from raw_state raw
  cross join authorized_state authorized
  cross join aggregate_cards cards;

  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_sales_document_source_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_sales_document_source_data_invalid'
      using errcode = '22023';
  end if;
  return v_result - array['_source_bound', '_source_invalid'];
end;
$function$;

revoke all on function private.agent_p2_sales_document_attention_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],
  timestamp with time zone,integer,integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_sales_documents_as_system(
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
  p_authorization_candidates jsonb,
  p_document_kinds text[],
  p_customer_id uuid,
  p_job_kind text,
  p_job_id uuid,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_updated_at timestamptz,
  p_after_document_kind text,
  p_after_document_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256 then
    raise exception 'invalid_agent_sales_document_list_request'
      using errcode = '22023';
  end if;
  return private.agent_p2_sales_document_list_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_manifest_revision,
    p_capability_id,
    p_capability_revision,
    p_authorization_candidates,
    p_document_kinds,
    p_customer_id,
    p_job_kind,
    p_job_id,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_updated_at,
    p_after_document_kind,
    p_after_document_id
  );
end;
$function$;

create or replace function public.read_agent_sales_document_as_system(
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
  p_authorization_candidates jsonb,
  p_document_kind text,
  p_document_id uuid,
  p_source_limit integer,
  p_line_limit integer,
  p_line_fetch_limit integer,
  p_milestone_limit integer,
  p_milestone_fetch_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256 then
    raise exception 'invalid_agent_sales_document_detail_request'
      using errcode = '22023';
  end if;
  v_result := private.agent_p2_sales_document_detail_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_manifest_revision,
    p_capability_id,
    p_capability_revision,
    p_authorization_candidates,
    p_document_kind,
    p_document_id,
    p_source_limit,
    p_line_limit,
    p_line_fetch_limit,
    p_milestone_limit,
    p_milestone_fetch_limit
  );
  if v_result is null then
    raise exception 'agent_sales_document_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_sales_documents_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],
  uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_sales_document_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,
  integer,integer,integer,integer,integer
) from public, anon, authenticated, service_role;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_sales_hash_ref(text,jsonb)',
    'private.agent_p2_sales_money_minor_or_null_v1(numeric,text)',
    'private.agent_p2_sales_rfc3339_or_null_v1(timestamp with time zone)',
    'private.agent_p2_sales_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_sales_proof_candidates_v1(jsonb,jsonb)',
    'private.agent_p2_sales_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[])',
    'private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)',
    'private.agent_p2_sales_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)',
    'private.agent_p2_sales_document_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
    'private.agent_p2_sales_document_lines_v1(uuid,text,uuid,text,integer)',
    'private.agent_p2_sales_document_milestones_v1(uuid,uuid,text,integer)',
    'private.agent_p2_sales_document_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)',
    'private.agent_p2_sales_document_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)',
    'public.read_agent_sales_documents_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
    'public.read_agent_sales_document_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_sales_document_acl_function_missing: %',
        v_signature using errcode = '55000';
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
        raise exception 'agent_sales_document_acl_role_missing'
          using errcode = '55000';
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name)
        end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_sales_documents_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],
  uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,uuid
) to service_role;
grant execute on function public.read_agent_sales_document_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,
  integer,integer,integer,integer,integer
) to service_role;

do $postflight$
declare
  v_missing text[];
  v_invalid text[];
begin
  select pg_catalog.array_agg(required.signature order by required.signature)
    into v_missing
  from (
    values
      ('private.agent_p2_sales_document_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)'),
      ('private.agent_p2_sales_document_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)'),
      ('private.agent_p2_sales_document_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)'),
      ('public.read_agent_sales_documents_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)'),
      ('public.read_agent_sales_document_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)')
  ) required(signature)
  where pg_catalog.to_regprocedure(required.signature) is null;

  if v_missing is not null then
    raise exception 'agent_sales_document_reads_postflight_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(
           namespace.nspname || '.' || procedure.proname
           order by namespace.nspname, procedure.proname
         )
    into v_invalid
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where (
      namespace.nspname = 'private'
      and procedure.proname in (
        'agent_p2_sales_document_list_v1',
        'agent_p2_sales_document_detail_v1',
        'agent_p2_sales_document_attention_v1'
      )
      and (
        procedure.provolatile <> 's'
        or procedure.prosecdef
        or pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
      )
    ) or (
      namespace.nspname = 'public'
      and procedure.proname in (
        'read_agent_sales_documents_as_system',
        'read_agent_sales_document_as_system'
      )
      and (
        procedure.provolatile <> 's'
        or not procedure.prosecdef
        or not pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'anon', procedure.oid, 'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'authenticated', procedure.oid, 'EXECUTE'
        )
      )
    );

  if v_invalid is not null then
    raise exception 'agent_sales_document_reads_postflight_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
