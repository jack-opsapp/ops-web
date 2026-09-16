-- Local SQL proof — catalogue money at the currency's minor unit
--
-- Migration proved:
--   supabase/migrations/20260916070000_agent_catalog_setup_write_money_precision.sql
--
-- How this was run. A disposable copy of the local production database, so the
-- prerequisite migrations can be applied for real (they carry their own
-- begin;/commit;) without touching the proving database:
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
--     -c 'drop database if exists ops_test_6;' \
--     -c 'create database ops_test_6 template postgres;'
--   for f in 20260915224500_agent_catalog_recipe_read_v24 \
--            20260916010000_agent_catalog_setup_write_variant \
--            20260916020000_agent_catalog_setup_write_thresholds \
--            20260916030000_agent_catalog_setup_write_pricing \
--            20260916040000_agent_catalog_setup_write_supplier_cost \
--            20260916050000_agent_catalog_setup_write_option \
--            20260916070000_agent_catalog_setup_write_money_precision; do
--     psql "host=127.0.0.1 port=55432 user=postgres dbname=ops_test_6" \
--       -v ON_ERROR_STOP=1 -f "supabase/migrations/$f.sql"
--   done
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=ops_test_6" \
--     -f docs/artifacts/mcp-catalog-setup-writes/money-precision-proof.sql
--
-- The proof itself is one transaction ending in rollback. Expected failures use
-- psql's ON_ERROR_ROLLBACK so the transaction survives each one.
--
\set ON_ERROR_STOP off
\set ON_ERROR_ROLLBACK on
begin;
\echo ''
\echo '## 0. the guard is installed in both compile functions'
select p.proname,
       pg_get_functiondef(p.oid) like '%CATALOG_SETUP_MONEY_PRECISION_INVALID%' as has_guard,
       pg_get_functiondef(p.oid) like '%agent_currency_minor_exponent_or_null%' as uses_read_table
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'private'
   and p.proname in ('agent_catalog_setup_compile_set_pricing',
                     'agent_catalog_setup_compile_set_supplier_cost')
 order by 1;

\echo ''
\echo '## 1. set_pricing: 16.925 CAD is refused (three decimals in a two-decimal currency)'
select private.agent_catalog_setup_compile_set_pricing(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'item_ref', jsonb_build_object('kind','catalog_family','id','948ac4a0-882f-efe9-3bc4-b6f7c53fb12f'),
    'sale_price', jsonb_build_object('amount','16.925','currency','CAD'),
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Precision proof.')),
    'idempotency_key','money-precision-price-1'));

\echo ''
\echo '## 1b. the same request at 16.92 clears the precision gate (reaches the family read)'
select (private.agent_catalog_setup_compile_set_pricing(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'item_ref', jsonb_build_object('kind','catalog_family','id','948ac4a0-882f-efe9-3bc4-b6f7c53fb12f'),
    'sale_price', jsonb_build_object('amount','16.92','currency','CAD'),
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Precision proof.')),
    'idempotency_key','money-precision-price-2')))->'proposal_after'->'price' as accepted_price;

\echo ''
\echo '## 1c. trailing zeros are not precision: 16.9200 is the same number and passes'
select (private.agent_catalog_setup_compile_set_pricing(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'item_ref', jsonb_build_object('kind','catalog_family','id','948ac4a0-882f-efe9-3bc4-b6f7c53fb12f'),
    'sale_price', jsonb_build_object('amount','16.9200','currency','CAD'),
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Precision proof.')),
    'idempotency_key','money-precision-price-3')))->'proposal_after'->'price' as accepted_price;

\echo ''
\echo '## 2. set_supplier_cost: the four Glass Panel shapes are all refused'
\echo '-- 4.1992'
select private.agent_catalog_setup_compile_set_supplier_cost(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id', (select catalog_variant_id from public.catalog_supplier_cost_profiles where unit_cost = 4.1992)),
    'profile_key','vitrum-2026','label','Vitrum Glass',
    'unit_cost', jsonb_build_object('amount','4.1992','currency','CAD'),
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Precision proof.')),
    'idempotency_key','money-precision-cost-1'));
\echo '-- 9.744'
select private.agent_catalog_setup_compile_set_supplier_cost(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id', (select catalog_variant_id from public.catalog_supplier_cost_profiles where unit_cost = 9.7440)),
    'profile_key','vitrum-2026','label','Vitrum Glass',
    'unit_cost', jsonb_build_object('amount','9.744','currency','CAD'),
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Precision proof.')),
    'idempotency_key','money-precision-cost-2'));

\echo ''
\echo '## 2b. 4.20 on the same variant clears the precision gate'
select (private.agent_catalog_setup_compile_set_supplier_cost(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id', (select catalog_variant_id from public.catalog_supplier_cost_profiles where unit_cost = 4.1992)),
    'profile_key','vitrum-2026','label','Vitrum Glass',
    'unit_cost', jsonb_build_object('amount','4.20','currency','CAD'),
    'is_default', true,
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Precision proof.')),
    'idempotency_key','money-precision-cost-3')))->'effects' as accepted_effects;

\echo ''
\echo '## 3. a currency whose minor unit the read table does not name is refused'
select private.agent_catalog_setup_compile_set_pricing(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '11111111-1111-4111-8111-111111111111',
  jsonb_build_object(
    'item_ref', jsonb_build_object('kind','catalog_family','id','948ac4a0-882f-efe9-3bc4-b6f7c53fb12f'),
    'sale_price', jsonb_build_object('amount','16.92','currency','ZZZ'),
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Precision proof.')),
    'idempotency_key','money-precision-price-4'));

\echo ''
\echo '## 4. the precision refusal is what the read would have refused'
select private.agent_money_to_minor_units(16.925, 'CAD');

rollback;
