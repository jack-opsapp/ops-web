\set ON_ERROR_STOP on

begin;

grant execute on function private.agent_p2_integration_health_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer
) to pg_monitor with grant option;
grant execute on function public.read_agent_integration_health_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,jsonb,integer
) to pg_monitor with grant option;

\ir ../../supabase/migrations/20260829102510_agent_integration_health_sources.sql
\ir ../../supabase/migrations/20260829102520_agent_integration_health_read.sql

begin;

do $replay_contract$
declare
  v_private_signature constant text :=
    'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)';
  v_public_signature constant text :=
    'public.read_agent_integration_health_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,jsonb,integer)';
  v_signature text;
  v_acl_entries text[];
  v_expected text[];
  v_trigger_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_integration_health_replay_failed: requires_pg17';
  end if;

  foreach v_signature in array array[
    v_private_signature,
    v_public_signature
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_integration_health_replay_failed: function_missing:%',
        v_signature;
    end if;

    select coalesce(
             pg_catalog.array_agg(
               case when acl.grantee = 0 then 'PUBLIC'
                 else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
               end || ':' || acl.privilege_type || ':' ||
                 acl.is_grantable::text
               order by 1
             ),
             array[]::text[]
           )
      into v_acl_entries
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
    where function_row.oid = pg_catalog.to_regprocedure(v_signature)::oid
      and acl.grantee <> function_row.proowner;

    v_expected := case when v_signature = v_public_signature
      then array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected then
      raise exception 'agent_integration_health_replay_failed: acl:%:%',
        v_signature, v_acl_entries;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'private'
      and function_row.proname = 'agent_p2_integration_health_summary_v1'
  ) <> 1 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'public'
      and function_row.proname = 'read_agent_integration_health_as_system'
  ) <> 1 then
    raise exception 'agent_integration_health_replay_failed: duplicate_function';
  end if;

  foreach v_trigger_name in array array[
    'email_connections_bump_agent_integrations_revision',
    'accounting_connections_bump_agent_integrations_revision'
  ]::text[] loop
    if (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      where not trigger_row.tgisinternal
        and trigger_row.tgname = v_trigger_name
        and trigger_row.tgenabled = 'O'
        and trigger_row.tgtype = 29
    ) <> 1 then
      raise exception 'agent_integration_health_replay_failed: trigger:%',
        v_trigger_name;
    end if;
  end loop;

  if exists (
    select 1
    from (values
      ('idx_email_connections_agent_integration_health_v1'),
      ('idx_accounting_connections_agent_integration_health_v1')
    ) expected(index_name)
    left join pg_catalog.pg_class index_relation
      on index_relation.relname = expected.index_name
    left join pg_catalog.pg_namespace namespace
      on namespace.oid = index_relation.relnamespace
     and namespace.nspname = 'public'
    left join pg_catalog.pg_index index_row
      on index_row.indexrelid = index_relation.oid
    where namespace.oid is null
       or not coalesce(
         index_row.indisvalid and index_row.indisready and index_row.indislive,
         false
       )
  ) then
    raise exception 'agent_integration_health_replay_failed: source_index';
  end if;
end;
$replay_contract$;

rollback;
