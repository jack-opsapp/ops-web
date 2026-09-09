\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
-- Run after the HTTP fixture and receipt proof; every change is synthetic.
begin;
update public.users set is_active=false where id='10000000-0000-4000-8000-000000000001';
select catalog_test.assert(not private.agent_catalog_trial_current(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'removed membership immediately blocks trial');
rollback;
begin;
update public.users set is_company_admin=false where id='10000000-0000-4000-8000-000000000001';
select catalog_test.assert(not private.agent_catalog_trial_current(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'removed permissions immediately block trial');
rollback;
begin;
update private.agent_catalog_effect_policy set effect_sha256='sha256:'||repeat('0',64);
select catalog_test.assert(not private.agent_catalog_trial_current(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'changed effect approval blocks trial');
rollback;
select catalog_test.assert(not has_table_privilege('service_role','private.agent_catalog_trial_bindings','INSERT') and not has_table_privilege('authenticated','private.agent_catalog_trial_bindings','SELECT'),'binding table has no direct application privileges');
select catalog_test.assert(not has_function_privilege('authenticated','public.provision_catalog_oauth_trial_as_system(uuid,uuid,uuid,timestamptz,text)','EXECUTE'),'ordinary user cannot provision trial');
select catalog_test.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.agent_catalog_trial_bindings'::regclass),'binding RLS is forced');
update catalog_test.state set value=to_jsonb(catalog_test.register_client('Synthetic expiring catalog trial')) where key='client';
select public.provision_catalog_oauth_trial_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()+interval '2 seconds',private.agent_catalog_effect_revision());
insert into private.mcp_oauth_grants(user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
values('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',catalog_test.client(),private.agent_catalog_trial_scopes(),repeat('a',32),private.agent_catalog_labels(private.agent_catalog_trial_scopes(),'2026-09-08.mcp-consent-catalog.v14'),'2026-09-08.mcp-consent-catalog.v14','2026-09-08.mcp-exposure.v19');
insert into catalog_test.state select 'expiry_proposal',catalog_test.prepare(catalog_test.one('catalog-expiry-001','category','{"name":"Never save expired trial"}'));
select pg_sleep(2.1);
select catalog_test.assert(not private.agent_catalog_trial_current(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'wall clock expiry blocks active grant');
select catalog_test.assert((select count(*)=0 from public.resolve_mcp_oauth_canary_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-08.mcp-exposure.v19','2026-09-08.mcp-consent-catalog.v14')),'expired consent binding cannot resolve');
select catalog_test.rejects($s$select catalog_test.commit(value) from catalog_test.state where key='expiry_proposal'$s$,'TRIAL_UNAVAILABLE','expired trial cannot approve pending proposal');
select catalog_test.assert((select count(*)=0 from public.catalog_categories where name='Never save expired trial'),'expired approval leaves business rows unchanged');
