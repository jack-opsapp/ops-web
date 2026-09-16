-- Captures src/lib/agent-control-plane/contracts/__fixtures__/catalog-setup-write-live-documents.json
--
-- The literal jsonb public.prepare_catalog_setup_write_as_system and
-- public.commit_catalog_setup_write_as_actor return for one create_variant
-- round trip — Vinyl, Boardwalk / 60mil Smooth, 45.00 CAD, warn 30, critical
-- 12, 12 on hand — against a local copy of production structure and Canpro's
-- real catalogue with every catalogue-setup migration applied for real,
-- including 20260916090000_agent_catalog_setup_write_override_level.sql.
--
--   psql "host=127.0.0.1 port=55432 user=postgres dbname=ops_override_level_apply" \
--     -At -f docs/artifacts/mcp-catalog-setup-writes/live-fixture-capture.sql \
--     | python3 -c 'import json,sys; print(json.dumps(json.loads(next(l for l in sys.stdin if l.startswith("{"))), indent=2, sort_keys=True))' \
--     > src/lib/agent-control-plane/contracts/__fixtures__/catalog-setup-write-live-documents.json
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
values ('44444444-4444-4444-8444-444444444444','Live fixture capture',
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
select set_config('request.jwt.claim.role','service_role',true) \g /dev/null
insert into private.agent_catalog_effect_policy(revision, effect_sha256)
values ('2026-09-15.catalog-setup-write.v1', private.agent_catalog_setup_write_effect_revision());

create temporary table capture_prepare as
select public.prepare_catalog_setup_write_as_system(
  '11111111-1111-4111-8111-111111111111', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444',
  repeat('b',32), array['ops.catalog.prepare','ops.catalog.read'],
  (select authority.permission_snapshot_revision
     from private.resolve_agent_actor_authority(
       '11111111-1111-4111-8111-111111111111', 'a612edc0-5c18-4c4d-af97-55b9410dd077',
       array['agent.review','catalog.manage','catalog.products.view','catalog.run_setup','catalog.stock.adjust','catalog.view']) authority),
  array['agent.review','catalog.manage','catalog.products.view','catalog.run_setup','catalog.stock.adjust','catalog.view'],
  '2026-09-15.capability-manifest.v28', '2026-09-15.mcp-exposure.v24',
  'prepare_create_catalog_variant', 'prepare_create_catalog_variant:2026-09-15.v1',
  'create_variant', 'req-' || substr(md5(random()::text),1,12),
  jsonb_build_object(
    'family_ref', jsonb_build_object('kind','catalog_family','id','9b30f44d-47da-4134-872d-7f9c2d6f1b44'),
    'option_values', jsonb_build_array(
      jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','507683da-ac06-477e-90cb-e895e7bcdd5c'),
                         'value_ref', jsonb_build_object('kind','catalog_option_value','id','247c1452-41db-485e-9463-6cc7059c3bb5')),
      jsonb_build_object('option_ref',jsonb_build_object('kind','catalog_option','id','eac1b169-30dd-4d58-8480-14f97b670654'),
                         'value_ref', jsonb_build_object('kind','catalog_option_value','id','a0a25675-71dc-4c45-b01f-99c4a3409f0b'))),
    'price_override', jsonb_build_object('amount','45.0000','currency','CAD'),
    'warning_threshold', 30,
    'critical_threshold', 12,
    'opening_quantity', jsonb_build_object('quantity','12','note','Opening count from the 2026 cost sheet'),
    'evidence', jsonb_build_array(jsonb_build_object(
      'kind','operator_statement',
      'text','Jackson confirmed Boardwalk 60mil Smooth ships at 45.00 with 12 on hand.')),
    'idempotency_key', 'catalog-setup:proof:boardwalk-smooth'),
  clock_timestamp()) as result;

create temporary table capture_receipt as
select public.commit_catalog_setup_write_as_actor(
  '11111111-1111-4111-8111-111111111111',
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  (select (result->>'action_id')::uuid from capture_prepare),
  (select (result->>'change_set_id')::uuid from capture_prepare),
  (select result->>'preview_sha256' from capture_prepare),
  'approve-catalog-setup-write:proof') as receipt;

\set QUIET off
select jsonb_build_object(
  'prepare', (select result from capture_prepare),
  'receipt', (select receipt from capture_receipt))::text;
rollback;
