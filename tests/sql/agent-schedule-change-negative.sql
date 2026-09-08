
set timezone='UTC';
set request.jwt.claim.role='service_role';
update private.mcp_oauth_grants set revoked_at=null;
\ir agent-schedule-change-booking-functions.sql
update public.users set auth_id='schedule-fixture-auth' where id='10000000-0000-4000-8000-000000000001';
set request.jwt.claims='{"sub":"schedule-fixture-auth","company_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
create function runtime.next_request(key text) returns jsonb language sql as $$
 select jsonb_set(runtime.schedule_request(key),'{tasks,0,destination_date}',to_jsonb(to_char((t.start_date at time zone 'UTC')::date+7,'YYYY-MM-DD')))
 from public.project_tasks t where id='40000000-0000-4000-8000-000000000001'
$$;
create function runtime.insert_visit(at_time timestamptz,members text[] default array['10000000-0000-4000-8000-000000000001'],visit_status public.site_visit_status default 'scheduled') returns uuid
language plpgsql as $$ declare id uuid;begin
 insert into public.site_visits(company_id,scheduled_at,duration_minutes,assignee_ids,status,created_by,booked_at,project_ref)
 values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at_time,60,members,visit_status,'10000000-0000-4000-8000-000000000001',clock_timestamp(),'20000000-0000-4000-8000-000000000001') returning site_visits.id into id;return id;
end $$;

-- The capacity fence prevents a later actual staff reschedule, not just our own
-- source-builder query, while leaving a nonconflicting appointment unchanged.
do $$ declare at_time timestamptz;visit uuid;begin
 select starts_at+interval '9 hours' into at_time from private.agent_schedule_capacity_fences limit 1;
 perform runtime.rejects(format('select runtime.insert_visit(%L::timestamptz)',at_time),'CAPACITY_CONFLICT','new booked visit cannot overlap approved crew');
 perform runtime.rejects(format('select runtime.insert_visit(%L::timestamptz,null)',at_time),'CAPACITY_CONFLICT','unassigned booked visit cannot evade capacity fence');
 visit:=runtime.insert_visit(at_time+interval '1 day');
 perform runtime.rejects(format('select public.reschedule_site_visit(%L::uuid,%L::timestamptz)',visit,at_time),'CAPACITY_CONFLICT','real staff reschedule rejects approved task overlap');
 perform runtime.assert((select scheduled_at=at_time+interval '1 day' from public.site_visits where id=visit),'rejected staff reschedule leaves appointment unchanged');
 delete from public.site_visits where id=visit;
 perform runtime.rejects(format('insert into private.guest_booking_intents(company_id,integration_id,slot_start_at,duration_minutes,hold_expires_at,network_fingerprint,state) values(%L::uuid,gen_random_uuid(),%L::timestamptz,60,clock_timestamp()+interval ''5 minutes'',%L,%L)','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at_time,'fixture','verified'),'CAPACITY_CONFLICT','verified guest hold cannot overlap approved crew');
end $$;

-- Canonical conflict source semantics, including inclusive all-day absences.
do $$ declare req jsonb;p jsonb;day date;visit uuid;event uuid:=gen_random_uuid();begin
 req:=runtime.next_request('negative-availability-001');day:=(req#>>'{tasks,0,destination_date}')::date;
 insert into public.calendar_user_events(id,user_id,company_id,type,status,start_date,end_date,all_day)
 values(event,'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','time_off','approved',day::timestamp at time zone 'UTC',day::timestamp at time zone 'UTC',true);
 perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',req),'AVAILABILITY_CONFLICT','single-day all-day absence blocks work');
 update public.calendar_user_events set status='denied' where id=event;
 p:=runtime.prepare(req);perform runtime.assert(p->>'status'='approval_required','denied absence does not block work');
 delete from public.calendar_user_events where id=event;
 visit:=runtime.insert_visit(day::timestamp at time zone 'UTC'+interval '9 hours',null,'in_progress');
 perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',runtime.next_request('negative-availability-002')),'AVAILABILITY_CONFLICT','in-progress unassigned visit blocks target day');
 delete from public.site_visits where id=visit;
 insert into private.guest_booking_intents(company_id,integration_id,slot_start_at,duration_minutes,hold_expires_at,network_fingerprint,state)
 values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid(),day::timestamp at time zone 'UTC'+interval '9 hours',60,clock_timestamp()+interval '5 minutes','fixture','verified');
 perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',runtime.next_request('negative-availability-003')),'AVAILABILITY_CONFLICT','verified guest hold blocks target day');
 delete from private.guest_booking_intents;
end $$;

do $$ declare p jsonb;req jsonb;original jsonb;events bigint;begin
 req:=runtime.next_request('negative-seal-001');p:=runtime.prepare(req);
 select to_jsonb(t) into original from public.project_tasks t limit 1;
 select count(*) into events from public.task_mutation_events;
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',jsonb_set(p,'{preview_sha256}',to_jsonb('sha256:'||repeat('0',64)))),'IDEMPOTENCY_CONFLICT','substituted approval seal rejected');
 perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',jsonb_set(req,'{reason}','"Different instruction"')),'IDEMPOTENCY_CONFLICT','prepare key cannot bind different input');
 update public.agent_actions set action_data=jsonb_set(action_data,'{proposal,reason}','"Hidden edit"') where id=(p->>'action_id')::uuid;
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'CONFIRMATION_STALE','edited displayed preview invalidates approval');
 p:=runtime.prepare(runtime.next_request('negative-expiry-001'));
 update public.agent_actions set expires_at=clock_timestamp()-interval '1 second' where id=(p->>'action_id')::uuid;
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'CONFIRMATION_STALE','expired approval cannot write');
 p:=runtime.prepare(runtime.next_request('negative-cancel-001'));
 perform public.reject_agent_schedule_change_as_actor('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(p->>'action_id')::uuid,'Leave unchanged');
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'CONFIRMATION_STALE','cancelled approval cannot write');
 p:=runtime.prepare(runtime.next_request('negative-scope-drift-001'));
 insert into public.task_scopes(id,company_id,task_id,task_type_id,note) values(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Additional included work');
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'SOURCE_STALE','new scope insertion invalidates complete preview');
 delete from public.task_scopes;
 perform runtime.assert((select to_jsonb(t)=original from public.project_tasks t limit 1) and (select count(*)=events from public.task_mutation_events),'all rejected approvals leave task and history unchanged');
