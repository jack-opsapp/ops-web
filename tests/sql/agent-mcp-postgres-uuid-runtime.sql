\set ON_ERROR_STOP on

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $agent_mcp_postgres_uuid_runtime$
declare
  v_postgres_uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_value text;
  v_source_invalid text;
  v_target_count integer;
  v_guard_count integer;
begin
  select pg_catalog.count(*)::integer
    into v_target_count
  from (values
    (
      'private.agent_p2_artifact_uuid_from_text(text)',
      'e2c96b890d1bc177e98d41fb37f5e61984e119748bc0af9fcbecf7e538b75d0b',
      1
    ),
    (
      'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)',
      'd0abb4ffaf4e4fa2ac8f1792a638d20a497c5281e6643ca40b1931712438bf37',
      1
    ),
    (
      'private.agent_p2_site_visit_uuid_from_text(text)',
      '544740a9bb867d32e86995763b24a354db24a12587908c965a0e62dd3d3d3c00',
      1
    ),
    (
      'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
      '1165e4f9235529c2796fdd8ca9a015b97ffce86fa8669096ca570ddaba588a80',
      4
    ),
    (
      'private.agent_p2_task_uuid_from_text(text)',
      'e2c96b890d1bc177e98d41fb37f5e61984e119748bc0af9fcbecf7e538b75d0b',
      1
    )
  ) expected(function_signature, repaired_sha256, broad_pattern_count)
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(
      expected.function_signature
    )::oid
  where pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
          ),
          'hex'
        ) = expected.repaired_sha256
    and (
      pg_catalog.length(procedure.prosrc) - pg_catalog.length(
        pg_catalog.replace(procedure.prosrc, v_postgres_uuid_pattern, '')
      )
    ) / pg_catalog.length(v_postgres_uuid_pattern) =
        expected.broad_pattern_count
    and procedure.prosrc not like '%[1-5][0-9a-f]{3}%'
    and procedure.prosrc not like '%[1-8][0-9a-f]{3}%'
    and procedure.prosrc not like '%[89ab][0-9a-f]{3}%';

  if v_target_count is distinct from 5 then
    raise exception 'agent_mcp_postgres_uuid_runtime_source_invalid: %',
      v_target_count;
  end if;

  foreach v_value in array array[
    'd3000000-0000-4000-d300-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff'
  ]::text[] loop
    if private.agent_p2_artifact_uuid_from_text(v_value) is distinct from
         v_value::uuid
       or private.agent_p2_site_visit_uuid_from_text(v_value) is distinct from
          v_value::uuid
       or private.agent_p2_task_uuid_from_text(v_value) is distinct from
          v_value::uuid then
      raise exception 'agent_mcp_postgres_uuid_runtime_non_rfc_rejected: %',
        v_value;
    end if;
  end loop;

  foreach v_source_invalid in array array[
    'D3000000-0000-4000-D300-000000000003',
    'd3000000-0000-4000-d300-00000000003'
  ]::text[] loop
    if private.agent_p2_artifact_uuid_from_text(v_source_invalid) is not null
       or private.agent_p2_site_visit_uuid_from_text(v_source_invalid) is not null
       or private.agent_p2_task_uuid_from_text(v_source_invalid) is not null then
      raise exception 'agent_mcp_postgres_uuid_runtime_source_invalid: %',
        v_source_invalid;
    end if;
  end loop;

  if pg_catalog.substr(
       'job_conversation_turn:d3000000-0000-4000-d300-000000000003',
       pg_catalog.length('job_conversation_turn:') + 1
     ) !~ v_postgres_uuid_pattern
     or pg_catalog.substr(
       'email_attachment:d3000000-0000-4000-d300-000000000003',
       pg_catalog.length('email_attachment:') + 1
     ) !~ v_postgres_uuid_pattern
     or pg_catalog.substr(
       'job_conversation_turn:D3000000-0000-4000-D300-000000000003',
       pg_catalog.length('job_conversation_turn:') + 1
     ) ~ v_postgres_uuid_pattern
     or pg_catalog.substr(
       'email_attachment:d3000000-0000-4000-d300-00000000003',
       pg_catalog.length('email_attachment:') + 1
     ) ~ v_postgres_uuid_pattern then
    raise exception 'agent_mcp_postgres_uuid_runtime_prefixed_source_invalid';
  end if;

  select pg_catalog.count(*)::integer
    into v_guard_count
  from (values
    ('private.read_agent_correspondence_evidence_page_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)'),
    ('private.read_agent_job_conversation_context_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'),
    ('private.read_agent_job_history_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)'),
    ('public.read_agent_correspondence_evidence_page_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)'),
    ('public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'),
    ('public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)')
  ) guard(function_signature)
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(
      guard.function_signature
    )::oid
  where procedure.prosrc not like '%[1-5][0-9a-f]{3}%'
    and procedure.prosrc not like '%[1-8][0-9a-f]{3}%'
    and procedure.prosrc not like '%[89ab][0-9a-f]{3}%';

  if v_guard_count is distinct from 6 then
    raise exception 'agent_mcp_postgres_uuid_prefixed_evidence_gate: %',
      v_guard_count;
  end if;
end;
$agent_mcp_postgres_uuid_runtime$;

rollback;
