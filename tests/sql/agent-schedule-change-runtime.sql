\set ON_ERROR_STOP on
set timezone='UTC';
set request.jwt.claim.role='service_role';
create schema runtime;
create function runtime.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
insert into public.companies(id,name,public_handle,timezone) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Schedule fixture','schedule-fixture','UTC');
insert into public.users(id,company_id,first_name,last_name,is_company_admin) values ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Operator','Fixture',true),('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Crew','Fixture',true);
insert into public.projects(id,company_id,title,status) values ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture project','accepted');
insert into public.task_types(id,company_id,display) values ('30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Install');
insert into public.project_tasks(id,company_id,project_id,task_type_id,duration,start_date,end_date,team_member_ids) values ('40000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'2026-09-10T00:00:00Z','2026-09-10T00:00:00Z',array['10000000-0000-4000-8000-000000000001']);
-- Exercise the actual live RPC, not merely a stand-alone operator expression.
do $$ declare caught boolean:=false; begin
  begin
    perform private.update_task_with_event_for_actor('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',(select updated_at from public.project_tasks limit 1),'{"start_date":"2026-09-11T00:00:00Z","end_date":"2026-09-11T00:00:00Z"}');
  exception when undefined_function then
    if sqlerrm not like '%time without time zone !~%' then raise; end if;
    caught:=true;
  end;
  perform runtime.assert(caught,'live canonical RPC reproduces time regex type failure');
  perform runtime.assert((select start_date='2026-09-10T00:00:00Z'::timestamptz from public.project_tasks limit 1),'failed canonical write leaves task untouched');
end $$;
\ir ../../supabase/migrations/20260906234703_task_mutation_time_validation.sql
do $$ declare result jsonb; begin
  result:=private.update_task_with_event_for_actor('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',(select updated_at from public.project_tasks limit 1),'{"start_date":"2026-09-11T00:00:00Z","end_date":"2026-09-11T00:00:00Z"}');
  perform runtime.assert((result->>'ok')::boolean and (result->>'changed')::boolean,'repaired canonical RPC accepts valid native time columns');
  perform runtime.assert((select start_date='2026-09-11T00:00:00Z'::timestamptz from public.project_tasks limit 1),'independent canonical task readback matches date');
end $$;

CREATE TRIGGER project_tasks_bump_schedule_version BEFORE INSERT OR UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION private.bump_project_task_schedule_version();
CREATE TRIGGER project_tasks_enqueue_schedule_automation AFTER INSERT OR UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION private.enqueue_task_schedule_automation();
CREATE TRIGGER project_tasks_guard_parent_lifecycle BEFORE INSERT OR UPDATE OF project_id, company_id, status, deleted_at ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION private.guard_project_task_parent_lifecycle();
CREATE TRIGGER project_tasks_guard_task_type_reference BEFORE INSERT OR UPDATE OF task_type_id, company_id, deleted_at ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION private.guard_project_task_task_type_reference();
CREATE TRIGGER project_tasks_stamp_scopes_on_completion AFTER UPDATE OF status ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION private.stamp_scopes_on_task_completion();
CREATE TRIGGER project_tasks_sync_project_team_member_ids AFTER INSERT OR DELETE OR UPDATE OF team_member_ids, deleted_at, project_id ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION private.sync_project_team_member_ids_from_tasks();
CREATE TRIGGER trg_project_tasks_after_update_reminders AFTER UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION tg_project_tasks_reschedule_reminders();
CREATE TRIGGER update_project_tasks_timestamp BEFORE UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER task_scopes_guard_refs BEFORE INSERT OR UPDATE OF task_id, task_type_id, company_id ON public.task_scopes FOR EACH ROW EXECUTE FUNCTION private.guard_task_scope_refs();
CREATE TRIGGER update_task_scopes_timestamp BEFORE UPDATE ON public.task_scopes FOR EACH ROW EXECUTE FUNCTION update_timestamp();
\ir ../../supabase/migrations/20260906235016_agent_schedule_crew_approval.sql

-- Candidate consent is installed ONLY in this disposable test database. Production
-- deliberately has no v11 catalogue/grants, so dormant SQL cannot activate itself.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.mcp_oauth_labels_for_scopes(text[],text)'::regprocedure);
 execute replace(definition,'private.mcp_oauth_labels_for_scopes','runtime.previous_labels');
end $$;
create or replace function private.mcp_oauth_labels_for_scopes(p_scopes text[],p_consent_catalog_revision text) returns text[] language plpgsql immutable as $$
begin
 if p_consent_catalog_revision='2026-09-06.mcp-consent-catalog.v11' then
   if p_scopes is distinct from array['ops.jobs.read','ops.schedule.prepare','ops.schedule.read','ops.site_visits.read','ops.tasks.read','ops.team.read'] then raise exception 'fixture_consent_scope_invalid'; end if;
   return array['Read jobs','Prepare exact schedule changes','Read schedule','Read site visits','Read tasks','Read team'];
 end if;
 return runtime.previous_labels(p_scopes,p_consent_catalog_revision);
end $$;
insert into private.mcp_oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,response_types,scope,registration_source,scope_ceiling,consent_catalog_revision,exposure_revision)
select '50000000-0000-4000-8000-000000000001','Schedule fixture',array['https://example.invalid/callback'],'none',array['authorization_code'],array['code'],array_to_string(s,' '),'fixture',s,'2026-09-06.mcp-consent-catalog.v11','2026-09-06.mcp-exposure.v16'
from(select array['ops.jobs.read','ops.schedule.prepare','ops.schedule.read','ops.site_visits.read','ops.tasks.read','ops.team.read']::text[] s)x;
insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
select '60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',client_id,scope_ceiling,repeat('a',32),private.mcp_oauth_labels_for_scopes(scope_ceiling,consent_catalog_revision),consent_catalog_revision,exposure_revision from private.mcp_oauth_clients;
create function runtime.schedule_request(key text) returns jsonb language sql as $$
 select jsonb_build_object('tasks',jsonb_build_array(jsonb_build_object('task_id',t.id,'expected_updated_at',t.updated_at,'expected_schedule_version',t.schedule_version,
 'destination_date',to_char(current_date+14+(8-extract(isodow from current_date)::integer)%7,'YYYY-MM-DD'),'team_member_ids',t.team_member_ids)),
 'reason','Move this exact fixture task.','idempotency_key',key) from public.project_tasks t where id='40000000-0000-4000-8000-000000000001'
