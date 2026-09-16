-- Runnable transcript for docs/artifacts/mcp-catalog-setup-writes/create-option-proof.md
--
-- All six migrations are read with their outer begin;/commit; commented out so
-- the whole run is one transaction that ends in rollback. Produce the bodies
-- with:
--
--   for f in 20260915223000_agent_catalog_recipe_read_v24 \
--            20260916010000_agent_catalog_setup_write_variant \
--            20260916020000_agent_catalog_setup_write_thresholds \
--            20260916030000_agent_catalog_setup_write_pricing \
--            20260916040000_agent_catalog_setup_write_supplier_cost \
--            20260916050000_agent_catalog_setup_write_option; do
--     sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
--       supabase/migrations/$f.sql > /tmp/m_$f.sql
--   done
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
--     -v task6_migration=/tmp/m_20260915223000_agent_catalog_recipe_read_v24.sql \
--     -v catalog_setup_write_migration=/tmp/m_20260916010000_agent_catalog_setup_write_variant.sql \
--     -v thresholds_migration=/tmp/m_20260916020000_agent_catalog_setup_write_thresholds.sql \
--     -v pricing_migration=/tmp/m_20260916030000_agent_catalog_setup_write_pricing.sql \
--     -v supplier_cost_migration=/tmp/m_20260916040000_agent_catalog_setup_write_supplier_cost.sql \
--     -v option_migration=/tmp/m_20260916050000_agent_catalog_setup_write_option.sql \
--     -f docs/artifacts/mcp-catalog-setup-writes/create-option-proof.sql
--
-- It writes nothing: the last statement is rollback.
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on
\pset pager off
begin;

\echo ''
\echo '## 0. production state before the migrations'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regprocedure('private.agent_catalog_setup_compile_create_option(uuid,uuid,jsonb)') as compile_before;
select o.id, o.name, o.sort_order,
       (select count(*) from public.catalog_option_values v
         where v.option_id = o.id and v.deleted_at is null) as values
  from public.catalog_options o
 where o.catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and o.deleted_at is null
 order by o.sort_order;
select id, sku, quantity, price_override, unit_cost_override,
       warning_threshold, critical_threshold, is_active
  from public.catalog_variants
 where catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and deleted_at is null;

\echo ''
\echo '## 0b. the save function carries every table this kind writes'
select strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
              'insert into public.catalog_options') > 0 as writes_options,
       strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
              'insert into public.catalog_option_values') > 0 as writes_values,
       strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
              'insert into public.catalog_variant_option_values') > 0 as writes_joins,
       strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
              'matrix_signature_conflict') > 0 as dedupes_the_matrix;
-- And the three tables it writes ask for company isolation and nothing else,
-- which is why this kind asks for no setup authority.
select tablename, policyname,
       qual::text like '%run_setup%' as names_run_setup
  from pg_policies
 where schemaname = 'public'
   and tablename in ('catalog_options','catalog_option_values',
                     'catalog_variant_option_values','catalog_supplier_cost_profiles')
 order by tablename, policyname;

\echo ''
\echo '## 1. applying the V24 recipe read, the spine, and kinds 2, 3, 4 and 5'
\i :task6_migration
\i :catalog_setup_write_migration
\i :thresholds_migration
\i :pricing_migration
\i :supplier_cost_migration
\i :option_migration

\echo ''
\echo '## 2. a synthetic V24 client and grant (rolled back)'
set search_path = '';
insert into private.agent_read_domain_revisions(company_id, domain, source_revision)
values ('a612edc0-5c18-4c4d-af97-55b9410dd077','catalog',1)
on conflict do nothing;
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision)
values ('44444444-4444-4444-8444-444444444444','Create option write proof',
  array['https://example.invalid/cb'],'none',
  array['authorization_code'],array['code'],
  'ops.catalog.prepare ops.catalog.read','manual',
  array['ops.catalog.prepare','ops.catalog.read'],
  '2026-09-15.mcp-consent-catalog.v18','2026-09-15.mcp-exposure.v24');
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision,
  accepted_labels, consent_catalog_revision, exposure_revision)
