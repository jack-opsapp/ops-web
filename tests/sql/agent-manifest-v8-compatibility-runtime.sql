\set ON_ERROR_STOP on

-- Pass -v agent_mcp_manifest_v8_bootstrap=1 for the first run against a
-- fresh PostgreSQL 17 database. Later runs use 0 and prove replay against the
-- already-installed compatibility bridge.
\if :agent_mcp_manifest_v8_bootstrap

do $bootstrap_roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (
    select 1 from pg_roles where rolname = 'authenticated'
  ) then
    create role authenticated nologin;
  end if;
  if not exists (
    select 1 from pg_roles where rolname = 'service_role'
  ) then
    create role service_role nologin;
  end if;
end;
$bootstrap_roles$;
create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;

create function auth.role() returns text
language sql stable
set search_path = pg_catalog
as $function$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$function$;

create function private.agent_jsonb_objects(p_value jsonb)
returns setof jsonb
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  with recursive walk(value) as (
    select p_value
    union all
    select child.value
    from walk parent
    cross join lateral (
      select array_member.value
      from jsonb_array_elements(parent.value) array_member(value)
      where jsonb_typeof(parent.value) = 'array'
      union all
      select object_member.value
      from jsonb_each(parent.value) object_member(key, value)
      where jsonb_typeof(parent.value) = 'object'
    ) child
  )
  select walk.value
  from walk
  where jsonb_typeof(walk.value) = 'object'
$function$;

create function private.agent_set_jsonb_key_recursive(
  p_value jsonb,
  p_key text,
  p_replacement jsonb
) returns jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $function$
declare
  v_result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'array' then
      select coalesce(
        jsonb_agg(
          private.agent_set_jsonb_key_recursive(
            element.value, p_key, p_replacement
          ) order by element.ordinality
        ),
        '[]'::jsonb
      )
      into v_result
      from jsonb_array_elements(p_value) with ordinality
        element(value, ordinality);
      return v_result;
    when 'object' then
      select coalesce(
        jsonb_object_agg(
          member.key,
          case when member.key = p_key then p_replacement
            else private.agent_set_jsonb_key_recursive(
              member.value, p_key, p_replacement
            ) end
        ),
        '{}'::jsonb
      )
      into v_result
      from jsonb_each(p_value) member(key, value);
      return v_result;
    else
      return p_value;
  end case;
end;
$function$;

