insert into public.accounting_connections (
  id, company_id, provider, provider_environment, is_connected, sync_enabled,
  sync_direction, propagate_deletes, sage_business_id,
  sage_business_id_lookup, sage_business_name
) values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'sage', 'sandbox', true, true, 'pull_only', true,
  'encrypted-business-a', repeat('a', 64), 'Sandbox A'
);

insert into public.expense_categories (id, company_id, name) values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 'Materials'
);

begin;
set local ops.sync_source = 'sage';
insert into public.clients (
  id, company_id, name, sage_id, updated_at
) values
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Linked customer', 'sage-customer-1', '2026-09-04T08:00:00Z'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'Busy customer lane', 'sage-customer-2', '2026-09-04T08:01:00Z'
  );

insert into public.invoices (
  id, company_id, client_id, sage_id, invoice_number, issue_date, due_date,
  subtotal, tax_amount, total, balance_due, amount_paid, status, updated_at
) values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 'sage-invoice-1', 'OLD-1',
  '2026-09-01', '2026-09-30', 50, 6, 56, 56, 0,
  'awaiting_payment', '2026-09-04T08:00:00Z'
);
insert into public.line_items (
  id, company_id, invoice_id, name, description, quantity, unit_price,
  line_total, sort_order, type, is_taxable
) values (
  '51000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'Old line', 'Old line', 1, 50, 50, 0, 'custom', true
);

insert into public.estimates (
  id, company_id, client_id, sage_id, sage_document_kind, estimate_number,
  issue_date, expiration_date, subtotal, tax_amount, total, status, updated_at
) values (
  '52000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 'sage-estimate-1',
  'sales_estimate', 'EST-1', '2026-09-01', '2026-09-30', 10, 0, 10,
  'sent', '2026-09-04T08:00:00Z'
);

insert into public.payments (
  id, company_id, invoice_id, client_id, sage_id, amount, payment_date,
  payment_method, updated_at
) values (
  '53000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 'sage-payment-1', 10,
  '2026-09-02', 'eft', '2026-09-04T08:00:00Z'
);
update public.invoices
set updated_at = '2026-09-04T08:00:00Z'
where id = '50000000-0000-0000-0000-000000000001';
commit;

insert into public.suppliers (
  id, company_id, display_name, normalized_name, updated_at
) values (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Linked supplier', 'linked supplier', '2026-09-04T08:00:00Z'
);
insert into public.supplier_bills (
  id, company_id, supplier_id, invoice_number, normalized_invoice_number,
  invoice_date, due_date, category_id, currency, subtotal, tax_total, total,
  balance, status, updated_at
) values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001', 'OLD-BILL', 'OLD-BILL',
  '2026-09-01', '2026-09-30',
  '30000000-0000-0000-0000-000000000001', 'CAD', 25, 3, 28, 28,
  'open', '2026-09-04T08:00:00Z'
);
insert into public.supplier_bill_line_items (
  id, company_id, bill_id, category_id, position, description, quantity,
  unit_price, subtotal, tax_amount, tax_rate, total
) values (
  '71000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 1, 'Old purchase line',
  1, 25, 25, 3, 12, 28
);
insert into public.supplier_bill_payments (
  id, company_id, bill_id, payment_date, amount, payment_method, updated_at
) values (
  '72000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001', '2026-09-02', 5, 'eft',
  '2026-09-04T08:00:00Z'
);
update public.supplier_bills
set updated_at = '2026-09-04T08:00:00Z'
where id = '70000000-0000-0000-0000-000000000001';
insert into public.supplier_bill_provider_links (
  company_id, connection_id, provider, entity_type, entity_id, external_id,
  provider_updated_at
) values
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'sage', 'supplier',
    '60000000-0000-0000-0000-000000000001', 'sage-supplier-1',
    '2026-09-04T08:00:00Z'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'sage', 'supplier_bill',
    '70000000-0000-0000-0000-000000000001', 'sage-bill-1',
    '2026-09-04T08:00:00Z'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', 'sage',
    'supplier_bill_payment', '72000000-0000-0000-0000-000000000001',
    'sage-supplier-payment-1', '2026-09-04T08:00:00Z'
  );

insert into public.sage_purchase_account_mappings (
  company_id, connection_id, expense_category_id, sage_ledger_account_id
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', 'sage-purchase-ledger-1'
);
insert into public.supplier_bill_tax_mappings (
  company_id, connection_id, provider, tax_rate, external_tax_code_id
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'sage', 12,
  'sage-tax-12'
);
insert into public.sage_payment_method_mappings (
  company_id, connection_id, payment_method, sage_bank_account_id,
  sage_payment_method_id
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'eft', 'sage-bank-1', 'EFT'
);
insert into public.supplier_bill_payment_account_mappings (
  company_id, connection_id, provider, payment_method, external_account_id,
  external_payment_method_id
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'sage', 'eft',
  'sage-bank-1', 'EFT'
);

