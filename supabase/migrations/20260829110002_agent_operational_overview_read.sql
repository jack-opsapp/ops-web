begin;

-- This final composite never scans a business source itself. It binds the
-- caller once, then consumes only the frozen, bounded attention projections
-- whose signatures are pinned here.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'auth.role()'),
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'extensions.digest(bytea,text)'),
      ('function', 'private.agent_p2_sales_expected_candidate_v1(text,jsonb)'),
      ('function', 'private.agent_p2_sales_document_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)'),
      ('function', 'private.agent_p2_payment_expected_candidate_v1(jsonb)'),
      ('function', 'private.agent_p2_payment_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,timestamp with time zone,integer)'),
      ('function', 'private.agent_p2_expense_expected_candidate_v1(text,jsonb)'),
      ('function', 'private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)'),
      ('function', 'private.agent_p2_catalog_expected_candidate_v1(text,jsonb)'),
      ('function', 'private.agent_p2_catalog_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean,timestamp with time zone,integer,integer,integer)'),
      ('function', 'private.agent_p2_purchase_order_expected_candidate_v1(text,jsonb)'),
      ('function', 'private.agent_p2_purchase_order_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text,date,integer,boolean,timestamp with time zone,integer,integer,integer,integer)'),
      ('function', 'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)'),
      ('function', 'private.agent_p2_legacy_schedule_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)'),
      ('function', 'private.agent_p2_work_queue_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.users')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_operational_overview_read_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_operational_overview_hash_ref_v1(
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
    raise exception 'agent_operational_overview_source_data_invalid'
      using errcode = '22000';
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

create or replace function private.agent_p2_operational_overview_expected_component_v1(
  p_component text,
  p_origin text,
  p_permissions jsonb,
  p_granted_scope_ceiling text[]
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_required_scopes text[];
  v_resolved jsonb;
begin
  if p_component not in (
       'financial_attention',
       'integration_attention',
       'schedule_readiness',
       'stock_attention',
       'unresolved_correspondence',
       'work_due'
     )
     or p_origin not in ('default', 'explicit')
     or p_permissions is null
     or pg_catalog.jsonb_typeof(p_permissions) is distinct from 'object'
     or p_granted_scope_ceiling is null then
    return null;
  end if;

  v_required_scopes := case p_component
    when 'financial_attention' then array[
      'ops.expenses.read',
      'ops.financial_documents.read',
      'ops.operations.read',
      'ops.payments.read'
    ]::text[]
    when 'integration_attention' then array[
      'ops.integrations.read',
      'ops.operations.read'
    ]::text[]
    when 'schedule_readiness' then array[
      'ops.operations.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[]
    when 'stock_attention' then array[
      'ops.catalog.read',
      'ops.operations.read',
      'ops.purchasing.read'
    ]::text[]
    when 'unresolved_correspondence' then array[
      'ops.correspondence.read',
      'ops.operations.read'
    ]::text[]
    else array[
      'ops.jobs.read',
      'ops.operations.read',
      'ops.tasks.read'
    ]::text[]
  end;
  if v_required_scopes <@ p_granted_scope_ceiling is not true
     or p_permissions ->> 'reports.view' is distinct from 'all' then
    return null;
  end if;

  if p_component = 'financial_attention' then
    if not coalesce(
         p_permissions ->> 'estimates.view' in ('all', 'assigned'), false
       )
       or not coalesce(
         p_permissions ->> 'invoices.view' in ('all', 'assigned'), false
       )
       or p_permissions ->> 'finances.view' is distinct from 'all'
       or not coalesce(
         p_permissions ->> 'pipeline.view' in ('all', 'assigned'), false
       )
       or not coalesce(
         p_permissions ->> 'projects.view' in ('all', 'assigned'), false
       )
       or p_permissions ->> 'expenses.view' is distinct from 'all'
       or not coalesce(
         p_permissions ->> 'expenses.approve' in ('all', 'assigned'), false
       ) then
      return null;
    end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'estimates.view', p_permissions ->> 'estimates.view',
      'expenses.approve', p_permissions ->> 'expenses.approve',
      'expenses.view', 'all',
      'finances.view', 'all',
      'invoices.view', p_permissions ->> 'invoices.view',
      'pipeline.view', p_permissions ->> 'pipeline.view',
      'projects.view', p_permissions ->> 'projects.view',
      'reports.view', 'all'
    );
  elsif p_component = 'integration_attention' then
    if p_permissions ->> 'accounting.view' is distinct from 'all'
       or not coalesce(
         p_permissions ->> 'email.view' in ('all', 'own'), false
       )
       or p_permissions ->> 'settings.integrations' is distinct from 'all' then
      return null;
    end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'accounting.view', 'all',
      'email.view', p_permissions ->> 'email.view',
      'reports.view', 'all',
      'settings.integrations', 'all'
    );
  elsif p_component = 'schedule_readiness' then
    if not coalesce(
         p_permissions ->> 'calendar.view' in ('all', 'own'), false
       )
       or not coalesce(
         p_permissions ->> 'projects.view' in ('all', 'assigned'), false
       )
       or not coalesce(
         p_permissions ->> 'tasks.view' in ('all', 'assigned'), false
       ) then
      return null;
    end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'calendar.view', p_permissions ->> 'calendar.view',
      'projects.view', p_permissions ->> 'projects.view',
      'reports.view', 'all',
      'tasks.view', p_permissions ->> 'tasks.view'
    );
  elsif p_component = 'stock_attention' then
    if p_permissions ->> 'catalog.orders.view' is distinct from 'all'
       or p_permissions ->> 'catalog.products.view' is distinct from 'all'
       or p_permissions ->> 'catalog.view' is distinct from 'all' then
      return null;
    end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'catalog.orders.view', 'all',
      'catalog.products.view', 'all',
      'catalog.view', 'all',
      'reports.view', 'all'
    );
  elsif p_component = 'unresolved_correspondence' then
    if not coalesce(
         p_permissions ->> 'email.view' in ('all', 'own'), false
       )
       or not coalesce(
         p_permissions ->> 'inbox.view' in ('all', 'assigned', 'own'), false
       )
       or not coalesce(
         p_permissions ->> 'pipeline.view' in ('all', 'assigned'), false
       )
       or not coalesce(
         p_permissions ->> 'projects.view' in ('all', 'assigned'), false
       ) then
      return null;
    end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'email.view', p_permissions ->> 'email.view',
      'inbox.view', p_permissions ->> 'inbox.view',
      'pipeline.view', p_permissions ->> 'pipeline.view',
      'projects.view', p_permissions ->> 'projects.view',
      'reports.view', 'all'
    );
  else
    if not coalesce(
         p_permissions ->> 'pipeline.view' in ('all', 'assigned'), false
       )
       or not coalesce(
         p_permissions ->> 'projects.view' in ('all', 'assigned'), false
       )
       or not coalesce(
         p_permissions ->> 'tasks.view' in ('all', 'assigned'), false
       ) then
      return null;
    end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'pipeline.view', p_permissions ->> 'pipeline.view',
      'projects.view', p_permissions ->> 'projects.view',
      'reports.view', 'all',
      'tasks.view', p_permissions ->> 'tasks.view'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'component', p_component,
    'origin', p_origin,
    'required_oauth_scopes', pg_catalog.to_jsonb(v_required_scopes),
    'resolved_permission_scopes', v_resolved,
    'satisfied_permission_group_indexes', pg_catalog.jsonb_build_array(0)
  );
