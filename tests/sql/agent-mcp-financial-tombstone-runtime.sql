\set ON_ERROR_STOP on

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

insert into public.companies(id, name, currency_code) values
  ('98000000-0000-4000-8000-000000000001', 'Tombstone Alpha', 'CAD'),
  ('98000000-0000-4000-8000-000000000002', 'Tombstone Bravo', 'CAD');

insert into public.clients(
  id, company_id, name, deleted_at, merged_into_client_id
) values
  ('98100000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000001', 'Current client', null, null),
  ('98100000-0000-4000-8000-000000000002',
   '98000000-0000-4000-8000-000000000001', 'Deleted client',
   timestamptz '2026-08-30 13:00:00+00', null),
  ('98100000-0000-4000-8000-000000000003',
   '98000000-0000-4000-8000-000000000002', 'Foreign client', null, null),
  ('98100000-0000-4000-8000-000000000004',
   '98000000-0000-4000-8000-000000000001', 'Alternate client', null, null),
  ('98100000-0000-4000-8000-000000000005',
   '98000000-0000-4000-8000-000000000001', 'Valid merged client',
   timestamptz '2026-08-30 13:00:00+00',
   '98100000-0000-4000-8000-000000000001'),
  ('98100000-0000-4000-8000-000000000006',
   '98000000-0000-4000-8000-000000000001', 'Foreign-target merge',
   timestamptz '2026-08-30 13:00:00+00',
   '98100000-0000-4000-8000-000000000003'),
  ('98100000-0000-4000-8000-000000000007',
   '98000000-0000-4000-8000-000000000001', 'Missing-target merge',
   timestamptz '2026-08-30 13:00:00+00',
   '98100000-0000-4000-8000-000000000099'),
  ('98100000-0000-4000-8000-000000000008',
   '98000000-0000-4000-8000-000000000001', 'Self merge',
   timestamptz '2026-08-30 13:00:00+00',
   '98100000-0000-4000-8000-000000000008'),
  ('98100000-0000-4000-8000-000000000009',
   '98000000-0000-4000-8000-000000000001', 'Deleted-target merge',
   timestamptz '2026-08-30 13:00:00+00',
   '98100000-0000-4000-8000-000000000010'),
  ('98100000-0000-4000-8000-000000000010',
   '98000000-0000-4000-8000-000000000001', 'Deleted merge target',
   timestamptz '2026-08-30 13:00:00+00', null),
  ('98100000-0000-4000-8000-000000000011',
   '98000000-0000-4000-8000-000000000001', 'Chained-target merge',
   timestamptz '2026-08-30 13:00:00+00',
   '98100000-0000-4000-8000-000000000012'),
  ('98100000-0000-4000-8000-000000000012',
   '98000000-0000-4000-8000-000000000001', 'Intermediate merge target', null,
   '98100000-0000-4000-8000-000000000001');

insert into public.estimates(
  id, company_id, client_id, client_ref, estimate_number, title, status,
  issue_date, total, updated_at
) values
  ('98200000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000001',
   'EST-CURRENT', 'Current estimate', 'draft', '2026-08-30', 100.00,
   timestamptz '2026-08-30 14:00:00+00'),
  ('98200000-0000-4000-8000-000000000002',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000002',
   '98100000-0000-4000-8000-000000000002',
   'EST-DELETED', 'Deleted-client estimate', 'draft', '2026-08-30',
   200.00, timestamptz '2026-08-30 15:00:00+00'),
  ('98200000-0000-4000-8000-000000000004',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000099',
   '98100000-0000-4000-8000-000000000099',
   'EST-MISSING', 'Missing-client estimate', 'draft', '2026-08-30',
   400.00, timestamptz '2026-08-30 12:00:00+00'),
  ('98200000-0000-4000-8000-000000000005',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000004',
   '98100000-0000-4000-8000-000000000002',
   'EST-MISMATCH', 'Mismatched-client estimate', 'draft', '2026-08-30',
   500.00, timestamptz '2026-08-30 11:00:00+00'),
  ('98200000-0000-4000-8000-000000000006',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000005',
   '98100000-0000-4000-8000-000000000005',
   'EST-VALID-MERGE', 'Valid merged-client estimate', 'draft', '2026-08-30',
   600.00, timestamptz '2026-08-30 16:00:00+00');

