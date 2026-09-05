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

-- Successful opportunity-only edit, replay, and timestamps with equivalent ISO forms.
do $$ declare p jsonb;r jsonb;begin
p:=runtime.prepare(runtime.request('{"description":"Confirmed updated details"}','runtime-basic-001'));
r:=runtime.commit(p);perform runtime.assert(r#>>'{readback,description}'='Confirmed updated details','opportunity-only commit with null customer');
perform runtime.assert((runtime.commit(p)->>'replayed')::boolean,'exact commit replay');
perform runtime.rejects(format('select runtime.commit(%L::jsonb,%L)',p,'different-key'),'IDEMPOTENCY_CONFLICT','different replay key rejected');
p:=runtime.prepare(runtime.request('{"next_follow_up_at":"2026-10-01T15:00:00Z"}','runtime-stamp-001'));
r:=runtime.commit(p);perform runtime.assert((r#>>'{readback,next_follow_up_at}')::timestamptz='2026-10-01T15:00:00Z'::timestamptz,'ISO Z timestamp commits');
p:=runtime.prepare(runtime.request('{"next_follow_up_at":"2026-10-02T08:00:00-07:00"}','runtime-stamp-002'));
r:=runtime.commit(p);perform runtime.assert((r#>>'{readback,next_follow_up_at}')::timestamptz='2026-10-02T15:00:00Z'::timestamptz,'offset timestamp commits');
end $$;

-- Negative paths execute in subtransactions and must leave the target unchanged.
do $$ declare p jsonb;q jsonb;before_row jsonb;begin
q:=runtime.request('{"description":"Pending approval"}','runtime-stale-001');p:=runtime.prepare(q);
perform runtime.assert((runtime.prepare(q)->>'replayed')::boolean,'prepare replay');
perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',jsonb_set(q,'{changes,description}','"Different"')),'IDEMPOTENCY_CONFLICT','prepare key conflicts');
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',jsonb_set(p,'{preview_sha256}',to_jsonb('sha256:'||repeat('0',64)))),'IDEMPOTENCY_CONFLICT','wrong seal denied');
select to_jsonb(o) into before_row from public.opportunities o where id='30000000-0000-4000-8000-000000000001';
update public.opportunities set description='Concurrent edit' where id='30000000-0000-4000-8000-000000000001';
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'SOURCE_STALE','same timestamp source content change denied');
update public.opportunities set description=before_row->>'description' where id='30000000-0000-4000-8000-000000000001';
update private.mcp_oauth_grants set revoked_at=clock_timestamp();perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'GRANT_STALE','revoked grant denied');update private.mcp_oauth_grants set revoked_at=null;
insert into public.user_permission_overrides(user_id,company_id,permission,scope,granted) values ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pipeline.edit','all',true);
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'AUTHORITY_STALE','permission provenance mutation denied');delete from public.user_permission_overrides;
perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',jsonb_set(runtime.request('{"description":"Cross tenant"}','runtime-tenant-001'),'{opportunity_id}','"30000000-0000-4000-8000-000000000002"')),'RECORD_NOT_FOUND','cross tenant source denied');
perform runtime.rejects(format('select public.commit_agent_customer_update_as_actor(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L)','10000000-0000-4000-8000-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',p->>'action_id',p->>'change_set_id',p->>'preview_sha256','runtime-other-001'),'RECORD_NOT_FOUND','cross tenant commit denied');
perform runtime.assert((select to_jsonb(o)=before_row from public.opportunities o where id='30000000-0000-4000-8000-000000000001'),'all rejected commits leave business row unchanged');
end $$;

-- Real canonical core, real guard token consumption, real event trigger and delayed activity-trigger re-entry.
do $$ declare p jsonb;r jsonb;eid uuid;begin
p:=runtime.prepare(runtime.request('{"assigned_to":"10000000-0000-4000-8000-000000000002","description":"Assigned confirmed lead"}','runtime-assign-001'));
r:=runtime.commit(p);perform runtime.assert((r#>>'{readback,assignment_version}')::int=1,'canonical assignment version increments');
select id into eid from public.opportunity_assignment_events where source='agent_customer_update';
perform runtime.assert(eid is not null,'canonical assignment event exists');
perform runtime.assert((select count(*)=1 and bool_and(not notify) from public.opportunity_assignment_deliveries where assignment_event_id=eid),'assignment delivery retained without push');
perform private.enqueue_email_assignment_contact_form_draft(eid,null);
insert into public.activities(id,company_id,opportunity_id,type,subject,direction,email_connection_id,email_message_id,email_thread_id,from_email,body_text) values ('60000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','30000000-0000-4000-8000-000000000001','email','Delayed source','inbound','70000000-0000-4000-8000-000000000001','fixture-message','fixture-thread','customer@example.invalid','Confirmed details');
perform runtime.assert((select count(*)=0 from public.email_assignment_contact_form_draft_queue),'assignment and delayed activity never enqueue provider work');
perform runtime.assert((select count(*)=0 from private.opportunity_assignment_write_tokens),'real assignment write guard consumes token');
end $$;

-- Customer notes remain optional and must reject accounting connection presence.
do $$ declare p jsonb;r jsonb;begin
p:=runtime.prepare(runtime.request('{}','runtime-customer-001',true));r:=runtime.commit(p);perform runtime.assert(r#>>'{readback,customer,notes}'='Updated fixture notes','linked customer notes commit');
insert into public.accounting_connections(company_id,provider) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','quickbooks');
perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',runtime.request('{}','runtime-account-001',true)),'ACCOUNTING_SIDE_EFFECT','even inactive accounting connection blocks notes');
delete from public.accounting_connections;
end $$;

select 'Phase12 PostgreSQL runtime fixture completed' as result;

-- Expiry and rejection cannot authorize a write.
do $$ declare p jsonb;begin
p:=runtime.prepare(runtime.request('{"title":"Must expire"}','runtime-expire-001'));
update public.agent_actions set expires_at=clock_timestamp()-interval '1 second' where id=(p->>'action_id')::uuid;
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'CONFIRMATION_STALE','expired approval denied');
p:=runtime.prepare(runtime.request('{"title":"Must reject"}','runtime-reject-001'));
perform public.reject_agent_customer_update_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(p->>'action_id')::uuid,'Fixture veto');
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'CONFIRMATION_STALE','rejected proposal denied');
end $$;

-- Deliberate runtime fault: a misbehaving trigger must roll back ALL canonical effects.
-- Installing the fixture trigger before preparation makes it part of the approved policy fixture.
create function runtime.corrupt_update() returns trigger language plpgsql as $$ begin if new.description='Force rollback' then new.description:='Unexpected trigger rewrite';end if;return new;end $$;
create trigger runtime_corrupt before update on public.opportunities for each row execute function runtime.corrupt_update();
update private.agent_customer_update_policy set effect_revision=private.agent_customer_update_effect_revision();
do $$ declare p jsonb;n bigint;d bigint;v bigint;begin
select count(*) into n from public.opportunity_assignment_events;select count(*) into d from public.opportunity_assignment_deliveries;select assignment_version into v from public.opportunities where id='30000000-0000-4000-8000-000000000001';
p:=runtime.prepare(runtime.request('{"assigned_to":"10000000-0000-4000-8000-000000000001","description":"Force rollback"}','runtime-rollback-001'));
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'READBACK_FAILED','readback mismatch rejects transaction');
perform runtime.assert((select count(*)=n from public.opportunity_assignment_events) and (select count(*)=d from public.opportunity_assignment_deliveries) and (select assignment_version=v and assigned_to='10000000-0000-4000-8000-000000000002' from public.opportunities where id='30000000-0000-4000-8000-000000000001'),'failure rolls back assignment event delivery and target');
perform runtime.assert((select committed_at is null from private.agent_customer_updates where id=(p->>'change_set_id')::uuid),'failed commit has no receipt');
end $$;
drop trigger runtime_corrupt on public.opportunities;
update private.agent_customer_update_policy set effect_revision=private.agent_customer_update_effect_revision();
select 'All Phase12 PostgreSQL runtime checks completed' as result;

-- Changing a nested helper, without changing the trigger wrapper, invalidates existing approval.
do $$ declare p jsonb;original text;begin
p:=runtime.prepare(runtime.request('{"title":"Seal dependency check"}','runtime-helper-001'));
select pg_get_functiondef('private.enqueue_email_assignment_contact_form_draft(uuid,uuid)'::regprocedure) into original;
execute replace(original,E'begin\n',E'begin\n -- Runtime dependency mutation\n');
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'POLICY_CHANGED','nested provider helper mutation invalidates seal');
execute original;
end $$;

