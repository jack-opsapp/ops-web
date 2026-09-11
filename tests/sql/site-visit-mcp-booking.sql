-- Actual canonical public RPCs + granular authority + calendar trigger.
insert into public.companies(id,name,public_handle) values
('10000000-0000-4000-8000-000000000002','Booking fixture','booking-fixture'),
('10000000-0000-4000-8000-000000000003','Other fixture','other-fixture');
insert into public.users(id,company_id,first_name,last_name,firebase_uid) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Assigned','Operator','fixture-firebase-non-uuid'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','Other','Operator','other-firebase');
insert into public.user_permission_overrides(user_id,company_id,permission,scope,granted)
select '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',p,'assigned',true
from unnest(array['pipeline.view','pipeline.edit','pipeline.convert']) p;
insert into public.opportunities(id,company_id,title,assigned_to) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Assigned lead','20000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Unassigned lead',null);
insert into private.site_visit_concurrency_companies values('10000000-0000-4000-8000-000000000002');
insert into public.email_connections(company_id,email,access_token,refresh_token,expires_at,granted_scopes)
values('10000000-0000-4000-8000-000000000002','local-fixture@example.invalid','not-a-credential','not-a-credential',now()+interval '1 day',array['https://www.googleapis.com/auth/calendar.events']);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fixture-firebase-non-uuid"}',false);
do $$ declare visit uuid; activity uuid; at_time timestamptz:=now()+interval '2 days'; before_count int;begin
 -- Intentionally fails on the baseline: no private explicit actor booking exists.
 visit:=private.book_site_visit_for_actor('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',at_time,60,null,30);
 if not exists(select 1 from public.site_visits where id=visit and booked_at is not null and assignee_ids=array['20000000-0000-4000-8000-000000000001'] and status='scheduled') then raise exception 'booking readback failed';end if;
 if not exists(select 1 from public.opportunities where id='30000000-0000-4000-8000-000000000001' and stage='qualifying') or (select count(*) from public.stage_transitions)<>1 then raise exception 'canonical stage transition lost';end if;
 select activity_id into activity from public.site_visits where id=visit;
 if not exists(select 1 from public.activities where id=activity and site_visit_id=visit and subject='Site visit booked' and created_by='20000000-0000-4000-8000-000000000001') then raise exception 'canonical activity lost';end if;
 raise notice 'PASS: canonical actor booking, exact crew, activity and stage transition';
 if (select count(*) from public.google_calendar_sync_queue where site_visit_id=visit and operation='create' and status='pending')<>1 then raise exception 'calendar create not queued';end if;
 raise notice 'PASS: canonical calendar create is queued, never claimed reconciled';
 begin perform public.book_site_visit('30000000-0000-4000-8000-000000000001',at_time);raise exception 'duplicate accepted';exception when sqlstate '55000' then null;end;
 begin perform public.book_site_visit('30000000-0000-4000-8000-000000000002',at_time);raise exception 'wrong scope accepted';exception when insufficient_privilege then null;end;
 raise notice 'PASS: duplicate booking and assigned scope enforcement';
 begin update public.site_visits set scheduled_at=at_time+interval '1 day' where id=visit;raise exception 'legacy overwrite accepted';exception when insufficient_privilege then null;end;
 raise notice 'PASS: delayed raw phone scheduling overwrite rejected';
 before_count:=(select count(*) from public.activities);
 perform public.reschedule_site_visit(visit,null,null,null,null);
 if (select count(*) from public.activities)<>before_count then raise exception 'noop activity duplicated';end if;
 perform public.reschedule_site_visit(visit,at_time+interval '3 hours',90,null,-1);
 if not exists(select 1 from public.site_visits where id=visit and scheduled_at=at_time+interval '3 hours' and duration_minutes=90 and reminder_lead_minutes is null) then raise exception 'reschedule semantics changed';end if;
 raise notice 'PASS: public reschedule keeps nullable fields and clears reminder with minus one';
 if (select count(*) from public.google_calendar_sync_queue where site_visit_id=visit and operation='update' and status='pending')<>1 then raise exception 'calendar update not queued';end if;
 perform public.cancel_site_visit_booking(visit);
 if exists(select 1 from public.google_calendar_sync_queue where site_visit_id=visit and operation in('create','update') and status='pending')
 or (select count(*) from public.google_calendar_sync_queue where site_visit_id=visit and operation='delete' and status='pending')<>1 then raise exception 'calendar cancellation queue not preserved';end if;
 raise notice 'PASS: cancellation neutralizes pending create/update and queues deletion';
 before_count:=(select count(*) from public.activities);
 perform public.cancel_site_visit_booking(visit);
 if (select count(*) from public.activities)<>before_count then raise exception 'cancel replay activity duplicated';end if;
 begin perform public.reschedule_site_visit(visit,at_time);raise exception 'cancelled visit rescheduled';exception when sqlstate '55000' then null;end;
 raise notice 'PASS: canonical cancellation replay and terminal denial';
 visit:=public.book_site_visit('30000000-0000-4000-8000-000000000001',at_time);
 update public.site_visits set status='in_progress' where id=visit;
 begin perform public.cancel_site_visit_booking(visit);raise exception 'capture cancelled';exception when sqlstate '55000' then null;end;
 perform public.complete_site_visit_guarded(visit,'{"notes":"Actual site notes"}');
 if not exists(select 1 from public.site_visits v join public.activities a on a.id=v.activity_id where v.id=visit and v.status='completed' and a.type='site_visit') then raise exception 'completion activity link rejected';end if;
 raise notice 'PASS: phone capture and canonical completion remain functional';
 if has_function_privilege('authenticated','private.book_site_visit_for_actor(uuid,uuid,timestamptz,integer,text[],integer)','execute')
 or has_function_privilege('service_role','private.allow_site_visit_booking_write(uuid,text,jsonb)','execute')
 or has_table_privilege('anon','private.site_visit_booking_write_tokens','insert') then raise exception 'private authority leaked';end if;
 if exists(select 1 from private.site_visit_booking_write_tokens) then raise exception 'unconsumed token';end if;
 raise notice 'PASS: explicit actor cores and booking tokens are private and single-use';
