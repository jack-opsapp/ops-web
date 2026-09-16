-- Runnable transcript for docs/artifacts/mcp-catalog-setup-writes/override-level-proof.md
--
-- Migration proved:
--   supabase/migrations/20260916090000_agent_catalog_setup_write_override_level.sql
--
-- How this was run. A disposable copy of the local production database carrying
-- migrations 1-8 of this vertical (the V24 read, the five kinds, the text
-- repair, money precision) plus 20260916080000's cost re-alignment, each applied
-- for real with its own begin;/commit;:
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
--     -c 'create database ops_override_level template ops_test_6;'
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=ops_override_level" \
--     -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20260916080000_align_variant_unit_cost_override_to_default_profile.sql
--
-- The migration under proof is read with its outer begin;/commit; commented out
-- so the whole run is ONE transaction that ends in rollback, and so is the
-- shipped set_pricing compile section 12 reinstates:
--
--   sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
--     supabase/migrations/20260916090000_agent_catalog_setup_write_override_level.sql \
--     > "$SCRATCH/m_override_level.sql"
--   sed -n 439,705p supabase/migrations/20260916070000_agent_catalog_setup_write_money_precision.sql \
--     > "$SCRATCH/shipped_compile_set_pricing.sql"
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=ops_override_level" \
--     -v override_level_migration="$SCRATCH/m_override_level.sql" \
--     -v shipped_pricing_compile="$SCRATCH/shipped_compile_set_pricing.sql" \
--     -f docs/artifacts/mcp-catalog-setup-writes/override-level-proof.sql
--
-- It writes nothing: the last statement is rollback. Expected refusals run with
-- psql's ON_ERROR_ROLLBACK so the transaction survives each one.
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on
\pset pager off
begin;

-- Canpro and its families, named once.
\set company '''a612edc0-5c18-4c4d-af97-55b9410dd077'''
\set corner_sleeve '''9ab97bdc-4882-48a0-aafd-c082444a9f08'''
\set black '''22f9a4ac-eb8d-46a7-a134-1cc75800a700'''
\set white '''2c7cdf44-3473-499b-b086-73737505a565'''
\set glass_panel '''209ce2e3-a546-4afd-aab9-d3a245e1e58c'''
\set clear_5mm '''a155f06d-2d35-4fbc-91c9-9a214a4dbf43'''
\set vinyl '''9b30f44d-47da-4134-872d-7f9c2d6f1b44'''

\echo ''
\echo '## 0. production state before the migration'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select md5(prosrc) as shipped_commit_md5
  from pg_proc where oid = 'public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
select i.name, i.default_price::text as default_price, i.default_unit_cost::text as default_unit_cost,
       i.default_warning_threshold, i.default_critical_threshold, i.default_unit_id is not null as has_default_unit
  from public.catalog_items i where i.id in (:corner_sleeve, :glass_panel, :vinyl) order by i.name;
-- The five variant terms that resolve through a family term, and how many
-- live variants already carry a value equal to the one they would inherit.
select count(*) filter (where v.price_override = i.default_price) as redundant_price,
       count(*) filter (where v.unit_cost_override = i.default_unit_cost) as redundant_cost,
       count(*) filter (where v.warning_threshold = coalesce(i.default_warning_threshold, c.default_warning_threshold)) as redundant_warning,
       count(*) filter (where v.critical_threshold = coalesce(i.default_critical_threshold, c.default_critical_threshold)) as redundant_critical,
       count(*) filter (where v.unit_id = i.default_unit_id) as redundant_unit
  from public.catalog_variants v
  join public.catalog_items i on i.id = v.catalog_item_id and i.deleted_at is null
  left join public.catalog_categories c on c.id = i.category_id and c.company_id = i.company_id and c.deleted_at is null
 where v.company_id = :company and v.deleted_at is null;

\echo ''
\echo '## 1. the seal is live, as it is in production, and a proposal is pending under it'
set search_path = '';
insert into private.agent_read_domain_revisions(company_id, domain, source_revision)
values ('a612edc0-5c18-4c4d-af97-55b9410dd077','catalog',1)
on conflict do nothing;
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision)
values ('44444444-4444-4444-8444-444444444444','Override level proof',
  array['https://example.invalid/cb'],'none',
  array['authorization_code'],array['code'],
  'ops.catalog.prepare ops.catalog.read ops.catalog_costs.read','manual',
  array['ops.catalog.prepare','ops.catalog.read','ops.catalog_costs.read'],
  '2026-09-15.mcp-consent-catalog.v18','2026-09-15.mcp-exposure.v24');
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision,
  accepted_labels, consent_catalog_revision, exposure_revision)
values ('55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '44444444-4444-4444-8444-444444444444',
  array['ops.catalog.prepare','ops.catalog.read','ops.catalog_costs.read'], repeat('b',32),
  private.mcp_oauth_labels_for_scopes(
    array['ops.catalog.prepare','ops.catalog.read','ops.catalog_costs.read'],
    '2026-09-15.mcp-consent-catalog.v18'),
  '2026-09-15.mcp-consent-catalog.v18','2026-09-15.mcp-exposure.v24');

