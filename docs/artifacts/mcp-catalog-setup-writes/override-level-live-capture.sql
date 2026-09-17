-- Captures src/lib/agent-control-plane/contracts/__fixtures__/catalog-setup-write-override-level-live-documents.json
--
-- The literal request, prepare result and commit receipt of five writes whose
-- whole point is the level a value lands at, against a local copy of
-- production structure and Canpro's real catalogue with every catalogue-setup
-- migration applied for real, including
-- 20260916090000_agent_catalog_setup_write_override_level.sql:
--
--   1. create_variant   Corner Sleeve Bronze / Normal at the family price and
--                       the inherited levels: born inheriting all of them.
--   2. set_pricing      Black / Normal from its own 18.00 to the family 15.00:
--                       the override is cleared.
--   3. set_thresholds   Black / Normal warn 30, the category level: cleared.
--   4. set_supplier_cost White / Normal, a new 8.50 default on an item-level
--                       costed family: the variant keeps inheriting.
--   5. set_pricing      the Corner Sleeve family 15.00 -> 17.00 with a hand-set
--                       15.00 override on White: the shadowing list.
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=ops_override_level_apply" \
--     -At -f docs/artifacts/mcp-catalog-setup-writes/override-level-live-capture.sql \
--     | python3 -c 'import json,sys; print(json.dumps(json.loads(next(l for l in sys.stdin if l.startswith("{"))), indent=2, sort_keys=True))' \
--     > src/lib/agent-control-plane/contracts/__fixtures__/catalog-setup-write-override-level-live-documents.json
--
-- One transaction, ending in rollback: it writes nothing.
\set ON_ERROR_STOP on
\set QUIET on
begin;
set search_path = '';
insert into private.agent_read_domain_revisions(company_id, domain, source_revision)
values ('a612edc0-5c18-4c4d-af97-55b9410dd077','catalog',1)
on conflict do nothing;
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision)
values ('44444444-4444-4444-8444-444444444444','Override level live capture',
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
select set_config('request.jwt.claim.role','service_role',true) \g /dev/null
insert into private.agent_catalog_effect_policy(revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());

-- Fixtures: Hardware warns at 30, Corner Sleeve is critical at 10, a Bronze
-- colour exists, and Black / Normal carries its own 18.00 price.
update public.catalog_categories set default_warning_threshold = 30
 where id = '11111111-1111-0001-1111-000000000010';
update public.catalog_items set default_critical_threshold = 10
 where id = '9ab97bdc-4882-48a0-aafd-c082444a9f08';
insert into public.catalog_option_values(id, option_id, value, sort_order) values
  ('c0000000-0000-4000-8000-00000000b001', '9900cda5-9b5d-426e-a15e-857dca2db59a', 'Bronze', 30);
update public.catalog_variants set price_override = 18
 where id = '22f9a4ac-eb8d-46a7-a134-1cc75800a700';

create function pg_temp.round_trip(p_kind text, p_request jsonb, p_commit_key text)
returns jsonb language plpgsql as $f$
declare
  v_keys text[] := array['agent.review','catalog.manage','catalog.products.view','catalog.run_setup','catalog.stock.adjust','catalog.view','finances.view'];
  v_capability text := private.agent_catalog_setup_write_kind_capability(p_kind);
  v_prepare jsonb;
  v_receipt jsonb;
begin
  v_prepare := public.prepare_catalog_setup_write_as_system(
    '11111111-1111-4111-8111-111111111111', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
    '55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444',
    repeat('b',32), array['ops.catalog.prepare','ops.catalog.read','ops.catalog_costs.read'],
    (select authority.permission_snapshot_revision
       from private.resolve_agent_actor_authority(
         '11111111-1111-4111-8111-111111111111', 'a612edc0-5c18-4c4d-af97-55b9410dd077', v_keys) authority),
    v_keys, '2026-09-15.capability-manifest.v28', '2026-09-15.mcp-exposure.v24',
    v_capability, v_capability || ':2026-09-15.v1',
    p_kind, 'req-' || substr(md5(random()::text),1,12), p_request, clock_timestamp());
  v_receipt := public.commit_catalog_setup_write_as_actor(
    '11111111-1111-4111-8111-111111111111', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
    (v_prepare->>'action_id')::uuid, (v_prepare->>'change_set_id')::uuid,
    v_prepare->>'preview_sha256', p_commit_key);
  return jsonb_build_object('kind', p_kind, 'request', p_request,
    'prepare', v_prepare, 'receipt', v_receipt);
end $f$;

create function pg_temp.evidence() returns jsonb language sql as $f$
  select jsonb_build_array(jsonb_build_object('kind','operator_statement',
    'text','Jackson confirmed this against the 2026 price and cost sheets.'))
$f$;

create temporary table capture(ordinal integer, name text, document jsonb);

insert into capture select 1, 'create_variant_inheriting_everything', pg_temp.round_trip('create_variant',
  jsonb_build_object(
    'family_ref', jsonb_build_object('kind','catalog_family','id','9ab97bdc-4882-48a0-aafd-c082444a9f08'),
    'option_values', jsonb_build_array(
      jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','9900cda5-9b5d-426e-a15e-857dca2db59a'),
                         'value_ref', jsonb_build_object('kind','catalog_option_value','id','c0000000-0000-4000-8000-00000000b001')),
      jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','5db85385-12ee-427a-8788-178f7ae7df40'),
                         'value_ref', jsonb_build_object('kind','catalog_option_value','id','48bde7c9-a3a1-4877-ba73-d8e5ed26bb17'))),
    'price_override', jsonb_build_object('amount','15.00','currency','CAD'),
    'warning_threshold', 30,
    'critical_threshold', 10,
    'evidence', pg_temp.evidence(),
    'idempotency_key', 'catalog-setup:capture:create-variant'),
  'approve-catalog-setup-write:capture-1');

