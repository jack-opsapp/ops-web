begin;

-- OPS database identifiers are PostgreSQL UUIDs, not RFC-4122-only UUIDs.
-- Repair the five live readers that still rejected lowercase, hyphenated UUID
-- values outside the RFC version/variant bit ranges. OAuth and generated
-- security identifiers are intentionally outside this migration.
create temporary table agent_mcp_postgres_uuid_expected (
  function_signature text primary key,
  pre_repair_sha256 text not null,
  repaired_sha256 text not null,
  expected_language text not null,
  expected_volatility text not null,
  expected_parallel text not null,
  expected_strict boolean not null
) on commit drop;

insert into agent_mcp_postgres_uuid_expected values
  (
    'private.agent_p2_artifact_uuid_from_text(text)',
    '48d15f514a373f82383ae2420d9bcd954779ed64767fc00642f39215215f9ef1',
    'e2c96b890d1bc177e98d41fb37f5e61984e119748bc0af9fcbecf7e538b75d0b',
    'plpgsql', 'i', 's', true
  ),
  (
    'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)',
    '86526189cfaf71651b50d6674e39349fe352ee9e07b0a07e74977ca63f09d56b',
    'd0abb4ffaf4e4fa2ac8f1792a638d20a497c5281e6643ca40b1931712438bf37',
    'plpgsql', 's', 'u', false
  ),
  (
    'private.agent_p2_site_visit_uuid_from_text(text)',
    'e9ac3c956899a2863610d192e6337dc67f86d92c927ef758737382b8223ec49c',
    '544740a9bb867d32e86995763b24a354db24a12587908c965a0e62dd3d3d3c00',
    'sql', 'i', 's', true
  ),
  (
    'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
    '14030ad081001e06bf3fa5a9779fa8afd3bdd29870643d90e90ba587adf82cc7',
    '1165e4f9235529c2796fdd8ca9a015b97ffce86fa8669096ca570ddaba588a80',
    'plpgsql', 's', 'u', false
  ),
  (
    'private.agent_p2_task_uuid_from_text(text)',
    '48d15f514a373f82383ae2420d9bcd954779ed64767fc00642f39215215f9ef1',
    'e2c96b890d1bc177e98d41fb37f5e61984e119748bc0af9fcbecf7e538b75d0b',
    'plpgsql', 'i', 's', true
  );

create temporary table agent_mcp_postgres_uuid_replacements (
  function_signature text primary key references
    agent_mcp_postgres_uuid_expected(function_signature),
  old_fragment text not null,
  new_fragment text not null,
  expected_replacement_count integer not null
) on commit drop;

insert into agent_mcp_postgres_uuid_replacements values
  (
    'private.agent_p2_artifact_uuid_from_text(text)',
$old_artifact$if p_value !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'$old_artifact$,
$new_artifact$if p_value !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$new_artifact$,
    1
  ),
  (
    'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)',
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    1
  ),
  (
    'private.agent_p2_site_visit_uuid_from_text(text)',
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    1
  ),
  (
    'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    4
  ),
  (
    'private.agent_p2_task_uuid_from_text(text)',
$old_task$if p_value !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'$old_task$,
$new_task$if p_value !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$new_task$,
    1
  );

-- These three public wrappers and their v7 cores are part of the same data-ID
-- boundary, but the current immutable wave contains no RFC-only gates in
-- their live definitions. Seal that absence instead of manufacturing rewrites.
create temporary table agent_mcp_postgres_uuid_prefixed_evidence_guards (
  function_signature text primary key
) on commit drop;

insert into agent_mcp_postgres_uuid_prefixed_evidence_guards values
  ('private.read_agent_correspondence_evidence_page_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)'),
  ('private.read_agent_job_conversation_context_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'),
  ('private.read_agent_job_history_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)'),
  ('public.read_agent_correspondence_evidence_page_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)'),
  ('public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'),
  ('public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)');

create temporary table agent_mcp_postgres_uuid_before
on commit drop
as
with protected_function(function_signature) as (
  select expected.function_signature
  from agent_mcp_postgres_uuid_expected expected
  union all
  select guard.function_signature
  from agent_mcp_postgres_uuid_prefixed_evidence_guards guard
)
select
  protected_function.function_signature,
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
  procedure.proargnames,
  extensions.digest(
    pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
  ) as source_digest