-- Harness: call the prepare exactly as the TypeScript repository does.
create or replace function pg_temp.prepare_write(p_kind text, p_request jsonb)
returns jsonb language plpgsql as $f$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_company uuid := 'a612edc0-5c18-4c4d-af97-55b9410dd077';
  v_keys text[] := array['agent.review','catalog.manage','catalog.products.view','catalog.run_setup','catalog.stock.adjust','catalog.view','finances.view'];
  v_snapshot text;
  v_grant private.mcp_oauth_grants%rowtype;
  v_capability text;
begin
  select * into v_grant from private.mcp_oauth_grants where id = '55555555-5555-4555-8555-555555555555';
  select authority.permission_snapshot_revision into v_snapshot
  from private.resolve_agent_actor_authority(v_actor, v_company, v_keys) authority;
  v_capability := private.agent_catalog_setup_write_kind_capability(p_kind);
  return public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp());
end $f$;

create or replace function pg_temp.commit_write(p_result jsonb, p_key text)
returns jsonb language sql as $f$
  select public.commit_catalog_setup_write_as_actor(
    '11111111-1111-4111-8111-111111111111',
    'a612edc0-5c18-4c4d-af97-55b9410dd077',
    (p_result->>'action_id')::uuid,
    (p_result->>'change_set_id')::uuid,
    p_result->>'preview_sha256',
    p_key)
$f$;

create or replace function pg_temp.evidence() returns jsonb language sql as $f$
  select jsonb_build_array(jsonb_build_object('kind','operator_statement',
    'text','Jackson confirmed this against the 2026 price and cost sheets.'))
$f$;

-- 'clear' spells the explicit JSON null that clears at the level the ref names.
create or replace function pg_temp.pricing_request(p_kind text, p_id uuid, p_key text, p_amount text)
returns jsonb language sql as $f$
  select jsonb_build_object(
    'item_ref', jsonb_build_object('kind', p_kind, 'id', p_id),
    'sale_price', case when p_amount = 'clear' then 'null'::jsonb
                       else jsonb_build_object('amount', p_amount, 'currency', 'CAD') end,
    'evidence', pg_temp.evidence(),
    'idempotency_key', p_key)
$f$;

create or replace function pg_temp.thresholds_request(p_variant uuid, p_key text, p_levels jsonb)
returns jsonb language sql as $f$
  select jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id',p_variant),
    'evidence', pg_temp.evidence(),
    'idempotency_key', p_key) || p_levels
$f$;

create or replace function pg_temp.cost_request(
  p_variant uuid, p_key text, p_profile_key text, p_label text, p_amount text, p_is_default boolean)
returns jsonb language sql as $f$
  select jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id',p_variant),
    'profile_key', p_profile_key,
    'label', p_label,
    'unit_cost', jsonb_build_object('amount', p_amount, 'currency', 'CAD'),
    'is_default', p_is_default,
    'evidence', pg_temp.evidence(),
    'idempotency_key', p_key)
$f$;

create or replace function pg_temp.variant_request(
  p_family uuid, p_key text, p_option_values jsonb, p_extra jsonb)
returns jsonb language sql as $f$
  select jsonb_build_object(
    'family_ref', jsonb_build_object('kind','catalog_family','id',p_family),
    'option_values', p_option_values,
    'evidence', pg_temp.evidence(),
    'idempotency_key', p_key) || p_extra
$f$;

-- The five level-bearing terms of every live variant of a family, as stored.
create or replace function pg_temp.levels(p_family uuid)
returns table (variant text, labels text, price_override text, unit_cost_override text,
               warning_threshold text, critical_threshold text, unit_id text)
language sql as $f$
  select left(v.id::text, 8),
         (select string_agg(x, ' / ') from jsonb_array_elements_text(
            private.agent_catalog_setup_value_labels(v.company_id, v.catalog_item_id, v.id)) x),
         v.price_override::text, v.unit_cost_override::text,
         v.warning_threshold::text, v.critical_threshold::text, left(v.unit_id::text, 8)
  from public.catalog_variants v
  where v.catalog_item_id = p_family and v.deleted_at is null
  order by 2
$f$;

-- A digest of every level-bearing term, plus identity, stock and state, of every
-- live variant of a family except the ones named. Exact stored text, so a
-- re-sent 15 that came back as 15.0000 would change it.
create or replace function pg_temp.digest(p_family uuid, p_except uuid[])
returns text language sql as $f$
  select md5(coalesce(string_agg(row_text, '|' order by row_text), ''))
  from (
    select v.id::text || ':' || coalesce(v.sku,'') || ':' || v.quantity::text || ':'
        || coalesce(v.price_override::text,'∅') || ':' || coalesce(v.unit_cost_override::text,'∅') || ':'
        || coalesce(v.warning_threshold::text,'∅') || ':' || coalesce(v.critical_threshold::text,'∅') || ':'
        || coalesce(v.unit_id::text,'∅') || ':' || v.is_active::text as row_text
    from public.catalog_variants v
    where v.catalog_item_id = p_family and v.deleted_at is null
      and not (v.id = any(coalesce(p_except, array[]::uuid[])))
  ) rows