do $sales_tombstone_before_bound$
declare
  v_rows record;
begin
  select * into strict v_rows
  from private.agent_p2_sales_document_header_source_v1(
    '98000000-0000-4000-8000-000000000001',
    array['estimate']::text[], null, null, null, null, 'CAD', 1
  );
  if v_rows.document_id is distinct from
       '98200000-0000-4000-8000-000000000001'::uuid
     or v_rows.source_invalid then
    raise exception 'agent_financial_tombstone_runtime_failed:sales_bound';
  end if;
end;
$sales_tombstone_before_bound$;

insert into public.estimates(
  id, company_id, client_id, client_ref, estimate_number, title, status,
  issue_date, total, updated_at
) values
  ('98200000-0000-4000-8000-000000000003',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000003',
   '98100000-0000-4000-8000-000000000003',
   'EST-FOREIGN', 'Foreign-client estimate', 'draft', '2026-08-30',
   300.00, timestamptz '2026-08-30 13:00:00+00'),
  ('98200000-0000-4000-8000-000000000007',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000006',
   '98100000-0000-4000-8000-000000000006',
   'EST-FOREIGN-MERGE', 'Foreign-target merge estimate', 'draft',
   '2026-08-30', 700.00, timestamptz '2026-08-30 10:00:00+00'),
  ('98200000-0000-4000-8000-000000000008',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000007',
   '98100000-0000-4000-8000-000000000007',
   'EST-MISSING-MERGE', 'Missing-target merge estimate', 'draft',
   '2026-08-30', 800.00, timestamptz '2026-08-30 09:00:00+00'),
  ('98200000-0000-4000-8000-000000000009',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000008',
   '98100000-0000-4000-8000-000000000008',
   'EST-SELF-MERGE', 'Self merge estimate', 'draft', '2026-08-30',
   900.00, timestamptz '2026-08-30 08:00:00+00'),
  ('98200000-0000-4000-8000-000000000010',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000009',
   '98100000-0000-4000-8000-000000000009',
   'EST-DELETED-TARGET-MERGE', 'Deleted-target merge estimate', 'draft',
   '2026-08-30', 1000.00, timestamptz '2026-08-30 07:00:00+00'),
  ('98200000-0000-4000-8000-000000000011',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000011',
   '98100000-0000-4000-8000-000000000011',
   'EST-CHAINED-TARGET-MERGE', 'Chained-target merge estimate', 'draft',
   '2026-08-30', 1100.00, timestamptz '2026-08-30 06:00:00+00');

do $sales_fail_closed_boundary$
declare
  v_count integer;
  v_deleted_header_count integer;
  v_deleted_detail_count integer;
  v_valid_merge_header_count integer;
  v_valid_merge_detail_count integer;
  v_current_invalid boolean;
  v_foreign_invalid boolean;
  v_missing_invalid boolean;
  v_mismatch_invalid boolean;
  v_deleted_foreign_merge_invalid boolean;
  v_deleted_missing_merge_invalid boolean;
  v_deleted_self_merge_invalid boolean;
  v_deleted_invalid_target_merge_invalid boolean;
  v_deleted_chained_merge_invalid boolean;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000002'::uuid
         )::integer,
         pg_catalog.count(*) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000006'::uuid
         )::integer,
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000001'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000003'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000004'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000005'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000007'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000008'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000009'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000010'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98200000-0000-4000-8000-000000000011'::uuid
         )
    into v_count, v_deleted_header_count, v_valid_merge_header_count,
         v_current_invalid, v_foreign_invalid, v_missing_invalid,
         v_mismatch_invalid, v_deleted_foreign_merge_invalid,
         v_deleted_missing_merge_invalid, v_deleted_self_merge_invalid,
         v_deleted_invalid_target_merge_invalid,
         v_deleted_chained_merge_invalid
  from private.agent_p2_sales_document_header_source_v1(
    '98000000-0000-4000-8000-000000000001',
    array['estimate']::text[], null, null, null, null, 'CAD', 16
  ) source;

  select pg_catalog.count(*)::integer
    into v_deleted_detail_count
  from private.agent_p2_sales_document_header_source_v1(
    '98000000-0000-4000-8000-000000000001',
    array['estimate']::text[], null, null, null,
    '98200000-0000-4000-8000-000000000002', 'CAD', 16
  );

  select pg_catalog.count(*)::integer
    into v_valid_merge_detail_count
  from private.agent_p2_sales_document_header_source_v1(
    '98000000-0000-4000-8000-000000000001',
    array['estimate']::text[], null, null, null,
    '98200000-0000-4000-8000-000000000006', 'CAD', 16
  );

  if v_count is distinct from 9
     or v_deleted_header_count is distinct from 0
     or v_deleted_detail_count is distinct from 0
     or v_valid_merge_header_count is distinct from 0
     or v_valid_merge_detail_count is distinct from 0
     or v_current_invalid is distinct from false
     or v_foreign_invalid is distinct from true
     or v_missing_invalid is distinct from true
     or v_mismatch_invalid is distinct from true
     or v_deleted_foreign_merge_invalid is distinct from true
     or v_deleted_missing_merge_invalid is distinct from true
     or v_deleted_self_merge_invalid is distinct from true
     or v_deleted_invalid_target_merge_invalid is distinct from true
     or v_deleted_chained_merge_invalid is distinct from true then
    raise exception
      'agent_financial_tombstone_runtime_failed:sales_boundary';
  end if;
