-- Runnable transcript for docs/artifacts/mcp-catalog-setup-writes/text-repair-proof.md
--
-- The repair migration is read with its outer begin;/commit; commented out so
-- the whole run is one transaction that ends in rollback. Produce the body with:
--
--   sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
--     supabase/migrations/20260916060000_repair_double_encoded_catalog_text.sql \
--     > /tmp/m_20260916060000_repair_double_encoded_catalog_text.sql
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
--     -v repair_migration=/tmp/m_20260916060000_repair_double_encoded_catalog_text.sql \
--     -f docs/artifacts/mcp-catalog-setup-writes/text-repair-proof.sql
--
-- It writes nothing: the last statement is rollback. This migration has NOT
-- been applied to production.
--
-- No corrupted byte is typed anywhere in this file: every sequence is built
-- from chr(), and every value shown is rendered with its bad bytes replaced by
-- a readable marker.
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on
\pset pager off
begin;
set search_path = '';

create or replace function pg_temp.sig() returns text language sql immutable as $f$
  select '[' || chr(194) || '-' || chr(244) || '][' || chr(128) || '-' || chr(191) || ']+'
$f$;
create or replace function pg_temp.marked(p text) returns text language sql immutable as $f$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(p, chr(226)||chr(128)||chr(148), '<BAD:E2-80-94>', 'g'),
               chr(226)||chr(128)||chr(147), '<BAD:E2-80-93>', 'g'),
             chr(194)||chr(190), '<BAD:C2-BE>', 'g'),
           chr(195)||chr(151), '<BAD:C3-97>', 'g')
$f$;
create or replace function pg_temp.codepoints(p text) returns text language sql immutable as $f$
  select string_agg('U+' || upper(to_hex(ascii(c))), ' ' order by o)
  from regexp_split_to_table(p, '') with ordinality t(c, o)
$f$;

\echo ''
\echo '## 0. every column the repair may touch, scanned across every company'
with candidates(tbl, col, val) as (
  select 'catalog_supplier_cost_profiles','label', label from public.catalog_supplier_cost_profiles
  union all select 'catalog_supplier_cost_profiles','source', source::text from public.catalog_supplier_cost_profiles
  union all select 'catalog_supplier_cost_profiles','activation_rule', activation_rule::text from public.catalog_supplier_cost_profiles
  union all select 'catalog_items','name', name from public.catalog_items
  union all select 'catalog_items','description', description from public.catalog_items
  union all select 'catalog_items','notes', notes from public.catalog_items
  union all select 'catalog_options','name', name from public.catalog_options
  union all select 'catalog_option_values','value', value from public.catalog_option_values
  union all select 'catalog_variants','sku', sku from public.catalog_variants
  union all select 'catalog_categories','name', name from public.catalog_categories
  union all select 'products','name', name from public.products
  union all select 'products','description', description from public.products
  union all select 'product_options','name', name from public.product_options
  union all select 'product_options','default_value', default_value from public.product_options
  union all select 'product_option_values','value', value from public.product_option_values
  union all select 'product_materials','notes', notes from public.product_materials
)
select tbl, col, count(*) as rows_with_signature
  from candidates where val is not null and val ~ pg_temp.sig()
 group by 1,2 order by 1,2;

\echo ''
\echo '## 0b. the DISTINCT corrupted sequences that actually exist, with counts'
with candidates(tbl, col, val) as (
  select 'catalog_supplier_cost_profiles','label', label from public.catalog_supplier_cost_profiles
  union all select 'catalog_supplier_cost_profiles','source', source::text from public.catalog_supplier_cost_profiles
  union all select 'catalog_items','description', description from public.catalog_items
  union all select 'catalog_option_values','value', value from public.catalog_option_values
), hits as (
  select tbl || '.' || col as where_at,
         (regexp_matches(val, pg_temp.sig(), 'g'))[1] as seq
  from candidates where val is not null and val ~ pg_temp.sig()
)
select pg_temp.codepoints(seq) as stored_codepoints,
       pg_temp.codepoints(convert_from(convert_to(seq,'LATIN1'),'UTF8')) as repaired_codepoint,
       convert_from(convert_to(seq,'LATIN1'),'UTF8') as repaired,
       count(*) as occurrences,
       count(distinct where_at) as columns_seen
  from hits group by 1,2,3 order by occurrences desc;

\echo ''
\echo '## 0c. every candidate row survives the inverse of the corruption cleanly'
with candidates(tbl, col, val) as (
  select 'catalog_supplier_cost_profiles','label', label from public.catalog_supplier_cost_profiles where label ~ pg_temp.sig()
  union all select 'catalog_supplier_cost_profiles','source', source::text from public.catalog_supplier_cost_profiles where source::text ~ pg_temp.sig()
  union all select 'catalog_items','description', description from public.catalog_items where description ~ pg_temp.sig()
  union all select 'catalog_option_values','value', value from public.catalog_option_values where value ~ pg_temp.sig()
)
select tbl, col, count(*) as rows,
       count(*) filter (where val ~ '[[:cntrl:]]') as unreadable_today,
       count(*) filter (where convert_from(convert_to(val,'LATIN1'),'UTF8') !~ '[[:cntrl:]]') as clean_after,
       count(*) filter (where convert_from(convert_to(val,'LATIN1'),'UTF8') ~ pg_temp.sig()) as still_corrupt_after
  from candidates group by 1,2 order by 1,2;

