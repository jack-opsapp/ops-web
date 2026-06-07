begin;

drop index if exists public.accounting_sync_queue_active_uniq;

create unique index if not exists accounting_sync_queue_active_uniq
  on public.accounting_sync_queue (
    company_id,
    connection_id,
    provider,
    entity_type,
    entity_id,
    operation,
    idempotency_key
  )
  where status = 'pending';

create or replace function public.enqueue_accounting_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row_json jsonb;
  v_old_json jsonb := '{}'::jsonb;
  v_new_json jsonb := '{}'::jsonb;
  v_company_id uuid;
  v_connection_id uuid;
  v_propagate_deletes boolean := false;
  v_entity_type text;
  v_entity_id uuid;
  v_external_id text;
  v_operation text;
  v_source_action text;
  v_source_updated_at timestamptz;
  v_payload jsonb;
begin
  if current_setting('ops.sync_source', true) = 'quickbooks' then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_json := to_jsonb(new);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_json := to_jsonb(old);
  end if;

  v_row_json := case when tg_op = 'DELETE' then v_old_json else v_new_json end;

  v_company_id := nullif(v_row_json->>'company_id', '')::uuid;
  if v_company_id is null then
    return coalesce(new, old);
  end if;

  v_source_updated_at := nullif(coalesce(v_row_json->>'updated_at', v_row_json->>'created_at'), '')::timestamptz;

  v_entity_type := case tg_table_name
    when 'clients' then 'customer'
    when 'sub_clients' then 'customer'
    when 'invoices' then 'invoice'
    when 'estimates' then 'estimate'
    when 'payments' then 'payment'
    when 'line_items' then case
      when nullif(v_row_json->>'invoice_id', '') is not null then 'invoice'
      when nullif(v_row_json->>'estimate_id', '') is not null then 'estimate'
      else null
    end
    else null
  end;

  v_entity_id := case tg_table_name
    when 'line_items' then coalesce(
      nullif(v_row_json->>'invoice_id', '')::uuid,
      nullif(v_row_json->>'estimate_id', '')::uuid
    )
    else nullif(v_row_json->>'id', '')::uuid
  end;

  if v_entity_type is null or v_entity_id is null then
    return coalesce(new, old);
  end if;

  if exists (
    select 1
    from public.accounting_sync_suppressions s
    where s.company_id = v_company_id
      and s.provider = 'quickbooks'
      and s.entity_type = v_entity_type
      and s.entity_id = v_entity_id
      and s.source = 'quickbooks'
      and s.expires_at > now()
  ) then
    return coalesce(new, old);
  end if;

  select id, propagate_deletes
  into v_connection_id, v_propagate_deletes
  from public.accounting_connections
  where company_id = v_company_id::text
    and provider = 'quickbooks'
    and is_connected = true
    and sync_enabled = true
    and sync_direction <> 'pull_only'
  order by updated_at desc nulls last
  limit 1;

  if v_connection_id is null then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'line_items' and v_entity_type = 'invoice' then
    select qb_id
    into v_external_id
    from public.invoices
    where id = v_entity_id
      and company_id = v_company_id;
  elsif tg_table_name = 'line_items' and v_entity_type = 'estimate' then
    select qb_id
    into v_external_id
    from public.estimates
    where id = v_entity_id
      and company_id = v_company_id;
  else
    v_external_id := nullif(v_row_json->>'qb_id', '');
  end if;

  v_source_action := lower(tg_op);
  v_operation := case
    when tg_op = 'UPDATE'
      and tg_table_name in ('clients', 'sub_clients')
      and v_new_json->>'deleted_at' is not null
      and v_old_json->>'deleted_at' is null then 'inactivate'
    when tg_op = 'UPDATE'
      and tg_table_name in ('invoices', 'estimates')
      and v_new_json->>'deleted_at' is not null
      and v_old_json->>'deleted_at' is null then 'void'
    when tg_op = 'UPDATE'
      and tg_table_name = 'payments'
      and v_new_json->>'voided_at' is not null
      and v_old_json->>'voided_at' is null then 'void'
    when tg_op = 'INSERT' and v_external_id is null then 'create'
    when tg_op = 'INSERT' then 'update'
    else 'update'
  end;

  if v_operation in ('inactivate', 'void') then
    v_source_action := case when v_operation = 'void' then 'void' else 'soft_delete' end;
  end if;

  if v_operation in ('inactivate', 'void') and not v_propagate_deletes then
    insert into public.accounting_sync_events (
      company_id,
      connection_id,
      provider,
      direction,
      entity_type,
      entity_id,
      external_id,
      operation,
      status,
      source,
      ops_updated_at,
      decision,
      before_snapshot,
      after_snapshot,
      error
    )
    values (
      v_company_id,
      v_connection_id,
      'quickbooks',
      'system',
      v_entity_type,
      v_entity_id::text,
      v_external_id,
      v_operation,
      'skipped',
      'trigger',
      v_source_updated_at,
      'skipped',
      v_old_json,
      v_new_json,
      'propagate_deletes=false; outbound delete/void skipped'
    );

    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and tg_table_name <> 'line_items' then
    if coalesce(v_old_json->>'qb_id', '') is distinct from coalesce(v_new_json->>'qb_id', '')
      and (v_old_json - 'qb_id' - 'updated_at') = (v_new_json - 'qb_id' - 'updated_at')
    then
      return new;
    end if;
  end if;

  v_payload := jsonb_build_object(
    'table', tg_table_name,
    'op', tg_op,
    'entityType', v_entity_type,
    'entityId', v_entity_id,
    'sourceRowId', nullif(v_row_json->>'id', ''),
    'qbId', v_external_id,
    'updatedAt', v_source_updated_at,
    'snapshot', v_row_json
  );

  insert into public.accounting_sync_queue (
    company_id,
    connection_id,
    provider,
    entity_type,
    entity_id,
    external_id,
    operation,
    source_table,
    source_action,
    source_updated_at,
    idempotency_key,
    payload_snapshot
  )
  values (
    v_company_id,
    v_connection_id,
    'quickbooks',
    v_entity_type,
    v_entity_id,
    v_external_id,
    v_operation,
    tg_table_name,
    v_source_action,
    v_source_updated_at,
    concat(v_entity_type, ':', v_entity_id::text),
    v_payload
  )
  on conflict (company_id, connection_id, provider, entity_type, entity_id, operation, idempotency_key)
  where status = 'pending'
  do update
    set external_id = excluded.external_id,
        source_updated_at = excluded.source_updated_at,
        payload_snapshot = excluded.payload_snapshot,
        run_after = least(public.accounting_sync_queue.run_after, excluded.run_after),
        updated_at = now();

  return coalesce(new, old);
end;
$$;

revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated;
grant execute on function public.enqueue_accounting_sync() to service_role;

do $$
declare
  v_indexdef text;
  v_functiondef text;
begin
  select indexdef
  into v_indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'accounting_sync_queue'
    and indexname = 'accounting_sync_queue_active_uniq';

  if v_indexdef is null or v_indexdef not ilike '%connection_id%' then
    raise exception 'qbo_sync_queue_connection_scope_sentinel: active queue unique index is not connection-scoped';
  end if;

  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_functiondef;

  if v_functiondef not ilike '%sync_enabled = true%' then
    raise exception 'qbo_sync_queue_connection_scope_sentinel: enqueue trigger does not require sync_enabled=true';
  end if;
end $$;

commit;
