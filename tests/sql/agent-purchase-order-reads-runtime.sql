\set ON_ERROR_STOP on

\if :{?agent_mcp_purchasing_bootstrap}
-- Disposable PostgreSQL 17 bootstrap layered on the sealed Task 18 schema.
create table if not exists public.catalog_orders (
  id uuid primary key,
  company_id uuid not null,
  status text not null,
  title text,
  supplier_name text,
  supplier_contact text,
  expected_delivery_date date,
  notes text,
  created_by_id uuid,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  sent_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  deleted_at timestamptz
);
create table if not exists public.catalog_order_items (
  id uuid primary key,
  order_id uuid not null,
  catalog_variant_id uuid not null,
  quantity_requested double precision not null,
  cost_per_unit numeric,
  notes text
);
-- The PostgreSQL fixture must use the same recursive ASCII-key canonicalizer
-- as production so SQL proof refs are independently comparable with TS.
create or replace function private.canonical_agent_projection_json(
  p_value jsonb
) returns text
language plpgsql
immutable
strict
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $canonical$
declare
  v_kind text := pg_catalog.jsonb_typeof(p_value);
  v_result text;
begin
  if v_kind = 'array' then
    select '[' || coalesce(
      pg_catalog.string_agg(
        private.canonical_agent_projection_json(element.value),
        ',' order by element.ordinality
      ),
      ''
    ) || ']'
      into v_result
    from pg_catalog.jsonb_array_elements(p_value) with ordinality
      as element(value, ordinality);
    return v_result;
  end if;
  if v_kind = 'object' then
    select '{' || coalesce(
      pg_catalog.string_agg(
        pg_catalog.to_jsonb(member.key)::text || ':' ||
          private.canonical_agent_projection_json(member.value),
        ',' order by member.key collate "C"
      ),
      ''
    ) || '}'
      into v_result
    from pg_catalog.jsonb_each(p_value) as member(key, value);
    return v_result;
  end if;
  if v_kind = 'number' and (
    pg_catalog.trunc(p_value::text::numeric) is distinct from
      p_value::text::numeric
    or pg_catalog.abs(p_value::text::numeric) >
      9007199254740991::numeric
  ) then
    raise exception 'agent_projection_number_not_safe_integer'
      using errcode = '22023';
  end if;
  return p_value::text;
end;
$canonical$;
insert into private.agent_read_domains(domain) values ('purchasing')
on conflict(domain) do nothing;
\ir ../../supabase/migrations/20260829091311_agent_purchasing_sources.sql
\ir ../../supabase/migrations/20260829091329_agent_purchase_order_reads.sql
\endif

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

-- Required proof ledger markers: runtime_requires_postgresql_17,
-- base_purchase_order_authority, cost_purchase_order_authority,
-- costs_redacted_by_default, zero_line_subtotal_uses_company_currency,
-- delivery_window_366_boundary,
-- delivery_window_reversed_rejected,
-- invalid_legacy_quantity_fails_whole_projection,
-- invalid_legacy_lifecycle_fails_whole_projection,
-- source_501_fails_closed, page_25_26, keyset_has_no_duplicates,
-- exact_money_rejects_fractional_minor, attention_is_bounded,
-- proof_binding, private_acl, purchasing_sources_bump,
-- purchasing_irrelevant_private_update_does_not_bump,
-- purchasing_old_new_company_fanout, purchasing_delivery_index,
-- purchasing_line_order_index, purchasing_source_private_acl.

do $runtime_requires_postgresql_17$
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'runtime_requires_postgresql_17';
  end if;
end;
$runtime_requires_postgresql_17$;

insert into public.companies(id, name, currency_code) values
  ('a1900000-0000-4000-8000-000000000001', 'Purchasing alpha', 'CAD'),
  ('a1900000-0000-4000-8000-000000000002', 'Purchasing bravo', 'CAD');
