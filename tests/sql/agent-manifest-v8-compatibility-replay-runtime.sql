\set ON_ERROR_STOP on

begin;

do $hostile_acl$
declare
  v_function regprocedure;
begin
  for v_function in
    select function_row.oid::regprocedure
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where (
      namespace_row.nspname = 'public'
      and function_row.proname in (
        'read_agent_job_communication_context_as_system',
        'read_agent_job_participants_as_system',
        'read_agent_job_conversation_context_as_system',
        'read_agent_scheduled_jobs_as_system',
        'read_agent_job_readiness_issues_as_system',
        'read_agent_correspondence_evidence_as_system',
        'read_agent_phase_c_job_conversation_context_as_system',
        'read_agent_customer_jobs_as_system',
        'read_agent_job_summary_as_system',
        'read_agent_correspondence_evidence_page_as_system',
        'read_agent_job_history_as_system',
        'read_agent_customer_discovery_as_system',
        'read_agent_job_discovery_as_system'
      )
    ) or (
      namespace_row.nspname = 'private'
      and function_row.proname like '%\_v7\_core' escape '\'
    )
  loop
    execute format(
      'grant execute on function %s to anon, authenticated with grant option',
      v_function
    );
  end loop;
end;
$hostile_acl$;

grant execute on function private.reprove_agent_read_jsonb_for_manifest(
  jsonb,text
) to service_role, anon, authenticated with grant option;

\ir ../../supabase/migrations/20260823072825_agent_manifest_v8_compatibility.sql

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $replay_contract$
declare
  v_public_count integer;
  v_private_count integer;
begin
  select count(*)
  into v_public_count
  from pg_proc function_row
  join pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.proname in (
      'read_agent_job_communication_context_as_system',
      'read_agent_job_participants_as_system',
      'read_agent_job_conversation_context_as_system',
      'read_agent_scheduled_jobs_as_system',
      'read_agent_job_readiness_issues_as_system',
      'read_agent_correspondence_evidence_as_system',
      'read_agent_phase_c_job_conversation_context_as_system',
      'read_agent_customer_jobs_as_system',
      'read_agent_job_summary_as_system',
      'read_agent_correspondence_evidence_page_as_system',
      'read_agent_job_history_as_system',
      'read_agent_customer_discovery_as_system',
      'read_agent_job_discovery_as_system'
    );
  select count(*)
  into v_private_count
  from pg_proc function_row
  join pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'private'
    and function_row.proname in (
      'read_agent_job_communication_context_as_system_v7_core',
      'read_agent_job_participants_as_system_v7_core',
      'read_agent_job_conversation_context_as_system_v7_core',
      'read_agent_scheduled_jobs_as_system_v7_core',
      'read_agent_job_readiness_issues_as_system_v7_core',
      'read_agent_correspondence_evidence_as_system_v7_core',
      'read_agent_phase_c_job_conversation_context_as_system_v7_core',
      'read_agent_customer_jobs_as_system_v7_core',
      'read_agent_job_summary_as_system_v7_core',
      'read_agent_correspondence_evidence_page_as_system_v7_core',
      'read_agent_job_history_as_system_v7_core',
      'read_agent_customer_discovery_as_system_v7_core',
      'read_agent_job_discovery_as_system_v7_core'
    );
  if v_public_count <> 13 or v_private_count <> 13 then
    raise exception 'compatibility replay function count mismatch';
  end if;
  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    cross join lateral aclexplode(
      coalesce(function_row.proacl, acldefault('f', function_row.proowner))
    ) acl
    where (
      namespace_row.nspname = 'public'
      and function_row.proname in (
        'read_agent_job_communication_context_as_system',
        'read_agent_job_participants_as_system',
        'read_agent_job_conversation_context_as_system',
        'read_agent_scheduled_jobs_as_system',
        'read_agent_job_readiness_issues_as_system',
        'read_agent_correspondence_evidence_as_system',
        'read_agent_phase_c_job_conversation_context_as_system',
        'read_agent_customer_jobs_as_system',
        'read_agent_job_summary_as_system',
        'read_agent_correspondence_evidence_page_as_system',
        'read_agent_job_history_as_system',
        'read_agent_customer_discovery_as_system',
        'read_agent_job_discovery_as_system'
      )
      and acl.grantee not in (
        function_row.proowner,
        'service_role'::regrole::oid
      )
    ) or (
      namespace_row.nspname = 'private'
      and function_row.proname like '%\_v7\_core' escape '\'
      and acl.grantee <> function_row.proowner
    )
  ) then
    raise exception 'compatibility replay left hostile ACLs';
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
    raise exception 'compatibility replay left helper ACLs';
  end if;
  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'private'
      and function_row.proname like '%\_v7\_core\_v7\_core' escape '\'
  ) then
    raise exception 'compatibility replay nested a private core';
  end if;
end;
$replay_contract$;

rollback;
