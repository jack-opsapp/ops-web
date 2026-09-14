\set ON_ERROR_STOP on
do $$ begin
 if to_regprocedure('private.agent_site_visit_trial_current(uuid,uuid,uuid)') is null then
  raise exception 'SITE_VISIT_TRIAL_NOT_IMPLEMENTED';
 end if;
 if exists(select 1 from private.agent_site_visit_trial_bindings) or exists(select 1 from private.agent_site_visit_workflow_effect_policy) or exists(select 1 from private.site_visit_concurrency_companies) then
  raise exception 'Migration enabled a trial';
 end if;
 raise notice 'PASS: migration creates no binding, company enrollment or effect policy';
end $$;

-- All identities, callbacks and tokens below are synthetic and socket-local.
create schema trial_test;
create function trial_test.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end $$;
create function trial_test.rejects(command text,message text,label text) returns void language plpgsql as $$
begin
 begin execute command;exception when others then
  if position(message in sqlerrm)=0 then raise;end if;raise notice 'PASS: %',label;return;
 end;
 raise exception 'FAIL: % accepted',label;
end $$;
create table trial_test.state(key text primary key,value jsonb not null);
select trial_test.assert(not exists(select 1 from pg_constraint c where c.contype='f' and c.conrelid='private.agent_site_visit_trial_bindings'::regclass and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indkey[0]=c.conkey[1])),'each subject foreign key has a usable leading index');
insert into public.companies(id,name,public_handle) values
('10000000-0000-4000-8000-000000000002','Trial fixture','trial-fixture'),
('10000000-0000-4000-8000-000000000003','Unrelated fixture','unrelated-fixture');
insert into public.users(id,company_id,first_name,last_name,firebase_uid,is_active) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Trial','Operator','trial-operator',true),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','Other','Operator','other-operator',true);
insert into public.user_permission_overrides(user_id,company_id,permission,scope,granted)
select '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',p,'all',true
from unnest(array['agent.review','calendar.view','pipeline.convert','pipeline.edit','pipeline.view','settings.company','settings.integrations','team.view'])p;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
create function trial_test.public_grant(exposure text) returns jsonb language plpgsql as $$
declare client uuid;code text:=md5(exposure||':code')||md5(exposure||':code');access text:=md5(exposure||':access')||md5(exposure||':access');refresh text:=md5(exposure||':refresh')||md5(exposure||':refresh');
begin
 select client_id into client from public.register_mcp_oauth_client_as_system('Unrelated public fixture',array['http://127.0.0.1:43177/callback/publicfixture'],'ops.jobs.read',array['ops.jobs.read'],'2026-09-04.mcp-consent-catalog.v9',exposure,null,null);
 perform public.create_mcp_oauth_authorization_code_as_system(code,client,'20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',array['ops.jobs.read'],array['See your jobs and their status'],'2026-09-04.mcp-consent-catalog.v9',exposure,'http://127.0.0.1:43177/callback/publicfixture',repeat('a',43),'https://app.opsapp.co/api/mcp',clock_timestamp()+interval '3 minutes');
 perform public.consume_mcp_oauth_authorization_code_as_system(code,client,'http://127.0.0.1:43177/callback/publicfixture');
 perform public.mint_mcp_oauth_grant_as_system(code,client,'20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',exposure,array['ops.jobs.read'],access,refresh,'https://app.opsapp.co','https://app.opsapp.co/api/mcp',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '7 days');
 return jsonb_build_object('client',client,'access',access,'refresh',refresh);
end $$;
insert into trial_test.state values('public_v14',trial_test.public_grant('2026-09-04.mcp-exposure.v14')),('public_v23',trial_test.public_grant('2026-09-10.mcp-exposure.v23'));
create function trial_test.public_snapshot() returns jsonb language sql as $$
 select jsonb_build_object(
 'clients',(select jsonb_agg(to_jsonb(c) order by c.client_id) from private.mcp_oauth_clients c where c.exposure_revision in('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')),
 'grants',(select jsonb_agg(to_jsonb(g) order by g.id) from private.mcp_oauth_grants g where g.exposure_revision in('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')),
 'tokens',(select jsonb_agg(to_jsonb(t) order by t.token_hash) from private.mcp_oauth_tokens t join private.mcp_oauth_grants g on g.id=t.grant_id where g.exposure_revision in('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')))
