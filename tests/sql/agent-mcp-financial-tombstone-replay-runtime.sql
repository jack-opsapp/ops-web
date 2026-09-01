\set ON_ERROR_STOP on

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table agent_mcp_financial_tombstone_replay_before
on commit preserve rows as
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
from pg_catalog.pg_proc procedure
where procedure.oid in (
  'private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)'::regprocedure,
  'private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)'::regprocedure
);

commit;

\ir ../../supabase/migrations/20260830150000_agent_mcp_financial_tombstones.sql

begin;

do $replay_contract$
declare
  v_before_count integer;
  v_after_count integer;
begin
  select pg_catalog.count(*)::integer into v_before_count
  from agent_mcp_financial_tombstone_replay_before;

  select pg_catalog.count(*)::integer into v_after_count
  from agent_mcp_financial_tombstone_replay_before before_row
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

  if v_before_count is distinct from 2
     or v_after_count is distinct from v_before_count then
    raise exception
      'agent_mcp_financial_tombstone_replay_failed: % -> %',
      v_before_count, v_after_count;
  end if;
end;
$replay_contract$;

drop table agent_mcp_financial_tombstone_replay_before;

rollback;
