\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
grant usage on schema runtime to authenticated;
grant execute on all functions in schema runtime to authenticated;
update public.users set auth_id='fixture-jackson' where id='10000000-0000-4000-8000-000000000001';
update public.users set auth_id='fixture-other-reviewer' where id='10000000-0000-4000-8000-000000000002';
insert into public.agent_actions(id,company_id,user_id,action_type,action_data,context_summary) values ('80000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','create_task','{}','Legacy fixture action');
select set_config('runtime.action',(select action_id::text from private.agent_customer_updates where request#>>'{evidence,0,kind}'='correspondence' limit 1),false);
select set_config('request.jwt.claims','{"sub":"fixture-jackson","company_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',false);
set request.jwt.claim.role='authenticated';
set role authenticated;
select runtime.assert((select count(*)=1 from public.agent_actions where id=current_setting('runtime.action')::uuid),'authenticated own authorized preview readable');
select runtime.assert((select count(*)=1 from public.agent_actions where id='80000000-0000-4000-8000-000000000001'),'legacy company-scoped action remains readable');
with changed as(update public.agent_actions set context_summary='Browser rewrite' where id=current_setting('runtime.action')::uuid returning id) select runtime.assert((select count(*)=0 from changed),'browser UPDATE cannot change Phase12 action');
with changed as(delete from public.agent_actions where id=current_setting('runtime.action')::uuid returning id) select runtime.assert((select count(*)=0 from changed),'browser DELETE cannot remove Phase12 action');
select runtime.rejects($q$insert into public.agent_actions(company_id,user_id,action_type,action_data,context_summary) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','approve_customer_update','{}','Browser fake')$q$,'row-level security','browser INSERT cannot forge Phase12 action');
select runtime.rejects($q$update public.agent_actions set action_type='approve_customer_update' where id='80000000-0000-4000-8000-000000000001'$q$,'row-level security','browser cannot retag legacy action to Phase12');
select set_config('request.jwt.claims','{"sub":"fixture-other-reviewer","company_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',false);
select runtime.assert((select count(*)=0 from public.agent_actions where id=current_setting('runtime.action')::uuid),'other same-company reviewer cannot SELECT preview');
reset role;
set request.jwt.claim.role='service_role';
select runtime.assert(cardinality(public.filter_agent_customer_update_actions_as_actor('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array[current_setting('runtime.action')::uuid]))=0,'service filter denies wrong actor');
-- Give the named actor all relevant rights except email.view, using real permission tables.
update public.users set is_company_admin=false where id='10000000-0000-4000-8000-000000000001';
insert into public.user_permission_overrides(user_id,company_id,permission,scope,granted) select '10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p,'all',true from unnest(array['agent.review','pipeline.view','pipeline.edit','pipeline.assign','team.view','clients.view','clients.edit','inbox.view_company']) p;
select set_config('request.jwt.claims','{"sub":"fixture-jackson","company_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',false);
set request.jwt.claim.role='authenticated';
set role authenticated;
select runtime.assert((select count(*)=0 from public.agent_actions where id=current_setting('runtime.action')::uuid),'own actor missing email permission cannot SELECT correspondence preview');
reset role;
set request.jwt.claim.role='service_role';
select runtime.assert(cardinality(public.filter_agent_customer_update_actions_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array[current_setting('runtime.action')::uuid]))=0,'service filter denies missing source permission');
update public.users set is_company_admin=true where id='10000000-0000-4000-8000-000000000001';
delete from public.user_permission_overrides;
select runtime.assert(cardinality(public.filter_agent_customer_update_actions_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array[current_setting('runtime.action')::uuid]))=1,'service filter permits named authorized actor');

do $$ declare p jsonb;r jsonb;begin
p:=runtime.prepare(runtime.request('{"description":"Decline after disconnection"}','runtime-revoke-decline-001'));
update private.mcp_oauth_grants set revoked_at=clock_timestamp() where id='50000000-0000-4000-8000-000000000001';
r:=public.reject_agent_customer_update_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(p->>'action_id')::uuid,'Decline fixture');
perform runtime.assert(r->>'effect'='left_unchanged_inside_ops','named actor can safely decline after OAuth revocation');
perform runtime.assert((select status='rejected' from public.agent_actions where id=(p->>'action_id')::uuid) and (select is_read and not persistent from public.notifications where dedupe_key='customer-update:'||(p->>'action_id')),'safe decline resolves action and persistent notification');
update private.mcp_oauth_grants set revoked_at=null where id='50000000-0000-4000-8000-000000000001';
end $$;
select 'Phase12 privacy checks complete' result;