\echo ''
\echo '## 1. before: the sample label is unreadable to the agent read layer'
select pg_temp.marked(label) as stored_label,
       private.agent_p2_optional_canonical_text(label, 160, 640, true) as canonical_text
  from public.catalog_supplier_cost_profiles
 where profile_key = 'deksmart-standard' and deleted_at is null
 limit 1;

\echo ''
\echo '## 1b. a synthetic cost-authorised grant, so get_catalog_item can be called'
\echo '##     the way the MCP read layer calls it (rolled back)'
insert into private.agent_read_domain_revisions(company_id, domain, source_revision)
values ('a612edc0-5c18-4c4d-af97-55b9410dd077','catalog',1)
on conflict do nothing;
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision)
values ('33333333-3333-4333-8333-333333333333','Catalogue text repair proof',
  array['https://example.invalid/cb'],'none',
  array['authorization_code'],array['code'],
  'ops.catalog.read ops.catalog_costs.read','manual',
  array['ops.catalog.read','ops.catalog_costs.read'],
  '2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v23');
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision,
  accepted_labels, consent_catalog_revision, exposure_revision)
values ('22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '33333333-3333-4333-8333-333333333333',
  array['ops.catalog.read','ops.catalog_costs.read'], repeat('a',32),
  private.mcp_oauth_labels_for_scopes(
    array['ops.catalog.read','ops.catalog_costs.read'],
    '2026-09-10.mcp-consent-catalog.v17'),
  '2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v23');

\echo ''
\echo '## 2. before: a cost-authorised get_catalog_item read of an affected Vinyl'
\echo '##    variant raises agent_catalog_source_data_invalid'
create or replace function pg_temp.detail(p_item uuid, p_kind text, p_costs boolean)
returns jsonb language plpgsql as $f$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_company uuid := 'a612edc0-5c18-4c4d-af97-55b9410dd077';
  v_keys text[] := array['catalog.products.view','catalog.view','finances.view'];
  v_snapshot text;
  v_permissions jsonb;
  v_candidates jsonb;
begin
  select authority.permission_snapshot_revision,
         coalesce(jsonb_object_agg(p.value->>'permission', p.value->>'scope'
           order by p.value->>'permission') filter (
             where p.value->>'permission' is not null
               and p.value->>'scope' is not null), '{}'::jsonb)
    into v_snapshot, v_permissions
  from private.resolve_agent_actor_authority(v_actor, v_company, v_keys) authority
  left join lateral jsonb_array_elements(authority.effective_permissions) p(value) on true
  group by authority.permission_snapshot_revision;
  -- Cost is separately authorised, so a read that includes it carries both
  -- candidates: the catalogue one and the supplier-cost one.
  v_candidates := jsonb_build_array(
    private.agent_p2_catalog_expected_candidate_v1('catalog', v_permissions))
    || case when p_costs then jsonb_build_array(
         private.agent_p2_catalog_expected_candidate_v1('supplier_costs', v_permissions))
       else '[]'::jsonb end;
  return private.agent_p2_catalog_detail_v1(
    v_actor, v_company, '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid, repeat('a',32),
    array['ops.catalog.read','ops.catalog_costs.read'], v_snapshot, v_keys,
    '2026-08-22.capability-manifest.v8', 'get_catalog_item',
    'get_catalog_item:2026-08-22.v1', v_candidates, p_kind, p_item, p_costs,
    501, 50, 51, 32, 33, 128, 129, 64, 65, 100, 101, 64, 65);
end $f$;

-- How much of Canpro's catalogue a cost-authorised read can see today.
create or replace function pg_temp.cost_read_tally() returns table(outcome text, variants integer)
language plpgsql as $f$
declare v_row record; v_outcome text;
begin
  create temporary table if not exists cost_read_probe(outcome text) on commit drop;
  delete from cost_read_probe;
  for v_row in
    select v.id from public.catalog_variants v
    join public.catalog_items i on i.id = v.catalog_item_id
    where i.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077' and v.deleted_at is null
    order by v.id
  loop
    begin
      perform pg_temp.detail(v_row.id, 'catalog_variant', true);
      v_outcome := 'readable';
    exception when others then
      v_outcome := sqlerrm;
    end;
    insert into cost_read_probe(outcome) values (v_outcome);
  end loop;
  return query select p.outcome, count(*)::integer from cost_read_probe p group by 1 order by 2 desc;
