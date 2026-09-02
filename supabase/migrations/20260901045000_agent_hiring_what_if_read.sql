begin;

set local timezone = 'UTC';

-- Phase 3 hiring what-if is one bounded analytical read. It creates no
-- durable business state and cannot prepare or commit an effect. One partial
-- source index bounds the newly included completed-visit history scan.
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
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_currency_minor_exponent(text)'),
      ('function', 'private.agent_currency_minor_exponent_or_null(text)'),
      ('function', 'private.agent_money_to_minor_units(numeric,text)'),
      ('function', 'private.agent_read_domain_uuid_from_text(text)'),
      ('function', 'private.agent_unambiguous_local_instant(timestamp without time zone,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.calendar_user_events'),
      ('table', 'public.companies'),
      ('table', 'public.expense_project_allocations'),
      ('table', 'public.expenses'),
      ('table', 'public.invoices'),
      ('table', 'public.payments'),
      ('table', 'public.project_tasks'),
      ('table', 'public.projects'),
      ('table', 'public.roles'),
      ('table', 'public.site_visits'),
      ('table', 'public.user_roles'),
      ('table', 'public.users')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_hiring_what_if_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

do $source_shape$
declare
  v_invalid text[];
begin
  with expected(table_name, column_name, data_type) as (
    values
      ('companies', 'id', 'uuid'),
      ('companies', 'deleted_at', 'timestamp with time zone'),
      ('companies', 'timezone', 'text'),
      ('companies', 'currency_code', 'text'),
      ('companies', 'default_work_start', 'time without time zone'),
      ('companies', 'default_work_end', 'time without time zone'),
      ('companies', 'skip_weekends_in_auto_schedule', 'boolean'),
      ('users', 'id', 'uuid'),
      ('users', 'company_id', 'uuid'),
      ('users', 'is_active', 'boolean'),
      ('users', 'deleted_at', 'timestamp with time zone'),
      ('roles', 'id', 'uuid'),
      ('roles', 'company_id', 'uuid'),
      ('roles', 'name', 'text'),
      ('user_roles', 'user_id', 'text'),
      ('user_roles', 'role_id', 'uuid'),
      ('projects', 'id', 'uuid'),
      ('projects', 'company_id', 'uuid'),
      ('projects', 'deleted_at', 'timestamp with time zone'),
      ('project_tasks', 'id', 'uuid'),
      ('project_tasks', 'company_id', 'uuid'),
      ('project_tasks', 'project_id', 'uuid'),
      ('project_tasks', 'team_member_ids', 'ARRAY'),
      ('project_tasks', 'start_date', 'timestamp with time zone'),
      ('project_tasks', 'end_date', 'timestamp with time zone'),
      ('project_tasks', 'start_time', 'time without time zone'),
      ('project_tasks', 'end_time', 'time without time zone'),
      ('project_tasks', 'all_day', 'boolean'),
      ('project_tasks', 'duration', 'integer'),
      ('project_tasks', 'status', 'text'),
      ('project_tasks', 'deleted_at', 'timestamp with time zone'),
      ('site_visits', 'id', 'uuid'),
      ('site_visits', 'company_id', 'text'),
      ('site_visits', 'project_ref', 'uuid'),
      ('site_visits', 'project_id', 'text'),
      ('site_visits', 'scheduled_at', 'timestamp with time zone'),
      ('site_visits', 'duration_minutes', 'integer'),
      ('site_visits', 'assignee_ids', 'ARRAY'),
      ('site_visits', 'booked_at', 'timestamp with time zone'),
      ('site_visits', 'status', 'USER-DEFINED'),
      ('site_visits', 'deleted_at', 'timestamp with time zone'),
      ('calendar_user_events', 'id', 'uuid'),
      ('calendar_user_events', 'company_id', 'text'),
      ('calendar_user_events', 'user_id', 'text'),
      ('calendar_user_events', 'team_member_ids', 'ARRAY'),
      ('calendar_user_events', 'type', 'text'),
      ('calendar_user_events', 'status', 'text'),
      ('calendar_user_events', 'start_date', 'timestamp with time zone'),
      ('calendar_user_events', 'end_date', 'timestamp with time zone'),
      ('calendar_user_events', 'all_day', 'boolean'),
      ('calendar_user_events', 'deleted_at', 'timestamp with time zone'),
      ('payments', 'id', 'uuid'),
      ('payments', 'company_id', 'uuid'),
      ('payments', 'invoice_id', 'uuid'),
      ('payments', 'amount', 'numeric'),
      ('payments', 'payment_date', 'date'),
      ('payments', 'voided_at', 'timestamp with time zone'),
      ('invoices', 'id', 'uuid'),
      ('invoices', 'company_id', 'uuid'),
      ('invoices', 'project_ref', 'uuid'),
      ('invoices', 'project_id', 'uuid'),
      ('invoices', 'deleted_at', 'timestamp with time zone'),
      ('expenses', 'id', 'uuid'),
      ('expenses', 'company_id', 'uuid'),
      ('expenses', 'amount', 'numeric'),
      ('expenses', 'currency', 'text'),
      ('expenses', 'expense_date', 'date'),
      ('expenses', 'status', 'text'),
      ('expenses', 'deleted_at', 'timestamp with time zone'),
      ('expense_project_allocations', 'id', 'uuid'),
      ('expense_project_allocations', 'expense_id', 'uuid'),
      ('expense_project_allocations', 'project_id', 'text'),
      ('expense_project_allocations', 'amount', 'numeric'),
      ('expense_project_allocations', 'percentage', 'numeric')
  )
  select pg_catalog.array_agg(
           expected.table_name || '.' || expected.column_name
           order by expected.table_name, expected.column_name
         )
    into v_invalid
  from expected
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = expected.table_name
   and column_row.column_name = expected.column_name
  where column_row.column_name is null
     or column_row.data_type is distinct from expected.data_type;

  if v_invalid is not null then
    raise exception 'agent_hiring_what_if_source_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$source_shape$;

create index if not exists idx_site_visits_agent_hiring_history_v1
  on public.site_visits (company_id, scheduled_at, id)
  include (
    project_ref,
    project_id,
    duration_minutes,
    assignee_ids,
    status,
    booked_at
  )
  where deleted_at is null
    and booked_at is not null
    and status <> 'cancelled';

