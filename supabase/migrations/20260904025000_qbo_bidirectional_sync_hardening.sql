begin;

-- Keep payment-derived invoice balances correct without echoing those derived
-- changes back to QuickBooks as redundant invoice writes.
create or replace function public.update_invoice_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_invoice_id uuid;
  v_total_paid numeric(12,2);
  v_invoice_total numeric(12,2);
  v_invoice_status text;
  v_due_date date;
  v_paid_at timestamptz;
  v_previous_sync_source text;
begin
  for v_invoice_id in
    select distinct candidate.invoice_id
    from unnest(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.invoice_id else null end,
      case when tg_op in ('INSERT', 'UPDATE') then new.invoice_id else null end
    ]) as candidate(invoice_id)
    where candidate.invoice_id is not null
    order by candidate.invoice_id
  loop
    select total, status, due_date, paid_at
    into v_invoice_total, v_invoice_status, v_due_date, v_paid_at
    from public.invoices
    where id = v_invoice_id
    for update;

    if not found then
      continue;
    end if;

    select coalesce(sum(amount), 0)
    into v_total_paid
    from public.payments
    where invoice_id = v_invoice_id
      and voided_at is null;

    v_previous_sync_source := current_setting('ops.sync_source', true);
    perform set_config('ops.sync_source', 'quickbooks', true);

    update public.invoices
    set amount_paid = v_total_paid,
        balance_due = greatest(v_invoice_total - v_total_paid, 0),
        status = case
          when v_invoice_status in ('void', 'written_off') then v_invoice_status
          when v_invoice_total > 0 and v_total_paid >= v_invoice_total then 'paid'
          when v_total_paid > 0 then 'partially_paid'
          when v_invoice_status in ('draft', 'sent') then v_invoice_status
          when v_due_date is not null and v_due_date < current_date then 'past_due'
          else 'awaiting_payment'
        end,
        paid_at = case
          when v_invoice_status in ('void', 'written_off') then v_paid_at
          when v_invoice_total > 0 and v_total_paid >= v_invoice_total then coalesce(v_paid_at, now())
          else null
        end,
        updated_at = now()
    where id = v_invoice_id;

    perform set_config('ops.sync_source', coalesce(v_previous_sync_source, ''), true);
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_payment_balance on public.payments;
create trigger trg_payment_balance
  after insert or delete or update of invoice_id, amount, voided_at on public.payments
  for each row execute function public.update_invoice_balance();

-- Preserve stale-claim recovery while enforcing create-before-update ordering
-- for each provider entity. A dependent row stays pending until its create is
-- complete (or the row is explicitly linked to an existing provider object).
create index if not exists accounting_sync_queue_create_dependency_idx
  on public.accounting_sync_queue (
    company_id,
    connection_id,
    provider,
    entity_type,
    entity_id,
    status
  )
  where operation = 'create';

create or replace function public.claim_accounting_sync_queue(
  p_provider text default 'quickbooks',
  p_limit integer default 25,
  p_worker_id text default 'qbo-worker',
  p_stale_after_seconds integer default 900
)
returns setof public.accounting_sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stale public.accounting_sync_queue;
  v_existing_pending_id uuid;
  v_stale_after_seconds integer := greatest(1, least(coalesce(p_stale_after_seconds, 900), 86400));
  v_error text;
