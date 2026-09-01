\set ON_ERROR_STOP on

select set_config('request.jwt.claim.role', 'service_role', false);

create temporary table schedule_readiness_replay_catalog_before as
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
  procedure.proargnames,
  procedure.prosrc,
  pg_get_functiondef(procedure.oid) as function_definition
from private.schedule_readiness_manifest_bridge_expected expected
join pg_catalog.pg_proc procedure
  on procedure.oid = to_regprocedure(expected.function_signature)::oid;

create temporary table schedule_readiness_replay_helper_before as
select
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
  procedure.prosrc,
  pg_get_functiondef(procedure.oid) as function_definition
from pg_catalog.pg_proc procedure
where procedure.oid =
  'private.reprove_agent_schedule_readiness_jsonb_for_manifest(jsonb,text,uuid,text,text,text)'::regprocedure;

create temporary table schedule_readiness_replay_output_before as
select
  private.schedule_readiness_runtime_schedule_call(
    '2026-08-22.capability-manifest.v8'
  ) as schedule_result,
  private.schedule_readiness_runtime_readiness_call(
    '2026-08-22.capability-manifest.v8'
  ) as readiness_result;

prepare schedule_v8_prepared as
select public.read_agent_scheduled_jobs_as_system(
  'request:replay-prepared',
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
  'request:replay-prepared',
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

\ir ../../supabase/migrations/20260830130000_agent_schedule_readiness_manifest_bridge.sql

execute schedule_v8_prepared;
execute readiness_v8_prepared;

begin;

do $assert_replay_identity$
declare
  v_mismatch_count integer;
  v_helper_before schedule_readiness_replay_helper_before%rowtype;
begin
  select count(*)
  into v_mismatch_count
  from schedule_readiness_replay_catalog_before before_state
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
     or procedure.proargnames is distinct from before_state.proargnames
     or procedure.prosrc is distinct from before_state.prosrc
     or pg_get_functiondef(procedure.oid) is distinct from
       before_state.function_definition;
  if v_mismatch_count <> 0 then
    raise exception 'replay_function_identity_changed:%', v_mismatch_count;
  end if;

  select * into strict v_helper_before
  from schedule_readiness_replay_helper_before;
  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'private.reprove_agent_schedule_readiness_jsonb_for_manifest(jsonb,text,uuid,text,text,text)'::regprocedure
      and (
        procedure.oid is distinct from v_helper_before.oid
        or procedure.proowner is distinct from v_helper_before.proowner
        or procedure.proacl is distinct from v_helper_before.proacl
        or procedure.proconfig is distinct from v_helper_before.proconfig
        or procedure.prosecdef is distinct from v_helper_before.prosecdef
        or procedure.provolatile is distinct from v_helper_before.provolatile
        or procedure.proparallel is distinct from v_helper_before.proparallel
        or procedure.proisstrict is distinct from v_helper_before.proisstrict
        or procedure.pronargdefaults is distinct from
          v_helper_before.pronargdefaults
        or procedure.proargdefaults::text is distinct from
          v_helper_before.proargdefaults
        or procedure.prosrc is distinct from v_helper_before.prosrc
        or pg_get_functiondef(procedure.oid) is distinct from
          v_helper_before.function_definition
      )
  ) then
    raise exception 'replay_helper_identity_changed';
  end if;
end;
$assert_replay_identity$;

do $assert_replay_output_and_acl$
declare
  v_before schedule_readiness_replay_output_before%rowtype;
  v_bad integer;
begin
  select * into strict v_before
  from schedule_readiness_replay_output_before;
  if private.schedule_readiness_runtime_schedule_call(
       '2026-08-22.capability-manifest.v8'
     ) is distinct from v_before.schedule_result then
    raise exception 'replay_schedule_output_changed';
  end if;
  if private.schedule_readiness_runtime_readiness_call(
       '2026-08-22.capability-manifest.v8'
     ) is distinct from v_before.readiness_result then
    raise exception 'replay_readiness_output_changed';
  end if;

  select count(*)
  into v_bad
  from private.schedule_readiness_manifest_bridge_expected expected
  join pg_catalog.pg_proc procedure
    on procedure.oid = to_regprocedure(expected.function_signature)::oid
  where encode(
    extensions.digest(convert_to(procedure.prosrc, 'UTF8'), 'sha256'),
    'hex'
  ) is distinct from expected.repaired_sha256;
  if v_bad <> 0 then
    raise exception 'replay_repaired_hash_changed:%', v_bad;
  end if;

  if has_function_privilege(
       'anon',
       'private.reprove_agent_schedule_readiness_jsonb_for_manifest(jsonb,text,uuid,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'private.reprove_agent_schedule_readiness_jsonb_for_manifest(jsonb,text,uuid,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'private.reprove_agent_schedule_readiness_jsonb_for_manifest(jsonb,text,uuid,text,text,text)',
       'execute'
     ) then
    raise exception 'replay_helper_acl_widened';
  end if;
  if not has_function_privilege(
       'service_role',
       'public.read_agent_scheduled_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.read_agent_job_readiness_issues_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
       'execute'
     ) then
    raise exception 'replay_public_service_role_acl_lost';
  end if;
end;
$assert_replay_output_and_acl$;

rollback;