from protected_function
join pg_catalog.pg_proc procedure
  on procedure.oid = pg_catalog.to_regprocedure(
    protected_function.function_signature
  )::oid;

do $repair_agent_mcp_postgres_uuid$
declare
  v_expected_function_count constant integer := 5;
  v_expected_guard_count constant integer := 6;
  v_expected_owner oid := (
    select role.oid
    from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
  v_function record;
  v_replacement record;
  v_function_oid oid;
  v_source_sha256 text;
  v_definition text;
  v_repaired_definition text;
  v_old_count integer;
  v_new_count integer;
begin
  if (select pg_catalog.count(*) from
        agent_mcp_postgres_uuid_expected) is distinct from
       v_expected_function_count::bigint
     or (select pg_catalog.count(*) from
        agent_mcp_postgres_uuid_replacements) is distinct from
       v_expected_function_count::bigint
     or (select pg_catalog.count(*) from
        agent_mcp_postgres_uuid_prefixed_evidence_guards) is distinct from
       v_expected_guard_count::bigint
     or (select pg_catalog.count(*) from
        agent_mcp_postgres_uuid_before) is distinct from
       (v_expected_function_count + v_expected_guard_count)::bigint
     or exists (
       select 1
       from agent_mcp_postgres_uuid_expected expected
       where expected.pre_repair_sha256 !~ '^[0-9a-f]{64}$'
          or expected.repaired_sha256 !~ '^[0-9a-f]{64}$'
          or expected.pre_repair_sha256 = expected.repaired_sha256
          or expected.expected_language not in ('plpgsql', 'sql')
          or expected.expected_volatility not in ('i', 's')
          or expected.expected_parallel not in ('s', 'u')
     )
     or exists (
       select 1
       from agent_mcp_postgres_uuid_replacements replacement
       where replacement.old_fragment = replacement.new_fragment
          or replacement.expected_replacement_count <= 0
     ) then
    raise exception 'agent_mcp_postgres_uuid_registry_invalid'
      using errcode = '55000';
  end if;

  for v_function in
    select *
    from agent_mcp_postgres_uuid_expected
    order by function_signature collate "C"
  loop
    v_function_oid := pg_catalog.to_regprocedure(
      v_function.function_signature
    )::oid;
    select pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
             ),
             'hex'
           ),
           pg_catalog.pg_get_functiondef(procedure.oid)
      into strict v_source_sha256, v_definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_language language
      on language.oid = procedure.prolang
    where procedure.oid = v_function_oid
      and namespace.nspname = 'private'
      and language.lanname = v_function.expected_language
      and not procedure.prosecdef
      and procedure.provolatile::text = v_function.expected_volatility
      and procedure.proparallel::text = v_function.expected_parallel
      and procedure.proisstrict = v_function.expected_strict
      and procedure.proconfig is not distinct from
            array['search_path=""']::text[]
      and procedure.proowner = v_expected_owner
      and not pg_catalog.has_function_privilege(
        'anon', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      );

    if v_source_sha256 = v_function.pre_repair_sha256 then
      select *
        into strict v_replacement
      from agent_mcp_postgres_uuid_replacements replacement
      where replacement.function_signature = v_function.function_signature;

      v_old_count := (
        pg_catalog.length(v_definition) - pg_catalog.length(
          pg_catalog.replace(v_definition, v_replacement.old_fragment, '')
        )
      ) / pg_catalog.length(v_replacement.old_fragment);
      v_new_count := (
        pg_catalog.length(v_definition) - pg_catalog.length(
          pg_catalog.replace(v_definition, v_replacement.new_fragment, '')
        )
      ) / pg_catalog.length(v_replacement.new_fragment);
      if v_old_count is distinct from
           v_replacement.expected_replacement_count
         or v_new_count is distinct from 0 then
        raise exception
          'agent_mcp_postgres_uuid_replacement_count: % old=% new=%',
          v_function.function_signature, v_old_count, v_new_count
          using errcode = '55000';
      end if;

      v_repaired_definition := pg_catalog.replace(
        v_definition,
        v_replacement.old_fragment,
        v_replacement.new_fragment
      );
      if v_repaired_definition is not distinct from v_definition then
        raise exception 'agent_mcp_postgres_uuid_rewrite_failed: %',
          v_function.function_signature using errcode = '55000';
      end if;
      execute v_repaired_definition;
    elsif v_source_sha256 = v_function.repaired_sha256 then
      null;
    else
      raise exception 'agent_mcp_postgres_uuid_source_drift: % %',
        v_function.function_signature, v_source_sha256
        using errcode = '55000';
    end if;
  end loop;