begin
  if coalesce(p_limit, 25) <= 0 then
    return;
  end if;

  for v_stale in
    select *
    from public.accounting_sync_queue
    where provider = p_provider
      and status = 'claimed'
      and locked_at is not null
      and locked_at < now() - make_interval(secs => v_stale_after_seconds)
    order by locked_at asc, created_at asc
    for update skip locked
  loop
    select pending.id
    into v_existing_pending_id
    from public.accounting_sync_queue pending
    where pending.company_id = v_stale.company_id
      and pending.provider = v_stale.provider
      and pending.connection_id = v_stale.connection_id
      and pending.entity_type = v_stale.entity_type
      and pending.entity_id = v_stale.entity_id
      and pending.operation = v_stale.operation
      and pending.idempotency_key = v_stale.idempotency_key
      and pending.status = 'pending'
      and pending.id <> v_stale.id
      and pending.created_at > v_stale.created_at
    order by pending.created_at desc
    limit 1;

    if v_existing_pending_id is not null then
      v_error := 'stale claim superseded by newer pending queue row ' || v_existing_pending_id::text;

      update public.accounting_sync_queue
      set status = 'cancelled',
          locked_at = null,
          locked_by = null,
          last_error = concat_ws('; ', nullif(v_stale.last_error, ''), v_error),
          updated_at = now()
      where id = v_stale.id;

      insert into public.accounting_sync_events (
        queue_id, company_id, connection_id, provider, direction, entity_type,
        entity_id, external_id, operation, status, source, decision,
        before_snapshot, after_snapshot, error
      )
      values (
        v_stale.id, v_stale.company_id, v_stale.connection_id, v_stale.provider,
        'system', v_stale.entity_type, v_stale.entity_id::text,
        v_stale.external_id, v_stale.operation, 'skipped', 'system', 'skipped',
        to_jsonb(v_stale),
        jsonb_build_object('status', 'cancelled', 'supersededQueueId', v_existing_pending_id),
        v_error
      );
    else
      v_error := 'stale claim recovered';

      begin
        update public.accounting_sync_queue
        set status = 'pending',
            run_after = now(),
            locked_at = null,
            locked_by = null,
            last_error = concat_ws('; ', nullif(v_stale.last_error, ''), v_error),
            updated_at = now()
        where id = v_stale.id;

        insert into public.accounting_sync_events (
          queue_id, company_id, connection_id, provider, direction, entity_type,
          entity_id, external_id, operation, status, source, decision,
          before_snapshot, after_snapshot, error
        )
        values (
          v_stale.id, v_stale.company_id, v_stale.connection_id, v_stale.provider,
          'system', v_stale.entity_type, v_stale.entity_id::text,
          v_stale.external_id, v_stale.operation, 'skipped', 'system', 'retry',
          to_jsonb(v_stale),
          jsonb_build_object('status', 'pending', 'runAfter', now()),
          v_error
        );
      exception when unique_violation then
        select pending.id
        into v_existing_pending_id
        from public.accounting_sync_queue pending
        where pending.company_id = v_stale.company_id
          and pending.provider = v_stale.provider
          and pending.connection_id = v_stale.connection_id
          and pending.entity_type = v_stale.entity_type
          and pending.entity_id = v_stale.entity_id
          and pending.operation = v_stale.operation
          and pending.idempotency_key = v_stale.idempotency_key
          and pending.status = 'pending'
          and pending.id <> v_stale.id
          and pending.created_at > v_stale.created_at
        order by pending.created_at desc
        limit 1;

        v_error := 'stale claim superseded by newer pending queue row ' || coalesce(v_existing_pending_id::text, 'unknown');

        update public.accounting_sync_queue
        set status = 'cancelled',
            locked_at = null,
            locked_by = null,
            last_error = concat_ws('; ', nullif(v_stale.last_error, ''), v_error),
            updated_at = now()
        where id = v_stale.id;

        insert into public.accounting_sync_events (
          queue_id, company_id, connection_id, provider, direction, entity_type,
          entity_id, external_id, operation, status, source, decision,
          before_snapshot, after_snapshot, error
        )
        values (
          v_stale.id, v_stale.company_id, v_stale.connection_id, v_stale.provider,
          'system', v_stale.entity_type, v_stale.entity_id::text,
          v_stale.external_id, v_stale.operation, 'skipped', 'system', 'skipped',
          to_jsonb(v_stale),
          jsonb_build_object('status', 'cancelled', 'supersededQueueId', v_existing_pending_id),
          v_error
        );
      end;
    end if;
  end loop;

  return query
  with due as (
    select queued.id
    from public.accounting_sync_queue queued
    where queued.provider = p_provider
      and queued.status = 'pending'
      and queued.run_after <= now()
      and (
        queued.operation = 'create'
        or (
          not exists (
            select 1
            from public.accounting_sync_queue unfinished_create
            where unfinished_create.company_id = queued.company_id
              and unfinished_create.connection_id = queued.connection_id
              and unfinished_create.provider = queued.provider
              and unfinished_create.entity_type = queued.entity_type
              and unfinished_create.entity_id = queued.entity_id
              and unfinished_create.operation = 'create'
              and unfinished_create.status in ('pending', 'claimed')
          )
          and (
            queued.external_id is not null
            or not exists (
              select 1
              from public.accounting_sync_queue any_create
              where any_create.company_id = queued.company_id
                and any_create.connection_id = queued.connection_id
                and any_create.provider = queued.provider
                and any_create.entity_type = queued.entity_type
                and any_create.entity_id = queued.entity_id
                and any_create.operation = 'create'
            )
            or exists (
              select 1
              from public.accounting_sync_queue succeeded_create
              where succeeded_create.company_id = queued.company_id
                and succeeded_create.connection_id = queued.connection_id
                and succeeded_create.provider = queued.provider
                and succeeded_create.entity_type = queued.entity_type
                and succeeded_create.entity_id = queued.entity_id
                and succeeded_create.operation = 'create'
                and succeeded_create.status = 'succeeded'
            )
          )
        )
      )
    order by
      case when queued.operation = 'create' then 0 else 1 end,
      queued.run_after asc,
      queued.created_at asc
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

revoke all on function public.claim_accounting_sync_queue(text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_accounting_sync_queue(text, integer, text, integer)
  to service_role;

-- Reconcile candidates are selected once, across every active entity lane.
-- Oldest/unseen records advance first, preventing customer-heavy companies from
-- consuming the whole batch and filtering tombstoned records before QBO reads.
create index if not exists accounting_sync_events_qbo_reconcile_candidate_idx
  on public.accounting_sync_events (
    connection_id,
    entity_type,
    external_id,
    created_at desc
  )
  where provider = 'quickbooks'
    and direction = 'reconcile'
    and operation = 'reconcile'
    and source = 'reconcile';

create or replace function public.list_quickbooks_reconcile_candidates(
  p_provider_environment text,
  p_limit integer default 25
)
returns table (
  company_id uuid,
  connection_id uuid,
  last_sync_at timestamptz,
  entity_type text,
  source_table text,
  entity_id uuid,
  external_id text,
  ops_updated_at timestamptz,
  money_touched boolean,
  last_audit_ops_updated_at timestamptz,
  last_audit_qb_updated_at timestamptz,
  last_reconciled_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer;
begin
  if p_provider_environment is null
    or p_provider_environment not in ('production', 'sandbox') then
    raise check_violation using
      message = 'list_quickbooks_reconcile_candidates: invalid provider environment';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 25), 100));

  return query
  with candidates as (
    select
      client.company_id,
      connection.id as connection_id,
      connection.last_sync_at,
      'customer'::text as entity_type,
      'clients'::text as source_table,
      client.id as entity_id,
      client.qb_id as external_id,
      client.updated_at as ops_updated_at,
      false as money_touched,
      1 as entity_order
    from public.clients client
    join public.accounting_connections connection
      on connection.company_id = client.company_id::text
    where connection.provider = 'quickbooks'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true
      and connection.sync_enabled = true
      and connection.sync_direction = 'bidirectional'
      and client.qb_id is not null
      and client.deleted_at is null

    union all

    select
      invoice.company_id,
      connection.id,
      connection.last_sync_at,
      'invoice'::text,
      'invoices'::text,
      invoice.id,
      invoice.qb_id,
      invoice.updated_at,
      true,
      2
    from public.invoices invoice
    join public.accounting_connections connection
      on connection.company_id = invoice.company_id::text
    where connection.provider = 'quickbooks'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true
      and connection.sync_enabled = true
      and connection.sync_direction = 'bidirectional'
      and invoice.qb_id is not null
      and invoice.deleted_at is null
      and invoice.status not in ('void', 'written_off')

    union all

    select
      estimate.company_id,
      connection.id,
      connection.last_sync_at,
      'estimate'::text,
      'estimates'::text,
      estimate.id,
      estimate.qb_id,
      estimate.updated_at,
      true,
      3
    from public.estimates estimate
    join public.accounting_connections connection
      on connection.company_id = estimate.company_id::text
    where connection.provider = 'quickbooks'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true
      and connection.sync_enabled = true
      and connection.sync_direction = 'bidirectional'
      and estimate.qb_id is not null
      and estimate.deleted_at is null

    union all

    select
      payment.company_id,
      connection.id,
      connection.last_sync_at,
      'payment'::text,
      'payments'::text,
      payment.id,
      nullif(split_part(payment.qb_id, ':', 1), ''),
      payment.created_at,
      true,
      4
    from public.payments payment
    join public.accounting_connections connection
      on connection.company_id = payment.company_id::text
    where connection.provider = 'quickbooks'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true
      and connection.sync_enabled = true
      and connection.sync_direction = 'bidirectional'
      and payment.qb_id is not null
      and payment.voided_at is null
  ), with_latest_audit as (
    select
      candidate.*,
      latest.ops_updated_at as last_audit_ops_updated_at,
      latest.qb_updated_at as last_audit_qb_updated_at,
      latest.created_at as last_reconciled_at
    from candidates candidate
    left join lateral (
      select event.ops_updated_at, event.qb_updated_at, event.created_at
      from public.accounting_sync_events event
      where event.connection_id = candidate.connection_id
        and event.provider = 'quickbooks'
        and event.direction = 'reconcile'
        and event.operation = 'reconcile'
        and event.source = 'reconcile'
        and event.entity_type = candidate.entity_type
        and event.external_id = candidate.external_id
      order by event.created_at desc
      limit 1
    ) latest on true
  ), ranked as (
    select
      audited.*,
      row_number() over (
        partition by audited.connection_id, audited.entity_type
        order by
          audited.last_reconciled_at asc nulls first,
          audited.ops_updated_at asc nulls first,
          audited.entity_id
      ) as lane_rank
    from with_latest_audit audited
  )
  select
    ranked.company_id,
    ranked.connection_id,
    ranked.last_sync_at,
    ranked.entity_type,
    ranked.source_table,
    ranked.entity_id,
    ranked.external_id,
    ranked.ops_updated_at,
    ranked.money_touched,
    ranked.last_audit_ops_updated_at,
    ranked.last_audit_qb_updated_at,
    ranked.last_reconciled_at
  from ranked
  where ranked.external_id is not null
  order by
    ranked.last_reconciled_at asc nulls first,
    ranked.lane_rank,
    ranked.entity_order,
    ranked.ops_updated_at asc nulls first,
    ranked.entity_id
  limit v_limit;
end;
$$;

revoke all on function public.list_quickbooks_reconcile_candidates(text, integer)
  from public, anon, authenticated;
grant execute on function public.list_quickbooks_reconcile_candidates(text, integer)
  to service_role;

commit;
