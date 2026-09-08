set timezone='UTC';
set request.jwt.claim.role='service_role';
update private.mcp_oauth_grants set revoked_at=null;

-- Real crew reassignment, scope preservation and Vancouver reminder readback.
do $$ declare req jsonb;p jsonb;receipt jsonb;day date;reminder uuid:=gen_random_uuid();history uuid:=gen_random_uuid();scope uuid:=gen_random_uuid();before_scope jsonb;begin
 update public.companies set timezone='America/Vancouver' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 req:=runtime.next_request('positive-crew-reminder-001');
 req:=jsonb_set(req,'{tasks,0,team_member_ids}','["10000000-0000-4000-8000-000000000002"]');
 perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',req),'CREW_EXPERIENCE_UNKNOWN','new crew requires recorded experience');
 insert into public.project_tasks select (jsonb_populate_record(null::public.project_tasks,to_jsonb(t)||jsonb_build_object('id',history,'status','completed','start_date',current_date-30,'end_date',current_date-30,'team_member_ids',array['10000000-0000-4000-8000-000000000002']))).* from public.project_tasks t where t.id='40000000-0000-4000-8000-000000000001';
 insert into public.task_scopes(id,company_id,task_id,task_type_id,note) values(scope,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Retain this included work exactly.');
 select to_jsonb(s) into before_scope from public.task_scopes s where id=scope;
 insert into public.task_reminders(id,task_id,company_id,label,lead_time_days,fire_time_local,requires_ack,recipient_mode,fires_at)
 values(reminder,'40000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bring materials',0,'09:00',false,'crew',clock_timestamp());
 day:=(req#>>'{tasks,0,destination_date}')::date;
 p:=runtime.prepare(req);receipt:=runtime.commit(p);
 perform runtime.assert((receipt->>'ok')::boolean and (select team_member_ids=array['10000000-0000-4000-8000-000000000002'] from public.project_tasks where id='40000000-0000-4000-8000-000000000001'),'approved crew reassignment uses canonical task mutation');
 perform runtime.assert((select to_jsonb(s)=before_scope from public.task_scopes s where id=scope),'crew and schedule change preserves complete included scope');
 perform runtime.assert((select fires_at=(day+time '09:00') at time zone 'America/Vancouver' from public.task_reminders where id=reminder),'all-day Vancouver reminder stays on the approved civil day');
 perform runtime.assert((select count(*)>0 from public.task_schedule_automation_outbox where task_id='40000000-0000-4000-8000-000000000001' and kind='task_assigned'),'crew assignment notification remains queued');
 perform runtime.assert((select team_member_ids=array['10000000-0000-4000-8000-000000000002'] from public.projects where id='20000000-0000-4000-8000-000000000001'),'project crew rollup agrees with approved current assignments');
 delete from public.task_reminders where id=reminder;delete from public.task_scopes where id=scope;delete from public.project_tasks where id=history;
 update public.companies set timezone='UTC' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end $$;

-- Two selected tasks are approved atomically, then swap their protected days.
do $$ declare second uuid:=gen_random_uuid();req jsonb;p jsonb;receipt jsonb;first_day date;second_day date;begin
 select (start_date at time zone 'UTC')::date+21 into second_day from public.project_tasks where id='40000000-0000-4000-8000-000000000001';
 insert into public.project_tasks select (jsonb_populate_record(null::public.project_tasks,to_jsonb(t)||jsonb_build_object('id',second,'start_date',second_day,'end_date',second_day))).* from public.project_tasks t where t.id='40000000-0000-4000-8000-000000000001';
 update public.task_schedule_automation_outbox set status='completed' where task_id=second;
 select jsonb_build_object('tasks',jsonb_agg(jsonb_build_object('task_id',id,'expected_updated_at',updated_at,'expected_schedule_version',schedule_version,'destination_date',to_char((start_date at time zone 'UTC')::date+7,'YYYY-MM-DD'),'team_member_ids',team_member_ids) order by id),'reason','Move both exact visits.','idempotency_key','positive-multiple-001') into req
 from public.project_tasks where id in('40000000-0000-4000-8000-000000000001',second);
 p:=runtime.prepare(req);receipt:=runtime.commit(p);
 perform runtime.assert(jsonb_array_length(receipt->'readback')=2,'one approval atomically updates two exact tasks');
 select (start_date at time zone 'UTC')::date into first_day from public.project_tasks where id='40000000-0000-4000-8000-000000000001';
 select (start_date at time zone 'UTC')::date into second_day from public.project_tasks where id=second;
 select jsonb_build_object('tasks',jsonb_agg(jsonb_build_object('task_id',id,'expected_updated_at',updated_at,'expected_schedule_version',schedule_version,'destination_date',to_char(case when id=second then first_day else second_day end,'YYYY-MM-DD'),'team_member_ids',team_member_ids) order by id),'reason','Swap both protected visits.','idempotency_key','positive-swap-001') into req
 from public.project_tasks where id in('40000000-0000-4000-8000-000000000001',second);
 p:=runtime.prepare(req);receipt:=runtime.commit(p);
 perform runtime.assert((select (start_date at time zone 'UTC')::date=second_day from public.project_tasks where id='40000000-0000-4000-8000-000000000001') and (select (start_date at time zone 'UTC')::date=first_day from public.project_tasks where id=second),'protected task dates swap without an intermediate conflict or partial write');
 perform runtime.rejects(format('select public.commit_agent_schedule_change_as_actor(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L)','10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p->>'action_id',p->>'change_set_id',p->>'preview_sha256','commit-schedule-fixture'),'RECORD_NOT_FOUND','another company admin cannot approve or replay the named actor proposal');
 update private.mcp_oauth_clients set disabled_at=clock_timestamp();
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'GRANT_STALE','disabled client cannot replay a successful receipt');
 update private.mcp_oauth_clients set disabled_at=null;
 perform runtime.assert(not has_table_privilege('service_role','private.agent_schedule_write_tokens','INSERT') and not has_function_privilege('authenticated','public.commit_agent_schedule_change_as_actor(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'browser roles cannot invoke commit and service role cannot mint private write tokens');
 delete from private.agent_schedule_capacity_fences where task_id=second;
 delete from public.project_tasks where id=second;
end $$;

-- Selected-task provider ownership and pending automatic effects block approval.
do $$ declare req jsonb;p jsonb;intent uuid:=gen_random_uuid();begin
 req:=runtime.next_request('negative-provider-ownership-001');p:=runtime.prepare(req);
 insert into public.approved_action_email_intents(id,company_id,action_data_snapshot,status)
 values(intent,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"task_automation_guard":{"task_id":"40000000-0000-4000-8000-000000000001"}}','sending');
 perform runtime.rejects(format('select runtime.commit(%L::jsonb)',p),'CUSTOMER_WORK_PENDING','already-claimed customer email blocks schedule approval');
 update public.approved_action_email_intents set status='delivery_unknown' where id=intent;
 perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',runtime.next_request('negative-provider-ownership-002')),'CUSTOMER_WORK_PENDING','unknown provider delivery cannot be treated as unsent');
 delete from public.approved_action_email_intents where id=intent;
 insert into public.task_schedule_automation_outbox(kind,company_id,task_id,after_snapshot,task_schedule_version)
 values('full_auto_confirmation','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','40000000-0000-4000-8000-000000000001','{}',1);
 perform runtime.rejects(format('select runtime.prepare(%L::jsonb)',runtime.next_request('negative-provider-ownership-003')),'CUSTOMER_WORK_PENDING','pending automatic confirmation blocks independent schedule approval');
 delete from public.task_schedule_automation_outbox where kind='full_auto_confirmation';
end $$;

-- Existing timed writers can cross UTC midnight without becoming invalid.
do $$ declare tz text;timed_id uuid;day date:=current_date+120;begin
 foreach tz in array array['America/Vancouver','Asia/Tokyo'] loop
   timed_id:=gen_random_uuid();
   update public.companies set timezone=tz where companies.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   insert into public.project_tasks select (jsonb_populate_record(null::public.project_tasks,to_jsonb(t)||jsonb_build_object('id',timed_id,'all_day',false,'start_date',(day+case when tz='America/Vancouver' then time '18:00' else time '08:00' end) at time zone tz,'end_date',(day+case when tz='America/Vancouver' then time '19:00' else time '09:00' end) at time zone tz,'start_time',case when tz='America/Vancouver' then '18:00' else '08:00' end,'end_time',case when tz='America/Vancouver' then '19:00' else '09:00' end))).* from public.project_tasks t where t.id='40000000-0000-4000-8000-000000000001';
   perform runtime.assert((select count(*)=1 from public.project_tasks t where t.id=timed_id),'nonconflicting timed writer across UTC date rollover: '||tz);
   delete from public.task_schedule_automation_outbox where task_id=timed_id;
   delete from public.project_tasks t where t.id=timed_id;
 end loop;
 update public.companies set timezone='UTC' where companies.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end $$;
