-- Runnable transcript for docs/artifacts/mcp-catalog-setup-writes/set-thresholds-proof.md
--
-- All three migrations are read with their outer begin;/commit; commented out so
-- the whole run is one transaction that ends in rollback. Produce the bodies with:
--
--   for f in 20260915223000_agent_catalog_recipe_read_v24 \
--            20260916010000_agent_catalog_setup_write_variant \
--            20260916020000_agent_catalog_setup_write_thresholds; do
--     sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
--       supabase/migrations/$f.sql > /tmp/m_$f.sql
--   done
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
--     -v task6_migration=/tmp/m_20260915223000_agent_catalog_recipe_read_v24.sql \
--     -v catalog_setup_write_migration=/tmp/m_20260916010000_agent_catalog_setup_write_variant.sql \
--     -v thresholds_migration=/tmp/m_20260916020000_agent_catalog_setup_write_thresholds.sql \
--     -f docs/artifacts/mcp-catalog-setup-writes/set-thresholds-proof.sql
--
-- It writes nothing: the last statement is rollback.
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on
\pset pager off
begin;

\echo ''
\echo '## 0. production state before the migrations'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regprocedure('private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb)') as compile_before;
select id, warning_threshold, critical_threshold, sku
  from public.catalog_variants where id='411f89c9-d2a1-44a8-8377-6c11a098f0f7';
select default_warning_threshold, default_critical_threshold
  from public.catalog_items where id='393c5c83-d9df-2a48-9837-2e04501b34c6';

\echo ''
\echo '## 1. applying the V24 recipe read, the write spine, then this kind'
\i :task6_migration
\i :catalog_setup_write_migration
\i :thresholds_migration

\echo ''
\echo '## 2. a synthetic V24 client, grant and reviewed effect seal (rolled back)'
set search_path = '';
insert into private.agent_read_domain_revisions(company_id, domain, source_revision)
values ('a612edc0-5c18-4c4d-af97-55b9410dd077','catalog',1)
on conflict do nothing;
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision)
values ('44444444-4444-4444-8444-444444444444','Threshold write proof',
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
  v_keys text[] := array['agent.review','catalog.manage','catalog.products.view','catalog.stock.adjust','catalog.view'];
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

-- The tool's request shape. jsonb_strip_nulls would delete an explicit null, so
-- the clear is spelled with a sentinel that becomes a real JSON null.
create or replace function pg_temp.threshold_request(
  p_variant uuid, p_key text, p_warning text default null, p_critical text default null,
  p_evidence text default 'Jackson wants this line warning at 24 and critical at 6.'
) returns jsonb language sql as $f$
  select jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id',p_variant),
    'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text',p_evidence)),
    'idempotency_key', p_key)
  || case when p_warning is null then '{}'::jsonb
          else jsonb_build_object('warning_threshold',
                 case when p_warning = 'clear' then 'null'::jsonb else to_jsonb(p_warning::integer) end) end
  || case when p_critical is null then '{}'::jsonb
          else jsonb_build_object('critical_threshold',
                 case when p_critical = 'clear' then 'null'::jsonb else to_jsonb(p_critical::integer) end) end
$f$;

-- A hash of every OTHER variant of the family, to prove the write is surgical.
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

select set_config('request.jwt.claim.role','service_role',true);

\echo ''
\echo '## 3. the seal is absent: every prepare refuses (decision W10)'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_thresholds', pg_temp.threshold_request(
  '411f89c9-d2a1-44a8-8377-6c11a098f0f7','catalog-setup:thresholds:activation','24','6')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 4. an operator seals the reviewed effects (this migration seeds nothing)'
insert into private.agent_catalog_effect_policy(revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());
select revision, left(effect_sha256, 18) || '...' as effect_sha256
  from private.agent_catalog_effect_policy;

\echo ''
\echo '## 5. the sibling digest before anything is written'
create temporary table proof_digest as
select pg_temp.siblings_digest(
  '393c5c83-d9df-2a48-9837-2e04501b34c6','411f89c9-d2a1-44a8-8377-6c11a098f0f7') as before_digest;
select * from proof_digest;

\echo ''
\echo '## 6. prepare warning 24 / critical 6 on a Line variant that has neither'
create temporary table proof_prepare as
select pg_temp.prepare_write('set_thresholds', pg_temp.threshold_request(
  '411f89c9-d2a1-44a8-8377-6c11a098f0f7','catalog-setup:thresholds:line-72-black-tm','24','6')) as result;
