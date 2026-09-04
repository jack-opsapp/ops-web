insert into public.accounting_connections (
  id, company_id, provider, provider_environment, is_connected, sync_enabled, sync_direction
)
values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'quickbooks', 'sandbox', true, true, 'bidirectional'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'quickbooks', 'production', true, true, 'bidirectional');

insert into public.clients (id, company_id, qb_id, updated_at)
select
  ('61000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001',
  (1000 + value)::text,
  now() - make_interval(secs => value)
from generate_series(1, 30) value;

insert into public.clients (id, company_id, qb_id, deleted_at)
values (
  '61000000-0000-4000-8000-999999999999',
  '10000000-0000-4000-8000-000000000001',
  '1999',
  now()
);

insert into public.invoices (id, company_id, qb_id, total, balance_due, status)
values
  ('62000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2001', 100, 100, 'awaiting_payment'),
  ('62000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '9001', 100, 100, 'awaiting_payment'),
  ('62000000-0000-4000-8000-999999999998', '10000000-0000-4000-8000-000000000001', '2998', 100, 100, 'void'),
  ('62000000-0000-4000-8000-999999999999', '10000000-0000-4000-8000-000000000001', '2999', 100, 100, 'awaiting_payment');

update public.invoices
set deleted_at = now()
where id = '62000000-0000-4000-8000-999999999999';

insert into public.estimates (id, company_id, qb_id)
values
  ('63000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '3001'),
  ('63000000-0000-4000-8000-999999999999', '10000000-0000-4000-8000-000000000001', '3999');

update public.estimates
set deleted_at = now()
where id = '63000000-0000-4000-8000-999999999999';

insert into public.payments (id, company_id, qb_id, amount, voided_at)
values
  ('64000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '4001:2001', 25, null),
  ('64000000-0000-4000-8000-999999999999', '10000000-0000-4000-8000-000000000001', '4999:2001', 25, now());

create temp table maximum_candidates as
select * from public.list_quickbooks_reconcile_candidates('sandbox', 1000);

create temp table minimum_candidates as
select * from public.list_quickbooks_reconcile_candidates('sandbox', 0);

do $$
begin
  if (select count(*) from maximum_candidates) <> 33 then
    raise exception 'candidate limit did not clamp to the full 33-record eligible set';
  end if;

  if (select count(*) from minimum_candidates) <> 1 then
    raise exception 'candidate limit did not clamp zero to one';
  end if;
end;
$$;

create temp table first_candidates as
select * from public.list_quickbooks_reconcile_candidates('sandbox', 25);

do $$
declare
  v_type text;
begin
  if (select count(*) from first_candidates) <> 25 then
    raise exception 'candidate batch was not bounded to 25';
  end if;

  foreach v_type in array array['customer', 'invoice', 'estimate', 'payment'] loop
    if not exists (select 1 from first_candidates where entity_type = v_type) then
      raise exception 'candidate batch starved entity type %', v_type;
    end if;
  end loop;

  if exists (select 1 from first_candidates where entity_id = '61000000-0000-4000-8000-999999999999') then
    raise exception 'deleted customer entered reconcile candidates';
  end if;

  if exists (select 1 from first_candidates where connection_id = '50000000-0000-4000-8000-000000000002') then
    raise exception 'production connection entered sandbox reconcile candidates';
  end if;

  if exists (
    select 1
    from first_candidates
    where entity_id in (
      '62000000-0000-4000-8000-999999999998',
      '62000000-0000-4000-8000-999999999999',
      '63000000-0000-4000-8000-999999999999',
      '64000000-0000-4000-8000-999999999999'
    )
  ) then
    raise exception 'inactive accounting entity entered reconcile candidates';
  end if;

  if not exists (
    select 1
    from first_candidates
    where entity_id = '64000000-0000-4000-8000-000000000001'
      and entity_type = 'payment'
      and external_id = '4001'
  ) then
    raise exception 'payment reconcile candidate did not expose the raw QuickBooks payment id';
  end if;
end;
$$;

insert into public.accounting_sync_events (
  company_id, connection_id, provider, direction, entity_type, entity_id,
  external_id, operation, status, source, created_at
)
select
  company_id::uuid, connection_id, 'quickbooks', 'reconcile', entity_type,
  entity_id::text, external_id, 'reconcile', 'succeeded', 'reconcile', now()
from first_candidates;

create temp table second_candidates as
select * from public.list_quickbooks_reconcile_candidates('sandbox', 25);

do $$
begin
  if (
    select count(*)
    from second_candidates second
    where not exists (
      select 1 from first_candidates first
      where first.connection_id = second.connection_id
        and first.entity_type = second.entity_type
        and first.entity_id = second.entity_id
    )
  ) < 8 then
    raise exception 'unseen linked records did not advance ahead of recently reconciled records';
  end if;

  if (
    select count(*)
    from (
      select connection_id, entity_type, entity_id from first_candidates
      union
      select connection_id, entity_type, entity_id from second_candidates
    ) distinct_candidates
  ) <> 33 then
    raise exception 'two fair batches did not rotate through every eligible record';
  end if;
end;
$$;

do $$
begin
  perform public.list_quickbooks_reconcile_candidates('invalid', 25);
  raise exception 'invalid provider environment was accepted';
exception
  when check_violation then null;
end;
$$;

do $$
begin
  perform public.list_quickbooks_reconcile_candidates(null, 25);
  raise exception 'null provider environment was accepted';
exception
  when check_violation then null;
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.list_quickbooks_reconcile_candidates(text,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.list_quickbooks_reconcile_candidates(text,integer)', 'execute')
    or has_function_privilege('public', 'public.list_quickbooks_reconcile_candidates(text,integer)', 'execute') then
    raise exception 'reconcile candidate RPC is exposed outside service_role';
  end if;
  if not has_function_privilege('service_role', 'public.list_quickbooks_reconcile_candidates(text,integer)', 'execute') then
    raise exception 'service_role cannot execute reconcile candidate RPC';
  end if;
  if not exists (
    select 1
    from pg_proc
    where oid = 'public.list_quickbooks_reconcile_candidates(text,integer)'::regprocedure
      and prosecdef = true
      and 'search_path=public, pg_temp' = any(proconfig)
  ) then
    raise exception 'reconcile candidate RPC is missing its definer/search-path boundary';
  end if;
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'accounting_sync_events_qbo_reconcile_candidate_idx'
  ) then
    raise exception 'reconcile candidate audit index is missing';
  end if;
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'accounting_sync_queue_create_dependency_idx'
  ) then
    raise exception 'queue create-dependency index is missing';
  end if;
end;
$$;
