\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
-- Only synthetic local fixtures. The first assertion fails before trial migration.
select catalog_test.assert(to_regclass('private.agent_catalog_trial_bindings') is not null,'catalog trial binding installed');
select catalog_test.rejects($s$select catalog_test.prepare(catalog_test.request('catalog-trial-internal-001'))$s$,'CATALOG_TRIAL_REQUIRED','internal channel cannot bypass trial');

create table catalog_test.state(key text primary key,value jsonb not null);
create function catalog_test.register_client(label text) returns uuid language sql as $$
 select client_id from public.register_mcp_oauth_client_as_system(label,array['http://127.0.0.1:43177/callback/catalogtrial'],array_to_string(private.agent_catalog_trial_scopes(),' '),private.agent_catalog_trial_scopes(),'2026-09-08.mcp-consent-catalog.v14','2026-09-08.mcp-exposure.v19',null,null)
$$;
create function catalog_test.client() returns uuid language sql as $$select (value #>> '{}')::uuid from catalog_test.state where key='client'$$;
insert into catalog_test.state values('client',to_jsonb(catalog_test.register_client('Synthetic catalog trial')));
select catalog_test.rejects($s$select public.provision_catalog_oauth_trial_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()+interval '1 hour',private.agent_catalog_effect_revision())$s$,'PROVISION_DENIED','migration cannot enable a trial without reviewed effect seal');
insert into private.agent_catalog_effect_policy values('2026-09-08.v1',private.agent_catalog_effect_revision());
select catalog_test.rejects($s$select public.provision_catalog_oauth_trial_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',clock_timestamp()+interval '1 hour',private.agent_catalog_effect_revision())$s$,'PROVISION_DENIED','wrong company cannot enroll');
select public.provision_catalog_oauth_trial_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()+interval '1 hour',private.agent_catalog_effect_revision());
select catalog_test.assert(private.agent_catalog_trial_current(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'exact bound actor is current');
select catalog_test.assert(not private.agent_catalog_trial_current(catalog_test.client(),'10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'other operator cannot inherit trial');
select catalog_test.assert((select count(*)=1 from public.resolve_mcp_oauth_canary_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-08.mcp-exposure.v19','2026-09-08.mcp-consent-catalog.v14')),'OAuth consent resolves exact trial');
select catalog_test.rejects($s$update private.agent_catalog_trial_bindings set expires_at=expires_at+interval '1 minute'$s$,'IMMUTABLE','binding expiry cannot be extended');
select catalog_test.rejects($s$update private.agent_catalog_trial_bindings set actor_user_id='10000000-0000-4000-8000-000000000002'$s$,'IMMUTABLE','binding cannot switch actor');
select catalog_test.rejects($s$delete from private.agent_catalog_trial_bindings$s$,'IMMUTABLE','binding cannot be deleted and recreated');
select catalog_test.rejects($s$update private.mcp_oauth_clients set scope_ceiling=scope_ceiling||'ops.jobs.read'::text where client_id=catalog_test.client()$s$,'immutable','client ceiling stays immutable');

-- Real consent/code/mint functions, with synthetic PKCE data; never service-minted production tokens.
select public.create_mcp_oauth_authorization_code_as_system(repeat('a',64),catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',private.agent_catalog_trial_scopes(),private.agent_catalog_labels(private.agent_catalog_trial_scopes(),'2026-09-08.mcp-consent-catalog.v14'),'2026-09-08.mcp-consent-catalog.v14','2026-09-08.mcp-exposure.v19','http://127.0.0.1:43177/callback/catalogtrial',repeat('a',43),'https://app.opsapp.co/api/mcp',clock_timestamp()+interval '3 minutes');
select user_id from public.consume_mcp_oauth_authorization_code_as_system(repeat('a',64),catalog_test.client(),'http://127.0.0.1:43177/callback/catalogtrial');
select * from public.mint_mcp_oauth_grant_as_system(repeat('a',64),catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-08.mcp-exposure.v19',private.agent_catalog_trial_scopes(),repeat('b',64),repeat('c',64),'https://app.opsapp.co','https://app.opsapp.co/api/mcp',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '7 days');
select catalog_test.assert((select count(*)=1 from public.resolve_mcp_oauth_access_token_as_system(repeat('b',64),'2026-09-04.mcp-exposure.v14')),'live bearer path recognizes exact catalog trial');
select catalog_test.assert((select count(*)=0 from public.resolve_mcp_oauth_access_token_as_system(repeat('b',64))),'legacy bearer resolver excludes catalog trial');

create or replace function catalog_test.context() returns jsonb language sql as $$
 select jsonb_build_object('actor',g.user_id,'company',g.company_id,'channel','mcp','manifest','2026-09-08.capability-manifest.v24','permission_keys',keys,'permission_revision',a.permission_snapshot_revision,'grant',g.id,'client',g.client_id,'grant_revision',g.revision,'scopes',g.scopes)
 from private.mcp_oauth_grants g cross join (select array['agent.review','catalog.import','catalog.manage','catalog.products.manage','catalog.products.view','catalog.stock.adjust','catalog.view','finances.view']::text[] keys) p cross join lateral private.resolve_agent_actor_authority(g.user_id,g.company_id,keys) a where g.client_id=catalog_test.client()
$$;
insert into catalog_test.state select 'proposal',catalog_test.prepare(catalog_test.request('catalog-trial-graph-001'));
select catalog_test.assert((select value->>'status'='approval_required' from catalog_test.state where key='proposal'),'trial preparation requires named approval');
select catalog_test.assert((select count(*)=0 from public.products) and (select count(*)=0 from public.catalog_variants),'prepare has zero catalog or inventory writes');
select catalog_test.assert(catalog_test.prepare(catalog_test.request('catalog-trial-graph-001'))->>'replayed'='true','identical prepare is idempotent');
select catalog_test.rejects($s$select public.prepare_catalog_changes_as_system(catalog_test.context()||'{"channel":"ops_api"}'::jsonb,catalog_test.request('catalog-trial-bypass-001'),'fixture')$s$,'CATALOG_TRIAL_REQUIRED','API channel cannot bypass trial');
select catalog_test.rejects($s$select public.commit_catalog_changes_as_actor('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(value->>'action_id')::uuid,(value->>'change_set_id')::uuid,value->>'preview_sha256','wrong-operator-001') from catalog_test.state where key='proposal'$s$,'NOT_FOUND','another operator cannot approve');
insert into catalog_test.state select 'receipt',catalog_test.commit(value) from catalog_test.state where key='proposal';
select catalog_test.assert((select value->>'effect'='catalog_saved' from catalog_test.state where key='receipt'),'exact local approval produces truthful saved receipt');
select catalog_test.assert((select count(*)=2 and sum(quantity)=0 from public.catalog_variants),'saved variants start with zero stock');
select catalog_test.assert((select catalog_test.commit(p.value)=r.value||'{"replayed":true}'::jsonb from catalog_test.state p,catalog_test.state r where p.key='proposal' and r.key='receipt'),'same-key retry returns original receipt');
select catalog_test.assert((select count(*)=1 from public.rotate_mcp_oauth_refresh_token_as_system(repeat('c',64),catalog_test.client(),array['ops.catalog.read'],repeat('d',64),repeat('e',64),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '7 days')),'refresh retains only exact trial scope ceiling');
select catalog_test.assert((select scopes=private.agent_catalog_trial_scopes() from public.resolve_mcp_oauth_access_token_as_system(repeat('d',64),'2026-09-04.mcp-exposure.v14')),'refreshed bearer retains consented seven scopes');
select catalog_test.assert(not public.disable_mcp_oauth_canary_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'wrong subject cannot disable another operator trial');
select catalog_test.assert(private.agent_catalog_trial_current(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'wrong-subject disable leaves trial unchanged');
select catalog_test.assert(public.disable_mcp_oauth_canary_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'exact disable succeeds');
select catalog_test.assert((select count(*)=0 from public.resolve_mcp_oauth_access_token_as_system(repeat('d',64),'2026-09-04.mcp-exposure.v14')),'disabled bearer cannot fall back to public exposure');
select catalog_test.rejects($s$select catalog_test.commit(value) from catalog_test.state where key='proposal'$s$,'TRIAL_UNAVAILABLE','receipt replay rechecks current authority');
select catalog_test.rejects($s$update private.agent_catalog_trial_bindings set disabled_at=null$s$,'IMMUTABLE','disabled binding cannot be revived');
select catalog_test.assert((select count(*)=0 from private.financial_document_effect_policy) and (select count(*)=0 from private.mcp_oauth_canary_bindings),'catalog trial does not provision financial authority');
