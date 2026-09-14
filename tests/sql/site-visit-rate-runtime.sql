create function public.rate_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end$$;
insert into public.companies(id,name,public_handle) values('11111111-1111-4111-8111-111111111111','Fixture','rate-fixture');
insert into public.users(id,company_id,first_name,last_name) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Rate','Fixture');
insert into private.mcp_oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,response_types,scope,scope_ceiling,registration_source,consent_catalog_revision,exposure_revision)
select '44444444-4444-4444-8444-444444444444','Fixture',array['https://example.invalid'],'none',array['authorization_code'],array['code'],array_to_string(scopes,' '),scopes,'fixture','2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v22'
from (select array['ops.site_visit_templates.read','ops.site_visit_templates.prepare','ops.site_visits.read','ops.site_visits.prepare','ops.schedule.read','ops.team.read'] scopes)s;
insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
select '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',client_id,scope_ceiling,repeat('a',32),private.agent_site_visit_workflow_labels(scope_ceiling,consent_catalog_revision),consent_catalog_revision,exposure_revision from private.mcp_oauth_clients;
create function public.rate_call(cap text default 'list_site_visit_templates',era text default 'modern') returns boolean language sql as $$select allowed from public.consume_site_visit_workflow_rate_limit_as_system('rate-test','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',cap,'mcp-site-visit-workflow:2026-09-10.v1',1,era)$$;
grant execute on function public.rate_call(text,text) to service_role;
select set_config('request.role','service_role',false);
set role service_role;
select public.rate_assert(public.rate_call(),'service role exact authority permits read');
reset role;
do $$declare cap text;begin
foreach cap in array array['list_site_visit_templates','get_site_visit_template','get_site_visit_form','get_site_visit_source','prepare_site_visit_booking','prepare_site_visit_reschedule','prepare_site_visit_booking_cancellation','prepare_site_visit_template','prepare_site_visit_template_edit','prepare_site_visit_checklist_selection','prepare_site_visit_answers'] loop
 delete from private.agent_mcp_rate_limit_buckets;
 perform public.rate_assert(public.rate_call(cap),'candidate tool '||cap);
end loop;end$$;
delete from private.agent_mcp_rate_limit_buckets;
do $$begin for i in 1..6 loop perform public.rate_assert(public.rate_call('get_site_visit_form','legacy'),'allowed bounded read '||i);end loop;perform public.rate_assert(not public.rate_call('prepare_site_visit_template'),'rotating tool does not evade shared budget');end$$;
select public.rate_assert((select count(*)=3 and min(units_used)=6 and max(units_used)=6 from private.agent_mcp_rate_limit_buckets),'three atomic buckets remain bounded');
select public.rate_assert((select count(*)=1 from private.mcp_request_audit where outcome='rate_limited' and tool='prepare_site_visit_template'),'denial audit retains exact requested tool');
create function public.rate_denied(change_sql text) returns void language plpgsql as $$begin
 begin execute change_sql;perform public.rate_call();raise exception 'EXPECTED_AUTH_DENIAL';exception when insufficient_privilege then null;end;
end$$;
select public.rate_denied('update private.mcp_oauth_grants set revoked_at=now()');
select public.rate_denied('update private.mcp_oauth_clients set disabled_at=now()');
select public.rate_denied('update private.mcp_oauth_grants set client_id=gen_random_uuid()');
select public.rate_denied('update private.mcp_oauth_grants set user_id=gen_random_uuid()');
select public.rate_denied('update private.mcp_oauth_grants set company_id=gen_random_uuid()');
select public.rate_denied('update public.users set is_active=false');
select public.rate_denied('update public.companies set deleted_at=now()');
select public.rate_denied('update private.mcp_oauth_grants set exposure_revision=''2026-09-08.mcp-exposure.v19''');
select public.rate_denied('update private.mcp_oauth_clients set consent_catalog_revision=''old''');
select public.rate_denied('update private.mcp_oauth_grants set accepted_labels=array[''forged'']');
select public.rate_denied('update private.mcp_oauth_grants set scopes=array[''ops.site_visits.read''],accepted_labels=private.agent_site_visit_workflow_labels(array[''ops.site_visits.read''],consent_catalog_revision)');
select public.rate_denied('update private.mcp_oauth_clients set scope_ceiling=array[''ops.site_visits.read'']');
select public.rate_assert(true,'all twelve current-authority mutation cases denied before charging');
do $$begin begin perform public.rate_call('commit_site_visit_answers');raise exception 'expected';exception when invalid_parameter_value then null;end;begin perform public.rate_call('list_site_visit_templates',null);raise exception 'expected';exception when invalid_parameter_value then null;end;end$$;
select public.rate_assert(not has_function_privilege('authenticated','public.consume_site_visit_workflow_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)','execute') and not has_function_privilege('anon','public.consume_site_visit_workflow_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)','execute'),'only service role has wrapper execute');
delete from private.agent_mcp_rate_limit_buckets;
do $$declare actor uuid;grant_id uuid;ok boolean;begin
 for i in 1..6 loop
  actor:=('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  grant_id:=('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  insert into public.users(id,company_id,first_name,last_name) values(actor,'11111111-1111-4111-8111-111111111111','Rate','Company');
  insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
   select grant_id,actor,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision from private.mcp_oauth_grants where id='33333333-3333-4333-8333-333333333333';
  for j in 1..6 loop
   select allowed into ok from public.consume_site_visit_workflow_rate_limit_as_system('company-test',grant_id,actor,'11111111-1111-4111-8111-111111111111','get_site_visit_form','mcp-site-visit-workflow:2026-09-10.v1',1,'modern');
   if ok is distinct from (i<=5) then raise exception 'company bound violated';end if;
  end loop;
 end loop;
 perform public.rate_assert(true,'six actors share exact company ceiling of thirty');
end$$;
-- Keep one old-policy row intact while clearing only new fixture buckets.
insert into private.agent_mcp_rate_limit_buckets values(decode(repeat('ab',32),'hex'),'actor','mcp-lightweight-read:2026-08-23.v1',now(),2,now()+interval '10 minutes');
delete from private.agent_mcp_rate_limit_buckets where policy_id='mcp-site-visit-workflow:2026-09-10.v1';
create table public.rate_race(allowed boolean);
