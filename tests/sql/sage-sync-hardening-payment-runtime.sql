insert into public.accounting_connections (
  id, company_id, provider, provider_environment, is_connected, sync_enabled,
  sync_direction, propagate_deletes, sage_business_id,
  sage_business_id_lookup, sage_business_name
) values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'sage', 'sandbox', true, true, 'bidirectional', true,
  'encrypted-business-a', repeat('a', 64), 'Sandbox A'
);

begin;
set local ops.sync_source = 'sage';
insert into public.clients (
  id, company_id, name, sage_id, updated_at
) values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Payment customer', 'sage-customer-1', '2026-09-04T08:00:00Z'
);
insert into public.invoices (
  id, company_id, client_id, sage_id, invoice_number, issue_date, due_date,
  subtotal, total, balance_due, amount_paid, status, updated_at
) values
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', 'sage-invoice-old',
    'INV-OLD', '2026-09-01', '2026-10-01', 100, 100, 100, 0,
    'awaiting_payment', '2026-09-04T08:00:00Z'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001', 'sage-invoice-new',
    'INV-NEW', '2026-09-02', '2026-10-02', 100, 100, 100, 0,
    'awaiting_payment', '2026-09-04T08:00:00Z'
  );
insert into public.payments (
  id, company_id, invoice_id, client_id, sage_id, amount, payment_date,
  payment_method, updated_at
) values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 'sage-payment-raw-id', 40,
  '2026-09-03', 'eft', '2026-09-04T08:00:00Z'
);
commit;

insert into public.sage_payment_method_mappings (
  company_id, connection_id, payment_method, sage_bank_account_id,
  sage_payment_method_id
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'eft', 'sage-bank-1', 'EFT'
);

truncate public.accounting_sync_events, public.accounting_sync_queue;

-- Reconciliation must expose the raw provider payment id, never a composed
-- invoice/payment identity inherited from the old QuickBooks convention.
do $$
begin
  if not exists (
    select 1 from public.list_sage_reconcile_candidates('sandbox', 100)
    where entity_type = 'payment'
      and external_id = 'sage-payment-raw-id'
  ) then
    raise exception 'sage_payment_runtime: raw external payment id was lost';
  end if;
end;
$$;

-- Move the provider allocation. The payment row changes parent once, both
-- invoice balances recalculate, and every derivative update remains silent.
select * from public.apply_sage_reconcile_entity(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'payment',
  '50000000-0000-0000-0000-000000000001', 'sage-payment-raw-id',
  '2026-09-04T08:00:00Z', '2026-09-04T08:05:00Z', null,
  '{
    "contactId":"sage-customer-1",
    "date":"2026-09-04",
    "amount":40,
    "bankAccountId":"sage-bank-1",
    "paymentMethodId":"EFT",
    "reference":"MOVE-1",
    "allocations":[{"artefactId":"sage-invoice-new","amount":40}]
  }'::jsonb
);

do $$
declare
  v_old public.invoices;
  v_new public.invoices;
  v_payment public.payments;
begin
  select * into strict v_old from public.invoices
  where id = '40000000-0000-0000-0000-000000000001';
  select * into strict v_new from public.invoices
  where id = '40000000-0000-0000-0000-000000000002';
  select * into strict v_payment from public.payments
  where id = '50000000-0000-0000-0000-000000000001';
  if v_payment.invoice_id <> '40000000-0000-0000-0000-000000000002'
     or v_payment.reference_number <> 'MOVE-1'
     or v_old.amount_paid <> 0 or v_old.balance_due <> 100
     or v_new.amount_paid <> 40 or v_new.balance_due <> 60
     or v_new.status <> 'partially_paid'
     or exists (select 1 from public.accounting_sync_queue) then
    raise exception 'sage_payment_runtime: atomic payment move failed';
  end if;
end;
$$;

-- A provider tombstone restores the newly allocated invoice in the same
-- suppressed transaction.
do $$
declare
  v_expected timestamptz;
begin
  select updated_at into strict v_expected from public.payments
  where id = '50000000-0000-0000-0000-000000000001';
  perform public.apply_sage_reconcile_entity(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'payment',
    '50000000-0000-0000-0000-000000000001', 'sage-payment-raw-id',
    v_expected, '2026-09-04T08:06:00Z', '2026-09-04T08:06:00Z',
    '{}'::jsonb
  );
