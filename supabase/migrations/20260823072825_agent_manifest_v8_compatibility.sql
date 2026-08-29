begin;

-- Task 25 is a compatibility-only bridge. It freezes the exact v7 public
-- readers in private cores, retains their byte-identical v6/v7 behaviour, and
-- adds v8 by reproofing only the returned proof metadata. No P2 read is
-- installed or exposed here.

do $freeze_v7_cores$
declare
  v_name text;
  v_arguments text;
  v_core_name text;
  v_public regprocedure;
  v_private_core regprocedure;
begin
  for v_name, v_arguments in
    select reader.name, reader.arguments
    from (values
      (
        'read_agent_job_communication_context_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text'
      ),
      (
        'read_agent_job_participants_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,uuid,text'
      ),
      (
        'read_agent_job_conversation_context_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid'
      ),
      (
        'read_agent_scheduled_jobs_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamptz,timestamptz,text[],text[],text,timestamptz,bigint,timestamptz,uuid,integer'
      ),
      (
        'read_agent_job_readiness_issues_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamptz,timestamptz,text[],timestamptz,bigint,timestamptz,uuid,integer'
      ),
      (
        'read_agent_correspondence_evidence_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text,text,text[]'
      ),
      (
        'read_agent_phase_c_job_conversation_context_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid,bigint,uuid,uuid,text,uuid,uuid,uuid'
      ),
      (
        'read_agent_customer_jobs_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,timestamptz,text,uuid,integer'
      ),
      (
        'read_agent_job_summary_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[]'
      ),
      (
        'read_agent_correspondence_evidence_page_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text'
      ),
      (
        'read_agent_job_history_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamptz,timestamptz,text[],timestamptz,bigint,bigint,bigint,timestamptz,text,text,integer'
      ),
      (
        'read_agent_customer_discovery_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],timestamptz,bigint,integer,text,uuid,integer'
      ),
      (
        'read_agent_job_discovery_as_system',
        'text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,integer,text,uuid,integer'
      )
    ) reader(name, arguments)
  loop
    v_core_name := v_name || '_v7_core';
    v_public := to_regprocedure(format('public.%I(%s)', v_name, v_arguments));
    v_private_core := to_regprocedure(
      format('private.%I(%s)', v_core_name, v_arguments)
    );

    if v_private_core is null then
      if v_public is null then
        raise exception 'missing_agent_manifest_v7_reader: %', v_name
          using errcode = '55000';
      end if;
      execute format(
        'alter function public.%I(%s) rename to %I',
        v_name,
        v_arguments,
        v_core_name
      );
      execute format(
        'alter function public.%I(%s) set schema private',
        v_core_name,
        v_arguments
      );
    end if;

    v_private_core := to_regprocedure(
      format('private.%I(%s)', v_core_name, v_arguments)
    );
    if v_private_core is null then
      raise exception 'missing_agent_manifest_v7_core: %', v_name
        using errcode = '55000';
    end if;
    execute format(
      'revoke all on function private.%I(%s) from public, anon, authenticated, service_role',
      v_core_name,
      v_arguments
    );
  end loop;
end;
$freeze_v7_cores$;

-- The historical helper remains the single adjacent-revision bridge. v6
-- accepts only a complete v5 source, v7 only a complete v6 source, and v8
-- only a complete v7 source. Null, unknown, empty, and mixed sources fail
-- closed before any projection or hash mutation occurs.
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

create or replace function public.read_agent_job_communication_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text
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
    raise exception 'invalid_agent_job_communication_context_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_job_communication_context_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_inbox_scope, p_clients_scope,
    p_job_permission, p_job_scope, p_projects_scope, p_calendar_scope,
    p_tasks_scope, p_photos_scope, p_job_kind, p_job_id, p_purpose
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

create or replace function public.read_agent_job_participants_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text
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
    raise exception 'invalid_agent_job_participants_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_job_participants_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_inbox_scope, p_clients_scope,
    p_job_permission, p_job_scope, p_projects_scope, p_tasks_scope,
    p_job_kind, p_job_id, p_purpose
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

create or replace function public.read_agent_job_conversation_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer default 20,
  p_sections text[] default array[
    'memory', 'recent_turns', 'participants', 'gaps', 'cross_job_seed'
  ]::text[],
  p_required_through_turn_id uuid default null
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
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_job_conversation_context_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_inbox_scope, p_clients_scope,
    p_job_permission, p_job_scope, p_job_kind, p_job_id,
    p_exact_turn_limit, p_sections, p_required_through_turn_id
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

