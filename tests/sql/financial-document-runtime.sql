\set ON_ERROR_STOP on
create schema if not exists financial_test;
create or replace function financial_test.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
select financial_test.assert(to_regprocedure('private.financial_document_calculate(jsonb,numeric)') is not null,'server-owned financial calculation exists');
select financial_test.assert(private.financial_document_calculate('{"increase_percent":"8","lines":[{"quantity":"1.125","discount_percent":"0","is_taxable":true,"unit_price":"12.50","minimum_charge":"0.00"}]}',0.05)->>'total'='15.95','quantity extension and tax round independently at cents');
set timezone='UTC';
set request.jwt.claim.role='service_role';
create function financial_test.rejects(statement text,expected text,label text) returns void language plpgsql as $$ declare caught boolean:=false;begin begin execute statement;exception when others then if sqlerrm not like '%'||expected||'%' then raise exception 'FAIL % unexpected error %',label,sqlerrm;end if;caught:=true;end;perform financial_test.assert(caught,label);end $$;
-- Prospective consent exists ONLY in this disposable fixture.
do $$ declare definition text;begin definition:=pg_get_functiondef('private.mcp_oauth_labels_for_scopes(text[],text)'::regprocedure);execute replace(definition,'private.mcp_oauth_labels_for_scopes','financial_test.previous_labels');end $$;
create or replace function private.mcp_oauth_labels_for_scopes(p_scopes text[],p_consent_catalog_revision text) returns text[] language plpgsql immutable as $$
begin if p_consent_catalog_revision='2026-09-07.mcp-consent-catalog.v12' then
 if p_scopes is distinct from array['ops.company.read','ops.customers.read','ops.financial_documents.prepare','ops.financial_documents.read','ops.jobs.read'] then raise exception 'fixture_scope_invalid';end if;
 return array['Company','Customers','Prepare exact financial drafts','Financial documents','Jobs'];end if;
 return financial_test.previous_labels(p_scopes,p_consent_catalog_revision);end $$;
