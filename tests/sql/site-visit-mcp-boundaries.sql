-- Exact MCP bindings with real authorization helpers; synthetic clients only.
create temp table workflow_mcp(ctx jsonb);
do $$ declare base jsonb:=pg_temp.workflow_context(); sc text[]:=array['ops.site_visit_templates.read','ops.site_visit_templates.prepare']; c uuid:='81000000-0000-4000-8000-000000000001';g uuid:='82000000-0000-4000-8000-000000000001';ctx jsonb;req jsonb:='{"operation":"create_template","idempotency_key":"grant-test-001","definition":{"name":"MCP test","slug":"mcp-test","fields":[{"id":"a","label":"A","kind":"checkbox","required":false,"sortOrder":1}]}}';begin
 insert into private.mcp_oauth_clients(client_id,client_name,redirect_uris,token_endpoint_auth_method,grant_types,response_types,scope,registration_source,scope_ceiling,consent_catalog_revision,exposure_revision)
 values(c,'Synthetic review',array['https://example.invalid/callback'],'none',array['authorization_code','refresh_token'],array['code'],array_to_string(sc,' '),'dynamic',sc,'2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v22');
 insert into private.mcp_oauth_grants(id,user_id,company_id,client_id,scopes,revision,accepted_labels,consent_catalog_revision,exposure_revision)
 values(g,(base->>'actor')::uuid,(base->>'company')::uuid,c,sc,'review-v1',private.agent_site_visit_workflow_labels(sc,'2026-09-10.mcp-consent-catalog.v17'),'2026-09-10.mcp-consent-catalog.v17','2026-09-10.mcp-exposure.v22');
 ctx:=base||jsonb_build_object('channel','mcp','grant',g,'client',c,'grant_revision','review-v1','scopes',sc);
 perform public.inspect_site_visit_workflow_as_system('mcp-valid',ctx,req);
 update private.mcp_oauth_grants set revoked_at=now() where id=g;
 begin perform public.inspect_site_visit_workflow_as_system('mcp-revoked',ctx,req);raise exception 'revoked accepted';exception when insufficient_privilege then null;end;
 update private.mcp_oauth_grants set revoked_at=null where id=g;
 update private.mcp_oauth_clients set disabled_at=now() where client_id=c;
 begin perform public.inspect_site_visit_workflow_as_system('mcp-disabled',ctx,req);raise exception 'disabled accepted';exception when insufficient_privilege then null;end;
 update private.mcp_oauth_clients set disabled_at=null where client_id=c;
 update private.mcp_oauth_grants set scopes=array['ops.site_visit_templates.read'] where id=g;
 begin perform public.inspect_site_visit_workflow_as_system('mcp-scoped',ctx,req);raise exception 'scope change accepted';exception when insufficient_privilege then null;end;
 update private.mcp_oauth_grants set scopes=sc,revision='review-v2' where id=g;
 begin perform public.inspect_site_visit_workflow_as_system('mcp-revision',ctx,req);raise exception 'grant revision change accepted';exception when insufficient_privilege then null;end;
 update private.mcp_oauth_grants set revision='review-v1' where id=g;
 begin perform public.inspect_site_visit_workflow_as_system('mcp-client-sub',ctx||jsonb_build_object('client','81000000-0000-4000-8000-000000000002'),req);raise exception 'client substitution accepted';exception when insufficient_privilege then null;end;
 update public.user_permission_overrides set granted=false where user_id=(base->>'actor')::uuid and permission='settings.company';
 begin perform public.inspect_site_visit_workflow_as_system('mcp-role',ctx,req);raise exception 'role revocation accepted';exception when insufficient_privilege then null;end;
 update public.user_permission_overrides set granted=true where user_id=(base->>'actor')::uuid and permission='settings.company';
 insert into workflow_mcp values(ctx);
 raise notice 'PASS ADVERSARIAL: MCP current grant revoke, disable, scope/revision, client substitution, and permission revocation';