do $history_index_shape$
declare
  v_method text;
  v_valid boolean;
  v_ready boolean;
  v_unique boolean;
  v_key_count smallint;
  v_attribute_count smallint;
  v_attribute_names text[];
  v_has_nondefault_option boolean;
  v_predicate text;
  v_normalized_predicate text;
begin
  select access_method.amname,
         index_row.indisvalid,
         index_row.indisready,
         index_row.indisunique,
         index_row.indnkeyatts,
         index_row.indnatts,
         pg_catalog.array_agg(
           attribute.attname order by index_key.ordinality
         ),
         (
           select coalesce(pg_catalog.bool_or(option_value <> 0), false)
           from pg_catalog.unnest(
             index_row.indoption::smallint[]
           ) option_row(option_value)
         ),
         pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
    into v_method, v_valid, v_ready, v_unique, v_key_count,
         v_attribute_count, v_attribute_names, v_has_nondefault_option,
         v_predicate
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  cross join lateral pg_catalog.unnest(
    index_row.indkey::smallint[]
  ) with ordinality index_key(attribute_number, ordinality)
  join pg_catalog.pg_attribute attribute
    on attribute.attrelid = index_row.indrelid
   and attribute.attnum = index_key.attribute_number
  where index_row.indexrelid =
    'public.idx_site_visits_agent_hiring_history_v1'::regclass
  group by access_method.amname, index_row.indisvalid, index_row.indisready,
           index_row.indisunique, index_row.indnkeyatts, index_row.indnatts,
           index_row.indoption, index_row.indpred, index_row.indrelid;

  v_normalized_predicate := pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.lower(v_predicate),
      '::[a-z_][a-z0-9_."$]*',
      '',
      'g'
    ),
    '[()[:space:]]',
    '',
    'g'
  );

  if v_method is distinct from 'btree'
     or v_valid is distinct from true
     or v_ready is distinct from true
     or v_unique is distinct from false
     or v_key_count is distinct from 3
     or v_attribute_count is distinct from 9
     or v_attribute_names is distinct from array[
       'company_id', 'scheduled_at', 'id', 'project_ref', 'project_id',
       'duration_minutes', 'assignee_ids', 'status', 'booked_at'
     ]::text[]
     or v_has_nondefault_option is distinct from false
     or v_normalized_predicate is distinct from
       'deleted_atisnullandbooked_atisnotnullandstatus<>''cancelled''' then
    raise exception 'agent_hiring_what_if_history_index_shape_invalid'
      using errcode = '55000';
  end if;
end;
$history_index_shape$;

-- Correct the canonical ISO 4217 helper for current two-decimal currencies
-- that the public currency contract already accepts. The wrapper and money
-- converter delegate to this function, so their signatures remain unchanged.
create or replace function private.agent_currency_minor_exponent(
  p_currency_code text
) returns smallint
language plpgsql
immutable
strict
set search_path = pg_catalog
as $function$
begin
  case upper(p_currency_code)
    when 'JPY' then
      return 0;
    when 'CAD' then
      return 2;
    when 'BHD' then
      return 3;
    when 'CLF' then
      return 4;
    when 'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'KMF', 'KRW', 'PYG',
         'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF' then
      return 0;
    when 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND' then
      return 3;
    when 'UYW' then
      return 4;
    when 'AED', 'AFN', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
         'BAM', 'BBD', 'BDT', 'BGN', 'BMD', 'BND', 'BOB', 'BOV', 'BRL',
         'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CDF', 'CHF', 'CHE', 'CHW',
         'CNY', 'COP', 'COU', 'CRC', 'CUP', 'CVE', 'CZK', 'DKK', 'DOP',
         'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL',
         'GHS', 'GIP', 'GMD', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF',
         'IDR', 'ILS', 'INR', 'IRR', 'JMD', 'KES', 'KGS', 'KHR', 'KPW',
         'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'MAD', 'MDL',
         'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK',
         'MXN', 'MXV', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR',
         'NZD', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'QAR', 'RON',
         'RSD', 'RUB', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP',
         'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB',
         'TJS', 'TMT', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'USD',
         'USN', 'UYU', 'UZS', 'VED', 'VES', 'WST', 'XCD', 'XCG', 'YER',
         'ZAR', 'ZMW', 'ZWL', 'ZWG' then
      return 2;
    else
      raise exception 'agent_currency_minor_exponent_unknown: %',
        p_currency_code using errcode = '22023';
  end case;
end;
$function$;

revoke all on function private.agent_currency_minor_exponent(text)
  from public, anon, authenticated, service_role;

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
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_permission_snapshot_revision text;
  v_required_permissions constant jsonb := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('permission', 'calendar.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'expenses.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'projects.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'projects.view_financials', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'reports.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'settings.company', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'tasks.view', 'scope', 'all'),
    pg_catalog.jsonb_build_object('permission', 'team.view', 'scope', 'all')
  );
  v_required_scopes constant text[] := array[
    'ops.company.read',
    'ops.expenses.read',
    'ops.financial_documents.read',
    'ops.financials.read',
    'ops.jobs.read',
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
  if p_capability_manifest_revision is distinct from
       '2026-08-31.capability-manifest.v11'
     or p_exposure_revision is distinct from
       '2026-08-31.mcp-exposure.v5' then
    raise exception 'AGENT_HIRING_WHAT_IF_REVISION_INVALID'
      using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array[
      'calendar.view', 'expenses.view', 'invoices.view', 'projects.view',
      'projects.view_financials', 'reports.view', 'settings.company',
      'tasks.view', 'team.view'
    ]
  ) authority
  where p_permission_snapshot_revision is not null
    and p_permission_snapshot_revision is not distinct from
      authority.permission_snapshot_revision
    and authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null then
    raise exception 'AGENT_HIRING_WHAT_IF_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
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
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = p_granted_scope_ceiling
      and grant_record.revoked_at is null
      and grant_record.exposure_revision = '2026-08-31.mcp-exposure.v5'
      and grant_record.accepted_labels =
        private.mcp_oauth_labels_for_scopes(
          grant_record.scopes,
          grant_record.consent_catalog_revision
        )
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_HIRING_WHAT_IF_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_hiring_what_if_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_hiring_what_if_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_role text,
  p_observed_at timestamp with time zone,
  p_window_weeks integer,
  p_member_limit integer,
  p_schedule_source_limit integer,
  p_financial_source_limit integer,
  p_project_limit integer,
  p_supporting_record_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_window_weeks constant integer := 13;
  v_min_usable_weeks constant integer := 8;
  v_min_financial_projects constant integer := 3;
  v_schedule_workload_limit constant bigint := 500000;
  v_assignments_per_record_limit constant integer := 100;
  v_timezone text;
  v_currency text;
  v_currency_minor_exponent smallint;
  v_default_work_start time without time zone;
  v_default_work_end time without time zone;
  v_skip_weekends boolean;
  v_standard_daily_capacity_minutes integer;
  v_business_date date;
  v_window_start date;
  v_window_end date;
  v_next_week_start date;
  v_workdays smallint[];
  v_source_revisions jsonb;
  v_role_count integer;
  v_role_id uuid;
  v_role_name text;
  v_member_count integer := 0;
  v_multi_role_member_count integer := 0;
  v_role_state text;
  v_reason text;
  v_supporting_records jsonb := '[]'::jsonb;
  v_supporting_omitted integer := 0;
  v_result jsonb;
