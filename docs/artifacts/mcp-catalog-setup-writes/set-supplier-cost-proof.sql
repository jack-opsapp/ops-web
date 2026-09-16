-- Runnable transcript for docs/artifacts/mcp-catalog-setup-writes/set-supplier-cost-proof.md
--
-- All five migrations are read with their outer begin;/commit; commented out so
-- the whole run is one transaction that ends in rollback. Produce the bodies
-- with:
--
--   for f in 20260915223000_agent_catalog_recipe_read_v24 \
--            20260916010000_agent_catalog_setup_write_variant \
--            20260916020000_agent_catalog_setup_write_thresholds \
--            20260916030000_agent_catalog_setup_write_pricing \
--            20260916040000_agent_catalog_setup_write_supplier_cost; do
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
--     -f docs/artifacts/mcp-catalog-setup-writes/set-supplier-cost-proof.sql
--
-- It writes nothing: the last statement is rollback.
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on
\pset pager off
begin;

\echo ''
\echo '## 0. production state before the migrations'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regprocedure('private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)') as writer_before;
select profile_key, unit_cost::text, currency_code, is_default, deleted_at is not null as deleted
  from public.catalog_supplier_cost_profiles
 where catalog_variant_id = '18234bac-442f-41e8-98e7-956c051fbf21'
 order by is_default desc, profile_key;
select id, unit_cost_override, unit_cost_override::text as stored_text
  from public.catalog_variants where id = '18234bac-442f-41e8-98e7-956c051fbf21';
select count(*) as company_profiles, count(*) filter (where is_default) as defaults
  from public.catalog_supplier_cost_profiles
 where company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077' and deleted_at is null;

\echo ''
\echo '## 0b. catalog_setup_save has no supplier-cost section at all'
select strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
              'catalog_supplier_cost_profiles') as supplier_cost_writes,
       strpos(pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
              'unit_cost_override') as variant_cost_writes;
-- One default per variant is a database fact as well as an OPS rule.
select indexdef from pg_indexes
 where schemaname='public' and indexname='catalog_supplier_cost_profiles_one_default';
-- And it already holds across every live profile in the company.
select count(*) as variants_with_profiles_but_no_default from (
  select catalog_variant_id from public.catalog_supplier_cost_profiles
   where company_id='a612edc0-5c18-4c4d-af97-55b9410dd077' and deleted_at is null
   group by 1 having count(*) filter (where is_default) = 0) offenders;

\echo ''
\echo '## 1. applying the V24 recipe read, the spine, and kinds 2, 3 and 4'
\i :task6_migration
\i :catalog_setup_write_migration
\i :thresholds_migration
\i :pricing_migration
\i :supplier_cost_migration

\echo ''
\echo '## 2. a synthetic V24 client and grant carrying the cost scope (rolled back)'
set search_path = '';
insert into private.agent_read_domain_revisions(company_id, domain, source_revision)
values ('a612edc0-5c18-4c4d-af97-55b9410dd077','catalog',1)
on conflict do nothing;
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision)
values ('44444444-4444-4444-8444-444444444444','Supplier cost write proof',
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

-- A second client and grant WITHOUT ops.catalog_costs.read, for scenario 10.
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision)
values ('66666666-6666-4666-8666-666666666666','Catalogue-only proof',
  array['https://example.invalid/cb'],'none',
  array['authorization_code'],array['code'],
  'ops.catalog.prepare ops.catalog.read','manual',
  array['ops.catalog.prepare','ops.catalog.read'],
  '2026-09-15.mcp-consent-catalog.v18','2026-09-15.mcp-exposure.v24');
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision,
  accepted_labels, consent_catalog_revision, exposure_revision)
values ('77777777-7777-4777-8777-777777777777',
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '66666666-6666-4666-8666-666666666666',
  array['ops.catalog.prepare','ops.catalog.read'], repeat('c',32),
  private.mcp_oauth_labels_for_scopes(
    array['ops.catalog.prepare','ops.catalog.read'],'2026-09-15.mcp-consent-catalog.v18'),
  '2026-09-15.mcp-consent-catalog.v18','2026-09-15.mcp-exposure.v24');

create or replace function pg_temp.prepare_write(p_kind text, p_request jsonb, p_grant uuid default '55555555-5555-4555-8555-555555555555')
returns jsonb language plpgsql as $f$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_company uuid := 'a612edc0-5c18-4c4d-af97-55b9410dd077';
  v_keys text[] := array['agent.review','catalog.manage','catalog.products.view','catalog.run_setup','catalog.stock.adjust','catalog.view','finances.view'];
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

