\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
set timezone='UTC';
create schema runtime;
create function runtime.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
create function runtime.rejects(statement text,expected text,label text) returns void language plpgsql as $$declare caught boolean:=false;begin begin execute statement;exception when others then if sqlerrm not like '%'||expected||'%' then raise exception 'FAIL: % unexpected %',label,sqlerrm;end if;caught:=true;end;perform runtime.assert(caught,label);end$$;
insert into public.companies values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Local fixture A',null),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Local fixture B',null);
insert into public.users values ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,null),('10000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,null);
create table runtime.contracts(version text primary key,exposure text,consent text,scopes text[]);
insert into runtime.contracts values
('v1','2026-08-22.mcp-exposure.v1','2026-08-22.mcp-consent-catalog.v1',array['ops.jobs.read','ops.schedule.read','ops.customers.read','ops.customer_contacts.read','ops.photos.read','ops.correspondence.read','ops.financials.read']),
('v2','2026-08-29.mcp-exposure.v2','2026-08-22.mcp-consent-catalog.v1',array['ops.jobs.read','ops.schedule.read','ops.customers.read','ops.customer_contacts.read','ops.photos.read','ops.correspondence.read','ops.financials.read','ops.tasks.read','ops.site_visits.read','ops.files.read','ops.financial_documents.read','ops.payments.read','ops.expenses.read','ops.catalog.read','ops.purchasing.read','ops.catalog_costs.read','ops.company.read','ops.team.read','ops.integrations.read','ops.operations.read']);
insert into runtime.contracts select 'v14','2026-09-04.mcp-exposure.v14','2026-09-04.mcp-consent-catalog.v9',array(select unnest(scopes||array['ops.customers.prepare']) order by 1) from runtime.contracts where version='v2';
insert into runtime.contracts values
('v14-dcr-read','2026-09-04.mcp-exposure.v14','2026-09-04.mcp-consent-catalog.v9',array['ops.customers.read']),
('v14-dcr-min','2026-09-04.mcp-exposure.v14','2026-09-04.mcp-consent-catalog.v9',array['ops.correspondence.read','ops.customers.prepare','ops.customers.read','ops.jobs.read','ops.team.read']);
create table runtime.sessions(name text primary key,client_id uuid,grant_id uuid,access_hash text,refresh_hash text,scopes text[],exposure text,consent text,labels text[]);

-- Each scenario obtains authority through the real registration -> consent ->
-- code -> grant RPCs. This is local synthetic operator consent only.
create function runtime.connect(version text,session_name text,requested_scopes text[] default null) returns void language plpgsql as $$
declare c runtime.contracts%rowtype;cl record;p record;g record;code record;ph text:=md5(session_name||'preview')||md5(session_name||'preview2');ch text:=md5(session_name||'code')||md5(session_name||'code2');ah text:=md5(session_name||'access')||md5(session_name||'access2');rh text:=md5(session_name||'refresh')||md5(session_name||'refresh2');labels text[];granted_scopes text[];uid uuid:='10000000-0000-4000-8000-000000000001';cid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';begin
select * into strict c from runtime.contracts x where x.version=connect.version;
granted_scopes:=coalesce(requested_scopes,c.scopes);
labels:=private.mcp_oauth_labels_for_scopes(granted_scopes,c.consent);
select * into strict cl from public.register_mcp_oauth_client_as_system('Local synthetic '||session_name,array['http://127.0.0.1:55480/callback/local-fixture'],array_to_string(c.scopes,' '),c.scopes,c.consent,c.exposure,null,null);
perform runtime.assert(cl.scope_ceiling=c.scopes and cl.consent_catalog_revision=c.consent and cl.exposure_revision=c.exposure,session_name||' registration pins exact ceiling/consent/exposure');
select * into strict p from public.issue_mcp_oauth_consent_preview_as_system(ph,cl.client_id,uid,cid,cl.redirect_uris[1],'code',granted_scopes,labels,c.consent,c.exposure,'local-state',repeat('c',43),'S256','https://app.opsapp.co/api/mcp',statement_timestamp()+interval '4 minutes');
perform runtime.assert(not p.rate_limited,session_name||' consent preview persisted');
perform runtime.assert(not exists(select 1 from public.consume_mcp_oauth_consent_preview_as_system(ph,'10000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),session_name||' other tenant cannot consume preview');
select * into strict p from public.consume_mcp_oauth_consent_preview_as_system(ph,uid,cid);
perform runtime.assert(p.scopes=granted_scopes and p.accepted_labels=labels and p.exposure_revision=c.exposure,session_name||' exact displayed consent preserved');
perform runtime.assert(not exists(select 1 from public.consume_mcp_oauth_consent_preview_as_system(ph,uid,cid)),session_name||' consent preview is single use');
perform public.create_mcp_oauth_authorization_code_as_system(ch,cl.client_id,uid,cid,p.scopes,p.accepted_labels,p.consent_catalog_revision,p.exposure_revision,p.redirect_uri,p.code_challenge,p.resource,statement_timestamp()+interval '4 minutes');
select * into strict code from public.consume_mcp_oauth_authorization_code_as_system(ch,cl.client_id,cl.redirect_uris[1]);
perform runtime.assert(code.accepted_labels=labels,session_name||' code carries accepted labels');
select * into strict g from public.mint_mcp_oauth_grant_as_system(ch,cl.client_id,uid,cid,c.exposure,c.scopes,ah,rh,'https://app.opsapp.co','https://app.opsapp.co/api/mcp',statement_timestamp()+interval '1 hour',statement_timestamp()+interval '1 day');
insert into runtime.sessions values(session_name,cl.client_id,g.grant_id,ah,rh,granted_scopes,c.exposure,c.consent,labels);
end$$;
select runtime.connect('v1','legacy-v1');
select runtime.connect('v2','legacy-v2');
select runtime.connect('v14','active-v14');
select runtime.connect('v14','read-only-v14',array['ops.customers.read']);
select runtime.connect('v14-dcr-read','registered-readonly-v14');
select runtime.connect('v14-dcr-min','registered-minimum-v14');

do $$declare s runtime.sessions%rowtype;r record;newa text;newr text;active_scopes text[];begin
select scopes into active_scopes from runtime.contracts where version='v14';
for s in select * from runtime.sessions order by name loop
select * into strict r from public.resolve_mcp_oauth_access_token_as_system(s.access_hash,'2026-09-04.mcp-exposure.v14');
perform runtime.assert(r.exposure_revision=s.exposure and r.scopes=s.scopes and r.accepted_labels=s.labels and not r.token_revoked and not r.grant_revoked,s.name||' bearer works and stays pinned after activation');
if s.exposure='2026-09-04.mcp-exposure.v14' then
perform runtime.assert(not exists(select 1 from public.resolve_mcp_oauth_access_token_as_system(s.access_hash,'2026-08-29.mcp-exposure.v2')),s.name||' old deployment cannot accept new prepare grant');
perform runtime.assert(not exists(select 1 from public.resolve_mcp_oauth_access_token_as_system(s.access_hash)),s.name||' one-argument compatibility resolver excludes prepare grant');
else
select * into strict r from public.resolve_mcp_oauth_access_token_as_system(s.access_hash,'2026-08-29.mcp-exposure.v2');
perform runtime.assert(r.exposure_revision=s.exposure,s.name||' old deployment remains compatible');
end if;
perform runtime.assert(not exists(select 1 from public.resolve_mcp_oauth_access_token_as_system(s.access_hash,'2026-09-03.mcp-exposure.v13')),s.name||' unsupported active exposure rejected');
newa:=md5(s.name||'rotated-access')||md5(s.name||'rotated-access2');newr:=md5(s.name||'rotated-refresh')||md5(s.name||'rotated-refresh2');
select * into strict r from public.rotate_mcp_oauth_refresh_token_as_system(s.refresh_hash,s.client_id,active_scopes,newa,newr,statement_timestamp()+interval '1 hour',statement_timestamp()+interval '1 day');
perform runtime.assert(not r.reuse_detected and r.scopes=s.scopes and r.exposure_revision=s.exposure and r.consent_catalog_revision=s.consent and r.accepted_labels=s.labels,s.name||' refresh preserves immutable original consent with no upgrade');
perform runtime.assert((select exposure_revision=s.exposure from public.resolve_mcp_oauth_access_token_as_system(newa,'2026-09-04.mcp-exposure.v14')),s.name||' rotated bearer resolves pinned contract');
select * into strict r from public.rotate_mcp_oauth_refresh_token_as_system(s.refresh_hash,s.client_id,active_scopes,repeat('e',64),repeat('f',64),statement_timestamp()+interval '1 hour',statement_timestamp()+interval '1 day');
perform runtime.assert(r.reuse_detected,s.name||' replay detected');
perform runtime.assert((select revoked_at is not null from private.mcp_oauth_grants where id=s.grant_id) and (select bool_and(revoked_at is not null) from private.mcp_oauth_tokens where grant_id=s.grant_id),s.name||' replay revokes entire token family');
end loop;
end$$;

-- Authority cannot be expanded or relabelled by a persisted-row update.
do $$declare s runtime.sessions%rowtype;begin
select * into strict s from runtime.sessions where name='legacy-v2';
perform runtime.rejects(format('update private.mcp_oauth_clients set exposure_revision=%L where client_id=%L','2026-09-04.mcp-exposure.v14',s.client_id),'mcp_oauth_client_authority_immutable','existing client cannot be silently upgraded');
perform runtime.rejects(format('update private.mcp_oauth_grants set scopes=scopes||array[%L] where id=%L','ops.customers.prepare',s.grant_id),'mcp_oauth_grant_consent_immutable','existing grant cannot gain prepare scope');
perform runtime.rejects(format('update private.mcp_oauth_grants set accepted_labels=array[%L] where id=%L','Prepare without approval',s.grant_id),'mcp_oauth_grant_consent_immutable','accepted consent labels cannot be rewritten');
perform runtime.rejects(format('select * from public.register_mcp_oauth_client_as_system(%L,array[%L],%L,array[%L],%L,%L,null,null)','bad registration','http://127.0.0.1:55480/callback/local-fixture','ops.customers.commit','ops.customers.commit','2026-09-04.mcp-consent-catalog.v9','2026-09-04.mcp-exposure.v14'),'mcp_oauth_scope_invalid','external commit scope cannot register');
perform runtime.rejects(format('select * from public.register_mcp_oauth_client_as_system(%L,array[%L],%L,array[%L],%L,%L,null,null)','bad old consent','http://127.0.0.1:55480/callback/local-fixture','ops.customers.prepare','ops.customers.prepare','2026-08-22.mcp-consent-catalog.v1','2026-09-04.mcp-exposure.v14'),'mcp_oauth_scope_invalid','old consent cannot authorize prepare');
end$$;

select runtime.connect('v14','revoke-v14');
do $$declare s runtime.sessions%rowtype;begin
select * into strict s from runtime.sessions where name='revoke-v14';
perform runtime.assert(not public.revoke_mcp_oauth_grant_as_system(s.grant_id,'10000000-0000-4000-8000-000000000002'),'other operator cannot revoke grant');
perform runtime.assert(public.revoke_mcp_oauth_grant_as_system(s.grant_id,'10000000-0000-4000-8000-000000000001'),'named operator can revoke grant');
perform runtime.assert((select bool_and(revoked_at is not null) from private.mcp_oauth_tokens where grant_id=s.grant_id),'revocation reaches every token');
perform runtime.assert(not exists(select 1 from public.rotate_mcp_oauth_refresh_token_as_system(s.refresh_hash,s.client_id,s.scopes,repeat('a',64),repeat('b',64),statement_timestamp()+interval '1 hour',statement_timestamp()+interval '1 day') where not reuse_detected),'revoked grant cannot mint usable refresh pair');
end$$;

-- Exact v3 remains canary-gated; v14 activation must not activate older writes.
insert into runtime.contracts values('v3','2026-08-30.mcp-exposure.v3','2026-08-30.mcp-consent-catalog.v2',array['ops.correspondence.read','ops.financial_documents.read','ops.jobs.read','ops.operations.prepare','ops.operations.read','ops.schedule.read','ops.tasks.read']);
select runtime.rejects($q$select runtime.connect('v3','unbound-canary')$q$,'mcp_oauth_canary_unavailable','unbound v3 consent is still denied');
select runtime.assert(not exists(select 1 from private.mcp_oauth_grants where exposure_revision='2026-08-30.mcp-exposure.v3'),'no v3 grant created');
select runtime.assert((select count(*)=0 from private.agent_day_closeout_routines),'activation creates no recurring routine');
select runtime.rejects($q$select * from public.register_mcp_oauth_client_as_system('Unsupported preparation',array['http://127.0.0.1:55480/callback/local-fixture'],'ops.operations.prepare',array['ops.operations.prepare'],'2026-09-04.mcp-consent-catalog.v9','2026-09-04.mcp-exposure.v14',null,null)$q$,'mcp_oauth_scope_invalid','v14 cannot register another vertical prepare scope');
select runtime.assert(not has_function_privilege('anon','public.resolve_mcp_oauth_access_token_as_system(text,text)','execute') and not has_function_privilege('authenticated','public.resolve_mcp_oauth_access_token_as_system(text,text)','execute') and has_function_privilege('service_role','public.resolve_mcp_oauth_access_token_as_system(text,text)','execute'),'activated bearer resolver remains service-only');
select runtime.assert((select proconfig=array['search_path=""'] from pg_proc where oid='public.resolve_mcp_oauth_access_token_as_system(text,text)'::regprocedure),'activated bearer resolver has empty search path');
select 'OAuth activation PostgreSQL fixture complete' as result;
