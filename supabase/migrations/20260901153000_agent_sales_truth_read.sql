-- Dormant OPS MCP sales-truth read.
--
-- Adds one authority-bound, bounded snapshot over existing pipeline sources.
-- It changes no business record, creates no draft, and activates no exposure.

begin;

set local timezone = 'UTC';

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'private.agent_read_domains',
    'private.agent_read_domain_revisions',
    'private.mcp_oauth_clients',
    'private.mcp_oauth_grants',
    'public.activities',
    'public.companies',
    'public.opportunities',
    'public.opportunity_dispositions',
    'public.stage_transitions'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_sales_truth_prerequisite_missing: %', v_relation
        using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.bump_agent_read_domain_revision()',
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.agent_unambiguous_local_instant(timestamp without time zone,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_sales_truth_prerequisite_missing: %', v_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

do $source_shape$
declare
  v_invalid text[];
begin
  with expected(table_name, column_name, data_type) as (
    values
      ('activities', 'id', 'uuid'),
      ('activities', 'company_id', 'uuid'),
      ('activities', 'opportunity_id', 'uuid'),
      ('activities', 'type', 'text'),
      ('activities', 'direction', 'text'),
      ('activities', 'created_at', 'timestamp with time zone'),
      ('companies', 'id', 'uuid'),
      ('companies', 'deleted_at', 'timestamp with time zone'),
      ('companies', 'timezone', 'text'),
      ('companies', 'currency_code', 'text'),
      ('opportunities', 'id', 'uuid'),
      ('opportunities', 'company_id', 'uuid'),
      ('opportunities', 'created_at', 'timestamp with time zone'),
      ('opportunities', 'deleted_at', 'timestamp with time zone'),
      ('opportunities', 'merged_into_opportunity_id', 'uuid'),
      ('opportunities', 'stage', 'text'),
      ('opportunities', 'source', 'text'),
      ('opportunities', 'lost_reason', 'text'),
      ('opportunity_dispositions', 'id', 'uuid'),
      ('opportunity_dispositions', 'company_id', 'uuid'),
      ('opportunity_dispositions', 'opportunity_id', 'uuid'),
      ('opportunity_dispositions', 'reason_code', 'text'),
      ('opportunity_dispositions', 'superseded_at', 'timestamp with time zone'),
      ('opportunity_dispositions', 'created_at', 'timestamp with time zone'),
      ('stage_transitions', 'id', 'uuid'),
      ('stage_transitions', 'company_id', 'uuid'),
      ('stage_transitions', 'opportunity_id', 'uuid'),
      ('stage_transitions', 'from_stage', 'text'),
      ('stage_transitions', 'to_stage', 'text'),
      ('stage_transitions', 'transitioned_at', 'timestamp with time zone'),
      ('stage_transitions', 'duration_in_stage', 'interval')
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
    raise exception 'agent_sales_truth_source_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$source_shape$;

insert into private.agent_read_domains (domain)
values ('sales_truth')
on conflict (domain) do nothing;

insert into private.agent_read_domain_revisions (
  company_id,
  domain,
  source_revision,
  updated_at
)
select company.id, 'sales_truth', 0, pg_catalog.statement_timestamp()
from public.companies company
on conflict (company_id, domain) do nothing;

do $cohort_index$
declare
  v_valid boolean;
begin
  if pg_catalog.to_regclass(
       'public.opportunities_agent_sales_truth_cohort_v1_idx'
     ) is null then
    create index opportunities_agent_sales_truth_cohort_v1_idx
      on public.opportunities (company_id, created_at, id)
      where deleted_at is null
        and merged_into_opportunity_id is null;
  end if;

  select count(*) = 1
     and bool_and(
       access_method.amname = 'btree'
       and not index_row.indisunique
       and not index_row.indisprimary
       and index_row.indisvalid
       and index_row.indisready
       and index_row.indislive
       and index_row.indnkeyatts = 3
       and index_row.indnatts = 3
       and index_row.indexprs is null
       and index_relation.reloptions is null
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) =
         'company_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) =
         'created_at'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 3, true) = 'id'
       and pg_catalog.pg_get_expr(
         index_row.indpred, index_row.indrelid, true
       ) = 'deleted_at IS NULL AND merged_into_opportunity_id IS NULL'
     )
    into v_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_class relation
    on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  where namespace.nspname = 'public'
    and relation.relname = 'opportunities'
    and index_relation.relname =
      'opportunities_agent_sales_truth_cohort_v1_idx';

  if not coalesce(v_valid, false) then
    raise exception 'agent_sales_truth_cohort_index_shape_invalid'
      using errcode = '55000';
  end if;