update private.financial_document_effect_policy set effect_revision=private.financial_document_effect_revision();
insert into public.companies(id,name,public_handle,currency_code) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Financial fixture','financial-fixture','CAD'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other company','other-financial','CAD');
insert into public.users(id,company_id,first_name,last_name,is_company_admin) values('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Operator','Fixture',true),('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Other','Operator',true);
insert into public.clients(id,company_id,name) values('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture customer');
insert into public.projects(id,company_id,client_id,title,status) values('30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','Fixture repair','accepted');
insert into public.project_notes(id,project_id,company_id,author_id,content) values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','Approved fictional pricing source. Operator rates may be entered explicitly. Terms: payment on completion.');
insert into private.financial_document_policies(id,company_id,revision,status,currency_code,terms,permitted_price_sources,permitted_units,source_document_id,source_sha256)
select '50000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fixture-1','active','CAD','Payment on completion',array['operator','catalog','historical_line'],array['hour'],id,private.financial_document_hash(to_jsonb(n)) from public.project_notes n;
insert into public.tax_rates(company_id,name,rate,is_default,is_active) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','GST',0.05,true,true);
insert into private.mcp_oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,response_types,scope,registration_source,scope_ceiling,consent_catalog_revision,exposure_revision)
select '60000000-0000-4000-8000-000000000001','Fixture',array['https://example.invalid/callback'],'none',array['authorization_code'],array['code'],array_to_string(s,' '),'fixture',s,'2026-09-07.mcp-consent-catalog.v12','2026-09-07.mcp-exposure.v17'
from (select array['ops.company.read','ops.customers.read','ops.financial_documents.prepare','ops.financial_documents.read','ops.jobs.read']::text[] s) x;
insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
select '70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',client_id,scope_ceiling,repeat('a',32),private.mcp_oauth_labels_for_scopes(scope_ceiling,consent_catalog_revision),consent_catalog_revision,exposure_revision from private.mcp_oauth_clients;
create function financial_test.request(key text) returns jsonb language sql set timezone='UTC' as $$
select jsonb_build_object('document_kind','estimate','operation','create','client_id','20000000-0000-4000-8000-000000000001','project_id','30000000-0000-4000-8000-000000000001','opportunity_id',null,'revises_estimate_id',null,'expected_revision_sha256',null,'baseline_estimate_id',null,'policy_id',p.id,'policy_sha256',private.financial_document_hash(to_jsonb(p)),'currency','CAD','issue_date',current_date,'expiration_date',current_date+30,'title','Fixture repair','client_message','','terms',p.terms,'inclusions','Replace damaged boards','exclusions','Railing','scope_evidence',jsonb_build_object('kind','operator','reference_id',null,'sha256',null,'statement','Measured additional repair scope'),'increase_percent','8','adjustment_base','unit_prices_and_minimum_charges','lines','[{"name":"Board installation","description":"","quantity":"1.125","unit":"hour","type":"LABOR","source":{"kind":"operator","reference_id":null,"sha256":null,"unit_price":"12.50","minimum_charge":"0.00"},"discount_percent":"0","is_taxable":true}]'::jsonb,'idempotency_key',key) from private.financial_document_policies p where p.id='50000000-0000-4000-8000-000000000001'
$$;
create function financial_test.prepare(request jsonb) returns jsonb language plpgsql as $$
declare perms text[]:=array['agent.review','clients.view','estimates.create','estimates.view','pipeline.view','projects.view'];rev text;g private.mcp_oauth_grants%rowtype;
begin select * into g from private.mcp_oauth_grants where id='70000000-0000-4000-8000-000000000001';select permission_snapshot_revision into rev from private.resolve_agent_actor_authority(g.user_id,g.company_id,perms);
return public.prepare_financial_document_as_system(g.user_id,g.company_id,g.id,g.client_id,g.revision,g.scopes,rev,perms,'2026-09-07.capability-manifest.v23','2026-09-07.mcp-exposure.v17','prepare_financial_document','prepare_financial_document:2026-09-07.v1','financial-runtime',request);end $$;
create function financial_test.commit(p jsonb,key text default 'financial-commit-001') returns jsonb language sql as $$
select public.commit_financial_document_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(p->>'action_id')::uuid,(p->>'change_set_id')::uuid,p->>'preview_sha256',key)
$$;
do $$ declare p jsonb;r jsonb;req jsonb;begin
req:=financial_test.request('financial-basic-001');p:=financial_test.prepare(req);
perform financial_test.assert((select count(*)=0 from public.estimates) and (select count(*)=0 from public.document_sequences),'prepare creates no financial rows or numbers');
perform financial_test.assert((financial_test.prepare(req)->>'replayed')::boolean,'preparation exact replay');
perform financial_test.rejects(format('select financial_test.prepare(%L::jsonb)',jsonb_set(req,'{title}','"Changed title"')),'IDEMPOTENCY_CONFLICT','changed-input preparation rejected');
r:=financial_test.commit(p);
perform financial_test.assert((select total=15.95 and distribution_hold and status='draft' from public.estimates where id=(r->>'estimate_id')::uuid),'approved exact draft is saved privately');
perform financial_test.assert((select count(*)=1 from public.line_items) and (select last_number=1 from public.document_sequences),'one number and one line allocated');
perform financial_test.assert((financial_test.commit(p)->>'replayed')::boolean and (select count(*)=1 from public.estimates),'exact commit replay does not duplicate financial truth');
perform financial_test.rejects(format('select financial_test.commit(%L::jsonb,%L)',p,'different-commit-key'),'IDEMPOTENCY_CONFLICT','changed commit key rejected');
perform financial_test.rejects(format('update public.estimates set status=%L where id=%L','sent',r->>'estimate_id'),'PRIVATE_REVISION_IMMUTABLE','draft save cannot become delivery');
perform financial_test.rejects(format('update public.estimates set distribution_hold=false where id=%L',r->>'estimate_id'),'PRIVATE_REVISION_IMMUTABLE','incidental update cannot release hold');
perform financial_test.rejects('update public.line_items set unit_price=99','PRIVATE_REVISION_IMMUTABLE','saved revision lines immutable');
update private.mcp_oauth_grants set revoked_at=clock_timestamp();
perform financial_test.rejects(format('select financial_test.commit(%L::jsonb)',p),'GRANT_STALE','receipt replay reauthorizes revoked grants');
update private.mcp_oauth_grants set revoked_at=null;
end $$;
select financial_test.assert(private.financial_document_calculate('{"increase_percent":"0","lines":[{"quantity":"1","discount_percent":"0","is_taxable":true,"unit_price":"0.10","minimum_charge":"0.00"},{"quantity":"1","discount_percent":"0","is_taxable":true,"unit_price":"0.10","minimum_charge":"0.00"}]}',0.05)->>'tax_amount'='0.01','tax matches canonical taxable subtotal rounding');
do $$ declare field text;req jsonb;begin
foreach field in array array['operation','title','currency','increase_percent','issue_date'] loop
 req:=jsonb_set(financial_test.request('invalid-null-'||field),array[field],'null');
 perform financial_test.rejects(format('select financial_test.prepare(%L::jsonb)',req),'INPUT_INVALID','null '||field||' rejected by RPC');
end loop;
foreach field in array array['name','description','unit','quantity','discount_percent'] loop
 req:=jsonb_set(financial_test.request('invalid-line-'||field),array['lines','0',field],'null');
 perform financial_test.rejects(format('select financial_test.prepare(%L::jsonb)',req),'LINE_INVALID','null line '||field||' rejected by RPC');
 req:=jsonb_set(financial_test.request('invalid-number-'||field),array['lines','0',field],'12');
 perform financial_test.rejects(format('select financial_test.prepare(%L::jsonb)',req),'LINE_INVALID','numeric line '||field||' rejected by RPC');
end loop;
end $$;
begin;
do $$ declare result record;begin
for attempt in 1..7 loop
 select * into result from public.consume_financial_document_prepare_rate_limit_as_system('financial-rate-'||attempt,'70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','prepare_financial_document','mcp-financial-document-prepare:2026-09-07.v1',1,'modern');
 perform financial_test.assert(result.allowed=(attempt<=6),'durable preparation rate limit attempt '||attempt);
end loop;
end $$;
rollback;

select financial_test.rejects($test$insert into public.estimates(company_id,client_id,estimate_number,currency_code,distribution_hold) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','UNAPPROVED','CAD',true)$test$,'PRIVATE_REVISION_IMMUTABLE','held header insertion requires the canonical approval transaction token');
