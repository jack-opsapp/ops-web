\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
create table runtime.concurrent_previews(name text primary key,actor uuid,company uuid,request jsonb,preview jsonb);
insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
select '50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision from private.mcp_oauth_grants where id='50000000-0000-4000-8000-000000000001';
do $$ declare keys text[]:=array['agent.review','clients.edit','clients.view','email.view','inbox.view_company','pipeline.assign','pipeline.edit','pipeline.view','team.view'];g private.mcp_oauth_grants%rowtype;r text;q jsonb;p jsonb;opp public.opportunities%rowtype;begin
for g in select * from private.mcp_oauth_grants order by id loop
select * into opp from public.opportunities where company_id=g.company_id limit 1;
select permission_snapshot_revision into r from private.resolve_agent_actor_authority(g.user_id,g.company_id,keys);
q:=jsonb_build_object('opportunity_id',opp.id,'expected_updated_at',opp.updated_at,'changes',jsonb_build_object('assigned_to',case when g.company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then '10000000-0000-4000-8000-000000000002' else '10000000-0000-4000-8000-000000000003' end),'evidence',jsonb_build_array(jsonb_build_object('kind','operator_statement','text','Confirmed owner change.','supports',jsonb_build_array('assigned_to'))),'idempotency_key','runtime-concurrent-'||g.company_id::text);
p:=public.prepare_agent_customer_update_as_system(g.user_id,g.company_id,g.id,g.client_id,g.revision,g.scopes,r,keys,'2026-09-04.capability-manifest.v20','2026-09-04.mcp-exposure.v14','prepare_customer_update','prepare_customer_update:2026-09-04.v1','runtime-concurrent',q,clock_timestamp());
insert into runtime.concurrent_previews values(case when g.company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then 'a' else 'b' end,g.user_id,g.company_id,q,p);
end loop;end $$;
