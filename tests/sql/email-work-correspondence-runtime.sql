\set ON_ERROR_STOP on
create role service_role bypassrls;
create role anon;
create role authenticated;
create table public.clients(id uuid primary key,company_id uuid,email text,deleted_at timestamptz,merged_into_client_id uuid);
create table public.sub_clients(id uuid primary key,company_id uuid,client_id uuid,email text,deleted_at timestamptz);
create table public.projects(id uuid primary key,company_id uuid,client_id uuid,deleted_at timestamptz,status text);
create table public.email_connections(id uuid primary key,company_id text,user_id text,default_intake_owner_id uuid,status text,sync_enabled boolean);
create table public.activities(id uuid primary key default gen_random_uuid(),company_id uuid,opportunity_id uuid,client_id uuid,project_id text,
 email_connection_id uuid,email_message_id text,email_thread_id text,type text,direction text,from_email text,to_emails text[],cc_emails text[],
 match_confidence text,match_needs_review boolean,suggested_client_id uuid,is_read boolean,subject text,created_at timestamptz);
create table public.email_threads(company_id uuid,connection_id uuid,provider_thread_id text,opportunity_id uuid,client_id uuid,
 routing text,routing_reasons text[],lead_scan_pending_at timestamptz,phase_c_extracted_at timestamptz,last_message_at timestamptz);
create table public.notifications(id uuid primary key default gen_random_uuid(),company_id text not null,user_id text not null,type text,title text,body text,
 project_id text,action_url text,action_label text,persistent boolean,dedupe_key text,is_read boolean not null default false,resolved_at timestamptz);
