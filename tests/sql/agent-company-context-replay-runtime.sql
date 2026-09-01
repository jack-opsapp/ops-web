begin;

\set ON_ERROR_STOP on

grant execute on function private.agent_p2_company_summary_v1(
  uuid, uuid, uuid, uuid, text, text[], text[], text, text[], text,
  timestamp with time zone
) to pg_monitor with grant option;
grant execute on function public.read_agent_company_context_as_system(
  text, uuid, uuid, uuid, uuid, text, text[], text, text[], text, text,
  text, text[], text
) to pg_monitor with grant option;

\ir ../../supabase/migrations/20260829040356_agent_company_sources.sql
\ir ../../supabase/migrations/20260829040402_agent_company_context_read.sql

begin;

do $replay_contract$
declare
  v_private_signature constant text :=
    'private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)';
  v_public_signature constant text :=
    'public.read_agent_company_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text)';
  v_trigger_count integer;
begin
  if pg_catalog.has_function_privilege(
       'pg_monitor', v_private_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'pg_monitor', v_public_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_private_signature, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_public_signature, 'EXECUTE'
     ) then
    raise exception 'agent_company_context_replay_failed: acl_drift';
  end if;

  select pg_catalog.count(*) into v_trigger_count
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgname in (
    'companies_bump_agent_company_revision',
    'company_inventory_settings_bump_agent_company_revision',
    'company_settings_bump_agent_company_revision'
  )
    and not trigger_row.tgisinternal
    and trigger_row.tgenabled = 'O'
    and trigger_row.tgtype = 29;
  if v_trigger_count <> 3 then
    raise exception 'agent_company_context_replay_failed: trigger_drift';
  end if;
end;
$replay_contract$;

rollback;
