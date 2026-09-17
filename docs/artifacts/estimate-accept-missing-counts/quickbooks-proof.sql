-- QuickBooks acceptance path, before and after
-- 20260917010000_estimate_accept_refuses_missing_counts.sql.
--
-- The migration deliberately leaves public.accept_estimate_to_job_from_quickbooks
-- alone (a refusal there would be silent — see local-proof.md). This proves the
-- path behaves identically on both clones: a QuickBooks-accepted Canpro estimate
-- whose counts are blank is still accepted, with the resolver's warnings.
-- LOCAL proving Postgres only; ends in ROLLBACK.
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=<db>" -v ON_ERROR_STOP=1 -f quickbooks-proof.sql
\set ON_ERROR_STOP 1
\pset footer off
begin;

select current_database() as database,
       (to_regprocedure('private.assert_estimate_accept_recipe_counts(uuid)') is not null) as migration_applied,
       md5(prosrc) as accept_from_quickbooks_md5
  from pg_proc
 where oid = 'public.accept_estimate_to_job_from_quickbooks(uuid,uuid,uuid,text,text)'::regprocedure;

-- The bridge acts as the company's account holder; the connection must be a
-- live, pulling QuickBooks connection; the estimate must carry its qb_id.
set local session_replication_role = replica;
update public.companies
   set account_holder_id = '11111111-1111-4111-8111-111111111111'
 where id = 'a612edc0-5c18-4c4d-af97-55b9410dd077';
insert into public.accounting_connections (id, company_id, provider, is_connected, sync_enabled, sync_direction)
values ('77777777-7777-4777-8777-777777777777', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        'quickbooks', true, true, 'bidirectional');
set local session_replication_role = origin;

insert into public.opportunities (id, company_id, client_id, title)
values ('66666666-6666-4666-8666-0000000000f1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '33333333-3333-4333-8333-333333333333', 'QuickBooks acceptance proof');
insert into public.estimates (id, company_id, client_id, opportunity_id, estimate_number, title, status, qb_id)
values ('44444444-4444-4444-8444-0000000000f1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '33333333-3333-4333-8333-333333333333', '66666666-6666-4666-8666-0000000000f1',
        'QB-PROOF', 'QuickBooks acceptance proof', 'sent', 'qb-proof-1');
-- Every integer count blank: the four selects only.
insert into public.line_items (id, company_id, estimate_id, product_id, name, quantity, unit_price, type, sort_order, configured_options)
values ('55555555-5555-4555-8555-0000000000f1', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
        '44444444-4444-4444-8444-0000000000f1', '3efc9582-ac59-4f13-919e-c1b3e3495cc3',
        'Picket Rail — Level', 20, 70, 'LABOR', 0,
        '{"faff8b46-c783-4267-b414-a74c6220b914":"8a417951-1351-4c7e-bc7d-ffb980dd2cf7",
          "154a3ea9-6ce7-4be1-9880-2f7fc929b0bf":"fbc6fbb1-c364-4060-b071-2a89f21b886f",
          "d7e68376-f083-4fd3-b63b-3123fafe5ee4":"d3fad1da-a112-431e-9d59-f0606100f458",
          "f33f9daf-e2e3-40aa-898b-dbfdc7c4b18f":"dff39513-8d9f-42e9-ab9d-bb96c3c1e5b4"}');

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
create temp table qb_result on commit drop as
select public.accept_estimate_to_job_from_quickbooks(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '77777777-7777-4777-8777-777777777777',
  '44444444-4444-4444-8444-0000000000f1',
  'qb-proof-1',
  'qbo:estimate:accepted:77777777-7777-4777-8777-777777777777:qb-proof-1'
) as r;
reset role;

\echo === QUICKBOOKS ACCEPTANCE WITH EVERY COUNT BLANK
select r ->> 'status' as status,
       r ->> 'inventory_mode' as mode,
       jsonb_array_length(r -> 'warnings') as warnings,
       (select count(*) from jsonb_array_elements(r -> 'warnings') w
         where w ->> 'code' = 'scaled_option_value_missing') as scaled_option_value_missing,
       jsonb_array_length(r -> 'demand_ids') as demand_rows,
       (select count(*) from public.project_material_demands d
         where d.estimate_id = '44444444-4444-4444-8444-0000000000f1' and d.required_quantity = 0) as zero_quantity_rows
  from qb_result;

rollback;
