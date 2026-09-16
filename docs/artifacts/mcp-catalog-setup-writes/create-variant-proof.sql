-- Runnable transcript for docs/artifacts/mcp-catalog-setup-writes/create-variant-proof.md
--
-- Both migrations are read with their outer begin;/commit; commented out so the
-- whole run is one transaction that ends in rollback. Produce the bodies with:
--
--   sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
--     supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql > /tmp/t6.sql
--   sed -e 's/^begin;$/-- begin/' -e 's/^commit;$/-- commit/' \
--     supabase/migrations/20260916010000_agent_catalog_setup_write_variant.sql > /tmp/csw.sql
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=postgres" \
--     -v task6_migration=/tmp/t6.sql -v catalog_setup_write_migration=/tmp/csw.sql \
--     -f docs/artifacts/mcp-catalog-setup-writes/create-variant-proof.sql
--
-- It writes nothing: the last statement is rollback.
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on
\pset pager off
begin;

\echo ''
\echo '## 0. production state before the migrations'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regclass('private.agent_catalog_setup_writes') as proposal_table_before;
select count(*) as vinyl_variants from public.catalog_variants
 where catalog_item_id='9b30f44d-47da-4134-872d-7f9c2d6f1b44' and deleted_at is null;

\echo ''
\echo '## 1. applying the V24 recipe read (task 6) then the catalogue setup writes'
\i :task6_migration
\i :catalog_setup_write_migration

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
values ('44444444-4444-4444-8444-444444444444','Catalogue setup write proof',
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

-- A V23 grant, for the refusal in section 10.
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision)
values ('33333333-3333-4333-8333-333333333333','V23 refusal proof',
  array['https://example.invalid/cb'],'none',
  array['authorization_code'],array['code'],
  'ops.catalog.read','manual',
  array['ops.catalog.read'],'2026-09-04.mcp-consent-catalog.v9','2026-09-10.mcp-exposure.v23');
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision,
  accepted_labels, consent_catalog_revision, exposure_revision)
values ('22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '33333333-3333-4333-8333-333333333333',
  array['ops.catalog.read'], repeat('a',32),
  private.mcp_oauth_labels_for_scopes(array['ops.catalog.read'],'2026-09-04.mcp-consent-catalog.v9'),
  '2026-09-04.mcp-consent-catalog.v9','2026-09-10.mcp-exposure.v23');

select private.mcp_oauth_labels_for_scopes(
  array['ops.catalog.prepare','ops.catalog.read'],'2026-09-15.mcp-consent-catalog.v18'
) as v18_labels;

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

create or replace function pg_temp.request(
  p_family uuid, p_values jsonb, p_key text, p_price text default null,
  p_warning integer default null, p_critical integer default null,
  p_quantity text default null, p_sku text default null
) returns jsonb language sql as $f$
  select jsonb_strip_nulls(jsonb_build_object(
    'family_ref', jsonb_build_object('kind','catalog_family','id',p_family),
    'option_values', p_values,
    'sku', p_sku,
    'price_override', case when p_price is null then null
      else jsonb_build_object('amount',p_price,'currency','CAD') end,
    'warning_threshold', p_warning,
    'critical_threshold', p_critical,
    'opening_quantity', case when p_quantity is null then null
      else jsonb_build_object('quantity',p_quantity,'note','Opening count from the 2026 cost sheet') end,
    'evidence', jsonb_build_array(jsonb_build_object(
      'kind','operator_statement',
      'text','Jackson confirmed Boardwalk 60mil Smooth ships at 45.00 with 12 on hand.')),
    'idempotency_key', p_key))
$f$;

select set_config('request.jwt.claim.role','service_role',true);

\echo ''
\echo '## 3. the seal is absent: every prepare refuses (decision W10)'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('create_variant', pg_temp.request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44',
  jsonb_build_array(
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','247c1452-41db-485e-9463-6cc7059c3bb5')),
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','eac1b169-30dd-4d58-8480-14f97b670654'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','a0a25675-71dc-4c45-b01f-99c4a3409f0b'))),
  'catalog-setup:proof:activation', '45.0000', 30, 12, '12')) as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 4. an operator seals the reviewed effects (this migration seeds nothing)'
insert into private.agent_catalog_effect_policy(revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());
select revision, left(effect_sha256, 18) || '...' as effect_sha256
  from private.agent_catalog_effect_policy;

