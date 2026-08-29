begin;

-- PostgreSQL 17 rollback-only proof for the Task 14 sales-document source
-- trigger matrix. Apply the generated source migration first.
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $catalog_contract$
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception
      'agent_sales_document_sources_runtime_failed: requires_pg17';
  end if;
  if pg_catalog.to_regprocedure(
       'private.bump_agent_sales_document_source_revision()'
     ) is null then
    raise exception
      'agent_sales_document_sources_runtime_failed: function_missing';
  end if;
end;
$catalog_contract$;

insert into public.companies (id, name, currency_code) values
  (
    'd1000000-0000-4000-8000-000000000001',
    'Sales source alpha',
    'CAD'
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    'Sales source bravo',
    'CAD'
  );

create temporary table task14_source_baseline (
  company_id uuid primary key,
  source_revision bigint not null
);
insert into task14_source_baseline
select revision.company_id, revision.source_revision
from private.agent_read_domain_revisions revision
where revision.company_id in (
    'd1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002'
  )
  and revision.domain = 'sales_documents';

insert into public.estimates (
  id,
  company_id,
  client_id,
  estimate_number,
  title,
  total,
  status,
  issue_date,
  updated_at
) values (
  'd1100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'EST-RUNTIME-1',
  'Runtime estimate',
  1250.00,
  'sent',
  date '2026-08-20',
  pg_catalog.statement_timestamp()
);

insert into public.invoices (
  id,
  company_id,
  client_id,
  invoice_number,
  subject,
  total,
  amount_paid,
  balance_due,
  status,
  issue_date,
  due_date,
  updated_at
) values (
  'd1300000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'INV-RUNTIME-1',
  'Runtime invoice',
  1250.00,
  250.00,
  1000.00,
  'partially_paid',
  date '2026-08-21',
  date '2026-09-20',
  pg_catalog.statement_timestamp()
);

insert into public.line_items (
  id,
  company_id,
  estimate_id,
  name,
  quantity,
  unit,
  unit_price,
  discount_percent,
  sort_order
) values (
  'd1400000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Vinyl deck surface',
  12.500,
  'sqft',
  100.00,
  0,
  0
);

insert into public.payment_milestones (
  id,
  estimate_id,
  name,
  type,
  value,
  amount,
  sort_order,
  expected_date
) values (
  'd1500000-0000-4000-8000-000000000001',
  'd1100000-0000-4000-8000-000000000001',
  'Deposit',
  'percentage',
  50.00,
  625.00,
  0,
  date '2026-08-30'
);

do $insert_matrix$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into strict v_before
  from task14_source_baseline
  where company_id = 'd1000000-0000-4000-8000-000000000001';

  select source_revision into strict v_after
  from private.agent_read_domain_revisions
  where company_id = 'd1000000-0000-4000-8000-000000000001'
    and domain = 'sales_documents';

  if v_after < v_before + 4 then
    raise exception
      'agent_sales_document_sources_runtime_failed: insert_matrix';
  end if;
end;
$insert_matrix$;

create temporary table task14_before_irrelevant (value bigint not null);
insert into task14_before_irrelevant
select source_revision
from private.agent_read_domain_revisions
where company_id = 'd1000000-0000-4000-8000-000000000001'
  and domain = 'sales_documents';

update public.line_items
set category = 'private category'
where id = 'd1400000-0000-4000-8000-000000000001';

do $irrelevant_update_did_not_bump$
begin
  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = 'd1000000-0000-4000-8000-000000000001'
      and domain = 'sales_documents'
  ) is distinct from (select value from task14_before_irrelevant) then
    raise exception
      'agent_sales_document_sources_runtime_failed: irrelevant_update_did_not_bump';
  end if;
end;
$irrelevant_update_did_not_bump$;

create temporary table task14_before_currency (value bigint not null);
insert into task14_before_currency
select source_revision
from private.agent_read_domain_revisions
where company_id = 'd1000000-0000-4000-8000-000000000001'
  and domain = 'sales_documents';

update public.companies
set currency_code = 'USD'
where id = 'd1000000-0000-4000-8000-000000000001';

do $currency_bump$
begin
  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = 'd1000000-0000-4000-8000-000000000001'
      and domain = 'sales_documents'
  ) <= (select value from task14_before_currency) then
    raise exception
      'agent_sales_document_sources_runtime_failed: currency_did_not_bump';
  end if;
end;
$currency_bump$;

create temporary table task14_before_move (
  company_id uuid primary key,
  value bigint not null
);
insert into task14_before_move
select revision.company_id, revision.source_revision
from private.agent_read_domain_revisions revision
where revision.company_id in (
    'd1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002'
  )
  and revision.domain = 'sales_documents';

update public.estimates
set company_id = 'd1000000-0000-4000-8000-000000000002'
where id = 'd1100000-0000-4000-8000-000000000001';

do $old_and_new_company_fanout$
declare
  v_company_id uuid;
begin
  foreach v_company_id in array array[
    'd1000000-0000-4000-8000-000000000001'::uuid,
    'd1000000-0000-4000-8000-000000000002'::uuid
  ]
  loop
    if (
      select source_revision
      from private.agent_read_domain_revisions
      where company_id = v_company_id
        and domain = 'sales_documents'
    ) <= (
      select value
      from task14_before_move
      where company_id = v_company_id
    ) then
      raise exception
        'agent_sales_document_sources_runtime_failed: old_and_new_company_fanout';
    end if;
  end loop;
end;
$old_and_new_company_fanout$;

delete from public.payment_milestones
where id = 'd1500000-0000-4000-8000-000000000001';

rollback;