end $$;

-- A new booking after prepare must be noticed again at approval.
do $$ declare p jsonb;req jsonb;visit uuid;begin
 req:=runtime.next_request('negative-booking-drift-001');p:=runtime.prepare(req);
 visit:=runtime.insert_visit((req#>>'{tasks,0,destination_date}')::date::timestamp at time zone 'UTC'+interval '9 hours');
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'AVAILABILITY_CONFLICT','booking inserted after preparation blocks approval');
 delete from public.site_visits where id=visit;
end $$;

-- Full-row token readback must roll back every downstream effect on corruption.
create function runtime.corrupt_schedule() returns trigger language plpgsql as $$ begin new.task_notes:='unapproved mutation'; return new; end $$;
create trigger runtime_corrupt before update on public.project_tasks for each row execute function runtime.corrupt_schedule();
update private.agent_schedule_change_policy set effect_revision=private.agent_schedule_change_effect_revision();
do $$ declare p jsonb;original jsonb;events bigint;outbox bigint;begin
 p:=runtime.prepare(runtime.next_request('negative-readback-001'));
 select to_jsonb(t) into original from public.project_tasks t limit 1;
 select count(*) into events from public.task_mutation_events;select count(*) into outbox from public.task_schedule_automation_outbox;
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'WRITE_TOKEN_MISMATCH','unexpected trigger mutation rolls back exact approval');
 perform runtime.assert((select to_jsonb(t)=original from public.project_tasks t limit 1) and (select count(*)=events from public.task_mutation_events)
 and (select count(*)=outbox from public.task_schedule_automation_outbox),'failed write rolls back task history and outbox together');
 perform runtime.assert((select committed_at is null from private.agent_schedule_changes where id=(p->>'change_set_id')::uuid),'failed write cannot persist success receipt');
end $$;
drop trigger runtime_corrupt on public.project_tasks;
update private.agent_schedule_change_policy set effect_revision=private.agent_schedule_change_effect_revision();
