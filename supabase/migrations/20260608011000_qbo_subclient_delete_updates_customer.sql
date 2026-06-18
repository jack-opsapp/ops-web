begin;

do $$
declare
  v_functiondef text;
  v_updated_functiondef text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_functiondef;

  v_updated_functiondef := replace(
    v_functiondef,
    '    when tg_op = ''UPDATE''
      and tg_table_name in (''clients'', ''sub_clients'')
      and v_new_json->>''deleted_at'' is not null
      and v_old_json->>''deleted_at'' is null then ''inactivate''',
    '    when tg_op = ''UPDATE''
      and tg_table_name = ''clients''
      and v_new_json->>''deleted_at'' is not null
      and v_old_json->>''deleted_at'' is null then ''inactivate''
    when tg_op = ''UPDATE''
      and tg_table_name = ''sub_clients''
      and v_new_json->>''deleted_at'' is not null
      and v_old_json->>''deleted_at'' is null then ''update'''
  );

  if v_updated_functiondef = v_functiondef
     or v_updated_functiondef not ilike '%tg_table_name = ''sub_clients''%'
     or v_updated_functiondef not ilike '%then ''update''%' then
    raise exception 'qbo_subclient_delete_updates_customer_sentinel: enqueue function was not patched for sub-client delete';
  end if;

  execute v_updated_functiondef;
end $$;

do $$
declare
  v_functiondef text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid%' then
    raise exception 'qbo_subclient_delete_updates_customer_sentinel: sub-client queue ownership no longer targets parent client';
  end if;

  if v_functiondef not ilike '%tg_table_name = ''clients''%'
     or v_functiondef not ilike '%then ''inactivate''%' then
    raise exception 'qbo_subclient_delete_updates_customer_sentinel: client tombstones no longer map to inactivate';
  end if;

  if v_functiondef not ilike '%tg_table_name = ''sub_clients''%'
     or v_functiondef not ilike '%then ''update''%' then
    raise exception 'qbo_subclient_delete_updates_customer_sentinel: sub-client tombstones do not map to update';
  end if;
end $$;

revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated;
grant execute on function public.enqueue_accounting_sync() to service_role;

commit;
