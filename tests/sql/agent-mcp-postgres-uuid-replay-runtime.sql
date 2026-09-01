\set ON_ERROR_STOP on

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table agent_mcp_postgres_uuid_replay_before
on commit preserve rows as
with protected_function(function_signature) as (values
  ('private.agent_p2_artifact_uuid_from_text(text)'),
  ('private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)'),
  ('private.agent_p2_site_visit_uuid_from_text(text)'),
  ('private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)'),
  ('private.agent_p2_task_uuid_from_text(text)'),
  ('private.read_agent_correspondence_evidence_page_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)'),
  ('private.read_agent_job_conversation_context_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'),
  ('private.read_agent_job_history_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)'),
  ('public.read_agent_correspondence_evidence_page_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)'),
  ('public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'),
  ('public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)')
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

commit;

\ir ../../supabase/migrations/20260830160000_agent_mcp_postgres_uuid_compatibility.sql

begin;

do $agent_mcp_postgres_uuid_replay$
declare
  v_before_count integer;
  v_after_count integer;
  v_guard_count integer;
begin
  select pg_catalog.count(*)::integer into v_before_count
  from agent_mcp_postgres_uuid_replay_before;

  select pg_catalog.count(*)::integer into v_after_count
  from agent_mcp_postgres_uuid_replay_before before_row
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
   and procedure.proargnames is not distinct from before_row.proargnames
   and extensions.digest(
     pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
   ) = before_row.source_digest;

  select pg_catalog.count(*)::integer into v_guard_count
  from agent_mcp_postgres_uuid_replay_before before_row
  join pg_catalog.pg_proc procedure
    on procedure.oid = before_row.oid
  where before_row.function_signature in (
      'private.read_agent_correspondence_evidence_page_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)',
      'private.read_agent_job_conversation_context_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)',
      'private.read_agent_job_history_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)',
      'public.read_agent_correspondence_evidence_page_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)',
      'public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)',
      'public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,bigint,bigint,timestamp with time zone,text,text,integer)'
    )
    and procedure.prosrc not like '%[1-5][0-9a-f]{3}%'
    and procedure.prosrc not like '%[1-8][0-9a-f]{3}%'
    and procedure.prosrc not like '%[89ab][0-9a-f]{3}%';

  if v_before_count is distinct from 11
     or v_after_count is distinct from v_before_count
     or v_guard_count is distinct from 6 then
    raise exception
      'agent_mcp_postgres_uuid_replay_failed: % -> %, guards=%',
      v_before_count, v_after_count, v_guard_count;
  end if;
end;
$agent_mcp_postgres_uuid_replay$;

drop table agent_mcp_postgres_uuid_replay_before;

rollback;
