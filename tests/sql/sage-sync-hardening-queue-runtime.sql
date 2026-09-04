insert into public.accounting_connections (
  id, company_id, provider, provider_environment, is_connected, sync_enabled,
  sync_direction, propagate_deletes, sage_business_id,
  sage_business_id_lookup, sage_business_name
) values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'sage', 'sandbox', true, true, 'bidirectional', false,
    'encrypted-business-a', repeat('a', 64), 'Sandbox A'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'quickbooks', 'sandbox', true, true, 'bidirectional', false,
    null, null, null
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'quickbooks', 'production', true, true, 'pull_only', false,
    null, null, null
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000002',
    'sage', 'sandbox', true, true, 'bidirectional', true,
    'encrypted-business-b', repeat('b', 64), 'Sandbox B'
  );

-- One local mutation fans out only to exact writable connections. Provider
-- link state is resolved independently, so Sage can update while QBO creates.
insert into public.clients (
  id, company_id, name, sage_id
) values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Provider-specific operation', 'sage-contact-1'
);

do $$
begin
  if (select count(*) from public.accounting_sync_queue) <> 2 then
    raise exception 'queue_runtime: mutation did not route to exactly two writable connections';
  end if;
  if not exists (
    select 1 from public.accounting_sync_queue
    where connection_id = '20000000-0000-0000-0000-000000000001'
      and provider = 'sage'
      and operation = 'update'
      and external_id = 'sage-contact-1'
      and payload_snapshot->>'providerEnvironment' = 'sandbox'
  ) then
    raise exception 'queue_runtime: Sage exact-business update route missing';
  end if;
  if not exists (
    select 1 from public.accounting_sync_queue
    where connection_id = '20000000-0000-0000-0000-000000000002'
      and provider = 'quickbooks'
      and operation = 'create'
      and external_id is null
      and payload_snapshot->>'providerEnvironment' = 'sandbox'
  ) then
    raise exception 'queue_runtime: QBO per-connection create route missing';
  end if;
  if exists (
    select 1 from public.accounting_sync_queue
    where connection_id = '20000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'queue_runtime: pull-only connection received outbound work';
  end if;
end;
$$;

-- Provider-originated writes never echo into any outbound provider queue.
truncate public.accounting_sync_events, public.accounting_sync_queue;
begin;
set local ops.sync_source = 'sage';
insert into public.clients (id, company_id, name) values (
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'Inbound Sage contact'
);
commit;

do $$
begin
  if exists (select 1 from public.accounting_sync_queue) then
    raise exception 'queue_runtime: provider-originated write echoed outbound';
  end if;
end;
$$;

-- Repeated delivery coalesces within each exact connection, without crossing
-- provider or environment boundaries.
insert into public.clients (
  id, company_id, name, qb_id, sage_id
) values (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'Coalesced contact', 'qbo-contact-3', 'sage-contact-3'
);
truncate public.accounting_sync_events, public.accounting_sync_queue;
update public.clients set name = 'Coalesced contact v2'
where id = '30000000-0000-0000-0000-000000000003';
update public.clients set name = 'Coalesced contact v3'
where id = '30000000-0000-0000-0000-000000000003';

do $$
begin
  if (select count(*) from public.accounting_sync_queue) <> 2
     or (select count(distinct connection_id) from public.accounting_sync_queue) <> 2
     or exists (
       select 1 from public.accounting_sync_queue
       group by connection_id having count(*) <> 1
     ) then
    raise exception 'queue_runtime: repeated update did not coalesce per connection';
  end if;
end;
$$;

-- A provider-specific suppression blocks only that provider; the other exact
-- connection still receives the mutation.
truncate public.accounting_sync_events, public.accounting_sync_queue;
insert into public.accounting_sync_suppressions (
  company_id, provider, entity_type, entity_id, source, expires_at
) values (
  '10000000-0000-0000-0000-000000000001', 'sage', 'customer',
  '30000000-0000-0000-0000-000000000003', 'sage', now() + interval '5 minutes'
);
update public.clients set name = 'Suppression scoped'
where id = '30000000-0000-0000-0000-000000000003';

do $$
begin
  if (select count(*) from public.accounting_sync_queue) <> 1
     or not exists (
       select 1 from public.accounting_sync_queue where provider = 'quickbooks'
     ) then
    raise exception 'queue_runtime: provider suppression crossed connection boundary';
  end if;
end;
$$;

delete from public.accounting_sync_suppressions;
truncate public.accounting_sync_events, public.accounting_sync_queue;

-- A child document stays pending until its parent succeeds. Claiming Sage
-- work never consumes the matching QBO lane.
insert into public.clients (id, company_id, name) values (
  '30000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001', 'Dependency parent'
);
insert into public.invoices (id, company_id, client_id) values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000004'
);

