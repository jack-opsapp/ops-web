begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

create temporary table agent_mcp_scope_canonical_order_replay_before
on commit preserve rows as
select
  procedure.oid,
  procedure.proowner,
  procedure.proacl,
  procedure.proconfig,
  procedure.prosecdef,
  procedure.provolatile,
  procedure.proparallel,
  extensions.digest(
    pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
    'sha256'
  ) as source_digest
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace
  on namespace.oid = procedure.pronamespace
where (
    namespace.nspname = 'private'
    and procedure.proname in (
      'agent_p2_availability_summary_v1',
      'agent_p2_catalog_read_context_v1',
      'agent_p2_company_summary_v1',
      'agent_p2_customer_summary_v1',
      'agent_p2_deck_design_geometry_v1',
      'agent_p2_expense_read_context_v1',
      'agent_p2_integration_health_summary_v1',
      'agent_p2_payment_read_context_v1',
      'agent_p2_sales_read_context_v1',
      'agent_p2_site_visit_context_v1',
      'agent_p2_site_visit_list_v1',
      'agent_p2_task_context_v1',
      'agent_p2_task_list_v1',
      'agent_p2_team_summary_v1'
    )
  ) or (
    namespace.nspname = 'public'
    and procedure.proname in (
      'read_agent_company_context_as_system',
      'read_agent_customer_context_as_system'
    )
  );

commit;

\ir ../../supabase/migrations/20260830140000_agent_mcp_scope_canonical_order.sql

begin;

do $replay_contract$
declare
  v_before_count integer;
  v_after_count integer;
begin
  select pg_catalog.count(*)::integer into v_before_count
  from agent_mcp_scope_canonical_order_replay_before;

  select pg_catalog.count(*)::integer into v_after_count
  from agent_mcp_scope_canonical_order_replay_before before_row
  join pg_catalog.pg_proc procedure
    on procedure.oid = before_row.oid
   and procedure.proowner is not distinct from before_row.proowner
   and procedure.proacl is not distinct from before_row.proacl
   and procedure.proconfig is not distinct from before_row.proconfig
   and procedure.prosecdef is not distinct from before_row.prosecdef
   and procedure.provolatile is not distinct from before_row.provolatile
   and procedure.proparallel is not distinct from before_row.proparallel
   and extensions.digest(
     pg_catalog.convert_to(procedure.prosrc, 'UTF8'),
     'sha256'
   ) = before_row.source_digest;

  if v_before_count is distinct from 16
     or v_after_count is distinct from v_before_count then
    raise exception
      'agent_mcp_scope_canonical_order_replay_failed: % -> %',
      v_before_count,
      v_after_count;
  end if;
end;
$replay_contract$;

drop table agent_mcp_scope_canonical_order_replay_before;

rollback;
