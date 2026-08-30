begin;

create temporary table agent_schedule_readiness_manifest_bridge_expected (
  function_signature text primary key,
  v_pre_repair_sha256 text not null,
  v_repaired_sha256 text not null
) on commit drop;

insert into agent_schedule_readiness_manifest_bridge_expected (
  function_signature,
  v_pre_repair_sha256,
  v_repaired_sha256
) values
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

do $agent_schedule_readiness_manifest_bridge_preflight$
declare
  v_expected_function_count constant integer := 6;
  v_found_count integer;
  v_pre_count integer;
  v_repaired_count integer;
begin
  select count(*)
  into v_found_count
  from agent_schedule_readiness_manifest_bridge_expected expected
  where to_regprocedure(expected.function_signature) is not null;

  if v_found_count is distinct from v_expected_function_count then
    raise exception 'agent_schedule_readiness_manifest_bridge_source_drift'
      using errcode = '55000',
        detail = format(
          'expected %s functions, found %s',
          v_expected_function_count,
          v_found_count
        );
  end if;

  select
    count(*) filter (
      where encode(
        extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
        'hex'
      ) = expected.v_pre_repair_sha256
    ),
    count(*) filter (
      where encode(
        extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
        'hex'
      ) = expected.v_repaired_sha256
    )
  into v_pre_count, v_repaired_count
  from agent_schedule_readiness_manifest_bridge_expected expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.function_signature)::oid;

  if v_pre_count <> v_expected_function_count
     and v_repaired_count <> v_expected_function_count then
    raise exception 'agent_schedule_readiness_manifest_bridge_source_drift'
      using errcode = '55000',
        detail = format(
          'expected one complete six-function state; pre=%s repaired=%s',
          v_pre_count,
          v_repaired_count
        );
  end if;
end;
$agent_schedule_readiness_manifest_bridge_preflight$;

create temporary table agent_schedule_readiness_manifest_bridge_catalog_before
on commit drop
as
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
  procedure.prorettype,
  procedure.proretset,
  procedure.prolang,
  procedure.prokind,
  procedure.proleakproof,
  procedure.procost,
  procedure.prorows,
  procedure.proargtypes,
  procedure.proallargtypes,
  procedure.proargmodes,
  procedure.proargnames
from agent_schedule_readiness_manifest_bridge_expected expected
join pg_catalog.pg_proc procedure
  on procedure.oid = to_regprocedure(expected.function_signature)::oid;

do $agent_schedule_readiness_manifest_bridge_helper_preflight$
declare
  v_helper regprocedure := to_regprocedure(
    'private.reprove_agent_schedule_readiness_jsonb_for_manifest(jsonb,text,uuid,text,text,text)'
  );
  v_expected_sha256 constant text :=
    'c809562aa37b4c2532a61acff6fe2131127e270bfa0e1f57ac2ff70b9eb821c9';
  v_current_sha256 text;
begin
  if v_helper is not null then
    select encode(
      extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
      'hex'
    )
    into v_current_sha256
    from pg_catalog.pg_proc procedure
    where procedure.oid = v_helper::oid;

    if v_current_sha256 is distinct from v_expected_sha256 then
      raise exception 'agent_schedule_readiness_manifest_bridge_helper_drift'
        using errcode = '55000';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      where procedure.oid = v_helper::oid
        and (
          procedure.proowner is distinct from (
            select role.oid
            from pg_catalog.pg_roles role
            where role.rolname = current_user
          )
          or procedure.proconfig is distinct from array[
            'search_path=pg_catalog, private, extensions, pg_temp'
          ]::text[]
          or not procedure.prosecdef
          or procedure.provolatile <> 's'
          or procedure.proparallel <> 'u'
          or procedure.proisstrict
          or procedure.pronargdefaults <> 0
          or procedure.prorettype <> 'jsonb'::regtype::oid
          or procedure.proretset
          or procedure.prolang <> (
            select language.oid
            from pg_catalog.pg_language language
            where language.lanname = 'plpgsql'
          )
          or (
            select count(*)
            from pg_catalog.aclexplode(procedure.proacl)
          ) <> 1
          or exists (
            select 1
            from pg_catalog.aclexplode(procedure.proacl) acl
            where acl.grantor <> procedure.proowner
               or acl.grantee <> procedure.proowner
               or acl.privilege_type <> 'EXECUTE'
               or acl.is_grantable
          )
        )
    ) then
      raise exception 'agent_schedule_readiness_manifest_bridge_helper_drift'
        using errcode = '55000';
    end if;
  end if;
