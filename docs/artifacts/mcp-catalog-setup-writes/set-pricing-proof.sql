-- Runnable transcript for docs/artifacts/mcp-catalog-setup-writes/set-pricing-proof.md
--
-- All four migrations are read with their outer begin;/commit; commented out so
-- the whole run is one transaction that ends in rollback. Produce the bodies
-- with:
--
--   for f in 20260915224500_agent_catalog_recipe_read_v24 \
--            20260916010000_agent_catalog_setup_write_variant \
--            20260916020000_agent_catalog_setup_write_thresholds \
--            20260916030000_agent_catalog_setup_write_pricing; do
--     sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
--       supabase/migrations/$f.sql > /tmp/m_$f.sql
--   done
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
--     -v task6_migration=/tmp/m_20260915224500_agent_catalog_recipe_read_v24.sql \
--     -v catalog_setup_write_migration=/tmp/m_20260916010000_agent_catalog_setup_write_variant.sql \
--     -v thresholds_migration=/tmp/m_20260916020000_agent_catalog_setup_write_thresholds.sql \
--     -v pricing_migration=/tmp/m_20260916030000_agent_catalog_setup_write_pricing.sql \
--     -f docs/artifacts/mcp-catalog-setup-writes/set-pricing-proof.sql
--
-- It writes nothing: the last statement is rollback.
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on
\pset pager off
begin;

\echo ''
\echo '## 0. production state before the migrations'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regprocedure('private.catalog_family_default_price_save(uuid,uuid,uuid,numeric,text,jsonb)') as writer_before;
select id, name, default_price, default_price::text as stored_text
  from public.catalog_items
 where id in ('948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','393c5c83-d9df-2a48-9837-2e04501b34c6');
select id, price_override, price_override::text as stored_text
  from public.catalog_variants
 where catalog_item_id = '948ac4a0-882f-efe9-3bc4-b6f7c53fb12f' and deleted_at is null;

\echo ''
\echo '## 0b. catalog_setup_save does not write a family default price'
-- The reason the narrow writer exists. Its family section names these columns
-- and no others; `default_price` and `default_unit_cost` appear nowhere in it.
select
  strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
         'catalog_items.default_price') as family_default_price_writes,
  strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
         'default_unit_cost') as family_default_cost_writes,
  strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
         'catalog_supplier_cost_profiles') as supplier_cost_writes,
  strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
         'unit_cost_override') as variant_cost_writes;

\echo ''
\echo '## 1. applying the V24 recipe read, the write spine, thresholds, then this kind'
\i :task6_migration
\i :catalog_setup_write_migration
\i :thresholds_migration
\i :pricing_migration

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
values ('44444444-4444-4444-8444-444444444444','Pricing write proof',
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
    array['ops.catalog.prepare','ops.catalog.read'],'2026-09-15.mcp-consent-catalog.v18'),
  '2026-09-15.mcp-consent-catalog.v18','2026-09-15.mcp-exposure.v24');

-- Harness: call the prepare exactly as the TypeScript repository does.
create or replace function pg_temp.prepare_write(p_kind text, p_request jsonb, p_grant uuid default '55555555-5555-4555-8555-555555555555')
returns jsonb language plpgsql as $f$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_company uuid := 'a612edc0-5c18-4c4d-af97-55b9410dd077';
  v_keys text[] := array['agent.review','catalog.manage','catalog.products.view','catalog.run_setup','catalog.stock.adjust','catalog.view'];
  v_snapshot text;
  v_grant private.mcp_oauth_grants%rowtype;
  v_capability text;
begin
  select * into v_grant from private.mcp_oauth_grants where id = p_grant;
  select authority.permission_snapshot_revision into v_snapshot
  from private.resolve_agent_actor_authority(v_actor, v_company, v_keys) authority;
  v_capability := private.agent_catalog_setup_write_kind_capability(p_kind);
  return public.prepare_catalog_setup_write_as_system(
    v_actor, v_company, v_grant.id, v_grant.client_id, v_grant.revision, v_grant.scopes,
    v_snapshot, v_keys, '2026-09-15.capability-manifest.v28', v_grant.exposure_revision,
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp());
end $f$;