$f$;

select set_config('request.jwt.claim.role','service_role',true);

-- Production carries a live seal row. Seal against the definitions shipped
-- today, exactly as the release runbook did.
insert into private.agent_catalog_effect_policy(revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());
select revision, left(effect_sha256, 18) || '...' as effect_sha256,
       effect_sha256 = private.agent_catalog_setup_write_effect_revision() as seal_matches
  from private.agent_catalog_effect_policy where revision = '2026-09-15.catalog-setup-write.v1';

-- The defect, under the shipped code: Black / Normal inherits 15.00 from Corner
-- Sleeve, and asking for 15.00 on the variant is staged as an override.
create temporary table proof_stale as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :black, 'catalog-setup:level:shipped-pin', '15')) as result;
select result#>'{proposal,before,price}' as shipped_before,
       result#>'{proposal,after,price}' as shipped_after,
       (select doc.value->'price_override'
          from private.agent_catalog_setup_writes w,
               jsonb_array_elements(w.payload->'variants') doc(value)
         where w.id = (result->>'change_set_id')::uuid and doc.value->>'id' = :black) as shipped_payload_price
  from proof_stale;

\echo ''
\echo '## 2. applying the migration'
\i :override_level_migration
set search_path = '';

\echo ''
\echo '## 2b. what landed: fingerprints, and no app role can execute a writer or compile'
select n.nspname || '.' || p.proname as function, md5(p.prosrc) as md5_prosrc, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where (n.nspname = 'private' and p.proname in (
         'agent_catalog_setup_override_for','agent_catalog_setup_amount_level',
         'agent_catalog_setup_override_level_changes','agent_catalog_setup_variant_projection',
         'agent_catalog_setup_compile_create_variant','agent_catalog_setup_compile_set_thresholds',
         'agent_catalog_setup_pricing_projection','agent_catalog_setup_compile_set_pricing',
         'agent_catalog_setup_supplier_cost_projection','catalog_supplier_cost_profile_save',
         'agent_catalog_setup_compile_set_supplier_cost'))
    or (n.nspname = 'public' and p.proname = 'commit_catalog_setup_write_as_actor')
 order by 1;
select p.proname,
       bool_or(has_function_privilege(r, p.oid, 'execute')) filter (where r <> 'service_role') as app_role_can_execute,
       bool_or(has_function_privilege(r, p.oid, 'execute')) filter (where r = 'service_role') as service_role_can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['public','anon','authenticated','service_role']) r
 where n.nspname in ('private','public') and p.proname in (
         'agent_catalog_setup_override_for','agent_catalog_setup_amount_level',
         'agent_catalog_setup_override_level_changes','agent_catalog_setup_compile_create_variant',
         'agent_catalog_setup_compile_set_thresholds','agent_catalog_setup_compile_set_pricing',
         'agent_catalog_setup_compile_set_supplier_cost','catalog_supplier_cost_profile_save',
         'catalog_family_default_price_save','agent_catalog_setup_compile_create_option',
         'commit_catalog_setup_write_as_actor')
 group by p.proname order by p.proname;

\echo ''
\echo '## 3. the seal no longer matches: the tools fail closed until it is reissued'
select effect_sha256 = private.agent_catalog_setup_write_effect_revision() as seal_matches
  from private.agent_catalog_effect_policy where revision = '2026-09-15.catalog-setup-write.v1';
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :black, 'catalog-setup:level:dark', '18')) as must_raise_activation_required;
select pg_temp.commit_write((select result from proof_stale),
  'approve-catalog-setup-write:shipped-pin') as must_raise_effect_policy_changed;
\set ON_ERROR_STOP on

\echo ''
\echo '## 3b. the runbook reseal, once, after the migration and the code deploy'
update private.agent_catalog_effect_policy
   set effect_sha256 = private.agent_catalog_setup_write_effect_revision()
 where revision = '2026-09-15.catalog-setup-write.v1';
select effect_sha256 = private.agent_catalog_setup_write_effect_revision() as seal_matches
  from private.agent_catalog_effect_policy where revision = '2026-09-15.catalog-setup-write.v1';
\echo '## 3c. a proposal prepared under the old effects still cannot commit'
\set ON_ERROR_STOP off
select pg_temp.commit_write((select result from proof_stale),
  'approve-catalog-setup-write:shipped-pin') as must_raise_effect_policy_changed;
\set ON_ERROR_STOP on
select price_override::text as black_price_override_untouched
  from public.catalog_variants where id = :black;