end;
$sales_fail_closed_boundary$;

insert into public.invoices(
  id, company_id, client_id, client_ref, invoice_number, subject, status,
  issue_date, due_date, total, amount_paid, balance_due, updated_at,
  deleted_at
) values
  ('98300000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000001',
   'INV-CURRENT', 'Current invoice', 'awaiting_payment', '2026-08-28',
   '2026-09-28', 100.00, 10.00, 90.00,
   timestamptz '2026-08-30 14:00:00+00', null),
  ('98300000-0000-4000-8000-000000000002',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000001',
   'INV-DELETED', 'Deleted invoice', 'void', '2026-08-28', '2026-09-28',
   200.00, 20.00, 180.00, timestamptz '2026-08-30 15:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000003',
   '98000000-0000-4000-8000-000000000002',
   '98100000-0000-4000-8000-000000000003',
   '98100000-0000-4000-8000-000000000003',
   'INV-FOREIGN', 'Foreign invoice', 'awaiting_payment', '2026-08-28',
   '2026-09-28', 300.00, 30.00, 270.00,
   timestamptz '2026-08-30 13:00:00+00', null),
  ('98300000-0000-4000-8000-000000000004',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000002',
   '98100000-0000-4000-8000-000000000002',
   'INV-DELETED-CLIENT', 'Deleted-client invoice', 'awaiting_payment',
   '2026-08-28', '2026-09-28', 400.00, 40.00, 360.00,
   timestamptz '2026-08-30 12:30:00+00', null),
  ('98300000-0000-4000-8000-000000000005',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000004',
   '98100000-0000-4000-8000-000000000002',
   'INV-MISMATCH', 'Mismatched-client invoice', 'awaiting_payment',
   '2026-08-28', '2026-09-28', 500.00, 50.00, 450.00,
   timestamptz '2026-08-30 12:00:00+00', null),
  ('98300000-0000-4000-8000-000000000006',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000099',
   '98100000-0000-4000-8000-000000000099',
   'INV-MISSING', 'Missing-client invoice', 'awaiting_payment',
   '2026-08-28', '2026-09-28', 600.00, 60.00, 540.00,
   timestamptz '2026-08-30 11:00:00+00', null),
  ('98300000-0000-4000-8000-000000000007',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000003',
   '98100000-0000-4000-8000-000000000003',
   'INV-FOREIGN-CLIENT', 'Foreign-client invoice', 'awaiting_payment',
   '2026-08-28', '2026-09-28', 700.00, 70.00, 630.00,
   timestamptz '2026-08-30 10:00:00+00', null),
  ('98300000-0000-4000-8000-000000000008',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000005',
   '98100000-0000-4000-8000-000000000005',
   'INV-VALID-MERGE', 'Valid merged-client invoice', 'awaiting_payment',
   '2026-08-28', '2026-09-28', 800.00, 80.00, 720.00,
   timestamptz '2026-08-30 16:00:00+00', null),
  ('98300000-0000-4000-8000-000000000014',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000004',
   'INV-DELETED-DUAL-MISMATCH', 'Deleted invoice with mismatched client refs',
   'void', '2026-08-28', '2026-09-28', 1400.00, 140.00, 1260.00,
   timestamptz '2026-08-30 04:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000015',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000004',
   '98100000-0000-4000-8000-000000000004',
   'INV-DELETED-PAYMENT-MISMATCH', 'Deleted invoice with other client',
   'void', '2026-08-28', '2026-09-28', 1500.00, 150.00, 1350.00,
   timestamptz '2026-08-30 03:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000016',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000003',
   '98100000-0000-4000-8000-000000000003',
   'INV-DELETED-FOREIGN-CLIENT', 'Deleted invoice with foreign client',
   'void', '2026-08-28', '2026-09-28', 1600.00, 160.00, 1440.00,
   timestamptz '2026-08-30 02:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000017',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000002',
   '98100000-0000-4000-8000-000000000002',
   'INV-DELETED-PLAIN-DELETED-CLIENT', 'Deleted invoice with deleted client',
   'void', '2026-08-28', '2026-09-28', 1700.00, 170.00, 1530.00,
   timestamptz '2026-08-30 01:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000018',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000005',
   '98100000-0000-4000-8000-000000000005',
   'INV-DELETED-VALID-MERGE', 'Deleted invoice with valid merged client',
   'void', '2026-08-28', '2026-09-28', 1800.00, 180.00, 1620.00,
   timestamptz '2026-08-30 00:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000019',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000006',
   '98100000-0000-4000-8000-000000000006',
   'INV-DELETED-FOREIGN-MERGE', 'Deleted invoice with foreign merge target',
   'void', '2026-08-28', '2026-09-28', 1900.00, 190.00, 1710.00,
   timestamptz '2026-08-29 23:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000020',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000007',
   '98100000-0000-4000-8000-000000000007',
   'INV-DELETED-MISSING-MERGE', 'Deleted invoice with missing merge target',
   'void', '2026-08-28', '2026-09-28', 2000.00, 200.00, 1800.00,
   timestamptz '2026-08-29 22:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000021',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000008',
   '98100000-0000-4000-8000-000000000008',
   'INV-DELETED-SELF-MERGE', 'Deleted invoice with self merge target',
   'void', '2026-08-28', '2026-09-28', 2100.00, 210.00, 1890.00,
   timestamptz '2026-08-29 21:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000022',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000009',
   '98100000-0000-4000-8000-000000000009',
   'INV-DELETED-DELETED-TARGET', 'Deleted invoice with deleted merge target',
   'void', '2026-08-28', '2026-09-28', 2200.00, 220.00, 1980.00,
   timestamptz '2026-08-29 20:00:00+00',
   timestamptz '2026-08-30 16:00:00+00'),
  ('98300000-0000-4000-8000-000000000023',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000011',
   '98100000-0000-4000-8000-000000000011',
   'INV-DELETED-CHAINED-MERGE', 'Deleted invoice with chained merge target',
   'void', '2026-08-28', '2026-09-28', 2300.00, 230.00, 2070.00,
   timestamptz '2026-08-29 19:00:00+00',
   timestamptz '2026-08-30 16:00:00+00');