values ('55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '44444444-4444-4444-8444-444444444444',
  array['ops.catalog.prepare','ops.catalog.read'], repeat('b',32),
  private.mcp_oauth_labels_for_scopes(
    array['ops.catalog.prepare','ops.catalog.read'],
    '2026-09-15.mcp-consent-catalog.v18'),
  '2026-09-15.mcp-consent-catalog.v18','2026-09-15.mcp-exposure.v24');

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
  select * into v_grant from private.mcp_oauth_grants
  where id = '55555555-5555-4555-8555-555555555555';
  select authority.permission_snapshot_revision into v_snapshot
  from private.resolve_agent_actor_authority(v_actor, v_company, v_keys) authority;
  v_capability := private.agent_catalog_setup_write_kind_capability(p_kind);
  return public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp());
end $f$;

create or replace function pg_temp.option_request(
  p_family uuid, p_key text, p_name text, p_values jsonb,
  p_backfill text default null, p_sort integer default null,
  p_evidence text default 'Jackson: every endcap rail on the shelf today is the 42" one.'
) returns jsonb language sql as $f$
  select jsonb_strip_nulls(jsonb_build_object(
    'family_ref', jsonb_build_object('kind','catalog_family','id',p_family),
    'name', p_name,
    'values', p_values,
    'sort_order', p_sort,
    'value_for_existing_variants', p_backfill,
    'evidence', jsonb_build_array(jsonb_build_object(
      'kind','operator_statement','text',p_evidence)),
    'idempotency_key', p_key))
$f$;

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

-- Everything about every variant of the family EXCEPT its option-value joins.
-- If this digest moves, the write touched a row it said it would not.
create or replace function pg_temp.variant_digest(p_family uuid)
returns text language sql as $f$
  select md5(coalesce(string_agg(row_text, '|' order by row_text), ''))
  from (
    select v.id::text || ':' || coalesce(v.sku,'') || ':' || v.quantity::text || ':'
        || coalesce(v.price_override::text,'') || ':' || coalesce(v.unit_cost_override::text,'') || ':'
        || coalesce(v.warning_threshold::text,'') || ':' || coalesce(v.critical_threshold::text,'') || ':'
        || v.is_active::text || ':' || coalesce(v.unit_id::text,'') as row_text
    from public.catalog_variants v
    where v.catalog_item_id = p_family and v.deleted_at is null
  ) rows
$f$;

-- Every other family in the company: options, values, variants and joins.
create or replace function pg_temp.other_families_digest(p_family uuid)
returns text language sql as $f$
  select md5(coalesce(string_agg(row_text, '|' order by row_text), ''))
  from (
    select 'o:' || o.id::text || ':' || o.name || ':' || o.sort_order::text as row_text
      from public.catalog_options o
      join public.catalog_items i on i.id = o.catalog_item_id
     where i.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       and o.catalog_item_id <> p_family and o.deleted_at is null
    union all
    select 'v:' || ov.id::text || ':' || ov.value
      from public.catalog_option_values ov
      join public.catalog_options o on o.id = ov.option_id
      join public.catalog_items i on i.id = o.catalog_item_id
     where i.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       and o.catalog_item_id <> p_family and ov.deleted_at is null
    union all
    select 'j:' || j.variant_id::text || ':' || j.option_value_id::text
      from public.catalog_variant_option_values j
      join public.catalog_variants va on va.id = j.variant_id
     where va.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
       and va.catalog_item_id <> p_family and j.deleted_at is null
  ) rows
$f$;

select set_config('request.jwt.claim.role','service_role',true);

\echo ''
\echo '## 3. scenario 9 — the seal is absent, so every prepare refuses (decision W10)'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','catalog-setup:option:activation','Height',
  jsonb_build_array(jsonb_build_object('value','42"'), jsonb_build_object('value','72"')),
  '42"')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 4. an operator seals the reviewed effects (this migration seeds nothing)'
insert into private.agent_catalog_effect_policy(revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());
select revision, left(effect_sha256, 18) || '...' as effect_sha256
  from private.agent_catalog_effect_policy;