\echo ''
\echo '## 4. fixtures (rolled back with everything else)'
-- F1: Hardware (Corner Sleeve's category) warns at 30, so a Corner Sleeve
--     variant with no warning level of its own inherits 30 FROM THE CATEGORY.
-- F2: Corner Sleeve's family critical level is 10.
-- F3: two more colours, so new variants can be created on the family.
update public.catalog_categories set default_warning_threshold = 30
 where id = '11111111-1111-0001-1111-000000000010';
update public.catalog_items set default_critical_threshold = 10 where id = :corner_sleeve;
insert into public.catalog_option_values(id, option_id, value, sort_order) values
  ('c0000000-0000-4000-8000-00000000b001', '9900cda5-9b5d-426e-a15e-857dca2db59a', 'Bronze', 30),
  ('c0000000-0000-4000-8000-00000000b002', '9900cda5-9b5d-426e-a15e-857dca2db59a', 'Grey', 40);
select i.name, i.default_price::text as default_price, i.default_unit_cost::text as default_unit_cost,
       i.default_critical_threshold as family_critical, c.default_warning_threshold as category_warning
  from public.catalog_items i join public.catalog_categories c on c.id = i.category_id
 where i.id = :corner_sleeve;
select * from pg_temp.levels(:corner_sleeve);

\echo ''
\echo '## (a) set_pricing on Black / Normal, a variant of an item-level-priced family'
\echo '## a1. the family default, 15.00: the variant already inherits it'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :black, 'catalog-setup:level:a1', '15')) as must_raise_no_change;
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :black, 'catalog-setup:level:a1b', '15.00')) as must_raise_no_change_numeric;
\set ON_ERROR_STOP on

\echo '## a2. 18.00, which differs: the override is written'
create temporary table proof_digest as select pg_temp.digest(:corner_sleeve, array[:black]::uuid[]) as before_digest;
create temporary table proof_a2 as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :black, 'catalog-setup:level:a2', '18')) as result;
select result#>'{proposal,before,price}' as before_price, result#>'{proposal,after,price}' as after_price,
       result#>'{proposal,after,shadowing_variants}' as shadowing, result#>'{proposal,effects,prices_changed}' as prices_changed
  from proof_a2;
select (pg_temp.commit_write((select result from proof_a2), 'approve-catalog-setup-write:level-a2'))->'readback'->'price' as readback_price;
select price_override::text as stored from public.catalog_variants where id = :black;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]) as siblings_byte_identical;

\echo '## a3. back to 15.00: the override is cleared and the variant inherits again'
update proof_digest set before_digest = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]);
create temporary table proof_a3 as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :black, 'catalog-setup:level:a3', '15')) as result;
select result#>'{proposal,before,price}' as before_price, result#>'{proposal,after,price}' as after_price,
       result#>'{proposal,effects}' as effects
  from proof_a3;
select doc.value->'price_override' as payload_price_override
  from private.agent_catalog_setup_writes w, jsonb_array_elements(w.payload->'variants') doc(value)
 where w.id = (select (result->>'change_set_id')::uuid from proof_a3) and doc.value->>'id' = :black;
select (pg_temp.commit_write((select result from proof_a3), 'approve-catalog-setup-write:level-a3'))->'readback'->'price' as readback_price;
select price_override::text as stored from public.catalog_variants where id = :black;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]) as siblings_byte_identical;

\echo '## a4. an explicit null still clears: White / Normal to 19.00, then null'
update proof_digest set before_digest = pg_temp.digest(:corner_sleeve, array[:white]::uuid[]);
create temporary table proof_a4 as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :white, 'catalog-setup:level:a4-set', '19')) as result;
select (pg_temp.commit_write((select result from proof_a4), 'approve-catalog-setup-write:level-a4-set'))#>'{readback,price}' as readback_price;
create temporary table proof_a4_clear as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :white, 'catalog-setup:level:a4-clear', 'clear')) as result;
select result#>'{proposal,before,price}' as before_price, result#>'{proposal,after,price}' as after_price
  from proof_a4_clear;
select (pg_temp.commit_write((select result from proof_a4_clear), 'approve-catalog-setup-write:level-a4-clear'))#>'{readback,price}' as readback_price;
select price_override::text as stored from public.catalog_variants where id = :white;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:white]::uuid[]) as siblings_byte_identical;

\echo ''
\echo '## (b) set_thresholds on Black / Normal: own 30 / 10, inherits 30 (category) / 10 (family)'
\echo '## b1. warning 30: equal to the category level, so the override is cleared'
update proof_digest set before_digest = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]);
create temporary table proof_b1 as
select pg_temp.prepare_write('set_thresholds', pg_temp.thresholds_request(
  :black, 'catalog-setup:level:b1', '{"warning_threshold": 30}')) as result;
select result#>'{proposal,before,warning}' as warning_before, result#>'{proposal,after,warning}' as warning_after,
       result#>'{proposal,before,critical}' as critical_before, result#>'{proposal,after,critical}' as critical_after,
       result#>'{proposal,effects,thresholds_changed}' as thresholds_changed
  from proof_b1;
select (pg_temp.commit_write((select result from proof_b1), 'approve-catalog-setup-write:level-b1'))->>'kind' as committed;
select warning_threshold, critical_threshold from public.catalog_variants where id = :black;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]) as siblings_byte_identical;

\echo '## b2. warning 30 and critical 10: per level, only critical moves (cleared)'
update proof_digest set before_digest = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]);
create temporary table proof_b2 as
select pg_temp.prepare_write('set_thresholds', pg_temp.thresholds_request(
  :black, 'catalog-setup:level:b2', '{"warning_threshold": 30, "critical_threshold": 10}')) as result;