-- Observe helper invocation and put a tripwire immediately AFTER the permanent source guard.
-- The actual helper/core are retained; instrumentation proves the branch is exercised,
-- rather than passing because another ordinary source eligibility guard returned first.
create table runtime.enqueue_observations(id bigserial,event_id uuid);
do $$ declare original text;instrumented text;eid uuid;n bigint;begin
select pg_get_functiondef('private.enqueue_email_assignment_contact_form_draft(uuid,uuid)'::regprocedure) into original;
instrumented:=replace(original,E'begin\n',E'begin\n insert into runtime.enqueue_observations(event_id) values(p_assignment_event_id);\n');
instrumented:=replace(instrumented,'if event.source = ''agent_customer_update'' then return; end if;','if event.source = ''agent_customer_update'' then return; end if; raise exception ''RUNTIME_AFTER_SOURCE_GUARD'';');
perform runtime.assert(instrumented<>original,'enqueue observation hook installed');execute instrumented;
select id into eid from public.opportunity_assignment_events where source='agent_customer_update' limit 1;
perform private.enqueue_email_assignment_contact_form_draft(eid,null);
select count(*) into n from runtime.enqueue_observations;
insert into public.activities(company_id,opportunity_id,type,subject,direction,email_connection_id,email_message_id,email_thread_id,from_email,body_text) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','30000000-0000-4000-8000-000000000001','email','Second delayed source','inbound','70000000-0000-4000-8000-000000000001','fixture-message-2','fixture-thread','customer@example.invalid','Confirmed details');
perform runtime.assert((select count(*)=n+1 from runtime.enqueue_observations),'real delayed activity trigger invokes permanently suppressed helper');
perform runtime.rejects($q$insert into public.opportunity_assignment_events(company_id,opportunity_id,new_assignee_id,actor_user_id,source,assignment_version) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','manual',1)$q$,'RUNTIME_AFTER_SOURCE_GUARD','ordinary source reaches post-suppression tripwire');
execute original;
end $$;
select runtime.assert(not has_function_privilege('anon','public.prepare_agent_customer_update_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,jsonb,timestamptz)','execute') and not has_function_privilege('authenticated','public.commit_agent_customer_update_as_actor(uuid,uuid,uuid,uuid,text,text)','execute'),'public and authenticated cannot call privileged prepare/commit RPCs');
select 'Final Phase12 checks complete' result;

-- Pending suggestion phantom makes an old approval stale; exact count is reflected and superseded.
do $$ declare p jsonb;q jsonb;r jsonb;begin
q:=runtime.request('{"assigned_to":"10000000-0000-4000-8000-000000000001"}','runtime-suggestions-001');p:=runtime.prepare(q);
insert into public.opportunity_assignment_suggestions(company_id,opportunity_id,suggested_user_id,confidence,reason,generator_version) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'Fixture suggestion','fixture-v1');
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'SOURCE_STALE','new pending suggestion invalidates approval');
p:=runtime.prepare(runtime.request('{"assigned_to":"10000000-0000-4000-8000-000000000001"}','runtime-suggestions-002'));r:=runtime.commit(p);
perform runtime.assert((r#>>'{effects,assignment_suggestions_resolved}')::int=1 and (select count(*)=1 from public.opportunity_assignment_suggestions where resolution_state='superseded'),'exact pending suggestion count superseded');
end $$;

insert into public.email_connections(id,company_id,email,access_token,refresh_token,expires_at,type) values ('70000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fixture@example.invalid','synthetic-access','synthetic-refresh',clock_timestamp()+interval '1 hour','company');
update public.activities set body_text_clean='Customer confirmed the roof size and finish.' where id='60000000-0000-4000-8000-000000000001';
do $$ declare q jsonb;p jsonb;begin
q:=runtime.request('{"description":"Supported details"}','runtime-correspondence-001');
q:=jsonb_set(q,'{evidence}','[{"kind":"correspondence","activity_id":"60000000-0000-4000-8000-000000000001","excerpt":"Customer confirmed the roof size and finish.","supports":["description"]}]');
p:=runtime.prepare(q);perform runtime.assert(p#>>'{proposal,evidence,0,kind}'='correspondence','real correspondence attribution accepted');
update public.activities set body_text_clean='Changed source after approval.' where id='60000000-0000-4000-8000-000000000001';
perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'EVIDENCE_MISSING','changed correspondence blocks commit');
q:=jsonb_set(q,'{idempotency_key}','"runtime-forged-001"');
perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',q),'EVIDENCE_MISSING','forged excerpt rejected');
q:=runtime.request('{"description":"Missing support"}','runtime-support-001');q:=jsonb_set(q,'{evidence,0,supports}','["title"]');
perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',q),'EVIDENCE_CONFLICT','wrong field support rejected');
q:=runtime.request('{"next_follow_up_at":"infinity"}','runtime-baddate-001');
perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',q),'DATE_INVALID','non-ISO infinite date rejected');
end $$;
select 'Extended Phase12 runtime checks complete' result;
