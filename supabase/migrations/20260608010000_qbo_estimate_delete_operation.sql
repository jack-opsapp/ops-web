begin;

alter table public.accounting_sync_queue
  drop constraint if exists accounting_sync_queue_operation_check;

alter table public.accounting_sync_queue
  add constraint accounting_sync_queue_operation_check
  check (operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'delete', 'link', 'reconcile'));

alter table public.accounting_sync_events
  drop constraint if exists accounting_sync_events_operation_check;

alter table public.accounting_sync_events
  add constraint accounting_sync_events_operation_check
  check (operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'delete', 'link', 'reconcile'));

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
      and tg_table_name in (''invoices'', ''estimates'')
      and v_new_json->>''deleted_at'' is not null
      and v_old_json->>''deleted_at'' is null then ''void''',
    '    when tg_op = ''UPDATE''
      and tg_table_name = ''invoices''
      and v_new_json->>''deleted_at'' is not null
      and v_old_json->>''deleted_at'' is null then ''void''
    when tg_op = ''UPDATE''
      and tg_table_name = ''estimates''
      and v_new_json->>''deleted_at'' is not null
      and v_old_json->>''deleted_at'' is null then ''delete'''
  );

  v_updated_functiondef := replace(
    v_updated_functiondef,
    '  if v_operation in (''inactivate'', ''void'') then
    v_source_action := case when v_operation = ''void'' then ''void'' else ''soft_delete'' end;
  end if;',
    '  if v_operation in (''inactivate'', ''void'', ''delete'') then
    v_source_action := case when v_operation = ''void'' then ''void'' else ''soft_delete'' end;
  end if;'
  );

  v_updated_functiondef := replace(
    v_updated_functiondef,
    '  if v_operation in (''inactivate'', ''void'') and not v_propagate_deletes then',
    '  if v_operation in (''inactivate'', ''void'', ''delete'') and not v_propagate_deletes then'
  );

  if v_updated_functiondef = v_functiondef
     or v_updated_functiondef not ilike '%tg_table_name = ''estimates''%'
     or v_updated_functiondef not ilike '%then ''delete''%' then
    raise exception 'qbo_estimate_delete_operation_sentinel: enqueue function was not patched for estimate delete';
  end if;

  execute v_updated_functiondef;
end $$;

do $$
declare
  v_functiondef text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%tg_table_name = ''estimates''%'
     or v_functiondef not ilike '%then ''delete''%' then
    raise exception 'qbo_estimate_delete_operation_sentinel: estimate tombstones are not mapped to delete';
  end if;

  if v_functiondef not ilike '%tg_table_name = ''invoices''%'
     or v_functiondef not ilike '%then ''void''%' then
    raise exception 'qbo_estimate_delete_operation_sentinel: invoice tombstones no longer map to void';
  end if;

  if v_functiondef not ilike '%v_operation in (''inactivate'', ''void'', ''delete'') and not v_propagate_deletes%' then
    raise exception 'qbo_estimate_delete_operation_sentinel: delete is not gated by propagate_deletes';
  end if;
end $$;

revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated;
grant execute on function public.enqueue_accounting_sync() to service_role;

commit;
