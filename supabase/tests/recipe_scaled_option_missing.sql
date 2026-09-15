-- Runtime proof for 20260915220000_recipe_scaled_option_missing_zero.sql.
--
-- Run against a LOCAL schema copy only (never production):
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=<local db>" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/recipe_scaled_option_missing.sql
--
-- Builds synthetic rows inside one transaction, resolves an approved estimate's
-- material demand as a synthetic operator, prints one row per case, raises if
-- any case disagrees with the expected result, and always ends in ROLLBACK.
--
-- Recipe: product "Railing" has integer option "Left ends" and one material
-- (end post, pinned variant) at 2 per option unit. Every scaled line has line
-- quantity 20, so a fallback to quantity_per_unit x line quantity would book 40.
-- Product "Fascia" has an unscaled material at 2 per product unit.

begin;

-- Fixture writes bypass product triggers (revision bumps, accounting queue,
-- custody guards) that are irrelevant to the resolver under test.
set local session_replication_role = replica;

insert into public.companies (id, name, public_handle)
values ('5ca1ed00-0000-4000-8000-000000000001', 'Scaled option fixture co', 'scaled-option-fixture');

insert into public.users (id, first_name, last_name, auth_id, company_id)
values ('5ca1ed00-0000-4000-8000-000000000002', 'Fixture', 'Operator',
        '5ca1ed00-0000-4000-8000-0000000000a1', '5ca1ed00-0000-4000-8000-000000000001');

insert into public.company_inventory_settings (company_id, inventory_mode, enabled_at)
values ('5ca1ed00-0000-4000-8000-000000000001', 'tracked', now());

insert into public.projects (id, company_id, title)
values ('5ca1ed00-0000-4000-8000-000000000003', '5ca1ed00-0000-4000-8000-000000000001', 'Fixture deck');

insert into public.estimates (id, company_id, client_id, estimate_number, status, project_ref)
values ('5ca1ed00-0000-4000-8000-000000000004', '5ca1ed00-0000-4000-8000-000000000001',
        '5ca1ed00-0000-4000-8000-000000000005', 'FIXTURE-1', 'approved',
        '5ca1ed00-0000-4000-8000-000000000003');

insert into public.catalog_items (id, company_id, name)
values ('5ca1ed00-0000-4000-8000-000000000010', '5ca1ed00-0000-4000-8000-000000000001', 'End post');

insert into public.catalog_variants (id, company_id, catalog_item_id, is_active)
values ('5ca1ed00-0000-4000-8000-000000000011', '5ca1ed00-0000-4000-8000-000000000001',
        '5ca1ed00-0000-4000-8000-000000000010', true);

insert into public.products (id, company_id, name, kind, type)
values ('5ca1ed00-0000-4000-8000-000000000020', '5ca1ed00-0000-4000-8000-000000000001', 'Railing', 'service', 'OTHER'),
       ('5ca1ed00-0000-4000-8000-000000000021', '5ca1ed00-0000-4000-8000-000000000001', 'Fascia', 'service', 'OTHER');

insert into public.product_options (id, product_id, name, kind, required, affects_recipe, default_value)
values ('5ca1ed00-0000-4000-8000-000000000030', '5ca1ed00-0000-4000-8000-000000000020',
        'Left ends', 'integer', true, true, '1');

insert into public.product_materials (id, product_id, catalog_variant_id, quantity_per_unit, scaled_by_option_id)
values ('5ca1ed00-0000-4000-8000-000000000040', '5ca1ed00-0000-4000-8000-000000000020',
        '5ca1ed00-0000-4000-8000-000000000011', 2, '5ca1ed00-0000-4000-8000-000000000030'),
       ('5ca1ed00-0000-4000-8000-000000000041', '5ca1ed00-0000-4000-8000-000000000021',
        '5ca1ed00-0000-4000-8000-000000000011', 2, null);

create temp table scaled_option_cases (
  case_label text primary key,
  line_item_id uuid not null,
  sort_order integer not null,
  product_id uuid not null,
  configured_options jsonb not null,
  expected_required numeric not null,
  expected_warning boolean not null
) on commit drop;