$$;
insert into trial_test.state values('public_before',trial_test.public_snapshot());
create function trial_test.register_client() returns uuid language sql as $$
 select client_id from public.register_mcp_oauth_client_as_system('Synthetic site visit trial',array['http://127.0.0.1:43177/callback/sitevisittrial'],array_to_string(private.agent_site_visit_trial_scopes(),' '),private.agent_site_visit_trial_scopes(),'2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v22',null,null)
$$;
create function trial_test.client() returns uuid language sql as $$ select (value#>>'{}')::uuid from trial_test.state where key='client' $$;
create function trial_test.current() returns boolean language sql as $$
 select private.agent_site_visit_trial_current(trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')
$$;
create function trial_test.provision() returns uuid language sql as $$
 select public.provision_site_visit_oauth_trial_as_system(trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',(select(value#>>'{}')::timestamptz from trial_test.state where key='expires'),private.agent_site_visit_workflow_effect_revision(),private.agent_site_visit_trial_authorization_revision())
$$;
create function trial_test.preview() returns integer language sql as $$
 select count(*)::integer from public.issue_mcp_oauth_consent_preview_as_system(repeat('9',64),trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','http://127.0.0.1:43177/callback/sitevisittrial','code',private.agent_site_visit_trial_scopes(),private.agent_site_visit_workflow_labels(private.agent_site_visit_trial_scopes(),'2026-09-10.mcp-consent-catalog.v17'),'2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v22','synthetic-state',repeat('a',43),'S256','https://app.opsapp.co/api/mcp',clock_timestamp()+interval '3 minutes')
$$;
insert into trial_test.state values('client',to_jsonb(trial_test.register_client())),('expires',to_jsonb(clock_timestamp()+interval '1 hour'));
select trial_test.rejects('select trial_test.preview()','TRIAL_UNAVAILABLE','consent preview cannot be issued before trial binding');
select trial_test.rejects('select trial_test.provision()','PROVISION_DENIED','trial cannot enable without company compatibility and reviewed effect');
insert into private.site_visit_concurrency_companies(company_id) values('10000000-0000-4000-8000-000000000002');
insert into private.agent_site_visit_workflow_effect_policy values('10000000-0000-4000-8000-000000000002','2026-09-10.v1',private.agent_site_visit_workflow_effect_revision());
insert into trial_test.state select 'binding',to_jsonb(trial_test.provision());
select trial_test.assert(to_jsonb(trial_test.provision())=(select value from trial_test.state where key='binding'),'exact provision retry is idempotent');
select trial_test.assert(trial_test.current(),'exact reviewed subject is current');
select trial_test.assert(not private.agent_site_visit_trial_current(trial_test.client(),'20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),'another operator cannot inherit the connection');
select trial_test.assert(not private.agent_site_visit_trial_current(trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),'another company cannot inherit the connection');
select trial_test.assert((select count(*)=1 from public.resolve_mcp_oauth_canary_as_system(trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','2026-09-10.mcp-exposure.v22','2026-09-10.mcp-consent-catalog.v17')),'consent resolves only exact trial');
select trial_test.rejects('update private.agent_site_visit_trial_bindings set expires_at=expires_at+interval ''1 minute''','IMMUTABLE','expiry cannot be extended');
select trial_test.rejects('delete from private.agent_site_visit_trial_bindings','IMMUTABLE','binding cannot be deleted and recreated');
select trial_test.rejects('update private.mcp_oauth_clients set scope_ceiling=scope_ceiling||''ops.inventory.adjust''::text where client_id=trial_test.client()','immutable','client consent ceiling cannot be repinned');
select trial_test.assert(private.mcp_oauth_labels_for_scopes(private.agent_site_visit_trial_scopes(),'2026-09-10.mcp-consent-catalog.v17')=private.agent_site_visit_workflow_labels(private.agent_site_visit_trial_scopes(),'2026-09-10.mcp-consent-catalog.v17'),'OAuth and workflow use identical frozen consent labels');
select trial_test.assert(private.mcp_oauth_labels_for_scopes(array['ops.site_visits.prepare'],'2026-09-04.mcp-consent-catalog.v9') is null,'public consent cannot acquire site visit prepare');
select trial_test.assert(trial_test.preview()=1,'current exact trial can preview consent');
select trial_test.assert((select count(*)=1 from public.consume_mcp_oauth_consent_preview_as_system(repeat('9',64),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')),'exact actor can consume the frozen consent preview');

-- Real code consumption and grant minting; never a production service-minted grant.
select public.create_mcp_oauth_authorization_code_as_system(repeat('a',64),trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',private.agent_site_visit_trial_scopes(),private.agent_site_visit_workflow_labels(private.agent_site_visit_trial_scopes(),'2026-09-10.mcp-consent-catalog.v17'),'2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v22','http://127.0.0.1:43177/callback/sitevisittrial',repeat('a',43),'https://app.opsapp.co/api/mcp',clock_timestamp()+interval '3 minutes');
select user_id from public.consume_mcp_oauth_authorization_code_as_system(repeat('a',64),trial_test.client(),'http://127.0.0.1:43177/callback/sitevisittrial');
select grant_id from public.mint_mcp_oauth_grant_as_system(repeat('a',64),trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','2026-09-10.mcp-exposure.v22',private.agent_site_visit_trial_scopes(),repeat('b',64),repeat('c',64),'https://app.opsapp.co','https://app.opsapp.co/api/mcp',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '7 days');
select trial_test.assert((select count(*)=1 from public.resolve_mcp_oauth_access_token_as_system(repeat('b',64),'2026-09-10.mcp-exposure.v23')),'current public bearer resolver recognizes exact private trial');
select trial_test.assert((select count(*)=0 from public.resolve_mcp_oauth_access_token_as_system(repeat('b',64))),'legacy resolver cannot silently widen');
select trial_test.assert(to_jsonb(trial_test.provision())=(select value from trial_test.state where key='binding'),'provision retry after consent does not create another binding');

create function trial_test.context() returns jsonb language sql as $$
 select jsonb_build_object('actor',g.user_id,'company',g.company_id,'channel','mcp','manifest','2026-09-10.capability-manifest.v27','permission_keys',keys,'permission_revision',a.permission_snapshot_revision,'grant',g.id,'client',g.client_id,'grant_revision',g.revision,'scopes',g.scopes)
 from private.mcp_oauth_grants g cross join (select array['agent.review','calendar.view','pipeline.convert','pipeline.edit','pipeline.view','settings.company','settings.integrations','team.view']::text[] keys)p
 cross join lateral private.resolve_agent_actor_authority(g.user_id,g.company_id,keys)a where g.client_id=trial_test.client()
$$;
create function trial_test.request() returns jsonb language sql as $$
 select '{"operation":"create_template","idempotency_key":"trial-template-001","definition":{"name":"Trial checklist","slug":"trial-checklist","is_default":true,"fields":[{"id":"power","label":"Power available","kind":"checkbox","required":true,"sortOrder":1}]}}'::jsonb
$$;
create function trial_test.commit(p jsonb) returns jsonb language sql as $$
 select public.commit_site_visit_workflow_as_actor('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',(p->>'action_id')::uuid,(p->>'change_set_id')::uuid,p->>'preview_sha256','trial-commit-001')
$$;
insert into trial_test.state select 'proposal',public.prepare_site_visit_workflow_as_system('trial-prepare',trial_test.context(),trial_test.request());
select trial_test.assert((select private.agent_site_visit_workflow_can_read('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',(value->>'action_id')::uuid) from trial_test.state where key='proposal'),'exact originating operator can read the OPS approval');
select trial_test.assert((select public.filter_site_visit_workflow_actions_as_actor('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',array[(value->>'action_id')::uuid])=array[(value->>'action_id')::uuid] from trial_test.state where key='proposal'),'OPS queue does not filter out the trial approval');
select trial_test.assert((select value->>'status'='approval_required' from trial_test.state where key='proposal') and not exists(select 1 from public.site_visit_types),'preparation creates a review but no business write');
select trial_test.assert(public.prepare_site_visit_workflow_as_system('trial-prepare-replay',trial_test.context(),trial_test.request())->>'replayed'='true','prepare retry returns the same exact proposal');
select trial_test.rejects($q$select public.prepare_site_visit_workflow_as_system('trial-internal',trial_test.context()||'{"channel":"internal","grant":null,"client":null,"grant_revision":null,"scopes":null}'::jsonb,trial_test.request())$q$,'TRIAL_REQUIRED','internal channel cannot bypass restricted authority');
select trial_test.rejects($q$select public.prepare_site_visit_workflow_as_system('trial-api',trial_test.context()||'{"channel":"ops_api","grant":null,"client":null,"grant_revision":null,"scopes":null}'::jsonb,trial_test.request())$q$,'TRIAL_REQUIRED','API channel cannot bypass restricted authority');
select trial_test.rejects($q$select trial_test.commit(value||jsonb_build_object('preview_sha256','sha256:'||repeat('0',64))) from trial_test.state where key='proposal'$q$,'IDEMPOTENCY_CONFLICT','changed approval digest cannot save');
select trial_test.rejects($q$select public.commit_site_visit_workflow_as_actor('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',(value->>'action_id')::uuid,(value->>'change_set_id')::uuid,value->>'preview_sha256','wrong-operator-001') from trial_test.state where key='proposal'$q$,'NOT_FOUND','other operator cannot approve');
insert into trial_test.state select 'receipt',trial_test.commit(value) from trial_test.state where key='proposal';
select trial_test.assert((select value->>'ok'='true' from trial_test.state where key='receipt') and (select count(*)=1 from public.site_visit_types),'exact OPS approval saves one checklist with a truthful receipt');
select trial_test.assert((select trial_test.commit(p.value)-'replayed'=r.value-'replayed' from trial_test.state p,trial_test.state r where p.key='proposal' and r.key='receipt') and (select count(*)=1 from public.site_visit_types),'lost response replay does not duplicate a business write');

-- Current authority is checked at every lifecycle boundary, including receipt replay.
begin;
alter function private.mcp_oauth_scope_array_is_valid(text[]) set statement_timeout='2s';
select trial_test.assert(not trial_test.current(),'OAuth security definition drift invalidates the separate authorization seal');
rollback;
update public.user_permission_overrides set granted=false where permission='agent.review';
select trial_test.assert(not trial_test.current(),'revoked review permission invalidates trial');
select trial_test.assert((select count(*)=0 from public.resolve_mcp_oauth_access_token_as_system(repeat('b',64),'2026-09-10.mcp-exposure.v23')),'permission loss invalidates bearer');
update public.user_permission_overrides set granted=true where permission='agent.review';
begin;
update private.agent_site_visit_workflow_effect_policy set effect_sha256='sha256:'||repeat('0',64);
select trial_test.assert(not trial_test.current(),'stale reviewed effect invalidates trial');
rollback;
begin;
delete from private.site_visit_concurrency_companies;
select trial_test.assert(not trial_test.current(),'removed phone compatibility invalidates trial');
rollback;
select trial_test.assert((select count(*)=1 from public.rotate_mcp_oauth_refresh_token_as_system(repeat('c',64),trial_test.client(),array['ops.jobs.read'],repeat('d',64),repeat('e',64),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '7 days')),'refresh keeps exact trial ceiling despite public default scopes');
select trial_test.assert((select scopes=private.agent_site_visit_trial_scopes() from public.resolve_mcp_oauth_access_token_as_system(repeat('d',64),'2026-09-10.mcp-exposure.v23')),'rotated bearer retains only the fourteen consented scopes');
select trial_test.assert(not public.disable_mcp_oauth_canary_as_system(trial_test.client(),'20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002') and trial_test.current(),'wrong-subject disable cannot affect trial');
select trial_test.assert(public.disable_mcp_oauth_canary_as_system(trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),'exact subject disable succeeds');
select trial_test.assert(public.disable_mcp_oauth_canary_as_system(trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),'disable retry is idempotent');
select trial_test.assert((select count(*)=0 from public.resolve_mcp_oauth_access_token_as_system(repeat('d',64),'2026-09-10.mcp-exposure.v23')),'disabled bearer never falls back to public exposure');
select trial_test.assert(not exists(select 1 from private.mcp_oauth_tokens t join private.mcp_oauth_grants g on g.id=t.grant_id where g.exposure_revision='2026-09-10.mcp-exposure.v22' and t.revoked_at is null),'disable revokes exact grant token family');
select trial_test.rejects($q$select trial_test.commit(value) from trial_test.state where key='proposal'$q$,'TRIAL_UNAVAILABLE','receipt replay rechecks trial authority');
select trial_test.rejects('update private.agent_site_visit_trial_bindings set disabled_at=null','IMMUTABLE','disabled binding cannot be revived');
select trial_test.rejects('select trial_test.provision()','PROVISION_DENIED','provision retry cannot revive disabled trial');
select trial_test.assert(not exists(select 1 from private.mcp_oauth_canary_bindings) and not exists(select 1 from private.agent_catalog_trial_bindings) and not exists(select 1 from private.financial_document_effect_policy),'trial never provisions financial or catalog authority');
select trial_test.assert(not has_table_privilege('service_role','private.agent_site_visit_trial_bindings','insert') and not has_function_privilege('authenticated','public.provision_site_visit_oauth_trial_as_system(uuid,uuid,uuid,timestamptz,text,text)','execute') and not has_function_privilege('service_role','private.agent_site_visit_trial_authorize(jsonb)','execute'),'binding and authority internals are owner-only');

-- A second independently bound connection exercises real expiry, not mocked time.
update trial_test.state set value=to_jsonb(trial_test.register_client()) where key='client';
update trial_test.state set value=to_jsonb(clock_timestamp()+interval '1 second') where key='expires';
select trial_test.provision();
select trial_test.assert(trial_test.current(),'fresh short-lived trial starts current');
select public.create_mcp_oauth_authorization_code_as_system(repeat('1',64),trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',private.agent_site_visit_trial_scopes(),private.agent_site_visit_workflow_labels(private.agent_site_visit_trial_scopes(),'2026-09-10.mcp-consent-catalog.v17'),'2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v22','http://127.0.0.1:43177/callback/sitevisittrial',repeat('a',43),'https://app.opsapp.co/api/mcp',clock_timestamp()+interval '3 minutes');
select user_id from public.consume_mcp_oauth_authorization_code_as_system(repeat('1',64),trial_test.client(),'http://127.0.0.1:43177/callback/sitevisittrial');
select grant_id from public.mint_mcp_oauth_grant_as_system(repeat('1',64),trial_test.client(),'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','2026-09-10.mcp-exposure.v22',private.agent_site_visit_trial_scopes(),repeat('2',64),repeat('3',64),'https://app.opsapp.co','https://app.opsapp.co/api/mcp',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '7 days');
select pg_sleep(1.05);
select trial_test.assert(not trial_test.current(),'wall-clock expiry invalidates trial');
select trial_test.assert((select count(*)=0 from public.resolve_mcp_oauth_access_token_as_system(repeat('2',64),'2026-09-10.mcp-exposure.v23')),'expired trial cannot use an otherwise unexpired access token');
select trial_test.assert((select count(*)=0 from public.rotate_mcp_oauth_refresh_token_as_system(repeat('3',64),trial_test.client(),array['ops.jobs.read'],repeat('4',64),repeat('5',64),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '7 days')),'expired trial refresh cannot fall back or extend authority');
select trial_test.assert(not exists(select 1 from private.mcp_oauth_tokens t join private.mcp_oauth_grants g on g.id=t.grant_id where g.exposure_revision='2026-09-10.mcp-exposure.v22' and t.revoked_at is null),'expired refresh revokes its exact token family');
select trial_test.rejects('select trial_test.provision()','PROVISION_DENIED','expired binding cannot be renewed by replay');
select trial_test.assert(trial_test.public_snapshot()=(select value from trial_test.state where key='public_before'),'trial lifecycle preserves unrelated public clients, grants and tokens byte-for-byte');
select trial_test.assert((select count(*)=2 from trial_test.state s cross join lateral public.resolve_mcp_oauth_access_token_as_system(s.value->>'access','2026-09-10.mcp-exposure.v23')token where s.key in('public_v14','public_v23') and not token.token_revoked and not token.grant_revoked and not token.client_disabled),'existing public V14 and V23 tokens remain usable');