end $$;
-- Run the deletion attempt as the real phone database role, with the captured
-- production policies and grants. The guard, not a test-only missing grant, denies it.
set role authenticated;
do $$ declare visit uuid;begin
 select id into visit from public.site_visits where booked_at is not null limit 1;
 if visit is null then raise exception 'RLS fixture cannot see its own booking';end if;
 begin delete from public.site_visits where id=visit;raise exception 'raw booked delete accepted';
 exception when insufficient_privilege then
  if sqlerrm<>'SITE_VISIT_BOOKING_RPC_REQUIRED' then raise;end if;
 end;
 raise notice 'PASS: authenticated raw DELETE rejected by booking guard with actual RLS';
end $$;
reset role;
-- The existing approved-task capacity fence remains active alongside the new guard.
insert into public.projects(id,company_id,title) values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Capacity project');
insert into public.project_tasks(id,company_id,project_id,all_day,start_date,end_date,team_member_ids)
values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',false,now()+interval '10 days',now()+interval '10 days 2 hours',array['20000000-0000-4000-8000-000000000001']);
insert into private.agent_schedule_capacity_fences(task_id,schedule_version,company_id,change_set_id,starts_at,ends_at,crew)
select id,0,company_id,'60000000-0000-4000-8000-000000000001',start_date,end_date,team_member_ids from public.project_tasks;
do $$ begin
 begin perform public.book_site_visit('30000000-0000-4000-8000-000000000001',now()+interval '10 days 30 minutes');raise exception 'approved task capacity bypassed';
 exception when exclusion_violation then
  if sqlerrm<>'AGENT_APPROVED_SCHEDULE_CAPACITY_CONFLICT' then raise;end if;
 end;
 raise notice 'PASS: existing approved-task capacity guard still rejects conflicting booking';
end $$;