do $sales_invoice_tombstone_before_bound$
declare
  v_rows record;
begin
  select * into strict v_rows
  from private.agent_p2_sales_document_header_source_v1(
    '98000000-0000-4000-8000-000000000001',
    array['invoice']::text[], null, null, null, null, 'CAD', 1
  );
  if v_rows.document_id is distinct from
       '98300000-0000-4000-8000-000000000001'::uuid
     or v_rows.source_invalid then
    raise exception
      'agent_financial_tombstone_runtime_failed:sales_invoice_bound';
  end if;
end;
$sales_invoice_tombstone_before_bound$;

insert into public.invoices(
  id, company_id, client_id, client_ref, invoice_number, subject, status,
  issue_date, due_date, total, amount_paid, balance_due, updated_at,
  deleted_at
) values
  ('98300000-0000-4000-8000-000000000009',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000006',
   '98100000-0000-4000-8000-000000000006',
   'INV-FOREIGN-MERGE', 'Foreign-target merge invoice', 'awaiting_payment',
   '2026-08-28', '2026-09-28', 900.00, 90.00, 810.00,
   timestamptz '2026-08-30 09:00:00+00', null),
  ('98300000-0000-4000-8000-000000000010',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000007',
   '98100000-0000-4000-8000-000000000007',
   'INV-MISSING-MERGE', 'Missing-target merge invoice', 'awaiting_payment',
   '2026-08-28', '2026-09-28', 1000.00, 100.00, 900.00,
   timestamptz '2026-08-30 08:00:00+00', null),
  ('98300000-0000-4000-8000-000000000011',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000008',
   '98100000-0000-4000-8000-000000000008',
   'INV-SELF-MERGE', 'Self merge invoice', 'awaiting_payment',
   '2026-08-28', '2026-09-28', 1100.00, 110.00, 990.00,
   timestamptz '2026-08-30 07:00:00+00', null),
  ('98300000-0000-4000-8000-000000000012',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000009',
   '98100000-0000-4000-8000-000000000009',
   'INV-DELETED-TARGET-MERGE', 'Deleted-target merge invoice',
   'awaiting_payment', '2026-08-28', '2026-09-28',
   1200.00, 120.00, 1080.00, timestamptz '2026-08-30 06:00:00+00', null),
  ('98300000-0000-4000-8000-000000000013',
   '98000000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000011',
   '98100000-0000-4000-8000-000000000011',
   'INV-CHAINED-TARGET-MERGE', 'Chained-target merge invoice',
   'awaiting_payment', '2026-08-28', '2026-09-28',
   1300.00, 130.00, 1170.00, timestamptz '2026-08-30 05:00:00+00', null);