\echo ''
\echo '## 5. prepare a new Vinyl variant: Boardwalk / 60mil Smooth, $45.00, 12 on hand'
create temporary table proof_prepare as
select pg_temp.prepare_write('create_variant', pg_temp.request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44',
  jsonb_build_array(
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','247c1452-41db-485e-9463-6cc7059c3bb5')),
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','eac1b169-30dd-4d58-8480-14f97b670654'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','a0a25675-71dc-4c45-b01f-99c4a3409f0b'))),
  'catalog-setup:proof:boardwalk-smooth', '45.0000', 30, 12, '12')) as result;
select jsonb_pretty(
  (select result from proof_prepare) - 'proposal' - 'prompt_safety') as prepare_envelope;
select jsonb_pretty((select result->'proposal' from proof_prepare)) as proposal;
select action_type, status, context_source, source_id, priority,
       action_data->>'preview_sha256' = (select result->>'preview_sha256' from proof_prepare) as seal_matches
  from public.agent_actions
 where id = (select (result->>'action_id')::uuid from proof_prepare);
select type, title, body, persistent, action_url, action_label
  from public.notifications
 where dedupe_key = 'catalog-setup-write:' || (select result->>'action_id' from proof_prepare);

\echo ''
\echo '## 5b. the payload is the family COMPLETE current document plus one variant'
select jsonb_array_length(payload->'catalog_options') as options,
       jsonb_array_length(payload->'variants') as variants_in_document,
       jsonb_array_length(payload->'stock_units') as stock_units,
       jsonb_array_length(payload->'stock_unit_events') as stock_events,
       payload->'variants'->-1->>'client_id' as new_variant_client_id,
       payload->'stock_unit_events'->0->>'event_type' as opening_event_type,
       payload->'variants'->-1 ? 'quantity' as mirrors_quantity
  from private.agent_catalog_setup_writes;

\echo ''
\echo '## 6. commit as the approving operator'
select jsonb_pretty(public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_prepare),
  (select (result->>'change_set_id')::uuid from proof_prepare),
  (select result->>'preview_sha256' from proof_prepare),
  'approve-catalog-setup-write:proof')) as receipt;

\echo ''
\echo '## 6b. the row that landed, its option values, its stock unit and its event'
select v.id, v.sku, v.quantity, v.price_override, v.unit_cost_override,
       v.warning_threshold, v.critical_threshold, v.is_active,
       (select string_agg(ov.value, ' / ' order by o.sort_order)
          from public.catalog_variant_option_values j
          join public.catalog_option_values ov on ov.id = j.option_value_id
          join public.catalog_options o on o.id = ov.option_id
         where j.variant_id = v.id and j.deleted_at is null) as option_values
  from public.catalog_variants v
 where v.id = (select (receipt#>>'{variant_ref,id}')::uuid from private.agent_catalog_setup_writes);
select u.unit_kind, u.status, u.quantity_value, u.notes
  from public.catalog_stock_units u
 where u.catalog_variant_id = (select (receipt#>>'{variant_ref,id}')::uuid from private.agent_catalog_setup_writes);
select e.event_type, e.to_status, e.quantity_delta, e.payload->>'source' as source,
       e.created_by = '11111111-1111-4111-8111-111111111111' as attributed_to_operator
  from public.catalog_stock_unit_events e
 where e.catalog_variant_id = (select (receipt#>>'{variant_ref,id}')::uuid from private.agent_catalog_setup_writes);
select (receipt->'readback') = (proposal#>'{after,variant}') as readback_equals_approved_preview,
       status, executed_at is not null as action_executed
  from private.agent_catalog_setup_writes
  join public.agent_actions on agent_actions.id = agent_catalog_setup_writes.action_id;

\echo ''
\echo '## 6c. no other Vinyl variant was disturbed'
select count(*) as vinyl_variants,
       count(*) filter (where unit_cost_override is not null) as unit_costs_preserved,
       count(*) filter (where quantity <> 0) as non_zero_quantities
  from public.catalog_variants
 where catalog_item_id='9b30f44d-47da-4134-872d-7f9c2d6f1b44' and deleted_at is null;

\echo ''
\echo '## 7. replaying the same commit key returns the same receipt'
select (public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_prepare),
  (select (result->>'change_set_id')::uuid from proof_prepare),
  (select result->>'preview_sha256' from proof_prepare),
  'approve-catalog-setup-write:proof'))->>'replayed' as replayed;

\echo ''
\echo '## 8. a stale family pre-image refuses the commit'
create temporary table proof_stale as
select pg_temp.prepare_write('create_variant', pg_temp.request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44',
  jsonb_build_array(
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','1b20e080-f747-4393-be0a-fc83500586da')),
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','eac1b169-30dd-4d58-8480-14f97b670654'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','a0a25675-71dc-4c45-b01f-99c4a3409f0b'))),
  'catalog-setup:proof:driftwood-smooth', '45.0000')) as result;
update public.catalog_option_values set value='Driftwood II'
 where id='1b20e080-f747-4393-be0a-fc83500586da';
\set ON_ERROR_STOP off
select public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_stale),
  (select (result->>'change_set_id')::uuid from proof_stale),
  (select result->>'preview_sha256' from proof_stale),
  'approve-catalog-setup-write:stale') as must_raise;
