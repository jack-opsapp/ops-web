begin;

\set ON_ERROR_STOP on

grant select on table private.agent_mcp_evidence_redemptions
  to pg_monitor with grant option;
grant execute on function private.prune_agent_mcp_evidence_redemptions(integer)
  to pg_monitor with grant option;
grant execute on function public.redeem_agent_mcp_evidence_as_system(
  text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],
  jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamptz,timestamptz
) to pg_monitor with grant option;

\ir ../../supabase/migrations/20260823072849_agent_mcp_evidence_nonce_ledger.sql
\ir ../../supabase/migrations/20260829013804_agent_mcp_evidence_redemption_rpc.sql

begin;

do $replay_contract$
declare
  v_public_signature constant text :=
    'public.redeem_agent_mcp_evidence_as_system(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone)';
begin
  if pg_catalog.has_table_privilege(
       'pg_monitor', 'private.agent_mcp_evidence_redemptions', 'SELECT'
     )
     or pg_catalog.has_function_privilege(
       'pg_monitor',
       'private.prune_agent_mcp_evidence_redemptions(integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'pg_monitor', v_public_signature, 'EXECUTE'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'private.agent_mcp_evidence_redemptions', 'SELECT'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_public_signature, 'EXECUTE'
     ) then
    raise exception 'agent_mcp_evidence_replay_acl_failed';
  end if;
end;
$replay_contract$;

rollback;