\echo ''
\echo '## 5. the digests before anything is written'
create temporary table proof_digest as
select pg_temp.variant_digest('948ac4a0-882f-efe9-3bc4-b6f7c53fb12f') as variants_before,
       pg_temp.other_families_digest('948ac4a0-882f-efe9-3bc4-b6f7c53fb12f') as others_before;
select * from proof_digest;

\echo ''
\echo '## 6. scenario 1 — prepare Height (42", 72") on Endcap rail, backfilling 42"'
create temporary table proof_prepare as
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','catalog-setup:option:endcap-height','Height',
  jsonb_build_array(jsonb_build_object('value','42"'), jsonb_build_object('value','72"')),
  '42"')) as result;
select jsonb_pretty((select result from proof_prepare) - 'proposal' - 'prompt_safety') as prepare_envelope;
select jsonb_pretty((select result->'proposal' from proof_prepare)) as proposal;
select action_type, status, context_source, priority,
       action_data->>'preview_sha256' = (select result->>'preview_sha256' from proof_prepare) as seal_matches
  from public.agent_actions
 where id = (select (result->>'action_id')::uuid from proof_prepare);
select type, title, body, persistent, action_url, action_label
  from public.notifications
 where dedupe_key = 'catalog-setup-write:' || (select result->>'action_id' from proof_prepare);

\echo ''
\echo '## 6b. the payload: the family COMPLETE document, one option appended,'
\echo '##      every variant re-sent with its WHOLE value set under client ids'
select jsonb_pretty(payload) as payload
  from private.agent_catalog_setup_writes
 where id = (select (result->>'change_set_id')::uuid from proof_prepare);

\echo ''
\echo '## 6c. scenario 2 — the same key replays the same seal, writing nothing'
select (pg_temp.prepare_write('create_option', pg_temp.option_request(
  '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','catalog-setup:option:endcap-height','Height',
  jsonb_build_array(jsonb_build_object('value','42"'), jsonb_build_object('value','72"')),
  '42"'))->>'replayed')::boolean as replayed,
  (pg_temp.prepare_write('create_option', pg_temp.option_request(
  '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','catalog-setup:option:endcap-height','Height',
  jsonb_build_array(jsonb_build_object('value','42"'), jsonb_build_object('value','72"')),
  '42"'))->>'preview_sha256') = (select result->>'preview_sha256' from proof_prepare) as same_seal;
select count(*) as option_rows_before_commit from public.catalog_options
 where catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and deleted_at is null;

\echo ''
\echo '## 7. the operator approves: the commit runs catalog_setup_save as that operator'
create temporary table proof_receipt as
select pg_temp.commit_write((select result from proof_prepare),
                            'approve-catalog-setup-write:endcap-height') as receipt;
select jsonb_pretty((select receipt from proof_receipt) - 'readback') as receipt_envelope;
select jsonb_pretty((select receipt->'readback' from proof_receipt)) as readback;

\echo ''
\echo '## 7b. the option and both values exist, and every variant carries 42"'
select o.id, o.name, o.sort_order from public.catalog_options o
 where o.catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and o.deleted_at is null
 order by o.sort_order;
select ov.value, ov.sort_order, o.name as option_name
  from public.catalog_option_values ov
  join public.catalog_options o on o.id = ov.option_id
 where o.catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and ov.deleted_at is null
 order by o.sort_order, ov.sort_order;
select va.id,
       (select string_agg(ov.value, ' / ' order by o.sort_order, o.name, o.id)
          from public.catalog_variant_option_values j
          join public.catalog_option_values ov on ov.id = j.option_value_id
          join public.catalog_options o on o.id = ov.option_id
         where j.variant_id = va.id and j.deleted_at is null) as value_set,
       (select count(*) from public.catalog_variant_option_values j
          join public.catalog_option_values ov on ov.id = j.option_value_id
         where j.variant_id = va.id and j.deleted_at is null
           and ov.option_id = (select id from public.catalog_options
                                where catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f'
                                  and name = 'Height' and deleted_at is null)) as height_values
  from public.catalog_variants va
 where va.catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and va.deleted_at is null
 order by va.id;