create or replace function pg_temp.cost_request(
  p_variant uuid, p_key text, p_profile_key text, p_label text, p_amount text,
  p_is_default boolean default false,
  p_currency text default 'CAD',
  p_activation jsonb default null,
  p_source jsonb default null,
  p_evidence text default 'Rails Direct quoted this rate on the 2026 card.'
) returns jsonb language sql as $f$
  select jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id',p_variant),
    'profile_key', p_profile_key,
    'label', p_label,
    'unit_cost', jsonb_build_object('amount', p_amount, 'currency', p_currency),
    'is_default', p_is_default,
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text',p_evidence)),
    'idempotency_key', p_key)
  || case when p_activation is null then '{}'::jsonb else jsonb_build_object('activation_rule', p_activation) end
  || case when p_source is null then '{}'::jsonb else jsonb_build_object('source', p_source) end
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

-- A hash of every OTHER variant of the family and of every OTHER variant's
-- profiles, to prove the write is surgical.
create or replace function pg_temp.siblings_digest(p_family uuid, p_target uuid)
returns text language sql as $f$
  select md5(coalesce(string_agg(row_text, '|' order by row_text), ''))
  from (
    select v.id::text || ':' || coalesce(v.price_override::text,'') || ':'
        || coalesce(v.unit_cost_override::text,'') || ':' || v.is_active::text || ':'
        || coalesce((select string_agg(p.profile_key || '=' || p.unit_cost::text
                                       || case when p.is_default then '*' else '' end, ',' order by p.profile_key)
                     from public.catalog_supplier_cost_profiles p
                     where p.catalog_variant_id = v.id and p.deleted_at is null),'') as row_text
    from public.catalog_variants v
    where v.catalog_item_id = p_family and v.deleted_at is null and v.id <> p_target
  ) rows
$f$;

select set_config('request.jwt.claim.role','service_role',true);

\echo ''
\echo '## 3. the seal is absent: every prepare refuses (decision W10)'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:activation',
  'rails-direct-2026','Rails Direct 2026 rate card','18.25')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 4. an operator seals the reviewed effects (this migration seeds nothing)'
insert into private.agent_catalog_effect_policy(revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());
select revision, left(effect_sha256, 18) || '...' as effect_sha256
  from private.agent_catalog_effect_policy;

\echo ''
\echo '## 5. no app role can execute the narrow writer'
select rolename,
       has_function_privilege(rolename,
         'private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)'::regprocedure,
         'execute') as can_execute_writer
  from unnest(array['anon','authenticated','service_role','public']) rolename;

\echo ''
\echo '## 5b. the sibling digest before anything is written'
create temporary table proof_digest as
select pg_temp.siblings_digest(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44','18234bac-442f-41e8-98e7-956c051fbf21') as before_digest;
select * from proof_digest;

\echo ''
\echo '## 5c. how much of this catalogue carries text OPS will not render'
select count(*) as live_profiles,
       count(*) filter (where not private.agent_prompt_text_is_safe(label, true)) as unreadable_label,
       count(*) filter (where not private.agent_prompt_text_is_safe(source::text, true)) as unreadable_source
  from public.catalog_supplier_cost_profiles
 where company_id='a612edc0-5c18-4c4d-af97-55b9410dd077' and deleted_at is null;
select profile_key, label from public.catalog_supplier_cost_profiles
 where catalog_variant_id='18234bac-442f-41e8-98e7-956c051fbf21' and deleted_at is null
 order by profile_key;

\echo ''
\echo '## 6. (1) add a new profile that is NOT the default'
create temporary table proof_add as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:rails-direct-add',
  'rails-direct-2026','Rails Direct 2026 rate card','18.25', false, 'CAD',
  jsonb_build_object('order_tag','STANDARD'),
  jsonb_build_object('document','Rails_Direct_2026.pdf','quoted_by','Jared'))) as result;
select jsonb_pretty((select result->'proposal' from proof_add)) as proposal;
select type, title, body, persistent, action_label
  from public.notifications
 where dedupe_key = 'catalog-setup-write:' || (select result->>'action_id' from proof_add);
select jsonb_pretty(pg_temp.commit_write((select result from proof_add),
  'approve-catalog-setup-write:cost-add')->'readback') as receipt_readback;