do $sales_invoice_fail_closed_boundary$
declare
  v_count integer;
  v_deleted_header_count integer;
  v_deleted_detail_count integer;
  v_valid_merge_header_count integer;
  v_valid_merge_detail_count integer;
  v_current_invalid boolean;
  v_foreign_invalid boolean;
  v_missing_invalid boolean;
  v_mismatch_invalid boolean;
  v_deleted_foreign_merge_invalid boolean;
  v_deleted_missing_merge_invalid boolean;
  v_deleted_self_merge_invalid boolean;
  v_deleted_invalid_target_merge_invalid boolean;
  v_deleted_chained_merge_invalid boolean;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000004'::uuid
         )::integer,
         pg_catalog.count(*) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000008'::uuid
         )::integer,
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000001'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000007'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000006'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000005'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000009'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000010'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000011'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000012'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.document_id =
             '98300000-0000-4000-8000-000000000013'::uuid
         )
    into v_count, v_deleted_header_count, v_valid_merge_header_count,
         v_current_invalid, v_foreign_invalid, v_missing_invalid,
         v_mismatch_invalid, v_deleted_foreign_merge_invalid,
         v_deleted_missing_merge_invalid, v_deleted_self_merge_invalid,
         v_deleted_invalid_target_merge_invalid,
         v_deleted_chained_merge_invalid
  from private.agent_p2_sales_document_header_source_v1(
    '98000000-0000-4000-8000-000000000001',
    array['invoice']::text[], null, null, null, null, 'CAD', 16
  ) source;

  select pg_catalog.count(*)::integer
    into v_deleted_detail_count
  from private.agent_p2_sales_document_header_source_v1(
    '98000000-0000-4000-8000-000000000001',
    array['invoice']::text[], null, null, null,
    '98300000-0000-4000-8000-000000000004', 'CAD', 16
  );

  select pg_catalog.count(*)::integer
    into v_valid_merge_detail_count
  from private.agent_p2_sales_document_header_source_v1(
    '98000000-0000-4000-8000-000000000001',
    array['invoice']::text[], null, null, null,
    '98300000-0000-4000-8000-000000000008', 'CAD', 16
  );

  if v_count is distinct from 9
     or v_deleted_header_count is distinct from 0
     or v_deleted_detail_count is distinct from 0
     or v_valid_merge_header_count is distinct from 0
     or v_valid_merge_detail_count is distinct from 0
     or v_current_invalid is distinct from false
     or v_foreign_invalid is distinct from true
     or v_missing_invalid is distinct from true
     or v_mismatch_invalid is distinct from true
     or v_deleted_foreign_merge_invalid is distinct from true
     or v_deleted_missing_merge_invalid is distinct from true
     or v_deleted_self_merge_invalid is distinct from true
     or v_deleted_invalid_target_merge_invalid is distinct from true
     or v_deleted_chained_merge_invalid is distinct from true then
    raise exception
      'agent_financial_tombstone_runtime_failed:sales_invoice_boundary';
  end if;