end;
$$;

do $$
declare
  v_invoice public.invoices;
begin
  select * into strict v_invoice from public.invoices
  where id = '40000000-0000-0000-0000-000000000002';
  if v_invoice.amount_paid <> 0 or v_invoice.balance_due <> 100
     or v_invoice.status <> 'awaiting_payment'
     or exists (select 1 from public.accounting_sync_queue) then
    raise exception 'sage_payment_runtime: payment tombstone or echo suppression failed';
  end if;
end;
$$;

-- AP payment moves recalculate both bills. The AP provider-link identity stays
-- attached to the payment itself while its parent changes.
insert into public.expense_categories (id, company_id, name) values (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 'Materials'
);
insert into public.suppliers (
  id, company_id, display_name, normalized_name, updated_at
) values (
  '61000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Payment supplier', 'payment supplier', '2026-09-04T08:00:00Z'
);
insert into public.supplier_bills (
  id, company_id, supplier_id, category_id, invoice_number,
  normalized_invoice_number, total, balance, status, updated_at
) values
  (
    '62000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001', 'BILL-OLD', 'BILL-OLD',
    100, 100, 'open', '2026-09-04T08:00:00Z'
  ),
  (
    '62000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001', 'BILL-NEW', 'BILL-NEW',
    100, 100, 'open', '2026-09-04T08:00:00Z'
  );
insert into public.supplier_bill_payments (
  id, company_id, bill_id, payment_date, amount, payment_method, updated_at
) values (
  '63000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '62000000-0000-0000-0000-000000000001', '2026-09-03', 25, 'eft',
  '2026-09-04T08:00:00Z'
);
insert into public.supplier_bill_provider_links (
  company_id, connection_id, provider, entity_type, entity_id, external_id,
  provider_updated_at
) values
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'sage', 'supplier',
    '61000000-0000-0000-0000-000000000001', 'sage-supplier-1',
    '2026-09-04T08:00:00Z'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'sage', 'supplier_bill',
    '62000000-0000-0000-0000-000000000001', 'sage-bill-old',
    '2026-09-04T08:00:00Z'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'sage', 'supplier_bill',
    '62000000-0000-0000-0000-000000000002', 'sage-bill-new',
    '2026-09-04T08:00:00Z'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'sage',
    'supplier_bill_payment', '63000000-0000-0000-0000-000000000001',
    'sage-supplier-payment-1', '2026-09-04T08:00:00Z'
  );
insert into public.supplier_bill_payment_account_mappings (
  company_id, connection_id, provider, payment_method, external_account_id,
  external_payment_method_id
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'sage', 'eft',
  'sage-bank-1', 'EFT'
);

truncate public.accounting_sync_events, public.accounting_sync_queue;

select * from public.apply_sage_reconcile_entity(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'supplier_bill_payment',
  '63000000-0000-0000-0000-000000000001', 'sage-supplier-payment-1',
  '2026-09-04T08:00:00Z', '2026-09-04T08:07:00Z', null,
  '{
    "contactId":"sage-supplier-1",
    "date":"2026-09-04",
    "amount":25,
    "bankAccountId":"sage-bank-1",
    "paymentMethodId":"EFT",
    "reference":"AP-MOVE-1",
    "allocations":[{"artefactId":"sage-bill-new","amount":25}]
  }'::jsonb
);

do $$
declare
  v_old public.supplier_bills;
  v_new public.supplier_bills;
  v_payment public.supplier_bill_payments;
begin
  select * into strict v_old from public.supplier_bills
  where id = '62000000-0000-0000-0000-000000000001';
  select * into strict v_new from public.supplier_bills
  where id = '62000000-0000-0000-0000-000000000002';
  select * into strict v_payment from public.supplier_bill_payments
  where id = '63000000-0000-0000-0000-000000000001';
  if v_payment.bill_id <> '62000000-0000-0000-0000-000000000002'
     or v_old.balance <> 100 or v_old.status <> 'open'
     or v_new.balance <> 75 or v_new.status <> 'partial'
     or exists (select 1 from public.accounting_sync_queue) then
    raise exception 'sage_payment_runtime: atomic AP payment move failed';
  end if;
end;
$$;