-- The tool's request shape. 'clear' spells the explicit JSON null that clears
-- the price at the level the ref names; jsonb_strip_nulls would delete it.
create or replace function pg_temp.pricing_request(
  p_kind text, p_id uuid, p_key text, p_amount text,
  p_currency text default 'CAD',
  p_evidence text default 'Jackson priced this off the 2026 cost sheet.'
) returns jsonb language sql as $f$
  select jsonb_build_object(
    'item_ref', jsonb_build_object('kind', p_kind, 'id', p_id),
    'sale_price', case when p_amount = 'clear' then 'null'::jsonb
                       else jsonb_build_object('amount', p_amount, 'currency', p_currency) end,
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text',p_evidence)),
    'idempotency_key', p_key)
$f$;

-- A hash of every OTHER variant of a family, to prove the write is surgical.
-- price_override is captured as its exact stored text, not as a number.
create or replace function pg_temp.siblings_digest(p_family uuid, p_target uuid)
returns text language sql as $f$
  select md5(coalesce(string_agg(row_text, '|' order by row_text), ''))
  from (
    select v.id::text || ':' || coalesce(v.sku,'') || ':' || v.quantity::text || ':'
        || coalesce(v.price_override::text,'') || ':' || coalesce(v.unit_cost_override::text,'') || ':'
        || coalesce(v.warning_threshold::text,'') || ':' || coalesce(v.critical_threshold::text,'') || ':'
        || v.is_active::text || ':' || coalesce(v.unit_id::text,'') || ':'
        || coalesce((select string_agg(j.option_value_id::text,',' order by j.option_value_id)
                     from public.catalog_variant_option_values j
                     where j.variant_id = v.id and j.deleted_at is null),'') as row_text
    from public.catalog_variants v
    where v.catalog_item_id = p_family and v.deleted_at is null and v.id <> p_target
  ) rows
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

select set_config('request.jwt.claim.role','service_role',true);

\echo ''
\echo '## 3. the seal is absent: every prepare refuses (decision W10)'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_family','948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','catalog-setup:pricing:activation','7.50')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 4. an operator seals the reviewed effects (this migration seeds nothing)'
insert into private.agent_catalog_effect_policy(revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());
select revision, left(effect_sha256, 18) || '...' as effect_sha256
  from private.agent_catalog_effect_policy;

\echo ''
\echo '## 5. no app role can execute the narrow writer, or read its ledger'
select rolename,
       has_function_privilege(rolename,
         'private.catalog_family_default_price_save(uuid,uuid,uuid,numeric,text,jsonb)'::regprocedure,
         'execute') as can_execute_writer,
       has_table_privilege(rolename, 'private.agent_catalog_setup_writer_requests', 'select')
         as can_read_ledger
  from unnest(array['anon','authenticated','service_role','public']) rolename;

\echo ''
\echo '## 6. family default 6.00 -> 7.50 on Endcap rail'
create temporary table proof_family as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_family','948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','catalog-setup:pricing:endcap-rail','7.50')) as result;
select jsonb_pretty((select result->'proposal' from proof_family)) as proposal;
select type, title, body, persistent, action_url, action_label
  from public.notifications
 where dedupe_key = 'catalog-setup-write:' || (select result->>'action_id' from proof_family);

\echo ''
\echo '## 6b. the payload is the narrow writer argument document, not a family document'
select payload, jsonb_typeof(payload->'variants') as variants_in_document
  from private.agent_catalog_setup_writes
 where id = (select (result->>'change_set_id')::uuid from proof_family);

\echo ''
\echo '## 7. commit as the approving operator'
select jsonb_pretty(pg_temp.commit_write(
  (select result from proof_family), 'approve-catalog-setup-write:pricing-family')) as receipt;