end;
$cohort_index$;

do $activity_index$
declare
  v_valid boolean;
begin
  if pg_catalog.to_regclass(
       'public.activities_agent_sales_truth_history_v1_idx'
     ) is null then
    create index activities_agent_sales_truth_history_v1_idx
      on public.activities (company_id, opportunity_id, created_at, id)
      where opportunity_id is not null
        and type in ('email', 'text_message')
        and direction in ('inbound', 'outbound');
  end if;

  select count(*) = 1
     and bool_and(
       access_method.amname = 'btree'
       and not index_row.indisunique
       and not index_row.indisprimary
       and index_row.indisvalid
       and index_row.indisready
       and index_row.indislive
       and index_row.indnkeyatts = 4
       and index_row.indnatts = 4
       and index_row.indexprs is null
       and index_relation.reloptions is null
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) =
         'company_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) =
         'opportunity_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 3, true) =
         'created_at'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 4, true) = 'id'
       and pg_catalog.pg_get_expr(
         index_row.indpred, index_row.indrelid, true
       ) = 'opportunity_id IS NOT NULL AND (type = ANY (ARRAY[''email''::text, ''text_message''::text])) AND (direction = ANY (ARRAY[''inbound''::text, ''outbound''::text]))'
     )
    into v_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_class relation
    on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  where namespace.nspname = 'public'
    and relation.relname = 'activities'
    and index_relation.relname =
      'activities_agent_sales_truth_history_v1_idx';

  if not coalesce(v_valid, false) then
    raise exception 'agent_sales_truth_activity_index_shape_invalid'
      using errcode = '55000';
  end if;
end;
$activity_index$;

drop trigger if exists opportunities_agent_sales_truth_source_revision_v1
  on public.opportunities;
create trigger opportunities_agent_sales_truth_source_revision_v1
after insert or update or delete on public.opportunities
for each row execute function private.bump_agent_read_domain_revision(
  'sales_truth',
  'company_id'
);

drop trigger if exists stage_transitions_agent_sales_truth_source_revision_v1
  on public.stage_transitions;
create trigger stage_transitions_agent_sales_truth_source_revision_v1
after insert or update or delete on public.stage_transitions
for each row execute function private.bump_agent_read_domain_revision(
  'sales_truth',
  'company_id'
);

drop trigger if exists opportunity_dispositions_agent_sales_truth_source_revision_v1
  on public.opportunity_dispositions;
create trigger opportunity_dispositions_agent_sales_truth_source_revision_v1
after insert or update or delete on public.opportunity_dispositions
for each row execute function private.bump_agent_read_domain_revision(
  'sales_truth',
  'company_id'
);

drop trigger if exists activities_agent_sales_truth_source_revision_v1
  on public.activities;
