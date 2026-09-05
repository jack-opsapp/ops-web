\set ON_ERROR_STOP on
create function maverick_test.data_snapshot() returns jsonb language plpgsql as $$
declare t record; digest text; result jsonb := '{}';
begin
  for t in select table_schema,table_name from information_schema.tables
    where table_schema in ('public','private') and table_type='BASE TABLE'
    order by table_schema,table_name loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,''[]'')) from %I.%I r',t.table_schema,t.table_name) into digest;
    result := result || jsonb_build_object(t.table_schema||'.'||t.table_name,digest);
  end loop;
  return result;
end $$;
create function maverick_test.function_security() returns jsonb language sql stable as $$
select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile) order by p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in (
  'read_agent_job_conversation_context_v3_impl',
  'read_agent_job_conversation_context_as_system_v6_core',
  'read_agent_job_conversation_context_as_system_v7_core',
  'read_agent_job_conversation_context_as_system',
  'agent_p2_task_context_v1','agent_p2_task_list_v1','agent_p2_task_attention_v1'
);
$$;
create table maverick_test.before_migration as select
  maverick_test.data_snapshot() as data,
  maverick_test.function_security() as security;
