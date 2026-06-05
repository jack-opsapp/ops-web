begin;

create table if not exists public.accounting_sync_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null default 'quickbooks' check (provider in ('quickbooks')),
  entity_type text not null check (entity_type in ('customer', 'invoice', 'estimate', 'payment')),
  entity_id uuid not null,
  external_id text null,
  operation text not null check (operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'link', 'reconcile')),
  source_table text not null check (source_table in ('clients', 'sub_clients', 'invoices', 'estimates', 'payments', 'line_items')),
  source_action text not null check (source_action in ('insert', 'update', 'delete', 'soft_delete', 'void')),
  source_updated_at timestamptz null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'succeeded', 'failed', 'blocked', 'needs_review', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  last_error text null,
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists accounting_sync_queue_active_uniq
  on public.accounting_sync_queue (
    company_id,
    provider,
    entity_type,
    entity_id,
    operation,
    idempotency_key
  )
  where status = 'pending';

create index if not exists accounting_sync_queue_due_idx
  on public.accounting_sync_queue (provider, status, run_after, created_at)
  where status = 'pending';

create table if not exists public.accounting_sync_events (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid null references public.accounting_sync_queue(id) on delete set null,
  company_id uuid not null,
  connection_id uuid null references public.accounting_connections(id) on delete set null,
  provider text not null default 'quickbooks' check (provider in ('quickbooks')),
  direction text not null check (direction in ('ops_to_qb', 'qb_to_ops', 'reconcile', 'system')),
  entity_type text not null check (entity_type in ('customer', 'invoice', 'estimate', 'payment')),
  entity_id text null,
  external_id text null,
  operation text not null check (operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'link', 'reconcile')),
  status text not null check (status in ('succeeded', 'failed', 'blocked', 'needs_review', 'skipped')),
  source text not null check (source in ('trigger', 'worker', 'webhook', 'reconcile', 'operator')),
  ops_updated_at timestamptz null,
  qb_updated_at timestamptz null,
  decision text null check (decision is null or decision in ('ops_won', 'qb_won', 'skipped', 'needs_review', 'retry', 'blocked')),
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  error text null,
  created_at timestamptz not null default now()
);

alter table public.accounting_sync_queue enable row level security;
alter table public.accounting_sync_events enable row level security;

drop policy if exists accounting_sync_queue_service_role_only on public.accounting_sync_queue;
create policy accounting_sync_queue_service_role_only
  on public.accounting_sync_queue
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists accounting_sync_events_service_role_only on public.accounting_sync_events;
create policy accounting_sync_events_service_role_only
  on public.accounting_sync_events
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.claim_accounting_sync_queue(
  p_provider text default 'quickbooks',
  p_limit integer default 25,
  p_worker_id text default 'qbo-worker'
)
returns setof public.accounting_sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(p_limit, 25) <= 0 then
    return;
  end if;

  return query
  with due as (
    select id
    from public.accounting_sync_queue
    where provider = p_provider
      and status = 'pending'
      and run_after <= now()
    order by run_after asc, created_at asc
    for update skip locked
    limit least(coalesce(p_limit, 25), 100)
  )
  update public.accounting_sync_queue q
  set status = 'claimed',
      attempts = q.attempts + 1,
      locked_at = now(),
      locked_by = coalesce(nullif(p_worker_id, ''), 'qbo-worker'),
      updated_at = now()
  from due
  where q.id = due.id
  returning q.*;
end;
$$;

revoke all on function public.claim_accounting_sync_queue(text, integer, text) from public, anon, authenticated;
grant execute on function public.claim_accounting_sync_queue(text, integer, text) to service_role;

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
  v_existing_pending_id uuid;