create or replace function public.read_agent_scheduled_jobs_as_system(
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

create or replace function public.read_agent_job_readiness_issues_as_system(
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

create or replace function public.read_agent_correspondence_evidence_as_system(
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
       '2026-08-20.capability-manifest.v7',
       '2026-08-22.capability-manifest.v8'
     ) then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;
  return query
  select core.evidence_id,
         core.company_id,
         core.source_id,
         core.occurred_at,
         core.subject,
         core.side,
         core.participant_id,
         core.participant_resolution_status,
         core.direction,
         core.source_activity_id,
         core.source_correspondence_event_id,
         core.recipient_identities,
         core.cc_recipient_identities,
         core.redaction_kinds,
         core.normalized_plain_text,
         core.original_content_hash,
         core.attachments
  from private.read_agent_correspondence_evidence_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case
      when p_capability_manifest_revision =
        '2026-08-14.capability-manifest.v6'
        then '2026-08-14.capability-manifest.v6'
      else '2026-08-20.capability-manifest.v7'
    end,
    p_required_oauth_scope, p_inbox_scope, p_evidence_ids
  ) core;
end;
$function$;

create or replace function public.read_agent_phase_c_job_conversation_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer,
  p_sections text[],
  p_required_through_turn_id uuid,
  p_phase_c_assignment_version bigint,
  p_phase_c_connection_id uuid,
  p_phase_c_internal_thread_id uuid,
  p_phase_c_provider_thread_id text,
  p_phase_c_source_activity_id uuid,
  p_phase_c_source_turn_id uuid,
  p_phase_c_source_conversation_id uuid
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
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  v_result :=
    private.read_agent_phase_c_job_conversation_context_as_system_v7_core(
      p_request_id, p_actor_user_id, p_company_id,
      p_permission_snapshot_revision, p_registered_permission_keys,
      p_capability_id, p_capability_revision,
      case when p_capability_manifest_revision =
        '2026-08-22.capability-manifest.v8'
        then '2026-08-20.capability-manifest.v7'
        else p_capability_manifest_revision end,
      p_required_oauth_scopes, p_inbox_scope, p_clients_scope,
      p_job_permission, p_job_scope, p_job_kind, p_job_id,
      p_exact_turn_limit, p_sections, p_required_through_turn_id,
      p_phase_c_assignment_version, p_phase_c_connection_id,
      p_phase_c_internal_thread_id, p_phase_c_provider_thread_id,
      p_phase_c_source_activity_id, p_phase_c_source_turn_id,
      p_phase_c_source_conversation_id
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

create or replace function public.read_agent_customer_jobs_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_customer_kind text,
  p_customer_id uuid,
  p_job_kinds text[],
  p_lifecycle_states text[],
  p_opportunity_stages text[],
  p_project_statuses text[],
  p_date_field text,
  p_date_from timestamptz,
  p_date_to_exclusive timestamptz,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_sort_at timestamptz,
  p_cursor_job_kind text,
  p_cursor_job_id uuid,
  p_limit integer
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
    raise exception 'invalid_agent_customer_jobs_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_customer_jobs_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_clients_scope, p_pipeline_scope,
    p_projects_scope, p_customer_kind, p_customer_id, p_job_kinds,
    p_lifecycle_states, p_opportunity_stages, p_project_statuses,
    p_date_field, p_date_from, p_date_to_exclusive, p_read_as_of,
    p_cursor_source_revision, p_cursor_sort_at, p_cursor_job_kind,
    p_cursor_job_id, p_limit
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

create or replace function public.read_agent_job_summary_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_estimates_scope text,
  p_invoices_scope text,
  p_projects_financials_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_sections text[],
  p_readiness_rule_codes text[],
  p_financial_components text[]
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
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_job_summary_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_inbox_scope, p_clients_scope,
    p_pipeline_scope, p_projects_scope, p_calendar_scope, p_tasks_scope,
    p_photos_scope, p_estimates_scope, p_invoices_scope,
    p_projects_financials_scope, p_job_kind, p_job_id, p_sections,
    p_readiness_rule_codes, p_financial_components
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

create or replace function public.read_agent_correspondence_evidence_page_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_evidence_ids text[],
  p_mode text
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
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;
  v_result :=
    private.read_agent_correspondence_evidence_page_as_system_v7_core(
      p_request_id, p_actor_user_id, p_company_id,
      p_permission_snapshot_revision, p_registered_permission_keys,
      p_capability_id, p_capability_revision,
      case when p_capability_manifest_revision =
        '2026-08-22.capability-manifest.v8'
        then '2026-08-20.capability-manifest.v7'
        else p_capability_manifest_revision end,
      p_required_oauth_scopes, p_inbox_scope, p_pipeline_scope,
      p_projects_scope, p_job_kind, p_job_id, p_evidence_ids, p_mode
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

create or replace function public.read_agent_job_history_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_estimates_scope text,
  p_projects_financials_scope text,
  p_query text,
  p_scope_kind text,
  p_customer_kind text,
  p_customer_id uuid,
  p_scope_job_kinds text[],
  p_job_refs jsonb,
  p_from timestamptz,
  p_to_exclusive timestamptz,
  p_source_types text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_history_revision bigint,
  p_cursor_rank_micros bigint,
  p_cursor_occurred_at timestamptz,
  p_cursor_source_type text,
  p_cursor_source_id text,
  p_limit integer
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
    raise exception 'invalid_agent_job_history_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_job_history_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_inbox_scope, p_clients_scope,
    p_pipeline_scope, p_projects_scope, p_calendar_scope, p_tasks_scope,
    p_estimates_scope, p_projects_financials_scope, p_query, p_scope_kind,
    p_customer_kind, p_customer_id, p_scope_job_kinds, p_job_refs,
    p_from, p_to_exclusive, p_source_types, p_read_as_of,
    p_cursor_source_revision, p_cursor_history_revision,
    p_cursor_rank_micros, p_cursor_occurred_at, p_cursor_source_type,
    p_cursor_source_id, p_limit
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

create or replace function public.read_agent_customer_discovery_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_capability_schema_revision text,
  p_ranking_revision text,
  p_required_oauth_scopes text[],
  p_clients_scope text,
  p_lookup text,
  p_query text,
  p_customer_kinds text[],
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_rank_ordinal integer,
  p_cursor_customer_kind text,
  p_cursor_customer_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
set plan_cache_mode = force_custom_plan
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-20.capability-manifest.v7',
       '2026-08-22.capability-manifest.v8'
     ) then
    raise exception 'invalid_agent_customer_discovery_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_customer_discovery_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    '2026-08-20.capability-manifest.v7',
    p_capability_schema_revision, p_ranking_revision,
    p_required_oauth_scopes, p_clients_scope, p_lookup, p_query,
    p_customer_kinds, p_read_as_of, p_cursor_source_revision,
    p_cursor_rank_ordinal, p_cursor_customer_kind, p_cursor_customer_id,
    p_limit
  );
  if p_capability_manifest_revision =
    '2026-08-20.capability-manifest.v7' then
    return v_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_result, '2026-08-22.capability-manifest.v8'
  );