select profile_key, unit_cost::text, is_default, activation_rule, source
  from public.catalog_supplier_cost_profiles
 where catalog_variant_id='18234bac-442f-41e8-98e7-956c051fbf21' and deleted_at is null
 order by is_default desc, profile_key;
select unit_cost_override::text as variant_cost_unmoved
  from public.catalog_variants where id='18234bac-442f-41e8-98e7-956c051fbf21';

\echo ''
\echo '## 7. (2) promote it: the old default is demoted and the variant cost mirrors'
create temporary table proof_promote as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:rails-direct-promote',
  'rails-direct-2026','Rails Direct 2026 rate card','18.25', true, 'CAD',
  jsonb_build_object('order_tag','STANDARD'),
  jsonb_build_object('document','Rails_Direct_2026.pdf','quoted_by','Jared'))) as result;
select (result#>'{proposal,before,variant_unit_cost}') as cost_before,
       (result#>'{proposal,after,variant_unit_cost}') as cost_after,
       (result#>'{proposal,effects}') as effects
  from proof_promote;
select jsonb_pretty((select jsonb_agg(jsonb_build_object(
         'key', row_doc.value->>'profile_key',
         'cost', row_doc.value->>'unit_cost',
         'default', row_doc.value->'is_default',
         'state', row_doc.value->>'state'))
       from jsonb_array_elements((select result#>'{proposal,after,profiles}' from proof_promote))
         row_doc(value))) as after_sheet;
select pg_temp.commit_write((select result from proof_promote), 'approve-catalog-setup-write:cost-promote')
         ->>'kind' as committed_kind;
select profile_key, unit_cost::text, is_default from public.catalog_supplier_cost_profiles
 where catalog_variant_id='18234bac-442f-41e8-98e7-956c051fbf21' and deleted_at is null
 order by is_default desc, profile_key;
select unit_cost_override::text as variant_cost_mirrored
  from public.catalog_variants where id='18234bac-442f-41e8-98e7-956c051fbf21';
select (select before_digest from proof_digest) = pg_temp.siblings_digest(
         '9b30f44d-47da-4134-872d-7f9c2d6f1b44','18234bac-442f-41e8-98e7-956c051fbf21'
       ) as other_variants_unchanged;

\echo ''
\echo '## 8. (3) update the default cost: the mirror moves with it'
create temporary table proof_update as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:rails-direct-reprice',
  'rails-direct-2026','Rails Direct 2026 rate card','19.40', true, 'CAD',
  jsonb_build_object('order_tag','STANDARD'),
  jsonb_build_object('document','Rails_Direct_2026.pdf','quoted_by','Jared'))) as result;
select (result#>'{proposal,before,variant_unit_cost}') as cost_before,
       (result#>'{proposal,after,variant_unit_cost}') as cost_after,
       (result#>'{proposal,effects}') as effects
  from proof_update;
select pg_temp.commit_write((select result from proof_update), 'approve-catalog-setup-write:cost-reprice')
         ->'readback'->>'variant_unit_cost' as readback_variant_cost;
select unit_cost_override::text as variant_cost_mirrored
  from public.catalog_variants where id='18234bac-442f-41e8-98e7-956c051fbf21';

\echo ''
\echo '## 9. (4) un-defaulting the variant''s only default is refused'
-- This variant carries two profiles and rails-direct-2023 is the default. Taking
-- the default off it would leave two profiles and no default at all.
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '7df24492-2c7a-4f01-bdab-c32442a3d640','catalog-setup:cost:undefault-single',
  'rails-direct-2023','Rails Direct 2023','2.50', false)) as must_raise;
\set ON_ERROR_STOP on
select profile_key, is_default from public.catalog_supplier_cost_profiles
 where catalog_variant_id='7df24492-2c7a-4f01-bdab-c32442a3d640' and deleted_at is null
 order by is_default desc, profile_key;

\echo ''
\echo '## 10. (5) a soft-deleted profile written again comes back as revived'
update public.catalog_supplier_cost_profiles set deleted_at = clock_timestamp()
 where catalog_variant_id='18234bac-442f-41e8-98e7-956c051fbf21'
   and profile_key='deksmart-condo';
create temporary table proof_revive as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:condo-revive',
  'deksmart-condo','Deksmart condo rate','15.72', false)) as result;
select (select jsonb_agg(jsonb_build_object('key', row_doc.value->>'profile_key',
                                            'state', row_doc.value->>'state'))
        from jsonb_array_elements(result#>'{proposal,after,profiles}') row_doc(value)) as states,
       (result#>'{proposal,effects,profiles_revived}') as profiles_revived,
       (result#>'{proposal,effects,profiles_created}') as profiles_created
  from proof_revive;
select pg_temp.commit_write((select result from proof_revive), 'approve-catalog-setup-write:cost-revive')
         ->>'kind' as committed_kind;
select profile_key, unit_cost::text, is_default, deleted_at is not null as deleted
  from public.catalog_supplier_cost_profiles
 where catalog_variant_id='18234bac-442f-41e8-98e7-956c051fbf21'
 order by is_default desc, profile_key;

\echo ''
\echo '## 11. (6) an activation rule with a $-prefixed key is refused'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:dollar-key',
  'fastenal-2026','Fastenal 2026','1.00', false,'CAD',
  jsonb_build_object('$gt', 1))) as must_raise;
\echo '## 11b. and so is a caller-authored `ops` provenance key'
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:forged-ops',
  'fastenal-2026','Fastenal 2026','1.00', false,'CAD', null,
  jsonb_build_object('ops', jsonb_build_object('recorded_by','not-the-server')))) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 12. (7) a currency that is not the company currency is refused'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:wrong-currency',
  'fastenal-2026','Fastenal 2026','1.00', false,'USD')) as must_raise;