select jsonb_pretty((select result from proof_prepare) - 'proposal' - 'prompt_safety') as prepare_envelope;
select jsonb_pretty((select result->'proposal' from proof_prepare)) as proposal;
select action_type, status, context_source, source_id, priority,
       action_data->>'preview_sha256' = (select result->>'preview_sha256' from proof_prepare) as seal_matches
  from public.agent_actions
 where id = (select (result->>'action_id')::uuid from proof_prepare);
select type, title, body, persistent, action_url, action_label
  from public.notifications
 where dedupe_key = 'catalog-setup-write:' || (select result->>'action_id' from proof_prepare);

\echo ''
\echo '## 6b. the payload is the family COMPLETE document with two fields moved'
select jsonb_array_length(payload->'variants') as variants_in_document,
       jsonb_array_length(payload->'stock_units') as stock_units,
       jsonb_array_length(payload->'stock_unit_events') as stock_events,
       payload ? 'family' as names_the_family,
       (select jsonb_agg(jsonb_build_object(
          'id', left(doc.value->>'id', 8),
          'warning', doc.value->'warning_threshold',
          'critical', doc.value->'critical_threshold') order by doc.ordinality)
        from jsonb_array_elements(payload->'variants') with ordinality doc(value, ordinality)) as thresholds_in_document
  from private.agent_catalog_setup_writes;

\echo ''
\echo '## 7. commit as the approving operator'
select jsonb_pretty(public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_prepare),
  (select (result->>'change_set_id')::uuid from proof_prepare),
  (select result->>'preview_sha256' from proof_prepare),
  'approve-catalog-setup-write:thresholds')) as receipt;

\echo ''
\echo '## 7b. the row that landed, and the read-back against the approved preview'
select id, warning_threshold, critical_threshold, quantity, price_override, sku, is_active
  from public.catalog_variants where id='411f89c9-d2a1-44a8-8377-6c11a098f0f7';
select (receipt->'readback') = (proposal->'after') as readback_equals_approved_preview,
       receipt->>'kind' as kind, receipt#>>'{variant_ref,id}' as variant_ref,
       status, executed_at is not null as action_executed
  from private.agent_catalog_setup_writes
  join public.agent_actions on agent_actions.id = agent_catalog_setup_writes.action_id;

\echo ''
\echo '## 7c. every other variant of the family is byte-identical'
select (select before_digest from proof_digest) = pg_temp.siblings_digest(
         '393c5c83-d9df-2a48-9837-2e04501b34c6','411f89c9-d2a1-44a8-8377-6c11a098f0f7'
       ) as siblings_unchanged,
       count(*) as line_variants,
       count(*) filter (where warning_threshold is not null) as with_warning
  from public.catalog_variants
 where catalog_item_id='393c5c83-d9df-2a48-9837-2e04501b34c6' and deleted_at is null;

\echo ''
\echo '## 8. replaying the same commit key returns the stored receipt'
select (public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_prepare),
  (select (result->>'change_set_id')::uuid from proof_prepare),
  (select result->>'preview_sha256' from proof_prepare),
  'approve-catalog-setup-write:thresholds'))->>'replayed' as replayed;

\echo ''
\echo '## 9. a critical above the warning already in force is refused'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_thresholds', pg_temp.threshold_request(
  '411f89c9-d2a1-44a8-8377-6c11a098f0f7','catalog-setup:thresholds:critical-too-high',null,'30')) as must_raise;