end;
$function$;

create or replace function public.read_agent_job_discovery_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_capability_schema_revision text,
  p_ranking_revision text,
  p_required_oauth_scopes text[],
  p_pipeline_scope text,
  p_projects_scope text,
  p_query text,
  p_query_fields text[],
  p_job_kinds text[],
  p_lifecycle_states text[],
  p_opportunity_stages text[],
  p_project_statuses text[],
  p_date_field text,
  p_date_from timestamptz,
  p_date_to_exclusive timestamptz,
  p_read_as_of timestamptz,
  p_cursor_source_revision bigint,
  p_cursor_rank_ordinal integer,
  p_cursor_job_kind text,
  p_cursor_job_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
set plan_cache_mode = force_custom_plan
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-20.capability-manifest.v7',
       '2026-08-22.capability-manifest.v8'
     ) then
    raise exception 'invalid_agent_job_discovery_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_job_discovery_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    '2026-08-20.capability-manifest.v7',
    p_capability_schema_revision, p_ranking_revision,
    p_required_oauth_scopes, p_pipeline_scope, p_projects_scope,
    p_query, p_query_fields, p_job_kinds, p_lifecycle_states,
    p_opportunity_stages, p_project_statuses, p_date_field, p_date_from,
    p_date_to_exclusive, p_read_as_of, p_cursor_source_revision,
    p_cursor_rank_ordinal, p_cursor_job_kind, p_cursor_job_id, p_limit
  );
  if p_capability_manifest_revision =
    '2026-08-20.capability-manifest.v7' then
    return v_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_result, '2026-08-22.capability-manifest.v8'
  );
end;
$function$;

revoke all on function private.read_agent_job_communication_context_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_job_communication_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_communication_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,uuid,text) to service_role;