select * from public.claim_accounting_sync_queue('sage', 10, 'dependency-worker', 900);

do $$
begin
  if not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and entity_type = 'customer' and status = 'claimed'
  ) or not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and entity_type = 'invoice' and status = 'pending'
  ) or exists (
    select 1 from public.accounting_sync_queue
    where provider = 'quickbooks' and status <> 'pending'
  ) then
    raise exception 'queue_runtime: parent order or provider isolation failed';
  end if;

  update public.accounting_sync_queue
  set status = 'succeeded', external_id = 'sage-parent-4',
      locked_at = null, locked_by = null, updated_at = now()
  where provider = 'sage' and entity_type = 'customer';
end;
$$;

select * from public.claim_accounting_sync_queue('sage', 10, 'dependency-worker-2', 900);

do $$
begin
  if not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and entity_type = 'invoice'
      and status = 'claimed' and locked_by = 'dependency-worker-2'
  ) then
    raise exception 'queue_runtime: child did not unblock after parent success';
  end if;
end;
$$;

-- Accepted writes are quarantined from blind recovery. Only unaccepted stale
-- claims may return to the queue, and acceptance is tied to claim ownership.
truncate public.accounting_sync_events, public.accounting_sync_queue;
insert into public.accounting_sync_queue (
  id, company_id, connection_id, provider, entity_type, entity_id,
  operation, source_table, source_action, idempotency_key, status,
  locked_at, locked_by, provider_request_id, provider_accepted_at,
  idempotency_expires_at
) values
  (
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'sage', 'customer', '30000000-0000-0000-0000-000000000005',
    'create', 'clients', 'insert', 'accepted-stale', 'claimed',
    now() - interval '1 hour', 'lost-worker', 'sage-request-accepted',
    now() - interval '1 hour', now() + interval '6 days'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'sage', 'customer', '30000000-0000-0000-0000-000000000006',
    'create', 'clients', 'insert', 'unaccepted-stale', 'claimed',
    now() - interval '1 hour', 'lost-worker', null, null, null
  );

select * from public.claim_accounting_sync_queue('sage', 1, 'recovery-worker', 1);

do $$
begin
  if not exists (
    select 1 from public.accounting_sync_queue
    where id = '50000000-0000-0000-0000-000000000001'
      and status = 'claimed' and locked_by = 'lost-worker'
      and provider_accepted_at is not null
  ) then
    raise exception 'queue_runtime: accepted stale claim was automatically recovered';
  end if;
  if not exists (
    select 1 from public.accounting_sync_queue
    where id = '50000000-0000-0000-0000-000000000002'
      and status = 'claimed' and locked_by = 'recovery-worker'
      and attempts = 1
  ) then
    raise exception 'queue_runtime: unaccepted stale claim was not recovered';
  end if;
end;
$$;

select public.record_accounting_sync_acceptance(
  '50000000-0000-0000-0000-000000000002', 'recovery-worker',
  'sage-request-recovered', now(), now() + interval '7 days'
);

do $$
begin
  begin
    perform public.retry_accounting_sync_queue(
      '50000000-0000-0000-0000-000000000002',
      'recovery-worker', 'ambiguous transport', now()
    );
    raise exception 'queue_runtime: accepted write was retryable';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  begin
    perform public.record_accounting_sync_acceptance(
      '50000000-0000-0000-0000-000000000002', 'recovery-worker',
      'sage-request-replayed', now(), now() + interval '7 days'
    );
    raise exception 'queue_runtime: provider acceptance replay succeeded';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  if has_function_privilege(
    'anon',
    'public.record_accounting_sync_acceptance(uuid,text,text,timestamptz,timestamptz)',
    'execute'
  ) then
    raise exception 'queue_runtime: browser can record provider acceptance';
  end if;
end;
$$;

-- Lifecycle propagation is explicit: the enabled Sage lane receives the
-- tombstone while disabled QBO propagation is recorded as skipped.
truncate public.accounting_sync_events, public.accounting_sync_queue;
update public.accounting_connections
set propagate_deletes = (provider = 'sage')
where company_id = '10000000-0000-0000-0000-000000000001'
  and sync_direction <> 'pull_only';
insert into public.clients (
  id, company_id, name, qb_id, sage_id
) values (
  '30000000-0000-0000-0000-000000000007',
  '10000000-0000-0000-0000-000000000001',
  'Lifecycle contact', 'qbo-contact-7', 'sage-contact-7'
);
truncate public.accounting_sync_events, public.accounting_sync_queue;
update public.clients set deleted_at = now()
where id = '30000000-0000-0000-0000-000000000007';