\echo ''
\echo '## 10. the levels already in force are not a change'
select pg_temp.prepare_write('set_thresholds', pg_temp.threshold_request(
  '411f89c9-d2a1-44a8-8377-6c11a098f0f7','catalog-setup:thresholds:no-change','24','6')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 11. clearing a level falls back to the family default, loudly'
update public.catalog_items set default_warning_threshold = 10
 where id='393c5c83-d9df-2a48-9837-2e04501b34c6';
create temporary table proof_clear as
select pg_temp.prepare_write('set_thresholds', pg_temp.threshold_request(
  '411f89c9-d2a1-44a8-8377-6c11a098f0f7','catalog-setup:thresholds:clear-warning','clear',null,
  'Jackson wants this variant back on the family default.')) as result;
select jsonb_pretty((select result#>'{proposal,before}' from proof_clear)) as before_levels;
select jsonb_pretty((select result#>'{proposal,after}' from proof_clear)) as after_levels;
select (select result#>'{proposal,effects}' from proof_clear) as effects;
select jsonb_pretty(public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_clear),
  (select (result->>'change_set_id')::uuid from proof_clear),
  (select result->>'preview_sha256' from proof_clear),
  'approve-catalog-setup-write:clear')->'readback') as cleared_readback;
select warning_threshold, critical_threshold from public.catalog_variants
 where id='411f89c9-d2a1-44a8-8377-6c11a098f0f7';
update public.catalog_items set default_warning_threshold = null
 where id='393c5c83-d9df-2a48-9837-2e04501b34c6';

\echo ''
\echo '## 12. a family that moved between prepare and commit refuses the commit'
create temporary table proof_stale as
select pg_temp.prepare_write('set_thresholds', pg_temp.threshold_request(
  'b24375a8-1c15-41a9-89a8-613f0c138141','catalog-setup:thresholds:stale','16','4')) as result;
update public.catalog_variants set sku='LINE-WH-TM-42'
 where id='b24375a8-1c15-41a9-89a8-613f0c138141';
\set ON_ERROR_STOP off
select public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_stale),
  (select (result->>'change_set_id')::uuid from proof_stale),
  (select result->>'preview_sha256' from proof_stale),
  'approve-catalog-setup-write:stale') as must_raise;
\set ON_ERROR_STOP on
update public.catalog_variants set sku=null
 where id='b24375a8-1c15-41a9-89a8-613f0c138141';

\echo ''
\echo '## 13. a variant that is not this company''s is not found'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('set_thresholds', pg_temp.threshold_request(
  '00000000-0000-4000-8000-000000000001','catalog-setup:thresholds:foreign','24','6')) as must_raise;

\echo ''
\echo '## 14. a request that names no threshold at all is refused'
select pg_temp.prepare_write('set_thresholds', jsonb_build_object(
  'variant_ref', jsonb_build_object('kind','catalog_variant','id','411f89c9-d2a1-44a8-8377-6c11a098f0f7'),
  'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Nothing named.')),
  'idempotency_key','catalog-setup:thresholds:empty')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 15. installing the kind moved the effect revision on purpose'
select (select effect_sha256 from private.agent_catalog_effect_policy
         where revision='2026-09-15.catalog-setup-write.v1')
       = private.agent_catalog_setup_write_effect_revision() as seal_still_matches,
       pg_get_functiondef('private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb)'::regprocedure)
         like '%agent_catalog_setup_compile_set_thresholds%' as compile_names_the_kind;

\echo ''
\echo '## 16. the create_variant kind still works through the shared commit'
create temporary table proof_variant as
select pg_temp.prepare_write('create_variant', jsonb_build_object(
  'family_ref', jsonb_build_object('kind','catalog_family','id','9b30f44d-47da-4134-872d-7f9c2d6f1b44'),
  'option_values', jsonb_build_array(
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','247c1452-41db-485e-9463-6cc7059c3bb5')),
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','eac1b169-30dd-4d58-8480-14f97b670654'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','a0a25675-71dc-4c45-b01f-99c4a3409f0b'))),
  'price_override', jsonb_build_object('amount','45.0000','currency','CAD'),
  'evidence', jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Boardwalk 60mil Smooth at 45.00.')),
  'idempotency_key','catalog-setup:thresholds:regression')) as result;
select (result#>>'{proposal,operation}') as operation, result->>'kind' as kind
  from proof_variant;
select (public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_variant),
  (select (result->>'change_set_id')::uuid from proof_variant),
  (select result->>'preview_sha256' from proof_variant),
  'approve-catalog-setup-write:regression')) -> 'variant_ref' as created_variant_ref;

select set_config('request.jwt.claim.role','',true);
rollback;

\echo ''
\echo '## 17. after rollback production is untouched'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regprocedure('private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb)') as compile_after;
select id, warning_threshold, critical_threshold, sku
  from public.catalog_variants where id='411f89c9-d2a1-44a8-8377-6c11a098f0f7';
select default_warning_threshold from public.catalog_items
 where id='393c5c83-d9df-2a48-9837-2e04501b34c6';
select sku from public.catalog_variants where id='b24375a8-1c15-41a9-89a8-613f0c138141';