end $f$;
select outcome, variants from pg_temp.cost_read_tally();

\set ON_ERROR_STOP off
select jsonb_typeof(pg_temp.detail(
  '18234bac-442f-41e8-98e7-956c051fbf21', 'catalog_variant', true)) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 3. apply the repair migration'
\i :repair_migration

\echo ''
\echo '## 4. after: nothing carries the signature any more'
with candidates(tbl, col, val) as (
  select 'catalog_supplier_cost_profiles','label', label from public.catalog_supplier_cost_profiles
  union all select 'catalog_supplier_cost_profiles','source', source::text from public.catalog_supplier_cost_profiles
  union all select 'catalog_supplier_cost_profiles','activation_rule', activation_rule::text from public.catalog_supplier_cost_profiles
  union all select 'catalog_items','name', name from public.catalog_items
  union all select 'catalog_items','description', description from public.catalog_items
  union all select 'catalog_items','notes', notes from public.catalog_items
  union all select 'catalog_options','name', name from public.catalog_options
  union all select 'catalog_option_values','value', value from public.catalog_option_values
  union all select 'catalog_variants','sku', sku from public.catalog_variants
  union all select 'catalog_categories','name', name from public.catalog_categories
  union all select 'products','name', name from public.products
  union all select 'products','description', description from public.products
  union all select 'product_options','name', name from public.product_options
  union all select 'product_options','default_value', default_value from public.product_options
  union all select 'product_option_values','value', value from public.product_option_values
  union all select 'product_materials','notes', notes from public.product_materials
)
select count(*) filter (where val is not null and val ~ pg_temp.sig()) as rows_with_signature,
       count(*) filter (where val is not null and val ~ '[[:cntrl:]]') as rows_with_control_chars
  from candidates;

\echo ''
\echo '## 4b. the ledger: every changed row, per column'
select table_name, column_name, count(*) as repaired_rows
  from private.catalog_text_repairs_20260916
 group by 1,2 order by 1,2;
select count(*) as ledger_rows,
       count(*) filter (where before_value = after_value) as no_op_rows
  from private.catalog_text_repairs_20260916;

\echo ''
\echo '## 4c. the sample label, and the two rows outside the cost table'
select label, private.agent_p2_optional_canonical_text(label, 160, 640, true) as canonical_text
  from public.catalog_supplier_cost_profiles
 where profile_key = 'deksmart-standard' and deleted_at is null
 limit 1;
select distinct label from public.catalog_supplier_cost_profiles
 where deleted_at is null and label like '%' || chr(8212) || '%' order by 1;
select value from public.catalog_option_values
 where id = 'd5e4c8ec-2b98-4c55-9a9d-05690efe898b';
select substring(description from 'width [^ ]+ height') as glass_panel_dimensions
  from public.catalog_items where id = '209ce2e3-a546-4afd-aab9-d3a245e1e58c';

\echo ''
\echo '## 5. after: the same cost-authorised read succeeds'
select outcome, variants from pg_temp.cost_read_tally();

select jsonb_pretty(jsonb_path_query_array(
         pg_temp.detail('18234bac-442f-41e8-98e7-956c051fbf21', 'catalog_variant', true),
         '$.result.supplier_costs[*].supplier_label')) as supplier_labels_returned;

\echo ''
\echo '## 6. idempotence: a second pass finds nothing left to repair'
create or replace function pg_temp.repairable(p text) returns boolean language plpgsql as $f$
declare v text;
begin
  if p is null or p !~ pg_temp.sig() then return false; end if;
  begin v := convert_from(convert_to(p,'LATIN1'),'UTF8');
  exception when others then return false; end;
  return v is not null and v <> p and v !~ '[[:cntrl:]]';
end $f$;
with candidates(val) as (
  select label from public.catalog_supplier_cost_profiles
  union all select source::text from public.catalog_supplier_cost_profiles
  union all select activation_rule::text from public.catalog_supplier_cost_profiles
  union all select description from public.catalog_items
  union all select name from public.catalog_items
  union all select notes from public.catalog_items
  union all select name from public.catalog_options
  union all select value from public.catalog_option_values
  union all select sku from public.catalog_variants
  union all select name from public.catalog_categories
  union all select name from public.products
  union all select description from public.products
  union all select name from public.product_options
  union all select default_value from public.product_options
  union all select value from public.product_option_values
  union all select notes from public.product_materials
)
select count(*) filter (where pg_temp.repairable(val)) as still_repairable from candidates;

\echo ''
\echo '## 7. after the rollback: production is untouched and the ledger is gone'
rollback;
select count(*) as rows_with_signature
  from public.catalog_supplier_cost_profiles
 where label ~ ('[' || chr(194) || '-' || chr(244) || '][' || chr(128) || '-' || chr(191) || ']+');
select to_regclass('private.catalog_text_repairs_20260916') as ledger_after;
