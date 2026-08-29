\set ON_ERROR_STOP on

begin;

grant execute on function private.bump_agent_payment_source_revision()
  to pg_monitor with grant option;
grant execute on function private.agent_p2_payment_expected_candidate_v1(jsonb)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_payment_source_v1(
  uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,
  timestamp with time zone,integer
) to pg_monitor with grant option;
grant execute on function private.agent_p2_payment_authorized_path_v1(
  uuid,uuid,jsonb,text,uuid,uuid
) to pg_monitor with grant option;
grant execute on function private.agent_p2_payment_proof_candidate_v1(jsonb)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_payment_read_context_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb
) to pg_monitor with grant option;
grant execute on function private.agent_p2_payment_list_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,
  timestamp with time zone,jsonb,date,uuid
) to pg_monitor with grant option;
grant execute on function private.agent_p2_payment_attention_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,
  timestamp with time zone,integer
) to pg_monitor with grant option;
grant execute on function public.read_agent_payments_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,
  timestamp with time zone,jsonb,date,uuid
) to authenticated with grant option;

alter function private.agent_p2_payment_list_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,
  timestamp with time zone,jsonb,date,uuid
) volatile security definer set search_path = public;
alter function public.read_agent_payments_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,
  timestamp with time zone,jsonb,date,uuid
) volatile security invoker set search_path = public;

\echo task15_forward_ledger
\ir ../../supabase/migrations/20260829081500_agent_payment_sources.sql
\echo task15_replay_source
\ir ../../supabase/migrations/20260829081501_agent_payment_read.sql
\echo task15_replay_read

begin;

do $task15_function_acl_stable$
declare
  v_signature text;
  v_acl_entries text[];
  v_expected text[];
  v_private_count integer;
  v_public_count integer;
begin
  foreach v_signature in array array[
    'private.bump_agent_payment_source_revision()',
    'private.agent_p2_payment_expected_candidate_v1(jsonb)',
    'private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)',
    'private.agent_p2_payment_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)',
    'private.agent_p2_payment_proof_candidate_v1(jsonb)',
    'private.agent_p2_payment_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb)',
    'private.agent_p2_payment_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'private.agent_p2_payment_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,timestamp with time zone,integer)',
    'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)'
  ]::text[] loop
    select coalesce(
             pg_catalog.array_agg(
               case when acl.grantee = 0 then 'PUBLIC'
                 else coalesce(
                   role_row.rolname, 'OID:' || acl.grantee::text
                 )
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

    v_expected := case when v_signature like 'public.%'
      then array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected then
      raise exception 'task15_function_acl_stable_failed:%:%',
        v_signature, v_acl_entries;
    end if;
  end loop;

  select pg_catalog.count(*)
    into v_private_count
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname like 'agent_p2_payment_%'
    and not procedure.prosecdef
    and procedure.provolatile = 's'
    and procedure.proconfig @> array['search_path=""']::text[];
  select pg_catalog.count(*)
    into v_public_count
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'read_agent_payments_as_system'
    and procedure.prosecdef
    and procedure.provolatile = 's'
    and procedure.proconfig @> array['search_path=""']::text[];
  if v_private_count <> 7 or v_public_count <> 1 then
    raise exception 'task15_function_attributes_stable_failed:%:%',
      v_private_count, v_public_count;
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger trigger_row
    where not trigger_row.tgisinternal
      and trigger_row.tgrelid = 'public.payments'::regclass
      and trigger_row.tgname = 'payments_bump_agent_payment_revision'
  ) <> 1 then
    raise exception 'task15_trigger_replay_stable_failed';
  end if;
  raise notice 'task15_function_acl_stable';
end;
$task15_function_acl_stable$;

rollback;

\ir agent-payment-reads-runtime.sql
