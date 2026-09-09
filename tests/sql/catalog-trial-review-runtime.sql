\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
begin;
select catalog_test.assert(to_regprocedure('public.can_review_catalog_trial_as_actor(uuid,uuid)') is not null,'review visibility RPC exists');
update private.agent_catalog_effect_policy set effect_sha256=private.agent_catalog_effect_revision();
update catalog_test.state set value=to_jsonb(catalog_test.register_client('Synthetic review visibility')) where key='client';
select public.provision_catalog_oauth_trial_as_system(catalog_test.client(),'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()+interval '1 hour',private.agent_catalog_effect_revision());
select catalog_test.assert(not public.can_review_catalog_trial_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'binding without actual consent does not unlock review');
insert into private.mcp_oauth_grants(user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
values('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',catalog_test.client(),private.agent_catalog_trial_scopes(),repeat('e',32),private.agent_catalog_labels(private.agent_catalog_trial_scopes(),'2026-09-08.mcp-consent-catalog.v14'),'2026-09-08.mcp-consent-catalog.v14','2026-09-08.mcp-exposure.v19');
select catalog_test.assert(public.can_review_catalog_trial_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'exact consented current operator can see review');
select catalog_test.assert(not public.can_review_catalog_trial_as_actor('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'other operator cannot see trial review');
select catalog_test.assert(not public.can_review_catalog_trial_as_actor('10000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'wrong company cannot see trial review');
savepoint actor_live;
update public.users set is_active=false where id='10000000-0000-4000-8000-000000000001';
select catalog_test.assert(not public.can_review_catalog_trial_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'removed actor cannot see trial review');
rollback to actor_live;
savepoint effect_live;
update private.agent_catalog_effect_policy set effect_sha256='sha256:'||repeat('0',64);
select catalog_test.assert(not public.can_review_catalog_trial_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'stale effect cannot unlock review');
rollback to effect_live;
update private.mcp_oauth_grants set revoked_at=clock_timestamp() where client_id=catalog_test.client();
select catalog_test.assert(not public.can_review_catalog_trial_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'revoked consent closes review');
select catalog_test.assert(not has_function_privilege('authenticated','public.can_review_catalog_trial_as_actor(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.can_review_catalog_trial_as_actor(uuid,uuid)','EXECUTE'),'review visibility RPC is service-only');
set local request.jwt.claim.role='authenticated';
select catalog_test.rejects($s$select public.can_review_catalog_trial_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$s$,'access_denied','RPC checks caller role internally');
rollback;