select result#>'{proposal,after,warning}' as warning_after, result#>'{proposal,after,critical}' as critical_after,
       result#>'{proposal,effects,thresholds_changed}' as thresholds_changed
  from proof_b2;
select (pg_temp.commit_write((select result from proof_b2), 'approve-catalog-setup-write:level-b2'))->>'kind' as committed;
select warning_threshold, critical_threshold from public.catalog_variants where id = :black;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]) as siblings_byte_identical;

\echo '## b3. the same request again: both levels already inherit, nothing changes'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_thresholds', pg_temp.thresholds_request(
  :black, 'catalog-setup:level:b3', '{"warning_threshold": 30, "critical_threshold": 10}')) as must_raise_no_change;
\set ON_ERROR_STOP on

\echo '## b4. warning 25 (differs) and critical 10 (equal): one own level, one inherited'
update proof_digest set before_digest = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]);
create temporary table proof_b4 as
select pg_temp.prepare_write('set_thresholds', pg_temp.thresholds_request(
  :black, 'catalog-setup:level:b4', '{"warning_threshold": 25, "critical_threshold": 10}')) as result;
select result#>'{proposal,after,warning}' as warning_after, result#>'{proposal,after,critical}' as critical_after,
       result#>'{proposal,effects,thresholds_changed}' as thresholds_changed
  from proof_b4;
select (pg_temp.commit_write((select result from proof_b4), 'approve-catalog-setup-write:level-b4'))->>'kind' as committed;
select warning_threshold, critical_threshold from public.catalog_variants where id = :black;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]) as siblings_byte_identical;
\echo '## b5. White / Normal still carries its own 30 / 10: a redundant override no write touched'
select warning_threshold, critical_threshold from public.catalog_variants where id = :white;

\echo ''
\echo '## (c) create_variant on Corner Sleeve'
\echo '## c1. Bronze / Normal at 15.00, warn 30, critical 10: every value equals what it inherits'
create temporary table proof_digest_family as select pg_temp.digest(:corner_sleeve, null) as before_digest;
create temporary table proof_c1 as
select pg_temp.prepare_write('create_variant', pg_temp.variant_request(
  :corner_sleeve, 'catalog-setup:level:c1',
  '[{"option_ref":{"kind":"catalog_option","id":"9900cda5-9b5d-426e-a15e-857dca2db59a"},"value_ref":{"kind":"catalog_option_value","id":"c0000000-0000-4000-8000-00000000b001"}},
    {"option_ref":{"kind":"catalog_option","id":"5db85385-12ee-427a-8788-178f7ae7df40"},"value_ref":{"kind":"catalog_option_value","id":"48bde7c9-a3a1-4877-ba73-d8e5ed26bb17"}}]',
  '{"price_override":{"amount":"15.00","currency":"CAD"},"warning_threshold":30,"critical_threshold":10}')) as result;