\echo ''
\echo '## 7b. the row that landed, exactly'
select id, name, default_price, default_price::text as stored_text, default_unit_cost
  from public.catalog_items where id='948ac4a0-882f-efe9-3bc4-b6f7c53fb12f';
select (receipt->'readback') = (proposal->'after') as readback_equals_approved_preview,
       receipt->>'kind' as kind, receipt#>>'{item_ref,kind}' as item_kind,
       receipt#>'{effects}' as effects
  from private.agent_catalog_setup_writes
 where id = (select (result->>'change_set_id')::uuid from proof_family);
select writer, idempotency_key, source, response->>'default_price_before' as before,
       response->>'default_price' as after
  from private.agent_catalog_setup_writer_requests;

\echo ''
\echo '## 8. replaying the same commit key returns the stored receipt'
select (pg_temp.commit_write(
  (select result from proof_family), 'approve-catalog-setup-write:pricing-family'))->>'replayed' as replayed;

\echo ''
\echo '## 9. clearing the family default leaves every variant with no price'
create temporary table proof_clear as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_family','948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','catalog-setup:pricing:endcap-clear','clear')) as result;
select jsonb_pretty((select result#>'{proposal,after}' from proof_clear)) as after_side;
select jsonb_pretty((select result#>'{proposal,effects}' from proof_clear)) as effects;
select pg_temp.commit_write((select result from proof_clear), 'approve-catalog-setup-write:pricing-clear')
         ->'readback'->'affected_variants' as readback_variants;
select id, default_price, default_price::text as stored_text
  from public.catalog_items where id='948ac4a0-882f-efe9-3bc4-b6f7c53fb12f';

\echo ''
\echo '## 10. a variant override of 100 on a Line variant, through catalog_setup_save'
create temporary table proof_digest as
select pg_temp.siblings_digest(
  '393c5c83-d9df-2a48-9837-2e04501b34c6','411f89c9-d2a1-44a8-8377-6c11a098f0f7') as before_digest;
create temporary table proof_variant as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant','411f89c9-d2a1-44a8-8377-6c11a098f0f7','catalog-setup:pricing:line-72-black','100')) as result;
select jsonb_pretty((select result->'proposal' from proof_variant)) as proposal;

\echo ''
\echo '## 10b. this payload IS the family complete document, with one field moved'
select jsonb_array_length(payload->'variants') as variants_in_document,
       (select jsonb_agg(jsonb_build_object(
          'id', left(doc.value->>'id', 8),
          'price_override', doc.value->'price_override') order by doc.ordinality)
        from jsonb_array_elements(payload->'variants') with ordinality doc(value, ordinality))
         as prices_in_document
  from private.agent_catalog_setup_writes
 where id = (select (result->>'change_set_id')::uuid from proof_variant);

select jsonb_pretty(pg_temp.commit_write(
  (select result from proof_variant), 'approve-catalog-setup-write:pricing-variant')) as receipt;
select id, price_override, price_override::text as stored_text
  from public.catalog_variants where id='411f89c9-d2a1-44a8-8377-6c11a098f0f7';

\echo ''
\echo '## 10c. every other variant of the family is byte-identical'
select (select before_digest from proof_digest) = pg_temp.siblings_digest(
         '393c5c83-d9df-2a48-9837-2e04501b34c6','411f89c9-d2a1-44a8-8377-6c11a098f0f7'
       ) as siblings_unchanged,
       (select string_agg(price_override::text, ',' order by id)
          from public.catalog_variants
         where catalog_item_id='393c5c83-d9df-2a48-9837-2e04501b34c6' and deleted_at is null
           and id <> '411f89c9-d2a1-44a8-8377-6c11a098f0f7') as sibling_prices_exact;

\echo ''
\echo '## 11. clearing that override leaves the variant with no price at all'
create temporary table proof_variant_clear as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant','411f89c9-d2a1-44a8-8377-6c11a098f0f7','catalog-setup:pricing:line-clear','clear')) as result;
select (result#>'{proposal,before,price}') as before_price,
       (result#>'{proposal,after,price}') as after_price,
       (result#>'{proposal,after,affected_variants}') as after_variants,
       (result#>'{proposal,effects}') as effects
  from proof_variant_clear;
select pg_temp.commit_write((select result from proof_variant_clear), 'approve-catalog-setup-write:pricing-variant-clear')
         ->'readback'->'price' as readback_price;
select id, price_override, price_override::text as stored_text
  from public.catalog_variants where id='411f89c9-d2a1-44a8-8377-6c11a098f0f7';

\echo ''
\echo '## 12. a currency that is not the company currency is refused'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_family','393c5c83-d9df-2a48-9837-2e04501b34c6','catalog-setup:pricing:wrong-currency','9.00','USD')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 13. a request that resolves to the price already on file is refused'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant','44b1f59c-250e-464b-bc52-3e8d7e1e90ae','catalog-setup:pricing:no-change','45')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 14. a family that moved between prepare and commit is refused'
create temporary table proof_stale as
select pg_temp.prepare_write('set_pricing', pg_temp.pricing_request(
  'catalog_variant','44b1f59c-250e-464b-bc52-3e8d7e1e90ae','catalog-setup:pricing:stale','61.25')) as result;
update public.catalog_items set name = name || ' (renamed)'
 where id = '393c5c83-d9df-2a48-9837-2e04501b34c6';
\set ON_ERROR_STOP off
select pg_temp.commit_write((select result from proof_stale), 'approve-catalog-setup-write:pricing-stale') as must_raise;
\set ON_ERROR_STOP on
update public.catalog_items set name = replace(name, ' (renamed)', '')
 where id = '393c5c83-d9df-2a48-9837-2e04501b34c6';
select id, price_override::text as untouched_by_the_refused_commit
  from public.catalog_variants where id='44b1f59c-250e-464b-bc52-3e8d7e1e90ae';

\echo ''
\echo '## 15. an operator without catalog.run_setup cannot prepare a price'
-- The permission the setup wizard route requires, and the permission the
-- supplier-cost row policy names. The narrow writer must not be a way around it.
\set ON_ERROR_STOP off
select private.agent_catalog_setup_compile_set_pricing(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select id from public.users
    where company_id='a612edc0-5c18-4c4d-af97-55b9410dd077'
      and not public.has_permission(id,'catalog.run_setup','all')
      and is_active and deleted_at is null limit 1),
  pg_temp.pricing_request('catalog_family','393c5c83-d9df-2a48-9837-2e04501b34c6','catalog-setup:pricing:denied','9.00')
) as must_raise_or_be_skipped;
\set ON_ERROR_STOP on

\echo ''
\echo '## 16. state at the end of the transaction, before it is thrown away'
select id, name, default_price::text as stored_text from public.catalog_items
 where id in ('948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','393c5c83-d9df-2a48-9837-2e04501b34c6');
select count(*) as proposals, count(*) filter (where committed_at is not null) as committed
  from private.agent_catalog_setup_writes;

rollback;

\echo ''
\echo '## 17. after the rollback: production is untouched and the seal is empty'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regprocedure('private.catalog_family_default_price_save(uuid,uuid,uuid,numeric,text,jsonb)') as writer_after;
select id, name, default_price, default_price::text as stored_text
  from public.catalog_items
 where id in ('948ac4a0-882f-efe9-3bc4-b6f7c53fb12f','393c5c83-d9df-2a48-9837-2e04501b34c6');
select id, price_override::text as stored_text from public.catalog_variants
 where id in ('411f89c9-d2a1-44a8-8377-6c11a098f0f7','44b1f59c-250e-464b-bc52-3e8d7e1e90ae');
select to_regclass('private.agent_catalog_setup_writer_requests') as writer_ledger_after;
