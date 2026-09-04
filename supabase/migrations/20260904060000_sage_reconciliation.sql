begin;

-- Purchase-account mappings are distinct from sales-account mappings and must
-- be bound to the exact Sage connection. The older generic category mapping
-- lacks an environment/connection identity and is unsafe for Sage writes.
create table if not exists public.sage_purchase_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null
    references public.accounting_connections(id) on delete cascade,
  expense_category_id uuid not null
    references public.expense_categories(id) on delete cascade,
  sage_ledger_account_id text not null
    check (nullif(btrim(sage_ledger_account_id), '') is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, expense_category_id),
  unique (connection_id, sage_ledger_account_id)
);

alter table public.sage_purchase_account_mappings enable row level security;
revoke all on table public.sage_purchase_account_mappings
  from public, anon, authenticated;
grant all on table public.sage_purchase_account_mappings to service_role;
create policy sage_purchase_account_mappings_service_role_only
  on public.sage_purchase_account_mappings
  for all to service_role using (true) with check (true);

-- Payments previously had no mutable timestamp, which made conflict detection
-- impossible after creation. Every local edit now advances an authoritative
-- OPS timestamp before the queue trigger snapshots it.
alter table public.payments
  add column if not exists updated_at timestamptz not null default now();
alter table public.supplier_bill_payments
  add column if not exists updated_at timestamptz not null default now();

create or replace function private.accounting_sync_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists payments_accounting_sync_touch_updated_at
  on public.payments;
create trigger payments_accounting_sync_touch_updated_at
before update on public.payments
for each row execute function private.accounting_sync_touch_updated_at();

drop trigger if exists supplier_bill_payments_accounting_sync_touch_updated_at
  on public.supplier_bill_payments;
create trigger supplier_bill_payments_accounting_sync_touch_updated_at
before update on public.supplier_bill_payments
for each row execute function private.accounting_sync_touch_updated_at();

-- Payment changes are the financial event. Recalculate both the old and new
-- AP parents without emitting a second, derivative supplier-bill sync job.
create or replace function private.accounting_sync_recalculate_supplier_bill_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_bill_id uuid;
  v_total numeric;
  v_paid numeric;
  v_status text;
  v_previous_sync_source text;
begin
  for v_bill_id in
    select distinct candidate.bill_id
    from unnest(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.bill_id else null end,
      case when tg_op in ('INSERT', 'UPDATE') then new.bill_id else null end
    ]) as candidate(bill_id)
    where candidate.bill_id is not null
    order by candidate.bill_id
  loop
    select bill.total, bill.status into v_total, v_status
    from public.supplier_bills bill
    where bill.id = v_bill_id
    for update;
    if not found then
      continue;
    end if;

    select coalesce(sum(payment.amount), 0) into v_paid
    from public.supplier_bill_payments payment
    where payment.bill_id = v_bill_id and payment.voided_at is null;

    v_previous_sync_source := current_setting('ops.sync_source', true);
    perform set_config('ops.sync_source', 'sage', true);
    update public.supplier_bills
    set balance = greatest(v_total - v_paid, 0),
        status = case
          when v_status = 'void' then v_status
          when v_total > 0 and v_paid >= v_total then 'paid'
          when v_paid > 0 then 'partial'
          else 'open'
        end,
        updated_at = clock_timestamp()
    where id = v_bill_id;
    perform set_config(
      'ops.sync_source', coalesce(v_previous_sync_source, ''), true
    );
  end loop;
  return coalesce(new, old);
end;
$$;

drop trigger if exists supplier_bill_payments_recalculate_balance
  on public.supplier_bill_payments;
create trigger supplier_bill_payments_recalculate_balance
after insert or delete or update of bill_id, amount, voided_at
on public.supplier_bill_payments
for each row execute function private.accounting_sync_recalculate_supplier_bill_balance();

alter table public.accounting_sync_events
  drop constraint if exists accounting_sync_events_decision_check;
