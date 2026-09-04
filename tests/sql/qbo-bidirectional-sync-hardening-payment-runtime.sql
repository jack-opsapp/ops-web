insert into public.invoices (
  id, company_id, total, amount_paid, balance_due, status, due_date, updated_at
)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 100, 0, 100, 'awaiting_payment', current_date + 7, '2026-01-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 100, 0, 100, 'awaiting_payment', current_date + 7, '2026-01-01T00:00:00Z');

insert into public.payments (
  id, company_id, invoice_id, amount
)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  40
);

truncate table public.invoice_update_emissions;

update public.payments
set invoice_id = '20000000-0000-4000-8000-000000000002'
where id = '30000000-0000-4000-8000-000000000001';

do $$
declare
  v_old public.invoices;
  v_new public.invoices;
begin
  select * into strict v_old from public.invoices where id = '20000000-0000-4000-8000-000000000001';
  select * into strict v_new from public.invoices where id = '20000000-0000-4000-8000-000000000002';

  if v_old.amount_paid <> 0 or v_old.balance_due <> 100 or v_old.status <> 'awaiting_payment' then
    raise exception 'old invoice was not cleared after payment move: %', to_jsonb(v_old);
  end if;
  if v_new.amount_paid <> 40 or v_new.balance_due <> 60 or v_new.status <> 'partially_paid' then
    raise exception 'new invoice was not recalculated after payment move: %', to_jsonb(v_new);
  end if;
  if (select count(*) from public.invoice_update_emissions) <> 0 then
    raise exception 'payment move amplified into outbound invoice updates';
  end if;
end;
$$;

update public.payments
set voided_at = now()
where id = '30000000-0000-4000-8000-000000000001';

do $$
declare
  v_invoice public.invoices;
begin
  select * into strict v_invoice from public.invoices where id = '20000000-0000-4000-8000-000000000002';
  if v_invoice.amount_paid <> 0 or v_invoice.balance_due <> 100 or v_invoice.status <> 'awaiting_payment' then
    raise exception 'invoice was not restored after payment void: %', to_jsonb(v_invoice);
  end if;
  if (select count(*) from public.invoice_update_emissions) <> 0 then
    raise exception 'payment void amplified into an outbound invoice update';
  end if;
end;
$$;

insert into public.invoices (
  id, company_id, total, amount_paid, balance_due, status, due_date
)
values
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 100, 0, 100, 'past_due', current_date - 7),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 100, 0, 100, 'written_off', current_date - 7),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 100, 0, 100, 'awaiting_payment', current_date + 7);

insert into public.payments (id, company_id, invoice_id, amount)
values
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 100),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 25),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', 150);

do $$
declare
  v_invoice public.invoices;
begin
  select * into strict v_invoice from public.invoices where id = '20000000-0000-4000-8000-000000000005';
  if v_invoice.amount_paid <> 150 or v_invoice.balance_due <> 0 or v_invoice.status <> 'paid' then
    raise exception 'overpayment produced an invalid invoice balance: %', to_jsonb(v_invoice);
  end if;
end;
$$;

update public.payments
set voided_at = now()
where id = '30000000-0000-4000-8000-000000000002';

delete from public.payments
where id = '30000000-0000-4000-8000-000000000004';

do $$
declare
  v_past_due public.invoices;
  v_written_off public.invoices;
  v_overpaid public.invoices;
begin
  select * into strict v_past_due from public.invoices where id = '20000000-0000-4000-8000-000000000003';
  select * into strict v_written_off from public.invoices where id = '20000000-0000-4000-8000-000000000004';
  select * into strict v_overpaid from public.invoices where id = '20000000-0000-4000-8000-000000000005';

  if v_past_due.amount_paid <> 0 or v_past_due.balance_due <> 100 or v_past_due.status <> 'past_due' then
    raise exception 'voided payment did not restore past-due invoice state: %', to_jsonb(v_past_due);
  end if;
  if v_written_off.amount_paid <> 25 or v_written_off.balance_due <> 75 or v_written_off.status <> 'written_off' then
    raise exception 'payment recalculation overwrote terminal invoice state: %', to_jsonb(v_written_off);
  end if;
  if v_overpaid.amount_paid <> 0 or v_overpaid.balance_due <> 100 or v_overpaid.status <> 'awaiting_payment' then
    raise exception 'payment delete did not clear overpaid invoice state: %', to_jsonb(v_overpaid);
  end if;
  if (select count(*) from public.invoice_update_emissions) <> 0 then
    raise exception 'payment edge cases amplified into outbound invoice updates';
  end if;
end;
$$;

update public.invoices
set updated_at = '2026-01-01T00:00:00Z'
where id = '20000000-0000-4000-8000-000000000002';

do $$
begin
  if (select count(*) from public.invoice_update_emissions) <> 1 then
    raise exception 'direct invoice update suppression leaked outside payment balance recalculation';
  end if;
end;
$$;

truncate table public.invoice_update_emissions;

update public.payments
set qb_id = '900:901'
where id = '30000000-0000-4000-8000-000000000001';

do $$
declare
  v_updated_at timestamptz;
begin
  select updated_at into strict v_updated_at
  from public.invoices
  where id = '20000000-0000-4000-8000-000000000002';

  if v_updated_at <> '2026-01-01T00:00:00Z'::timestamptz then
    raise exception 'payment qb_id writeback amplified into an invoice update: %', v_updated_at;
  end if;
end;
$$;