select jsonb_pretty((result#>'{proposal,after,variant}') - 'option_values') as after_variant from proof_c1;
select doc.value - 'option_value_ids' as payload_new_variant
  from private.agent_catalog_setup_writes w, jsonb_array_elements(w.payload->'variants') doc(value)
 where w.id = (select (result->>'change_set_id')::uuid from proof_c1) and doc.value ? 'client_id';
create temporary table proof_c1_receipt as
select pg_temp.commit_write((select result from proof_c1), 'approve-catalog-setup-write:level-c1') as receipt;
select (select receipt->'readback' from proof_c1_receipt) = (select result#>'{proposal,after,variant}' from proof_c1) as readback_equals_preview;
select price_override::text, unit_cost_override::text, warning_threshold, critical_threshold, unit_id
  from public.catalog_variants where id = (select (receipt#>>'{variant_ref,id}')::uuid from proof_c1_receipt);
select (select before_digest from proof_digest_family) = pg_temp.digest(:corner_sleeve,
         array[(select (receipt#>>'{variant_ref,id}')::uuid from proof_c1_receipt)]) as existing_variants_byte_identical;

\echo '## c2. Grey / Normal at 17.00, warn 40, critical 10: two own values, one inherited'
update proof_digest_family set before_digest = pg_temp.digest(:corner_sleeve, null);
create temporary table proof_c2 as
select pg_temp.prepare_write('create_variant', pg_temp.variant_request(
  :corner_sleeve, 'catalog-setup:level:c2',
  '[{"option_ref":{"kind":"catalog_option","id":"9900cda5-9b5d-426e-a15e-857dca2db59a"},"value_ref":{"kind":"catalog_option_value","id":"c0000000-0000-4000-8000-00000000b002"}},
    {"option_ref":{"kind":"catalog_option","id":"5db85385-12ee-427a-8788-178f7ae7df40"},"value_ref":{"kind":"catalog_option_value","id":"48bde7c9-a3a1-4877-ba73-d8e5ed26bb17"}}]',
  '{"price_override":{"amount":"17.00","currency":"CAD"},"warning_threshold":40,"critical_threshold":10}')) as result;
select result#>'{proposal,after,variant,sale_price}' as sale_price,
       result#>'{proposal,after,variant,unit_cost}' as unit_cost,
       result#>'{proposal,after,variant,warning_threshold}' as warning,
       result#>'{proposal,after,variant,critical_threshold}' as critical
  from proof_c2;
create temporary table proof_c2_receipt as
select pg_temp.commit_write((select result from proof_c2), 'approve-catalog-setup-write:level-c2') as receipt;
select price_override::text, unit_cost_override::text, warning_threshold, critical_threshold, unit_id
  from public.catalog_variants where id = (select (receipt#>>'{variant_ref,id}')::uuid from proof_c2_receipt);
select (select before_digest from proof_digest_family) = pg_temp.digest(:corner_sleeve,
         array[(select (receipt#>>'{variant_ref,id}')::uuid from proof_c2_receipt)]) as existing_variants_byte_identical;

\echo ''
\echo '## (d) set_supplier_cost: the mirror follows the level the family uses'
\echo '## d1. White / Normal, item-level cost 8.50: a new default at 8.50 leaves it inheriting'
update proof_digest set before_digest = pg_temp.digest(:corner_sleeve, array[:white]::uuid[]);
create temporary table proof_d1 as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  :white, 'catalog-setup:level:d1', 'home-depot-2026', 'Home Depot 2026 card', '8.50', true)) as result;
select result#>'{proposal,before,variant_unit_cost}' as cost_before,
       result#>'{proposal,after,variant_unit_cost}' as cost_after,
       result#>'{proposal,effects,variant_unit_cost_mirrored}' as mirrored
  from proof_d1;
select (pg_temp.commit_write((select result from proof_d1), 'approve-catalog-setup-write:level-d1'))#>'{readback,variant_unit_cost}' as readback_cost;
select unit_cost_override::text as stored_override from public.catalog_variants where id = :white;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:white]::uuid[]) as siblings_byte_identical;

\echo '## d2. Black / Normal: promote the 8.00 profile, which differs, so the override is set'
update proof_digest set before_digest = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]);
create temporary table proof_d2 as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  :black, 'catalog-setup:level:d2', 'cost-sheet-2025', 'Cost sheet 2025', '8.00', true)) as result;
select result#>'{proposal,before,variant_unit_cost}' as cost_before,
       result#>'{proposal,after,variant_unit_cost}' as cost_after,
       result#>'{proposal,effects,variant_unit_cost_mirrored}' as mirrored
  from proof_d2;
select (pg_temp.commit_write((select result from proof_d2), 'approve-catalog-setup-write:level-d2'))#>'{readback,variant_unit_cost}' as readback_cost;
select unit_cost_override::text as stored_override from public.catalog_variants where id = :black;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]) as siblings_byte_identical;

\echo '## d3. Black / Normal: promote the 8.50 profile back; equal to the family, so the override is cleared'
update proof_digest set before_digest = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]);
create temporary table proof_d3 as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  :black, 'catalog-setup:level:d3', 'rails-direct-2023', 'Rails Direct 2023', '8.50', true)) as result;
select result#>'{proposal,before,variant_unit_cost}' as cost_before,
       result#>'{proposal,after,variant_unit_cost}' as cost_after
  from proof_d3;
select (pg_temp.commit_write((select result from proof_d3), 'approve-catalog-setup-write:level-d3'))#>'{readback,variant_unit_cost}' as readback_cost;
select unit_cost_override::text as stored_override from public.catalog_variants where id = :black;
select (select before_digest from proof_digest) = pg_temp.digest(:corner_sleeve, array[:black]::uuid[]) as siblings_byte_identical;
select default_unit_cost::text as family_cost_never_written from public.catalog_items where id = :corner_sleeve;

\echo '## d4. Glass Panel Clear / 5mm, costed per variant: 4.20 -> 4.35 is written on the variant'
\echo '##     (the family carries five unit_id overrides equal to its default; none trips the guard)'
create temporary table proof_digest_glass as select pg_temp.digest(:glass_panel, array[:clear_5mm]::uuid[]) as before_digest;
create temporary table proof_d4 as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  :clear_5mm, 'catalog-setup:level:d4', 'vitrum-2026', 'Vitrum 2026', '4.35', true)) as result;
select result#>'{proposal,before,variant_unit_cost}' as cost_before,
       result#>'{proposal,after,variant_unit_cost}' as cost_after
  from proof_d4;
select (pg_temp.commit_write((select result from proof_d4), 'approve-catalog-setup-write:level-d4'))#>'{readback,variant_unit_cost}' as readback_cost;
select unit_cost_override::text as stored_override, unit_id = '4894ea23-44cf-4752-8280-7716ff8414fc' as unit_id_equals_family_default
  from public.catalog_variants where id = :clear_5mm;
select (select before_digest from proof_digest_glass) = pg_temp.digest(:glass_panel, array[:clear_5mm]::uuid[]) as siblings_byte_identical;