end;
$agent_schedule_readiness_manifest_bridge_helper_preflight$;

create or replace function private.reprove_agent_schedule_readiness_jsonb_for_manifest(
  p_result jsonb,
  p_reader_name text,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_source_manifest_revision text,
  p_target_manifest_revision text
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
  v_pass integer;
  v_changed boolean;
  v_manifest_count integer;
  v_proof_count integer;
  v_bound_proof_count integer;
  v_partial_proof_count integer;
  v_forbidden_empty_metadata_count integer;
  v_source_fence jsonb;
  v_is_exact_empty boolean := false;
begin
  if p_result is null
     or jsonb_typeof(p_result) is distinct from 'object'
     or p_reader_name is null
     or p_reader_name not in ('scheduled_jobs', 'job_readiness_issues')
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_source_manifest_revision is null
     or p_target_manifest_revision is null
     or not (
       (
         p_source_manifest_revision = '2026-08-12.capability-manifest.v4'
         and p_target_manifest_revision = '2026-08-14.capability-manifest.v6'
       )
       or (
         p_source_manifest_revision = '2026-08-14.capability-manifest.v6'
         and p_target_manifest_revision = '2026-08-20.capability-manifest.v7'
       )
       or (
         p_source_manifest_revision = '2026-08-20.capability-manifest.v7'
         and p_target_manifest_revision = '2026-08-22.capability-manifest.v8'
       )
     ) then
    raise exception 'invalid_agent_schedule_readiness_manifest_bridge_request'
      using errcode = '22023';
  end if;

  if p_result ->> 'company_id' is distinct from p_company_id::text
     or p_result ->> 'permission_snapshot_revision' is distinct from
       p_permission_snapshot_revision
     or jsonb_typeof(p_result -> 'read_at') is distinct from 'string'
     or p_result ->> 'read_at' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     or jsonb_typeof(p_result -> 'source_fence') is distinct from 'object'
     or jsonb_typeof(p_result -> 'source_versions') is distinct from 'array'
     or jsonb_typeof(p_result -> 'evidence') is distinct from 'array' then
    raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
      using errcode = '22023';
  end if;

  v_source_fence := p_result -> 'source_fence';
  if v_source_fence - array[
       'source_domain', 'source_type', 'source_id', 'version'
     ]::text[] <> '{}'::jsonb
     or not v_source_fence ?& array[
       'source_domain', 'source_type', 'source_id', 'version'
     ]::text[]
     or v_source_fence ->> 'source_domain' is distinct from 'operations'
     or v_source_fence ->> 'source_type' is distinct from
       'operational_read_revision'
     or v_source_fence ->> 'source_id' is distinct from
       'private.agent_operational_read_revisions'
     or jsonb_typeof(v_source_fence -> 'version') is distinct from 'string'
     or v_source_fence ->> 'version' !~ '^revision:[0-9]+$' then
    raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
      using errcode = '22023';
  end if;

  if p_reader_name = 'scheduled_jobs' then
    if not p_result ?& array[
         'company_id', 'permission_snapshot_revision', 'read_at',
         'source_fence', 'company_timezone', 'display_timezone',
         'occurrences', 'occurrence_proofs', 'returned_occurrence_count',
         'next_cursor_claims', 'has_more', 'source_versions', 'evidence'
       ]::text[]
       or p_result - array[
         'company_id', 'permission_snapshot_revision', 'read_at',
         'source_fence', 'company_timezone', 'display_timezone',
         'occurrences', 'occurrence_proofs', 'returned_occurrence_count',
         'next_cursor_claims', 'has_more', 'source_versions', 'evidence'
       ]::text[] <> '{}'::jsonb
       or jsonb_typeof(p_result -> 'company_timezone') is distinct from 'string'
       or jsonb_typeof(p_result -> 'display_timezone') is distinct from 'string'
       or char_length(p_result ->> 'company_timezone') not between 1 and 128
       or char_length(p_result ->> 'display_timezone') not between 1 and 128
       or jsonb_typeof(p_result -> 'occurrences') is distinct from 'array'
       or jsonb_typeof(p_result -> 'occurrence_proofs') is distinct from 'array'
       or jsonb_typeof(p_result -> 'returned_occurrence_count') is distinct from
         'number'
       or jsonb_typeof(p_result -> 'next_cursor_claims') not in ('null', 'object')
       or jsonb_typeof(p_result -> 'has_more') is distinct from 'boolean'
       or (p_result ->> 'returned_occurrence_count') !~ '^[0-9]+$'
       or (p_result ->> 'returned_occurrence_count')::integer is distinct from
         jsonb_array_length(p_result -> 'occurrences')
       or jsonb_array_length(p_result -> 'occurrence_proofs') is distinct from
         jsonb_array_length(p_result -> 'occurrences')
       or jsonb_array_length(p_result -> 'evidence') is distinct from
         jsonb_array_length(p_result -> 'occurrences')
       or jsonb_array_length(p_result -> 'source_versions') is distinct from
         jsonb_array_length(p_result -> 'occurrences') + 1
       or (
         (p_result ->> 'has_more')::boolean
         and jsonb_typeof(p_result -> 'next_cursor_claims') <> 'object'
       )
       or (
         not (p_result ->> 'has_more')::boolean
         and jsonb_typeof(p_result -> 'next_cursor_claims') <> 'null'
       ) then
      raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
        using errcode = '22023';
    end if;
  else
    if not p_result ?& array[
         'company_id', 'permission_snapshot_revision', 'read_at',
         'source_fence', 'candidates', 'scanned_candidate_count',
         'next_scan_cursor_claims', 'scan_has_more', 'source_versions',
         'evidence'
       ]::text[]
       or p_result - array[
         'company_id', 'permission_snapshot_revision', 'read_at',
         'source_fence', 'candidates', 'scanned_candidate_count',
         'next_scan_cursor_claims', 'scan_has_more', 'source_versions',
         'evidence'
       ]::text[] <> '{}'::jsonb
       or jsonb_typeof(p_result -> 'candidates') is distinct from 'array'
       or jsonb_typeof(p_result -> 'scanned_candidate_count') is distinct from
         'number'
       or jsonb_typeof(p_result -> 'next_scan_cursor_claims') not in
         ('null', 'object')
       or jsonb_typeof(p_result -> 'scan_has_more') is distinct from 'boolean'
       or (p_result ->> 'scanned_candidate_count') !~ '^[0-9]+$'
       or (p_result ->> 'scanned_candidate_count')::integer is distinct from
         jsonb_array_length(p_result -> 'candidates')
       or jsonb_array_length(p_result -> 'evidence') is distinct from
         jsonb_array_length(p_result -> 'candidates')
       or jsonb_array_length(p_result -> 'source_versions') is distinct from
         jsonb_array_length(p_result -> 'candidates') + 1
       or (
         (p_result ->> 'scan_has_more')::boolean
         and jsonb_typeof(p_result -> 'next_scan_cursor_claims') <> 'object'
       )
       or (
         not (p_result ->> 'scan_has_more')::boolean
         and jsonb_typeof(p_result -> 'next_scan_cursor_claims') <> 'null'
       ) then
      raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
        using errcode = '22023';
    end if;
  end if;

  if p_reader_name = 'scheduled_jobs' then
    select count(*)
    into v_bound_proof_count
    from jsonb_array_elements(p_result -> 'occurrence_proofs')
      with ordinality proof(value, ordinality)
    join jsonb_array_elements(p_result -> 'occurrences')
      with ordinality occurrence(value, ordinality)
      using (ordinality)
    where jsonb_typeof(proof.value) = 'object'
      and proof.value ?& array[
        'occurrence_ref', 'source_version', 'source_content_hash',
        'evidence_id', 'projection'
      ]::text[]
      and proof.value - array[
        'occurrence_ref', 'source_version', 'source_content_hash',
        'evidence_id', 'projection'
      ]::text[] = '{}'::jsonb
      and jsonb_typeof(proof.value -> 'occurrence_ref') = 'object'
      and proof.value -> 'occurrence_ref' =
        occurrence.value -> 'occurrence_ref'
      and jsonb_typeof(proof.value -> 'source_version') = 'object'
      and jsonb_typeof(proof.value -> 'projection') = 'object'
      and proof.value ->> 'source_content_hash'
        ~ '^sha256:[0-9a-f]{64}$'
      and jsonb_typeof(proof.value -> 'evidence_id') = 'string'
      and proof.value -> 'projection' ->> 'company_id' = p_company_id::text
      and proof.value -> 'projection' ->> 'permission_snapshot_revision' =
        p_permission_snapshot_revision
      and proof.value -> 'projection' ->> 'capability_manifest_revision' =
        p_source_manifest_revision
      and proof.value -> 'projection' -> 'occurrence' = occurrence.value
      and proof.value -> 'source_version' ->> 'source_domain' = 'operations'
      and jsonb_typeof(proof.value -> 'source_version' -> 'source_type') =
        'string'
      and jsonb_typeof(proof.value -> 'source_version' -> 'source_id') =
        'string'
      and right(
        proof.value -> 'source_version' ->> 'version',
        char_length(proof.value ->> 'source_content_hash')
      ) = proof.value ->> 'source_content_hash'
      and exists (
        select 1
        from jsonb_array_elements(p_result -> 'source_versions') source(value)
        where source.value = proof.value -> 'source_version'
      )
      and exists (
        select 1
        from jsonb_array_elements(p_result -> 'evidence') evidence(value)
        where evidence.value ->> 'evidence_id' =
            proof.value ->> 'evidence_id'
          and evidence.value ->> 'source_domain' =
            proof.value -> 'source_version' ->> 'source_domain'
          and evidence.value ->> 'source_type' =
            proof.value -> 'source_version' ->> 'source_type'
          and evidence.value ->> 'source_id' =
            proof.value -> 'source_version' ->> 'source_id'
          and evidence.value ->> 'version' =
            proof.value -> 'source_version' ->> 'version'
      );

    if v_bound_proof_count is distinct from
         jsonb_array_length(p_result -> 'occurrences') then
      raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
        using errcode = '22023';
    end if;
  else
    select count(*)
    into v_bound_proof_count
    from jsonb_array_elements(p_result -> 'candidates') candidate(value)
    cross join lateral (
      select candidate.value -> 'projection_proof' as value
    ) proof
    where jsonb_typeof(candidate.value) = 'object'
      and jsonb_typeof(proof.value) = 'object'
      and proof.value ?& array[
        'source_version', 'source_content_hash', 'evidence_id', 'projection'
      ]::text[]
      and proof.value - array[
        'source_version', 'source_content_hash', 'evidence_id', 'projection'
      ]::text[] = '{}'::jsonb
      and jsonb_typeof(proof.value -> 'source_version') = 'object'
      and jsonb_typeof(proof.value -> 'projection') = 'object'
      and proof.value ->> 'source_content_hash'
        ~ '^sha256:[0-9a-f]{64}$'
      and jsonb_typeof(proof.value -> 'evidence_id') = 'string'
      and proof.value -> 'projection' ->> 'company_id' = p_company_id::text
      and proof.value -> 'projection' ->> 'permission_snapshot_revision' =
        p_permission_snapshot_revision
      and proof.value -> 'projection' ->> 'capability_manifest_revision' =
        p_source_manifest_revision
      and proof.value -> 'projection' -> 'job' -> 'job_ref' =
        candidate.value -> 'job_ref'
      and proof.value -> 'source_version' ->> 'source_domain' = 'operations'
      and jsonb_typeof(proof.value -> 'source_version' -> 'source_type') =
        'string'
      and jsonb_typeof(proof.value -> 'source_version' -> 'source_id') =
        'string'
      and right(
        proof.value -> 'source_version' ->> 'version',
        char_length(proof.value ->> 'source_content_hash')
      ) = proof.value ->> 'source_content_hash'
      and exists (
        select 1
        from jsonb_array_elements(p_result -> 'source_versions') source(value)
        where source.value = proof.value -> 'source_version'
      )
      and exists (
        select 1
        from jsonb_array_elements(p_result -> 'evidence') evidence(value)
        where evidence.value ->> 'evidence_id' =
            proof.value ->> 'evidence_id'
          and evidence.value ->> 'source_domain' =
            proof.value -> 'source_version' ->> 'source_domain'
          and evidence.value ->> 'source_type' =
            proof.value -> 'source_version' ->> 'source_type'
          and evidence.value ->> 'source_id' =
            proof.value -> 'source_version' ->> 'source_id'
          and evidence.value ->> 'version' =
            proof.value -> 'source_version' ->> 'version'
      );

    if v_bound_proof_count is distinct from
         jsonb_array_length(p_result -> 'candidates') then
      raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
        using errcode = '22023';
    end if;
  end if;

  select
    count(*) filter (where object_value ? 'capability_manifest_revision'),
    count(*) filter (
      where jsonb_typeof(object_value -> 'projection') = 'object'
        and object_value ->> 'source_content_hash' ~ '^sha256:[0-9a-f]{64}$'
    ),
    count(*) filter (
      where (
        object_value ? 'projection' or object_value ? 'source_content_hash'
      )
      and not (
        jsonb_typeof(object_value -> 'projection') = 'object'
        and object_value ->> 'source_content_hash' ~ '^sha256:[0-9a-f]{64}$'
      )
    ),
    count(*) filter (
      where object_value ?| array[
        'capability_manifest_revision', 'projection',
        'source_content_hash', 'evidence_id'
      ]::text[]
    )
  into
    v_manifest_count,
    v_proof_count,
    v_partial_proof_count,
    v_forbidden_empty_metadata_count
  from private.agent_jsonb_objects(p_result) object_value;

  if v_manifest_count = 0 then
    if p_result -> 'source_versions' is distinct from
         jsonb_build_array(v_source_fence)
       or v_proof_count <> 0
       or v_partial_proof_count <> 0
       or v_forbidden_empty_metadata_count <> 0 then
      raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
        using errcode = '22023';
    end if;

    if p_reader_name = 'scheduled_jobs' then
      v_is_exact_empty :=
        p_result -> 'occurrences' = '[]'::jsonb
        and p_result -> 'occurrence_proofs' = '[]'::jsonb
        and p_result -> 'returned_occurrence_count' = '0'::jsonb
        and p_result -> 'next_cursor_claims' = 'null'::jsonb
        and p_result -> 'has_more' = 'false'::jsonb
        and p_result -> 'evidence' = '[]'::jsonb;
    else
      v_is_exact_empty :=
        p_result -> 'candidates' = '[]'::jsonb
        and p_result -> 'scanned_candidate_count' = '0'::jsonb
        and p_result -> 'next_scan_cursor_claims' = 'null'::jsonb
        and p_result -> 'scan_has_more' = 'false'::jsonb
        and p_result -> 'evidence' = '[]'::jsonb;
    end if;

    if not v_is_exact_empty then
      raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
        using errcode = '22023';
    end if;
    return p_result;
  end if;

  if exists (
       select 1
       from private.agent_jsonb_objects(p_result) object_value
       where object_value ? 'capability_manifest_revision'
         and object_value ->> 'capability_manifest_revision' is distinct from
           p_source_manifest_revision
     )
     or v_proof_count = 0
     or v_proof_count <> v_bound_proof_count
     or v_partial_proof_count <> 0
     or exists (
       select 1
       from private.agent_jsonb_objects(p_result) object_value
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
    raise exception 'invalid_agent_schedule_readiness_manifest_bridge_source'
      using errcode = '22023';
  end if;

  v_result := private.agent_set_jsonb_key_recursive(
    p_result,
    'capability_manifest_revision',
    to_jsonb(p_target_manifest_revision)
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
    raise exception 'agent_schedule_readiness_manifest_reproof_depth_exceeded'
      using errcode = '54000';
  end if;

  if exists (
    select 1
    from private.agent_jsonb_objects(v_result) object_value
    where object_value ? 'capability_manifest_revision'
      and object_value ->> 'capability_manifest_revision' is distinct from
        p_target_manifest_revision
  ) or exists (
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
    raise exception 'invalid_agent_schedule_readiness_manifest_bridge_result'
      using errcode = '22023';
  end if;

  return v_result;
end;
$function$;

revoke all on function private.reprove_agent_schedule_readiness_jsonb_for_manifest(
  jsonb, text, uuid, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.read_agent_scheduled_jobs_as_system_v6_core(
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
  return private.reprove_agent_schedule_readiness_jsonb_for_manifest(
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
    'scheduled_jobs',
    p_company_id,
    p_permission_snapshot_revision,
    '2026-08-12.capability-manifest.v4',
    p_capability_manifest_revision
  );
end;
$function$;

create or replace function private.read_agent_job_readiness_issues_as_system_v6_core(
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
  return private.reprove_agent_schedule_readiness_jsonb_for_manifest(
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
    'job_readiness_issues',
    p_company_id,
    p_permission_snapshot_revision,
    '2026-08-12.capability-manifest.v4',
    p_capability_manifest_revision
  );
end;
$function$;

create or replace function private.read_agent_scheduled_jobs_as_system_v7_core(
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
  return private.reprove_agent_schedule_readiness_jsonb_for_manifest(
    v_v6_result,
    'scheduled_jobs',
    p_company_id,
    p_permission_snapshot_revision,
    '2026-08-14.capability-manifest.v6',
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$;

create or replace function private.read_agent_job_readiness_issues_as_system_v7_core(
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
  return private.reprove_agent_schedule_readiness_jsonb_for_manifest(
    v_v6_result,
    'job_readiness_issues',
    p_company_id,
    p_permission_snapshot_revision,
    '2026-08-14.capability-manifest.v6',
    '2026-08-20.capability-manifest.v7'
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
  return private.reprove_agent_schedule_readiness_jsonb_for_manifest(
    v_result,
    'scheduled_jobs',
    p_company_id,
    p_permission_snapshot_revision,
    '2026-08-20.capability-manifest.v7',
    '2026-08-22.capability-manifest.v8'
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
  return private.reprove_agent_schedule_readiness_jsonb_for_manifest(
    v_result,
    'job_readiness_issues',
    p_company_id,
    p_permission_snapshot_revision,
    '2026-08-20.capability-manifest.v7',
    '2026-08-22.capability-manifest.v8'
  );
end;
$function$;

do $agent_schedule_readiness_manifest_bridge_postflight$
declare
  v_expected_function_count constant integer := 6;
  v_repaired_count integer;
  v_catalog_mismatch_count integer;
  v_helper_sha256 text;
begin
  select count(*)
  into v_repaired_count
  from agent_schedule_readiness_manifest_bridge_expected expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.function_signature)::oid
  where encode(
    extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
    'hex'
  ) = expected.v_repaired_sha256;

  if v_repaired_count is distinct from v_expected_function_count then
    raise exception 'agent_schedule_readiness_manifest_bridge_repair_drift'
      using errcode = '55000',
        detail = format(
          'expected %s repaired functions, found %s',
          v_expected_function_count,
          v_repaired_count
        );
  end if;

  select count(*)
  into v_catalog_mismatch_count
  from agent_schedule_readiness_manifest_bridge_catalog_before before_state
  join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(before_state.function_signature)::oid
  where procedure.oid is distinct from before_state.oid
     or procedure.proowner is distinct from before_state.proowner
     or procedure.proacl is distinct from before_state.proacl
     or procedure.proconfig is distinct from before_state.proconfig
     or procedure.prosecdef is distinct from before_state.prosecdef
     or procedure.provolatile is distinct from before_state.provolatile
     or procedure.proparallel is distinct from before_state.proparallel
     or procedure.proisstrict is distinct from before_state.proisstrict
     or procedure.pronargdefaults is distinct from before_state.pronargdefaults
     or procedure.proargdefaults::text is distinct from
       before_state.proargdefaults
     or procedure.prorettype is distinct from before_state.prorettype
     or procedure.proretset is distinct from before_state.proretset
     or procedure.prolang is distinct from before_state.prolang
     or procedure.prokind is distinct from before_state.prokind
     or procedure.proleakproof is distinct from before_state.proleakproof
     or procedure.procost is distinct from before_state.procost
     or procedure.prorows is distinct from before_state.prorows
     or procedure.proargtypes is distinct from before_state.proargtypes
     or procedure.proallargtypes is distinct from before_state.proallargtypes
     or procedure.proargmodes is distinct from before_state.proargmodes
     or procedure.proargnames is distinct from before_state.proargnames;

  if v_catalog_mismatch_count <> 0 then
    raise exception 'agent_schedule_readiness_manifest_bridge_catalog_drift'
      using errcode = '55000',
        detail = format(
          'catalog identity changed for %s repaired functions',
          v_catalog_mismatch_count
        );
  end if;

  select encode(
    extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
    'hex'
  )
  into v_helper_sha256
  from pg_catalog.pg_proc procedure
  where procedure.oid = to_regprocedure(
    'private.reprove_agent_schedule_readiness_jsonb_for_manifest(jsonb,text,uuid,text,text,text)'
  )::oid;

  if v_helper_sha256 is distinct from
       'c809562aa37b4c2532a61acff6fe2131127e270bfa0e1f57ac2ff70b9eb821c9' then
    raise exception 'agent_schedule_readiness_manifest_bridge_helper_drift'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = to_regprocedure(
      'private.reprove_agent_schedule_readiness_jsonb_for_manifest(jsonb,text,uuid,text,text,text)'
    )::oid
      and (
        procedure.proowner is distinct from (
          select role.oid
          from pg_catalog.pg_roles role
          where role.rolname = current_user
        )
        or procedure.proconfig is distinct from array[
          'search_path=pg_catalog, private, extensions, pg_temp'
        ]::text[]
        or not procedure.prosecdef
        or procedure.provolatile <> 's'
        or procedure.proparallel <> 'u'
        or procedure.proisstrict
        or procedure.pronargdefaults <> 0
        or procedure.prorettype <> 'jsonb'::regtype::oid
        or procedure.proretset
        or procedure.prolang <> (
          select language.oid
          from pg_catalog.pg_language language
          where language.lanname = 'plpgsql'
        )
        or (
          select count(*)
          from pg_catalog.aclexplode(procedure.proacl)
        ) <> 1
        or exists (
          select 1
          from pg_catalog.aclexplode(procedure.proacl) acl
          where acl.grantor <> procedure.proowner
             or acl.grantee <> procedure.proowner
             or acl.privilege_type <> 'EXECUTE'
             or acl.is_grantable
        )
      )
  ) then
    raise exception 'agent_schedule_readiness_manifest_bridge_helper_catalog_drift'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges privilege
    where privilege.specific_schema = 'private'
      and privilege.routine_name =
        'reprove_agent_schedule_readiness_jsonb_for_manifest'
      and privilege.grantee in (
        'PUBLIC', 'anon', 'authenticated', 'service_role'
      )
  ) then
    raise exception 'agent_schedule_readiness_manifest_bridge_helper_acl_drift'
      using errcode = '55000';
  end if;
end;
$agent_schedule_readiness_manifest_bridge_postflight$;

commit;