begin
  select *
  into v_row
  from public.accounting_sync_queue
  where id = p_queue_id
    and status = 'claimed'
    and locked_by = p_worker_id
  for update;

  if not found then
    raise exception 'retry_accounting_sync_queue: claimed row not found or lock owner mismatch';
  end if;

  select id
  into v_existing_pending_id
  from public.accounting_sync_queue
  where company_id = v_row.company_id
    and provider = v_row.provider
    and entity_type = v_row.entity_type
    and entity_id = v_row.entity_id
    and operation = v_row.operation
    and idempotency_key = v_row.idempotency_key
    and status = 'pending'
    and id <> v_row.id
  order by created_at desc
  limit 1;

  if v_existing_pending_id is not null then
    update public.accounting_sync_queue
    set status = 'cancelled',
        locked_at = null,
        locked_by = null,
        last_error = concat_ws(
          '; ',
          nullif(p_error, ''),
          'superseded by newer pending queue row ' || v_existing_pending_id::text
        ),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;

    return v_row;
  end if;

  begin
    update public.accounting_sync_queue
    set status = 'pending',
        run_after = coalesce(p_run_after, now()),
        locked_at = null,
        locked_by = null,
        last_error = p_error,
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  exception when unique_violation then
    select id
    into v_existing_pending_id
    from public.accounting_sync_queue
    where company_id = v_row.company_id
      and provider = v_row.provider
      and entity_type = v_row.entity_type
      and entity_id = v_row.entity_id
      and operation = v_row.operation
      and idempotency_key = v_row.idempotency_key
      and status = 'pending'
      and id <> v_row.id
    order by created_at desc
    limit 1;

    update public.accounting_sync_queue
    set status = 'cancelled',
        locked_at = null,
        locked_by = null,
        last_error = concat_ws(
          '; ',
          nullif(p_error, ''),
          'superseded by newer pending queue row ' || coalesce(v_existing_pending_id::text, 'unknown')
        ),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  end;

  return v_row;
end;
$$;

revoke all on function public.retry_accounting_sync_queue(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.retry_accounting_sync_queue(uuid, text, text, timestamptz) to service_role;

create or replace function public.set_ops_sync_source(p_source text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('ops.sync_source', p_source, true);
end;
$$;

revoke all on function public.set_ops_sync_source(text) from public, anon, authenticated;
grant execute on function public.set_ops_sync_source(text) to service_role;

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

  select id, propagate_deletes
  into v_connection_id, v_propagate_deletes
  from public.accounting_connections
  where company_id = v_company_id::text
    and provider = 'quickbooks'
    and is_connected = true
    and sync_direction <> 'pull_only'
  order by updated_at desc nulls last
  limit 1;

  if v_connection_id is null then
    return coalesce(new, old);
  end if;

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
  on conflict (company_id, provider, entity_type, entity_id, operation, idempotency_key)
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

drop trigger if exists trg_accounting_sync_queue_clients on public.clients;
create trigger trg_accounting_sync_queue_clients
  after insert or update on public.clients
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_sub_clients on public.sub_clients;
create trigger trg_accounting_sync_queue_sub_clients
  after insert or update on public.sub_clients
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_invoices on public.invoices;
create trigger trg_accounting_sync_queue_invoices
  after insert or update on public.invoices
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_estimates on public.estimates;
create trigger trg_accounting_sync_queue_estimates
  after insert or update on public.estimates
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_payments on public.payments;
create trigger trg_accounting_sync_queue_payments
  after insert or update on public.payments
  for each row execute function public.enqueue_accounting_sync();

drop trigger if exists trg_accounting_sync_queue_line_items on public.line_items;
create trigger trg_accounting_sync_queue_line_items
  after insert or update or delete on public.line_items
  for each row execute function public.enqueue_accounting_sync();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'accounting_sync_queue') then
    raise exception 'qbo_p2_sync_queue_sentinel: queue table missing';
  end if;

  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'accounting_sync_events') then
    raise exception 'qbo_p2_sync_queue_sentinel: events table missing';
  end if;

  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'claim_accounting_sync_queue') then
    raise exception 'qbo_p2_sync_queue_sentinel: claim rpc missing';
  end if;

  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'retry_accounting_sync_queue') then
    raise exception 'qbo_p2_sync_queue_sentinel: retry rpc missing';
  end if;

  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_ops_sync_source') then
    raise exception 'qbo_p2_sync_queue_sentinel: sync source helper missing';
  end if;
end $$;

commit;