end;
$function$;

create or replace function private.agent_p2_operational_overview_merge_revisions_v1(
  p_vectors jsonb[]
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_vectors is null or exists (
    select 1
    from pg_catalog.unnest(p_vectors) vector(value)
    where vector.value is null
       or pg_catalog.jsonb_typeof(vector.value) is distinct from 'array'
       or pg_catalog.jsonb_array_length(vector.value) < 1
  ) then
    raise exception 'agent_operational_overview_source_data_invalid'
      using errcode = '22000';
  end if;
  if pg_catalog.cardinality(p_vectors) = 0 then
    return '[]'::jsonb;
  end if;

  if exists (
    with vectors as (
      select vector.ordinality as vector_ordinality, vector.value
      from pg_catalog.unnest(p_vectors) with ordinality
        vector(value, ordinality)
    ), entries as (
      select vectors.vector_ordinality,
             entry.ordinality as entry_ordinality,
             entry.value,
             entry.value ->> 'domain' as domain,
             entry.value ->> 'source_revision' as source_revision,
             pg_catalog.lag(entry.value ->> 'domain') over (
               partition by vectors.vector_ordinality
               order by entry.ordinality
             ) as previous_domain
      from vectors
      cross join lateral pg_catalog.jsonb_array_elements(vectors.value)
        with ordinality entry(value, ordinality)
    )
    select 1
    from entries
    where pg_catalog.jsonb_typeof(entries.value) is distinct from 'object'
       or (select pg_catalog.count(*)
           from pg_catalog.jsonb_object_keys(entries.value)) <> 2
       or not (entries.value ? 'domain')
       or not (entries.value ? 'source_revision')
       or pg_catalog.jsonb_typeof(entries.value -> 'domain')
            is distinct from 'string'
       or pg_catalog.jsonb_typeof(entries.value -> 'source_revision')
            is distinct from 'number'
       or entries.domain !~ '^[a-z][a-z0-9_]{0,127}$'
       or entries.source_revision !~ '^(0|[1-9][0-9]{0,15})$'
       or entries.source_revision::numeric > 9007199254740991
       or entries.previous_domain collate "C" >= entries.domain collate "C"
  ) or exists (
    select 1
    from pg_catalog.unnest(p_vectors) vector(value)
    cross join lateral pg_catalog.jsonb_array_elements(vector.value)
      entry(value)
    group by entry.value ->> 'domain'
    having pg_catalog.count(
      distinct (entry.value ->> 'source_revision')::bigint
    ) > 1
  ) then
    raise exception 'agent_operational_overview_source_data_invalid'
      using errcode = '22000';
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'domain', source.domain,
               'source_revision', source.source_revision
             ) order by source.domain collate "C"
           ),
           '[]'::jsonb
         )
    into v_result
  from (
    select entry.value ->> 'domain' as domain,
           pg_catalog.min(
             (entry.value ->> 'source_revision')::bigint
           ) as source_revision
    from pg_catalog.unnest(p_vectors) vector(value)
    cross join lateral pg_catalog.jsonb_array_elements(vector.value)
      entry(value)
    group by entry.value ->> 'domain'
  ) source;
  return v_result;
end;
$function$;

