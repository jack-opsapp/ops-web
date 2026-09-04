begin;

-- Sage requires explicit ledger, tax, and payment-account identifiers on
-- financial writes. Persist exact, connection-scoped mappings so workers fail
-- closed instead of guessing provider accounting configuration.
create table if not exists public.sage_sales_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null
    references public.accounting_connections(id) on delete cascade,
  source_kind text not null
    check (source_kind in ('product', 'task_type', 'category', 'default')),
  source_key text not null check (nullif(btrim(source_key), '') is not null),
  sage_ledger_account_id text not null
    check (nullif(btrim(sage_ledger_account_id), '') is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, source_kind, source_key)
);

create table if not exists public.sage_tax_rate_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null
    references public.accounting_connections(id) on delete cascade,
  source_tax_key text not null
    check (nullif(btrim(source_tax_key), '') is not null),
  sage_tax_rate_id text not null
    check (nullif(btrim(sage_tax_rate_id), '') is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, source_tax_key)
);

create table if not exists public.sage_payment_method_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null
    references public.accounting_connections(id) on delete cascade,
  payment_method text not null
    check (nullif(btrim(payment_method), '') is not null),
  sage_bank_account_id text not null
    check (nullif(btrim(sage_bank_account_id), '') is not null),
  sage_payment_method_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, payment_method)
);

alter table public.sage_sales_account_mappings enable row level security;
alter table public.sage_tax_rate_mappings enable row level security;
alter table public.sage_payment_method_mappings enable row level security;

revoke all on table public.sage_sales_account_mappings
  from public, anon, authenticated;
revoke all on table public.sage_tax_rate_mappings
  from public, anon, authenticated;
revoke all on table public.sage_payment_method_mappings
  from public, anon, authenticated;
grant all on table public.sage_sales_account_mappings to service_role;
grant all on table public.sage_tax_rate_mappings to service_role;
grant all on table public.sage_payment_method_mappings to service_role;

create policy sage_sales_account_mappings_service_role_only
  on public.sage_sales_account_mappings
  for all to service_role using (true) with check (true);
create policy sage_tax_rate_mappings_service_role_only
  on public.sage_tax_rate_mappings
  for all to service_role using (true) with check (true);
create policy sage_payment_method_mappings_service_role_only
  on public.sage_payment_method_mappings
  for all to service_role using (true) with check (true);

alter table public.accounting_sync_queue
  add column if not exists provider_request_id text,
  add column if not exists provider_accepted_at timestamptz,
  add column if not exists idempotency_expires_at timestamptz;

alter table public.accounting_sync_queue
  drop constraint if exists accounting_sync_queue_provider_evidence_check;
alter table public.accounting_sync_queue
  add constraint accounting_sync_queue_provider_evidence_check
  check (
    (provider_accepted_at is null and idempotency_expires_at is null)
    or (
      provider_accepted_at is not null
      and idempotency_expires_at is not null
      and idempotency_expires_at > provider_accepted_at
    )
  );

create index if not exists accounting_sync_queue_unaccepted_stale_idx
  on public.accounting_sync_queue (provider, locked_at, created_at)
  where status = 'claimed' and provider_accepted_at is null;

create index if not exists accounting_sync_queue_fair_due_idx
  on public.accounting_sync_queue (
    provider,
    status,
    run_after,
    connection_id,
    entity_type,
    created_at
  )
  where status = 'pending';

create or replace function public.record_accounting_sync_acceptance(
  p_queue_id uuid,
  p_worker_id text,
  p_provider_request_id text,
  p_provider_accepted_at timestamptz,
  p_idempotency_expires_at timestamptz
)
returns public.accounting_sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.accounting_sync_queue;
begin
  if nullif(btrim(p_worker_id), '') is null
     or p_provider_accepted_at is null
     or p_idempotency_expires_at is null
     or p_idempotency_expires_at <= p_provider_accepted_at
     or char_length(coalesce(p_provider_request_id, '')) > 128 then
    raise check_violation using
      message = 'record_accounting_sync_acceptance: invalid provider evidence';
  end if;

  update public.accounting_sync_queue queued
  set provider_request_id = nullif(btrim(p_provider_request_id), ''),
      provider_accepted_at = p_provider_accepted_at,
      idempotency_expires_at = p_idempotency_expires_at,
      updated_at = now()
  where queued.id = p_queue_id
    and queued.status = 'claimed'
    and queued.locked_by = p_worker_id
    and queued.provider_accepted_at is null
  returning queued.* into v_row;

  if not found then
    raise object_not_in_prerequisite_state using
      message = 'record_accounting_sync_acceptance: claim ownership lost or already accepted';
  end if;
  return v_row;
