\set ON_ERROR_STOP on
select set_config('request.jwt.claim.role','service_role',false);
create schema maverick_test;
create function maverick_test.check(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
insert into public.companies(id,name,timezone) values ('91000000-0000-4000-8000-000000000001','Maverick synthetic fixture','America/Vancouver');
insert into public.users(id,company_id,first_name,last_name,is_active,is_company_admin) values ('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','Test','Reader',true,true);
insert into private.agent_operational_read_revisions(company_id,source_revision) values ('91000000-0000-4000-8000-000000000001',0) on conflict do nothing;
insert into private.agent_read_domain_revisions(company_id,domain,source_revision) values ('91000000-0000-4000-8000-000000000001','tasks',0) on conflict do nothing;
insert into public.opportunities(id,company_id,title,assigned_to) values ('91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000001','Synthetic opportunity','91000000-0000-4000-8000-000000000002');
insert into public.projects(id,company_id,title) values ('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000001','Synthetic project');
insert into public.email_connections(id,company_id,email) values ('91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000001','fixture@example.com');
insert into public.job_conversations(id,company_id) values ('91000000-0000-4000-8000-000000000006','91000000-0000-4000-8000-000000000001');
insert into public.job_conversation_anchors(company_id,conversation_id,anchor_kind,opportunity_id) values ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000006','opportunity','91000000-0000-4000-8000-000000000003');
create function maverick_test.permissions() returns text[] language sql immutable as $$ select array['calendar.view','clients.view','inbox.view','pipeline.view','projects.view','tasks.view']::text[] $$;
create function maverick_test.revision() returns text language sql stable as $$select permission_snapshot_revision from private.resolve_agent_actor_authority('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001',maverick_test.permissions())$$;
create function maverick_test.conversation(required_turn uuid default null,company uuid default '91000000-0000-4000-8000-000000000001') returns jsonb language sql stable as $$
 select public.read_agent_job_conversation_context_as_system('maverick-runtime','91000000-0000-4000-8000-000000000002',company,maverick_test.revision(),maverick_test.permissions(),'get_job_conversation_context','get_job_conversation_context:2026-08-07.v1','2026-08-22.capability-manifest.v8',array['ops.correspondence.read','ops.customer_contacts.read','ops.customers.read','ops.jobs.read'],'all','all','pipeline.view','all','opportunity','91000000-0000-4000-8000-000000000003',20,array['memory','recent_turns','participants','gaps','cross_job_seed'],required_turn);
$$;