create unique index notifications_unread_title_dedup_without_key on public.notifications(user_id,company_id,type,title) where not is_read and dedupe_key is null;
create unique index idx_notifications_unread_dedup on public.notifications(user_id,company_id,type,coalesce(dedupe_key,title)) where not is_read and resolved_at is null;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
\ir ../../supabase/migrations/20260909051427_email_existing_job_correspondence.sql
create schema runtime;
create function runtime.assert(ok boolean,message text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %',message; end if; raise notice 'PASS: %',message; end $$;
grant usage on schema runtime to service_role;
grant execute on all functions in schema runtime to service_role;
insert into clients values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','primary@example.com',null,null);
insert into sub_clients values('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','subcontact@example.com',null);
insert into projects values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',null,'in_progress');
insert into email_connections values('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000040',null,'active',true);
insert into activities(id,company_id,email_connection_id,email_message_id,email_thread_id,type,direction,from_email,match_confidence,subject,created_at)
 select ('00000000-0000-0000-0000-00000000005'||n)::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','msg-'||n,'thread-'||n,'email','inbound','subcontact@example.com','work_routing_pending','Damaged gate','2026-09-09T04:00:00Z' from generate_series(0,7) n;
insert into email_threads(company_id,connection_id,provider_thread_id,last_message_at,lead_scan_pending_at) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','thread-0','2026-09-09T04:00:00Z',now());
select runtime.assert(not has_function_privilege('anon','public.route_email_work_correspondence_as_system(uuid,uuid,uuid,text,text,uuid,uuid,boolean)','execute'),'anonymous cannot route correspondence');
select runtime.assert(not has_function_privilege('authenticated','public.route_email_work_correspondence_as_system(uuid,uuid,uuid,text,text,uuid,uuid,boolean)','execute'),'signed-in caller cannot invoke system routing');
set role service_role;
select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000050','msg-0','thread-0','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',false);
select runtime.assert((select opportunity_id is null and client_id='00000000-0000-0000-0000-000000000010' and project_id='00000000-0000-0000-0000-000000000020' and match_confidence='existing_job' from activities where email_message_id='msg-0'),'subcontact correspondence attaches to the project without a lead');
select runtime.assert((select lead_scan_pending_at is null and routing='require_human_review' and phase_c_extracted_at is not null from email_threads where provider_thread_id='thread-0'),'sales automation is disarmed for latest correspondence');
select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000050','msg-0','thread-0','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',false);
select runtime.assert((select count(*)=1 from notifications),'replay creates exactly one notification');
do $$ declare n int; begin
 for n in 1..5 loop
  begin
   perform route_email_work_correspondence_as_system(
    case when n=1 then '00000000-0000-0000-0000-000000000002'::uuid else '00000000-0000-0000-0000-000000000001'::uuid end,
    '00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000051',
    case when n=2 then 'other-message' else 'msg-1' end,case when n=3 then 'other-thread' else 'thread-1' end,
    case when n=4 then '00000000-0000-0000-0000-000000000099'::uuid else '00000000-0000-0000-0000-000000000010'::uuid end,
    case when n=5 then '00000000-0000-0000-0000-000000000099'::uuid else '00000000-0000-0000-0000-000000000020'::uuid end,false);
   raise exception 'test expected failure';
  exception when others then
   if sqlerrm='test expected failure' then raise; end if;
   perform runtime.assert(sqlerrm like 'email_work_routing_%','company/message/thread/customer/project mismatch rejected '||n);
  end;
 end loop;
end $$;
select runtime.assert((select count(*)=1 from notifications),'rejected routes have no notification side effect');
update activities set opportunity_id='00000000-0000-0000-0000-000000000070' where email_message_id='msg-1';
do $$ begin
 begin
 perform route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000051','msg-1','thread-1',null,null,true);
 raise exception 'test expected failure';
 exception when others then perform runtime.assert(sqlerrm='email_work_routing_opportunity_conflict','existing lead ownership cannot be stolen'); end;
end $$;
select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000052','msg-2','thread-2',null,null,true);
select runtime.assert((select project_id is null and opportunity_id is null and match_needs_review and not is_read from activities where email_message_id='msg-2'),'uncertain correspondence remains unread and reviewable');
update activities set is_read=true,match_needs_review=false where email_message_id='msg-2';
select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000052','msg-2','thread-2',null,null,true);
select runtime.assert((select is_read and not match_needs_review from activities where email_message_id='msg-2'),'operator acknowledgement survives replay');
select runtime.assert((select count(*)=2 from notifications),'acknowledgement replay does not notify again');
-- Pending source parents are proposals. If they became stale during an
-- interrupted transaction, preserve correspondence in review instead of
-- pinning the mailbox cursor. Arbitrary mismatches above remain rejected.
update activities set client_id='00000000-0000-0000-0000-000000000010',project_id='00000000-0000-0000-0000-000000000020' where email_message_id in ('msg-4','msg-5');
update projects set deleted_at=now() where id='00000000-0000-0000-0000-000000000020';
select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000054','msg-4','thread-4','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',false);
select runtime.assert((select match_confidence='work_intent_review' and project_id is null and client_id is not null and opportunity_id is null from activities where email_message_id='msg-4'),'deleted pending project safely becomes review');
update sub_clients set email='changed@example.com' where id='00000000-0000-0000-0000-000000000011';
select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000055','msg-5','thread-5','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',false);
select runtime.assert((select match_confidence='work_intent_review' and project_id is null and client_id is null and opportunity_id is null from activities where email_message_id='msg-5'),'changed pending contact safely becomes unassigned review');
select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000050','msg-0','thread-0','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',false);
select runtime.assert((select match_confidence='existing_job' and project_id='00000000-0000-0000-0000-000000000020' from activities where email_message_id='msg-0'),'finalized receipt remains immutable after parent changes');
update activities set match_confidence=null,client_id='00000000-0000-0000-0000-000000000010',project_id='00000000-0000-0000-0000-000000000020' where email_message_id='msg-6';
do $$ begin
 begin
  perform route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000056','msg-6','thread-6','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',false);
  raise exception 'test expected failure';
 exception when others then
  if sqlerrm<>'email_work_routing_customer_mismatch' then raise; end if;
 end;
end $$;
select runtime.assert((select match_confidence is null and client_id is not null and project_id is not null from activities where email_message_id='msg-6') and (select count(*)=0 from notifications where dedupe_key='email-work-routing:00000000-0000-0000-0000-000000000056'),'null-marker legacy row is not pending recovery and remains unchanged');
update email_connections set user_id=null,default_intake_owner_id=null where id='00000000-0000-0000-0000-000000000030';
select route_email_work_correspondence_as_system('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000057','msg-7','thread-7',null,null,true);
select runtime.assert((select match_confidence='work_intent_review' and opportunity_id is null from activities where email_message_id='msg-7') and (select count(*)=0 from notifications where dedupe_key='email-work-routing:00000000-0000-0000-0000-000000000057'),'shared mailbox without recipient retains review without a null-user notification');
update email_connections set user_id='00000000-0000-0000-0000-000000000040' where id='00000000-0000-0000-0000-000000000030';
reset role;