end;
$repair_agent_mcp_postgres_uuid$;

do $agent_mcp_postgres_uuid_postcondition$
declare
  v_expected_function_count constant integer := 5;
  v_expected_guard_count constant integer := 6;
  v_repaired_count integer;
  v_metadata_count integer;
  v_fragment_count integer;
  v_guard_count integer;
  v_guard_source_count integer;
begin
  select pg_catalog.count(*)::integer
    into v_repaired_count
  from agent_mcp_postgres_uuid_expected expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(
      expected.function_signature
    )::oid
  where pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
          ),
          'hex'
        ) = expected.repaired_sha256;

  select pg_catalog.count(*)::integer
    into v_metadata_count
  from agent_mcp_postgres_uuid_before before_row
  join pg_catalog.pg_proc procedure
    on procedure.oid = before_row.oid
   and procedure.proowner is not distinct from before_row.proowner
   and procedure.proacl is not distinct from before_row.proacl
   and procedure.proconfig is not distinct from before_row.proconfig
   and procedure.prosecdef is not distinct from before_row.prosecdef
   and procedure.provolatile is not distinct from before_row.provolatile
   and procedure.proparallel is not distinct from before_row.proparallel
   and procedure.proisstrict is not distinct from before_row.proisstrict
   and procedure.pronargdefaults is not distinct from
       before_row.pronargdefaults
   and procedure.proargdefaults::text is not distinct from
       before_row.proargdefaults
   and procedure.prorettype is not distinct from before_row.prorettype
   and procedure.proretset is not distinct from before_row.proretset
   and procedure.prolang is not distinct from before_row.prolang
   and procedure.prokind is not distinct from before_row.prokind
   and procedure.proleakproof is not distinct from before_row.proleakproof
   and procedure.procost is not distinct from before_row.procost
   and procedure.prorows is not distinct from before_row.prorows
   and procedure.proargtypes is not distinct from before_row.proargtypes
   and procedure.proallargtypes is not distinct from before_row.proallargtypes
   and procedure.proargmodes is not distinct from before_row.proargmodes
   and procedure.proargnames is not distinct from before_row.proargnames;

  select pg_catalog.count(*)::integer
    into v_fragment_count
  from agent_mcp_postgres_uuid_replacements replacement
  join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(
      replacement.function_signature
    )::oid
  where procedure.prosrc like '%' || replacement.new_fragment || '%'
    and procedure.prosrc not like '%' || replacement.old_fragment || '%';

  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (
           where extensions.digest(
             pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
           ) = before_row.source_digest
         )::integer
    into v_guard_count, v_guard_source_count
  from agent_mcp_postgres_uuid_prefixed_evidence_guards guard
  join agent_mcp_postgres_uuid_before before_row
    on before_row.function_signature = guard.function_signature
  join pg_catalog.pg_proc procedure
    on procedure.oid = before_row.oid
  where procedure.prosrc not like '%[1-5][0-9a-f]{3}%'
    and procedure.prosrc not like '%[1-8][0-9a-f]{3}%'
    and procedure.prosrc not like '%[89ab][0-9a-f]{3}%';

  if v_repaired_count is distinct from v_expected_function_count
     or v_metadata_count is distinct from
        v_expected_function_count + v_expected_guard_count
     or v_fragment_count is distinct from v_expected_function_count
     or v_guard_count is distinct from v_expected_guard_count
     or v_guard_source_count is distinct from v_expected_guard_count then
    raise exception
      'agent_mcp_postgres_uuid_prefixed_evidence_gate: repaired=% metadata=% fragments=% guards=% guard_sources=%',
      v_repaired_count, v_metadata_count, v_fragment_count,
      v_guard_count, v_guard_source_count
      using errcode = '55000';
  end if;
end;
$agent_mcp_postgres_uuid_postcondition$;

commit;