end;
$$;

revoke all on function public.record_accounting_sync_acceptance(uuid, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_accounting_sync_acceptance(uuid, text, text, timestamptz, timestamptz)
  to service_role;

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
  v_connection record;
  v_entity_type text;
  v_entity_id uuid;
  v_external_id text;
  v_operation text;
  v_connection_operation text;
  v_source_action text;
  v_source_updated_at timestamptz;
  v_payload jsonb;
  v_parent_entity_type text;
  v_parent_entity_id text;
  v_parent_external_id text;
begin
  if current_setting('ops.sync_source', true) in ('quickbooks', 'sage') then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then v_new_json := to_jsonb(new); end if;
  if tg_op in ('UPDATE', 'DELETE') then v_old_json := to_jsonb(old); end if;
  v_row_json := case when tg_op = 'DELETE' then v_old_json else v_new_json end;
  v_company_id := nullif(v_row_json->>'company_id', '')::uuid;
  if v_company_id is null then return coalesce(new, old); end if;

  v_source_updated_at := nullif(
    coalesce(v_row_json->>'updated_at', v_row_json->>'created_at'),
    ''
  )::timestamptz;
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
    when 'sub_clients' then nullif(v_row_json->>'client_id', '')::uuid
    when 'line_items' then coalesce(
      nullif(v_row_json->>'invoice_id', '')::uuid,
      nullif(v_row_json->>'estimate_id', '')::uuid
    )
    else nullif(v_row_json->>'id', '')::uuid
  end;
  if v_entity_type is null or v_entity_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and tg_table_name <> 'line_items'
     and (v_old_json - 'qb_id' - 'sage_id' - 'updated_at')
       = (v_new_json - 'qb_id' - 'sage_id' - 'updated_at') then
    return new;
  end if;

  v_source_action := lower(tg_op);
  v_operation := case
    when tg_op = 'DELETE'
      and tg_table_name in ('clients', 'sub_clients') then 'inactivate'
    when tg_op = 'DELETE'
      and tg_table_name = 'invoices' then 'void'
    when tg_op = 'DELETE'
      and tg_table_name = 'estimates' then 'delete'
    when tg_op = 'DELETE'
      and tg_table_name = 'payments' then 'void'
    when tg_op = 'UPDATE'
      and tg_table_name in ('clients', 'sub_clients')
      and v_new_json->>'deleted_at' is not null
      and v_old_json->>'deleted_at' is null then 'inactivate'
    when tg_op = 'UPDATE'
      and tg_table_name = 'invoices'
      and (
        (v_new_json->>'deleted_at' is not null and v_old_json->>'deleted_at' is null)
        or (v_new_json->>'status' = 'void' and v_old_json->>'status' is distinct from 'void')
      ) then 'void'
    when tg_op = 'UPDATE'
      and tg_table_name = 'estimates'
      and v_new_json->>'deleted_at' is not null
      and v_old_json->>'deleted_at' is null then 'delete'
    when tg_op = 'UPDATE'
      and tg_table_name = 'payments'
      and v_new_json->>'voided_at' is not null
      and v_old_json->>'voided_at' is null then 'void'
    when tg_op = 'INSERT' then 'create'
    else 'update'
  end;
  if v_operation in ('inactivate', 'void', 'delete') then
    v_source_action := case when v_operation = 'void' then 'void' else 'soft_delete' end;
  end if;

  v_parent_entity_type := case
    when v_entity_type in ('invoice', 'estimate') then 'customer'
    when v_entity_type = 'payment' then 'invoice'
    else null
  end;
  v_parent_entity_id := case
    when v_entity_type in ('invoice', 'estimate') then nullif(v_row_json->>'client_id', '')
    when v_entity_type = 'payment' then nullif(v_row_json->>'invoice_id', '')
    else null
  end;
  if tg_table_name = 'line_items' and v_entity_type = 'invoice' then
    select invoice.client_id::text into v_parent_entity_id
    from public.invoices invoice
    where invoice.id = v_entity_id and invoice.company_id = v_company_id;
  elsif tg_table_name = 'line_items' and v_entity_type = 'estimate' then
    select estimate.client_id::text into v_parent_entity_id
    from public.estimates estimate
    where estimate.id = v_entity_id and estimate.company_id = v_company_id;
  end if;

  for v_connection in
    select connection.id,
           connection.provider,
           connection.provider_environment,
           connection.propagate_deletes
    from public.accounting_connections connection
    where connection.company_id = v_company_id::text
      and connection.provider in ('quickbooks', 'sage')
      and connection.is_connected = true
      and connection.sync_enabled = true
      and connection.sync_direction in ('push_only', 'bidirectional')
    order by connection.provider, connection.provider_environment, connection.id
  loop
    v_connection_operation := v_operation;
    v_parent_external_id := null;

    if exists (
      select 1
      from public.accounting_sync_suppressions suppression
      where suppression.company_id = v_company_id
        and suppression.provider = v_connection.provider
        and suppression.entity_type = v_entity_type
        and suppression.entity_id = v_entity_id
        and suppression.source = v_connection.provider
        and suppression.expires_at > now()
    ) then
      continue;
    end if;

    if tg_table_name = 'line_items' then
      if v_entity_type = 'invoice' then
        select case v_connection.provider
          when 'quickbooks' then invoice.qb_id
          else invoice.sage_id
        end
        into v_external_id
        from public.invoices invoice
        where invoice.id = v_entity_id and invoice.company_id = v_company_id;
      else
        select case v_connection.provider
          when 'quickbooks' then estimate.qb_id
          else estimate.sage_id
        end
        into v_external_id
        from public.estimates estimate
        where estimate.id = v_entity_id and estimate.company_id = v_company_id;
      end if;
    else
      v_external_id := nullif(
        v_row_json->>(case
          when v_connection.provider = 'quickbooks' then 'qb_id'
          else 'sage_id'
        end),
        ''
      );
    end if;

    if v_parent_entity_id is not null then
      if v_parent_entity_type = 'customer' then
        select case v_connection.provider
          when 'quickbooks' then client.qb_id
          else client.sage_id
        end
        into v_parent_external_id
        from public.clients client
        where client.id = v_parent_entity_id::uuid
          and client.company_id = v_company_id;
      elsif v_parent_entity_type = 'invoice' then
        select case v_connection.provider
          when 'quickbooks' then invoice.qb_id
          else invoice.sage_id
        end
        into v_parent_external_id
        from public.invoices invoice
        where invoice.id = v_parent_entity_id::uuid
          and invoice.company_id = v_company_id;
      end if;
    end if;

    if tg_op = 'INSERT' and v_external_id is not null then
      v_connection_operation := 'update';
    end if;
    if v_connection_operation in ('inactivate', 'void', 'delete')
       and not v_connection.propagate_deletes then
      insert into public.accounting_sync_events (
        company_id, connection_id, provider, direction, entity_type,
        entity_id, external_id, operation, status, source, ops_updated_at,
        decision, before_snapshot, after_snapshot, error
      ) values (
        v_company_id, v_connection.id, v_connection.provider, 'system',
        v_entity_type, v_entity_id::text, v_external_id, v_connection_operation,
        'skipped', 'trigger', v_source_updated_at, 'skipped', v_old_json,
        v_new_json, 'propagate_deletes=false; outbound lifecycle change skipped'
      );
      continue;
    end if;

    v_payload := jsonb_build_object(
      'schemaVersion', 2,
      'table', tg_table_name,
      'op', tg_op,
      'provider', v_connection.provider,
      'providerEnvironment', v_connection.provider_environment,
      'entityType', v_entity_type,
      'entityId', v_entity_id,
      'sourceRowId', nullif(v_row_json->>'id', ''),
      'externalId', v_external_id,
      'parentEntityType', v_parent_entity_type,
      'parentEntityId', v_parent_entity_id,
      'parentExternalId', v_parent_external_id,
      'updatedAt', v_source_updated_at,
      'snapshot', v_row_json
    );

    insert into public.accounting_sync_queue (
      company_id, connection_id, provider, entity_type, entity_id,
      external_id, operation, source_table, source_action,
      source_updated_at, idempotency_key, payload_snapshot
    ) values (
      v_company_id, v_connection.id, v_connection.provider, v_entity_type,
      v_entity_id, v_external_id, v_connection_operation, tg_table_name,
      v_source_action, v_source_updated_at,
      concat(v_entity_type, ':', v_entity_id::text), v_payload
    )
    on conflict (
      company_id, connection_id, provider, entity_type, entity_id,
      operation, idempotency_key
    ) where status = 'pending'
    do update set
      external_id = excluded.external_id,
      source_updated_at = excluded.source_updated_at,
      payload_snapshot = excluded.payload_snapshot,
      run_after = least(public.accounting_sync_queue.run_after, excluded.run_after),
      updated_at = now();
  end loop;
  return coalesce(new, old);
end;
$$;

revoke all on function public.enqueue_accounting_sync()
  from public, anon, authenticated;
grant execute on function public.enqueue_accounting_sync() to service_role;

create or replace function public.claim_accounting_sync_queue(
  p_provider text default 'quickbooks',
  p_limit integer default 25,
  p_worker_id text default 'accounting-worker',
  p_stale_after_seconds integer default 900
)
returns setof public.accounting_sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stale public.accounting_sync_queue;
  v_pending_id uuid;
  v_stale_seconds integer := greatest(
    1,
    least(coalesce(p_stale_after_seconds, 900), 86400)
  );
begin
  if p_provider not in ('quickbooks', 'sage') then
    raise check_violation using
      message = 'claim_accounting_sync_queue: invalid provider';
  end if;
  if coalesce(p_limit, 25) <= 0 then return; end if;

  for v_stale in
    select *
    from public.accounting_sync_queue stale
    where stale.provider = p_provider
      and stale.status = 'claimed'
      and stale.provider_accepted_at is null
      and stale.locked_at < now() - make_interval(secs => v_stale_seconds)
    order by stale.locked_at, stale.created_at, stale.id
    for update skip locked
  loop
    select pending.id into v_pending_id
    from public.accounting_sync_queue pending
    where pending.company_id = v_stale.company_id
      and pending.connection_id = v_stale.connection_id
      and pending.provider = v_stale.provider
      and pending.entity_type = v_stale.entity_type
      and pending.entity_id = v_stale.entity_id
      and pending.operation = v_stale.operation
      and pending.idempotency_key = v_stale.idempotency_key
      and pending.status = 'pending'
      and pending.id <> v_stale.id
    order by pending.created_at desc
    limit 1;

    if v_pending_id is not null then
      update public.accounting_sync_queue
      set status = 'cancelled', locked_at = null, locked_by = null,
          last_error = concat_ws('; ', last_error, 'stale claim superseded'),
          updated_at = now()
      where id = v_stale.id;
    else
      update public.accounting_sync_queue
      set status = 'pending', run_after = now(), locked_at = null,
          locked_by = null,
          last_error = concat_ws('; ', last_error, 'stale claim recovered'),
          updated_at = now()
      where id = v_stale.id;
    end if;
  end loop;

  return query
  with eligible as (
    select queued.id,
           queued.connection_id,
           queued.entity_type,
           queued.run_after,
           queued.created_at,
           case queued.entity_type
             when 'customer' then 1
             when 'supplier' then 2
             when 'estimate' then 3
             when 'invoice' then 4
             when 'supplier_bill' then 5
             when 'payment' then 6
             when 'supplier_bill_payment' then 7
             else 8
           end as entity_order
    from public.accounting_sync_queue queued
    where queued.provider = p_provider
      and queued.status = 'pending'
      and queued.run_after <= now()
      and queued.provider_accepted_at is null
      and not exists (
        select 1
        from public.accounting_sync_queue older
        where older.connection_id = queued.connection_id
          and older.provider = queued.provider
          and older.entity_type = queued.entity_type
          and older.entity_id = queued.entity_id
          and older.status in ('pending', 'claimed')
          and (older.created_at, older.id) < (queued.created_at, queued.id)
      )
      and (
        nullif(queued.payload_snapshot->>'parentEntityId', '') is null
        or (
          not exists (
            select 1
            from public.accounting_sync_queue parent_active
            where parent_active.connection_id = queued.connection_id
              and parent_active.provider = queued.provider
              and parent_active.entity_type = queued.payload_snapshot->>'parentEntityType'
              and parent_active.entity_id::text = queued.payload_snapshot->>'parentEntityId'
              and parent_active.status in ('pending', 'claimed')
          )
          and (
            nullif(queued.payload_snapshot->>'parentExternalId', '') is not null
            or exists (
              select 1
              from public.accounting_sync_queue parent_done
              where parent_done.connection_id = queued.connection_id
                and parent_done.provider = queued.provider
                and parent_done.entity_type = queued.payload_snapshot->>'parentEntityType'
                and parent_done.entity_id::text = queued.payload_snapshot->>'parentEntityId'
                and parent_done.status = 'succeeded'
                and parent_done.external_id is not null
            )
          )
        )
      )
  ), ranked as (
    select eligible.*,
           row_number() over (
             partition by eligible.connection_id, eligible.entity_type
             order by eligible.run_after, eligible.created_at, eligible.id
           ) as lane_rank
    from eligible
  ), due as (
    select queued.id
    from public.accounting_sync_queue queued
    join ranked on ranked.id = queued.id
    order by ranked.lane_rank, ranked.entity_order,
             ranked.run_after, ranked.created_at, ranked.id
    for update of queued skip locked
    limit least(coalesce(p_limit, 25), 100)
  )
  update public.accounting_sync_queue queued
  set status = 'claimed',
      attempts = queued.attempts + 1,
      locked_at = now(),
      locked_by = coalesce(nullif(btrim(p_worker_id), ''), 'accounting-worker'),
      updated_at = now()
  from due
  where queued.id = due.id
  returning queued.*;
end;
$$;

revoke all on function public.claim_accounting_sync_queue(text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_accounting_sync_queue(text, integer, text, integer)
  to service_role;

create or replace function public.retry_accounting_sync_queue(
  p_queue_id uuid,
  p_worker_id text,
  p_error text,
  p_run_after timestamptz default null
)
returns public.accounting_sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.accounting_sync_queue;
begin
  select * into v_row
  from public.accounting_sync_queue queued
  where queued.id = p_queue_id
    and queued.status = 'claimed'
    and queued.locked_by = p_worker_id
    and queued.provider_accepted_at is null
  for update;
  if not found then
    raise object_not_in_prerequisite_state using
      message = 'retry_accounting_sync_queue: ownership lost or provider already accepted write';
  end if;

  update public.accounting_sync_queue queued
  set status = 'pending',
      run_after = coalesce(p_run_after, now()),
      locked_at = null,
      locked_by = null,
      last_error = nullif(p_error, ''),
      updated_at = now()
  where queued.id = v_row.id
  returning queued.* into v_row;
  return v_row;
exception when unique_violation then
  update public.accounting_sync_queue queued
  set status = 'cancelled',
      locked_at = null,
      locked_by = null,
      last_error = concat_ws('; ', nullif(p_error, ''), 'superseded by pending queue row'),
      updated_at = now()
  where queued.id = p_queue_id
  returning queued.* into v_row;
  return v_row;
end;
$$;

revoke all on function public.retry_accounting_sync_queue(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.retry_accounting_sync_queue(uuid, text, text, timestamptz)
  to service_role;

-- Preserve AP dependency ordering for the supplier queue created by the
-- existing guarded supplier-bill transaction.
create or replace function private.enqueue_supplier_bill_accounting(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation text,
  p_source_table text,
  p_source_action text,
  p_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection record;
  v_parent_entity_type text;
  v_parent_entity_id uuid;
  v_parent_external_id text;
begin
  if current_setting('ops.sync_source', true) in ('quickbooks', 'sage') then
    return;
  end if;
  if p_entity_type = 'supplier_bill' then
    v_parent_entity_type := 'supplier';
    select bill.supplier_id into v_parent_entity_id
    from public.supplier_bills bill
    where bill.id = p_entity_id and bill.company_id = p_company_id;
  elsif p_entity_type = 'supplier_bill_payment' then
    v_parent_entity_type := 'supplier_bill';
    select payment.bill_id into v_parent_entity_id
    from public.supplier_bill_payments payment
    where payment.id = p_entity_id and payment.company_id = p_company_id;
  end if;

  for v_connection in
    select connection.id, connection.provider, connection.provider_environment
    from public.accounting_connections connection
    where connection.company_id = p_company_id::text
      and connection.provider in ('quickbooks', 'sage')
      and connection.is_connected = true
      and connection.sync_enabled = true
      and connection.sync_direction in ('push_only', 'bidirectional')
    order by connection.provider, connection.provider_environment, connection.id
  loop
    v_parent_external_id := null;
    if v_parent_entity_id is not null then
      select link.external_id into v_parent_external_id
      from public.supplier_bill_provider_links link
      where link.connection_id = v_connection.id
        and link.entity_type = v_parent_entity_type
        and link.entity_id = v_parent_entity_id;
    end if;

    insert into public.accounting_sync_queue (
      company_id, connection_id, provider, entity_type, entity_id,
      operation, source_table, source_action, source_updated_at,
      idempotency_key, payload_snapshot
    ) values (
      p_company_id, v_connection.id, v_connection.provider, p_entity_type,
      p_entity_id, p_operation, p_source_table, p_source_action, p_updated_at,
      'supplier-ap:' || p_entity_type || ':' || p_entity_id::text || ':' || p_operation,
      jsonb_build_object(
        'schemaVersion', 2,
        'providerEnvironment', v_connection.provider_environment,
        'parentEntityType', v_parent_entity_type,
        'parentEntityId', v_parent_entity_id,
        'parentExternalId', v_parent_external_id
      )
    ) on conflict (
      company_id, connection_id, provider, entity_type, entity_id,
      operation, idempotency_key
    ) where status = 'pending'
    do update set
      source_updated_at = excluded.source_updated_at,
      payload_snapshot = excluded.payload_snapshot,
      run_after = least(public.accounting_sync_queue.run_after, excluded.run_after),
      updated_at = now();
  end loop;
end;
$$;

revoke all on function private.enqueue_supplier_bill_accounting(uuid, text, uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;

do $$
declare
  v_enqueue text;
  v_claim text;
begin
  select pg_get_functiondef('public.enqueue_accounting_sync()'::regprocedure)
  into v_enqueue;
  select pg_get_functiondef(
    'public.claim_accounting_sync_queue(text, integer, text, integer)'::regprocedure
  ) into v_claim;

  if v_enqueue not ilike '%provider in (''quickbooks'', ''sage'')%'
     or v_enqueue not ilike '%provider_environment%'
     or v_enqueue not ilike '%ops.sync_source%'
     or v_claim not ilike '%provider_accepted_at is null%'
     or v_claim not ilike '%row_number() over%'
     or v_claim not ilike '%parententityid%' then
    raise exception 'sage_queue_hardening_sentinel: queue routing or recovery contract is incomplete';
  end if;

  if has_function_privilege(
    'anon',
    'public.record_accounting_sync_acceptance(uuid,text,text,timestamptz,timestamptz)',
    'execute'
  ) then
    raise exception 'sage_queue_hardening_sentinel: browser can record provider acceptance';
  end if;

  if has_table_privilege('anon', 'public.sage_sales_account_mappings', 'select')
     or has_table_privilege('authenticated', 'public.sage_tax_rate_mappings', 'select')
     or has_table_privilege('anon', 'public.sage_payment_method_mappings', 'insert') then
    raise exception 'sage_queue_hardening_sentinel: browser can access Sage mappings';
  end if;
end;
$$;

commit;
