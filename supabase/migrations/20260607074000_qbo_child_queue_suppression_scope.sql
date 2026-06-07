begin;

do $$
declare
  v_functiondef text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%if tg_table_name not in (''sub_clients'', ''line_items'') and exists%' then
    v_functiondef := replace(
      v_functiondef,
      '  if exists (
    select 1
    from public.accounting_sync_suppressions s',
      '  if tg_table_name not in (''sub_clients'', ''line_items'') and exists (
    select 1
    from public.accounting_sync_suppressions s'
    );

    if v_functiondef not ilike '%if tg_table_name not in (''sub_clients'', ''line_items'') and exists%' then
      raise exception 'qbo_child_queue_suppression_scope_sentinel: enqueue suppression block was not patched';
    end if;

    execute v_functiondef;
  end if;
end $$;

do $$
declare
  v_functiondef text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%if tg_table_name not in (''sub_clients'', ''line_items'') and exists%' then
    raise exception 'qbo_child_queue_suppression_scope_sentinel: child rows are still covered by parent suppressions';
  end if;
end $$;

revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated;
grant execute on function public.enqueue_accounting_sync() to service_role;

commit;
