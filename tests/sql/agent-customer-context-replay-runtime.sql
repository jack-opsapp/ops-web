begin;

\set ON_ERROR_STOP on

grant execute on function private.agent_p2_customer_summary_v1(
  uuid, uuid, uuid, uuid, text, text[], text[], text, text[], text, text,
  text, text, uuid, text[], text, text[], timestamp with time zone, integer,
  integer
) to pg_monitor with grant option;
grant execute on function public.read_agent_customer_context_as_system(
  text, uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text,
  text[], text, text, text, text, uuid, text[], text, text[], integer, integer
) to pg_monitor with grant option;

\ir ../../supabase/migrations/20260823100019_agent_customer_context_read.sql

begin;

do $replay_contract$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)',
    'public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)'
  ]::text[] loop
    if exists (
      select 1
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        pg_catalog.coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      where function_row.oid = pg_catalog.to_regprocedure(v_signature)
        and acl.grantee = 'pg_monitor'::regrole::oid
    ) then
      raise exception
        'agent_customer_context_runtime_failed: unexpected role grant survived replay';
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)',
       'EXECUTE'
     ) then
    raise exception
      'agent_customer_context_runtime_failed: replay service acl mismatch';
  end if;
end;
$replay_contract$;

rollback;