create trigger activities_agent_sales_truth_source_revision_v1
after insert or update or delete on public.activities
for each row execute function private.bump_agent_read_domain_revision(
  'sales_truth',
  'company_id'
);

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
declare
  v_permission_snapshot_revision text;
  v_required_permissions constant jsonb := jsonb_build_array(
    jsonb_build_object('permission', 'email.view', 'scope', 'all'),
    jsonb_build_object('permission', 'pipeline.view', 'scope', 'all')
  );
  v_required_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.operations.read'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or nullif(btrim(p_grant_revision), '') is null
     or nullif(btrim(p_permission_snapshot_revision), '') is null
     or p_capability_manifest_revision is distinct from
       '2026-09-01.capability-manifest.v13'
     or p_exposure_revision is distinct from
       '2026-09-01.mcp-exposure.v7'
     or p_capability_id is distinct from 'analyze_sales_truth'
     or p_capability_revision is distinct from
       'analyze_sales_truth:2026-09-01.v1' then
    raise exception 'AGENT_SALES_TRUTH_BINDING_INVALID'
      using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array['email.view', 'pipeline.view']
  ) authority
  where authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null
     or v_permission_snapshot_revision is distinct from
       p_permission_snapshot_revision then
    raise exception 'AGENT_SALES_TRUTH_AUTHORITY_STALE_OR_DENIED'
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
      and grant_record.exposure_revision =
        '2026-09-01.mcp-exposure.v7'
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_SALES_TRUTH_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_sales_truth_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_sales_truth_as_system(
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
  p_window_days integer,
  p_opportunity_limit integer,
  p_transition_limit integer,
  p_disposition_limit integer,
  p_activity_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_timezone text;
  v_currency_code text;
  v_business_date date;
  v_window_start date;
  v_window_start_at timestamptz;
  v_window_end_at timestamptz;
  v_company_revision bigint;
  v_sales_truth_revision bigint;
  v_opportunity_ids uuid[] := array[]::uuid[];
  v_opportunities jsonb := '[]'::jsonb;
  v_transitions jsonb := '[]'::jsonb;
  v_dispositions jsonb := '[]'::jsonb;
  v_activities jsonb := '[]'::jsonb;
  v_opportunity_count integer := 0;
  v_transition_count integer := 0;
  v_transition_invalid boolean := false;
  v_disposition_count integer := 0;
  v_activity_count integer := 0;
begin
  perform private.assert_agent_sales_truth_authority(
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
     or p_observed_at > pg_catalog.statement_timestamp() + interval '5 minutes'
     or p_window_days is distinct from 180
     or p_opportunity_limit is distinct from 5000
     or p_transition_limit is distinct from 20000
     or p_disposition_limit is distinct from 5000
     or p_activity_limit is distinct from 20000 then
    raise exception 'AGENT_SALES_TRUTH_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select company.timezone, pg_catalog.upper(pg_catalog.btrim(company.currency_code))
    into v_timezone, v_currency_code
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;

  if v_timezone is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_timezone
     )
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'AGENT_SALES_TRUTH_COMPANY_CONTEXT_INVALID'
      using errcode = '22000';
  end if;

  v_business_date := (p_observed_at at time zone v_timezone)::date;
  v_window_start := v_business_date - (p_window_days - 1);
  v_window_start_at := private.agent_unambiguous_local_instant(
    v_window_start::timestamp without time zone,
    v_timezone
  );
  v_window_end_at := private.agent_unambiguous_local_instant(
    (v_business_date + 1)::timestamp without time zone,
    v_timezone
  );

  select revision.source_revision
    into v_company_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'company';
  select revision.source_revision
    into v_sales_truth_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'sales_truth';
  if v_company_revision is null or v_sales_truth_revision is null then
    raise exception 'AGENT_SALES_TRUTH_SOURCE_REVISION_MISSING'
      using errcode = '55000';
  end if;

  with candidate as materialized (
    select opportunity.id,
           opportunity.created_at,
           opportunity.stage,
           opportunity.source,
           case
             when opportunity.lost_reason is null then null
             when char_length(opportunity.lost_reason) <= 256
               then opportunity.lost_reason
             else '__oversized__'
           end as legacy_loss_reason
    from public.opportunities opportunity
    where opportunity.company_id = p_company_id
      and opportunity.deleted_at is null
      and opportunity.merged_into_opportunity_id is null
      and opportunity.created_at >= v_window_start_at
      and opportunity.created_at < v_window_end_at
      and opportunity.created_at <= p_observed_at
    order by opportunity.created_at, opportunity.id
    limit p_opportunity_limit + 1
  ), retained as materialized (
    select * from candidate
    order by created_at, id
    limit p_opportunity_limit
  )
  select least((select count(*) from candidate), p_opportunity_limit + 1),
         coalesce(array_agg(retained.id order by retained.created_at, retained.id),
                  array[]::uuid[]),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', retained.id,
             'created_at', to_char(
               retained.created_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             ),
             'stage', retained.stage,
             'source', retained.source,
             'legacy_loss_reason', retained.legacy_loss_reason
           ) order by retained.created_at, retained.id
         ), '[]'::jsonb)
    into v_opportunity_count, v_opportunity_ids, v_opportunities
  from retained;

  with candidate as materialized (
    select transition.id,
           transition.opportunity_id,
           transition.from_stage,
           transition.to_stage,
           transition.transitioned_at,
           transition.duration_in_stage is not null
             and (
               transition.duration_in_stage < interval '0'
               or extract(epoch from transition.duration_in_stage) / 60 >
                 9007199254740991
             ) as duration_invalid,
           case
             when transition.duration_in_stage is null
               or transition.duration_in_stage < interval '0'
             then null
             when extract(epoch from transition.duration_in_stage) / 60 >
               9007199254740991
             then null
             else floor(
               extract(epoch from transition.duration_in_stage) / 60
             )::bigint
           end as duration_minutes
    from public.stage_transitions transition
    where transition.company_id = p_company_id
      and transition.opportunity_id = any(v_opportunity_ids)
      and transition.transitioned_at <= p_observed_at
    order by transition.transitioned_at, transition.id
    limit p_transition_limit + 1
  ), retained as materialized (
    select * from candidate
    order by transitioned_at, id
    limit p_transition_limit
  )
  select least((select count(*) from candidate), p_transition_limit + 1),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', retained.id,
             'opportunity_id', retained.opportunity_id,
             'from_stage', retained.from_stage,
             'to_stage', retained.to_stage,
             'transitioned_at', to_char(
               retained.transitioned_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             ),
             'duration_minutes', retained.duration_minutes
           ) order by retained.transitioned_at, retained.id
         ), '[]'::jsonb),
         coalesce(bool_or(retained.duration_invalid), false)
    into v_transition_count, v_transitions, v_transition_invalid
  from retained;

  if v_transition_invalid then
    raise exception 'AGENT_SALES_TRUTH_TRANSITION_DURATION_INVALID'
      using errcode = '22023';
  end if;

  with candidate as materialized (
    select disposition.id,
           disposition.opportunity_id,
           case
             when disposition.reason_code is null then null
             when char_length(disposition.reason_code) <= 256
               then disposition.reason_code
             else '__oversized__'
           end as reason_code,
           disposition.created_at
    from public.opportunity_dispositions disposition
    where disposition.company_id = p_company_id
      and disposition.opportunity_id = any(v_opportunity_ids)
      and disposition.superseded_at is null
      and disposition.created_at <= p_observed_at
    order by disposition.created_at, disposition.id
    limit p_disposition_limit + 1
  ), retained as materialized (
    select * from candidate
    order by created_at, id
    limit p_disposition_limit
  )
  select least((select count(*) from candidate), p_disposition_limit + 1),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', retained.id,
             'opportunity_id', retained.opportunity_id,
             'reason_code', retained.reason_code,
             'created_at', to_char(
               retained.created_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           ) order by retained.created_at, retained.id
         ), '[]'::jsonb)
    into v_disposition_count, v_dispositions
  from retained;

  with candidate as materialized (
    select activity.id,
           activity.opportunity_id,
           activity.direction,
           activity.type,
           activity.created_at
    from public.activities activity
    where activity.company_id = p_company_id
      and activity.opportunity_id = any(v_opportunity_ids)
      and activity.type in ('email', 'text_message')
      and activity.direction in ('inbound', 'outbound')
      and activity.created_at <= p_observed_at
    order by activity.created_at, activity.id
    limit p_activity_limit + 1
  ), retained as materialized (
    select * from candidate
    order by created_at, id
    limit p_activity_limit
  )
  select least((select count(*) from candidate), p_activity_limit + 1),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', retained.id,
             'opportunity_id', retained.opportunity_id,
             'direction', retained.direction,
             'type', retained.type,
             'occurred_at', to_char(
               retained.created_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           ) order by retained.created_at, retained.id
         ), '[]'::jsonb)
    into v_activity_count, v_activities
  from retained;

  return jsonb_build_object(
    'observed_at', to_char(
      p_observed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'business_date', to_char(v_business_date, 'YYYY-MM-DD'),
    'context', jsonb_build_object(
      'timezone', v_timezone,
      'currency_code', v_currency_code
    ),
    'window', jsonb_build_object(
      'starts_on', to_char(v_window_start, 'YYYY-MM-DD'),
      'ends_on', to_char(v_business_date, 'YYYY-MM-DD'),
      'days', p_window_days
    ),
    'source_revisions', jsonb_build_object(
      'company', v_company_revision,
      'sales_truth', v_sales_truth_revision
    ),
    'source_counts', jsonb_build_object(
      'opportunities', v_opportunity_count,
      'transitions', v_transition_count,
      'dispositions', v_disposition_count,
      'activities', v_activity_count
    ),
    'source_bounds', jsonb_build_object(
      'opportunities', v_opportunity_count > p_opportunity_limit,
      'transitions', v_transition_count > p_transition_limit,
      'dispositions', v_disposition_count > p_disposition_limit,
      'activities', v_activity_count > p_activity_limit
    ),
    'opportunities', v_opportunities,
    'transitions', v_transitions,
    'dispositions', v_dispositions,
    'activities', v_activities
  );
end;
$function$;

revoke all on function public.read_agent_sales_truth_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, integer, integer, integer, integer, integer
) from public, anon, authenticated;

