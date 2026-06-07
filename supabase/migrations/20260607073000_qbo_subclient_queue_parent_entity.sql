begin;

do $$
declare
  v_functiondef text;
  v_updated_functiondef text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_functiondef;

  if v_functiondef ilike '%when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid%' then
    v_updated_functiondef := v_functiondef;
  else
    v_updated_functiondef := replace(
      v_functiondef,
      'v_entity_id := case tg_table_name
    when ''line_items'' then coalesce(
      nullif(v_row_json->>''invoice_id'', '''')::uuid,
      nullif(v_row_json->>''estimate_id'', '''')::uuid
    )
    else nullif(v_row_json->>''id'', '''')::uuid
  end;',
      'v_entity_id := case tg_table_name
    when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid
    when ''line_items'' then coalesce(
      nullif(v_row_json->>''invoice_id'', '''')::uuid,
      nullif(v_row_json->>''estimate_id'', '''')::uuid
    )
    else nullif(v_row_json->>''id'', '''')::uuid
  end;'
    );
  end if;

  if v_updated_functiondef = v_functiondef
     and v_functiondef not ilike '%when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid%' then
    raise exception 'qbo_subclient_queue_parent_entity_sentinel: enqueue function text did not match expected entity-id block';
  end if;

  execute v_updated_functiondef;

  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid%' then
    raise exception 'qbo_subclient_queue_parent_entity_sentinel: sub_clients do not enqueue parent client_id';
  end if;

  if v_functiondef not ilike '%''sourceRowId'', nullif(v_row_json->>''id'', '''')%' then
    raise exception 'qbo_subclient_queue_parent_entity_sentinel: source row id was not preserved in payload';
  end if;
end $$;

revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated;
grant execute on function public.enqueue_accounting_sync() to service_role;

commit;
