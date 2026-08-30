begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table agent_mcp_scope_set_binding_before
on commit preserve rows as
select
  procedure.oid::regprocedure::text as signature,
  procedure.oid,
  procedure.prosecdef,
  procedure.provolatile,
  procedure.proparallel,
  procedure.proconfig,
  procedure.proacl,
  procedure.proowner,
  extensions.digest(
    pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
    'sha256'
  ) as source_digest
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where namespace.nspname in ('private', 'public')
  and procedure.prosrc like
    '%private.agent_mcp_oauth_scope_sets_equal(%';

create temporary table agent_mcp_scope_set_binding_helper_before
on commit preserve rows as
select
  procedure.oid,
  procedure.prosecdef,
  procedure.provolatile,
  procedure.proisstrict,
  procedure.proparallel,
  procedure.proconfig,
  procedure.proacl,
  procedure.proowner,
  extensions.digest(
    pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
    'sha256'
  ) as source_digest
from pg_catalog.pg_proc procedure
where procedure.oid = pg_catalog.to_regprocedure(
  'private.agent_mcp_oauth_scope_sets_equal(text[],text[])'
)::oid;

commit;

\ir ../../supabase/migrations/20260830120000_agent_mcp_scope_set_binding.sql

begin;

do $replay_contract$
declare
  v_before_count integer;
  v_after_count integer;
  v_helper_count integer;
begin
  select pg_catalog.count(*)::integer into v_before_count
  from agent_mcp_scope_set_binding_before;

  select pg_catalog.count(*)::integer into v_after_count
  from agent_mcp_scope_set_binding_before before_row
  join pg_catalog.pg_proc procedure
    on procedure.oid = before_row.oid
   and procedure.oid::regprocedure::text = before_row.signature
   and procedure.prosecdef is not distinct from before_row.prosecdef
   and procedure.provolatile is not distinct from before_row.provolatile
   and procedure.proparallel is not distinct from before_row.proparallel
   and procedure.proconfig is not distinct from before_row.proconfig
   and procedure.proacl is not distinct from before_row.proacl
   and procedure.proowner is not distinct from before_row.proowner
   and extensions.digest(
     pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
     'sha256'
       ) = before_row.source_digest;

  select pg_catalog.count(*)::integer into v_helper_count
  from agent_mcp_scope_set_binding_helper_before before_row
  join pg_catalog.pg_proc procedure
    on procedure.oid = before_row.oid
   and procedure.prosecdef is not distinct from before_row.prosecdef
   and procedure.provolatile is not distinct from before_row.provolatile
   and procedure.proisstrict is not distinct from before_row.proisstrict
   and procedure.proparallel is not distinct from before_row.proparallel
   and procedure.proconfig is not distinct from before_row.proconfig
   and procedure.proacl is not distinct from before_row.proacl
   and procedure.proowner is not distinct from before_row.proowner
   and extensions.digest(
     pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
     'sha256'
   ) = before_row.source_digest;

  if v_before_count is distinct from 20
     or v_after_count is distinct from v_before_count
     or v_helper_count is distinct from 1 then
    raise exception
      'agent_mcp_scope_set_binding_replay_failed: % -> % helper=%',
      v_before_count,
      v_after_count,
      v_helper_count;
  end if;
end;
$replay_contract$;

drop table agent_mcp_scope_set_binding_before;
drop table agent_mcp_scope_set_binding_helper_before;

rollback;
