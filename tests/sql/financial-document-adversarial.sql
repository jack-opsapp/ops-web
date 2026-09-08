\set ON_ERROR_STOP on
-- Run only after financial-document-runtime.sql in its disposable fictional database.
-- Every test mutation, including adversarial catalog/function changes, is rolled back.
begin;
set local request.jwt.claim.role='service_role';
set local timezone='UTC';

insert into public.estimates(id,company_id,client_id,client_ref,project_id,project_ref,estimate_number,status,currency_code,total,subtotal)
values('80000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','FIXTURE-BASELINE','approved','CAD',100,100);

do $$ declare req jsonb;p jsonb;competing jsonb;r jsonb;before_row jsonb;predecessor uuid;before_hash text;currency text;counts jsonb;begin
 req:=financial_test.request('adversarial-change-order')||jsonb_build_object('document_kind','change_order','baseline_estimate_id','80000000-0000-4000-8000-000000000001');
 foreach currency in array array['USD',null::text] loop
  update public.estimates set currency_code=currency where id='80000000-0000-4000-8000-000000000001';
  perform financial_test.rejects(format('select financial_test.prepare(%L::jsonb)',req),'ACCEPTED_BASELINE_REQUIRED','change order rejects mismatched or absent baseline currency');
 end loop;
 update public.estimates set currency_code='CAD' where id='80000000-0000-4000-8000-000000000001';
 select to_jsonb(e) into before_row from public.estimates e where id='80000000-0000-4000-8000-000000000001';
 p:=financial_test.prepare(req);r:=financial_test.commit(p,'adversarial-change-commit');
 perform financial_test.assert((select document_kind='change_order' and baseline_estimate_id='80000000-0000-4000-8000-000000000001' and distribution_hold and status='draft' from public.estimates where id=(r->>'estimate_id')::uuid),'real change order saves as additional held draft');
 perform financial_test.assert((select to_jsonb(e)=before_row from public.estimates e where id='80000000-0000-4000-8000-000000000001'),'change order preserves entire accepted baseline');
 predecessor:=(r->>'estimate_id')::uuid;
 select private.financial_document_hash(jsonb_build_object('document',to_jsonb(e),'lines',(select jsonb_agg(to_jsonb(l) order by l.sort_order,l.id) from public.line_items l where l.estimate_id=e.id))) into before_hash from public.estimates e where e.id=predecessor;
 req:=req||jsonb_build_object('operation','revise','revises_estimate_id',predecessor,'expected_revision_sha256',before_hash,'title','Revised fictional additional scope','idempotency_key','adversarial-revision');
 p:=financial_test.prepare(req);
 competing:=financial_test.prepare(req||jsonb_build_object('idempotency_key','adversarial-competing-revision','title','Competing fictional revision'));
 r:=financial_test.commit(p,'adversarial-revision-commit');
 select jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences)) into counts;
 perform financial_test.rejects(format('select financial_test.commit(%L::jsonb,%L)',competing,'adversarial-competing-commit'),'REVISION_STALE_OR_IMMUTABLE','competing prepared revision loses after first exact save');
 perform financial_test.assert(counts=jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences)),'losing prepared revision allocates no document or official number');
 perform financial_test.assert((select parent_id=predecessor and version=2 and distribution_hold and document_kind='change_order' and baseline_estimate_id='80000000-0000-4000-8000-000000000001' from public.estimates where id=(r->>'estimate_id')::uuid),'real change order revision preserves baseline and increments version');
 perform financial_test.assert((select private.financial_document_hash(jsonb_build_object('document',to_jsonb(e),'lines',(select jsonb_agg(to_jsonb(l) order by l.sort_order,l.id) from public.line_items l where l.estimate_id=e.id)))=before_hash from public.estimates e where e.id=predecessor),'revision preserves entire predecessor and its lines');
 perform financial_test.rejects(format('select financial_test.prepare(%L::jsonb)',req||jsonb_build_object('idempotency_key','adversarial-second-child')),'REVISION_STALE_OR_IMMUTABLE','second private child of exact predecessor rejected');
 insert into public.accounting_sync_queue(company_id,entity_type,entity_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','estimate',(r->>'estimate_id')::uuid);
 perform financial_test.assert(not exists(select 1 from public.accounting_sync_queue where entity_id=(r->>'estimate_id')::uuid),'independent provider enqueue producer cannot queue held draft');
end $$;

-- Completed historical work is separate from the live target job.
insert into public.projects(id,company_id,client_id,title,status,completed_at)
values('30000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','Fictional completed repair','completed',clock_timestamp());
insert into public.estimates(id,company_id,client_id,client_ref,project_id,project_ref,estimate_number,status,currency_code,total,subtotal)
values('80000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','FIXTURE-HISTORY','approved','CAD',25,25);
insert into public.line_items(id,company_id,estimate_id,name,description,quantity,unit,unit_price,type,is_taxable,sort_order)
values('90000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','80000000-0000-4000-8000-000000000002','Historical fictional labour','',1,'hour',25,'LABOR',true,0);

do $$ declare req jsonb;p jsonb;sha text;currency text;counts jsonb;begin
 select private.financial_document_hash(to_jsonb(l)) into sha from public.line_items l where id='90000000-0000-4000-8000-000000000001';
 req:=jsonb_set(financial_test.request('adversarial-history'),'{lines,0,source}',jsonb_build_object('kind','historical_line','reference_id','90000000-0000-4000-8000-000000000001','sha256',sha,'unit_price',null,'minimum_charge',null));
 foreach currency in array array['USD',null::text] loop
  update public.estimates set currency_code=currency where id='80000000-0000-4000-8000-000000000002';
  perform financial_test.rejects(format('select financial_test.prepare(%L::jsonb)',req),'HISTORY_UNSUPPORTED','history rejects mismatched or absent currency');
 end loop;
 update public.estimates set currency_code='CAD' where id='80000000-0000-4000-8000-000000000002';
 p:=financial_test.prepare(req);
 perform financial_test.assert(p#>>'{proposal,lines,0,source_unit_price}'='25.00','historical preparation uses authoritative saved price');
 select jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences)) into counts;
 update public.line_items set unit_price=30 where id='90000000-0000-4000-8000-000000000001';
 perform financial_test.rejects(format('select financial_test.commit(%L::jsonb)',p),'PRICE_STALE','source price mutation invalidates approval');
 perform financial_test.assert(counts=jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences)),'stale source consumes no document or number');