create function private.canonical_agent_projection_json(p_projection jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  select p_projection::text
$function$;

create function private.agent_replace_agent_proof_hash(
  p_value jsonb,
  p_from text,
  p_to text
) returns jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_result jsonb;
  v_is_proof boolean;
  v_is_source_atom boolean;
  v_version text;
begin
  case jsonb_typeof(p_value)
    when 'array' then
      select coalesce(
        jsonb_agg(
          private.agent_replace_agent_proof_hash(
            element.value, p_from, p_to
          ) order by element.ordinality
        ),
        '[]'::jsonb
      )
      into v_result
      from jsonb_array_elements(p_value) with ordinality
        element(value, ordinality);
      return v_result;
    when 'object' then
      v_is_proof :=
        jsonb_typeof(p_value -> 'projection') = 'object'
        and jsonb_typeof(p_value -> 'source_content_hash') = 'string'
        and p_value ->> 'source_content_hash' = p_from;
      v_version := p_value ->> 'version';
      v_is_source_atom :=
        jsonb_typeof(p_value -> 'source_domain') = 'string'
        and jsonb_typeof(p_value -> 'source_type') = 'string'
        and jsonb_typeof(p_value -> 'source_id') = 'string'
        and jsonb_typeof(p_value -> 'version') = 'string'
        and char_length(v_version) > char_length(p_from)
        and right(v_version, char_length(p_from)) = p_from
        and substr(
          v_version,
          char_length(v_version) - char_length(p_from),
          1
        ) = ':';
      select coalesce(
        jsonb_object_agg(
          member.key,
          case
            when v_is_proof and member.key = 'source_content_hash'
              then to_jsonb(p_to)
            when v_is_source_atom and member.key = 'version'
              then to_jsonb(
                left(v_version, char_length(v_version) - char_length(p_from))
                || p_to
              )
            else private.agent_replace_agent_proof_hash(
              member.value, p_from, p_to
            )
          end
        ),
        '{}'::jsonb
      )
      into v_result
      from jsonb_each(p_value) member(key, value);
      return v_result;
    else
      return p_value;
  end case;
end;
$function$;

create function private.task25_manifest_fixture(
  p_manifest_revision text,
  p_reader_name text
) returns jsonb
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog, private, extensions
as $function$
declare
  v_leaf_projection jsonb;
  v_leaf_hash text;
  v_leaf_proof jsonb;
  v_projection jsonb;
  v_hash text;
begin
  v_leaf_projection := jsonb_build_object(
    'capability_manifest_revision', p_manifest_revision,
    'reader', p_reader_name,
    'stable_business_value', 'v6-v7-output-byte-equality'
  );
  v_leaf_hash := 'sha256:' || encode(
    extensions.digest(
      convert_to(private.canonical_agent_projection_json(v_leaf_projection), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_leaf_proof := jsonb_build_object(
    'capability_manifest_revision', p_manifest_revision,
    'projection', v_leaf_projection,
    'source_content_hash', v_leaf_hash,
    'source_atom', jsonb_build_object(
      'source_domain', 'task25-fixture',
      'source_type', 'leaf',
      'source_id', p_reader_name,
      'version', 'fixture:' || v_leaf_hash
    )
  );
  v_projection := jsonb_build_object(
    'capability_manifest_revision', p_manifest_revision,
    'reader', p_reader_name,
    'stable_business_value', 'literal-' || p_manifest_revision || '-' || v_leaf_hash,
    'nested_proof', v_leaf_proof
  );
  v_hash := 'sha256:' || encode(
    extensions.digest(
      convert_to(private.canonical_agent_projection_json(v_projection), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return jsonb_build_object(
    'capability_manifest_revision', p_manifest_revision,
    'projection', v_projection,
    'source_content_hash', v_hash,
    'source_atom', jsonb_build_object(
      'source_domain', 'task25-fixture',
      'source_type', 'reader',
      'source_id', p_reader_name,
      'version', 'fixture:' || v_hash
    )
  );
end;
$function$;

-- Production-typed v7 reader stand-ins. The compatibility migration freezes
-- these exact signatures and must never depend on their implementation body.
do $bootstrap_json_readers$
declare
  v_name text;
  v_arguments text;
  v_discovery boolean;
begin
  for v_name, v_arguments, v_discovery in
    select reader.name, reader.arguments, reader.discovery
    from (values
      ('read_agent_job_communication_context_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_inbox_scope text,p_clients_scope text,p_job_permission text,p_job_scope text,p_projects_scope text,p_calendar_scope text,p_tasks_scope text,p_photos_scope text,p_job_kind text,p_job_id uuid,p_purpose text',false),
      ('read_agent_job_participants_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_inbox_scope text,p_clients_scope text,p_job_permission text,p_job_scope text,p_projects_scope text,p_tasks_scope text,p_job_kind text,p_job_id uuid,p_purpose text',false),
      ('read_agent_job_conversation_context_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_inbox_scope text,p_clients_scope text,p_job_permission text,p_job_scope text,p_job_kind text,p_job_id uuid,p_exact_turn_limit integer default 20,p_sections text[] default array[''memory'',''recent_turns'',''participants'',''gaps'',''cross_job_seed'']::text[],p_required_through_turn_id uuid default null',false),
      ('read_agent_scheduled_jobs_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_calendar_scope text,p_projects_scope text,p_tasks_scope text,p_from timestamptz,p_to timestamptz,p_task_statuses text[],p_confirmation_states text[] default null,p_display_timezone text default null,p_read_as_of timestamptz default null,p_cursor_source_revision bigint default null,p_cursor_start_utc timestamptz default null,p_cursor_task_id uuid default null,p_limit integer default 25',false),
      ('read_agent_job_readiness_issues_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_calendar_scope text,p_clients_scope text,p_photos_scope text,p_projects_scope text,p_tasks_scope text,p_from timestamptz,p_to timestamptz,p_rule_codes text[],p_read_as_of timestamptz default null,p_cursor_source_revision bigint default null,p_cursor_first_scheduled_start_utc timestamptz default null,p_cursor_project_id uuid default null,p_scan_limit integer default 50',false),
      ('read_agent_phase_c_job_conversation_context_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_inbox_scope text,p_clients_scope text,p_job_permission text,p_job_scope text,p_job_kind text,p_job_id uuid,p_exact_turn_limit integer,p_sections text[],p_required_through_turn_id uuid,p_phase_c_assignment_version bigint,p_phase_c_connection_id uuid,p_phase_c_internal_thread_id uuid,p_phase_c_provider_thread_id text,p_phase_c_source_activity_id uuid,p_phase_c_source_turn_id uuid,p_phase_c_source_conversation_id uuid',false),
      ('read_agent_customer_jobs_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_clients_scope text,p_pipeline_scope text,p_projects_scope text,p_customer_kind text,p_customer_id uuid,p_job_kinds text[],p_lifecycle_states text[],p_opportunity_stages text[],p_project_statuses text[],p_date_field text,p_date_from timestamptz,p_date_to_exclusive timestamptz,p_read_as_of timestamptz,p_cursor_source_revision bigint,p_cursor_sort_at timestamptz,p_cursor_job_kind text,p_cursor_job_id uuid,p_limit integer',false),
      ('read_agent_job_summary_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_inbox_scope text,p_clients_scope text,p_pipeline_scope text,p_projects_scope text,p_calendar_scope text,p_tasks_scope text,p_photos_scope text,p_estimates_scope text,p_invoices_scope text,p_projects_financials_scope text,p_job_kind text,p_job_id uuid,p_sections text[],p_readiness_rule_codes text[],p_financial_components text[]',false),
      ('read_agent_correspondence_evidence_page_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_inbox_scope text,p_pipeline_scope text,p_projects_scope text,p_job_kind text,p_job_id uuid,p_evidence_ids text[],p_mode text',false),
      ('read_agent_job_history_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_required_oauth_scopes text[],p_inbox_scope text,p_clients_scope text,p_pipeline_scope text,p_projects_scope text,p_calendar_scope text,p_tasks_scope text,p_estimates_scope text,p_projects_financials_scope text,p_query text,p_scope_kind text,p_customer_kind text,p_customer_id uuid,p_scope_job_kinds text[],p_job_refs jsonb,p_from timestamptz,p_to_exclusive timestamptz,p_source_types text[],p_read_as_of timestamptz,p_cursor_source_revision bigint,p_cursor_history_revision bigint,p_cursor_rank_micros bigint,p_cursor_occurred_at timestamptz,p_cursor_source_type text,p_cursor_source_id text,p_limit integer',false),
      ('read_agent_customer_discovery_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_capability_schema_revision text,p_ranking_revision text,p_required_oauth_scopes text[],p_clients_scope text,p_lookup text,p_query text,p_customer_kinds text[],p_read_as_of timestamptz,p_cursor_source_revision bigint,p_cursor_rank_ordinal integer,p_cursor_customer_kind text,p_cursor_customer_id uuid,p_limit integer',true),
      ('read_agent_job_discovery_as_system','p_request_id text,p_actor_user_id uuid,p_company_id uuid,p_permission_snapshot_revision text,p_registered_permission_keys text[],p_capability_id text,p_capability_revision text,p_capability_manifest_revision text,p_capability_schema_revision text,p_ranking_revision text,p_required_oauth_scopes text[],p_pipeline_scope text,p_projects_scope text,p_query text,p_query_fields text[],p_job_kinds text[],p_lifecycle_states text[],p_opportunity_stages text[],p_project_statuses text[],p_date_field text,p_date_from timestamptz,p_date_to_exclusive timestamptz,p_read_as_of timestamptz,p_cursor_source_revision bigint,p_cursor_rank_ordinal integer,p_cursor_job_kind text,p_cursor_job_id uuid,p_limit integer',true)
    ) reader(name, arguments, discovery)
  loop
    execute format(
      'create function public.%I(%s) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, private%s as $body$ begin if auth.role() is distinct from ''service_role'' then raise exception ''access_denied'' using errcode = ''42501''; end if; if $8 is null or $8 not in (%s) then raise exception ''invalid_fixture_manifest'' using errcode = ''22023''; end if; return private.task25_manifest_fixture($8, %L); end; $body$',
      v_name,
      v_arguments,
      case when v_discovery
        then ', extensions, pg_temp set plan_cache_mode = force_custom_plan'
        else '' end,
      case when v_discovery
        then '''2026-08-20.capability-manifest.v7'''
        else '''2026-08-14.capability-manifest.v6'',''2026-08-20.capability-manifest.v7''' end,
      v_name
    );
  end loop;
end;
$bootstrap_json_readers$;

create function public.read_agent_correspondence_evidence_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scope text,
  p_inbox_scope text,
  p_evidence_ids text[]
) returns table (
  evidence_id text,
  company_id uuid,
  source_id text,
  occurred_at text,
  subject text,
  side text,
  participant_id text,
  participant_resolution_status text,
  direction text,
  source_activity_id uuid,
  source_correspondence_event_id uuid,
  recipient_identities text[],
  cc_recipient_identities text[],
  redaction_kinds text[],
  normalized_plain_text text,
  original_content_hash text,
  attachments jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_fixture_manifest' using errcode = '22023';
  end if;
  return query select
    'evidence-1'::text,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'source-1'::text,
    '2026-08-22T00:00:00.000Z'::text,
    'Stable raw evidence'::text,
    'customer'::text,
    'participant-1'::text,
    'resolved'::text,
    'inbound'::text,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    array['customer@example.com']::text[],
    array[]::text[],
    array['private_copy_removed']::text[],
    'Raw evidence has no proof metadata.'::text,
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'::text,
    '[]'::jsonb;
end;
$function$;

create function private.task25_invoke_reader(
  p_reader_name text,
  p_manifest_revision text
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_function oid;
  v_arguments text;
  v_result jsonb;
  v_returns_set boolean;
begin
  select function_row.oid, function_row.proretset,
         string_agg(
           case
             when function_row.proargnames[argument.ordinality] =
               'p_capability_manifest_revision'
               then case when p_manifest_revision is null
                 then 'null::text'
                 else quote_literal(p_manifest_revision) || '::text' end
             else 'null::' || format_type(argument.type_oid, null)
           end,
           ',' order by argument.ordinality
         )
  into v_function, v_returns_set, v_arguments
  from pg_proc function_row
  join pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  cross join lateral unnest(function_row.proargtypes)
    with ordinality argument(type_oid, ordinality)
  where namespace_row.nspname = 'public'
    and function_row.proname = p_reader_name
    and function_row.prokind = 'f'
  group by function_row.oid, function_row.proretset;

  if v_function is null then
    raise exception 'missing_task25_reader: %', p_reader_name
      using errcode = '55000';
  end if;
  if v_returns_set then
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(reader) order by reader.evidence_id), ''[]''::jsonb) from public.%I(%s) reader',
      p_reader_name,
      v_arguments
    ) into v_result;
  else
    execute format(
      'select public.%I(%s)',
      p_reader_name,
      v_arguments
    ) into v_result;
  end if;
  return v_result;
end;
$function$;

\endif

set request.jwt.claim.role = 'service_role';

create temporary table task25_baseline(
  reader_name text not null,
  manifest_revision text not null,
  output_bytes text not null,
  primary key(reader_name, manifest_revision)
) on commit preserve rows;

insert into task25_baseline(reader_name, manifest_revision, output_bytes)
select reader.name,
       revision.manifest_revision,
       private.task25_invoke_reader(
         reader.name,
         revision.manifest_revision
       )::text
from (values
  ('read_agent_job_communication_context_as_system', true, true),
  ('read_agent_job_participants_as_system', true, true),
  ('read_agent_job_conversation_context_as_system', true, true),
  ('read_agent_scheduled_jobs_as_system', true, true),
  ('read_agent_job_readiness_issues_as_system', true, true),
  ('read_agent_correspondence_evidence_as_system', true, true),
  ('read_agent_phase_c_job_conversation_context_as_system', true, true),
  ('read_agent_customer_jobs_as_system', true, true),
  ('read_agent_job_summary_as_system', true, true),
  ('read_agent_correspondence_evidence_page_as_system', true, true),
  ('read_agent_job_history_as_system', true, true),
  ('read_agent_customer_discovery_as_system', false, true),
  ('read_agent_job_discovery_as_system', false, true)
) reader(name, accepts_v6, accepts_v7)
cross join (values
  ('2026-08-14.capability-manifest.v6'),
  ('2026-08-20.capability-manifest.v7')
) revision(manifest_revision)
where (revision.manifest_revision = '2026-08-14.capability-manifest.v6'
       and reader.accepts_v6)
   or (revision.manifest_revision = '2026-08-20.capability-manifest.v7'
       and reader.accepts_v7);

\if :agent_mcp_manifest_v8_bootstrap
create temporary table task25_prepared_baseline(
  label text primary key,
  output_bytes text not null
) on commit preserve rows;
grant select, insert on task25_prepared_baseline to service_role;

set role service_role;
set request.jwt.claim.role = 'service_role';
prepare task25_prepared_json(text,text) as
insert into task25_prepared_baseline(label, output_bytes)
select $1,
  public.read_agent_job_communication_context_as_system(
    null,null,null,null,null,null,null,$2,null,null,null,null,null,null,null,null,
    null,null,null,null
  )::text;
execute task25_prepared_json(
  'before-v6', '2026-08-14.capability-manifest.v6'
);
execute task25_prepared_json(
  'before-v7', '2026-08-20.capability-manifest.v7'
);

prepare task25_prepared_raw(text,text) as
insert into task25_prepared_baseline(label, output_bytes)
select $1, coalesce(jsonb_agg(to_jsonb(evidence) order by evidence.evidence_id), '[]'::jsonb)::text
from public.read_agent_correspondence_evidence_as_system(
  null,null,null,null,null,null,null,$2,null,null,null
) evidence;
execute task25_prepared_raw(
  'before-raw-v7', '2026-08-20.capability-manifest.v7'
);
reset role;
\endif

\ir ../../supabase/migrations/20260823072825_agent_manifest_v8_compatibility.sql

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

\if :agent_mcp_manifest_v8_bootstrap
set local role service_role;
execute task25_prepared_json(
  'after-v6', '2026-08-14.capability-manifest.v6'
);
execute task25_prepared_json(
  'after-v7', '2026-08-20.capability-manifest.v7'
);
execute task25_prepared_raw(
  'after-raw-v7', '2026-08-20.capability-manifest.v7'
);
reset role;
\endif

do $runtime$
declare
  v_reader_name text;
  v_manifest_revision text;
  v_baseline text;
  v_current jsonb;
  v_v5 jsonb;
  v_v6 jsonb;
  v_v7 jsonb;
  v_v8 jsonb;
  v_mixed jsonb;
  v_expected_hash text;
begin
  if (select count(*) from task25_baseline) <> 24 then
    raise exception 'legacy baseline count mismatch';
  end if;

  for v_reader_name, v_manifest_revision, v_baseline in
    select baseline.reader_name,
           baseline.manifest_revision,
           baseline.output_bytes
    from task25_baseline baseline
    order by baseline.reader_name, baseline.manifest_revision
  loop
    v_current := private.task25_invoke_reader(
      v_reader_name,
      v_manifest_revision
    );
    if v_current::text is distinct from v_baseline then
      raise exception 'legacy output bytes changed: % %',
        v_reader_name, v_manifest_revision;
    end if;
  end loop;

  for v_reader_name in
    select reader.name
    from (values
      ('read_agent_job_communication_context_as_system'),
      ('read_agent_job_participants_as_system'),
      ('read_agent_job_conversation_context_as_system'),
      ('read_agent_scheduled_jobs_as_system'),
      ('read_agent_job_readiness_issues_as_system'),
      ('read_agent_phase_c_job_conversation_context_as_system'),
      ('read_agent_customer_jobs_as_system'),
      ('read_agent_job_summary_as_system'),
      ('read_agent_correspondence_evidence_page_as_system'),
      ('read_agent_job_history_as_system'),
      ('read_agent_customer_discovery_as_system'),
      ('read_agent_job_discovery_as_system')
    ) reader(name)
  loop
    v_v7 := private.task25_invoke_reader(
      v_reader_name,
      '2026-08-20.capability-manifest.v7'
    );
    v_v8 := private.task25_invoke_reader(
      v_reader_name,
      '2026-08-22.capability-manifest.v8'
    );
    if v_v8 is distinct from private.reprove_agent_read_jsonb_for_manifest(
      v_v7,
      '2026-08-22.capability-manifest.v8'
    ) then
      raise exception 'v8 reproof mismatch: %', v_reader_name;
    end if;
    if v_v8 #>> '{projection,stable_business_value}' is distinct from
       v_v7 #>> '{projection,stable_business_value}' then
      raise exception 'business payload changed during reproof: %',
        v_reader_name;
    end if;
    if v_v8 ->> 'source_content_hash' is not distinct from
       v_v7 ->> 'source_content_hash' then
      raise exception 'outer proof hash was not recomputed: %', v_reader_name;
    end if;
    if v_v8 #>> '{projection,nested_proof,source_content_hash}' is not distinct from
       v_v7 #>> '{projection,nested_proof,source_content_hash}' then
      raise exception 'nested proof hash was not recomputed: %', v_reader_name;
    end if;
    v_expected_hash := 'sha256:' || encode(
      extensions.digest(
        convert_to(
          private.canonical_agent_projection_json(v_v8 -> 'projection'),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    if v_v8 ->> 'source_content_hash' is distinct from v_expected_hash
       or v_v8 #>> '{source_atom,version}' is distinct from
         'fixture:' || v_expected_hash then
      raise exception 'outer canonical proof mismatch: %', v_reader_name;
    end if;
    v_expected_hash := 'sha256:' || encode(
      extensions.digest(
        convert_to(
          private.canonical_agent_projection_json(
            v_v8 #> '{projection,nested_proof,projection}'
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    if v_v8 #>> '{projection,nested_proof,source_content_hash}' is distinct
         from v_expected_hash
       or v_v8 #>> '{projection,nested_proof,source_atom,version}' is distinct
         from 'fixture:' || v_expected_hash then
      raise exception 'nested canonical proof mismatch: %', v_reader_name;
    end if;
    if exists (
      select 1
      from private.agent_jsonb_objects(v_v8) object_value
      where object_value ? 'capability_manifest_revision'
        and object_value ->> 'capability_manifest_revision' is distinct from
          '2026-08-22.capability-manifest.v8'
    ) then
      raise exception 'mixed v8 output: %', v_reader_name;
    end if;
  end loop;

  if private.task25_invoke_reader(
       'read_agent_correspondence_evidence_as_system',
       '2026-08-22.capability-manifest.v8'
     ) is distinct from private.task25_invoke_reader(
       'read_agent_correspondence_evidence_as_system',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'raw evidence v7/v8 rows changed';
  end if;

  v_v5 := private.task25_manifest_fixture(
    '2026-08-13.capability-manifest.v5', 'adjacent-v5'
  );
  v_v6 := private.reprove_agent_read_jsonb_for_manifest(
    v_v5, '2026-08-14.capability-manifest.v6'
  );
  v_v7 := private.reprove_agent_read_jsonb_for_manifest(
    private.task25_manifest_fixture(
      '2026-08-14.capability-manifest.v6', 'adjacent-v6'
    ),
    '2026-08-20.capability-manifest.v7'
  );
  v_v8 := private.reprove_agent_read_jsonb_for_manifest(
    private.task25_manifest_fixture(
      '2026-08-20.capability-manifest.v7', 'adjacent-v7'
    ),
    '2026-08-22.capability-manifest.v8'
  );
  if v_v6 ->> 'capability_manifest_revision' is distinct from
       '2026-08-14.capability-manifest.v6'
     or v_v7 ->> 'capability_manifest_revision' is distinct from
       '2026-08-20.capability-manifest.v7'
     or v_v8 ->> 'capability_manifest_revision' is distinct from
       '2026-08-22.capability-manifest.v8' then
    raise exception 'adjacent manifest bridge mismatch';
  end if;

  begin
    perform private.reprove_agent_read_jsonb_for_manifest(
      null, '2026-08-22.capability-manifest.v8'
    );
    raise exception 'null reproof result accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform private.reprove_agent_read_jsonb_for_manifest(
      v_v7, null
    );
    raise exception 'null reproof target accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform private.reprove_agent_read_jsonb_for_manifest(
      v_v7, 'unknown-manifest'
    );
    raise exception 'unknown reproof target accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform private.reprove_agent_read_jsonb_for_manifest(
      '{}'::jsonb, '2026-08-22.capability-manifest.v8'
    );
    raise exception 'manifest-free reproof source accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform private.reprove_agent_read_jsonb_for_manifest(
      private.task25_manifest_fixture(
        '2026-08-14.capability-manifest.v6', 'wrong-adjacent-source'
      ),
      '2026-08-22.capability-manifest.v8'
    );
    raise exception 'wrong adjacent reproof source accepted';
  exception when sqlstate '22023' then null;
  end;
  v_mixed := jsonb_build_array(
    private.task25_manifest_fixture(
      '2026-08-20.capability-manifest.v7', 'mixed-v7'
    ),
    private.task25_manifest_fixture(
      '2026-08-14.capability-manifest.v6', 'mixed-v6'
    )
  );
  begin
    perform private.reprove_agent_read_jsonb_for_manifest(
      v_mixed, '2026-08-22.capability-manifest.v8'
    );
    raise exception 'mixed reproof source accepted';
  exception when sqlstate '22023' then null;
  end;

  for v_reader_name in
    select reader.name
    from (values
      ('read_agent_job_communication_context_as_system'),
      ('read_agent_job_participants_as_system'),
      ('read_agent_job_conversation_context_as_system'),
      ('read_agent_scheduled_jobs_as_system'),
      ('read_agent_job_readiness_issues_as_system'),
      ('read_agent_correspondence_evidence_as_system'),
      ('read_agent_phase_c_job_conversation_context_as_system'),
      ('read_agent_customer_jobs_as_system'),
      ('read_agent_job_summary_as_system'),
      ('read_agent_correspondence_evidence_page_as_system'),
      ('read_agent_job_history_as_system'),
      ('read_agent_customer_discovery_as_system'),
      ('read_agent_job_discovery_as_system')
    ) reader(name)
  loop
    begin
      perform private.task25_invoke_reader(v_reader_name, null);
      raise exception 'null public manifest accepted: %', v_reader_name;
    exception when sqlstate '22023' then null;
    end;
    begin
      perform private.task25_invoke_reader(v_reader_name, 'unknown-manifest');
      raise exception 'unknown public manifest accepted: %', v_reader_name;
    exception when sqlstate '22023' then null;
    end;
  end loop;

  for v_reader_name in
    select reader.name
    from (values
      ('read_agent_customer_discovery_as_system'),
      ('read_agent_job_discovery_as_system')
    ) reader(name)
  loop
    begin
      perform private.task25_invoke_reader(
        v_reader_name, '2026-08-14.capability-manifest.v6'
      );
      raise exception 'v6 discovery manifest accepted: %', v_reader_name;
    exception when sqlstate '22023' then null;
    end;
  end loop;
end;
$runtime$;

\if :agent_mcp_manifest_v8_bootstrap
do $prepared_continuity$
begin
  if (select output_bytes from task25_prepared_baseline where label = 'before-v6')
       is distinct from
       (select output_bytes from task25_prepared_baseline where label = 'after-v6')
     or (select output_bytes from task25_prepared_baseline where label = 'before-v7')
       is distinct from
       (select output_bytes from task25_prepared_baseline where label = 'after-v7')
     or (select output_bytes from task25_prepared_baseline where label = 'before-raw-v7')
       is distinct from
       (select output_bytes from task25_prepared_baseline where label = 'after-raw-v7') then
    raise exception 'prepared-call continuity mismatch';
  end if;
end;
$prepared_continuity$;
\endif

do $catalog_contract$
declare
  v_name text;
  v_arguments text;
  v_public oid;
  v_private_core oid;
  v_public_count integer := 0;
  v_private_count integer := 0;
begin
  for v_name, v_arguments in
    select reader.name, reader.arguments
    from (values
      ('read_agent_job_communication_context_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text'),
      ('read_agent_job_participants_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,uuid,text'),
      ('read_agent_job_conversation_context_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid'),
      ('read_agent_scheduled_jobs_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamptz,timestamptz,text[],text[],text,timestamptz,bigint,timestamptz,uuid,integer'),
      ('read_agent_job_readiness_issues_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamptz,timestamptz,text[],timestamptz,bigint,timestamptz,uuid,integer'),
      ('read_agent_correspondence_evidence_as_system','text,uuid,uuid,text,text[],text,text,text,text,text,text[]'),
      ('read_agent_phase_c_job_conversation_context_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid,bigint,uuid,uuid,text,uuid,uuid,uuid'),
      ('read_agent_customer_jobs_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,timestamptz,text,uuid,integer'),
      ('read_agent_job_summary_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[]'),
      ('read_agent_correspondence_evidence_page_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text'),
      ('read_agent_job_history_as_system','text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamptz,timestamptz,text[],timestamptz,bigint,bigint,bigint,timestamptz,text,text,integer'),
      ('read_agent_customer_discovery_as_system','text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],timestamptz,bigint,integer,text,uuid,integer'),
      ('read_agent_job_discovery_as_system','text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,integer,text,uuid,integer')
    ) reader(name, arguments)
  loop
    v_public := to_regprocedure(
      format('public.%I(%s)', v_name, v_arguments)
    )::oid;
    v_private_core := to_regprocedure(
      format('private.%I(%s)', v_name || '_v7_core', v_arguments)
    )::oid;
    if v_public is null or v_private_core is null then
      raise exception 'runtime signature missing: %', v_name;
    end if;
    v_public_count := v_public_count + 1;
    v_private_count := v_private_count + 1;
    if not has_function_privilege('service_role', v_public, 'EXECUTE')
       or has_function_privilege('anon', v_public, 'EXECUTE')
       or has_function_privilege('authenticated', v_public, 'EXECUTE')
       or has_function_privilege('service_role', v_private_core, 'EXECUTE')
       or has_function_privilege('anon', v_private_core, 'EXECUTE')
       or has_function_privilege('authenticated', v_private_core, 'EXECUTE') then
      raise exception 'runtime ACL mismatch: %', v_name;
    end if;
    if exists (
      select 1
      from pg_proc function_row
      where function_row.oid in (v_public, v_private_core)
        and (not function_row.prosecdef or function_row.provolatile <> 's')
    ) then
      raise exception 'runtime function property mismatch: %', v_name;
    end if;
  end loop;
  if v_public_count <> 13 or v_private_count <> 13 then
    raise exception 'runtime function count mismatch';
  end if;
  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'private'
      and function_row.proname like '%\_v7\_core\_v7\_core' escape '\'
  ) then
    raise exception 'replay created a nested v7 core';
  end if;
  if has_function_privilege(
       'service_role',
       'private.reprove_agent_read_jsonb_for_manifest(jsonb,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'private.reprove_agent_read_jsonb_for_manifest(jsonb,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'private.reprove_agent_read_jsonb_for_manifest(jsonb,text)',
       'EXECUTE'
     ) then
    raise exception 'runtime reproof ACL mismatch';
  end if;
  if (select function_row.proisstrict
      from pg_proc function_row
      where function_row.oid =
        'private.reprove_agent_read_jsonb_for_manifest(jsonb,text)'::regprocedure)
  then
    raise exception 'runtime reproof unexpectedly strict';
  end if;
end;
$catalog_contract$;

rollback;