alter table public.accounting_sync_events
  add constraint accounting_sync_events_decision_check
  check (
    decision is null or decision in (
      'ops_won', 'qb_won', 'sage_won', 'skipped',
      'needs_review', 'retry', 'blocked'
    )
  );

create index if not exists accounting_sync_events_sage_reconcile_candidate_idx
  on public.accounting_sync_events (
    connection_id,
    entity_type,
    external_id,
    created_at desc
  )
  where provider = 'sage'
    and direction = 'reconcile'
    and operation = 'reconcile'
    and source = 'reconcile';

-- One fair candidate list covers all AR and AP lanes. Oldest/unseen work wins,
-- while row_number prevents a large customer lane from starving documents.
create or replace function public.list_sage_reconcile_candidates(
  p_provider_environment text,
  p_limit integer default 25
)
returns table (
  company_id uuid,
  connection_id uuid,
  sync_direction text,
  propagate_deletes boolean,
  entity_type text,
  source_table text,
  entity_id uuid,
  external_id text,
  resource text,
  ops_updated_at timestamptz,
  money_touched boolean,
  last_audit_ops_updated_at timestamptz,
  last_audit_sage_updated_at timestamptz,
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
      message = 'list_sage_reconcile_candidates: invalid provider environment';
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 25), 100));

  return query
  with candidates as (
    select client.company_id, connection.id as connection_id,
      connection.sync_direction, connection.propagate_deletes,
      'customer'::text as entity_type, 'clients'::text as source_table,
      client.id as entity_id, client.sage_id as external_id,
      'contacts'::text as resource, client.updated_at as ops_updated_at,
      false as money_touched, 1 as entity_order
    from public.clients client
    join public.accounting_connections connection
      on connection.company_id = client.company_id::text
    where connection.provider = 'sage'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true and connection.sync_enabled = true
      and connection.sync_direction in ('pull_only', 'bidirectional')
      and client.sage_id is not null and client.deleted_at is null

    union all
    select invoice.company_id, connection.id, connection.sync_direction,
      connection.propagate_deletes, 'invoice', 'invoices', invoice.id,
      invoice.sage_id, 'sales_invoices', invoice.updated_at, true, 2
    from public.invoices invoice
    join public.accounting_connections connection
      on connection.company_id = invoice.company_id::text
    where connection.provider = 'sage'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true and connection.sync_enabled = true
      and connection.sync_direction in ('pull_only', 'bidirectional')
      and invoice.sage_id is not null and invoice.deleted_at is null
      and invoice.status not in ('void', 'written_off')

    union all
    select estimate.company_id, connection.id, connection.sync_direction,
      connection.propagate_deletes, 'estimate', 'estimates', estimate.id,
      estimate.sage_id,
      case when estimate.sage_document_kind = 'sales_estimate'
        then 'sales_estimates' else 'sales_quotes' end,
      estimate.updated_at, true, 3
    from public.estimates estimate
    join public.accounting_connections connection
      on connection.company_id = estimate.company_id::text
    where connection.provider = 'sage'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true and connection.sync_enabled = true
      and connection.sync_direction in ('pull_only', 'bidirectional')
      and estimate.sage_id is not null and estimate.deleted_at is null

    union all
    select payment.company_id, connection.id, connection.sync_direction,
      connection.propagate_deletes, 'payment', 'payments', payment.id,
      payment.sage_id, 'contact_payments', payment.updated_at, true, 4
    from public.payments payment
    join public.accounting_connections connection
      on connection.company_id = payment.company_id::text
    where connection.provider = 'sage'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true and connection.sync_enabled = true
      and connection.sync_direction in ('pull_only', 'bidirectional')
      and payment.sage_id is not null and payment.voided_at is null

    union all
    select supplier.company_id, connection.id, connection.sync_direction,
      connection.propagate_deletes, 'supplier', 'suppliers', supplier.id,
      link.external_id, 'contacts', supplier.updated_at, false, 5
    from public.suppliers supplier
    join public.accounting_connections connection
      on connection.company_id = supplier.company_id::text
    join public.supplier_bill_provider_links link
      on link.company_id = supplier.company_id
     and link.connection_id = connection.id
     and link.provider = 'sage'
     and link.entity_type = 'supplier'
     and link.entity_id = supplier.id
    where connection.provider = 'sage'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true and connection.sync_enabled = true
      and connection.sync_direction in ('pull_only', 'bidirectional')
      and supplier.deleted_at is null

    union all
    select bill.company_id, connection.id, connection.sync_direction,
      connection.propagate_deletes, 'supplier_bill', 'supplier_bills', bill.id,
      link.external_id, 'purchase_invoices', bill.updated_at, true, 6
    from public.supplier_bills bill
    join public.accounting_connections connection
      on connection.company_id = bill.company_id::text
    join public.supplier_bill_provider_links link
      on link.company_id = bill.company_id
     and link.connection_id = connection.id
     and link.provider = 'sage'
     and link.entity_type = 'supplier_bill'
     and link.entity_id = bill.id
    where connection.provider = 'sage'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true and connection.sync_enabled = true
      and connection.sync_direction in ('pull_only', 'bidirectional')
      and bill.deleted_at is null and bill.status <> 'void'

    union all
    select payment.company_id, connection.id, connection.sync_direction,
      connection.propagate_deletes, 'supplier_bill_payment',
      'supplier_bill_payments', payment.id, link.external_id,
      'contact_payments', payment.updated_at, true, 7
    from public.supplier_bill_payments payment
    join public.accounting_connections connection
      on connection.company_id = payment.company_id::text
    join public.supplier_bill_provider_links link
      on link.company_id = payment.company_id
     and link.connection_id = connection.id
     and link.provider = 'sage'
     and link.entity_type = 'supplier_bill_payment'
     and link.entity_id = payment.id
    where connection.provider = 'sage'
      and connection.provider_environment = p_provider_environment
      and connection.is_connected = true and connection.sync_enabled = true
      and connection.sync_direction in ('pull_only', 'bidirectional')
      and payment.voided_at is null
  ), audited as (
    select candidate.*,
      latest.ops_updated_at as last_audit_ops_updated_at,
      latest.qb_updated_at as last_audit_sage_updated_at,
      latest.created_at as last_reconciled_at
    from candidates candidate
    left join lateral (
      select event.ops_updated_at, event.qb_updated_at, event.created_at
      from public.accounting_sync_events event
      where event.connection_id = candidate.connection_id
        and event.provider = 'sage' and event.direction = 'reconcile'
        and event.operation = 'reconcile' and event.source = 'reconcile'
        and event.status in ('succeeded', 'skipped')
        and event.entity_type = candidate.entity_type
        and event.external_id = candidate.external_id
      order by event.created_at desc limit 1
    ) latest on true
  ), ranked as (
    select audited.*,
      row_number() over (
        partition by audited.connection_id, audited.entity_type
        order by audited.last_reconciled_at asc nulls first,
          audited.ops_updated_at asc nulls first, audited.entity_id
      ) as lane_rank
    from audited
  )
  select ranked.company_id, ranked.connection_id, ranked.sync_direction,
    ranked.propagate_deletes, ranked.entity_type, ranked.source_table,
    ranked.entity_id, ranked.external_id, ranked.resource,
    ranked.ops_updated_at, ranked.money_touched,
    ranked.last_audit_ops_updated_at, ranked.last_audit_sage_updated_at,
    ranked.last_reconciled_at
  from ranked
  where ranked.external_id is not null
  order by ranked.last_reconciled_at asc nulls first, ranked.lane_rank,
    ranked.entity_order, ranked.ops_updated_at asc nulls first,
    ranked.entity_id
  limit v_limit;
