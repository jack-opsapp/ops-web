\set ON_ERROR_STOP on
begin;
set local request.jwt.claim.role='service_role';
create function pg_temp.task_list(view_kind text,at_time timestamptz) returns jsonb language sql stable as $$
 select public.read_agent_tasks_as_system('maverick-list','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000011','91000000-0000-4000-8000-000000000010',md5('maverick-test'),array['ops.schedule.read','ops.tasks.read'],maverick_test.revision(),maverick_test.permissions(),'list_tasks','list_tasks:2026-08-22.v1','2026-08-22.capability-manifest.v8',case when view_kind='schedule_window' then array['ops.schedule.read','ops.tasks.read'] else array['ops.tasks.read'] end,'all','all',case when view_kind='schedule_window' then 'all' else null end,null,null,view_kind,null,null,null,case when view_kind='schedule_window' then at_time end,case when view_kind='schedule_window' then at_time+interval '1 hour' end,case when view_kind='overdue' then at_time end,25,26,501,null,'[]'::jsonb,null,null);
$$;
create function pg_temp.attention(at_time timestamptz) returns jsonb language sql stable as $$
select private.agent_p2_task_attention_v1('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001',maverick_test.revision(),maverick_test.permissions(),'all','all',at_time,25);
$$;
do $dates$
declare x record;r jsonb;window_result jsonb;begin
 for x in select * from (values
  ('multi-day','America/Vancouver','2026-03-15T07:00:00Z','2026-03-16T07:00:00Z','2026-03-15T07:00:00Z','2026-03-17T07:00:00Z',48),
  ('spring single','America/Los_Angeles','2026-03-08T08:00:00Z','2026-03-08T08:00:00Z','2026-03-08T08:00:00Z','2026-03-09T07:00:00Z',23),
  ('fall single','America/Los_Angeles','2026-11-01T07:00:00Z','2026-11-01T07:00:00Z','2026-11-01T07:00:00Z','2026-11-02T08:00:00Z',25),
  ('spring multi','America/Los_Angeles','2026-03-07T08:00:00Z','2026-03-09T07:00:00Z','2026-03-07T08:00:00Z','2026-03-10T07:00:00Z',71),
  ('fall multi','America/Los_Angeles','2026-10-31T07:00:00Z','2026-11-02T08:00:00Z','2026-10-31T07:00:00Z','2026-11-03T08:00:00Z',73)
 ) cases(label,timezone,start_date,end_date,expected_start,expected_end,hours) loop
  update public.companies set timezone=x.timezone where id='91000000-0000-4000-8000-000000000001';
  update public.project_tasks set start_date=x.start_date::timestamptz,end_date=x.end_date::timestamptz where id='91000000-0000-4000-8000-000000000012';
  r=maverick_test.task_context()#>'{result,sections,schedule}';
  perform maverick_test.check((r->>'starts_at')::timestamptz=x.expected_start::timestamptz and (r->>'ends_at')::timestamptz=x.expected_end::timestamptz,x.label||' task context instants');
  perform maverick_test.check(extract(epoch from ((r->>'ends_at')::timestamptz-(r->>'starts_at')::timestamptz))/3600=x.hours,x.label||' elapsed hours');
  -- Compare against the actual existing canonical summary resolver, not +24h.
  perform maverick_test.check((r->>'ends_at')::timestamptz=private.agent_civil_date_start((x.end_date::timestamptz at time zone 'UTC')::date+1,x.timezone),x.label||' canonical summary agreement');
  window_result=pg_temp.task_list('schedule_window',x.expected_end::timestamptz-interval '1 hour');
  perform maverick_test.check(jsonb_array_length(window_result->'rows')=1,x.label||' last included hour discoverable');
  perform maverick_test.check(jsonb_array_length(pg_temp.task_list('schedule_window',x.expected_end::timestamptz)->'rows')=0,x.label||' exclusive window boundary');
  perform maverick_test.check(jsonb_array_length(pg_temp.task_list('overdue',x.expected_end::timestamptz-interval '1 second')->'rows')=0,x.label||' not overdue on final day');
  perform maverick_test.check(jsonb_array_length(pg_temp.task_list('overdue',x.expected_end::timestamptz)->'rows')=1,x.label||' overdue at exclusive end');
 end loop;
end;$dates$;
-- Attention readers deliberately require a fresh read_at, so exercise today's
-- final included day and yesterday's completed date using the real clock.
update public.project_tasks set start_date=date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC',end_date=date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC' where id='91000000-0000-4000-8000-000000000012';
select maverick_test.check((pg_temp.attention(date_trunc('milliseconds',statement_timestamp()))->>'returned_count')::int=0,'attention does not mark current all-day task overdue');
update public.project_tasks set start_date=start_date-interval '1 day',end_date=end_date-interval '1 day' where id='91000000-0000-4000-8000-000000000012';
select maverick_test.check(pg_temp.attention(date_trunc('milliseconds',statement_timestamp()))#>>'{cards,0,reason_code}'='overdue','attention marks prior all-day task overdue');
select maverick_test.check((pg_temp.attention(date_trunc('milliseconds',statement_timestamp()))#>>'{cards,0,attention_at}')::timestamptz=(maverick_test.task_context()#>>'{result,sections,schedule,ends_at}')::timestamptz,'attention timestamp agrees with task exclusive end');
update public.project_tasks set all_day=false,start_date='2026-09-05T15:00:00Z',end_date='2026-09-05T16:00:00Z' where id='91000000-0000-4000-8000-000000000012';
select maverick_test.check(maverick_test.task_context()#>>'{result,sections,schedule,ends_at}'='2026-09-05T16:00:00.000Z','timed task preserves exact instants');
update public.project_tasks set all_day=true,end_date=null where id='91000000-0000-4000-8000-000000000012';
select maverick_test.check(maverick_test.task_context()#>>'{result,sections,schedule,state}'='partial' and maverick_test.task_context()#>>'{result,sections,schedule,ends_at}' is null,'partial task does not invent an end');
select maverick_test.check(private.agent_task_read_instant('2026-09-05T00:00:00Z',true,'Asia/Kathmandu',false)='2026-09-04T18:15:00Z'::timestamptz,'positive fractional timezone uses stored civil label');
rollback;
