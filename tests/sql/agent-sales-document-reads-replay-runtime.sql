\set ON_ERROR_STOP on

begin;

-- Seed hostile replay ACLs. Both migrations must canonicalize these grants.
grant execute on function private.bump_agent_sales_document_source_revision()
  to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_hash_ref(text,jsonb)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_money_minor_or_null_v1(numeric,text)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_rfc3339_or_null_v1(timestamp with time zone)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_expected_candidate_v1(text,jsonb)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_proof_candidates_v1(jsonb,jsonb)
  to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_read_context_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[]
) to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_document_header_source_v1(
  uuid,text[],uuid,text,uuid,uuid,text,integer
) to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_authorized_path_v1(
  uuid,uuid,jsonb,text,uuid,uuid
) to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_document_list_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,
  text,uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,uuid
) to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_document_lines_v1(
  uuid,text,uuid,text,integer
) to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_document_milestones_v1(
  uuid,uuid,text,integer
) to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_document_detail_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,
  integer,integer,integer,integer,integer
) to pg_monitor with grant option;
grant execute on function private.agent_p2_sales_document_attention_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],
  timestamp with time zone,integer,integer
) to pg_monitor with grant option;
grant execute on function public.read_agent_sales_documents_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],
  uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,uuid
) to pg_monitor with grant option;
grant execute on function public.read_agent_sales_document_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,
  integer,integer,integer,integer,integer
) to pg_monitor with grant option;

\echo task14_forward_ledger
\ir ../../supabase/migrations/20260829024746_agent_sales_document_sources.sql
\echo task14_replay_source
\ir ../../supabase/migrations/20260829024749_agent_sales_document_reads.sql
\echo task14_replay_reads

begin;

do $function_acl_stable$
declare
  v_signature text;
  v_acl_entries text[];
  v_expected text[];
begin
  foreach v_signature in array array[
    'private.bump_agent_sales_document_source_revision()',
    'private.agent_p2_sales_hash_ref(text,jsonb)',
    'private.agent_p2_sales_money_minor_or_null_v1(numeric,text)',
    'private.agent_p2_sales_rfc3339_or_null_v1(timestamp with time zone)',
    'private.agent_p2_sales_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_sales_proof_candidates_v1(jsonb,jsonb)',
    'private.agent_p2_sales_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[])',
    'private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)',
    'private.agent_p2_sales_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)',
    'private.agent_p2_sales_document_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
    'private.agent_p2_sales_document_lines_v1(uuid,text,uuid,text,integer)',
    'private.agent_p2_sales_document_milestones_v1(uuid,uuid,text,integer)',
    'private.agent_p2_sales_document_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)',
    'private.agent_p2_sales_document_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)',
    'public.read_agent_sales_documents_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
    'public.read_agent_sales_document_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)'
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
      raise exception 'function_acl_stable_failed:%:%',
        v_signature, v_acl_entries;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger trigger_row
    where not trigger_row.tgisinternal
      and trigger_row.tgname in (
        'estimates_bump_agent_sales_document_revision',
        'invoices_bump_agent_sales_document_revision',
        'line_items_bump_agent_sales_document_revision',
        'payment_milestones_bump_agent_sales_document_revision',
        'companies_bump_agent_sales_document_revision'
      )
  ) <> 5 then
    raise exception 'function_acl_stable_trigger_count_failed';
  end if;
  raise notice 'function_acl_stable';
end;
$function_acl_stable$;

rollback;