do $$
begin
  if not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and operation = 'inactivate'
      and entity_id = '30000000-0000-0000-0000-000000000007'
  ) or exists (
    select 1 from public.accounting_sync_queue
    where provider = 'quickbooks'
      and entity_id = '30000000-0000-0000-0000-000000000007'
  ) or not exists (
    select 1 from public.accounting_sync_events
    where provider = 'quickbooks' and status = 'skipped'
      and entity_id = '30000000-0000-0000-0000-000000000007'
  ) then
    raise exception 'queue_runtime: lifecycle propagation gate failed';
  end if;
end;
$$;

-- Hard deletes retain provider lifecycle intent, and child line-item changes
-- preserve both the document and already-linked parent identity.
insert into public.invoices (
  id, company_id, client_id, qb_id, sage_id
) values (
  '40000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  'qbo-invoice-2', 'sage-invoice-2'
);
truncate public.accounting_sync_events, public.accounting_sync_queue;
delete from public.invoices
where id = '40000000-0000-0000-0000-000000000002';

insert into public.estimates (
  id, company_id, client_id, qb_id, sage_id
) values (
  '41000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  'qbo-estimate-1', 'sage-estimate-1'
);
delete from public.estimates
where id = '41000000-0000-0000-0000-000000000001';

do $$
begin
  if not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and entity_type = 'invoice'
      and entity_id = '40000000-0000-0000-0000-000000000002'
      and operation = 'void'
  ) or not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and entity_type = 'estimate'
      and entity_id = '41000000-0000-0000-0000-000000000001'
      and operation = 'delete'
  ) then
    raise exception 'queue_runtime: hard-delete lifecycle intent was lost';
  end if;
end;
$$;

insert into public.invoices (
  id, company_id, client_id, qb_id, sage_id
) values (
  '40000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  'qbo-invoice-3', 'sage-invoice-3'
);
truncate public.accounting_sync_events, public.accounting_sync_queue;
insert into public.line_items (
  id, company_id, invoice_id, description
) values (
  '42000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003', 'Preserved line'
);

do $$
begin
  if not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and entity_type = 'invoice'
      and entity_id = '40000000-0000-0000-0000-000000000003'
      and external_id = 'sage-invoice-3'
      and operation = 'update'
      and payload_snapshot->>'parentEntityId' =
        '30000000-0000-0000-0000-000000000003'
      and payload_snapshot->>'parentExternalId' = 'sage-contact-3'
  ) then
    raise exception 'queue_runtime: line-item document or parent identity was lost';
  end if;
end;
$$;

-- Fair selection interleaves exact connection lanes before taking a second
-- row from a busy connection.
truncate public.accounting_sync_events, public.accounting_sync_queue;
insert into public.clients (id, company_id, name) values
  (
    '30000000-0000-0000-0000-000000000008',
    '10000000-0000-0000-0000-000000000001', 'Fair A1'
  ),
  (
    '30000000-0000-0000-0000-000000000009',
    '10000000-0000-0000-0000-000000000001', 'Fair A2'
  ),
  (
    '30000000-0000-0000-0000-000000000010',
    '10000000-0000-0000-0000-000000000001', 'Fair A3'
  ),
  (
    '30000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000002', 'Fair B1'
  );

select * from public.claim_accounting_sync_queue('sage', 2, 'fair-worker', 900);

do $$
begin
  if (
    select count(distinct connection_id)
    from public.accounting_sync_queue
    where provider = 'sage' and status = 'claimed' and locked_by = 'fair-worker'
  ) <> 2 then
    raise exception 'queue_runtime: fair claim did not interleave connections';
  end if;
end;
$$;

-- Supplier bills use the same parent barrier as receivables.
truncate public.accounting_sync_events, public.accounting_sync_queue;
insert into public.suppliers (id, company_id) values (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);
insert into public.supplier_bills (id, company_id, supplier_id) values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001'
);
select private.enqueue_supplier_bill_accounting(
  '10000000-0000-0000-0000-000000000001', 'supplier',
  '60000000-0000-0000-0000-000000000001', 'create',
  'suppliers', 'insert', now()
);
select private.enqueue_supplier_bill_accounting(
  '10000000-0000-0000-0000-000000000001', 'supplier_bill',
  '70000000-0000-0000-0000-000000000001', 'create',
  'supplier_bills', 'insert', now()
);
select * from public.claim_accounting_sync_queue('sage', 10, 'supplier-worker', 900);

do $$
begin
  if not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and entity_type = 'supplier' and status = 'claimed'
  ) or not exists (
    select 1 from public.accounting_sync_queue
    where provider = 'sage' and entity_type = 'supplier_bill' and status = 'pending'
  ) then
    raise exception 'queue_runtime: supplier dependency barrier failed';
  end if;
end;
$$;