\echo ''
\echo '## 7c. nothing else moved: no variant column, no price, no threshold, no'
\echo '##     stock, no supplier cost, and no other family'
select (select variants_before from proof_digest)
         = pg_temp.variant_digest('948ac4a0-882f-efe9-3bc4-b6f7c53fb12f') as variant_rows_identical,
       (select others_before from proof_digest)
         = pg_temp.other_families_digest('948ac4a0-882f-efe9-3bc4-b6f7c53fb12f') as other_families_identical;
select count(*) as stock_events_for_this_family
  from public.catalog_stock_unit_events e
  join public.catalog_variants v on v.id = e.catalog_variant_id
 where v.catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f';
select count(*) as supplier_profiles_touched
  from public.catalog_supplier_cost_profiles p
  join public.catalog_variants v on v.id = p.catalog_variant_id
 where v.catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f'
   and p.updated_at > now() - interval '1 minute';
select i.default_price, i.default_unit_cost,
       i.default_warning_threshold, i.default_critical_threshold
  from public.catalog_items i where i.id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f';

\echo ''
\echo '## 8. scenario 3 — the two tools compose: a Black / 72" variant on the'
\echo '##    family that just gained the Height axis (the Posts story, gap #1-#4)'
create temporary table proof_variant as
select pg_temp.prepare_write('create_variant', jsonb_build_object(
  'family_ref', jsonb_build_object('kind','catalog_family','id','948ac4a0-882f-efe9-3bc4-b6f7c53fb12f'),
  'option_values', (
    select jsonb_agg(jsonb_build_object(
      'option_ref', jsonb_build_object('kind','catalog_option','id',o.id),
      'value_ref', jsonb_build_object('kind','catalog_option_value','id',ov.id)))
    from public.catalog_options o
    join public.catalog_option_values ov on ov.option_id = o.id and ov.deleted_at is null
    where o.catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and o.deleted_at is null
      and ((o.name = 'Color' and ov.value = 'Black') or (o.name = 'Height' and ov.value = '72"'))),
  'evidence', jsonb_build_array(jsonb_build_object(
    'kind','operator_statement','text','Jackson: the 72" endcap rail is stocked now.')),
  'idempotency_key','catalog-setup:option:endcap-72')) as result;
select result->>'status' as status, result->>'kind' as kind,
       jsonb_pretty(result#>'{proposal,after,variant,option_values}') as new_variant_axes
  from proof_variant;
select jsonb_pretty(pg_temp.commit_write((select result from proof_variant),
                                         'approve-catalog-setup-write:endcap-72')
       #>'{readback,option_values}') as committed_axes;

\echo ''
\echo '## 9. the refusals'
\set ON_ERROR_STOP off
\echo '## 9a. scenario 4 — a dimension the family already has, cased differently'
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','catalog-setup:option:dupe','height',
  jsonb_build_array(jsonb_build_object('value','96"')), '96"')) as must_raise_option_exists;
\echo '## 9b. scenario 5 — a backfill value the request never listed'
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44','catalog-setup:option:badfill','Finish',
  jsonb_build_array(jsonb_build_object('value','Matte')), 'Gloss')) as must_raise_backfill_invalid;
\echo '## 9c. scenario 6 — a family with variants and no backfill value at all'
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44','catalog-setup:option:nofill','Finish',
  jsonb_build_array(jsonb_build_object('value','Matte')))) as must_raise_input_invalid;
\echo '## 9d. the same value named twice, however it is cased'
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44','catalog-setup:option:dupvalues','Finish',
  jsonb_build_array(jsonb_build_object('value','Matte'), jsonb_build_object('value','matte')),
  'Matte')) as must_raise_values_duplicate;
\echo '## 9e. a family whose active variants cannot be told apart (Diverter)'
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  'fc4e178b-566e-4ee8-b7bc-2a0e4ed54d27','catalog-setup:option:ambiguous','Finish',
  jsonb_build_array(jsonb_build_object('value','Matte')), 'Matte')) as must_raise_ambiguous;
\set ON_ERROR_STOP on

\echo ''
\echo '## 10. scenario 7 — a family with no variants at all'
insert into public.catalog_items(id, company_id, category_id, name, is_active)
select '7f000000-0000-4000-8000-00000000000f', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
       category_id, 'Proof Empty Family', true