revoke all on function private.read_agent_job_participants_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_job_participants_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_participants_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,uuid,text) to service_role;

revoke all on function private.read_agent_job_conversation_context_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid) to service_role;

revoke all on function private.read_agent_scheduled_jobs_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamptz,timestamptz,text[],text[],text,timestamptz,bigint,timestamptz,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_scheduled_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamptz,timestamptz,text[],text[],text,timestamptz,bigint,timestamptz,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_scheduled_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamptz,timestamptz,text[],text[],text,timestamptz,bigint,timestamptz,uuid,integer) to service_role;

revoke all on function private.read_agent_job_readiness_issues_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamptz,timestamptz,text[],timestamptz,bigint,timestamptz,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_job_readiness_issues_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamptz,timestamptz,text[],timestamptz,bigint,timestamptz,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_readiness_issues_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamptz,timestamptz,text[],timestamptz,bigint,timestamptz,uuid,integer) to service_role;

revoke all on function private.read_agent_correspondence_evidence_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text,text,text[]) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_correspondence_evidence_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[]) to service_role;

revoke all on function private.read_agent_phase_c_job_conversation_context_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid,bigint,uuid,uuid,text,uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_phase_c_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid,bigint,uuid,uuid,text,uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_phase_c_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid,bigint,uuid,uuid,text,uuid,uuid,uuid) to service_role;

revoke all on function private.read_agent_customer_jobs_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,timestamptz,text,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_customer_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,timestamptz,text,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_customer_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,timestamptz,text,uuid,integer) to service_role;

revoke all on function private.read_agent_job_summary_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[]) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_job_summary_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[]) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_summary_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[]) to service_role;

revoke all on function private.read_agent_correspondence_evidence_page_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_correspondence_evidence_page_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_page_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text) to service_role;

revoke all on function private.read_agent_job_history_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamptz,timestamptz,text[],timestamptz,bigint,bigint,bigint,timestamptz,text,text,integer) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamptz,timestamptz,text[],timestamptz,bigint,bigint,bigint,timestamptz,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamptz,timestamptz,text[],timestamptz,bigint,bigint,bigint,timestamptz,text,text,integer) to service_role;

revoke all on function private.read_agent_customer_discovery_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],timestamptz,bigint,integer,text,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_customer_discovery_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],timestamptz,bigint,integer,text,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_customer_discovery_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],timestamptz,bigint,integer,text,uuid,integer) to service_role;

revoke all on function private.read_agent_job_discovery_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,integer,text,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_job_discovery_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,integer,text,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_discovery_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[],text,text,text,text[],text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,integer,text,uuid,integer) to service_role;

do $postflight$
declare
  v_name text;
  v_arguments text;
  v_public oid;
  v_private_core oid;
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
      raise exception 'agent_manifest_v8_function_missing: %', v_name
        using errcode = '55000';
    end if;
    if not has_function_privilege('service_role', v_public, 'EXECUTE')
       or has_function_privilege('anon', v_public, 'EXECUTE')
       or has_function_privilege('authenticated', v_public, 'EXECUTE')
       or has_function_privilege('service_role', v_private_core, 'EXECUTE')
       or has_function_privilege('anon', v_private_core, 'EXECUTE')
       or has_function_privilege('authenticated', v_private_core, 'EXECUTE') then
      raise exception 'agent_manifest_v8_acl_mismatch: %', v_name
        using errcode = '55000';
    end if;
    if exists (
      select 1
      from pg_proc function_row
      cross join lateral aclexplode(
        coalesce(function_row.proacl, acldefault('f', function_row.proowner))
      ) acl
      where function_row.oid in (v_public, v_private_core)
        and acl.grantee not in (
          function_row.proowner,
          case when function_row.oid = v_public
            then 'service_role'::regrole::oid else function_row.proowner end
        )
    ) then
      raise exception 'agent_manifest_v8_acl_entry_mismatch: %', v_name
        using errcode = '55000';
    end if;
    if exists (
      select 1
      from pg_proc function_row
      where function_row.oid in (v_public, v_private_core)
        and (not function_row.prosecdef or function_row.provolatile <> 's')
    ) then
      raise exception 'agent_manifest_v8_function_property_mismatch: %', v_name
        using errcode = '55000';
    end if;
  end loop;

  if has_function_privilege(
       'service_role',
       'private.reprove_agent_read_jsonb_for_manifest(jsonb,text)',
       'EXECUTE'
     ) then
    raise exception 'agent_manifest_v8_reproof_acl_mismatch'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