begin
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_granted_scope_ceiling is null
     or p_permission_snapshot_revision is null
     or p_role is null
     or pg_catalog.btrim(p_role) = ''
     or pg_catalog.char_length(pg_catalog.btrim(p_role)) > 80
     or p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_window_weeks is distinct from v_window_weeks
     or p_member_limit is distinct from 25
     or p_schedule_source_limit is distinct from 5001
     or p_financial_source_limit is distinct from 5001
     or p_project_limit is distinct from 251
     or p_supporting_record_limit is distinct from 100 then
    raise exception 'AGENT_HIRING_WHAT_IF_INPUT_INVALID'
      using errcode = '22023';
  end if;

  perform private.assert_agent_hiring_what_if_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision
  );

  select company.timezone,
         pg_catalog.upper(pg_catalog.btrim(company.currency_code)),
         company.default_work_start,
         company.default_work_end,
         coalesce(company.skip_weekends_in_auto_schedule, true)
    into v_timezone, v_currency, v_default_work_start, v_default_work_end,
         v_skip_weekends
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;

  v_currency_minor_exponent :=
    private.agent_currency_minor_exponent_or_null(v_currency);
  if v_timezone is null
     or v_timezone is distinct from pg_catalog.btrim(v_timezone)
     or not exists (
       select 1 from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_timezone
     )
     or v_currency !~ '^[A-Z]{3}$'
     or v_currency_minor_exponent is null
     or v_default_work_start is null
     or v_default_work_end is null
     or v_default_work_start >= v_default_work_end then
    raise exception 'AGENT_HIRING_WHAT_IF_COMPANY_CONFIGURATION_INVALID'
      using errcode = '55000';
  end if;

  v_standard_daily_capacity_minutes := pg_catalog.floor(
    extract(epoch from v_default_work_end - v_default_work_start) / 60
  )::integer;
  if v_standard_daily_capacity_minutes not between 1 and 1440 then
    raise exception 'AGENT_HIRING_WHAT_IF_COMPANY_CONFIGURATION_INVALID'
      using errcode = '55000';
  end if;

  v_business_date := (p_observed_at at time zone v_timezone)::date;
  v_window_end := pg_catalog.date_trunc('week', v_business_date)::date;
  v_window_start := v_window_end - (v_window_weeks * 7);
  v_next_week_start := v_window_end + 7;
  v_workdays := case when v_skip_weekends
    then array[1, 2, 3, 4, 5]::smallint[]
    else array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  end;

  select pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'domain', required.domain,
             'revision', revision.source_revision
           ) order by required.ordinality
         )
    into v_source_revisions
  from pg_catalog.unnest(array[
    'availability', 'company', 'expenses', 'payments', 'sales_documents',
    'site_visits', 'tasks', 'team'
  ]::text[]) with ordinality required(domain, ordinality)
  join private.agent_read_domain_revisions revision
    on revision.company_id = p_company_id
   and revision.domain = required.domain
   and revision.source_revision between 0 and 9007199254740991;
  if v_source_revisions is null
     or pg_catalog.jsonb_array_length(v_source_revisions) <> 8 then
    raise exception 'AGENT_HIRING_WHAT_IF_SOURCE_REVISION_UNAVAILABLE'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)::integer,
         (pg_catalog.array_agg(role_source.id order by role_source.id))[1],
         (pg_catalog.array_agg(role_source.name order by role_source.id))[1]
    into v_role_count, v_role_id, v_role_name
  from public.roles role_source
  where (role_source.company_id is null
         or role_source.company_id = p_company_id)
    and lower(btrim(role_source.name)) = lower(btrim(p_role));

  if v_role_count = 1 then
    select pg_catalog.count(*)::integer,
           pg_catalog.count(*) filter (
             where role_totals.role_count > 1
           )::integer
      into v_member_count, v_multi_role_member_count
    from public.users member
    join public.user_roles selected_role
      on selected_role.user_id = member.id::text
     and selected_role.role_id = v_role_id
    cross join lateral (
      select pg_catalog.count(*)::integer as role_count
      from public.user_roles member_role
      where member_role.user_id = member.id::text
    ) role_totals
    where member.company_id = p_company_id
      and member.deleted_at is null
      and member.is_active is true;
  end if;

  v_role_state := case
    when v_role_count = 0 then 'not_found'
    when v_role_count > 1 then 'ambiguous'
    when v_member_count = 0 then 'no_members'
    when v_member_count > p_member_limit then 'population_exceeded'
    else 'resolved'
  end;

  if v_role_state <> 'resolved' then
    v_reason := case v_role_state
      when 'not_found' then 'role_not_found'
      when 'ambiguous' then 'role_ambiguous'
      when 'population_exceeded' then 'role_population_exceeded'
      else 'no_comparable_members'
    end;
    with candidates as materialized (
      select role_source.id
      from public.roles role_source
      where (role_source.company_id is null
             or role_source.company_id = p_company_id)
        and lower(btrim(role_source.name)) = lower(btrim(p_role))
      order by role_source.id
    ), retained as materialized (
      select * from candidates limit p_supporting_record_limit
    )
    select coalesce(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'kind', 'role',
               'id', retained.id,
               'observed_on', pg_catalog.to_char(v_business_date, 'YYYY-MM-DD')
             ) order by retained.id
           ), '[]'::jsonb),
           greatest(
             (select pg_catalog.count(*) from candidates) -
             (select pg_catalog.count(*) from retained),
             0
           )::integer
      into v_supporting_records, v_supporting_omitted
    from retained;

    return pg_catalog.jsonb_build_object(
      'observed_at', pg_catalog.to_char(
        p_observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'business_date', pg_catalog.to_char(v_business_date, 'YYYY-MM-DD'),
      'timezone', v_timezone,
      'currency', v_currency,
      'currency_minor_exponent', v_currency_minor_exponent,
      'window', pg_catalog.jsonb_build_object(
        'starts_on', pg_catalog.to_char(v_window_start, 'YYYY-MM-DD'),
        'ends_on', pg_catalog.to_char(v_window_end, 'YYYY-MM-DD'),
        'complete_weeks', v_window_weeks,
        'next_week_starts_on',
          pg_catalog.to_char(v_next_week_start, 'YYYY-MM-DD'),
        'workdays', pg_catalog.to_jsonb(v_workdays),
        'standard_daily_capacity_minutes',
          v_standard_daily_capacity_minutes
      ),
      'role', pg_catalog.jsonb_build_object('state', v_role_state),
      'weeks', '[]'::jsonb,
      'completeness', pg_catalog.jsonb_build_object(
        'source_state', 'insufficient',
        'role_project_count', 0,
        'financially_observed_project_count', 0,
        'source_counts', pg_catalog.jsonb_build_object(
          'members', case when v_role_count = 1 then v_member_count else 0 end,
          'tasks', 0, 'site_visits', 0, 'projects', 0,
          'payments', 0, 'expenses', 0
        ),
        'omitted_counts', pg_catalog.jsonb_build_object(
          'supporting_records', v_supporting_omitted,
          'invalid_schedule_records', 0,
          'invalid_currency_expenses', 0
        ),
        'reasons', pg_catalog.jsonb_build_array(v_reason)
      ),
      'source_revisions', v_source_revisions,
      'supporting_records', v_supporting_records
    );
  end if;

  with role_members as materialized (
    select member.id
    from public.users member
    join public.user_roles selected_role
      on selected_role.user_id = member.id::text
     and selected_role.role_id = v_role_id
    where member.company_id = p_company_id
      and member.deleted_at is null
      and member.is_active is true
    order by member.id
  ), active_members as materialized (
    select member.id
    from public.users member
    where member.company_id = p_company_id
      and member.deleted_at is null
      and member.is_active is true
  ), task_candidate as materialized (
    select 'project_task'::text as source_kind,
           task.id as source_id,
           task.project_id,
           coalesce(task.team_member_ids, array[]::text[]) as member_ids,
           task.all_day,
           false as is_time_off,
           normalized.starts_on,
           normalized.ends_on,
           case when not task.all_day then
             private.agent_unambiguous_local_instant(
               (normalized.starts_on + task.start_time)::timestamp,
               v_timezone
             )
           end as starts_at,
           case when not task.all_day then
             private.agent_unambiguous_local_instant(
               (normalized.ends_on + task.end_time)::timestamp,
               v_timezone
             )
           end as ends_at,
           task.project_id is null
             or task.all_day is null
             or normalized.starts_on is null
             or normalized.ends_on is null
             or normalized.ends_on < normalized.starts_on
             or pg_catalog.cardinality(
                  coalesce(task.team_member_ids, array[]::text[])
                ) not between 1 and v_assignments_per_record_limit
             or exists (
               select 1
               from pg_catalog.unnest(
                 coalesce(task.team_member_ids, array[]::text[])
               ) assignment(member_id)
               where assignment.member_id is null
                  or assignment.member_id !~
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             )
             or not task.all_day and (
               task.start_time is null or task.end_time is null
             ) as source_invalid
    from public.project_tasks task
    cross join lateral (
      select case when task.start_date is not null
                    and pg_catalog.isfinite(task.start_date)
               then (task.start_date at time zone 'UTC')::date
             end as starts_on,
             case
               when task.end_date is not null
                and pg_catalog.isfinite(task.end_date)
                 then (task.end_date at time zone 'UTC')::date
               when task.start_date is not null
                and pg_catalog.isfinite(task.start_date)
                 then (task.start_date at time zone 'UTC')::date +
                   case
                     when task.all_day
                       then greatest(coalesce(task.duration, 1) - 1, 0)
                     when task.start_time is not null
                      and task.end_time is not null
                      and task.end_time <= task.start_time then 1
                     else 0
                   end
             end as ends_on
    ) normalized
    where task.company_id = p_company_id
      and task.deleted_at is null
      and task.status <> 'cancelled'
      and normalized.starts_on < v_window_end
      and normalized.ends_on >= v_window_start
  ), site_visit_candidate as materialized (
    select 'site_visit'::text as source_kind,
           visit.id as source_id,
           coalesce(
             visit.project_ref,
             private.agent_read_domain_uuid_from_text(visit.project_id)
           ) as project_id,
           coalesce(visit.assignee_ids, array[]::text[]) as member_ids,
           false as all_day,
           false as is_time_off,
           (visit.scheduled_at at time zone v_timezone)::date as starts_on,
           ((
             visit.scheduled_at + pg_catalog.make_interval(
               mins => case when visit.duration_minutes between 1 and 1440
                 then visit.duration_minutes else 1 end
             )
           ) at time zone v_timezone)::date as ends_on,
           visit.scheduled_at as starts_at,
           case when visit.duration_minutes between 1 and 1440
             then visit.scheduled_at + pg_catalog.make_interval(
               mins => visit.duration_minutes
             )
           end as ends_at,
           coalesce(
             visit.project_ref,
             private.agent_read_domain_uuid_from_text(visit.project_id)
           ) is null
             or not pg_catalog.isfinite(visit.scheduled_at)
             or visit.duration_minutes not between 1 and 1440
             or pg_catalog.cardinality(
                  coalesce(visit.assignee_ids, array[]::text[])
                ) not between 1 and v_assignments_per_record_limit
             or exists (
               select 1
               from pg_catalog.unnest(
                 coalesce(visit.assignee_ids, array[]::text[])
               ) assignment(member_id)
               where assignment.member_id is null
                  or assignment.member_id !~
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             ) as source_invalid
    from public.site_visits visit
    where visit.company_id = p_company_id::text
      and visit.deleted_at is null
      and visit.booked_at is not null
      and visit.status <> 'cancelled'
      and visit.scheduled_at > private.agent_unambiguous_local_instant(
            v_window_start::timestamp, v_timezone
          ) - interval '1 day'
      and visit.scheduled_at < private.agent_unambiguous_local_instant(
        v_window_end::timestamp, v_timezone
      )
      and visit.scheduled_at + pg_catalog.make_interval(
            mins => case when visit.duration_minutes between 1 and 1440
              then visit.duration_minutes else 1 end
          ) > private.agent_unambiguous_local_instant(
            v_window_start::timestamp, v_timezone
          )
  ), calendar_candidate as materialized (
    select 'time_off'::text as source_kind,
           calendar.id as source_id,
           null::uuid as project_id,
           assignments.member_ids,
           calendar.all_day,
           true as is_time_off,
           (calendar.start_date at time zone v_timezone)::date as starts_on,
           (calendar.end_date at time zone v_timezone)::date as ends_on,
           calendar.start_date as starts_at,
           calendar.end_date as ends_at,
           calendar.all_day is null
             or not pg_catalog.isfinite(calendar.start_date)
             or not pg_catalog.isfinite(calendar.end_date)
             or calendar.end_date < calendar.start_date
             or pg_catalog.cardinality(assignments.member_ids)
                  not between 1 and v_assignments_per_record_limit
             or exists (
               select 1
               from pg_catalog.unnest(assignments.member_ids)
                 assignment(member_id)
               where assignment.member_id is null
                  or assignment.member_id !~
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             ) as source_invalid
    from public.calendar_user_events calendar
    cross join lateral (
      select coalesce(
               pg_catalog.array_agg(distinct source.member_id
                                    order by source.member_id),
               array[]::text[]
             ) as member_ids
      from (
        select calendar.user_id as member_id
        union all
        select team.member_id
        from pg_catalog.unnest(
          coalesce(calendar.team_member_ids, array[]::text[])
        ) team(member_id)
        where calendar.type = 'personal'
      ) source
    ) assignments
    where calendar.company_id = p_company_id::text
      and calendar.deleted_at is null
      and calendar.type = 'time_off'
      and calendar.status in ('approved', 'none')
      and calendar.start_date < private.agent_unambiguous_local_instant(
        v_window_end::timestamp, v_timezone
      )
      and calendar.end_date >= private.agent_unambiguous_local_instant(
        v_window_start::timestamp, v_timezone
      )
  ), schedule_source_gate as materialized (
    select source.source_kind,
           source.source_id,
           source.project_id,
           source.member_ids,
           source.all_day,
           source.is_time_off,
           source.starts_on,
           source.ends_on,
           source.starts_at,
           source.ends_at,
           source.source_invalid
    from (
      select source_kind, source_id, project_id, member_ids, all_day,
             is_time_off, starts_on, ends_on, starts_at, ends_at,
             source_invalid
      from task_candidate
      union all
      select source_kind, source_id, project_id, member_ids, all_day,
             is_time_off, starts_on,
             (ends_at at time zone v_timezone)::date as ends_on,
             starts_at, ends_at, source_invalid
      from site_visit_candidate
      union all
      select source_kind, source_id, project_id, member_ids, all_day,
             is_time_off, starts_on, ends_on, starts_at, ends_at,
             source_invalid
      from calendar_candidate
    ) source
    order by source.source_kind, source.source_id
    limit p_schedule_source_limit
  ), schedule_state as materialized (
    select pg_catalog.count(*)::integer as source_count,
           pg_catalog.count(*) >= p_schedule_source_limit as exceeded,
           pg_catalog.count(*) filter (
             where source.source_kind = 'project_task'
           )::integer as task_count,
           pg_catalog.count(*) filter (
             where source.source_kind = 'site_visit'
           )::integer as site_visit_count,
           pg_catalog.count(*) filter (
             where source.source_invalid
           )::integer as invalid_count,
           coalesce(pg_catalog.sum(
             least(
               greatest(source.ends_on - source.starts_on + 1, 1),
               v_window_weeks * 7
             )::bigint * pg_catalog.cardinality(source.member_ids)::bigint
           ), 0)::bigint as workload
    from schedule_source_gate source
  ), project_source as materialized (
    select distinct source.project_id
    from schedule_source_gate source
    join public.projects project
      on project.id = source.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    where not source.is_time_off
      and not source.source_invalid
    order by source.project_id
    limit p_project_limit
  ), project_state as materialized (
    select pg_catalog.count(*)::integer as source_count,
           pg_catalog.count(*) >= p_project_limit as exceeded
    from project_source
  ), retained_projects as materialized (
    select source.project_id
    from project_source source
    order by source.project_id
    limit p_project_limit - 1
  ), retained_schedule as materialized (
    select source.*
    from schedule_source_gate source
    cross join schedule_state schedule
    where not schedule.exceeded
      and schedule.workload <= v_schedule_workload_limit
      and (
        source.is_time_off
        or exists (
          select 1 from retained_projects project
          where project.project_id = source.project_id
        )
      )
  ), assigned_source as materialized (
    select distinct source.source_kind,
           source.source_id,
           source.project_id,
           member.id as member_id,
           source.all_day,
           source.is_time_off,
           source.starts_on,
           source.ends_on,
           source.starts_at,
           source.ends_at
    from retained_schedule source
    cross join lateral pg_catalog.unnest(source.member_ids)
      assignment(member_id)
    join active_members member
      on member.id::text = assignment.member_id
    where not source.source_invalid
  ), capacity_day_base as materialized (
    select member.id as member_id,
           v_window_start + day_offset.value as day_date
    from role_members member
    cross join pg_catalog.generate_series(
      0, v_window_end - v_window_start - 1
    ) day_offset(value)
  ), capacity_day as materialized (
    select capacity_day.*
    from capacity_day_base capacity_day
    where not v_skip_weekends
       or extract(isodow from capacity_day.day_date) < 6
  ), time_off_day as materialized (
    select distinct source.member_id,
           day_offset.day_date
    from assigned_source source
    cross join lateral pg_catalog.generate_series(
      greatest(source.starts_on, v_window_start),
      least(source.ends_on, v_window_end - 1),
      interval '1 day'
    ) day_offset(day_date)
    where source.is_time_off
  ), resolved_capacity_day as materialized (
    select capacity.member_id,
           capacity.day_date,
           private.agent_unambiguous_local_instant(
             (capacity.day_date + v_default_work_start)::timestamp,
             v_timezone
           ) as work_starts_at,
           private.agent_unambiguous_local_instant(
             (capacity.day_date + v_default_work_end)::timestamp,
             v_timezone
           ) as work_ends_at,
           time_off.member_id is not null as has_time_off
    from capacity_day capacity
    left join time_off_day time_off
      on time_off.member_id = capacity.member_id
     and time_off.day_date::date = capacity.day_date
  ), weekly_capacity as materialized (
    select pg_catalog.date_trunc('week', capacity.day_date)::date as starts_on,
           pg_catalog.sum(case when capacity.has_time_off then 0 else
             pg_catalog.floor(extract(epoch from
               capacity.work_ends_at - capacity.work_starts_at
             ) / 60)::integer
           end)::integer as capacity_minutes
    from resolved_capacity_day capacity
    where capacity.work_starts_at is not null
      and capacity.work_ends_at > capacity.work_starts_at
    group by pg_catalog.date_trunc('week', capacity.day_date)::date
  ), schedule_day as materialized (
    select source.*,
           day_offset.day_date::date as day_date
    from assigned_source source
    cross join lateral pg_catalog.generate_series(
      greatest(source.starts_on, v_window_start),
      least(source.ends_on, v_window_end - 1),
      interval '1 day'
    ) day_offset(day_date)
    where not source.is_time_off
      and (not v_skip_weekends
           or extract(isodow from day_offset.day_date) < 6)
  ), schedule_work_window as materialized (
    select source.*,
           private.agent_unambiguous_local_instant(
             (source.day_date + v_default_work_start)::timestamp,
             v_timezone
           ) as work_starts_at,
           private.agent_unambiguous_local_instant(
             (source.day_date + v_default_work_end)::timestamp,
             v_timezone
           ) as work_ends_at
    from schedule_day source
    where not exists (
      select 1 from time_off_day time_off
      where time_off.member_id = source.member_id
        and time_off.day_date::date = source.day_date
    )
  ), unclipped_range_source as materialized (
    select source.source_kind,
           source.source_id,
           source.project_id,
           source.member_id,
           source.day_date,
           case when source.all_day
             then source.work_starts_at else source.starts_at end as starts_at,
           case when source.all_day
             then source.work_ends_at else source.ends_at end as ends_at,
           source.work_starts_at,
           source.work_ends_at
    from schedule_work_window source
  ), clipped_range as materialized (
    select range_source.*,
           pg_catalog.tstzrange(
             greatest(range_source.starts_at, range_source.work_starts_at),
             least(range_source.ends_at, range_source.work_ends_at),
             '[)'
           ) as occupied_range
    from unclipped_range_source range_source
    where range_source.starts_at is not null
      and range_source.ends_at is not null
      and greatest(range_source.starts_at, range_source.work_starts_at) <
          least(range_source.ends_at, range_source.work_ends_at)
  ), merged_role_multirange as materialized (
    select range_source.member_id,
           range_source.day_date,
           pg_catalog.range_agg(range_source.occupied_range) as occupied
    from clipped_range range_source
    join role_members member on member.id = range_source.member_id
    group by range_source.member_id, range_source.day_date
  ), merged_role_range as materialized (
    select source.member_id,
           source.day_date,
           pg_catalog.lower(part.value) as starts_at,
           pg_catalog.upper(part.value) as ends_at
    from merged_role_multirange source
    cross join lateral pg_catalog.unnest(source.occupied) part(value)
  ), weekly_productive as materialized (
    select pg_catalog.date_trunc('week', merged_range.day_date)::date
             as starts_on,
           pg_catalog.floor(extract(epoch from
             sum(merged_range.ends_at - merged_range.starts_at)
           ) / 60)::integer as productive_minutes
    from merged_role_range merged_range
    group by pg_catalog.date_trunc('week', merged_range.day_date)::date
  ), merged_project_multirange as materialized (
    select range_source.project_id,
           range_source.member_id,
           range_source.day_date,
           pg_catalog.range_agg(range_source.occupied_range) as occupied
    from clipped_range range_source
    group by range_source.project_id, range_source.member_id,
             range_source.day_date
  ), merged_project_range as materialized (
    select source.project_id,
           source.member_id,
           source.day_date,
           pg_catalog.lower(part.value) as starts_at,
           pg_catalog.upper(part.value) as ends_at
    from merged_project_multirange source
    cross join lateral pg_catalog.unnest(source.occupied) part(value)
  ), project_member_week_minutes as materialized (
    select source.project_id,
           source.member_id,
           pg_catalog.date_trunc('week', source.day_date)::date as starts_on,
           pg_catalog.floor(extract(epoch from
             sum(source.ends_at - source.starts_at)
           ) / 60)::bigint as minutes
    from merged_project_range source
    group by source.project_id, source.member_id,
             pg_catalog.date_trunc('week', source.day_date)::date
  ), project_week_minutes as materialized (
    select source.project_id,
           source.starts_on,
           pg_catalog.sum(source.minutes)::numeric as project_all_minutes,
           pg_catalog.sum(source.minutes) filter (
             where role_member.id is not null
           )::numeric as project_role_minutes
    from project_member_week_minutes source
    left join role_members role_member on role_member.id = source.member_id
    group by source.project_id, source.starts_on
  ), project_total_minutes as materialized (
    select source.project_id,
           pg_catalog.sum(source.project_all_minutes)::numeric
             as project_all_minutes,
           coalesce(pg_catalog.sum(source.project_role_minutes), 0)::numeric
             as project_role_minutes
    from project_week_minutes source
    group by source.project_id
  ), payment_source_gate as materialized (
    select payment.id,
           coalesce(invoice.project_ref, invoice.project_id) as project_id,
           payment.payment_date,
           payment.amount
    from public.payments payment
    join public.invoices invoice
      on invoice.id = payment.invoice_id
     and invoice.company_id = p_company_id
     and invoice.deleted_at is null
    join retained_projects project
      on project.project_id = coalesce(invoice.project_ref, invoice.project_id)
    where payment.company_id = p_company_id
      and payment.voided_at is null
      and payment.payment_date >= v_window_start
      and payment.payment_date < v_window_end
      and payment.amount > 0
    order by payment.payment_date, payment.id
    limit p_financial_source_limit
  ), payment_state as materialized (
    select pg_catalog.count(*)::integer as source_count,
           pg_catalog.count(*) >= p_financial_source_limit as exceeded
    from payment_source_gate
  ), project_payment as materialized (
    select source.project_id,
           pg_catalog.sum(
             private.agent_money_to_minor_units(source.amount, v_currency)
           )::numeric as revenue_minor
    from payment_source_gate source
    cross join payment_state state
    where not state.exceeded
    group by source.project_id
  ), expense_source_gate as materialized (
    select allocation.id as allocation_id,
           expense.id,
           private.agent_read_domain_uuid_from_text(allocation.project_id)
             as project_id,
           expense.expense_date,
           expense.currency,
           coalesce(
             allocation.amount,
             expense.amount * allocation.percentage / 100::numeric
           ) as allocation_amount
    from public.expense_project_allocations allocation
    join public.expenses expense
      on expense.id = allocation.expense_id
     and expense.company_id = p_company_id
     and expense.deleted_at is null
    join retained_projects project
      on project.project_id =
        private.agent_read_domain_uuid_from_text(allocation.project_id)
    where expense.expense_date >= v_window_start
      and expense.expense_date < v_window_end
      and expense.status = any(
        array['submitted', 'approved', 'reimbursed']::text[]
      )
    order by expense.expense_date, expense.id, allocation.id
    limit p_financial_source_limit
  ), expense_evaluated as materialized (
    select source.*,
           coalesce(
             source.allocation_amount is not null
               and source.currency is not null
               and pg_catalog.upper(pg_catalog.btrim(source.currency)) =
                     v_currency
               and private.agent_currency_minor_exponent_or_null(
                 pg_catalog.upper(pg_catalog.btrim(source.currency))
               ) is not null
               and source.allocation_amount >= 0
               and source.allocation_amount * pg_catalog.power(
                     10::numeric, v_currency_minor_exponent
                   ) = pg_catalog.trunc(
                     source.allocation_amount * pg_catalog.power(
                       10::numeric, v_currency_minor_exponent
                     )
                   ),
             false
           ) as currency_valid
    from expense_source_gate source
  ), expense_state as materialized (
    select pg_catalog.count(*)::integer as allocation_count,
           pg_catalog.count(distinct source.id)::integer as source_count,
           pg_catalog.count(*) >= p_financial_source_limit as exceeded,
           pg_catalog.count(distinct source.id) filter (
             where not source.currency_valid
           )::integer as invalid_currency_count
    from expense_evaluated source
  ), project_expense as materialized (
    select source.project_id,
           pg_catalog.sum(
             private.agent_money_to_minor_units(
               source.allocation_amount, v_currency
             )
           )::numeric as direct_cost_minor
    from expense_evaluated source
    cross join expense_state state
    where not state.exceeded
      and source.currency_valid
    group by source.project_id
  ), project_financial as materialized (
    select minutes.project_id,
           minutes.project_all_minutes,
           minutes.project_role_minutes,
           coalesce(payment.revenue_minor, 0)::numeric as revenue_minor,
           coalesce(expense.direct_cost_minor, 0)::numeric as direct_cost_minor
    from project_total_minutes minutes
    left join project_payment payment on payment.project_id = minutes.project_id
    left join project_expense expense on expense.project_id = minutes.project_id
    where minutes.project_all_minutes > 0
      and minutes.project_role_minutes > 0
  ), project_attribution as materialized (
    select source.*,
           source.project_role_minutes / source.project_all_minutes
             as role_share
    from project_financial source
  ), weekly_attribution as materialized (
    select week.starts_on,
           pg_catalog.round(pg_catalog.sum(
             project.revenue_minor * project.role_share *
             week.project_role_minutes / project.project_role_minutes
           ))::bigint as attributed_revenue_minor,
           pg_catalog.round(pg_catalog.sum(
             project.direct_cost_minor * project.role_share *
             week.project_role_minutes / project.project_role_minutes
           ))::bigint as attributed_direct_cost_minor,
           pg_catalog.count(distinct week.project_id)::integer
             as role_project_count
    from project_week_minutes week
    join project_attribution project on project.project_id = week.project_id
    where week.project_role_minutes > 0
    group by week.starts_on
  ), week_base as materialized (
    select v_window_start + (week_offset.value * 7) as starts_on
    from pg_catalog.generate_series(0, v_window_weeks - 1)
      week_offset(value)
  ), weeks as materialized (
    select week.starts_on,
           coalesce(capacity.capacity_minutes, 0)::integer
             as capacity_minutes,
           least(
             coalesce(capacity.capacity_minutes, 0),
             coalesce(productive.productive_minutes, 0)
           )::integer as productive_minutes,
           greatest(coalesce(financial.attributed_revenue_minor, 0), 0)::bigint
             as attributed_revenue_minor,
           greatest(
             coalesce(financial.attributed_direct_cost_minor, 0), 0
           )::bigint as attributed_direct_cost_minor,
           coalesce(financial.role_project_count, 0)::integer
             as role_project_count
    from week_base week
    left join weekly_capacity capacity on capacity.starts_on = week.starts_on
    left join weekly_productive productive
      on productive.starts_on = week.starts_on
    left join weekly_attribution financial
      on financial.starts_on = week.starts_on
    order by week.starts_on
  ), aggregate_state as materialized (
    select pg_catalog.count(*) filter (
             where week.capacity_minutes > 0
           )::integer as usable_weeks,
           coalesce(pg_catalog.sum(week.attributed_revenue_minor), 0)::numeric
             as revenue_minor,
           coalesce(pg_catalog.sum(
             week.attributed_direct_cost_minor
           ), 0)::numeric as direct_cost_minor
    from weeks week
  ), project_coverage as materialized (
    select pg_catalog.count(*)::integer as role_project_count,
           pg_catalog.count(*) filter (
             where project.revenue_minor > 0
           )::integer as financially_observed_project_count
    from project_attribution project
  ), reason_source as materialized (
    select reason.value
    from schedule_state schedule
    cross join project_state project
    cross join payment_state payment
    cross join expense_state expense
    cross join aggregate_state aggregate
    cross join project_coverage coverage
    cross join lateral (
      values
        ('source_bound_exceeded',
          schedule.exceeded
          or schedule.workload > v_schedule_workload_limit
          or project.exceeded
          or payment.exceeded
          or expense.exceeded),
        ('invalid_schedule_source', schedule.invalid_count > 0),
        ('invalid_currency_expense', expense.invalid_currency_count > 0),
        ('insufficient_usable_weeks',
          aggregate.usable_weeks < v_min_usable_weeks),
        ('insufficient_financial_projects',
          coverage.financially_observed_project_count <
            v_min_financial_projects),
        ('non_positive_revenue', aggregate.revenue_minor <= 0),
        ('non_positive_contribution',
          aggregate.revenue_minor - aggregate.direct_cost_minor <= 0)
    ) reason(value, applies)
    where reason.applies
  ), reasons as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(source.value order by source.value),
             '[]'::jsonb
           ) as value
    from reason_source source
  ), supporting_source as materialized (
    select 'role'::text as kind, v_role_id as id,
           v_business_date as observed_on
    union all
    select 'project', project.project_id,
           coalesce(pg_catalog.min(source.starts_on), v_window_start)
    from retained_projects project
    left join schedule_source_gate source
      on source.project_id = project.project_id
    group by project.project_id
    union all
    select 'project_task', source.source_id, source.starts_on
    from schedule_source_gate source
    where source.source_kind = 'project_task'
    union all
    select 'site_visit', source.source_id, source.starts_on
    from schedule_source_gate source
    where source.source_kind = 'site_visit'
    union all
    select 'payment', source.id, source.payment_date
    from payment_source_gate source
    union all
    select 'expense', source.id, source.expense_date
    from expense_source_gate source
  ), supporting_unique as materialized (
    select distinct on (source.kind, source.id)
           source.kind, source.id, source.observed_on
    from supporting_source source
    where source.id is not null
      and source.observed_on is not null
    order by source.kind, source.id, source.observed_on
  ), supporting_retained as materialized (
    select source.*
    from supporting_unique source
    order by source.kind, source.id
    limit p_supporting_record_limit
  ), supporting as materialized (
    select coalesce(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'kind', source.kind,
               'id', source.id,
               'observed_on', pg_catalog.to_char(
                 source.observed_on, 'YYYY-MM-DD'
               )
             ) order by source.kind, source.id
           ), '[]'::jsonb) as records,
           greatest(
             (select pg_catalog.count(*) from supporting_unique) -
             (select pg_catalog.count(*) from supporting_retained),
             0
           )::integer as omitted_count
    from supporting_retained source
  ), week_projection as materialized (
    select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'starts_on', pg_catalog.to_char(week.starts_on, 'YYYY-MM-DD'),
               'capacity_minutes', week.capacity_minutes,
               'productive_minutes', week.productive_minutes,
               'attributed_revenue_minor', week.attributed_revenue_minor,
               'attributed_direct_cost_minor',
                 week.attributed_direct_cost_minor,
               'role_project_count', week.role_project_count
             ) order by week.starts_on
           ) as value
    from weeks week
  )
  select pg_catalog.jsonb_build_object(
           'observed_at', pg_catalog.to_char(
             p_observed_at at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           ),
           'business_date',
             pg_catalog.to_char(v_business_date, 'YYYY-MM-DD'),
           'timezone', v_timezone,
           'currency', v_currency,
           'currency_minor_exponent', v_currency_minor_exponent,
           'window', pg_catalog.jsonb_build_object(
             'starts_on', pg_catalog.to_char(v_window_start, 'YYYY-MM-DD'),
             'ends_on', pg_catalog.to_char(v_window_end, 'YYYY-MM-DD'),
             'complete_weeks', v_window_weeks,
             'next_week_starts_on',
               pg_catalog.to_char(v_next_week_start, 'YYYY-MM-DD'),
             'workdays', pg_catalog.to_jsonb(v_workdays),
             'standard_daily_capacity_minutes',
               v_standard_daily_capacity_minutes
           ),
           'role', pg_catalog.jsonb_build_object(
             'state', 'resolved',
             'role_ref', pg_catalog.jsonb_build_object(
               'kind', 'role', 'id', v_role_id
             ),
             'name', v_role_name,
             'active_member_count', v_member_count,
             'multi_role_member_count', v_multi_role_member_count,
             'content_kind', 'untrusted_business_data'
           ),
           'weeks', week_projection.value,
           'completeness', pg_catalog.jsonb_build_object(
             'source_state', case
               when pg_catalog.jsonb_array_length(reasons.value) = 0
                 then 'complete' else 'insufficient' end,
             'role_project_count', coverage.role_project_count,
             'financially_observed_project_count',
               coverage.financially_observed_project_count,
             'source_counts', pg_catalog.jsonb_build_object(
               'members', v_member_count,
               'tasks', schedule.task_count,
               'site_visits', schedule.site_visit_count,
               'projects', project.source_count,
               'payments', payment.source_count,
               'expenses', expense.source_count
             ),
             'omitted_counts', pg_catalog.jsonb_build_object(
               'supporting_records', supporting.omitted_count,
               'invalid_schedule_records', schedule.invalid_count,
               'invalid_currency_expenses', expense.invalid_currency_count
             ),
             'reasons', reasons.value
           ),
           'source_revisions', v_source_revisions,
           'supporting_records', supporting.records
         )
    into v_result
  from schedule_state schedule
  cross join project_state project
  cross join payment_state payment
  cross join expense_state expense
  cross join project_coverage coverage
  cross join reasons
  cross join supporting
  cross join week_projection;

  if v_result is null then
    raise exception 'AGENT_HIRING_WHAT_IF_SOURCE_UNAVAILABLE'
      using errcode = '55000';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_hiring_what_if_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text,
  timestamp with time zone, integer, integer, integer, integer, integer,
  integer
) from public, anon, authenticated, service_role;

grant execute on function public.read_agent_hiring_what_if_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text,
  timestamp with time zone, integer, integer, integer, integer, integer,
  integer
) to service_role;

commit;