\echo ''
\echo '## (e) set_pricing on the Corner Sleeve FAMILY, 15.00 -> 17.00'
-- F4: White / Normal is given a 15.00 override by hand, outside MCP: a
--     redundant override that already exists before the write.
update public.catalog_variants set price_override = 15 where id = :white;
select * from pg_temp.levels(:corner_sleeve);
update proof_digest_family set before_digest = pg_temp.digest(:corner_sleeve, null);
create temporary table proof_e as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_family', :corner_sleeve, 'catalog-setup:level:e', '17')) as result;
select jsonb_pretty(result#>'{proposal,before,shadowing_variants}') as shadowing_before,
       jsonb_pretty(result#>'{proposal,after,shadowing_variants}') as shadowing_after
  from proof_e;
select (select jsonb_agg(doc.value->'value_labels') from jsonb_array_elements(result#>'{proposal,after,affected_variants}') doc(value)) as affected,
       result#>'{proposal,effects}' as effects,
       result#>'{proposal,after,price}' as after_price
  from proof_e;
create temporary table proof_e_receipt as
select pg_temp.commit_write((select result from proof_e), 'approve-catalog-setup-write:level-e') as receipt;
select (select receipt->'readback' from proof_e_receipt) = (select result#>'{proposal,after}' from proof_e) as readback_equals_preview;
select default_price::text as family_default from public.catalog_items where id = :corner_sleeve;
select (select before_digest from proof_digest_family) = pg_temp.digest(:corner_sleeve, null) as every_variant_byte_identical;
select * from pg_temp.levels(:corner_sleeve);

\echo ''
\echo '## (f) the post-condition, red: a commit forced to create a redundant override'
\echo '## f1. a variant price payload tampered to the family default (Bronze, inherits 17.00)'
create temporary table proof_f1 as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', (select (receipt#>>'{variant_ref,id}')::uuid from proof_c1_receipt),
  'catalog-setup:level:f1', '21')) as result;
-- Nothing in production can do this: the payload is sealed into the preview
-- hash at prepare. It stands in for a compile function that gets the rule wrong.
update private.agent_catalog_setup_writes w
   set payload = jsonb_set(w.payload, '{variants}', (
     select jsonb_agg(case when doc.value->>'id' = (select receipt#>>'{variant_ref,id}' from proof_c1_receipt)
                           then doc.value || '{"price_override": "17"}'::jsonb else doc.value end
                      order by doc.ordinality)
     from jsonb_array_elements(w.payload->'variants') with ordinality doc(value, ordinality)))
 where w.id = (select (result->>'change_set_id')::uuid from proof_f1);
update proof_digest_family set before_digest = pg_temp.digest(:corner_sleeve, null);
\set ON_ERROR_STOP off
\set VERBOSITY verbose
select pg_temp.commit_write((select result from proof_f1), 'approve-catalog-setup-write:level-f1') as must_raise_override_level_changed;
\set VERBOSITY default
\set ON_ERROR_STOP on
select (select before_digest from proof_digest_family) = pg_temp.digest(:corner_sleeve, null) as rolled_back_every_variant_identical;
select w.committed_at is null as not_committed, a.status as action_status
  from private.agent_catalog_setup_writes w join public.agent_actions a on a.id = w.action_id
 where w.id = (select (result->>'change_set_id')::uuid from proof_f1);

\echo '## f2. a NEW variant tampered to carry the family unit (Glass Panel Pinhead / 5mm)'
create temporary table proof_f2 as
select pg_temp.prepare_write('create_variant', pg_temp.variant_request(
  :glass_panel, 'catalog-setup:level:f2',
  '[{"option_ref":{"kind":"catalog_option","id":"54aacec9-079e-4af8-88be-8f0c77e79c9b"},"value_ref":{"kind":"catalog_option_value","id":"e3c33a44-d777-4955-b702-f09bb84d015f"}},
    {"option_ref":{"kind":"catalog_option","id":"3fa070c3-23d4-48b8-8a65-73d8f8e36ca4"},"value_ref":{"kind":"catalog_option_value","id":"14651e24-0c2a-41bf-a93b-9f090ccc1c3d"}}]',
  '{"price_override":{"amount":"95.00","currency":"CAD"}}')) as result;
update private.agent_catalog_setup_writes w
   set payload = jsonb_set(w.payload, '{variants}', (
     select jsonb_agg(case when doc.value ? 'client_id'
                           then doc.value || '{"unit_id": "4894ea23-44cf-4752-8280-7716ff8414fc"}'::jsonb
                           else doc.value end order by doc.ordinality)
     from jsonb_array_elements(w.payload->'variants') with ordinality doc(value, ordinality)))
 where w.id = (select (result->>'change_set_id')::uuid from proof_f2);
update proof_digest_glass set before_digest = pg_temp.digest(:glass_panel, null);
\set ON_ERROR_STOP off
\set VERBOSITY verbose
select pg_temp.commit_write((select result from proof_f2), 'approve-catalog-setup-write:level-f2') as must_raise_override_level_changed;
\set VERBOSITY default
\set ON_ERROR_STOP on
select (select before_digest from proof_digest_glass) = pg_temp.digest(:glass_panel, null) as rolled_back_every_variant_identical,
       (select count(*) from public.catalog_variants where catalog_item_id = :glass_panel and deleted_at is null) as glass_panel_variants;

\echo '## f3. a SIBLING tampered: a thresholds write on White that also pins Black to the family price'
create temporary table proof_f3 as
select pg_temp.prepare_write('set_thresholds', pg_temp.thresholds_request(
  :white, 'catalog-setup:level:f3', '{"warning_threshold": 35}')) as result;
update private.agent_catalog_setup_writes w
   set payload = jsonb_set(w.payload, '{variants}', (
     select jsonb_agg(case when doc.value->>'id' = '22f9a4ac-eb8d-46a7-a134-1cc75800a700'
                           then doc.value || '{"price_override": "17"}'::jsonb else doc.value end
                      order by doc.ordinality)
     from jsonb_array_elements(w.payload->'variants') with ordinality doc(value, ordinality)))
 where w.id = (select (result->>'change_set_id')::uuid from proof_f3);
update proof_digest_family set before_digest = pg_temp.digest(:corner_sleeve, null);
\set ON_ERROR_STOP off
\set VERBOSITY verbose
select pg_temp.commit_write((select result from proof_f3), 'approve-catalog-setup-write:level-f3') as must_raise_override_level_changed;
\set VERBOSITY default
\set ON_ERROR_STOP on
select (select before_digest from proof_digest_family) = pg_temp.digest(:corner_sleeve, null) as rolled_back_every_variant_identical;

\echo '## f4. the SHIPPED set_pricing compile, reinstated: it pins Black to 17.00, and the commit refuses'
savepoint shipped_compile;
\i :shipped_pricing_compile
update private.agent_catalog_effect_policy
   set effect_sha256 = private.agent_catalog_setup_write_effect_revision()
 where revision = '2026-09-15.catalog-setup-write.v1';
create temporary table proof_f4 as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant', :black, 'catalog-setup:level:f4', '17')) as result;
select result#>'{proposal,after,price}' as shipped_after_price from proof_f4;
\set ON_ERROR_STOP off
\set VERBOSITY verbose
select pg_temp.commit_write((select result from proof_f4), 'approve-catalog-setup-write:level-f4') as must_raise_override_level_changed;
\set VERBOSITY default
\set ON_ERROR_STOP on
select price_override::text as black_still_inherits from public.catalog_variants where id = :black;
rollback to savepoint shipped_compile;
select md5(prosrc) as compile_set_pricing_md5_restored
  from pg_proc where oid = 'private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)'::regprocedure;

\echo '## f5. redundant overrides nobody wrote do not trip it'
select count(*) as live_unit_id_overrides_equal_to_family_default
  from public.catalog_variants v join public.catalog_items i on i.id = v.catalog_item_id
 where v.company_id = :company and v.deleted_at is null and v.unit_id = i.default_unit_id;
-- Every Canpro family, compared against itself: no change, so no offender,
-- whatever redundant overrides it carries (White's own 30 / 10 levels, Grey's
-- 17.00 price, every Glass Panel and Vinyl unit).
select count(*) as families_checked,
       count(*) filter (where private.agent_catalog_setup_override_level_changes(
         i.company_id, i.id,
         (select array_agg(v) from public.catalog_variants v
           where v.catalog_item_id = i.id and v.company_id = i.company_id and v.deleted_at is null)
       ) <> '[]'::jsonb) as families_with_offenders
  from public.catalog_items i where i.company_id = :company and i.deleted_at is null;
-- A real commit on Vinyl, whose fifteen variants all carry the family unit.
create temporary table proof_digest_vinyl as
select pg_temp.digest(:vinyl, array['18234bac-442f-41e8-98e7-956c051fbf21']::uuid[]) as before_digest;
create temporary table proof_f5 as
select pg_temp.prepare_write('set_thresholds', pg_temp.thresholds_request(
  '18234bac-442f-41e8-98e7-956c051fbf21', 'catalog-setup:level:f5', '{"warning_threshold": 6}')) as result;
select (pg_temp.commit_write((select result from proof_f5), 'approve-catalog-setup-write:level-f5'))#>'{readback,warning}' as vinyl_commit_readback;
select (select before_digest from proof_digest_vinyl) = pg_temp.digest(:vinyl, array['18234bac-442f-41e8-98e7-956c051fbf21']::uuid[]) as siblings_byte_identical;

\echo ''
\echo '## 5. state at the end of the transaction, before it is thrown away'
select * from pg_temp.levels(:corner_sleeve);
select count(*) as proposals, count(*) filter (where committed_at is not null) as committed
  from private.agent_catalog_setup_writes;

rollback;

\echo ''
\echo '## 6. after the rollback: the database is exactly as it was'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select md5(prosrc) as commit_md5
  from pg_proc where oid = 'public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
select to_regprocedure('private.agent_catalog_setup_override_for(numeric,numeric)') as rule_function;
select v.id, v.price_override::text, v.unit_cost_override::text, v.warning_threshold, v.critical_threshold
  from public.catalog_variants v where v.id in (:black, :white, :clear_5mm) order by v.id;