from public.catalog_items where id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f';
\set ON_ERROR_STOP off
\echo '## 10a. naming a backfill value when there is nothing to backfill'
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '7f000000-0000-4000-8000-00000000000f','catalog-setup:option:empty-bad','Height',
  jsonb_build_array(jsonb_build_object('value','42"')), '42"')) as must_raise_input_invalid;
\set ON_ERROR_STOP on
\echo '## 10b. and the same request without it: created, nothing backfilled'
create temporary table proof_empty as
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '7f000000-0000-4000-8000-00000000000f','catalog-setup:option:empty-ok','Height',
  jsonb_build_array(jsonb_build_object('value','42"'), jsonb_build_object('value','72"')))) as result;
select jsonb_pretty(result#>'{proposal,effects}') as effects,
       jsonb_pretty(result#>'{proposal,after,backfill}') as backfill,
       jsonb_array_length(result#>'{proposal,after,variants}') as variants_listed
  from proof_empty;
select jsonb_pretty(pg_temp.commit_write((select result from proof_empty),
                                         'approve-catalog-setup-write:empty')
       #>'{readback,options}') as committed_options;

\echo ''
\echo '## 11. scenario 8 — the family moves between prepare and commit'
create temporary table proof_stale as
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44','catalog-setup:option:vinyl-stale','Finish',
  jsonb_build_array(jsonb_build_object('value','Matte'), jsonb_build_object('value','Gloss')),
  'Matte')) as result;
select result->>'status' as status,
       jsonb_array_length(result#>'{proposal,after,variants}') as variants_backfilled
  from proof_stale;
update public.catalog_option_values
   set value = 'Boardwalk II'
 where id = '247c1452-41db-485e-9463-6cc7059c3bb5';
\set ON_ERROR_STOP off
select pg_temp.commit_write((select result from proof_stale),
                            'approve-catalog-setup-write:vinyl-stale') as must_raise_source_stale;
\set ON_ERROR_STOP on
update public.catalog_option_values
   set value = 'Boardwalk'
 where id = '247c1452-41db-485e-9463-6cc7059c3bb5';

\echo ''
\echo '## 12. the wide case the gaps document describes: Vinyl, 15 variants'
create temporary table proof_wide as
select pg_temp.prepare_write('create_option', pg_temp.option_request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44','catalog-setup:option:vinyl-finish','Finish',
  jsonb_build_array(jsonb_build_object('value','Matte'), jsonb_build_object('value','Gloss')),
  'Matte')) as result;
select result#>>'{proposal,effects,variants_backfilled}' as variants_backfilled,
       result#>>'{proposal,effects,option_values_created}' as values_created,
       result#>>'{proposal,after,backfill,variant_count}' as backfill_count,
       jsonb_array_length(result#>'{proposal,after,variants}') as variants_listed,
       result#>>'{proposal,after,options,2,sort_order}' as new_sort_order
  from proof_wide;
select jsonb_pretty(result#>'{proposal,after,variants}') as after_variants from proof_wide;
select (pg_temp.commit_write((select result from proof_wide),
                             'approve-catalog-setup-write:vinyl-finish')->>'ok')::boolean as committed;
select count(*) as vinyl_variants,
       count(*) filter (where labels @> '["Matte"]'::jsonb) as carrying_matte
  from (
    select private.agent_catalog_setup_value_labels(
             'a612edc0-5c18-4c4d-af97-55b9410dd077',
             '9b30f44d-47da-4134-872d-7f9c2d6f1b44', v.id) as labels
    from public.catalog_variants v
    where v.catalog_item_id = '9b30f44d-47da-4134-872d-7f9c2d6f1b44' and v.deleted_at is null
  ) labelled;

\echo ''
\echo '## 13. scenario 10 — after the rollback nothing is written and the seal is empty'
rollback;
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regprocedure('private.agent_catalog_setup_compile_create_option(uuid,uuid,jsonb)') as compile_after;
select count(*) as endcap_options from public.catalog_options
 where catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and deleted_at is null;
select count(*) as endcap_variants from public.catalog_variants
 where catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and deleted_at is null;
select count(*) as proof_family from public.catalog_items
 where id = '7f000000-0000-4000-8000-00000000000f';