insert into capture select 2, 'variant_price_back_to_family', pg_temp.round_trip('set_pricing',
  jsonb_build_object(
    'item_ref', jsonb_build_object('kind','catalog_variant','id','22f9a4ac-eb8d-46a7-a134-1cc75800a700'),
    'sale_price', jsonb_build_object('amount','15','currency','CAD'),
    'evidence', pg_temp.evidence(),
    'idempotency_key', 'catalog-setup:capture:variant-price'),
  'approve-catalog-setup-write:capture-2');

insert into capture select 3, 'warning_back_to_category', pg_temp.round_trip('set_thresholds',
  jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id','22f9a4ac-eb8d-46a7-a134-1cc75800a700'),
    'warning_threshold', 30,
    'evidence', pg_temp.evidence(),
    'idempotency_key', 'catalog-setup:capture:thresholds'),
  'approve-catalog-setup-write:capture-3');

insert into capture select 4, 'supplier_cost_keeps_family_level', pg_temp.round_trip('set_supplier_cost',
  jsonb_build_object(
    'variant_ref', jsonb_build_object('kind','catalog_variant','id','2c7cdf44-3473-499b-b086-73737505a565'),
    'profile_key', 'home-depot-2026',
    'label', 'Home Depot 2026 card',
    'unit_cost', jsonb_build_object('amount','8.50','currency','CAD'),
    'is_default', true,
    'evidence', pg_temp.evidence(),
    'idempotency_key', 'catalog-setup:capture:supplier-cost'),
  'approve-catalog-setup-write:capture-4');

-- A redundant override set by hand, outside MCP, before the family price moves.
update public.catalog_variants set price_override = 15
 where id = '2c7cdf44-3473-499b-b086-73737505a565';

insert into capture select 5, 'family_price_with_shadowing_variants', pg_temp.round_trip('set_pricing',
  jsonb_build_object(
    'item_ref', jsonb_build_object('kind','catalog_family','id','9ab97bdc-4882-48a0-aafd-c082444a9f08'),
    'sale_price', jsonb_build_object('amount','17.00','currency','CAD'),
    'evidence', pg_temp.evidence(),
    'idempotency_key', 'catalog-setup:capture:family-price'),
  'approve-catalog-setup-write:capture-5');

\set QUIET off
select jsonb_build_object('scenarios', jsonb_agg(
         jsonb_build_object('name', name) || document order by ordinal))::text
  from capture;
rollback;
