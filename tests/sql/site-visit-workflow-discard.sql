create table if not exists public.site_visit_identity_drafts(id uuid default gen_random_uuid() not null,site_visit_id uuid not null,company_id text not null,opportunity_id uuid,client_id uuid,sub_client_id uuid,client_name text default ''::text not null,contact_name text default ''::text not null,preferred_email text default ''::text not null,additional_emails text[] default '{}'::text[] not null,phone_number text default ''::text not null,address text default ''::text not null,notes text default ''::text not null,created_by text not null,last_committed_at timestamp with time zone,created_at timestamp with time zone default now() not null,updated_at timestamp with time zone default now() not null,deleted_at timestamp with time zone);
select set_config('request.jwt.claims','{"sub":"phone-a"}',false);
create function public.discard_fixture_capture(vid uuid) returns jsonb language sql as $$select jsonb_build_object('id',vid,'company_id','10000000-0000-4000-8000-000000000002','status','in_progress','created_by','10000000-0000-4000-8000-000000000003','scheduled_at','2026-09-10T10:00:00Z')$$;
set role anon;
do $$declare r jsonb;r2 jsonb;begin
 r:=public.discard_site_visit_capture('70000000-0000-4000-8000-000000000001',public.discard_fixture_capture('70000000-0000-4000-8000-000000000002'),'2026-09-10T11:00:00Z','10000000-0000-4000-8000-000000000003');
 r2:=public.discard_site_visit_capture('70000000-0000-4000-8000-000000000001',public.discard_fixture_capture('70000000-0000-4000-8000-000000000002'),'2026-09-10T11:00:00Z','10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(r=r2 and r->>'outcome'='discarded','never-uploaded discard creates closed identity and exact replay');
 begin perform public.save_site_visit_capture(public.discard_fixture_capture('70000000-0000-4000-8000-000000000002'),'10000000-0000-4000-8000-000000000003');raise exception 'expected';exception when object_not_in_prerequisite_state then null;end;
 perform public.phone_assert(true,'delayed parent create cannot reopen discarded identity');
 begin perform public.discard_site_visit_capture('70000000-0000-4000-8000-000000000001',public.discard_fixture_capture('70000000-0000-4000-8000-000000000002'),'2026-09-10T12:00:00Z','10000000-0000-4000-8000-000000000003');raise exception 'expected';exception when invalid_parameter_value then null;end;
 perform public.phone_assert(true,'discard replay rejects changed timestamp');
 begin perform public.discard_site_visit_capture('70000000-0000-4000-8000-000000000001',public.discard_fixture_capture('70000000-0000-4000-8000-000000000002'),'2026-09-10T11:00:00Z','10000000-0000-4000-8000-000000000005');raise exception 'expected';exception when insufficient_privilege then null;end;
 perform public.phone_assert(true,'discard replay binds original actor');
end$$;
select public.save_site_visit_capture(public.discard_fixture_capture('70000000-0000-4000-8000-000000000003'),'10000000-0000-4000-8000-000000000003');
reset role;
insert into public.site_visit_artifacts(id,site_visit_id,company_id,kind,source,asset_url) values('70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','photo','camera','https://example.invalid/photo.jpg');
insert into public.site_visit_checklist_answers(id,site_visit_id,company_id,field_id,label,kind,required,sort_order,answer_value,write_base_revision,created_by) values('70000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','photo','Photo','photo',true,1,'{"artifactIds":["70000000-0000-4000-8000-000000000004"]}',0,'10000000-0000-4000-8000-000000000003');
insert into public.site_visit_identity_drafts(site_visit_id,company_id,created_by) values('70000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003');
set role anon;
select public.discard_site_visit_capture('70000000-0000-4000-8000-000000000006',public.discard_fixture_capture('70000000-0000-4000-8000-000000000003'),'2026-09-10T11:00:00Z','10000000-0000-4000-8000-000000000003');
reset role;
select public.phone_assert((select deleted_at is not null and status='in_progress' from public.site_visits where id='70000000-0000-4000-8000-000000000003') and (select deleted_at is not null and answer_value->'artifactIds'='["70000000-0000-4000-8000-000000000004"]' and write_revision=2 from public.site_visit_checklist_answers where id='70000000-0000-4000-8000-000000000005') and (select deleted_at is not null from public.site_visit_artifacts where id='70000000-0000-4000-8000-000000000004') and (select deleted_at is not null from public.site_visit_identity_drafts where site_visit_id='70000000-0000-4000-8000-000000000003'),'packet discard atomically tombstones parent photo linked-answer and draft with historical values intact');
do $$begin
 for i in 1..2 loop
 update public.site_visits set deleted_at=null,booked_at=case when i=1 then now() end,status=case when i=1 then 'scheduled'::public.site_visit_status else 'completed'::public.site_visit_status end where id='70000000-0000-4000-8000-000000000003';
 begin perform public.discard_site_visit_capture(gen_random_uuid(),public.discard_fixture_capture('70000000-0000-4000-8000-000000000003'),now(),'10000000-0000-4000-8000-000000000003');raise exception 'expected';exception when object_not_in_prerequisite_state then null;end;
 end loop;perform public.phone_assert(true,'packet discard rejects booked and completed visits');
end$$;
