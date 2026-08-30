\set ON_ERROR_STOP on

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

create or replace function private.reprove_agent_read_jsonb_for_manifest(
  p_result jsonb,
  p_capability_manifest_revision text
) returns jsonb
language plpgsql
stable
called on null input
security definer
set search_path = pg_catalog, private, extensions, pg_temp
as $function$
declare
  v_result jsonb;
  v_object jsonb;
  v_projection jsonb;
  v_old_hash text;
  v_new_hash text;
  v_source_manifest_revision text;
  v_pass integer;
  v_changed boolean;
  v_manifest_count integer;
begin
  if p_result is null
     or p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7',
       '2026-08-22.capability-manifest.v8'
     ) then
    raise exception 'invalid_agent_manifest_reproof_request'
      using errcode = '22023';
  end if;

  v_source_manifest_revision := case p_capability_manifest_revision
    when '2026-08-14.capability-manifest.v6'
      then '2026-08-13.capability-manifest.v5'
    when '2026-08-20.capability-manifest.v7'
      then '2026-08-14.capability-manifest.v6'
    when '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
  end;

  select count(*)
  into v_manifest_count
  from private.agent_jsonb_objects(p_result) object_value
  where object_value ? 'capability_manifest_revision';

  if v_manifest_count = 0 or exists (
    select 1
    from private.agent_jsonb_objects(p_result) object_value
    where object_value ? 'capability_manifest_revision'
      and object_value ->> 'capability_manifest_revision' is distinct from
        v_source_manifest_revision
  ) then
    raise exception 'invalid_agent_manifest_reproof_source'
      using errcode = '22023';
  end if;

  v_result := private.agent_set_jsonb_key_recursive(
    p_result,
    'capability_manifest_revision',
    to_jsonb(p_capability_manifest_revision)
  );

  for v_pass in 1..16 loop
    v_changed := false;
    for v_object in
      select object_value
      from private.agent_jsonb_objects(v_result) object_value
      where jsonb_typeof(object_value -> 'projection') = 'object'
        and object_value ->> 'source_content_hash'
          ~ '^sha256:[0-9a-f]{64}$'
    loop
      v_projection := v_object -> 'projection';
      v_old_hash := v_object ->> 'source_content_hash';
      v_new_hash := 'sha256:' || encode(
        extensions.digest(
          convert_to(
            private.canonical_agent_projection_json(v_projection),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      );
      if v_new_hash is distinct from v_old_hash then
        v_result := private.agent_replace_agent_proof_hash(
          v_result,
          v_old_hash,
          v_new_hash
        );
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed;
  end loop;
  if v_changed then
    raise exception 'agent_manifest_reproof_depth_exceeded'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.reprove_agent_read_jsonb_for_manifest(jsonb,text)
  from public, anon, authenticated, service_role;

create table private.schedule_readiness_manifest_bridge_fixture (
  reader_name text primary key,
  payload jsonb not null
);

create function private.schedule_readiness_manifest_bridge_payload(
  p_reader_name text,
  p_empty boolean
) returns jsonb
language plpgsql
immutable
strict
security definer
set search_path = pg_catalog, private, extensions
as $function$
declare
  v_company_id constant uuid :=
    '11111111-1111-1111-1111-111111111111'::uuid;
  v_permission_revision constant text := 'permission:fixture:v1';
  v_manifest_v4 constant text := '2026-08-12.capability-manifest.v4';
  v_fence jsonb := jsonb_build_object(
    'source_domain', 'operations',
    'source_type', 'operational_read_revision',
    'source_id', 'private.agent_operational_read_revisions',
    'version', 'revision:42'
  );
  v_projection jsonb;
  v_subject jsonb;
  v_hash text;
  v_source_version jsonb;
  v_evidence jsonb;
begin
  if p_reader_name not in ('scheduled_jobs', 'job_readiness_issues') then
    raise exception 'invalid_fixture_reader' using errcode = '22023';
  end if;

  if p_empty and p_reader_name = 'scheduled_jobs' then
    return jsonb_build_object(
      'company_id', v_company_id,
      'permission_snapshot_revision', v_permission_revision,
      'read_at', '2026-08-30T00:00:00.000Z',
      'source_fence', v_fence,
      'company_timezone', 'America/Vancouver',
      'display_timezone', 'America/Vancouver',
      'occurrences', '[]'::jsonb,
      'occurrence_proofs', '[]'::jsonb,
      'returned_occurrence_count', 0,
      'next_cursor_claims', null,
      'has_more', false,
      'source_versions', jsonb_build_array(v_fence),
      'evidence', '[]'::jsonb
    );
  elsif p_empty then
    return jsonb_build_object(
      'company_id', v_company_id,
      'permission_snapshot_revision', v_permission_revision,
      'read_at', '2026-08-30T00:00:00.000Z',
      'source_fence', v_fence,
      'candidates', '[]'::jsonb,
      'scanned_candidate_count', 0,
      'next_scan_cursor_claims', null,
      'scan_has_more', false,
      'source_versions', jsonb_build_array(v_fence),
      'evidence', '[]'::jsonb
    );
  end if;

  if p_reader_name = 'scheduled_jobs' then
    v_subject := jsonb_build_object(
      'job_ref', jsonb_build_object(
        'kind', 'project',
        'id', '33333333-3333-3333-3333-333333333333'
      ),
      'occurrence_ref', jsonb_build_object(
        'kind', 'project_task',
        'id', '22222222-2222-2222-2222-222222222222'
      ),
      'title', 'Fixture task'
    );
    v_projection := jsonb_build_object(
      'capability_manifest_revision', v_manifest_v4,
      'company_id', v_company_id,
      'permission_snapshot_revision', v_permission_revision,
      'occurrence', v_subject,
      'stable_business_value', 'one-proof-bearing-representative'
    );
  else
    v_subject := jsonb_build_object(
      'job_ref', jsonb_build_object(
        'kind', 'project',
        'id', '33333333-3333-3333-3333-333333333333'
      ),
      'title', 'Fixture job'
    );
    v_projection := jsonb_build_object(
      'capability_manifest_revision', v_manifest_v4,
      'company_id', v_company_id,
      'permission_snapshot_revision', v_permission_revision,
      'job', v_subject,
      'stable_business_value', 'one-proof-bearing-representative'
    );
  end if;
  v_hash := 'sha256:' || encode(
    extensions.digest(
      convert_to(private.canonical_agent_projection_json(v_projection), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_source_version := jsonb_build_object(
    'source_domain', 'operations',
    'source_type', 'fixture_projection',
    'source_id', p_reader_name,
    'version', 'fixture:' || v_hash
  );
  v_evidence := jsonb_build_object(
    'evidence_id', 'evidence:' || p_reader_name,
    'source_domain', 'operations',
    'source_type', 'fixture_projection',
    'source_id', p_reader_name,
    'version', 'fixture:' || v_hash
  );

  if p_reader_name = 'scheduled_jobs' then
    return jsonb_build_object(
      'company_id', v_company_id,
      'permission_snapshot_revision', v_permission_revision,
      'read_at', '2026-08-30T00:00:00.000Z',
      'source_fence', v_fence,
      'company_timezone', 'America/Vancouver',
      'display_timezone', 'America/Vancouver',
      'occurrences', jsonb_build_array(v_subject),
      'occurrence_proofs', jsonb_build_array(jsonb_build_object(
        'occurrence_ref', v_subject -> 'occurrence_ref',
        'source_version', v_source_version,
        'source_content_hash', v_hash,
        'evidence_id', 'evidence:' || p_reader_name,
        'projection', v_projection
      )),
      'returned_occurrence_count', 1,
      'next_cursor_claims', null,
      'has_more', false,
      'source_versions', jsonb_build_array(v_fence, v_source_version),
      'evidence', jsonb_build_array(v_evidence)
    );
  end if;

  return jsonb_build_object(
    'company_id', v_company_id,
    'permission_snapshot_revision', v_permission_revision,
    'read_at', '2026-08-30T00:00:00.000Z',
    'source_fence', v_fence,
    'candidates', jsonb_build_array(v_subject || jsonb_build_object(
      'projection_proof', jsonb_build_object(
        'source_version', v_source_version,
        'source_content_hash', v_hash,
        'evidence_id', 'evidence:' || p_reader_name,
        'projection', v_projection
      )
    )),
    'scanned_candidate_count', 1,
    'next_scan_cursor_claims', null,
    'scan_has_more', false,
    'source_versions', jsonb_build_array(v_fence, v_source_version),
    'evidence', jsonb_build_array(v_evidence)
  );
end;
$function$;

insert into private.schedule_readiness_manifest_bridge_fixture
  (reader_name, payload)
values
  (
    'scheduled_jobs',
    private.schedule_readiness_manifest_bridge_payload(
      'scheduled_jobs', false
    )
  ),
  (
    'job_readiness_issues',
    private.schedule_readiness_manifest_bridge_payload(
      'job_readiness_issues', false
    )
  );

create function private.read_agent_scheduled_jobs_v4_impl(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[],
  p_display_timezone text,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_start_utc timestamptz,
  p_cursor_task_id uuid,
  p_limit integer
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select fixture.payload
  from private.schedule_readiness_manifest_bridge_fixture fixture
  where fixture.reader_name = 'scheduled_jobs'
    and p_capability_manifest_revision =
      '2026-08-12.capability-manifest.v4'
$function$;

create function private.read_agent_scheduled_jobs_v5_impl(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[],
  p_display_timezone text,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_start_utc timestamptz,
  p_cursor_task_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-13.capability-manifest.v5' then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;
  return private.read_agent_scheduled_jobs_v4_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-12.capability-manifest.v4',
    p_required_oauth_scopes,
    p_calendar_scope,
    p_projects_scope,
    p_tasks_scope,
    p_from,
    p_to,
    p_task_statuses,
    p_confirmation_states,
    p_display_timezone,
    p_read_as_of,
    p_cursor_source_revision,
    p_cursor_start_utc,
    p_cursor_task_id,
    p_limit
  );
end;
$function$;

create function private.read_agent_scheduled_jobs_v6_bridge(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[],
  p_display_timezone text,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_start_utc timestamptz,
  p_cursor_task_id uuid,
  p_limit integer
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select private.read_agent_scheduled_jobs_v5_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-13.capability-manifest.v5',
    p_required_oauth_scopes,
    p_calendar_scope,
    p_projects_scope,
    p_tasks_scope,
    p_from,
    p_to,
    p_task_statuses,
    p_confirmation_states,
    p_display_timezone,
    p_read_as_of,
    p_cursor_source_revision,
    p_cursor_start_utc,
    p_cursor_task_id,
    p_limit
  );
$function$;

create function private.read_agent_job_readiness_issues_v4_impl(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_first_scheduled_start_utc timestamptz,
  p_cursor_project_id uuid,
  p_scan_limit integer
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select fixture.payload
  from private.schedule_readiness_manifest_bridge_fixture fixture
  where fixture.reader_name = 'job_readiness_issues'
    and p_capability_manifest_revision =
      '2026-08-12.capability-manifest.v4'
$function$;

create function private.read_agent_job_readiness_issues_v5_impl(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_first_scheduled_start_utc timestamptz,
  p_cursor_project_id uuid,
  p_scan_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-13.capability-manifest.v5' then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;
  return private.read_agent_job_readiness_issues_v4_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-12.capability-manifest.v4',
    p_required_oauth_scopes,
    p_calendar_scope,
    p_clients_scope,
    p_photos_scope,
    p_projects_scope,
    p_tasks_scope,
    p_from,
    p_to,
    p_rule_codes,
    p_read_as_of,
    p_cursor_source_revision,
    p_cursor_first_scheduled_start_utc,
    p_cursor_project_id,
    p_scan_limit
  );
end;
$function$;

create function private.read_agent_job_readiness_issues_v6_bridge(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_first_scheduled_start_utc timestamptz,
  p_cursor_project_id uuid,
  p_scan_limit integer
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select private.read_agent_job_readiness_issues_v5_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-13.capability-manifest.v5',
    p_required_oauth_scopes,
    p_calendar_scope,
    p_clients_scope,
    p_photos_scope,
    p_projects_scope,
    p_tasks_scope,
    p_from,
    p_to,
    p_rule_codes,
    p_read_as_of,
    p_cursor_source_revision,
    p_cursor_first_scheduled_start_utc,
    p_cursor_project_id,
    p_scan_limit
  );
$function$;

create function private.read_agent_scheduled_jobs_as_system_v6_core(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[] default null,
  p_display_timezone text default null,
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_start_utc timestamptz default null,
  p_cursor_task_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    private.read_agent_scheduled_jobs_v6_bridge(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      p_required_oauth_scopes,
      p_calendar_scope,
      p_projects_scope,
      p_tasks_scope,
      p_from,
      p_to,
      p_task_statuses,
      p_confirmation_states,
      p_display_timezone,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_start_utc,
      p_cursor_task_id,
      p_limit
    ),
    p_capability_manifest_revision
  );
end;
$function$;

create function private.read_agent_job_readiness_issues_as_system_v6_core(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_first_scheduled_start_utc timestamptz default null,
  p_cursor_project_id uuid default null,
  p_scan_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    private.read_agent_job_readiness_issues_v6_bridge(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      p_required_oauth_scopes,
      p_calendar_scope,
      p_clients_scope,
      p_photos_scope,
      p_projects_scope,
      p_tasks_scope,
      p_from,
      p_to,
      p_rule_codes,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_first_scheduled_start_utc,
      p_cursor_project_id,
      p_scan_limit
    ),
    p_capability_manifest_revision
  );
end;
$function$;

create function private.read_agent_scheduled_jobs_as_system_v7_core(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[] default null,
  p_display_timezone text default null,
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_start_utc timestamptz default null,
  p_cursor_task_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;
  v_v6_result := private.read_agent_scheduled_jobs_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_calendar_scope,
      p_projects_scope,
      p_tasks_scope,
      p_from,
      p_to,
      p_task_statuses,
      p_confirmation_states,
      p_display_timezone,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_start_utc,
      p_cursor_task_id,
      p_limit
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

create function private.read_agent_job_readiness_issues_as_system_v7_core(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_first_scheduled_start_utc timestamptz default null,
  p_cursor_project_id uuid default null,
  p_scan_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;
  v_v6_result :=
    private.read_agent_job_readiness_issues_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
      p_required_oauth_scopes,
      p_calendar_scope,
      p_clients_scope,
      p_photos_scope,
      p_projects_scope,
      p_tasks_scope,
      p_from,
      p_to,
      p_rule_codes,
      p_read_as_of,
      p_cursor_source_revision,
      p_cursor_first_scheduled_start_utc,
      p_cursor_project_id,
      p_scan_limit
    );
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

create function public.read_agent_scheduled_jobs_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[] default null,
  p_display_timezone text default null,
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_start_utc timestamptz default null,
  p_cursor_task_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7',
       '2026-08-22.capability-manifest.v8'
     ) then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_scheduled_jobs_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_calendar_scope, p_projects_scope,
    p_tasks_scope, p_from, p_to, p_task_statuses, p_confirmation_states,
    p_display_timezone, p_read_as_of, p_cursor_source_revision,
    p_cursor_start_utc, p_cursor_task_id, p_limit
  );
  if p_capability_manifest_revision in (
    '2026-08-14.capability-manifest.v6',
    '2026-08-20.capability-manifest.v7'
  ) then
    return v_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_result, '2026-08-22.capability-manifest.v8'
  );
end;
$function$;

create function public.read_agent_job_readiness_issues_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_first_scheduled_start_utc timestamptz default null,
  p_cursor_project_id uuid default null,
  p_scan_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7',
       '2026-08-22.capability-manifest.v8'
     ) then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_job_readiness_issues_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_calendar_scope, p_clients_scope,
    p_photos_scope, p_projects_scope, p_tasks_scope, p_from, p_to,
    p_rule_codes, p_read_as_of, p_cursor_source_revision,
    p_cursor_first_scheduled_start_utc, p_cursor_project_id, p_scan_limit
  );
  if p_capability_manifest_revision in (
    '2026-08-14.capability-manifest.v6',
    '2026-08-20.capability-manifest.v7'
  ) then
    return v_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_result, '2026-08-22.capability-manifest.v8'
  );
end;
$function$;

revoke all on function private.read_agent_scheduled_jobs_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.read_agent_job_readiness_issues_as_system_v6_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.read_agent_scheduled_jobs_as_system_v7_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.read_agent_job_readiness_issues_as_system_v7_core(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;
revoke all on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

create table private.schedule_readiness_manifest_bridge_expected (
  function_signature text primary key,
  pre_sha256 text not null,
  repaired_sha256 text not null
);

insert into private.schedule_readiness_manifest_bridge_expected values
  (
    'private.read_agent_scheduled_jobs_as_system_v6_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    'cbab1a800894cafff2c49ae8a39acb9246a2196c98dcce8af1db7eaafc1b55e7',
    '78037239506d8efaf3d8c1f773aa9f5d349d5fb7abdb03c5208ec416d9fccec2'
  ),
  (
    'private.read_agent_job_readiness_issues_as_system_v6_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    '1ab779c3ec9c219ee6b79d4943c8c6c79d26d74637813488f5b32c457cfe71a1',
    '91ebe44e74915b8dab23ac77b0168e2d3434d788a168f87f6eb3972647ca8c4b'
  ),
  (
    'private.read_agent_scheduled_jobs_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    '4f02d94867ac64c42b028e3211d5d5568707cea7b001ce9df0668549240fddbd',
    '0d7e094e2d3add1445b9754a0a7966a076ee93b2670613538683a5e2ad845e1b'
  ),
  (
    'private.read_agent_job_readiness_issues_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    '23fc832cdbde1af33581ef41061beddf3aa9e5f59900341c8df0f8bd54da173c',
    '63d3def3c6c41fe8c78d7466448ccb5013e714c69f4960adc30ee92f843210de'
  ),
  (
    'public.read_agent_scheduled_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    'bdb685f62c0515032f89b766eba4b9225a0afd3f2dccbe4e1c6dc767a200b2ea',
    'd59caf045a72501df7a3a6974644f44454f2be84f92931b98de5f53c5704c61b'
  ),
  (
    'public.read_agent_job_readiness_issues_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    'e975e2c39005410de6326067754348f491a23380074a2dddc6fd2e6464d36447',
    '0645f961d250e2a0d78f0e86ba8c5e00ccffd75c6879c1dd549cfd72197fec8a'
  );

do $assert_preimage_hashes$
declare
  v_bad integer;
begin
  select count(*)
  into v_bad
  from private.schedule_readiness_manifest_bridge_expected expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.function_signature)::oid
  where encode(
    extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
    'hex'
  ) is distinct from expected.pre_sha256;
  if v_bad <> 0 then
    raise exception 'production_preimage_hash_mismatch:%', v_bad;
  end if;
end;
$assert_preimage_hashes$;

create table private.schedule_readiness_manifest_bridge_catalog_preimage as
select
  expected.function_signature,
  procedure.oid,
  procedure.proowner,
  procedure.proacl,
  procedure.proconfig,
  procedure.prosecdef,
  procedure.provolatile,
  procedure.proparallel,
  procedure.proisstrict,
  procedure.pronargdefaults,
  procedure.proargdefaults::text as proargdefaults,
  pg_get_functiondef(procedure.oid) as function_definition
from private.schedule_readiness_manifest_bridge_expected expected
join pg_catalog.pg_proc procedure
  on procedure.oid = to_regprocedure(expected.function_signature)::oid;

create function private.schedule_readiness_runtime_schedule_call(
  p_manifest_revision text
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select public.read_agent_scheduled_jobs_as_system(
    'request:fixture',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'permission:fixture:v1',
    array[]::text[],
    'list_scheduled_jobs',
    'fixture:v1',
    p_manifest_revision,
    array['ops.schedule.read']::text[],
    'company',
    'company',
    'company',
    '2026-08-30T00:00:00Z'::timestamptz,
    '2026-08-31T00:00:00Z'::timestamptz,
    array['scheduled']::text[],
    null,
    'America/Vancouver',
    null,
    null,
    null,
    null,
    25
  )
$function$;

create function private.schedule_readiness_runtime_readiness_call(
  p_manifest_revision text
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select public.read_agent_job_readiness_issues_as_system(
    'request:fixture',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'permission:fixture:v1',
    array[]::text[],
    'list_job_readiness_issues',
    'fixture:v1',
    p_manifest_revision,
    array['ops.schedule.read']::text[],
    'company',
    'company',
    'company',
    'company',
    'company',
    '2026-08-30T00:00:00Z'::timestamptz,
    '2026-08-31T00:00:00Z'::timestamptz,
    array['missing_scope']::text[],
    null,
    null,
    null,
    null,
    50
  )
$function$;

select set_config('request.jwt.claim.role', 'service_role', false);

prepare schedule_v8_prepared as
select public.read_agent_scheduled_jobs_as_system(
  'request:prepared',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'permission:fixture:v1',
  array[]::text[],
  'list_scheduled_jobs',
  'fixture:v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.schedule.read']::text[],
  'company', 'company', 'company',
  '2026-08-30T00:00:00Z'::timestamptz,
  '2026-08-31T00:00:00Z'::timestamptz,
  array['scheduled']::text[],
  null, 'America/Vancouver', null, null, null, null, 25
);

prepare readiness_v8_prepared as
select public.read_agent_job_readiness_issues_as_system(
  'request:prepared',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'permission:fixture:v1',
  array[]::text[],
  'list_job_readiness_issues',
  'fixture:v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.schedule.read']::text[],
  'company', 'company', 'company', 'company', 'company',
  '2026-08-30T00:00:00Z'::timestamptz,
  '2026-08-31T00:00:00Z'::timestamptz,
  array['missing_scope']::text[],
  null, null, null, null, 50
);

do $assert_broken_nonempty_chain$
begin
  perform private.schedule_readiness_runtime_schedule_call(
    '2026-08-22.capability-manifest.v8'
  );
  raise exception 'schedule_nonempty_pre_repair_unexpected_success';
exception
  when sqlstate '22023' then
    if sqlerrm is distinct from 'invalid_agent_manifest_reproof_source' then
      raise;
    end if;
end;
$assert_broken_nonempty_chain$;

do $assert_broken_nonempty_readiness_chain$
begin
  perform private.schedule_readiness_runtime_readiness_call(
    '2026-08-22.capability-manifest.v8'
  );
  raise exception 'readiness_nonempty_pre_repair_unexpected_success';
exception
  when sqlstate '22023' then
    if sqlerrm is distinct from 'invalid_agent_manifest_reproof_source' then
      raise;
    end if;
end;
$assert_broken_nonempty_readiness_chain$;

update private.schedule_readiness_manifest_bridge_fixture
set payload = private.schedule_readiness_manifest_bridge_payload(
  reader_name, true
);

do $assert_broken_marker_free_empty_chain$
begin
  perform private.schedule_readiness_runtime_schedule_call(
    '2026-08-22.capability-manifest.v8'
  );
  raise exception 'schedule_empty_pre_repair_unexpected_success';
exception
  when sqlstate '22023' then
    if sqlerrm is distinct from 'invalid_agent_manifest_reproof_source' then
      raise;
    end if;
end;
$assert_broken_marker_free_empty_chain$;

do $assert_broken_marker_free_empty_readiness_chain$
begin
  perform private.schedule_readiness_runtime_readiness_call(
    '2026-08-22.capability-manifest.v8'
  );
  raise exception 'readiness_empty_pre_repair_unexpected_success';
exception
  when sqlstate '22023' then
    if sqlerrm is distinct from 'invalid_agent_manifest_reproof_source' then
      raise;
    end if;
end;
$assert_broken_marker_free_empty_readiness_chain$;

update private.schedule_readiness_manifest_bridge_fixture
set payload = private.schedule_readiness_manifest_bridge_payload(
  reader_name, false
);

\ir ../../supabase/migrations/20260830130000_agent_schedule_readiness_manifest_bridge.sql

execute schedule_v8_prepared;
execute readiness_v8_prepared;

create table private.schedule_readiness_manifest_bridge_catalog_repaired as
select
  expected.function_signature,
  procedure.oid,
  procedure.proowner,
  procedure.proacl,
  procedure.proconfig,
  procedure.prosecdef,
  procedure.provolatile,
  procedure.proparallel,
  procedure.proisstrict,
  procedure.pronargdefaults,
  procedure.proargdefaults::text as proargdefaults,
  pg_get_functiondef(procedure.oid) as function_definition,
  encode(
    extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
    'hex'
  ) as prosrc_sha256
from private.schedule_readiness_manifest_bridge_expected expected
join pg_catalog.pg_proc procedure
  on procedure.oid = to_regprocedure(expected.function_signature)::oid;

begin;

do $assert_repaired_hashes_and_catalog_identity$
declare
  v_bad integer;
begin
  select count(*)
  into v_bad
  from private.schedule_readiness_manifest_bridge_catalog_repaired repaired
  join private.schedule_readiness_manifest_bridge_expected expected
    using (function_signature)
  where repaired.prosrc_sha256 is distinct from expected.repaired_sha256;
  if v_bad <> 0 then
    raise exception 'repaired_prosrc_hash_mismatch:%', v_bad;
  end if;

  select count(*)
  into v_bad
  from private.schedule_readiness_manifest_bridge_catalog_repaired repaired
  join private.schedule_readiness_manifest_bridge_catalog_preimage preimage
    using (function_signature)
  where repaired.oid is distinct from preimage.oid
     or repaired.proowner is distinct from preimage.proowner
     or repaired.proacl is distinct from preimage.proacl
     or repaired.proconfig is distinct from preimage.proconfig
     or repaired.prosecdef is distinct from preimage.prosecdef
     or repaired.provolatile is distinct from preimage.provolatile
     or repaired.proparallel is distinct from preimage.proparallel
     or repaired.proisstrict is distinct from preimage.proisstrict
     or repaired.pronargdefaults is distinct from preimage.pronargdefaults
     or repaired.proargdefaults is distinct from preimage.proargdefaults;
  if v_bad <> 0 then
    raise exception 'catalog_identity_changed:%', v_bad;
  end if;

  if (
    select encode(
      extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
      'hex'
    )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'private.reprove_agent_read_jsonb_for_manifest(jsonb,text)'::regprocedure
  ) is distinct from
      '824d9fd30a423132e75e9428e7b538e15246e3d98ca3795e37d792cd266f5dd6'
  then
    raise exception 'generic_helper_changed';
  end if;
end;
$assert_repaired_hashes_and_catalog_identity$;

do $assert_nonempty_chain_markers_and_hashes$
declare
  v_revision text;
  v_result jsonb;
  v_bad integer;
  v_marker_count integer;
  v_proof_count integer;
begin
  for v_revision in
    select revision
    from (values
      ('2026-08-14.capability-manifest.v6'::text),
      ('2026-08-20.capability-manifest.v7'::text),
      ('2026-08-22.capability-manifest.v8'::text)
    ) revisions(revision)
  loop
    v_result := private.schedule_readiness_runtime_schedule_call(v_revision);
    select
      count(*) filter (
        where object_value ? 'capability_manifest_revision'
      ),
      count(*) filter (
        where object_value ? 'capability_manifest_revision'
          and object_value ->> 'capability_manifest_revision' is distinct from
            v_revision
      ),
      count(*) filter (
        where jsonb_typeof(object_value -> 'projection') = 'object'
          and object_value ->> 'source_content_hash'
            ~ '^sha256:[0-9a-f]{64}$'
      )
    into v_marker_count, v_bad, v_proof_count
    from private.agent_jsonb_objects(v_result) object_value;
    if v_marker_count = 0 or v_bad <> 0 or v_proof_count = 0 then
      raise exception 'schedule_manifest_marker_mismatch:%', v_revision;
    end if;
    if exists (
      select 1
      from private.agent_jsonb_objects(v_result) object_value
      where jsonb_typeof(object_value -> 'projection') = 'object'
        and object_value ->> 'source_content_hash'
          ~ '^sha256:[0-9a-f]{64}$'
        and object_value ->> 'source_content_hash' is distinct from
          'sha256:' || encode(
            extensions.digest(
              convert_to(
                private.canonical_agent_projection_json(
                  object_value -> 'projection'
                ),
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          )
    ) then
      raise exception 'schedule_proof_hash_mismatch:%', v_revision;
    end if;

    v_result := private.schedule_readiness_runtime_readiness_call(v_revision);
    select
      count(*) filter (
        where object_value ? 'capability_manifest_revision'
      ),
      count(*) filter (
        where object_value ? 'capability_manifest_revision'
          and object_value ->> 'capability_manifest_revision' is distinct from
            v_revision
      ),
      count(*) filter (
        where jsonb_typeof(object_value -> 'projection') = 'object'
          and object_value ->> 'source_content_hash'
            ~ '^sha256:[0-9a-f]{64}$'
      )
    into v_marker_count, v_bad, v_proof_count
    from private.agent_jsonb_objects(v_result) object_value;
    if v_marker_count = 0 or v_bad <> 0 or v_proof_count = 0 then
      raise exception 'readiness_manifest_marker_mismatch:%', v_revision;
    end if;
    if exists (
      select 1
      from private.agent_jsonb_objects(v_result) object_value
      where jsonb_typeof(object_value -> 'projection') = 'object'
        and object_value ->> 'source_content_hash'
          ~ '^sha256:[0-9a-f]{64}$'
        and object_value ->> 'source_content_hash' is distinct from
          'sha256:' || encode(
            extensions.digest(
              convert_to(
                private.canonical_agent_projection_json(
                  object_value -> 'projection'
                ),
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          )
    ) then
      raise exception 'readiness_proof_hash_mismatch:%', v_revision;
    end if;
  end loop;
end;
$assert_nonempty_chain_markers_and_hashes$;

update private.schedule_readiness_manifest_bridge_fixture
set payload = private.schedule_readiness_manifest_bridge_payload(
  reader_name, true
);

do $assert_exact_empty_byte_identity$
declare
  v_revision text;
  v_expected jsonb;
begin
  for v_revision in
    select revision
    from (values
      ('2026-08-14.capability-manifest.v6'::text),
      ('2026-08-20.capability-manifest.v7'::text),
      ('2026-08-22.capability-manifest.v8'::text)
    ) revisions(revision)
  loop
    select payload into v_expected
    from private.schedule_readiness_manifest_bridge_fixture
    where reader_name = 'scheduled_jobs';
    if private.schedule_readiness_runtime_schedule_call(v_revision)
         is distinct from v_expected then
      raise exception 'exact_empty_schedule_byte_identity:%', v_revision;
    end if;

    select payload into v_expected
    from private.schedule_readiness_manifest_bridge_fixture
    where reader_name = 'job_readiness_issues';
    if private.schedule_readiness_runtime_readiness_call(v_revision)
         is distinct from v_expected then
      raise exception 'exact_empty_readiness_byte_identity:%', v_revision;
    end if;
  end loop;
end;
$assert_exact_empty_byte_identity$;

create function private.schedule_readiness_assert_bridge_rejected(
  p_payload jsonb,
  p_reader_name text,
  p_company_id uuid,
  p_permission_revision text
) returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, private
as $function$
begin
  perform private.reprove_agent_schedule_readiness_jsonb_for_manifest(
    p_payload,
    p_reader_name,
    p_company_id,
    p_permission_revision,
    '2026-08-12.capability-manifest.v4',
    '2026-08-14.capability-manifest.v6'
  );
  raise exception 'bridge_adversarial_payload_unexpected_success'
    using errcode = 'P0001';
exception
  when sqlstate '22023' then
    if sqlerrm is distinct from
         'invalid_agent_schedule_readiness_manifest_bridge_source' then
      raise;
    end if;
end;
$function$;

do $assert_adversarial_shapes$
declare
  v_company_id constant uuid :=
    '11111111-1111-1111-1111-111111111111'::uuid;
  v_permission constant text := 'permission:fixture:v1';
  v_schedule jsonb := private.schedule_readiness_manifest_bridge_payload(
    'scheduled_jobs', false
  );
  v_readiness jsonb := private.schedule_readiness_manifest_bridge_payload(
    'job_readiness_issues', false
  );
  v_empty_schedule jsonb :=
    private.schedule_readiness_manifest_bridge_payload('scheduled_jobs', true);
  v_empty_readiness jsonb :=
    private.schedule_readiness_manifest_bridge_payload(
      'job_readiness_issues', true
    );
  v_projection jsonb;
begin
  -- proofless_nonempty_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_schedule,
      '{occurrence_proofs}',
      jsonb_build_array(jsonb_build_object('evidence_id', 'proofless'))
    ),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- mismatched_company_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    v_empty_schedule,
    'scheduled_jobs',
    '99999999-9999-9999-9999-999999999999'::uuid,
    v_permission
  );

  -- mismatched_permission_revision_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    v_empty_schedule,
    'scheduled_jobs', v_company_id, 'permission:wrong'
  );

  -- mismatched_operations_fence_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(v_empty_schedule, '{source_fence,version}', '"revision:43"'),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- null_operations_fence_revision_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(v_empty_schedule, '{source_fence,version}', 'null'::jsonb),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- noncanonical_read_at_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(v_empty_schedule, '{read_at}', '"2026-08-30"'),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- malformed_readiness_empty_pagination_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(v_empty_readiness, '{scan_has_more}', 'true'::jsonb),
    'job_readiness_issues', v_company_id, v_permission
  );

  -- forbidden_manifest_metadata_in_empty_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_empty_readiness,
      '{source_fence,capability_manifest_revision}',
      '"2026-08-12.capability-manifest.v4"'
    ),
    'job_readiness_issues', v_company_id, v_permission
  );

  -- injected_empty_source_version_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_empty_schedule,
      '{source_versions}',
      (v_empty_schedule -> 'source_versions') || jsonb_build_array(
        jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'detached',
          'source_id', 'detached',
          'version', 'detached:v1'
        )
      )
    ),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- partial_proof_rejected
  v_projection := v_readiness #>
    '{candidates,0,projection_proof,projection}';
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_readiness,
      '{candidates,0,projection_proof}',
      jsonb_build_object('projection', v_projection)
    ),
    'job_readiness_issues', v_company_id, v_permission
  );

  -- occurrence_proof_binding_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_schedule,
      '{occurrence_proofs,0,occurrence_ref,id}',
      '"44444444-4444-4444-4444-444444444444"'
    ),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- evidence_binding_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_schedule,
      '{evidence,0,evidence_id}',
      '"evidence:detached"'
    ),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- bad_source_content_hash_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_schedule,
      '{occurrence_proofs,0,source_content_hash}',
      to_jsonb('sha256:' || repeat('0', 64))
    ),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- bad_source_version_suffix_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_readiness,
      '{candidates,0,projection_proof,source_version,version}',
      '"fixture:detached"'
    ),
    'job_readiness_issues', v_company_id, v_permission
  );

  -- detached_self_hashed_proof_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      jsonb_set(
        v_readiness,
        '{candidates,0,detached_proof}',
        v_readiness #> '{candidates,0,projection_proof}'
      ),
      '{candidates,0,projection_proof}',
      'null'::jsonb
    ),
    'job_readiness_issues', v_company_id, v_permission
  );

  -- mixed_manifest_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    jsonb_set(
      v_schedule,
      '{occurrences,0,foreign_manifest}',
      jsonb_build_object(
        'capability_manifest_revision',
        '2026-08-13.capability-manifest.v5'
      )
    ),
    'scheduled_jobs', v_company_id, v_permission
  );

  -- arbitrary_extra_key_rejected
  perform private.schedule_readiness_assert_bridge_rejected(
    v_schedule || jsonb_build_object('unbound_payload', true),
    'scheduled_jobs', v_company_id, v_permission
  );
end;
$assert_adversarial_shapes$;

do $assert_generic_helper_marker_free_rejected$
begin
  perform private.reprove_agent_read_jsonb_for_manifest(
    '{}'::jsonb,
    '2026-08-22.capability-manifest.v8'
  );
  raise exception 'generic_helper_marker_free_unexpected_success';
exception
  when sqlstate '22023' then
    if sqlerrm is distinct from 'invalid_agent_manifest_reproof_source' then
      raise;
    end if;
end;
$assert_generic_helper_marker_free_rejected$;

rollback;