end $$;

do $$ declare p jsonb;r jsonb;counts jsonb;effect_before text;begin
 p:=financial_test.prepare(financial_test.request('adversarial-authority'));
 perform financial_test.rejects(format('select public.commit_financial_document_as_actor(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L)','10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p->>'action_id',p->>'change_set_id',p->>'preview_sha256','adversarial-other-actor'),'RECORD_NOT_FOUND','another company admin cannot approve named actor action');
 perform financial_test.rejects(format('select public.commit_financial_document_as_actor(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L)','10000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',p->>'action_id',p->>'change_set_id',p->>'preview_sha256','adversarial-other-tenant'),'RECORD_NOT_FOUND','different tenant cannot approve action');
 perform financial_test.rejects(format('select financial_test.commit(%L::jsonb)',jsonb_set(p,'{preview_sha256}',to_jsonb('sha256:'||repeat('0',64)))),'IDEMPOTENCY_CONFLICT','tampered confirmation seal rejected');
 -- Even a trusted-writer corruption of the action cannot alter the approved payload.
 update public.agent_actions set action_data=jsonb_set(action_data,'{proposal,request,title}','"Tampered"') where id=(p->>'action_id')::uuid;
 perform financial_test.rejects(format('select financial_test.commit(%L::jsonb)',p),'CONFIRMATION_STALE','tampered stored action payload rejected');
 p:=financial_test.prepare(financial_test.request('adversarial-effect-change'));
 select jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences),(select count(*) from public.line_items)) into counts;
 effect_before:=private.financial_document_effect_revision();
 -- Exception subtransaction restores the trigger after proving commit refusal.
 begin
  alter table public.estimates disable trigger trg_accounting_sync_queue_estimates;
  perform financial_test.rejects(format('select financial_test.commit(%L::jsonb)',p),'EFFECT_POLICY_CHANGED','changed effect fingerprint blocks commit');
  perform financial_test.assert(counts=jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences),(select count(*) from public.line_items)),'effect mismatch leaves document lines and numbers unchanged');
  raise exception 'ADVERSARIAL_RESTORE_TRIGGER';
 exception when raise_exception then if sqlerrm<>'ADVERSARIAL_RESTORE_TRIGGER' then raise;end if;end;
 perform financial_test.assert(private.financial_document_effect_revision()=effect_before,'effect test restores original trigger fingerprint');
 r:=financial_test.commit(p,'adversarial-effect-recovered');
 perform financial_test.assert((r->>'ok')::boolean,'same exact proposal saves after effect definition is restored');
 perform financial_test.rejects(format('select financial_test.commit(%L::jsonb,%L)',jsonb_set(p,'{preview_sha256}',to_jsonb('sha256:'||repeat('0',64))),'adversarial-effect-recovered'),'IDEMPOTENCY_CONFLICT','receipt replay rejects tampered original preview seal');
end $$;
create function financial_test.inspect(request jsonb) returns jsonb language plpgsql as $$
declare perms text[]:=array['agent.review','clients.view','estimates.create','estimates.view','pipeline.view','projects.view'];rev text;g private.mcp_oauth_grants%rowtype;
begin
 select * into g from private.mcp_oauth_grants where id='70000000-0000-4000-8000-000000000001';
 select permission_snapshot_revision into rev from private.resolve_agent_actor_authority(g.user_id,g.company_id,perms);
 return public.inspect_financial_document_as_system(g.user_id,g.company_id,g.id,g.client_id,g.revision,g.scopes,rev,perms,'2026-09-07.capability-manifest.v23','2026-09-07.mcp-exposure.v17','prepare_financial_document','prepare_financial_document:2026-09-07.v1',request);
