\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
set timezone='UTC';
-- Synthetic-only PostgreSQL proof. Run after the OAuth setup, active v14
-- migration, new Canpro callback migration, and existing OAuth runtime suite.
-- Existing runtime schema contains no real business records or credentials.

create function runtime.connect_canpro(version text,session_name text,requested_scopes text[] default null) returns void language plpgsql as $$
declare c runtime.contracts%rowtype;cl record;p record;g record;code record;ph text:=md5(session_name||'preview')||md5(session_name||'preview2');ch text:=md5(session_name||'code')||md5(session_name||'code2');ah text:=md5(session_name||'access')||md5(session_name||'access2');rh text:=md5(session_name||'refresh')||md5(session_name||'refresh2');labels text[];granted_scopes text[];uid uuid:='10000000-0000-4000-8000-000000000001';cid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';begin
select * into strict c from runtime.contracts x where x.version=connect_canpro.version;
granted_scopes:=coalesce(requested_scopes,c.scopes);
labels:=private.mcp_oauth_labels_for_scopes(granted_scopes,c.consent);
select * into strict cl from public.register_mcp_oauth_client_as_system('Local synthetic '||session_name,array['https://bpgayztkcuencdzinfxv.supabase.co/functions/v1/source-oauth'],array_to_string(c.scopes,' '),c.scopes,c.consent,c.exposure,null,null);
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

insert into runtime.contracts values ('canpro','2026-09-04.mcp-exposure.v14','2026-09-04.mcp-consent-catalog.v9',array['ops.company.read','ops.jobs.read','ops.purchasing.read']);
select runtime.connect_canpro('canpro','canpro-cloud');

-- The forward migration may be reapplied without changing persisted clients.
create temp table canpro_before_replay as select * from private.mcp_oauth_clients;
\ir ../../supabase/migrations/20260910180330_mcp_oauth_canpro_cloud_callback.sql
select runtime.assert(not exists((select * from private.mcp_oauth_clients except select * from canpro_before_replay) union all (select * from canpro_before_replay except select * from private.mcp_oauth_clients)),'migration replay preserves every client byte');

do $$declare uri text; other text; c runtime.contracts%rowtype; callback text:='https://bpgayztkcuencdzinfxv.supabase.co/functions/v1/source-oauth';begin
select * into strict c from runtime.contracts where version='canpro';
foreach uri in array array[
callback||'/',callback||'?',callback||'?code=x',callback||'#fragment',callback||'/extra',callback||chr(10),' '||callback,
replace(callback,'https:','http:'),replace(callback,'https:','HTTPS:'),replace(callback,'supabase.co','supabase.co:443'),
replace(callback,'supabase.co','supabase.co.evil.example'),replace(callback,'bpgayztkcuencdzinfxv','ijeekuhbatykdomumfjx'),
replace(callback,'bpgayztkcuencdzinfxv','*'),replace(callback,'source-oauth','%73ource-oauth'),replace(callback,'source-oauth','../v1/source-oauth'),replace(callback,'https://','https://user@')
] loop
perform runtime.rejects(format('select * from public.register_mcp_oauth_client_as_system(%L,array[%L],%L,%L::text[],%L,%L,null,null)','bad canpro',uri,array_to_string(c.scopes,' '),c.scopes,c.consent,c.exposure),'mcp_oauth_redirect_uri_invalid','reject callback alias '||uri);
end loop;
foreach other in array array['https://claude.ai/api/mcp/auth_callback','https://chatgpt.com/connector_platform_oauth_redirect','http://127.0.0.1:55480/callback/local-fixture'] loop
perform runtime.rejects(format('select * from public.register_mcp_oauth_client_as_system(%L,array[%L,%L],%L,%L::text[],%L,%L,null,null)','mixed family',callback,other,array_to_string(c.scopes,' '),c.scopes,c.consent,c.exposure),'mcp_oauth_redirect_uri_invalid','reject mixed Canpro family');
end loop;
foreach other in array array['ops.customers.prepare','ops.financial_documents.prepare','ops.jobs.write','ops.new.read'] loop
perform runtime.rejects(format('select * from public.register_mcp_oauth_client_as_system(%L,array[%L],%L,array[%L],%L,%L,null,null)','scope escalation',callback,other,other,c.consent,c.exposure),'mcp_oauth_scope_invalid','reject non-ceiling scope '||other);
end loop;
perform runtime.rejects(format('select * from public.register_mcp_oauth_client_as_system(%L,array[%L],null,null,%L,%L,null,null)','missing scope',callback,c.consent,c.exposure),'mcp_oauth_scope_invalid','SQL requires explicit scope');
end$$;

