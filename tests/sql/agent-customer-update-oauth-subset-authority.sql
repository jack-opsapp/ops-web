
-- Preserve original transaction proof under the activated authority helper.
\ir agent-customer-update-runtime.sql

-- These new local clients/grants are separate from every existing fixture row.
-- The five scopes are the actual preparation requirement, not the full catalogue.
insert into private.mcp_oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,response_types,scope,registration_source,scope_ceiling,consent_catalog_revision,exposure_revision)
select client_id,name,array['http://127.0.0.1:55481/callback/local-fixture'],'none',array['authorization_code','refresh_token'],array['code'],array_to_string(scopes,' '),'dynamic',scopes,'2026-09-04.mcp-consent-catalog.v9','2026-09-04.mcp-exposure.v14'
from (values
('40000000-0000-4000-8000-000000000002'::uuid,'Minimum five scopes',array['ops.correspondence.read','ops.customers.prepare','ops.customers.read','ops.jobs.read','ops.team.read']),
('40000000-0000-4000-8000-000000000003'::uuid,'Read only',array['ops.customers.read'])
) x(client_id,name,scopes);
insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
select case when client_id='40000000-0000-4000-8000-000000000002' then '50000000-0000-4000-8000-000000000002'::uuid else '50000000-0000-4000-8000-000000000003'::uuid end,'10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',client_id,scope_ceiling,repeat('b',32),private.mcp_oauth_labels_for_scopes(scope_ceiling,consent_catalog_revision),consent_catalog_revision,exposure_revision
from private.mcp_oauth_clients where client_id in ('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003');

create function runtime.prepare_with_grant(grant_id uuid,request jsonb) returns jsonb language plpgsql as $$
declare p text[]:=array['agent.review','clients.edit','clients.view','email.view','inbox.view_company','pipeline.assign','pipeline.edit','pipeline.view','team.view'];r text;g private.mcp_oauth_grants%rowtype;begin
select * into strict g from private.mcp_oauth_grants where id=grant_id;
select permission_snapshot_revision into r from private.resolve_agent_actor_authority(g.user_id,g.company_id,p);
return public.prepare_agent_customer_update_as_system(g.user_id,g.company_id,g.id,g.client_id,g.revision,g.scopes,r,p,'2026-09-04.capability-manifest.v20','2026-09-04.mcp-exposure.v14','prepare_customer_update','prepare_customer_update:2026-09-04.v1','minimum-scope-runtime',request,clock_timestamp());
end$$;
do $$declare p jsonb;r jsonb;before_row jsonb;begin
select to_jsonb(o) into before_row from public.opportunities o where id='30000000-0000-4000-8000-000000000001';
p:=runtime.prepare_with_grant('50000000-0000-4000-8000-000000000002',runtime.request('{"title":"Minimum scope approved title"}','runtime-minimum-scopes-001'));
perform runtime.assert(p->>'action_id' is not null,'five-scope client can prepare approval');
perform runtime.assert((select to_jsonb(o)=before_row from public.opportunities o where id='30000000-0000-4000-8000-000000000001'),'five-scope preparation leaves business record unchanged');
r:=runtime.commit(p,'runtime-minimum-scopes-commit');
perform runtime.assert(r#>>'{readback,title}'='Minimum scope approved title','five-scope proposal commits through named OPS approval');
perform runtime.assert((runtime.commit(p,'runtime-minimum-scopes-commit')->>'replayed')::boolean,'five-scope exact approval replay returns receipt');
perform runtime.rejects($q$select runtime.prepare_with_grant('50000000-0000-4000-8000-000000000003',runtime.request('{"title":"Read-only cannot write"}','runtime-readonly-scopes-001'))$q$,'AUTHORITY_REVISION_INVALID','read-only DCR client cannot prepare despite v14 exposure');
perform runtime.assert((select title='Minimum scope approved title' from public.opportunities where id='30000000-0000-4000-8000-000000000001'),'read-only denial leaves business record unchanged');
end$$;