end $$;
do $$ declare req jsonb;broken jsonb;field text;begin
 req:=jsonb_build_object('client_id','20000000-0000-4000-8000-000000000001','project_id','30000000-0000-4000-8000-000000000001','opportunity_id',null,'product_ids','[]'::jsonb,'historical_line_ids','["90000000-0000-4000-8000-000000000001"]'::jsonb,'estimate_ids','["80000000-0000-4000-8000-000000000002"]'::jsonb,'project_note_ids','[]'::jsonb);
 perform financial_test.assert(jsonb_array_length(financial_test.inspect(req)->'sources')=2,'inspect returns every exact live historical source');
 foreach field in array array['product_ids','historical_line_ids','estimate_ids','project_note_ids'] loop
  broken:=jsonb_set(req,array[field],'null');
  perform financial_test.rejects(format('select financial_test.inspect(%L::jsonb)',broken),'INPUT_INVALID','inspect rejects null source array '||field);
 end loop;
 perform financial_test.rejects('select financial_test.inspect(''[]''::jsonb)','INPUT_INVALID','inspect rejects non-object request');
 perform financial_test.rejects(format('select financial_test.inspect(%L::jsonb)',req||'{"unexpected":"secret"}'::jsonb),'TARGET_INVALID','inspect rejects unknown input field');
 perform financial_test.rejects(format('select financial_test.inspect(%L::jsonb)',req-'opportunity_id'),'TARGET_INVALID','inspect rejects omitted nullable target field');
 update public.projects set deleted_at=clock_timestamp() where id='30000000-0000-4000-8000-000000000002';
 perform financial_test.rejects(format('select financial_test.inspect(%L::jsonb)',req),'EVIDENCE_UNAVAILABLE','inspect hides deleted historical project sources');
 update public.projects set deleted_at=null where id='30000000-0000-4000-8000-000000000002';
 -- Give historical records a separate client so deletion cannot be rejected merely by target validation.
 insert into public.clients(id,company_id,name) values('20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Historical fictional client');
 update public.estimates set client_id='20000000-0000-4000-8000-000000000002',client_ref='20000000-0000-4000-8000-000000000002' where id='80000000-0000-4000-8000-000000000002';
 update public.projects set client_id='20000000-0000-4000-8000-000000000002' where id='30000000-0000-4000-8000-000000000002';
 perform financial_test.assert(jsonb_array_length(financial_test.inspect(req)->'sources')=2,'inspect accepts permitted company history from separate live client');
 update public.clients set deleted_at=clock_timestamp() where id='20000000-0000-4000-8000-000000000002';
 perform financial_test.rejects(format('select financial_test.inspect(%L::jsonb)',req),'EVIDENCE_UNAVAILABLE','inspect hides deleted source client without deleting target client');
 update public.clients set deleted_at=null,merged_into_client_id='20000000-0000-4000-8000-000000000001' where id='20000000-0000-4000-8000-000000000002';
 perform financial_test.rejects(format('select financial_test.inspect(%L::jsonb)',req),'EVIDENCE_UNAVAILABLE','inspect hides merged source client');
end $$;

-- Verify the actual authenticated SELECT policy, using real permission overrides.
-- Remove owner-wide authority before testing granular permission loss; rolled back below.
update public.companies set account_holder_id=null where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
grant usage on schema financial_test to authenticated;
grant execute on all functions in schema financial_test to authenticated;
update public.users set auth_id='financial-fixture-browser',is_company_admin=false where id='10000000-0000-4000-8000-000000000001';
insert into public.user_permission_overrides(user_id,company_id,permission,scope,granted)
select '10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p,'all',true from unnest(array['agent.review','clients.view','estimates.create','estimates.view','pipeline.view','projects.view']) p;
select set_config('financial_test.browser_action',(select action_id::text from private.financial_document_proposals where idempotency_key='adversarial-authority'),true);
select set_config('request.jwt.claims','{"sub":"financial-fixture-browser","company_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',true);
set local request.jwt.claim.role='authenticated';
set local role authenticated;
select financial_test.assert((select count(*)=1 from public.agent_actions where id=current_setting('financial_test.browser_action')::uuid),'browser sees own action with complete current business permissions');
reset role;
delete from public.user_permission_overrides where user_id='10000000-0000-4000-8000-000000000001' and permission='projects.view';
set local role authenticated;
select financial_test.assert((select count(*)=0 from public.agent_actions where id=current_setting('financial_test.browser_action')::uuid),'browser cannot SELECT proposal after project read permission loss');
reset role;
rollback;