end;
$sales_invoice_fail_closed_boundary$;

insert into public.payments(
  id, company_id, invoice_id, client_id, amount, payment_method, payment_date
) values
  ('98400000-0000-4000-8000-000000000001',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000001', 10.00, 'cash', '2026-08-29'),
  ('98400000-0000-4000-8000-000000000002',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000002',
   '98100000-0000-4000-8000-000000000001', 20.00, 'cash', '2026-08-30'),
  ('98400000-0000-4000-8000-000000000004',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000099',
   '98100000-0000-4000-8000-000000000001', 40.00, 'cash', '2026-08-27'),
  ('98400000-0000-4000-8000-000000000005',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000001',
   '98100000-0000-4000-8000-000000000004', 50.00, 'cash', '2026-08-26'),
  ('98400000-0000-4000-8000-000000000009',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000017',
   '98100000-0000-4000-8000-000000000002', 90.00, 'cash', '2026-08-30'),
  ('98400000-0000-4000-8000-000000000010',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000018',
   '98100000-0000-4000-8000-000000000005', 100.00, 'cash', '2026-08-30');

do $payment_tombstone_before_bound$
declare
  v_rows record;
begin
  select * into strict v_rows
  from private.agent_p2_payment_source_v1(
    '98000000-0000-4000-8000-000000000001', null, null, null, null,
    null, null, array['bank','card','cash','check','other']::text[],
    array['applied','voided']::text[], 'CAD',
    timestamptz '2026-08-30 23:00:00+00', 1
  );
  if v_rows.payment_id is distinct from
       '98400000-0000-4000-8000-000000000001'::uuid
     or v_rows.source_invalid then
    raise exception 'agent_financial_tombstone_runtime_failed:payment_bound';
  end if;
end;
$payment_tombstone_before_bound$;

insert into public.payments(
  id, company_id, invoice_id, client_id, amount, payment_method, payment_date
) values
  ('98400000-0000-4000-8000-000000000003',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000003',
   '98100000-0000-4000-8000-000000000001', 30.00, 'cash', '2026-08-28'),
  ('98400000-0000-4000-8000-000000000006',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000014',
   '98100000-0000-4000-8000-000000000001', 60.00, 'cash', '2026-08-25'),
  ('98400000-0000-4000-8000-000000000007',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000015',
   '98100000-0000-4000-8000-000000000001', 70.00, 'cash', '2026-08-24'),
  ('98400000-0000-4000-8000-000000000008',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000016',
   '98100000-0000-4000-8000-000000000003', 80.00, 'cash', '2026-08-23'),
  ('98400000-0000-4000-8000-000000000011',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000019',
   '98100000-0000-4000-8000-000000000006', 110.00, 'cash', '2026-08-22'),
  ('98400000-0000-4000-8000-000000000012',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000020',
   '98100000-0000-4000-8000-000000000007', 120.00, 'cash', '2026-08-21'),
  ('98400000-0000-4000-8000-000000000013',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000021',
   '98100000-0000-4000-8000-000000000008', 130.00, 'cash', '2026-08-20'),
  ('98400000-0000-4000-8000-000000000014',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000022',
   '98100000-0000-4000-8000-000000000009', 140.00, 'cash', '2026-08-19'),
  ('98400000-0000-4000-8000-000000000015',
   '98000000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000023',
   '98100000-0000-4000-8000-000000000011', 150.00, 'cash', '2026-08-18');

do $payment_fail_closed_boundary$
declare
  v_count integer;
  v_deleted_header_count integer;
  v_deleted_detail_count integer;
  v_plain_deleted_client_header_count integer;
  v_plain_deleted_client_detail_count integer;
  v_valid_merge_header_count integer;
  v_valid_merge_detail_count integer;
  v_current_invalid boolean;
  v_foreign_invalid boolean;
  v_missing_invalid boolean;
  v_mismatch_invalid boolean;
  v_deleted_invoice_dual_ref_invalid boolean;
  v_deleted_invoice_mismatch_invalid boolean;
  v_deleted_invoice_foreign_client_invalid boolean;
  v_deleted_invoice_foreign_merge_invalid boolean;
  v_deleted_invoice_missing_merge_invalid boolean;
  v_deleted_invoice_self_merge_invalid boolean;
  v_deleted_invoice_deleted_target_invalid boolean;
  v_deleted_invoice_chained_merge_invalid boolean;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000002'::uuid
         )::integer,
         pg_catalog.count(*) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000009'::uuid
         )::integer,
         pg_catalog.count(*) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000010'::uuid
         )::integer,
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000001'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000003'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000004'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000005'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000006'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000007'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000008'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000011'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000012'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000013'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000014'::uuid
         ),
         pg_catalog.bool_or(source.source_invalid) filter (
           where source.payment_id =
             '98400000-0000-4000-8000-000000000015'::uuid
         )
    into v_count, v_deleted_header_count,
         v_plain_deleted_client_header_count, v_valid_merge_header_count,
         v_current_invalid, v_foreign_invalid, v_missing_invalid,
         v_mismatch_invalid, v_deleted_invoice_dual_ref_invalid,
         v_deleted_invoice_mismatch_invalid,
         v_deleted_invoice_foreign_client_invalid,
         v_deleted_invoice_foreign_merge_invalid,
         v_deleted_invoice_missing_merge_invalid,
         v_deleted_invoice_self_merge_invalid,
         v_deleted_invoice_deleted_target_invalid,
         v_deleted_invoice_chained_merge_invalid
  from private.agent_p2_payment_source_v1(
    '98000000-0000-4000-8000-000000000001', null, null, null, null,
    null, null, array['bank','card','cash','check','other']::text[],
    array['applied','voided']::text[], 'CAD',
    timestamptz '2026-08-30 23:00:00+00', 16
  ) source;

  select pg_catalog.count(*)::integer
    into v_deleted_detail_count
  from private.agent_p2_payment_source_v1(
    '98000000-0000-4000-8000-000000000001',
    '98300000-0000-4000-8000-000000000002', null, null, null,
    null, null, array['bank','card','cash','check','other']::text[],
    array['applied','voided']::text[], 'CAD',
    timestamptz '2026-08-30 23:00:00+00', 16
  );

  select pg_catalog.count(*)::integer
    into v_plain_deleted_client_detail_count
  from private.agent_p2_payment_source_v1(
    '98000000-0000-4000-8000-000000000001',
    '98300000-0000-4000-8000-000000000017', null, null, null,
    null, null, array['bank','card','cash','check','other']::text[],
    array['applied','voided']::text[], 'CAD',
    timestamptz '2026-08-30 23:00:00+00', 16
  );

  select pg_catalog.count(*)::integer
    into v_valid_merge_detail_count
  from private.agent_p2_payment_source_v1(
    '98000000-0000-4000-8000-000000000001',
    '98300000-0000-4000-8000-000000000018', null, null, null,
    null, null, array['bank','card','cash','check','other']::text[],
    array['applied','voided']::text[], 'CAD',
    timestamptz '2026-08-30 23:00:00+00', 16
  );

  if v_count is distinct from 12
     or v_deleted_header_count is distinct from 0
     or v_deleted_detail_count is distinct from 0
     or v_plain_deleted_client_header_count is distinct from 0
     or v_plain_deleted_client_detail_count is distinct from 0
     or v_valid_merge_header_count is distinct from 0
     or v_valid_merge_detail_count is distinct from 0
     or v_current_invalid is distinct from false
     or v_foreign_invalid is distinct from true
     or v_missing_invalid is distinct from true
     or v_mismatch_invalid is distinct from true
     or v_deleted_invoice_dual_ref_invalid is distinct from true
     or v_deleted_invoice_mismatch_invalid is distinct from true
     or v_deleted_invoice_foreign_client_invalid is distinct from true
     or v_deleted_invoice_foreign_merge_invalid is distinct from true
     or v_deleted_invoice_missing_merge_invalid is distinct from true
     or v_deleted_invoice_self_merge_invalid is distinct from true
     or v_deleted_invoice_deleted_target_invalid is distinct from true
     or v_deleted_invoice_chained_merge_invalid is distinct from true then
    raise exception
      'agent_financial_tombstone_runtime_failed:payment_boundary';
  end if;
end;
$payment_fail_closed_boundary$;

rollback;