grant execute on function public.read_agent_sales_truth_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, integer, integer, integer, integer, integer
) to service_role;

comment on function public.read_agent_sales_truth_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, integer, integer, integer, integer, integer
) is
  'Reads one bounded, current-authority lead-performance snapshot for dormant MCP sales diagnosis. Changes no business record.';

do $postflight$
declare
  v_expected record;
  v_valid boolean;
  v_index_valid boolean;
begin
  for v_expected in
    select *
    from (
      values
        ('opportunities',
         'opportunities_agent_sales_truth_source_revision_v1'),
        ('stage_transitions',
         'stage_transitions_agent_sales_truth_source_revision_v1'),
        ('opportunity_dispositions',
         'opportunity_dispositions_agent_sales_truth_source_revision_v1'),
        ('activities',
         'activities_agent_sales_truth_source_revision_v1')
    ) expected(table_name, trigger_name)
  loop
    select count(*) = 1
       and bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and trigger_row.tgtype = 29
         and procedure_namespace.nspname = 'private'
         and procedure.proname = 'bump_agent_read_domain_revision'
         and encode(trigger_row.tgargs, 'escape') =
           E'sales_truth\\000company_id\\000'
       )
      into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation
      on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and relation.relname = v_expected.table_name
      and trigger_row.tgname = v_expected.trigger_name;

    if not coalesce(v_valid, false) then
      raise exception 'agent_sales_truth_source_trigger_invalid: %',
        v_expected.trigger_name using errcode = '55000';
    end if;
  end loop;

  select count(*) = 1
     and bool_and(
       access_method.amname = 'btree'
       and not index_row.indisunique
       and not index_row.indisprimary
       and index_row.indisvalid
       and index_row.indisready
       and index_row.indislive
       and index_row.indnkeyatts = 3
       and index_row.indnatts = 3
       and index_row.indexprs is null
       and index_relation.reloptions is null
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) =
         'company_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) =
         'created_at'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 3, true) = 'id'
       and pg_catalog.pg_get_expr(
         index_row.indpred, index_row.indrelid, true
       ) = 'deleted_at IS NULL AND merged_into_opportunity_id IS NULL'
     )
    into v_index_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_class relation
    on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  where namespace.nspname = 'public'
    and relation.relname = 'opportunities'
    and index_relation.relname =
      'opportunities_agent_sales_truth_cohort_v1_idx';
  if not coalesce(v_index_valid, false) then
    raise exception 'agent_sales_truth_cohort_index_postflight_invalid'
      using errcode = '55000';
  end if;

  select count(*) = 1
     and bool_and(
       access_method.amname = 'btree'
       and not index_row.indisunique
       and not index_row.indisprimary
       and index_row.indisvalid
       and index_row.indisready
       and index_row.indislive
       and index_row.indnkeyatts = 4
       and index_row.indnatts = 4
       and index_row.indexprs is null
       and index_relation.reloptions is null
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) =
         'company_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) =
         'opportunity_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 3, true) =
         'created_at'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 4, true) = 'id'
       and pg_catalog.pg_get_expr(
         index_row.indpred, index_row.indrelid, true
       ) = 'opportunity_id IS NOT NULL AND (type = ANY (ARRAY[''email''::text, ''text_message''::text])) AND (direction = ANY (ARRAY[''inbound''::text, ''outbound''::text]))'
     )
    into v_index_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_class relation
    on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  where namespace.nspname = 'public'
    and relation.relname = 'activities'
    and index_relation.relname =
      'activities_agent_sales_truth_history_v1_idx';
  if not coalesce(v_index_valid, false) then
    raise exception 'agent_sales_truth_activity_index_postflight_invalid'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from private.agent_read_domains where domain = 'sales_truth'
  ) then
    raise exception 'agent_sales_truth_domain_missing' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