insert into public.users(id, company_id, first_name, last_name) values (
  'a1910000-0000-4000-8000-000000000001',
  'a1900000-0000-4000-8000-000000000001',
  'Ada', 'Buyer'
);
insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values
  (
    'a1920000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000001',
    'a1900000-0000-4000-8000-000000000001',
    'catalog.orders.view', 'all', true
  ),
  (
    'a1920000-0000-4000-8000-000000000002',
    'a1910000-0000-4000-8000-000000000001',
    'a1900000-0000-4000-8000-000000000001',
    'catalog.products.view', 'all', true
  ),
  (
    'a1920000-0000-4000-8000-000000000003',
    'a1910000-0000-4000-8000-000000000001',
    'a1900000-0000-4000-8000-000000000001',
    'finances.view', 'all', true
  );
insert into private.mcp_oauth_clients(
  client_id, scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  'a1930000-0000-4000-8000-000000000001',
  array['ops.catalog_costs.read', 'ops.purchasing.read'],
  'consent-v1', 'exposure-v1'
);
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  'a1940000-0000-4000-8000-000000000001',
  'a1910000-0000-4000-8000-000000000001',
  'a1900000-0000-4000-8000-000000000001',
  'a1930000-0000-4000-8000-000000000001',
  array['ops.catalog_costs.read', 'ops.purchasing.read'],
  '0123456789abcdef0123456789abcdef',
  array['ops.catalog_costs.read', 'ops.purchasing.read'],
  'consent-v1', 'exposure-v1'
);

insert into public.catalog_units(
  id, company_id, display, abbreviation, dimension, updated_at
) values (
  'a1911000-0000-4000-8000-000000000001',
  'a1900000-0000-4000-8000-000000000001',
  'Linear foot', 'LF', 'length', '2026-08-28 12:00:00+00'
);
insert into public.catalog_items(
  id, company_id, name, notes, external_id, external_source,
  default_unit_id, is_active, updated_at
) values (
  'a1912000-0000-4000-8000-000000000001',
  'a1900000-0000-4000-8000-000000000001',
  'Guardrail', 'PRIVATE FAMILY NOTE', 'PRIVATE-EXTERNAL-ID',
  'PRIVATE-PROVIDER', 'a1911000-0000-4000-8000-000000000001',
  true, '2026-08-28 12:00:00+00'
);
insert into public.catalog_variants(
  id, company_id, catalog_item_id, sku, quantity, unit_id,
  is_active, updated_at
) values (
  'a1913000-0000-4000-8000-000000000001',
  'a1900000-0000-4000-8000-000000000001',
  'a1912000-0000-4000-8000-000000000001',
  'RAIL-BLK-TOP', 100,
  'a1911000-0000-4000-8000-000000000001', true,
  '2026-08-28 12:00:00+00'
);
insert into public.catalog_options(
  id, catalog_item_id, name, sort_order, updated_at
) values (
  'a1914000-0000-4000-8000-000000000001',
  'a1912000-0000-4000-8000-000000000001', 'Colour', 0,
  '2026-08-28 12:00:00+00'
);
insert into public.catalog_option_values(
  id, option_id, value, sort_order, updated_at
) values (
  'a1915000-0000-4000-8000-000000000001',
  'a1914000-0000-4000-8000-000000000001', 'Black', 0,
  '2026-08-28 12:00:00+00'
);
insert into public.catalog_variant_option_values(
  id, variant_id, option_value_id, updated_at
) values (
  'a1916000-0000-4000-8000-000000000001',
  'a1913000-0000-4000-8000-000000000001',
  'a1915000-0000-4000-8000-000000000001',
  '2026-08-28 12:00:00+00'
);
insert into public.catalog_supplier_cost_profiles(
  id, company_id, catalog_variant_id, profile_key, label, unit_cost,
  currency_code, is_default, activation_rule, source, updated_at
) values (
  'a1917000-0000-4000-8000-000000000001',
  'a1900000-0000-4000-8000-000000000001',
  'a1913000-0000-4000-8000-000000000001',
  'PRIVATE-PROFILE', 'CanPro', 8.25, 'CAD', true,
  '{"private":"activation"}', '{"provider":"private"}',
  '2026-08-28 12:00:00+00'
);