end $$;
-- Install captured company permissive policy beside new restrictive policies.
alter table public.agent_actions enable row level security;
create policy review_fixture_company on public.agent_actions for all to public using(company_id=((select auth.jwt())->>'company_id')::uuid);
grant select,insert,update,delete on public.agent_actions to authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fixture-firebase-non-uuid","company_id":"10000000-0000-4000-8000-000000000002"}',false);
set role authenticated;
do $$ declare n int;begin
 select count(*) into n from public.agent_actions where action_type='approve_site_visit_changes';if n<1 then raise exception 'owner actions inaccessible';end if;
 update public.agent_actions set status='executed' where action_type='approve_site_visit_changes';get diagnostics n=row_count;if n<>0 then raise exception 'raw update accepted';end if;
 delete from public.agent_actions where action_type='approve_site_visit_changes';get diagnostics n=row_count;if n<>0 then raise exception 'raw delete accepted';end if;
 begin insert into public.agent_actions(company_id,user_id,action_type,action_data,context_source,confidence,priority,status)values('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','approve_site_visit_changes','{}','site_visit',1,'normal','pending');raise exception 'raw insert accepted';exception when insufficient_privilege then null;end;
 raise notice 'PASS ADVERSARIAL: authenticated owner reads workflow actions; raw mutation is denied';
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"other-firebase","company_id":"10000000-0000-4000-8000-000000000002"}',false);
set role authenticated;
do $$ begin
 if exists(select 1 from public.agent_actions where action_type='approve_site_visit_changes') then raise exception 'cross actor/company read accepted';end if;
 raise notice 'PASS ADVERSARIAL: wrong actor cannot read workflow actions despite matching company JWT';
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare a jsonb;b jsonb;begin
 begin perform private.agent_site_visit_workflow_time('2024-11-03T01:30:00','America/Edmonton',null);raise exception 'DST fold guessed';exception when others then if sqlerrm<>'SITE_VISIT_LOCAL_TIME_AMBIGUOUS' then raise;end if;end;
 begin perform private.agent_site_visit_workflow_time('2024-03-10T02:30:00','America/Edmonton',null);raise exception 'DST gap accepted';exception when others then if sqlerrm<>'SITE_VISIT_LOCAL_TIME_DOES_NOT_EXIST' then raise;end if;end;
 a:=private.agent_site_visit_workflow_time('2024-11-03T01:30:00','America/Edmonton',-360);b:=private.agent_site_visit_workflow_time('2024-11-03T01:30:00','America/Edmonton',-420);
 if (b->>'instant')::timestamptz-(a->>'instant')::timestamptz<>interval '1 hour' then raise exception 'explicit fold offsets mismatched';end if;
 raise notice 'PASS ADVERSARIAL: DST gap/fold denial and exact explicit offsets';
end $$;
do $$ declare ctx jsonb;v uuid:=gen_random_uuid();a uuid:=gen_random_uuid();begin
 update public.user_permission_overrides set granted=false where user_id='20000000-0000-4000-8000-000000000001' and permission='settings.company';
 ctx:=pg_temp.workflow_context();
 insert into public.site_visits(id,company_id,scheduled_at,status,created_by,notes) values(v,ctx->>'company',now(),'scheduled','20000000-0000-4000-8000-000000000003','Unlinked private intake');
 insert into public.site_visit_artifacts(id,company_id,site_visit_id,kind,source,body,created_by,captured_at) values(a,ctx->>'company',v,'note','manual','Unlinked private evidence',ctx->>'actor',now());
 begin perform public.read_site_visit_workflow_as_system('unlinked-form',ctx,jsonb_build_object('operation','get_form','site_visit_id',v));raise exception 'unlinked assigned read accepted';exception when insufficient_privilege then null;end;
 begin perform public.read_site_visit_workflow_as_system('unlinked-source',ctx,jsonb_build_object('operation','get_source','site_visit_id',v,'artifact_id',a));raise exception 'unlinked assigned evidence accepted';exception when insufficient_privilege then null;end;
 update public.user_permission_overrides set scope='all' where user_id=(ctx->>'actor')::uuid and permission='pipeline.view';ctx:=pg_temp.workflow_context();
 if public.read_site_visit_workflow_as_system('unlinked-all',ctx,jsonb_build_object('operation','get_form','site_visit_id',v))#>>'{site_visit,notes}'<>'Unlinked private intake' then raise exception 'all-scope read unavailable';end if;
 begin perform public.read_site_visit_workflow_as_system('cross-company',ctx||jsonb_build_object('company','10000000-0000-4000-8000-000000000003'),jsonb_build_object('operation','get_form','site_visit_id',v));raise exception 'wrong company read accepted';exception when insufficient_privilege then null;end;
 update public.user_permission_overrides set scope='assigned' where user_id=(ctx->>'actor')::uuid and permission='pipeline.view';
 update public.user_permission_overrides set granted=true where user_id=(ctx->>'actor')::uuid and permission='settings.company';
 raise notice 'PASS: unlinked form/source reads require all scope and exact company';
end $$;
do $$ declare ctx jsonb:=pg_temp.workflow_context();v public.site_visits%rowtype;vid uuid;p jsonb;r jsonb;r2 jsonb;begin
 vid:=private.book_site_visit_for_actor((ctx->>'actor')::uuid,'30000000-0000-4000-8000-000000000001',now()+interval '39 days',60,null,null);
 perform private.allow_site_visit_booking_write(vid,ctx->>'company','{"assignee_ids":null}');
 update public.site_visits set assignee_ids=null where id=vid;
 select * into v from public.site_visits where id=vid;
 p:=public.prepare_site_visit_workflow_as_system('null-crew-cancel',ctx,jsonb_build_object('operation','cancel','site_visit_id',vid,'expected_sha256',private.agent_site_visit_workflow_hash(to_jsonb(v)),'idempotency_key','null-crew-cancel-01'));
 r:=pg_temp.confirm_site_visit(p,'null-crew-confirm');r2:=pg_temp.confirm_site_visit(p,'null-crew-confirm');
 if r-'replayed' is distinct from r2-'replayed' or not exists(select 1 from public.site_visits where id=vid and status='cancelled' and assignee_ids is null) then raise exception 'null crew changed or replay failed';end if;
 raise notice 'PASS: null historical crew cancellation and exact lost-response replay';
end $$;