end;
$$;

revoke all on function public.list_sage_reconcile_candidates(text, integer)
  from public, anon, authenticated;
grant execute on function public.list_sage_reconcile_candidates(text, integer)
  to service_role;

-- Applies exactly one already-linked Sage record under a locked, atomic local
-- transaction. Document headers and all lines commit together. Exact external
-- identity, parent identity, connection identity, and the observed OPS version
-- are rechecked after the provider GET and before any local mutation.
create or replace function public.apply_sage_reconcile_entity(
  p_company_id uuid,
  p_connection_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_external_id text,
  p_expected_ops_updated_at timestamptz,
  p_provider_updated_at timestamptz,
  p_deleted_at timestamptz,
  p_payload jsonb
)
returns table (ops_updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_updated_at timestamptz;
  v_applied_at timestamptz := clock_timestamp();
  v_contact_id text;
  v_parent_id uuid;
  v_line jsonb;
  v_position integer;
  v_line_id uuid;
  v_category_id uuid;
  v_payment_method text;
begin
  if p_company_id is null or p_connection_id is null or p_entity_id is null
     or nullif(btrim(p_external_id), '') is null
     or p_provider_updated_at is null
     or p_entity_type not in (
       'customer', 'invoice', 'estimate', 'payment', 'supplier',
       'supplier_bill', 'supplier_bill_payment'
     ) or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise invalid_parameter_value using
      message = 'apply_sage_reconcile_entity: invalid input';
  end if;
  if not exists (
    select 1 from public.accounting_connections connection
    where connection.id = p_connection_id
      and connection.company_id = p_company_id::text
      and connection.provider = 'sage'
      and connection.is_connected = true
      and connection.sync_enabled = true
      and connection.sync_direction in ('pull_only', 'bidirectional')
      and connection.sage_business_id is not null
  ) then
    raise object_not_in_prerequisite_state using
      message = 'apply_sage_reconcile_entity: exact Sage connection unavailable';
  end if;

  perform set_config('ops.sync_source', 'sage', true);

  if p_entity_type = 'customer' then
    select client.updated_at into v_current_updated_at
    from public.clients client
    where client.id = p_entity_id and client.company_id = p_company_id
      and client.sage_id = p_external_id
    for update;
  elsif p_entity_type = 'invoice' then
    select invoice.updated_at into v_current_updated_at
    from public.invoices invoice
    where invoice.id = p_entity_id and invoice.company_id = p_company_id
      and invoice.sage_id = p_external_id
    for update;
  elsif p_entity_type = 'estimate' then
    select estimate.updated_at into v_current_updated_at
    from public.estimates estimate
    where estimate.id = p_entity_id and estimate.company_id = p_company_id
      and estimate.sage_id = p_external_id
    for update;
  elsif p_entity_type = 'payment' then
    select payment.updated_at into v_current_updated_at
    from public.payments payment
    where payment.id = p_entity_id and payment.company_id = p_company_id
      and payment.sage_id = p_external_id
    for update;
  else
    if p_entity_type = 'supplier' then
      select supplier.updated_at into v_current_updated_at
      from public.suppliers supplier
      where supplier.id = p_entity_id and supplier.company_id = p_company_id
      for update;
    elsif p_entity_type = 'supplier_bill' then
      select bill.updated_at into v_current_updated_at
      from public.supplier_bills bill
      where bill.id = p_entity_id and bill.company_id = p_company_id
      for update;
    else
      select payment.updated_at into v_current_updated_at
      from public.supplier_bill_payments payment
      where payment.id = p_entity_id and payment.company_id = p_company_id
      for update;
    end if;
    if not exists (
      select 1 from public.supplier_bill_provider_links link
      where link.company_id = p_company_id
        and link.connection_id = p_connection_id
        and link.provider = 'sage'
        and link.entity_type = p_entity_type
        and link.entity_id = p_entity_id
        and link.external_id = p_external_id
    ) then
      raise object_not_in_prerequisite_state using
        message = 'apply_sage_reconcile_entity: AP provider identity changed';
    end if;
  end if;

  if v_current_updated_at is null
     or v_current_updated_at is distinct from p_expected_ops_updated_at then
    raise serialization_failure using
      message = 'apply_sage_reconcile_entity: OPS record changed after selection';
  end if;

  if p_deleted_at is not null then
    if p_entity_type = 'customer' then
      update public.clients set deleted_at = p_deleted_at, updated_at = v_applied_at
      where id = p_entity_id and company_id = p_company_id;
    elsif p_entity_type = 'invoice' then
      update public.invoices set deleted_at = p_deleted_at, status = 'void',
        updated_at = v_applied_at
      where id = p_entity_id and company_id = p_company_id;
    elsif p_entity_type = 'estimate' then
      update public.estimates set deleted_at = p_deleted_at,
        updated_at = v_applied_at
      where id = p_entity_id and company_id = p_company_id;
    elsif p_entity_type = 'payment' then
      update public.payments set voided_at = p_deleted_at,
        updated_at = v_applied_at
      where id = p_entity_id and company_id = p_company_id;
    elsif p_entity_type = 'supplier' then
      update public.suppliers set deleted_at = p_deleted_at,
        updated_at = v_applied_at
      where id = p_entity_id and company_id = p_company_id;
    else
      raise check_violation using
        message = 'apply_sage_reconcile_entity: AP financial tombstone needs operator review';
    end if;
  elsif p_entity_type = 'customer' then
    update public.clients set
      name = p_payload->>'name', email = nullif(p_payload->>'email', ''),
      phone_number = nullif(p_payload->>'phone', ''), deleted_at = null,
      updated_at = v_applied_at
    where id = p_entity_id and company_id = p_company_id;
  elsif p_entity_type = 'supplier' then
    update public.suppliers set
      display_name = p_payload->>'name',
      normalized_name = lower(regexp_replace(btrim(p_payload->>'name'), '\s+', ' ', 'g')),
      email = nullif(p_payload->>'email', ''),
      phone = nullif(p_payload->>'phone', ''),
      tax_number = nullif(p_payload->>'taxNumber', ''), deleted_at = null,
      updated_at = v_applied_at
    where id = p_entity_id and company_id = p_company_id;
  elsif p_entity_type in ('invoice', 'estimate') then
    v_contact_id := nullif(p_payload->>'contactId', '');
    select client.id into v_parent_id from public.clients client
    where client.company_id = p_company_id and client.sage_id = v_contact_id
      and client.deleted_at is null;
    if v_parent_id is null then
      raise foreign_key_violation using
        message = 'apply_sage_reconcile_entity: Sage customer link unavailable';
    end if;
    if p_entity_type = 'invoice' then
      if not exists (
        select 1 from public.invoices invoice
        where invoice.id = p_entity_id and invoice.client_id = v_parent_id
      ) then
        raise foreign_key_violation using
          message = 'apply_sage_reconcile_entity: invoice customer changed';
      end if;
      update public.invoices set issue_date = (p_payload->>'issueDate')::date,
        due_date = (p_payload->>'boundaryDate')::date,
        invoice_number = p_payload->>'reference', status = p_payload->>'status',
        subtotal = (p_payload->>'subtotal')::numeric,
        tax_amount = (p_payload->>'taxAmount')::numeric,
        total = (p_payload->>'total')::numeric,
        balance_due = (p_payload->>'outstanding')::numeric,
        amount_paid = (p_payload->>'total')::numeric - (p_payload->>'outstanding')::numeric,
        paid_at = case when p_payload->>'status' = 'paid' then p_provider_updated_at else null end,
        deleted_at = null, updated_at = v_applied_at
      where id = p_entity_id and company_id = p_company_id;
    else
      if not exists (
        select 1 from public.estimates estimate
        where estimate.id = p_entity_id and estimate.client_id = v_parent_id
      ) then
        raise foreign_key_violation using
          message = 'apply_sage_reconcile_entity: estimate customer changed';
      end if;
      update public.estimates set issue_date = (p_payload->>'issueDate')::date,
        expiration_date = (p_payload->>'boundaryDate')::date,
        estimate_number = p_payload->>'reference', status = p_payload->>'status',
        subtotal = (p_payload->>'subtotal')::numeric,
        tax_amount = (p_payload->>'taxAmount')::numeric,
        total = (p_payload->>'total')::numeric,
        sage_document_kind = p_payload->>'sageDocumentKind',
        deleted_at = null, updated_at = v_applied_at
      where id = p_entity_id and company_id = p_company_id;
    end if;

    if jsonb_typeof(p_payload->'lines') <> 'array'
       or jsonb_array_length(p_payload->'lines') = 0 then
      raise invalid_parameter_value using
        message = 'apply_sage_reconcile_entity: document lines missing';
    end if;
    v_position := 0;
    for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
      select line.id into v_line_id from public.line_items line
      where line.company_id = p_company_id
        and line.sort_order = v_position
        and ((p_entity_type = 'invoice' and line.invoice_id = p_entity_id)
          or (p_entity_type = 'estimate' and line.estimate_id = p_entity_id))
      for update;
      if v_line_id is null then
        insert into public.line_items (
          company_id, invoice_id, estimate_id, name, description, quantity,
          unit_price, line_total, sort_order, type, is_taxable
        ) values (
          p_company_id,
          case when p_entity_type = 'invoice' then p_entity_id else null end,
          case when p_entity_type = 'estimate' then p_entity_id else null end,
          v_line->>'description', v_line->>'description',
          (v_line->>'quantity')::numeric, (v_line->>'unitPrice')::numeric,
          (v_line->>'subtotal')::numeric, v_position, 'custom',
          (v_line->>'taxAmount')::numeric > 0
        );
      else
        update public.line_items set name = v_line->>'description',
          description = v_line->>'description',
          quantity = (v_line->>'quantity')::numeric,
          unit_price = (v_line->>'unitPrice')::numeric,
          line_total = (v_line->>'subtotal')::numeric,
          is_taxable = (v_line->>'taxAmount')::numeric > 0
        where id = v_line_id;
      end if;
      v_position := v_position + 1;
      v_line_id := null;
    end loop;
    delete from public.line_items line
    where line.company_id = p_company_id and line.sort_order >= v_position
      and ((p_entity_type = 'invoice' and line.invoice_id = p_entity_id)
        or (p_entity_type = 'estimate' and line.estimate_id = p_entity_id));
  elsif p_entity_type = 'payment' then
    select invoice.id into v_parent_id from public.invoices invoice
    where invoice.company_id = p_company_id
      and invoice.sage_id = p_payload#>>'{allocations,0,artefactId}'
      and invoice.deleted_at is null;
    if v_parent_id is null or not exists (
      select 1 from public.payments payment
      join public.clients client on client.id = payment.client_id
      where payment.id = p_entity_id and payment.company_id = p_company_id
        and client.company_id = p_company_id
        and client.sage_id = p_payload->>'contactId'
    ) then
      raise foreign_key_violation using
        message = 'apply_sage_reconcile_entity: payment dependency changed';
    end if;
    select mapping.payment_method into v_payment_method
    from public.sage_payment_method_mappings mapping
    where mapping.connection_id = p_connection_id
      and mapping.company_id = p_company_id
      and mapping.sage_bank_account_id = p_payload->>'bankAccountId'
      and (mapping.sage_payment_method_id is null
        or mapping.sage_payment_method_id = p_payload->>'paymentMethodId')
    order by (mapping.sage_payment_method_id is not null) desc limit 1;
    if v_payment_method is null then
      raise foreign_key_violation using
        message = 'apply_sage_reconcile_entity: payment mapping unavailable';
    end if;
    update public.payments set invoice_id = v_parent_id,
      amount = (p_payload->>'amount')::numeric,
      payment_date = (p_payload->>'date')::date,
      reference_number = nullif(p_payload->>'reference', ''),
      payment_method = v_payment_method, voided_at = null,
      updated_at = v_applied_at
    where id = p_entity_id and company_id = p_company_id;
  elsif p_entity_type = 'supplier_bill' then
    v_contact_id := nullif(p_payload->>'contactId', '');
    select supplier.id into v_parent_id
    from public.suppliers supplier
    join public.supplier_bill_provider_links link
      on link.company_id = supplier.company_id
     and link.entity_type = 'supplier' and link.entity_id = supplier.id
    where supplier.company_id = p_company_id
      and link.connection_id = p_connection_id and link.provider = 'sage'
      and link.external_id = v_contact_id and supplier.deleted_at is null;
    if v_parent_id is null or not exists (
      select 1 from public.supplier_bills bill
      where bill.id = p_entity_id and bill.supplier_id = v_parent_id
    ) then
      raise foreign_key_violation using
        message = 'apply_sage_reconcile_entity: supplier bill dependency changed';
    end if;
    update public.supplier_bills set
      invoice_number = p_payload->>'reference',
      normalized_invoice_number = upper(regexp_replace(btrim(p_payload->>'reference'), '\s+', ' ', 'g')),
      invoice_date = (p_payload->>'invoiceDate')::date,
      due_date = (p_payload->>'dueDate')::date,
      currency = upper(p_payload->>'currency'),
      subtotal = (p_payload->>'subtotal')::numeric,
      tax_total = (p_payload->>'taxTotal')::numeric,
      total = (p_payload->>'total')::numeric,
      balance = (p_payload->>'balance')::numeric,
      status = p_payload->>'status', deleted_at = null,
      updated_at = v_applied_at
    where id = p_entity_id and company_id = p_company_id;

    if jsonb_typeof(p_payload->'lines') <> 'array'
       or jsonb_array_length(p_payload->'lines') = 0 then
      raise invalid_parameter_value using
        message = 'apply_sage_reconcile_entity: supplier bill lines missing';
    end if;
    v_position := 1;
    for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
      select mapping.expense_category_id into v_category_id
      from public.sage_purchase_account_mappings mapping
      where mapping.connection_id = p_connection_id
        and mapping.company_id = p_company_id
        and mapping.sage_ledger_account_id = v_line->>'ledgerAccountId';
      if v_category_id is null or not exists (
        select 1 from public.supplier_bill_tax_mappings mapping
        where mapping.connection_id = p_connection_id
          and mapping.company_id = p_company_id and mapping.provider = 'sage'
          and mapping.external_tax_code_id = v_line->>'taxRateId'
          and mapping.tax_rate = (v_line->>'taxRate')::numeric
      ) then
        raise foreign_key_violation using
          message = 'apply_sage_reconcile_entity: purchase line mapping unavailable';
      end if;
      select line.id into v_line_id from public.supplier_bill_line_items line
      where line.company_id = p_company_id and line.bill_id = p_entity_id
        and line.position = v_position for update;
      if v_line_id is null then
        insert into public.supplier_bill_line_items (
          company_id, bill_id, category_id, position, description, quantity,
          unit_price, subtotal, tax_amount, tax_rate, total
        ) values (
          p_company_id, p_entity_id, v_category_id, v_position,
          v_line->>'description', (v_line->>'quantity')::numeric,
          (v_line->>'unitPrice')::numeric, (v_line->>'subtotal')::numeric,
          (v_line->>'taxAmount')::numeric, (v_line->>'taxRate')::numeric,
          (v_line->>'total')::numeric
        );
      else
        update public.supplier_bill_line_items set category_id = v_category_id,
          description = v_line->>'description',
          quantity = (v_line->>'quantity')::numeric,
          unit_price = (v_line->>'unitPrice')::numeric,
          subtotal = (v_line->>'subtotal')::numeric,
          tax_amount = (v_line->>'taxAmount')::numeric,
          tax_rate = (v_line->>'taxRate')::numeric,
          total = (v_line->>'total')::numeric
        where id = v_line_id;
      end if;
      v_position := v_position + 1;
      v_line_id := null;
      v_category_id := null;
    end loop;
    delete from public.supplier_bill_line_items line
    where line.company_id = p_company_id and line.bill_id = p_entity_id
      and line.position >= v_position;
  else
    select bill.id into v_parent_id
    from public.supplier_bills bill
    join public.supplier_bill_provider_links link
      on link.company_id = bill.company_id
     and link.entity_type = 'supplier_bill' and link.entity_id = bill.id
    where bill.company_id = p_company_id
      and link.connection_id = p_connection_id and link.provider = 'sage'
      and link.external_id = p_payload#>>'{allocations,0,artefactId}';
    if v_parent_id is null or not exists (
      select 1 from public.supplier_bill_payments payment
      where payment.id = p_entity_id and payment.company_id = p_company_id
    ) then
      raise foreign_key_violation using
        message = 'apply_sage_reconcile_entity: supplier payment dependency changed';
    end if;
    select mapping.payment_method into v_payment_method
    from public.supplier_bill_payment_account_mappings mapping
    where mapping.connection_id = p_connection_id
      and mapping.company_id = p_company_id and mapping.provider = 'sage'
      and mapping.external_account_id = p_payload->>'bankAccountId'
      and (mapping.external_payment_method_id is null
        or mapping.external_payment_method_id = p_payload->>'paymentMethodId')
    order by (mapping.external_payment_method_id is not null) desc limit 1;
    if v_payment_method is null then
      raise foreign_key_violation using
        message = 'apply_sage_reconcile_entity: supplier payment mapping unavailable';
    end if;
    update public.supplier_bill_payments set
      bill_id = v_parent_id, amount = (p_payload->>'amount')::numeric,
      payment_date = (p_payload->>'date')::date,
      reference = nullif(p_payload->>'reference', ''),
      payment_method = v_payment_method, voided_at = null,
      updated_at = v_applied_at
    where id = p_entity_id and company_id = p_company_id;
  end if;

  if p_entity_type in ('supplier', 'supplier_bill', 'supplier_bill_payment') then
    update public.supplier_bill_provider_links set
      provider_updated_at = p_provider_updated_at, updated_at = v_applied_at
    where company_id = p_company_id and connection_id = p_connection_id
      and provider = 'sage' and entity_type = p_entity_type
      and entity_id = p_entity_id and external_id = p_external_id;
  end if;

  if p_entity_type = 'customer' then
    select updated_at into v_applied_at from public.clients where id = p_entity_id;
  elsif p_entity_type = 'invoice' then
    select updated_at into v_applied_at from public.invoices where id = p_entity_id;
  elsif p_entity_type = 'estimate' then
    select updated_at into v_applied_at from public.estimates where id = p_entity_id;
  elsif p_entity_type = 'payment' then
    select updated_at into v_applied_at from public.payments where id = p_entity_id;
  elsif p_entity_type = 'supplier' then
    select updated_at into v_applied_at from public.suppliers where id = p_entity_id;
  elsif p_entity_type = 'supplier_bill' then
    select updated_at into v_applied_at from public.supplier_bills where id = p_entity_id;
  else
    select updated_at into v_applied_at
    from public.supplier_bill_payments where id = p_entity_id;
  end if;
  return query select v_applied_at;
end;
$$;

revoke all on function public.apply_sage_reconcile_entity(
  uuid, uuid, text, uuid, text, timestamptz, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_sage_reconcile_entity(
  uuid, uuid, text, uuid, text, timestamptz, timestamptz, timestamptz, jsonb
) to service_role;

do $$
begin
  if has_function_privilege(
    'anon', 'public.list_sage_reconcile_candidates(text,integer)', 'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.apply_sage_reconcile_entity(uuid,uuid,text,uuid,text,timestamptz,timestamptz,timestamptz,jsonb)',
    'execute'
  ) or has_table_privilege(
    'anon', 'public.sage_purchase_account_mappings', 'select'
  ) then
    raise exception 'sage_reconciliation_sentinel: browser privilege leak';
  end if;
end;
$$;

commit;