-- Fresh code exact redirect binding, stale input, and replay behavior.
do $$declare s runtime.sessions%rowtype; code record; r record; callback text:='https://bpgayztkcuencdzinfxv.supabase.co/functions/v1/source-oauth'; uid uuid:='10000000-0000-4000-8000-000000000001';cid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';begin
select * into strict s from runtime.sessions where name='canpro-cloud';
perform runtime.assert((select redirect_uris=array[callback] and token_endpoint_auth_method='none' and grant_types=array['authorization_code','refresh_token'] from private.mcp_oauth_clients where client_id=s.client_id),'Canpro exact stored callback and public PKCE client');
perform runtime.rejects(format('select public.create_mcp_oauth_authorization_code_as_system(%L,%L,%L,%L,%L::text[],%L::text[],%L,%L,%L,%L,%L,statement_timestamp()+interval ''4 minutes'')',repeat('1',64),s.client_id,uid,cid,s.scopes,s.labels,s.consent,s.exposure,callback||'/',repeat('c',43),'https://app.opsapp.co/api/mcp'),'mcp_oauth_client_unavailable','code issuance rejects redirect mismatch');
perform public.create_mcp_oauth_authorization_code_as_system(repeat('1',64),s.client_id,uid,cid,s.scopes,s.labels,s.consent,s.exposure,callback,repeat('c',43),'https://app.opsapp.co/api/mcp',statement_timestamp()+interval '4 minutes');
perform runtime.assert(not exists(select 1 from public.consume_mcp_oauth_authorization_code_as_system(repeat('1',64),s.client_id,callback||'/')),'wrong redirect cannot consume code');
select * into strict code from public.consume_mcp_oauth_authorization_code_as_system(repeat('1',64),s.client_id,callback);
perform runtime.assert(code.scopes=s.scopes and code.code_challenge=repeat('c',43),'exact redirect consumes code and preserves PKCE challenge');
perform runtime.assert(not exists(select 1 from public.consume_mcp_oauth_authorization_code_as_system(repeat('1',64),s.client_id,callback)),'code replay returns no authority');
-- Seed an already-expired synthetic row; production immutability forbids
-- moving a previously issued code's expiry. No trigger is disabled.
insert into private.mcp_oauth_authorization_codes
select (jsonb_populate_record(null::private.mcp_oauth_authorization_codes,to_jsonb(old)||jsonb_build_object('code_hash',repeat('2',64),'consumed_at',null,'minted_grant_id',null,'created_at',statement_timestamp()-interval '2 minutes','expires_at',statement_timestamp()-interval '1 minute'))).*
from private.mcp_oauth_authorization_codes old where code_hash=repeat('1',64);
perform runtime.assert(not exists(select 1 from public.consume_mcp_oauth_authorization_code_as_system(repeat('2',64),s.client_id,callback)),'expired code returns no authority');
perform public.issue_mcp_oauth_consent_preview_as_system(repeat('3',64),s.client_id,uid,cid,callback,'code',s.scopes,s.labels,s.consent,s.exposure,'local-state',repeat('c',43),'S256','https://app.opsapp.co/api/mcp',statement_timestamp()+interval '4 minutes');
insert into private.mcp_oauth_consent_previews
select (jsonb_populate_record(null::private.mcp_oauth_consent_previews,to_jsonb(old)||jsonb_build_object('preview_hash',repeat('8',64),'created_at',statement_timestamp()-interval '2 minutes','expires_at',statement_timestamp()-interval '1 minute'))).*
from private.mcp_oauth_consent_previews old where preview_hash=repeat('3',64);
perform runtime.assert(not exists(select 1 from public.consume_mcp_oauth_consent_preview_as_system(repeat('8',64),uid,cid)),'expired consent preview returns no authority');
select * into strict r from public.rotate_mcp_oauth_refresh_token_as_system(s.refresh_hash,s.client_id,(select scopes from runtime.contracts where version='v14'),repeat('4',64),repeat('5',64),statement_timestamp()+interval '10 minutes',statement_timestamp()+interval '30 days');
perform runtime.assert(not r.reuse_detected and r.scopes=s.scopes and r.accepted_labels=s.labels and r.exposure_revision=s.exposure,'Canpro rotation retains exact read-only consent');
perform runtime.assert((select scopes=s.scopes and not grant_revoked and not token_revoked from public.resolve_mcp_oauth_access_token_as_system(repeat('4',64),s.exposure)),'rotated bearer resolves with original read scope');
select * into strict r from public.rotate_mcp_oauth_refresh_token_as_system(s.refresh_hash,s.client_id,(select scopes from runtime.contracts where version='v14'),repeat('6',64),repeat('7',64),statement_timestamp()+interval '10 minutes',statement_timestamp()+interval '30 days');
perform runtime.assert(r.reuse_detected,'Canpro refresh replay detected');
perform runtime.assert((select revoked_at is not null from private.mcp_oauth_grants where id=s.grant_id) and (select bool_and(revoked_at is not null) from private.mcp_oauth_tokens where grant_id=s.grant_id),'Canpro replay revokes grant and whole token family');
end$$;

-- Replaying a code after it minted a grant must revoke that grant too.
select runtime.connect_canpro('canpro','canpro-code-replay');
do $$declare s runtime.sessions%rowtype;begin
select * into strict s from runtime.sessions where name='canpro-code-replay';
perform runtime.assert(not exists(select 1 from public.consume_mcp_oauth_authorization_code_as_system(md5('canpro-code-replaycode')||md5('canpro-code-replaycode2'),s.client_id,'https://bpgayztkcuencdzinfxv.supabase.co/functions/v1/source-oauth')),'minted code replay returns no authority');
perform runtime.assert((select revoked_at is not null from private.mcp_oauth_grants where id=s.grant_id) and (select bool_and(revoked_at is not null) from private.mcp_oauth_tokens where grant_id=s.grant_id),'minted code replay revokes grant and tokens');
end$$;

select runtime.assert(not has_function_privilege('anon','public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)','execute') and not has_function_privilege('authenticated','public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)','execute') and has_function_privilege('service_role','public.register_mcp_oauth_client_as_system(text,text[],text,text[],text,text,text,text)','execute'),'registration remains service-only');
set request.jwt.claim.role='authenticated';
select runtime.rejects($q$select * from public.register_mcp_oauth_client_as_system('Canpro',array['https://bpgayztkcuencdzinfxv.supabase.co/functions/v1/source-oauth'],'ops.company.read',array['ops.company.read'],'2026-09-04.mcp-consent-catalog.v9','2026-09-04.mcp-exposure.v14',null,null)$q$,'access_denied','registration repeats service-role gate');
set request.jwt.claim.role='service_role';
select 'Canpro cloud OAuth PostgreSQL fixture complete' as result;