-- With eight records spread across seven lanes, the bounded first pass must
-- include every lane before taking the busy customer lane's second row.
do $$
declare
  v_count integer;
  v_types integer;
begin
  select count(*), count(distinct entity_type) into v_count, v_types
  from public.list_sage_reconcile_candidates('sandbox', 7);
  if v_count <> 7 or v_types <> 7 then
    raise exception 'sage_reconcile_runtime: fair lane selection failed';
  end if;
end;
$$;

-- The database refuses browser execution even if a caller learns an identity.
do $$
begin
  if has_function_privilege(
    'anon', 'public.list_sage_reconcile_candidates(text,integer)', 'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.apply_sage_reconcile_entity(uuid,uuid,text,uuid,text,timestamptz,timestamptz,timestamptz,jsonb)',
    'execute'
  ) then
    raise exception 'sage_reconcile_runtime: browser execution leaked';
  end if;
end;
$$;

update public.accounting_connections set sync_direction = 'bidirectional'
where id = '20000000-0000-0000-0000-000000000001';
truncate public.accounting_sync_events, public.accounting_sync_queue;

-- Full invoice headers and lines replace atomically. The provider source flag
-- suppresses every header/line trigger, so no outbound echo can appear.
select * from public.apply_sage_reconcile_entity(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'invoice',
  '50000000-0000-0000-0000-000000000001', 'sage-invoice-1',
  '2026-09-04T08:00:00Z', '2026-09-04T08:05:00Z', null,
  '{
    "contactId":"sage-customer-1",
    "issueDate":"2026-09-02",
    "boundaryDate":"2026-10-02",
    "reference":"INV-NEW",
    "status":"awaiting_payment",
    "subtotal":150,
    "taxAmount":18,
    "total":168,
    "outstanding":168,
    "lines":[
      {"description":"Panel","quantity":1,"unitPrice":100,"subtotal":100,"taxAmount":12,"total":112},
      {"description":"Labour","quantity":1,"unitPrice":50,"subtotal":50,"taxAmount":6,"total":56}
    ]
  }'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.invoices invoice
    where invoice.id = '50000000-0000-0000-0000-000000000001'
      and invoice.invoice_number = 'INV-NEW'
      and invoice.issue_date = '2026-09-02'
      and invoice.total = 168 and invoice.balance_due = 168
  ) or (
    select count(*) from public.line_items line
    where line.invoice_id = '50000000-0000-0000-0000-000000000001'
  ) <> 2 or exists (select 1 from public.accounting_sync_queue) then
    raise exception 'sage_reconcile_runtime: invoice apply or echo suppression failed';
  end if;
end;
$$;

-- A local write after selection makes the observed version stale; the entire
-- apply aborts before changing either header or lines.
do $$
begin
  begin
    perform public.apply_sage_reconcile_entity(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001', 'invoice',
      '50000000-0000-0000-0000-000000000001', 'sage-invoice-1',
      '2026-09-04T08:00:00Z', '2026-09-04T08:06:00Z', null,
      '{"contactId":"sage-customer-1"}'::jsonb
    );
    raise exception 'sage_reconcile_runtime: stale claim was accepted';
  exception when serialization_failure then
    null;
  end;
end;
$$;

-- Purchase documents require exact reverse account/tax mappings and preserve
-- every provider line in the same transaction.
select * from public.apply_sage_reconcile_entity(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'supplier_bill',
  '70000000-0000-0000-0000-000000000001', 'sage-bill-1',
  '2026-09-04T08:00:00Z', '2026-09-04T08:07:00Z', null,
  '{
    "contactId":"sage-supplier-1",
    "invoiceDate":"2026-09-03",
    "dueDate":"2026-10-03",
    "reference":"BILL-NEW",
    "currency":"CAD",
    "status":"open",
    "subtotal":80,
    "taxTotal":9.6,
    "total":89.6,
    "balance":89.6,
    "lines":[
      {"description":"Electrical materials","quantity":4,"unitPrice":20,"subtotal":80,"taxAmount":9.6,"total":89.6,"ledgerAccountId":"sage-purchase-ledger-1","taxRateId":"sage-tax-12","taxRate":12}
    ]
  }'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.supplier_bills bill
    where bill.id = '70000000-0000-0000-0000-000000000001'
      and bill.invoice_number = 'BILL-NEW' and bill.total = 89.6
  ) or not exists (
    select 1 from public.supplier_bill_line_items line
    where line.bill_id = '70000000-0000-0000-0000-000000000001'
      and line.description = 'Electrical materials'
      and line.category_id = '30000000-0000-0000-0000-000000000001'
      and line.total = 89.6
  ) or exists (select 1 from public.accounting_sync_queue) then
    raise exception 'sage_reconcile_runtime: purchase apply or mapping failed';
  end if;
end;
$$;