insert into scaled_option_cases values
  ('a scaled value 3',           '5ca1ed00-0000-4000-8000-000000000101', 1, '5ca1ed00-0000-4000-8000-000000000020', '{"5ca1ed00-0000-4000-8000-000000000030": 3}',      6,  false),
  ('b scaled key missing',       '5ca1ed00-0000-4000-8000-000000000102', 2, '5ca1ed00-0000-4000-8000-000000000020', '{}',                                              0,  true),
  ('c scaled value "abc"',       '5ca1ed00-0000-4000-8000-000000000103', 3, '5ca1ed00-0000-4000-8000-000000000020', '{"5ca1ed00-0000-4000-8000-000000000030": "abc"}', 0,  true),
  ('d scaled value "2"',         '5ca1ed00-0000-4000-8000-000000000104', 4, '5ca1ed00-0000-4000-8000-000000000020', '{"5ca1ed00-0000-4000-8000-000000000030": "2"}',   4,  false),
  ('e unscaled line qty 20',     '5ca1ed00-0000-4000-8000-000000000105', 5, '5ca1ed00-0000-4000-8000-000000000021', '{}',                                              40, false),
  ('f scaled value " 4 "',       '5ca1ed00-0000-4000-8000-000000000106', 6, '5ca1ed00-0000-4000-8000-000000000020', '{"5ca1ed00-0000-4000-8000-000000000030": " 4 "}', 8,  false),
  ('g scaled value true',        '5ca1ed00-0000-4000-8000-000000000107', 7, '5ca1ed00-0000-4000-8000-000000000020', '{"5ca1ed00-0000-4000-8000-000000000030": true}',  0,  true),
  ('h scaled value null',        '5ca1ed00-0000-4000-8000-000000000108', 8, '5ca1ed00-0000-4000-8000-000000000020', '{"5ca1ed00-0000-4000-8000-000000000030": null}',  0,  true),
  ('i scaled value -2 clamps',   '5ca1ed00-0000-4000-8000-000000000109', 9, '5ca1ed00-0000-4000-8000-000000000020', '{"5ca1ed00-0000-4000-8000-000000000030": -2}',    0,  false);

insert into public.line_items (id, company_id, estimate_id, product_id, name, quantity, sort_order, configured_options)
select case_row.line_item_id, '5ca1ed00-0000-4000-8000-000000000001', '5ca1ed00-0000-4000-8000-000000000004',
       case_row.product_id, case_row.case_label, 20, case_row.sort_order, case_row.configured_options
  from scaled_option_cases case_row;

set local session_replication_role = origin;
set local request.jwt.claims = '{"sub":"5ca1ed00-0000-4000-8000-0000000000a1"}';

create temp table scaled_option_plan on commit drop as
select private.resolve_estimate_material_demand_plan(
  '5ca1ed00-0000-4000-8000-000000000004',
  '5ca1ed00-0000-4000-8000-000000000003'
) as plan;

create temp table scaled_option_results on commit drop as
select
  case_row.case_label,
  case_row.configured_options -> '5ca1ed00-0000-4000-8000-000000000030' as configured_value,
  (demand ->> 'required_quantity')::numeric as required_quantity,
  case_row.expected_required,
  demand ->> 'status' as demand_status,
  exists (
    select 1 from jsonb_array_elements(demand -> 'warning_payload' -> 'warnings') w
     where w ->> 'code' = 'scaled_option_value_missing'
  ) as demand_warning,
  exists (
    select 1 from jsonb_array_elements(plan_row.plan -> 'warnings') w
     where w ->> 'code' = 'scaled_option_value_missing'
       and w ->> 'line_item_id' = case_row.line_item_id::text
  ) as top_level_warning,
  case_row.expected_warning
from scaled_option_cases case_row
cross join scaled_option_plan plan_row
left join lateral (
  select d from jsonb_array_elements(plan_row.plan -> 'demands') d
   where d ->> 'line_item_id' = case_row.line_item_id::text
) demand_row(demand) on true;

\pset footer off
select
  case_label,
  coalesce(configured_value::text, '(absent)') as configured_value,
  required_quantity,
  expected_required,
  demand_status,
  demand_warning,
  top_level_warning,
  case
    when required_quantity = expected_required
     and demand_warning = expected_warning
     and top_level_warning = expected_warning
    then 'PASS' else 'FAIL'
  end as result
from scaled_option_results
order by case_label;

select
  (plan -> 'ok')::text as ok,
  plan ->> 'demand_count' as demand_count,
  plan ->> 'warning_count' as warning_count,
  (select count(*) from jsonb_array_elements(plan -> 'warnings') w
    where w ->> 'code' = 'scaled_option_value_missing') as scaled_option_value_missing_warnings
from scaled_option_plan;

do $assert$
declare
  v_failures integer;
  v_missing integer;
begin
  select count(*) into v_failures
    from scaled_option_results
   where required_quantity is distinct from expected_required
      or demand_warning is distinct from expected_warning
      or top_level_warning is distinct from expected_warning;
  select count(*) into v_missing
    from jsonb_array_elements((select plan -> 'warnings' from scaled_option_plan)) w
   where w ->> 'code' = 'scaled_option_value_missing';
  if v_failures > 0 or v_missing <> 4 then
    raise exception 'recipe_scaled_option_missing_runtime_failed: % case(s), % warning(s)', v_failures, v_missing;
  end if;
  raise notice 'recipe_scaled_option_missing_runtime_passed';
end;
$assert$;

rollback;