create or replace function private.agent_p2_operational_overview_summary_v1(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_selections jsonb,
  p_authorized_components jsonb,
  p_warnings jsonb,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_read_at timestamptz;
  v_current_permission_revision text;
  v_permissions jsonb;
  v_expected_authorized jsonb;
  v_expected_warnings jsonb;
  v_internal_rows jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_children jsonb := '[]'::jsonb;
  v_revision_vectors jsonb[] := array[]::jsonb[];
  v_source_revisions jsonb := '[]'::jsonb;
  v_component_source_inspected jsonb := '[]'::jsonb;
  v_source_inspected bigint := 0;
  v_component_authorization jsonb;
  v_component text;
  v_component_result jsonb;
  v_component_revisions jsonb;
  v_component_inspected bigint;
  v_attention_total bigint;
  v_attention_count integer;
  v_count_is_bounded boolean;
  v_item jsonb;
  v_request_proof_context jsonb;
  v_collection_proof_context jsonb;
  v_proof_ref text;
  v_evidence_ref text;
  v_sales jsonb;
  v_payment jsonb;
  v_expense_approval jsonb;
  v_expense_reimbursement jsonb;
  v_catalog jsonb;
  v_purchase_overdue jsonb;
  v_purchase_due_soon jsonb;
  v_integration jsonb;
  v_schedule jsonb;
  v_work_queue jsonb;
  v_work_queue_sources jsonb;
  v_candidate jsonb;
  v_candidate_two jsonb;
  v_domains text[];
  v_schedule_revision bigint;
begin
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 128
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_granted_scope_ceiling is null
     or pg_catalog.cardinality(p_granted_scope_ceiling) not between 1 and 32
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or pg_catalog.cardinality(p_registered_permission_keys) not between 1 and 128
     or p_capability_id is distinct from 'get_operational_overview'
     or p_capability_revision is distinct from
          'get_operational_overview:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
          '2026-08-22.capability-manifest.v8'
     or p_selections is null
     or pg_catalog.jsonb_typeof(p_selections) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_selections) not between 1 and 6
     or p_authorized_components is null
     or pg_catalog.jsonb_typeof(p_authorized_components) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_authorized_components) > 6
     or p_warnings is null
     or pg_catalog.jsonb_typeof(p_warnings) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_warnings) > 6
     or p_item_limit is distinct from 25
     or p_page_fetch_limit is distinct from 26
     or p_source_limit is distinct from 501 then
    raise exception 'invalid_agent_operational_overview_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
    where scope.value is null
       or scope.value is distinct from pg_catalog.btrim(scope.value)
       or pg_catalog.octet_length(scope.value) not between 1 and 128
  ) or p_granted_scope_ceiling is distinct from (
    select pg_catalog.array_agg(scope.value order by scope.value collate "C")
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
  ) or (
    select pg_catalog.count(distinct scope.value)
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
  ) <> pg_catalog.cardinality(p_granted_scope_ceiling)
  or exists (
    select 1
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
    where key.value is null
       or key.value is distinct from pg_catalog.btrim(key.value)
       or pg_catalog.octet_length(key.value) not between 1 and 128
  ) or p_registered_permission_keys is distinct from (
    select pg_catalog.array_agg(key.value order by key.value collate "C")
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
  ) or (
    select pg_catalog.count(distinct key.value)
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
  ) <> pg_catalog.cardinality(p_registered_permission_keys)
  or not array[
    'accounting.view', 'calendar.view', 'catalog.orders.view',
    'catalog.products.view', 'catalog.view', 'email.view',
    'estimates.view', 'expenses.approve', 'expenses.view', 'finances.view',
    'inbox.view', 'invoices.view', 'pipeline.view', 'projects.view',
    'reports.view', 'settings.integrations', 'tasks.view'
  ]::text[] <@ p_registered_permission_keys then
    raise exception 'invalid_agent_operational_overview_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_selections)
      with ordinality selection(value, ordinality)
    where pg_catalog.jsonb_typeof(selection.value) is distinct from 'object'
       or (select pg_catalog.count(*)
           from pg_catalog.jsonb_object_keys(selection.value)) <> 2
       or pg_catalog.jsonb_typeof(selection.value -> 'component')
            is distinct from 'string'
       or pg_catalog.jsonb_typeof(selection.value -> 'origin')
            is distinct from 'string'
       or selection.value ->> 'component' not in (
         'financial_attention', 'integration_attention',
         'schedule_readiness', 'stock_attention',
         'unresolved_correspondence', 'work_due'
       )
       or selection.value ->> 'origin' not in ('default', 'explicit')
  ) or exists (
    with ordered as (
      select selection.ordinality,
             selection.value ->> 'component' as component,
             pg_catalog.lag(selection.value ->> 'component') over (
               order by selection.ordinality
             ) as previous_component
      from pg_catalog.jsonb_array_elements(p_selections)
        with ordinality selection(value, ordinality)
    )
    select 1
    from ordered
    where ordered.previous_component collate "C" >=
          ordered.component collate "C"
  ) then
    raise exception 'invalid_agent_operational_overview_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_selections) selection(value)
    where selection.value ->> 'origin' = 'default'
  ) and (
    pg_catalog.jsonb_array_length(p_selections) <> 6
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_selections) selection(value)
      where selection.value ->> 'origin' <> 'default'
    )
  ) or not exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_selections) selection(value)
    where selection.value ->> 'origin' = 'default'
  ) and exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_selections) selection(value)
    where selection.value ->> 'origin' <> 'explicit'
  ) then
    raise exception 'invalid_agent_operational_overview_request'
      using errcode = '22023';
  end if;

  v_read_at := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.statement_timestamp()
  );
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
    into v_current_permission_revision, v_permissions
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    p_registered_permission_keys
  ) authority
  join private.mcp_oauth_grants grant_row
    on grant_row.id = p_oauth_grant_id
   and grant_row.user_id = p_actor_user_id
   and grant_row.company_id = p_company_id
   and grant_row.client_id = p_oauth_client_id
   and grant_row.revision = p_grant_revision
   and grant_row.scopes = p_granted_scope_ceiling
   and grant_row.revoked_at is null
   and grant_row.accepted_labels = private.mcp_oauth_labels_for_scopes(
     grant_row.scopes,
     grant_row.consent_catalog_revision
   )
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
  join public.users actor
    on actor.id = p_actor_user_id
   and actor.company_id = p_company_id
   and actor.deleted_at is null
   and actor.is_active is true
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true
  group by authority.permission_snapshot_revision;

  if v_current_permission_revision is distinct from
       p_permission_snapshot_revision then
    raise exception 'agent_operational_overview_not_authorized'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from (
      select selection.value ->> 'origin' as origin,
             private.agent_p2_operational_overview_expected_component_v1(
               selection.value ->> 'component',
               selection.value ->> 'origin',
               v_permissions,
               p_granted_scope_ceiling
             ) as expected
      from pg_catalog.jsonb_array_elements(p_selections)
        selection(value)
    ) selection
    where selection.origin = 'explicit' and selection.expected is null
  ) then
    raise exception 'agent_operational_overview_not_authorized'
      using errcode = '42501';
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(
             source.expected order by source.ordinality
           ) filter (where source.expected is not null),
           '[]'::jsonb
         ),
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'code', 'DEFAULT_COMPONENT_OMITTED',
               'component', source.component
             ) order by source.ordinality
           ) filter (where source.expected is null),
           '[]'::jsonb
         )
    into v_expected_authorized, v_expected_warnings
  from (
    select selection.ordinality,
           selection.value ->> 'component' as component,
           private.agent_p2_operational_overview_expected_component_v1(
             selection.value ->> 'component',
             selection.value ->> 'origin',
             v_permissions,
             p_granted_scope_ceiling
           ) as expected
    from pg_catalog.jsonb_array_elements(p_selections)
      with ordinality selection(value, ordinality)
  ) source;

  if p_authorized_components is distinct from v_expected_authorized
     or p_warnings is distinct from v_expected_warnings then
    raise exception 'agent_operational_overview_not_authorized'
      using errcode = '42501';
  end if;

  -- Component projection calls are intentionally below. Every branch receives
  -- only its own exact authorization and contributes only its own revisions.
  for v_component_authorization in
    select component_authorization_row.value
    from pg_catalog.jsonb_array_elements(p_authorized_components)
      component_authorization_row(value)
  loop
    v_component := v_component_authorization ->> 'component';
    v_attention_total := 0;
    v_count_is_bounded := false;
    v_component_inspected := 0;
    v_component_revisions := null;

    begin
      if v_component = 'financial_attention' then
        v_candidate := private.agent_p2_sales_expected_candidate_v1(
          'estimate', v_permissions
        );
        v_candidate_two := private.agent_p2_sales_expected_candidate_v1(
          'invoice', v_permissions
        );
        if v_candidate is null or v_candidate_two is null then
          raise exception 'agent_operational_overview_not_authorized'
            using errcode = '42501';
        end if;
        v_sales := private.agent_p2_sales_document_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_oauth_grant_id,
          p_oauth_client_id,
          p_grant_revision,
          p_granted_scope_ceiling,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          pg_catalog.jsonb_build_array(v_candidate, v_candidate_two),
          array['estimate', 'invoice']::text[],
          v_read_at,
          p_source_limit,
          p_item_limit
        );

        v_candidate := private.agent_p2_payment_expected_candidate_v1(
          v_permissions
        );
        if v_candidate is null then
          raise exception 'agent_operational_overview_not_authorized'
            using errcode = '42501';
        end if;
        v_payment := private.agent_p2_payment_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_oauth_grant_id,
          p_oauth_client_id,
          p_grant_revision,
          p_granted_scope_ceiling,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          v_candidate,
          v_read_at,
          p_source_limit
        );

        v_candidate := private.agent_p2_expense_expected_candidate_v1(
          'pending_approval', v_permissions
        );
        v_candidate_two := private.agent_p2_expense_expected_candidate_v1(
          'reimbursement_batches', v_permissions
        );
        if v_candidate is null or v_candidate_two is null then
          raise exception 'agent_operational_overview_not_authorized'
            using errcode = '42501';
        end if;
        v_expense_approval := private.agent_p2_expense_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          v_candidate,
          v_read_at,
          p_item_limit,
          p_source_limit
        );
        v_expense_reimbursement := private.agent_p2_expense_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          v_candidate_two,
          v_read_at,
          p_item_limit,
          p_source_limit
        );

        if pg_catalog.jsonb_typeof(v_sales -> 'cards') is distinct from 'array'
           or pg_catalog.jsonb_typeof(v_payment -> 'summaries')
                is distinct from 'array'
           or pg_catalog.jsonb_typeof(v_expense_approval -> 'cards')
                is distinct from 'array'
           or pg_catalog.jsonb_typeof(v_expense_reimbursement -> 'cards')
                is distinct from 'array'
           or v_sales ->> 'read_at' is distinct from
                private.agent_rfc3339_utc(v_read_at)
           or v_payment ->> 'read_at' is distinct from
                private.agent_rfc3339_utc(v_read_at)
           or v_expense_approval ->> 'read_at' is distinct from
                private.agent_rfc3339_utc(v_read_at)
           or v_expense_reimbursement ->> 'read_at' is distinct from
                private.agent_rfc3339_utc(v_read_at)
           or not coalesce(
             v_sales ->> 'source_inspected' ~ '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or not coalesce(
             v_payment ->> 'source_inspected' ~ '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or (v_sales ->> 'source_inspected')::integer >= p_source_limit
           or (v_payment ->> 'source_inspected')::integer >= p_source_limit
           or exists (
             select 1
             from pg_catalog.jsonb_array_elements(
               v_payment -> 'summaries'
             ) summary(value)
             where summary.value ->> 'reconciliation_state'
                     not in ('applied', 'voided')
                or not coalesce(
                  summary.value ->> 'payment_count' ~
                    '^(0|[1-9][0-9]{0,2})$',
                  false
                )
           ) then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;

        select coalesce(
                 pg_catalog.sum(
                   (summary.value ->> 'payment_count')::bigint
                 ) filter (
                   where summary.value ->> 'reconciliation_state' = 'voided'
                 ),
                 0::bigint
               )
          into v_attention_total
        from pg_catalog.jsonb_array_elements(
          v_payment -> 'summaries'
        ) summary(value);
        v_attention_total := v_attention_total
          + pg_catalog.jsonb_array_length(v_sales -> 'cards')
          + pg_catalog.jsonb_array_length(v_expense_approval -> 'cards')
          + pg_catalog.jsonb_array_length(v_expense_reimbursement -> 'cards');
        v_count_is_bounded := v_attention_total > p_item_limit
          or pg_catalog.jsonb_array_length(v_sales -> 'cards') = p_item_limit
          or pg_catalog.jsonb_array_length(
               v_expense_approval -> 'cards'
             ) = p_item_limit
          or pg_catalog.jsonb_array_length(
               v_expense_reimbursement -> 'cards'
             ) = p_item_limit;
        -- Expense attention intentionally exposes no physical inspection
        -- count. Do not turn returned cards into a synthetic source counter.
        v_component_inspected :=
          (v_sales ->> 'source_inspected')::bigint
          + (v_payment ->> 'source_inspected')::bigint;
        v_component_revisions :=
          private.agent_p2_operational_overview_merge_revisions_v1(
            array[
              v_sales -> 'source_revisions',
              v_payment -> 'source_revisions',
              v_expense_approval -> 'source_revisions',
              v_expense_reimbursement -> 'source_revisions'
            ]::jsonb[]
          );
        select pg_catalog.array_agg(
                 revision.value ->> 'domain'
                 order by revision.value ->> 'domain' collate "C"
               )
          into v_domains
        from pg_catalog.jsonb_array_elements(v_component_revisions)
          revision(value);
        if v_domains is distinct from array[
          'expenses', 'legacy_operational', 'payments', 'sales_documents'
        ]::text[] then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;

      elsif v_component = 'integration_attention' then
        v_integration := private.agent_p2_integration_health_summary_v1(
          p_actor_user_id,
          p_company_id,
          p_oauth_grant_id,
          p_oauth_client_id,
          p_grant_revision,
          p_granted_scope_ceiling,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          array['ops.integrations.read']::text[],
          'all',
          'all',
          v_permissions ->> 'email.view',
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'integration_type', 'accounting', 'provider', 'quickbooks'
            ),
            pg_catalog.jsonb_build_object(
              'integration_type', 'accounting', 'provider', 'sage'
            ),
            pg_catalog.jsonb_build_object(
              'integration_type', 'mailbox', 'provider', 'gmail'
            ),
            pg_catalog.jsonb_build_object(
              'integration_type', 'mailbox', 'provider', 'microsoft365'
            )
          ),
          p_source_limit
        );
        if v_integration ->> 'read_at' is distinct from
             private.agent_rfc3339_utc(v_read_at)
           or pg_catalog.jsonb_typeof(v_integration -> 'rows')
                is distinct from 'array'
           or pg_catalog.jsonb_array_length(v_integration -> 'rows') <> 4
           or pg_catalog.jsonb_typeof(v_integration -> 'source_inspected')
                is distinct from 'object'
           or not coalesce(
             v_integration #>> '{source_inspected,accounting}' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or not coalesce(
             v_integration #>> '{source_inspected,mailbox}' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or exists (
             select 1
             from pg_catalog.jsonb_array_elements(v_integration -> 'rows')
               row(value)
             where not coalesce(
               row.value #>> '{item,reason_code}' in (
                 'connected', 'disconnected', 'first_sync_pending',
                 'needs_reconnect', 'not_configured', 'operator_paused',
                 'provider_error', 'setup_incomplete', 'sync_disabled',
                 'sync_stale', 'webhook_expired', 'webhook_setup_failed'
               ),
               false
             )
           )
           or (v_integration #>> '{source_inspected,accounting}')::integer
                >= p_source_limit
           or (v_integration #>> '{source_inspected,mailbox}')::integer
                >= p_source_limit then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;
        select pg_catalog.count(*)::bigint
          into v_attention_total
        from pg_catalog.jsonb_array_elements(v_integration -> 'rows')
          row(value)
        where row.value #>> '{item,reason_code}' not in (
          'connected', 'not_configured'
        );
        v_count_is_bounded := false;
        v_component_inspected :=
          (v_integration #>> '{source_inspected,accounting}')::bigint
          + (v_integration #>> '{source_inspected,mailbox}')::bigint;
        v_component_revisions :=
          private.agent_p2_operational_overview_merge_revisions_v1(
            array[v_integration -> 'source_revisions']::jsonb[]
          );
        select pg_catalog.array_agg(
                 revision.value ->> 'domain'
                 order by revision.value ->> 'domain' collate "C"
               )
          into v_domains
        from pg_catalog.jsonb_array_elements(v_component_revisions)
          revision(value);
        if v_domains is distinct from array['company', 'integrations']::text[]
        then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;

      elsif v_component = 'schedule_readiness' then
        v_schedule := private.agent_p2_legacy_schedule_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          v_permissions ->> 'calendar.view',
          v_permissions ->> 'projects.view',
          v_permissions ->> 'tasks.view',
          v_read_at,
          p_item_limit
        );
        if v_schedule ->> 'projection_revision' is distinct from
             'agent-p2-legacy-schedule-attention:v1'
           or v_schedule ->> 'read_at' is distinct from
                private.agent_rfc3339_utc(v_read_at)
           or pg_catalog.jsonb_typeof(v_schedule -> 'cards')
                is distinct from 'array'
           or pg_catalog.jsonb_typeof(v_schedule -> 'source_versions')
                is distinct from 'array'
           or pg_catalog.jsonb_array_length(v_schedule -> 'source_versions')
                <> 1
           or v_schedule #>> '{source_versions,0,source_domain}'
                is distinct from 'operations'
           or v_schedule #>> '{source_versions,0,source_type}'
                is distinct from 'operational_read_revision'
           or v_schedule #>> '{source_versions,0,source_id}'
                is distinct from 'private.agent_operational_read_revisions'
           or not coalesce(
             v_schedule #>> '{source_versions,0,version}' ~
               '^revision:(0|[1-9][0-9]{0,15})$',
             false
           )
           or not coalesce(
             v_schedule ->> 'source_inspected_count' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or (v_schedule ->> 'source_inspected_count')::integer
                >= p_source_limit
           or not coalesce(
             v_schedule ->> 'has_more' in ('true', 'false'), false
           ) then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;
        v_schedule_revision := pg_catalog.substr(
          v_schedule #>> '{source_versions,0,version}',
          10
        )::bigint;
        if v_schedule_revision > 9007199254740991 then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;
        v_attention_total := pg_catalog.jsonb_array_length(
          v_schedule -> 'cards'
        );
        v_count_is_bounded := (v_schedule ->> 'has_more')::boolean;
        v_component_inspected :=
          (v_schedule ->> 'source_inspected_count')::bigint;
        v_component_revisions := pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'domain', 'legacy_operational',
            'source_revision', v_schedule_revision
          )
        );

      elsif v_component = 'stock_attention' then
        v_candidate := private.agent_p2_catalog_expected_candidate_v1(
          'catalog', v_permissions
        );
        if v_candidate is null then
          raise exception 'agent_operational_overview_not_authorized'
            using errcode = '42501';
        end if;
        v_catalog := private.agent_p2_catalog_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_oauth_grant_id,
          p_oauth_client_id,
          p_grant_revision,
          p_granted_scope_ceiling,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          pg_catalog.jsonb_build_array(v_candidate),
          false,
          v_read_at,
          p_item_limit,
          p_page_fetch_limit,
          p_source_limit
        );

        v_candidate := private.agent_p2_purchase_order_expected_candidate_v1(
          'orders', v_permissions
        );
        if v_candidate is null then
          raise exception 'agent_operational_overview_not_authorized'
            using errcode = '42501';
        end if;
        v_purchase_overdue := private.agent_p2_purchase_order_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_oauth_grant_id,
          p_oauth_client_id,
          p_grant_revision,
          p_granted_scope_ceiling,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          pg_catalog.jsonb_build_array(v_candidate),
          'overdue',
          (v_read_at at time zone 'UTC')::date,
          7,
          false,
          v_read_at,
          p_item_limit,
          p_page_fetch_limit,
          p_source_limit,
          51
        );
        v_purchase_due_soon := private.agent_p2_purchase_order_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_oauth_grant_id,
          p_oauth_client_id,
          p_grant_revision,
          p_granted_scope_ceiling,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          pg_catalog.jsonb_build_array(v_candidate),
          'due_soon',
          (v_read_at at time zone 'UTC')::date,
          7,
          false,
          v_read_at,
          p_item_limit,
          p_page_fetch_limit,
          p_source_limit,
          51
        );
        if v_catalog ->> 'read_at' is distinct from
             private.agent_rfc3339_utc(v_read_at)
           or v_purchase_overdue ->> 'read_at' is distinct from
                private.agent_rfc3339_utc(v_read_at)
           or v_purchase_due_soon ->> 'read_at' is distinct from
                private.agent_rfc3339_utc(v_read_at)
           or pg_catalog.jsonb_typeof(v_catalog -> 'items')
                is distinct from 'array'
           or pg_catalog.jsonb_typeof(v_purchase_overdue -> 'items')
                is distinct from 'array'
           or pg_catalog.jsonb_typeof(v_purchase_due_soon -> 'items')
                is distinct from 'array'
           or not coalesce(
             v_catalog ->> 'has_more' in ('true', 'false'), false
           )
           or not coalesce(
             v_purchase_overdue ->> 'has_more' in ('true', 'false'), false
           )
           or not coalesce(
             v_purchase_due_soon ->> 'has_more' in ('true', 'false'), false
           )
           or not coalesce(
             v_catalog ->> 'source_inspected' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or (v_catalog ->> 'source_inspected')::integer >= p_source_limit
           or not coalesce(
             v_purchase_overdue #>> '{source_inspected,orders}' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or not coalesce(
             v_purchase_overdue #>> '{source_inspected,lines}' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or (v_purchase_overdue #>> '{source_inspected,orders}')::integer
                >= p_source_limit
           or (v_purchase_overdue #>> '{source_inspected,lines}')::integer
                >= p_source_limit
           or not coalesce(
             v_purchase_overdue #>> '{source_inspected,catalog_costs}' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or v_purchase_overdue #>> '{source_inspected,catalog_costs}'
                is distinct from '0'
           or not coalesce(
             v_purchase_due_soon #>> '{source_inspected,orders}' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or not coalesce(
             v_purchase_due_soon #>> '{source_inspected,lines}' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or (v_purchase_due_soon #>> '{source_inspected,orders}')::integer
                >= p_source_limit
           or (v_purchase_due_soon #>> '{source_inspected,lines}')::integer
                >= p_source_limit
           or not coalesce(
             v_purchase_due_soon #>> '{source_inspected,catalog_costs}' ~
               '^(0|[1-9][0-9]{0,2})$',
             false
           )
           or v_purchase_due_soon #>> '{source_inspected,catalog_costs}'
                is distinct from '0' then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;
        v_attention_total :=
          pg_catalog.jsonb_array_length(v_catalog -> 'items')
          + pg_catalog.jsonb_array_length(v_purchase_overdue -> 'items')
          + pg_catalog.jsonb_array_length(v_purchase_due_soon -> 'items');
        v_count_is_bounded := v_attention_total > p_item_limit
          or (v_catalog ->> 'has_more')::boolean
          or (v_purchase_overdue ->> 'has_more')::boolean
          or (v_purchase_due_soon ->> 'has_more')::boolean;
        v_component_inspected :=
          (v_catalog ->> 'source_inspected')::bigint
          + (v_purchase_overdue #>> '{source_inspected,orders}')::bigint
          + (v_purchase_overdue #>> '{source_inspected,lines}')::bigint
          + (v_purchase_overdue #>> '{source_inspected,catalog_costs}')::bigint
          + (v_purchase_due_soon #>> '{source_inspected,orders}')::bigint
          + (v_purchase_due_soon #>> '{source_inspected,lines}')::bigint
          + (v_purchase_due_soon #>> '{source_inspected,catalog_costs}')::bigint;
        v_component_revisions :=
          private.agent_p2_operational_overview_merge_revisions_v1(
            array[
              v_catalog -> 'source_revisions',
              v_purchase_overdue -> 'source_revisions',
              v_purchase_due_soon -> 'source_revisions'
            ]::jsonb[]
          );
        select pg_catalog.array_agg(
                 revision.value ->> 'domain'
                 order by revision.value ->> 'domain' collate "C"
               )
          into v_domains
        from pg_catalog.jsonb_array_elements(v_component_revisions)
          revision(value);
        if v_domains is distinct from array['catalog', 'purchasing']::text[]
        then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;

      elsif v_component in ('unresolved_correspondence', 'work_due') then
        if v_component = 'work_due' then
          v_work_queue_sources := pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'source', 'task',
              'origin', 'explicit',
              'required_oauth_scopes', pg_catalog.jsonb_build_array(
                'ops.operations.read', 'ops.tasks.read'
              ),
              'resolved_permission_scopes',
                pg_catalog.jsonb_build_object(
                  'projects.view', v_permissions ->> 'projects.view',
                  'tasks.view', v_permissions ->> 'tasks.view'
                ),
              'satisfied_permission_group_indexes',
                pg_catalog.jsonb_build_array(0)
            ),
            pg_catalog.jsonb_build_object(
              'source', 'lead',
              'origin', 'explicit',
              'required_oauth_scopes', pg_catalog.jsonb_build_array(
                'ops.jobs.read', 'ops.operations.read'
              ),
              'resolved_permission_scopes',
                pg_catalog.jsonb_build_object(
                  'pipeline.view', v_permissions ->> 'pipeline.view'
                ),
              'satisfied_permission_group_indexes',
                pg_catalog.jsonb_build_array(0)
            )
          );
          v_domains := array[
            'legacy_operational', 'tasks', 'work_queue'
          ]::text[];
        else
          v_work_queue_sources := pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'source', 'correspondence',
              'origin', 'explicit',
              'required_oauth_scopes', pg_catalog.jsonb_build_array(
                'ops.correspondence.read', 'ops.operations.read'
              ),
              'resolved_permission_scopes',
                pg_catalog.jsonb_build_object(
                  'email.view', v_permissions ->> 'email.view',
                  'inbox.view', v_permissions ->> 'inbox.view',
                  'pipeline.view', v_permissions ->> 'pipeline.view'
                ),
              'satisfied_permission_group_indexes',
                pg_catalog.jsonb_build_array(0)
            ),
            pg_catalog.jsonb_build_object(
              'source', 'commitment',
              'origin', 'explicit',
              'required_oauth_scopes', pg_catalog.jsonb_build_array(
                'ops.correspondence.read', 'ops.operations.read'
              ),
              'resolved_permission_scopes',
                pg_catalog.jsonb_build_object(
                  'email.view', v_permissions ->> 'email.view',
                  'inbox.view', v_permissions ->> 'inbox.view',
                  'pipeline.view', v_permissions ->> 'pipeline.view'
                ),
              'satisfied_permission_group_indexes',
                pg_catalog.jsonb_build_array(0)
            ),
            pg_catalog.jsonb_build_object(
              'source', 'match_review',
              'origin', 'explicit',
              'required_oauth_scopes', pg_catalog.jsonb_build_array(
                'ops.correspondence.read', 'ops.operations.read'
              ),
              'resolved_permission_scopes',
                pg_catalog.jsonb_build_object(
                  'email.view', v_permissions ->> 'email.view',
                  'inbox.view', v_permissions ->> 'inbox.view',
                  'pipeline.view', v_permissions ->> 'pipeline.view',
                  'projects.view', v_permissions ->> 'projects.view'
                ),
              'satisfied_permission_group_indexes',
                pg_catalog.jsonb_build_array(0)
            )
          );
          v_domains := array[
            'legacy_job_history', 'legacy_operational', 'work_queue'
          ]::text[];
        end if;

        v_work_queue := private.agent_p2_work_queue_attention_v1(
          p_actor_user_id,
          p_company_id,
          p_oauth_grant_id,
          p_oauth_client_id,
          p_grant_revision,
          p_granted_scope_ceiling,
          p_permission_snapshot_revision,
          p_registered_permission_keys,
          v_work_queue_sources,
          case when v_component = 'work_due'
            then array['task', 'lead']::text[]
            else array[
              'correspondence', 'commitment', 'match_review'
            ]::text[]
          end,
          v_read_at,
          p_source_limit,
          p_item_limit
        );
        if v_work_queue ->> 'read_at' is distinct from
             private.agent_rfc3339_utc(v_read_at)
           or pg_catalog.jsonb_typeof(v_work_queue -> 'cards')
                is distinct from 'array'
           or pg_catalog.jsonb_typeof(v_work_queue -> 'source_revisions')
                is distinct from 'array'
           or not coalesce(
             v_work_queue ->> 'source_inspected' ~
               '^(0|[1-9][0-9]{0,6})$',
             false
           )
           or (v_work_queue ->> 'source_inspected')::bigint > 4500
           or not coalesce(
             v_work_queue ->> 'returned_count' ~
               '^(0|[1-9]|1[0-9]|2[0-5])$',
             false
           )
           or (v_work_queue ->> 'returned_count')::integer <>
                pg_catalog.jsonb_array_length(v_work_queue -> 'cards')
           or not coalesce(
             v_work_queue ->> 'has_more' in ('true', 'false'), false
           ) then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;
        v_attention_total := (v_work_queue ->> 'returned_count')::bigint;
        v_count_is_bounded := (v_work_queue ->> 'has_more')::boolean;
        v_component_inspected :=
          (v_work_queue ->> 'source_inspected')::bigint;
        v_component_revisions :=
          private.agent_p2_operational_overview_merge_revisions_v1(
            array[v_work_queue -> 'source_revisions']::jsonb[]
          );
        if v_domains is distinct from (
          select pg_catalog.array_agg(
                   revision.value ->> 'domain'
                   order by revision.value ->> 'domain' collate "C"
                 )
          from pg_catalog.jsonb_array_elements(v_component_revisions)
            revision(value)
        ) then
          raise exception 'agent_operational_overview_source_data_invalid'
            using errcode = '22000';
        end if;
      else
        raise exception 'agent_operational_overview_source_data_invalid'
          using errcode = '22000';
      end if;
    exception
      when sqlstate '54000' then
        raise exception 'agent_operational_overview_source_query_bound'
          using errcode = '54000';
      when data_exception then
        raise exception 'agent_operational_overview_source_data_invalid'
          using errcode = '22000';
    end;

    if v_component_revisions is null
       or pg_catalog.jsonb_typeof(v_component_revisions)
            is distinct from 'array'
       or pg_catalog.jsonb_array_length(v_component_revisions) < 1
       or v_attention_total < 0
       or v_component_inspected < 0
       or v_component_inspected > (case v_component
         when 'financial_attention' then 1000
         when 'integration_attention' then 1000
         when 'schedule_readiness' then 500
         when 'stock_attention' then 2500
         when 'unresolved_correspondence' then 4500
         when 'work_due' then 4500
         else -1
       end)
       or v_count_is_bounded and v_attention_total < p_item_limit then
      raise exception 'agent_operational_overview_source_data_invalid'
        using errcode = '22000';
    end if;

    v_attention_count := least(
      v_attention_total,
      p_item_limit::bigint
    )::integer;
    v_item := pg_catalog.jsonb_build_object(
      'component', v_component,
      'state', case when v_attention_count = 0
        then 'clear' else 'attention' end,
      'attention_count', v_attention_count,
      'count_state', case
        when v_attention_count = p_item_limit and v_count_is_bounded
          then 'at_least_limit'
        else 'exact'
      end
    );
    v_component_result := pg_catalog.jsonb_build_object(
      'item', v_item,
      'component_authorization', v_component_authorization,
      'source_inspected', v_component_inspected,
      'source_revisions', v_component_revisions
    );
    v_internal_rows := v_internal_rows ||
      pg_catalog.jsonb_build_array(v_component_result);
    v_revision_vectors := pg_catalog.array_append(
      v_revision_vectors,
      v_component_revisions
    );
    v_component_source_inspected := v_component_source_inspected ||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'component', v_component,
        'source_inspected', v_component_inspected
      ));
    v_source_inspected := v_source_inspected + v_component_inspected;
    if v_source_inspected > 9007199254740991 then
      raise exception 'agent_operational_overview_source_data_invalid'
        using errcode = '22000';
    end if;
  end loop;

  v_source_revisions :=
    private.agent_p2_operational_overview_merge_revisions_v1(
      v_revision_vectors
    );
  if pg_catalog.jsonb_array_length(v_internal_rows) = 0 and (
    v_source_inspected <> 0
    or pg_catalog.jsonb_array_length(v_source_revisions) <> 0
  ) then
    raise exception 'agent_operational_overview_source_data_invalid'
      using errcode = '22000';
  end if;

  v_request_proof_context := pg_catalog.jsonb_build_object(
    'request_id', p_request_id,
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
    'read_at', private.agent_rfc3339_utc(v_read_at)
  );
  v_collection_proof_context := v_request_proof_context ||
    pg_catalog.jsonb_build_object(
    'selections', p_selections,
    'authorized_components', p_authorized_components,
    'warnings', p_warnings,
    'component_source_inspected', v_component_source_inspected,
    'source_inspected', v_source_inspected
  );

  for v_component_result in
    select source.value
    from pg_catalog.jsonb_array_elements(v_internal_rows) source(value)
  loop
    v_item := v_component_result -> 'item';
    v_component_revisions := v_component_result -> 'source_revisions';
    v_component_authorization :=
      v_component_result -> 'component_authorization';
    v_component_inspected :=
      (v_component_result ->> 'source_inspected')::bigint;
    v_component := v_item ->> 'component';
    v_proof_ref := private.agent_p2_operational_overview_hash_ref_v1(
      'ops_proof:v1:',
      v_request_proof_context || pg_catalog.jsonb_build_object(
        'proof_kind', 'operational_overview_entity',
        'component_authorization', v_component_authorization,
        'source_inspected', v_component_inspected,
        'source_revisions', v_component_revisions,
        'item', v_item
      )
    );
    v_evidence_ref := private.agent_p2_operational_overview_hash_ref_v1(
      'ops_evidence:v1:',
      v_request_proof_context || pg_catalog.jsonb_build_object(
        'proof_kind', 'operational_overview_evidence',
        'component_authorization', v_component_authorization,
        'source_inspected', v_component_inspected,
        'source_revisions', v_component_revisions
      )
    );
    v_rows := v_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item', v_item,
        'source_inspected', v_component_inspected,
        'source_revisions', v_component_revisions,
        'proof_ref', v_proof_ref,
        'evidence_ref', v_evidence_ref
      )
    );
    v_children := v_children || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'component', v_component,
        'proof_ref', v_proof_ref,
        'evidence_ref', v_evidence_ref,
        'source_inspected', v_component_inspected,
        'source_revisions', v_component_revisions
      )
    );
  end loop;

  v_proof_ref := private.agent_p2_operational_overview_hash_ref_v1(
    'ops_proof:v1:',
    v_collection_proof_context || pg_catalog.jsonb_build_object(
      'proof_kind', 'operational_overview_collection',
      'source_revisions', v_source_revisions,
      'returned_count', pg_catalog.jsonb_array_length(v_rows),
      'has_more', false,
      'children', v_children
    )
  );

  return v_collection_proof_context || pg_catalog.jsonb_build_object(
    'source_revisions', v_source_revisions,
    'rows', v_rows,
    'collection_proof_ref', v_proof_ref
  );
end;
$function$;

create or replace function public.read_agent_operational_overview_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_selections jsonb,
  p_authorized_components jsonb,
  p_warnings jsonb,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'agent_operational_overview_not_authorized'
      using errcode = '42501';
  end if;
  return private.agent_p2_operational_overview_summary_v1(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    p_capability_manifest_revision,
    p_selections,
    p_authorized_components,
    p_warnings,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit
  );
end;
$function$;

revoke all on function private.agent_p2_operational_overview_hash_ref_v1(
  text,jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_operational_overview_expected_component_v1(
  text,text,jsonb,text[]
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_operational_overview_merge_revisions_v1(
  jsonb[]
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_operational_overview_summary_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,
  jsonb,integer,integer,integer
) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_operational_overview_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,
  jsonb,integer,integer,integer
) from public, anon, authenticated, service_role;

alter function private.agent_p2_operational_overview_hash_ref_v1(text,jsonb)
  owner to current_user;
alter function private.agent_p2_operational_overview_expected_component_v1(
  text,text,jsonb,text[]
) owner to current_user;
alter function private.agent_p2_operational_overview_merge_revisions_v1(
  jsonb[]
) owner to current_user;
alter function private.agent_p2_operational_overview_summary_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,
  jsonb,integer,integer,integer
) owner to current_user;
alter function public.read_agent_operational_overview_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,
  jsonb,integer,integer,integer
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_role text;
begin
  foreach v_signature in array array[
    'private.agent_p2_operational_overview_hash_ref_v1(text,jsonb)',
    'private.agent_p2_operational_overview_expected_component_v1(text,text,jsonb,text[])',
    'private.agent_p2_operational_overview_merge_revisions_v1(jsonb[])',
    'private.agent_p2_operational_overview_summary_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)',
    'public.read_agent_operational_overview_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)'
  ]::text[] loop
    execute pg_catalog.format(
      'revoke all on function %s from public',
      v_signature
    );
    for v_role in
      select role_row.rolname
      from pg_catalog.pg_roles role_row
      where role_row.rolname <> current_user
    loop
      execute pg_catalog.format(
        'revoke all on function %s from %I',
        v_signature,
        v_role
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_operational_overview_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,
  jsonb,integer,integer,integer
) to service_role;

do $postflight$
declare
  v_signature text;
  v_acl_entries text[];
  v_expected_acl text[];
begin
  foreach v_signature in array array[
    'private.agent_p2_operational_overview_hash_ref_v1(text,jsonb)',
    'private.agent_p2_operational_overview_expected_component_v1(text,text,jsonb,text[])',
    'private.agent_p2_operational_overview_merge_revisions_v1(jsonb[])',
    'private.agent_p2_operational_overview_summary_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)',
    'public.read_agent_operational_overview_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_operational_overview_read_postflight_failed: missing:%',
        v_signature;
    end if;
    if (
      select role_row.rolname <> current_user
        or function_row.provolatile <> case
          when v_signature like
            'private.agent_p2_operational_overview_hash_ref_v1%'
            then 'i'
          else 's'
        end
        or function_row.proconfig is distinct from array['search_path=""']::text[]
        or function_row.prosecdef is distinct from
          (v_signature like 'public.read_agent_operational_overview_as_system%')
      from pg_catalog.pg_proc function_row
      join pg_catalog.pg_roles role_row on role_row.oid = function_row.proowner
      where function_row.oid = pg_catalog.to_regprocedure(v_signature)::oid
    ) then
      raise exception 'agent_operational_overview_read_postflight_failed: metadata:%',
        v_signature;
    end if;

    select coalesce(
             pg_catalog.array_agg(
               case when acl.grantee = 0 then 'PUBLIC'
                 else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
               end || ':' || acl.privilege_type || ':' ||
                 acl.is_grantable::text
               order by 1
             ),
             array[]::text[]
           )
      into v_acl_entries
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
    where function_row.oid = pg_catalog.to_regprocedure(v_signature)::oid
      and acl.grantee <> function_row.proowner;
    v_expected_acl := case
      when v_signature like 'public.read_agent_operational_overview_as_system%'
        then array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_operational_overview_read_postflight_failed: acl:%:%',
        v_signature,
        v_acl_entries;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'private'
      and function_row.proname in (
        'agent_p2_operational_overview_hash_ref_v1',
        'agent_p2_operational_overview_expected_component_v1',
        'agent_p2_operational_overview_merge_revisions_v1',
        'agent_p2_operational_overview_summary_v1'
      )
  ) <> 4 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'public'
      and function_row.proname = 'read_agent_operational_overview_as_system'
  ) <> 1 then
    raise exception 'agent_operational_overview_read_postflight_failed: duplicate_function';
  end if;
end;
$postflight$;

commit;
