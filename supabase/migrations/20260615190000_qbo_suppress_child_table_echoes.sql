begin;

-- Echo-suppression gap: enqueue_accounting_sync() skipped the inbound-write
-- suppression check for the child tables `sub_clients` and `line_items`. The
-- inbound webhook apply ALWAYS registers a parent suppression before writing
-- these (suppress_accounting_sync(customer, client_id) before a contact write;
-- suppress_accounting_sync(invoice|estimate, parent_id) before replacing lines),
-- but because the trigger excluded child tables from the check, those parent
-- suppressions were ignored and every inbound child write leaked an OUTBOUND
-- enqueue for the parent. Consequence: an inbound customer deactivation bounced
-- back as a non-sparse customer UPDATE that reactivated the customer in QBO and
-- cleared its contact email/phone; inbound estimate/invoice line replacement
-- enqueued a spurious estimate/invoice update. Child enqueues already resolve
-- entity_id to the PARENT (sub_clients -> client_id, line_items -> invoice/estimate
-- id), so checking suppression on the resolved (entity_type, entity_id) matches
-- the parent suppression the apply already wrote. Make the child tables consistent
-- with clients/invoices/estimates/payments by always running the suppression check.

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure) into v_def;

  v_new := replace(
    v_def,
    'if tg_table_name not in (''sub_clients'', ''line_items'') and exists (',
    'if exists ('
  );

  if v_new = v_def then
    raise exception 'qbo_suppress_child_table_echoes: suppression-skip guard not found (already patched or drifted)';
  end if;

  execute v_new;
end $$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure) into v_def;

  if v_def ilike '%not in (''sub_clients'', ''line_items'') and exists%' then
    raise exception 'qbo_suppress_child_table_echoes_sentinel: child-table suppression skip still present';
  end if;

  if v_def not ilike '%from public.accounting_sync_suppressions s%' then
    raise exception 'qbo_suppress_child_table_echoes_sentinel: suppression check missing';
  end if;

  -- The child enqueues must still target the PARENT entity id (unchanged).
  if v_def not ilike '%when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid%' then
    raise exception 'qbo_suppress_child_table_echoes_sentinel: sub_clients parent-id resolution changed unexpectedly';
  end if;
end $$;

revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated;
grant execute on function public.enqueue_accounting_sync() to service_role;

commit;
