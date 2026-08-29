\set ON_ERROR_STOP on

begin;

grant execute on function private.agent_p2_operational_overview_hash_ref_v1(
  text,jsonb
) to pg_monitor with grant option;
grant execute on function private.agent_p2_operational_overview_expected_component_v1(
  text,text,jsonb,text[]
) to pg_monitor with grant option;
grant execute on function private.agent_p2_operational_overview_merge_revisions_v1(
  jsonb[]
) to pg_monitor with grant option;
grant execute on function private.agent_p2_operational_overview_summary_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,
  jsonb,integer,integer,integer
) to pg_monitor with grant option;
grant execute on function public.read_agent_operational_overview_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,
  jsonb,integer,integer,integer
) to pg_monitor with grant option;

\ir ../../supabase/migrations/20260829110002_agent_operational_overview_read.sql

begin;

do $replay_contract$
declare
  v_hash_signature constant text :=
    'private.agent_p2_operational_overview_hash_ref_v1(text,jsonb)';
  v_expected_signature constant text :=
    'private.agent_p2_operational_overview_expected_component_v1(text,text,jsonb,text[])';
  v_merge_signature constant text :=
    'private.agent_p2_operational_overview_merge_revisions_v1(jsonb[])';
  v_summary_signature constant text :=
    'private.agent_p2_operational_overview_summary_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)';
  v_public_signature constant text :=
    'public.read_agent_operational_overview_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)';
  v_signature text;
  v_acl_entries text[];
  v_expected_acl text[];
  v_expected_volatility "char";
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_operational_overview_replay_failed: requires_pg17';
  end if;

  foreach v_signature in array array[
    v_hash_signature,
    v_expected_signature,
    v_merge_signature,
    v_summary_signature,
    v_public_signature
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_operational_overview_replay_failed: missing:%',
        v_signature;
    end if;

    v_expected_volatility := case when v_signature = v_hash_signature
      then 'i'::"char"
      else 's'::"char"
    end;
    if (
      select role_row.rolname <> current_user
        or function_row.provolatile <> v_expected_volatility
        or function_row.proconfig is distinct from
             array['search_path=""']::text[]
        or function_row.prosecdef is distinct from
             (v_signature = v_public_signature)
      from pg_catalog.pg_proc function_row
      join pg_catalog.pg_roles role_row on role_row.oid = function_row.proowner
      where function_row.oid = pg_catalog.to_regprocedure(v_signature)::oid
    ) then
      raise exception 'agent_operational_overview_replay_failed: metadata:%',
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

    v_expected_acl := case when v_signature = v_public_signature
      then array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_operational_overview_replay_failed: acl:%:%',
        v_signature,
        v_acl_entries;
    end if;

    if pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege(
            'authenticated', v_signature, 'EXECUTE'
          )
       or pg_catalog.has_function_privilege('pg_monitor', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('public', v_signature, 'EXECUTE')
       or (
         v_signature = v_public_signature
         and not pg_catalog.has_function_privilege(
           'service_role', v_signature, 'EXECUTE'
         )
       )
       or (
         v_signature <> v_public_signature
         and pg_catalog.has_function_privilege(
           'service_role', v_signature, 'EXECUTE'
         )
       ) then
      raise exception 'agent_operational_overview_replay_failed: privilege:%',
        v_signature;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'private'
      and function_row.proname in (
        'agent_p2_operational_overview_hash_ref_v1',
        'agent_p2_operational_overview_expected_component_v1',
        'agent_p2_operational_overview_merge_revisions_v1',
        'agent_p2_operational_overview_summary_v1'
      )
  ) <> 4 or (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'public'
      and function_row.proname =
        'read_agent_operational_overview_as_system'
  ) <> 1 then
    raise exception 'agent_operational_overview_replay_failed: duplicate_function';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    where namespace.nspname in ('private', 'public')
      and function_row.proname in (
        'agent_p2_operational_overview_hash_ref_v1',
        'agent_p2_operational_overview_expected_component_v1',
        'agent_p2_operational_overview_merge_revisions_v1',
        'agent_p2_operational_overview_summary_v1',
        'read_agent_operational_overview_as_system'
      )
      and pg_catalog.pg_get_functiondef(function_row.oid) ~*
        '\m(insert|update|delete|merge|truncate)\M'
  ) then
    raise exception 'agent_operational_overview_replay_failed: dml';
  end if;

  if exists (
    select 1
    from (values
      ('private.agent_p2_sales_document_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)'),
      ('private.agent_p2_payment_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,timestamp with time zone,integer)'),
      ('private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)'),
      ('private.agent_p2_catalog_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean,timestamp with time zone,integer,integer,integer)'),
      ('private.agent_p2_purchase_order_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text,date,integer,boolean,timestamp with time zone,integer,integer,integer,integer)'),
      ('private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)'),
      ('private.agent_p2_legacy_schedule_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)'),
      ('private.agent_p2_work_queue_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)')
    ) required(signature)
    where pg_catalog.to_regprocedure(required.signature) is null
  ) then
    raise exception 'agent_operational_overview_replay_failed: prerequisite';
  end if;
end;
$replay_contract$;

rollback;
