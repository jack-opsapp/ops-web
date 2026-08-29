\set ON_ERROR_STOP on

-- Task 18 forward-only replay proof. Both generated migrations are
-- intentionally replay-safe; this script mutates only the isolated test DB.
\ir ../../supabase/migrations/20260829061203_agent_catalog_sources.sql
\ir ../../supabase/migrations/20260829061214_agent_catalog_reads.sql

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $task18_forward_ledger$
declare
  v_trigger_count integer;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'task18_forward_ledger requires PostgreSQL 17';
  end if;
  select pg_catalog.count(*)::integer
    into v_trigger_count
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_proc function_row
    on function_row.oid = trigger_row.tgfoid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where not trigger_row.tgisinternal
    and namespace.nspname = 'private'
    and function_row.proname = 'bump_agent_catalog_source_revision';
  if v_trigger_count <> 14 then
    raise exception 'task18_forward_ledger trigger count:%', v_trigger_count;
  end if;
end;
$task18_forward_ledger$;

do $task18_replay_source$
declare
  v_index text;
begin
  if pg_catalog.to_regprocedure(
       'private.bump_agent_catalog_source_revision()'
     ) is null then
    raise exception 'task18_replay_source function missing';
  end if;
  foreach v_index in array array[
    'idx_catalog_items_agent_normalized_name_v1',
    'idx_catalog_tags_agent_normalized_name_v1',
    'idx_catalog_supplier_cost_profiles_agent_current_v1'
  ]::text[] loop
    if not exists (
      select 1
      from pg_catalog.pg_class index_row
      join pg_catalog.pg_index index_state
        on index_state.indexrelid = index_row.oid
      where index_row.relnamespace = 'public'::regnamespace
        and index_row.relname = v_index
        and index_state.indisvalid
        and index_state.indisready
        and index_state.indislive
    ) then
      raise exception 'task18_replay_source index invalid:%', v_index;
    end if;
  end loop;
end;
$task18_replay_source$;

do $task18_replay_reads$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.agent_p2_catalog_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
    'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
    'private.agent_p2_catalog_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean,timestamp with time zone,integer,integer,integer)',
    'public.read_agent_catalog_items_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
    'public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'task18_replay_reads function missing:%', v_signature;
    end if;
  end loop;
end;
$task18_replay_reads$;

do $function_acl_stable$
begin
  if pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_catalog_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean,timestamp with time zone,integer,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.read_agent_catalog_items_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_catalog_items_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'function_acl_stable';
  end if;
end;
$function_acl_stable$;

rollback;