\echo '## 13. (8) a request that resolves to the row already on file is refused'
-- Byte for byte the request section 10 committed, including its label and its
-- empty rule and source.
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:no-change',
  'deksmart-condo','Deksmart condo rate','15.72', false)) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 14. (9) a variant whose SKU moved between prepare and commit is refused'
create temporary table proof_stale as
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:stale',
  'fastenal-2026','Fastenal 2026','1.25', false)) as result;
update public.catalog_variants set sku = 'MOVED-UNDERNEATH'
 where id = '18234bac-442f-41e8-98e7-956c051fbf21';
\set ON_ERROR_STOP off
select pg_temp.commit_write((select result from proof_stale), 'approve-catalog-setup-write:cost-stale') as must_raise;
\set ON_ERROR_STOP on
update public.catalog_variants set sku = null where id = '18234bac-442f-41e8-98e7-956c051fbf21';
select count(*) as fastenal_rows_not_written from public.catalog_supplier_cost_profiles
 where catalog_variant_id='18234bac-442f-41e8-98e7-956c051fbf21' and profile_key='fastenal-2026';

\echo ''
\echo '## 15. (10) a grant without ops.catalog_costs.read is refused'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_supplier_cost', pg_temp.cost_request(
  '18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:no-cost-scope',
  'fastenal-2026','Fastenal 2026','1.25', false),
  '77777777-7777-4777-8777-777777777777') as must_raise;
\echo '## 15b. and so is an operator without finances.view'
select private.agent_catalog_setup_compile_set_supplier_cost(
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select id from public.users
    where company_id='a612edc0-5c18-4c4d-af97-55b9410dd077'
      and not public.has_permission(id,'finances.view','all')
      and is_active and deleted_at is null limit 1),
  pg_temp.cost_request('18234bac-442f-41e8-98e7-956c051fbf21','catalog-setup:cost:no-finance',
    'fastenal-2026','Fastenal 2026','1.25', false)) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 16. state at the end of the transaction, before it is thrown away'
select profile_key, unit_cost::text, is_default from public.catalog_supplier_cost_profiles
 where catalog_variant_id='18234bac-442f-41e8-98e7-956c051fbf21' and deleted_at is null
 order by is_default desc, profile_key;
select count(*) as proposals, count(*) filter (where committed_at is not null) as committed
  from private.agent_catalog_setup_writes;
select writer, count(*) from private.agent_catalog_setup_writer_requests group by 1;

rollback;

\echo ''
\echo '## 17. after the rollback: production is untouched and the seal is empty'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regprocedure('private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)') as writer_after;
select profile_key, unit_cost::text, is_default, deleted_at is not null as deleted
  from public.catalog_supplier_cost_profiles
 where catalog_variant_id = '18234bac-442f-41e8-98e7-956c051fbf21'
 order by is_default desc, profile_key;
select id, unit_cost_override::text as stored_text, sku
  from public.catalog_variants where id = '18234bac-442f-41e8-98e7-956c051fbf21';
select count(*) as company_profiles, count(*) filter (where is_default) as defaults
  from public.catalog_supplier_cost_profiles
 where company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077' and deleted_at is null;