$$;
create function runtime.prepare(request jsonb) returns jsonb language plpgsql as $$
declare perms text[]:=array['agent.review','calendar.edit','calendar.view','projects.view','tasks.assign','tasks.edit','tasks.view','team.view']; rev text;g private.mcp_oauth_grants%rowtype; proof jsonb;
begin
 select * into g from private.mcp_oauth_grants where id='60000000-0000-4000-8000-000000000001';
 select permission_snapshot_revision into rev from private.resolve_agent_actor_authority(g.user_id,g.company_id,perms);
 proof:=public.inspect_agent_schedule_change_as_system(g.user_id,g.company_id,g.id,g.client_id,g.revision,g.scopes,rev,perms,'2026-09-06.capability-manifest.v22','2026-09-06.mcp-exposure.v16','prepare_schedule_change','prepare_schedule_change:2026-09-06.v1',request);
 return public.prepare_agent_schedule_change_as_system(g.user_id,g.company_id,g.id,g.client_id,g.revision,g.scopes,rev,perms,'2026-09-06.capability-manifest.v22','2026-09-06.mcp-exposure.v16','prepare_schedule_change','prepare_schedule_change:2026-09-06.v1','runtime-schedule',request,clock_timestamp(),proof);
end $$;
create function runtime.commit(preview jsonb,key text default 'commit-schedule-fixture') returns jsonb language sql as $$
 select public.commit_agent_schedule_change_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(preview->>'action_id')::uuid,(preview->>'change_set_id')::uuid,preview->>'preview_sha256',key)
$$;
create function runtime.rejects(statement text,expected text,label text) returns void language plpgsql as $$ declare caught boolean:=false; begin begin execute statement;exception when others then if sqlerrm not like '%'||expected||'%' then raise exception 'FAIL % unexpected error %',label,sqlerrm;end if;caught:=true;end;perform runtime.assert(caught,label);end $$;
do $$ declare p jsonb; result jsonb; before_row jsonb;begin
 select to_jsonb(t) into before_row from public.project_tasks t limit 1;
 p:=runtime.prepare(runtime.schedule_request('runtime-schedule-001'));
 perform runtime.assert((select to_jsonb(t)=before_row from public.project_tasks t limit 1),'prepare has no task mutation');
 perform runtime.assert((runtime.prepare(runtime.schedule_request('runtime-schedule-001'))->>'replayed')::boolean,'identical preparation replays');
 result:=runtime.commit(p);
 perform runtime.assert((result->>'ok')::boolean,'approved schedule change commits');
 perform runtime.assert((result#>>'{readback,0,schedule,schedule_version}')::bigint=(before_row->>'schedule_version')::bigint+1,'canonical schedule version increments once');
 perform runtime.assert((select count(*)=1 from public.task_mutation_events),'canonical internal schedule history recorded');
 perform runtime.assert((select count(*)=1 from public.task_schedule_automation_outbox where kind='schedule_change'),'internal schedule event remains queued');
 perform runtime.assert((select count(*)=0 from public.task_schedule_automation_outbox where kind in('schedule_cascade','full_auto_confirmation','schedule_unconfirmation_dispatch')),'no automatic cascade confirmation or customer dispatch');
 perform runtime.assert((runtime.commit(p)->>'replayed')::boolean,'commit replay returns existing receipt');
 perform runtime.assert((select count(*)=1 from public.task_mutation_events),'commit replay creates no duplicate history');
 perform runtime.rejects(format('select runtime.commit(%L::jsonb,%L)',p,'different-commit-key'),'IDEMPOTENCY_CONFLICT','different commit key rejected');
 update private.mcp_oauth_grants set revoked_at=clock_timestamp();
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'GRANT_STALE','revoked grant cannot replay receipt');
end $$;