insert into public.catalog_orders(
  id, company_id, status, title, supplier_name, supplier_contact,
  expected_delivery_date, notes, created_by_id, created_at, updated_at,
  sent_at
)
select (
         'a1950000-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       'a1900000-0000-4000-8000-000000000001'::uuid,
       'sent', 'Rail order ' || series.value, 'CanPro',
       'PRIVATE-SUPPLIER-CONTACT',
       date '2026-09-01' + series.value - 1,
       'PRIVATE ORDER NOTE',
       'a1910000-0000-4000-8000-000000000001'::uuid,
       '2026-08-01 12:00:00+00'::timestamptz,
       '2026-08-28 12:00:00+00'::timestamptz -
         pg_catalog.make_interval(secs => series.value),
       '2026-08-02 12:00:00+00'::timestamptz
from pg_catalog.generate_series(1, 26) series(value);
insert into public.catalog_orders(
  id, company_id, status, title, supplier_name, supplier_contact,
  expected_delivery_date, notes, created_at, updated_at
) values (
  'a1950000-0000-4000-8000-00000000ffff',
  'a1900000-0000-4000-8000-000000000001',
  'draft', 'Empty order', 'CanPro', 'PRIVATE-SUPPLIER-CONTACT',
  null, 'PRIVATE ORDER NOTE',
  '2026-08-01 12:00:00+00', '2026-08-28 12:00:00+00'
);
insert into public.catalog_order_items(
  id, order_id, catalog_variant_id, quantity_requested,
  cost_per_unit, notes
)
select (
         'a1960000-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       (
         'a1950000-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       'a1913000-0000-4000-8000-000000000001'::uuid,
       24.5, 13.88, 'PRIVATE LINE NOTE'
from pg_catalog.generate_series(1, 26) series(value);

create temporary table task19_authority (
  snapshot_revision text not null,
  base_candidates jsonb not null,
  cost_candidates jsonb not null
);
insert into task19_authority(
  snapshot_revision, base_candidates, cost_candidates
)
select authority.permission_snapshot_revision,
       '[{"variant_key":"orders","required_oauth_scopes":["ops.purchasing.read"],"resolved_permission_scopes":{"catalog.orders.view":"all"},"satisfied_permission_group_indexes":[0]}]'::jsonb,
       '[{"variant_key":"orders","required_oauth_scopes":["ops.purchasing.read"],"resolved_permission_scopes":{"catalog.orders.view":"all"},"satisfied_permission_group_indexes":[0]},{"variant_key":"costs","required_oauth_scopes":["ops.catalog_costs.read"],"resolved_permission_scopes":{"catalog.products.view":"all","finances.view":"all"},"satisfied_permission_group_indexes":[0]}]'::jsonb
from private.resolve_agent_actor_authority(
  'a1910000-0000-4000-8000-000000000001',
  'a1900000-0000-4000-8000-000000000001',
  array['catalog.orders.view', 'catalog.products.view', 'finances.view']
) authority;

create or replace function pg_temp.task19_purchase_order_list(
  p_snapshot_revision text,
  p_candidates jsonb,
  p_include_costs boolean default false,
  p_statuses text[] default array[
    'cancelled', 'draft', 'fulfilled', 'sent', 'suggested'
  ]::text[],
  p_delivery_starts_on date default null,
  p_delivery_ends_on date default null,
  p_item_limit integer default 25,
  p_cursor_read_at timestamptz default null,
  p_cursor_source_revisions jsonb default '[]'::jsonb,
  p_after_delivery_sort_date date default null,
  p_after_updated_at timestamptz default null,
  p_after_order_id uuid default null
) returns jsonb
language sql stable set search_path = ''
as $$
  select public.read_agent_purchase_orders_as_system(
    'task19-runtime-list',
    'a1900000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000001',
    'a1940000-0000-4000-8000-000000000001',
    'a1930000-0000-4000-8000-000000000001',
    '0123456789abcdef0123456789abcdef',
    array['ops.catalog_costs.read', 'ops.purchasing.read'],
    p_snapshot_revision,
    array['catalog.orders.view', 'catalog.products.view', 'finances.view'],
    '2026-08-22.capability-manifest.v8',
    'list_purchase_orders', 'list_purchase_orders:2026-08-22.v1',
    p_candidates, p_statuses, null, p_delivery_starts_on,
    p_delivery_ends_on, p_include_costs, p_item_limit, p_item_limit + 1,
    501, 51, p_cursor_read_at, p_cursor_source_revisions,
    p_after_delivery_sort_date, p_after_updated_at, p_after_order_id
  );
$$;

create or replace function pg_temp.task19_purchase_order_detail(
  p_snapshot_revision text,
  p_candidates jsonb,
  p_purchase_order_id uuid,
  p_include_costs boolean default false
) returns jsonb
language sql stable set search_path = ''
as $$
  select public.read_agent_purchase_order_as_system(
    'task19-runtime-detail',
    'a1900000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000001',
    'a1940000-0000-4000-8000-000000000001',
    'a1930000-0000-4000-8000-000000000001',
    '0123456789abcdef0123456789abcdef',
    array['ops.catalog_costs.read', 'ops.purchasing.read'],
    p_snapshot_revision,
    array['catalog.orders.view', 'catalog.products.view', 'finances.view'],
    '2026-08-22.capability-manifest.v8',
    'get_purchase_order', 'get_purchase_order:2026-08-22.v1',
    p_candidates, p_purchase_order_id, p_include_costs, 501, 51
  );
$$;

do $base_purchase_order_authority$
declare
  v_result jsonb;
begin
  select pg_temp.task19_purchase_order_list(
           snapshot_revision, base_candidates, false
         )
    into v_result from task19_authority;
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 25
     or not (v_result ->> 'source_has_more')::boolean
     or v_result -> 'selected_authorization_variants' <>
          '["orders"]'::jsonb then
    raise exception 'base_purchase_order_authority';
  end if;
end;
$base_purchase_order_authority$;

do $cost_purchase_order_authority$
declare
  v_result jsonb;
  v_failed boolean := false;
begin
  select pg_temp.task19_purchase_order_detail(
           snapshot_revision, cost_candidates,
           'a1950000-0000-4000-8000-000000000001', true
         )
    into v_result from task19_authority;
  if v_result #>> '{purchase_order,lines,0,unit_cost,amount_minor}' <> '1388'
     or v_result #>> '{purchase_order,lines,0,line_total,amount_minor}' <>
          '34006'
     or v_result #>> '{purchase_order,costs,subtotal,amount_minor}' <>
          '34006'
     or v_result ->> 'catalog_cost_witness' !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'cost_purchase_order_authority';
  end if;
  begin
    perform pg_temp.task19_purchase_order_detail(
      authority.snapshot_revision, authority.base_candidates,
      'a1950000-0000-4000-8000-000000000001', true
    ) from task19_authority authority;
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then raise exception 'cost_purchase_order_authority'; end if;
end;
$cost_purchase_order_authority$;

do $zero_line_subtotal_uses_company_currency$
declare
  v_result jsonb;
begin
  select pg_temp.task19_purchase_order_detail(
           snapshot_revision, cost_candidates,
           'a1950000-0000-4000-8000-00000000ffff', true
         )
    into v_result from task19_authority;
  if v_result #>> '{purchase_order,costs,subtotal,amount_minor}' <> '0'
     or v_result #>> '{purchase_order,costs,subtotal,currency}' <> 'CAD'
     or v_result ->> 'company_currency' <> 'CAD' then
    raise exception 'zero_line_subtotal_uses_company_currency';
  end if;
end;
$zero_line_subtotal_uses_company_currency$;

do $costs_redacted_by_default$
declare
  v_result jsonb;
begin
  select pg_temp.task19_purchase_order_detail(
           snapshot_revision, base_candidates,
           'a1950000-0000-4000-8000-000000000001', false
         )
    into v_result from task19_authority;
  if v_result -> 'purchase_order' ? 'costs'
     or v_result #> '{purchase_order,lines,0}' ? 'unit_cost'
     or v_result #> '{purchase_order,lines,0}' ? 'line_total'
     or v_result::text ~
       '(supplier_contact|PRIVATE|"notes"|payment|provider|source_json)' then
    raise exception 'costs_redacted_by_default';
  end if;
end;
$costs_redacted_by_default$;

do $delivery_window_366_boundary$
begin
  perform pg_temp.task19_purchase_order_list(
    authority.snapshot_revision, authority.base_candidates, false,
    array['sent']::text[], date '2026-01-01', date '2027-01-02'
  ) from task19_authority authority;
end;
$delivery_window_366_boundary$;

do $delivery_window_reversed_rejected$
declare
  v_reversed boolean := false;
  v_too_wide boolean := false;
begin
  begin
    perform pg_temp.task19_purchase_order_list(
      authority.snapshot_revision, authority.base_candidates, false,
      array['sent']::text[], date '2026-10-01', date '2026-09-01'
    ) from task19_authority authority;
  exception when invalid_parameter_value then v_reversed := true;
  end;
  begin
    perform pg_temp.task19_purchase_order_list(
      authority.snapshot_revision, authority.base_candidates, false,
      array['sent']::text[], date '2026-01-01', date '2027-01-03'
    ) from task19_authority authority;
  exception when invalid_parameter_value then v_too_wide := true;
  end;
  if not v_reversed or not v_too_wide then
    raise exception 'delivery_window_reversed_rejected';
  end if;
end;
$delivery_window_reversed_rejected$;

do $page_25_26$
declare
  v_result jsonb;
begin
  select pg_temp.task19_purchase_order_list(
           snapshot_revision, base_candidates, false,
           array['sent']::text[]
         )
    into v_result from task19_authority;
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 25
     or not (v_result ->> 'source_has_more')::boolean
     or (v_result -> 'source_inspected' ->> 'orders')::integer <> 27
     or (v_result -> 'source_inspected' ->> 'lines')::integer <> 26 then
    raise exception 'page_25_26';
  end if;
end;
$page_25_26$;

do $keyset_has_no_duplicates$
declare
  v_first jsonb;
  v_second jsonb;
  v_last jsonb;
  v_overlap integer;
begin
  select pg_temp.task19_purchase_order_list(
           snapshot_revision, base_candidates, false,
           array['sent']::text[], null, null, 10
         )
    into v_first from task19_authority;
  v_last := v_first #> '{rows,9,predecessor}';
  select pg_temp.task19_purchase_order_list(
           authority.snapshot_revision, authority.base_candidates, false,
           array['sent']::text[], null, null, 10,
           (v_first ->> 'read_at')::timestamptz,
           v_first -> 'source_revisions',
           (v_last #>> '{order,0}')::date,
           (v_last #>> '{order,1}')::timestamptz,
           (v_last ->> 'tie_breaker')::uuid
         )
    into v_second from task19_authority authority;
  select pg_catalog.count(*)::integer into v_overlap
  from pg_catalog.jsonb_array_elements(v_first -> 'rows') first_row
  join pg_catalog.jsonb_array_elements(v_second -> 'rows') second_row
    on first_row.value #>> '{purchase_order,purchase_order_ref,id}' =
       second_row.value #>> '{purchase_order,purchase_order_ref,id}';
  if v_overlap <> 0
     or pg_catalog.jsonb_array_length(v_second -> 'rows') <> 10 then
    raise exception 'keyset_has_no_duplicates';
  end if;
end;
$keyset_has_no_duplicates$;

-- The malformed-row checks use savepoints so the same fixture continues.
savepoint task19_invalid_quantity;
update public.catalog_order_items set quantity_requested = 0
where id = 'a1960000-0000-4000-8000-00000000001a';
do $invalid_legacy_quantity_fails_whole_projection$
declare
  v_failed boolean := false;
begin
  begin
    perform pg_temp.task19_purchase_order_list(
      authority.snapshot_revision, authority.base_candidates, false,
      array['draft']::text[]
    ) from task19_authority authority;
  exception when data_exception then v_failed := true;
  end;
  if not v_failed then
    raise exception 'invalid_legacy_quantity_fails_whole_projection';
  end if;
end;
$invalid_legacy_quantity_fails_whole_projection$;
rollback to savepoint task19_invalid_quantity;

savepoint task19_invalid_lifecycle;
update public.catalog_orders
set status = 'fulfilled', fulfilled_at = null
where id = 'a1950000-0000-4000-8000-00000000001a';
do $invalid_legacy_lifecycle_fails_whole_projection$
declare
  v_failed boolean := false;
begin
  begin
    perform pg_temp.task19_purchase_order_list(
      authority.snapshot_revision, authority.base_candidates, false,
      array['draft']::text[]
    ) from task19_authority authority;
  exception when data_exception then v_failed := true;
  end;
  if not v_failed then
    raise exception 'invalid_legacy_lifecycle_fails_whole_projection';
  end if;
end;
$invalid_legacy_lifecycle_fails_whole_projection$;
rollback to savepoint task19_invalid_lifecycle;

savepoint task19_infinite_delivery_date;
update public.catalog_orders
set expected_delivery_date = 'infinity'::date
where id = 'a1950000-0000-4000-8000-00000000001a';
do $infinite_delivery_date_fails_whole_projection$
declare
  v_failed boolean := false;
begin
  begin
    perform pg_temp.task19_purchase_order_list(
      authority.snapshot_revision, authority.base_candidates, false,
      array['draft']::text[]
    ) from task19_authority authority;
  exception when data_exception then v_failed := true;
  end;
  if not v_failed then
    raise exception 'infinite_delivery_date_fails_whole_projection';
  end if;
end;
$infinite_delivery_date_fails_whole_projection$;
rollback to savepoint task19_infinite_delivery_date;

savepoint task19_out_of_range_timestamp;
update public.catalog_orders
set created_at = '10000-01-01 00:00:00+00'::timestamptz,
    updated_at = '10000-01-02 00:00:00+00'::timestamptz
where id = 'a1950000-0000-4000-8000-00000000001a';
do $out_of_range_timestamp_fails_whole_projection$
declare
  v_failed boolean := false;
begin
  begin
    perform pg_temp.task19_purchase_order_list(
      authority.snapshot_revision, authority.base_candidates, false,
      array['draft']::text[]
    ) from task19_authority authority;
  exception when data_exception then v_failed := true;
  end;
  if not v_failed then
    raise exception 'out_of_range_timestamp_fails_whole_projection';
  end if;
end;
$out_of_range_timestamp_fails_whole_projection$;
rollback to savepoint task19_out_of_range_timestamp;

savepoint task19_fractional_money;
update public.catalog_order_items set cost_per_unit = 13.891
where id = 'a1960000-0000-4000-8000-000000000001';
do $exact_money_rejects_fractional_minor$
declare
  v_failed boolean := false;
begin
  begin
    perform pg_temp.task19_purchase_order_detail(
      authority.snapshot_revision, authority.cost_candidates,
      'a1950000-0000-4000-8000-000000000001', true
    ) from task19_authority authority;
  exception when data_exception then v_failed := true;
  end;
  if not v_failed then
    raise exception 'exact_money_rejects_fractional_minor';
  end if;
end;
$exact_money_rejects_fractional_minor$;
rollback to savepoint task19_fractional_money;

do $attention_is_bounded$
declare
  v_result jsonb;
begin
  select private.agent_p2_purchase_order_attention_v1(
           'a1910000-0000-4000-8000-000000000001',
           'a1900000-0000-4000-8000-000000000001',
           'a1940000-0000-4000-8000-000000000001',
           'a1930000-0000-4000-8000-000000000001',
           '0123456789abcdef0123456789abcdef',
           array['ops.catalog_costs.read', 'ops.purchasing.read'],
           authority.snapshot_revision,
           array['catalog.orders.view', 'catalog.products.view', 'finances.view'],
           authority.base_candidates, 'overdue', date '2026-09-20', 7,
           false, pg_catalog.date_trunc(
             'milliseconds', pg_catalog.statement_timestamp()
           ), 5, 6, 501, 51
         )
    into v_result from task19_authority authority;
  if pg_catalog.jsonb_array_length(v_result -> 'items') <> 5
     or not (v_result ->> 'has_more')::boolean then
    raise exception 'attention_is_bounded';
  end if;
end;
$attention_is_bounded$;

do $proof_binding$
declare
  v_base jsonb;
  v_cost jsonb;
begin
  select pg_temp.task19_purchase_order_detail(
           snapshot_revision, base_candidates,
           'a1950000-0000-4000-8000-000000000001', false
         ),
         pg_temp.task19_purchase_order_detail(
           snapshot_revision, cost_candidates,
           'a1950000-0000-4000-8000-000000000001', true
         )
    into v_base, v_cost from task19_authority;
  if v_base ->> 'proof_ref' !~ '^ops_proof:v1:[0-9a-f]{64}$'
     or v_base ->> 'evidence_ref' !~ '^ops_evidence:v1:[0-9a-f]{64}$'
     or v_base ->> 'proof_ref' = v_cost ->> 'proof_ref'
     or v_base ->> 'evidence_ref' = v_cost ->> 'evidence_ref' then
    raise exception 'proof_binding';
  end if;
end;
$proof_binding$;

do $purchasing_sources_bump$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into v_before
  from private.agent_read_domain_revisions
  where company_id = 'a1900000-0000-4000-8000-000000000001'
    and domain = 'purchasing';
  update public.catalog_orders set title = title || ' revised'
  where id = 'a1950000-0000-4000-8000-000000000001';
  select source_revision into v_after
  from private.agent_read_domain_revisions
  where company_id = 'a1900000-0000-4000-8000-000000000001'
    and domain = 'purchasing';
  if v_after <> v_before + 1 then raise exception 'purchasing_sources_bump'; end if;
end;
$purchasing_sources_bump$;

do $purchasing_irrelevant_private_update_does_not_bump$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into v_before
  from private.agent_read_domain_revisions
  where company_id = 'a1900000-0000-4000-8000-000000000001'
    and domain = 'purchasing';
  update public.catalog_orders set notes = notes || ' private'
  where id = 'a1950000-0000-4000-8000-000000000001';
  select source_revision into v_after
  from private.agent_read_domain_revisions
  where company_id = 'a1900000-0000-4000-8000-000000000001'
    and domain = 'purchasing';
  if v_after <> v_before then
    raise exception 'purchasing_irrelevant_private_update_does_not_bump';
  end if;
end;
$purchasing_irrelevant_private_update_does_not_bump$;

do $purchasing_old_new_company_fanout$
declare
  v_alpha bigint;
  v_bravo bigint;
begin
  select source_revision into v_alpha
  from private.agent_read_domain_revisions
  where company_id = 'a1900000-0000-4000-8000-000000000001'
    and domain = 'purchasing';
  select coalesce((
           select source_revision
           from private.agent_read_domain_revisions
           where company_id = 'a1900000-0000-4000-8000-000000000002'
             and domain = 'purchasing'
         ), 0)
    into v_bravo;
  update public.catalog_orders
  set company_id = 'a1900000-0000-4000-8000-000000000002'
  where id = 'a1950000-0000-4000-8000-00000000ffff';
  if (select source_revision from private.agent_read_domain_revisions
      where company_id = 'a1900000-0000-4000-8000-000000000001'
        and domain = 'purchasing') <> v_alpha + 1
     or (select source_revision from private.agent_read_domain_revisions
         where company_id = 'a1900000-0000-4000-8000-000000000002'
           and domain = 'purchasing') <> v_bravo + 1 then
    raise exception 'purchasing_old_new_company_fanout';
  end if;
  update public.catalog_orders
  set company_id = 'a1900000-0000-4000-8000-000000000001'
  where id = 'a1950000-0000-4000-8000-00000000ffff';
end;
$purchasing_old_new_company_fanout$;

do $purchasing_delivery_index$
declare
  v_plan text := '';
  v_line text;
begin
  perform pg_catalog.set_config('enable_seqscan', 'off', true);
  for v_line in execute $explain$
    explain select id from public.catalog_orders
    where company_id = 'a1900000-0000-4000-8000-000000000001'
      and deleted_at is null
    order by coalesce(expected_delivery_date, date '9999-12-31'),
             updated_at desc, id
    limit 25
  $explain$ loop v_plan := v_plan || v_line; end loop;
  if v_plan not like '%idx_catalog_orders_agent_delivery_v1%' then
    raise exception 'purchasing_delivery_index: %', v_plan;
  end if;
end;
$purchasing_delivery_index$;

do $purchasing_line_order_index$
declare
  v_plan text := '';
  v_line text;
begin
  perform pg_catalog.set_config('enable_seqscan', 'off', true);
  for v_line in execute $explain$
    explain select id from public.catalog_order_items
    where order_id = 'a1950000-0000-4000-8000-000000000001'
    order by id
  $explain$ loop v_plan := v_plan || v_line; end loop;
  if v_plan not like '%idx_catalog_order_items_agent_order_id_v1%' then
    raise exception 'purchasing_line_order_index: %', v_plan;
  end if;
end;
$purchasing_line_order_index$;

do $private_acl$
begin
  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_purchase_orders_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],text,date,date,boolean,integer,integer,integer,integer,timestamp with time zone,jsonb,date,timestamp with time zone,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_purchase_order_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,boolean,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.read_agent_purchase_orders_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],text,date,date,boolean,integer,integer,integer,integer,timestamp with time zone,jsonb,date,timestamp with time zone,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_agent_purchase_order_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,boolean,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_purchase_order_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text,date,integer,boolean,timestamp with time zone,integer,integer,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'private_acl';
  end if;
end;
$private_acl$;

do $purchasing_source_private_acl$
begin
  if pg_catalog.has_function_privilege(
       'service_role', 'private.bump_agent_purchasing_source_revision()',
       'EXECUTE'
     ) then
    raise exception 'purchasing_source_private_acl';
  end if;
end;
$purchasing_source_private_acl$;

savepoint task19_source_501;
insert into public.catalog_orders(
  id, company_id, status, title, created_at, updated_at
)
select (
         'a1970000-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(series.value), 12, '0')
       )::uuid,
       'a1900000-0000-4000-8000-000000000001'::uuid,
       'draft', 'Bound order ' || series.value,
       '2026-08-01 12:00:00+00', '2026-08-28 12:00:00+00'
from pg_catalog.generate_series(1, 474) series(value);
do $source_501_fails_closed$
declare
  v_failed boolean := false;
begin
  begin
    perform pg_temp.task19_purchase_order_list(
      authority.snapshot_revision, authority.base_candidates
    ) from task19_authority authority;
  exception when program_limit_exceeded then v_failed := true;
  end;
  if not v_failed then raise exception 'source_501_fails_closed'; end if;
end;
$source_501_fails_closed$;
rollback to savepoint task19_source_501;

rollback;
