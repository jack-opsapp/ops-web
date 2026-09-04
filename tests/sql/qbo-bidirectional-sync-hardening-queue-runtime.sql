insert into public.accounting_sync_queue (
  id, company_id, connection_id, provider, entity_type, entity_id,
  operation, source_table, source_action, idempotency_key,
  run_after, created_at
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'quickbooks', 'customer', '60000000-0000-4000-8000-000000000001',
    'create', 'clients', 'insert', 'customer:60000000-0000-4000-8000-000000000001',
    now(), now()
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'quickbooks', 'customer', '60000000-0000-4000-8000-000000000001',
    'update', 'clients', 'update', 'customer:60000000-0000-4000-8000-000000000001',
    now() - interval '1 minute', now() - interval '1 minute'
  );

do $$
declare
  v_claim public.accounting_sync_queue;
begin
  select * into strict v_claim
  from public.claim_accounting_sync_queue('quickbooks', 1, 'worker-one', 900);

  if v_claim.operation <> 'create' then
    raise exception 'dependent update claimed before create: %', to_jsonb(v_claim);
  end if;

  if (select status from public.accounting_sync_queue where id = '40000000-0000-4000-8000-000000000002') <> 'pending' then
    raise exception 'dependent update did not remain pending';
  end if;
end;
$$;

insert into public.accounting_sync_queue (
  id, company_id, connection_id, provider, entity_type, entity_id,
  operation, source_table, source_action, idempotency_key,
  status, run_after, created_at
)
values
  (
    '40000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'quickbooks', 'customer', '60000000-0000-4000-8000-000000000003',
    'create', 'clients', 'insert', 'customer:60000000-0000-4000-8000-000000000003',
    'failed', now() - interval '2 minutes', now() - interval '2 minutes'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'quickbooks', 'customer', '60000000-0000-4000-8000-000000000003',
    'update', 'clients', 'update', 'customer:60000000-0000-4000-8000-000000000003',
    'pending', now() - interval '1 minute', now() - interval '1 minute'
  );

do $$
declare
  v_claim_count integer;
begin
  select count(*) into v_claim_count
  from public.claim_accounting_sync_queue('quickbooks', 1, 'failed-create-worker', 900);

  if v_claim_count <> 0 then
    raise exception 'unlinked update escaped after its create failed';
  end if;

  if (select status from public.accounting_sync_queue where id = '40000000-0000-4000-8000-000000000006') <> 'pending' then
    raise exception 'blocked update did not remain pending after create failure';
  end if;
end;
$$;

update public.accounting_sync_queue
set external_id = 'restored-qbo-customer-id'
where id = '40000000-0000-4000-8000-000000000006';

do $$
declare
  v_claim public.accounting_sync_queue;
begin
  select * into strict v_claim
  from public.claim_accounting_sync_queue('quickbooks', 1, 'linked-recovery-worker', 900);

  if v_claim.id <> '40000000-0000-4000-8000-000000000006'
    or v_claim.external_id <> 'restored-qbo-customer-id' then
    raise exception 'explicitly relinked update did not recover: %', to_jsonb(v_claim);
  end if;
end;
$$;

insert into public.accounting_sync_queue (
  id, company_id, connection_id, provider, entity_type, entity_id,
  operation, source_table, source_action, idempotency_key,
  status, locked_at, locked_by, run_after, created_at
)
values
  (
    '40000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'quickbooks', 'invoice', '60000000-0000-4000-8000-000000000002',
    'update', 'invoices', 'update', 'invoice:60000000-0000-4000-8000-000000000002',
    'claimed', now() - interval '1 hour', 'dead-worker', now() - interval '1 hour', now() - interval '2 hours'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    'quickbooks', 'invoice', '60000000-0000-4000-8000-000000000002',
    'update', 'invoices', 'update', 'invoice:60000000-0000-4000-8000-000000000002',
    'pending', null, null, now() + interval '1 hour', now() - interval '1 hour'
  );

do $$
declare
  v_claim public.accounting_sync_queue;
begin
  select * into strict v_claim
  from public.claim_accounting_sync_queue('quickbooks', 1, 'recovery-worker', 900);

  if v_claim.id <> '40000000-0000-4000-8000-000000000003' or v_claim.status <> 'claimed' then
    raise exception 'stale recovery crossed connection boundaries: %', to_jsonb(v_claim);
  end if;
end;
$$;

update public.accounting_sync_queue
set status = 'succeeded', locked_at = null, locked_by = null
where id = '40000000-0000-4000-8000-000000000001';

do $$
declare
  v_claim public.accounting_sync_queue;
begin
  select * into strict v_claim
  from public.claim_accounting_sync_queue('quickbooks', 1, 'worker-two', 900);

  if v_claim.operation <> 'update' or v_claim.id <> '40000000-0000-4000-8000-000000000002' then
    raise exception 'dependent update was not released after create success: %', to_jsonb(v_claim);
  end if;
end;
$$;