\set ON_ERROR_STOP on
update public.catalog_option_values set value='Driftwood'
 where id='1b20e080-f747-4393-be0a-fc83500586da';

\echo ''
\echo '## 9. a value set that already exists is refused'
\set ON_ERROR_STOP off
select pg_temp.prepare_write('create_variant', pg_temp.request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44',
  jsonb_build_array(
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','3f41029a-19b7-42ff-b92e-11c386e50836')),
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','eac1b169-30dd-4d58-8480-14f97b670654'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','a0a25675-71dc-4c45-b01f-99c4a3409f0b'))),
  'catalog-setup:proof:duplicate', '45.0000')) as must_raise;

\echo ''
\echo '## 10. a family with no default_price and no price_override is refused'
select pg_temp.prepare_write('create_variant', pg_temp.request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44',
  jsonb_build_array(
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','9fe060f6-4c9f-4945-afa2-ea2447c29fd1')),
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','eac1b169-30dd-4d58-8480-14f97b670654'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','a0a25675-71dc-4c45-b01f-99c4a3409f0b'))),
  'catalog-setup:proof:priceless')) as must_raise;

\echo ''
\echo '## 11. an incomplete option set is refused (design note 3)'
select pg_temp.prepare_write('create_variant', pg_temp.request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44',
  jsonb_build_array(
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','9fe060f6-4c9f-4945-afa2-ea2447c29fd1'))),
  'catalog-setup:proof:partial', '45.0000')) as must_raise;

\echo ''
\echo '## 12. a V23 grant can never prepare a catalogue write'
select pg_temp.prepare_write('create_variant', pg_temp.request(
  '9b30f44d-47da-4134-872d-7f9c2d6f1b44',
  jsonb_build_array(
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','9fe060f6-4c9f-4945-afa2-ea2447c29fd1')),
    jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','eac1b169-30dd-4d58-8480-14f97b670654'),
                       'value_ref', jsonb_build_object('kind','catalog_option_value','id','a0a25675-71dc-4c45-b01f-99c4a3409f0b'))),
  'catalog-setup:proof:v23refusal', '45.0000', null, null, null, null),
  '22222222-2222-4222-8222-222222222222') as must_raise;
\set ON_ERROR_STOP on

\echo ''
\echo '## 13. a rejected proposal leaves the catalogue unchanged'
select jsonb_pretty(public.reject_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from proof_stale),
  'Wrong colour.')) as rejection;
select status, review_notes from public.agent_actions
 where id = (select (result->>'action_id')::uuid from proof_stale);

\echo ''
\echo '## 14. exposure and consent acceptance'
select signature,
       (select count(*) from regexp_matches(pg_get_functiondef(signature::regprocedure),'2026-09-15.mcp-consent-catalog.v18','g')) as v18,
       (select count(*) from regexp_matches(pg_get_functiondef(signature::regprocedure),'2026-09-04.mcp-consent-catalog.v9','g')) as v9,
       (select count(*) from regexp_matches(pg_get_functiondef(signature::regprocedure),'2026-09-15.capability-manifest.v28','g')) as v28,
       (select count(*) from regexp_matches(pg_get_functiondef(signature::regprocedure),'2026-09-04.capability-manifest.v20','g')) as v20
  from (values
   ('private.mcp_oauth_labels_for_scopes(text[],text)'),
   ('public.resolve_mcp_oauth_access_token_as_system(text,text)'),
   ('private.assert_agent_customer_update_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)')
  ) checked(signature);

select set_config('request.jwt.claim.role','',true);
rollback;

\echo ''
\echo '## 15. after rollback production is untouched'
select count(*) as catalog_effect_policy_rows from private.agent_catalog_effect_policy;
select to_regclass('private.agent_catalog_setup_writes') as proposal_table_after;
select count(*) as vinyl_variants from public.catalog_variants
 where catalog_item_id='9b30f44d-47da-4134-872d-7f9c2d6f1b44' and deleted_at is null;
select value from public.catalog_option_values where id='1b20e080-f747-4393-be0a-fc83500586da';
