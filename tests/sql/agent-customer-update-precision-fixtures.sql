\set ON_ERROR_STOP on
set timezone='UTC';
set request.jwt.claim.role='service_role';
create schema runtime;
create function runtime.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end $$;
insert into public.companies(id,name,public_handle) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture A','fixture-a'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fixture B','fixture-b');
insert into public.users(id,company_id,first_name,last_name,is_company_admin) values ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Jackson','Fixture',true),('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Crew','Fixture',true),('10000000-0000-4000-8000-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other','Tenant',true);
insert into public.clients(id,company_id,name,notes) values ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture customer','Old notes');
insert into public.opportunities(id,company_id,title,description,client_id) values ('30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture lead','Original details','20000000-0000-4000-8000-000000000001'),('30000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other lead','Tenant boundary',null);
insert into private.mcp_oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,response_types,scope,registration_source,scope_ceiling,consent_catalog_revision,exposure_revision)
select '40000000-0000-4000-8000-000000000001','Fixture',array['https://example.invalid/callback'],'none',array['authorization_code'],array['code'],array_to_string(s,' '),'fixture',s,'2026-09-04.mcp-consent-catalog.v9','2026-09-04.mcp-exposure.v14'
from (select array['ops.catalog.read','ops.catalog_costs.read','ops.company.read','ops.correspondence.read','ops.customer_contacts.read','ops.customers.prepare','ops.customers.read','ops.expenses.read','ops.files.read','ops.financial_documents.read','ops.financials.read','ops.integrations.read','ops.jobs.read','ops.operations.read','ops.payments.read','ops.photos.read','ops.purchasing.read','ops.schedule.read','ops.site_visits.read','ops.tasks.read','ops.team.read']::text[] s) x;
insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
select '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',client_id,scope_ceiling,repeat('a',32),private.mcp_oauth_labels_for_scopes(scope_ceiling,consent_catalog_revision),consent_catalog_revision,exposure_revision from private.mcp_oauth_clients;
create function runtime.request(changes jsonb,key text,customer boolean default false) returns jsonb language sql as $$
select jsonb_build_object('opportunity_id',o.id,'expected_updated_at',o.updated_at,'changes',changes,'idempotency_key',key,'evidence',jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Confirmed fixture work details.','supports',(select jsonb_agg(k) from (select jsonb_object_keys(changes) k union all select 'customer.notes' where customer) x)))) || case when customer then jsonb_build_object('customer',jsonb_build_object('id',c.id,'expected_updated_at',c.updated_at,'notes','Updated fixture notes')) else '{}'::jsonb end
from public.opportunities o join public.clients c on c.id=o.client_id where o.id='30000000-0000-4000-8000-000000000001'
$$;
create function runtime.prepare(request jsonb) returns jsonb language plpgsql as $$ declare p text[]:=array['agent.review','clients.edit','clients.view','email.view','inbox.view_company','pipeline.assign','pipeline.edit','pipeline.view','team.view']; r text;g private.mcp_oauth_grants%rowtype; begin
select * into g from private.mcp_oauth_grants limit 1;
select permission_snapshot_revision into r from private.resolve_agent_actor_authority(g.user_id,g.company_id,p);
return public.prepare_agent_customer_update_as_system(g.user_id,g.company_id,g.id,g.client_id,g.revision,g.scopes,r,p,'2026-09-04.capability-manifest.v20','2026-09-04.mcp-exposure.v14','prepare_customer_update','prepare_customer_update:2026-09-04.v1','runtime-request',request,clock_timestamp());end $$;
create function runtime.commit(preview jsonb,key text default 'commit-fixture-001') returns jsonb language sql as $$ select public.commit_agent_customer_update_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(preview->>'action_id')::uuid,(preview->>'change_set_id')::uuid,preview->>'preview_sha256',key) $$;
create function runtime.rejects(statement text,expected text,label text) returns void language plpgsql as $$ declare caught boolean:=false; begin begin execute statement;exception when others then if sqlerrm not like '%'||expected||'%' then raise exception 'FAIL % unexpected error %',label,sqlerrm;end if;caught:=true;end;perform runtime.assert(caught,label);end $$;

set check_function_bodies=off;
\ir fixtures/maverick-job-summary-live-20260905.sql
set check_function_bodies=on;
CREATE OR REPLACE FUNCTION private.agent_rfc3339_utc(p_value timestamp with time zone)
 RETURNS text LANGUAGE sql IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$function$;
-- Evaluate the exact installed reader expression on the real fixture row. The
-- complete summary RPC requires unrelated tables not replicated in this fixture.
create function runtime.read_version() returns text language plpgsql as $$
declare expr text; result text;
begin
  select substring(pg_get_functiondef(oid) from $pattern$'updated_at', ([^\n]*job.updated_at[^\n]*)$pattern$)
    into strict expr from pg_proc where pronamespace='private'::regnamespace
    and proname='read_agent_job_summary_as_system_v6_core';
  if expr is null then raise exception 'missing identity projection'; end if;
  execute 'select ' || expr || ' from public.opportunities job where id=''30000000-0000-4000-8000-000000000001'''
    into result;
  return result;
end $$;
update public.opportunities set updated_at='2026-08-11T15:55:03.630086Z'
where id='30000000-0000-4000-8000-000000000001';
create table runtime.invariants as select oid,proowner,proacl,proconfig,prosecdef,provolatile
from pg_proc where pronamespace='private'::regnamespace and proname='read_agent_job_summary_as_system_v6_core';
create table runtime.source_before as select md5(to_jsonb(o)::text) digest
from public.opportunities o where id='30000000-0000-4000-8000-000000000001';
