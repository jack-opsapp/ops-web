-- The company, actor and canonical booking fixture are synthetic local data.
-- No production fixtures, grants, or policy rows are written by this harness.
do $$ declare result jsonb;begin
 result:=private.agent_site_visit_workflow_compile('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  '{"operation":"create_template","idempotency_key":"template-fixture-1","definition":{"name":"Deck assessment","slug":"deck-assessment","is_default":true,"fields":[{"id":"power","label":"Power available","kind":"checkbox","required":true,"sortOrder":1}]}}',
  '70000000-0000-4000-8000-000000000001');
 if result->>'ready' is distinct from 'true' or jsonb_array_length(result->'rows')<>1 or result->'rows'->0->'values'->>'name'<>'Deck assessment' then raise exception 'template preview invalid';end if;
 if exists(select 1 from public.site_visit_types) then raise exception 'compile mutated business data';end if;
 raise notice 'PASS: exact typed checklist preview without business mutation';
end $$;
insert into public.user_permission_overrides(user_id,company_id,permission,scope,granted)
select '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',p,'all',true from unnest(array['settings.company','agent.review','calendar.view','team.view'])p;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
create function pg_temp.workflow_context() returns jsonb language sql as $$
 select jsonb_build_object('actor','20000000-0000-4000-8000-000000000001','company','10000000-0000-4000-8000-000000000002','channel','internal',
 'manifest','2026-09-10.capability-manifest.v27','permission_revision',a.permission_snapshot_revision,'permission_keys',array['agent.review','calendar.view','pipeline.convert','pipeline.edit','pipeline.view','settings.company','team.view'],
 'grant',null,'client',null,'grant_revision',null,'scopes',null) from private.resolve_agent_actor_authority('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',array['agent.review','calendar.view','pipeline.convert','pipeline.edit','pipeline.view','settings.company','team.view'])a
$$;
do $$ begin
 begin perform public.prepare_site_visit_workflow_as_system('fixture-prepare',pg_temp.workflow_context(),'{"operation":"create_template","idempotency_key":"sealed-template-1","definition":{"name":"Deck checklist","slug":"deck-checklist","is_default":true,"fields":[{"id":"power","label":"Power available","kind":"checkbox","required":true,"sortOrder":1}]}}');
 raise exception 'dormant gate bypassed';exception when others then if sqlerrm<>'SITE_VISIT_ACTIVATION_REQUIRED' then raise;end if;end;
 raise notice 'PASS: dormant prepare requires exact effect seal';
end $$;
update public.companies set timezone='America/Edmonton',default_work_start='08:00',default_work_end='17:00' where id='10000000-0000-4000-8000-000000000002';
do $$ declare result jsonb;req jsonb;day text:=to_char(current_date+20,'YYYY-MM-DD');begin
 req:=jsonb_build_object('operation','book','opportunity_id','30000000-0000-4000-8000-000000000001','idempotency_key','book-fixture-001',
 'local_start',day||'T10:00:00','duration_minutes',60,'assignee_ids',jsonb_build_array('20000000-0000-4000-8000-000000000001'),'reminder_lead_minutes',30);
 result:=private.agent_site_visit_workflow_compile('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',req,'70000000-0000-4000-8000-000000000002');
 if result->>'ready' is distinct from 'true' or result->'appointment'->>'local_start' is distinct from day||'T10:00:00'
 or result->'availability'->>'external_calendar_coverage' is distinct from 'unknown' then raise exception 'booking preview mismatch';end if;
 if result->'effects'->>'customer_messages_sent'<>'0' or result->'effects'->>'physical_visit_status_changed'<>'false' then raise exception 'unauthorized booking effect';end if;
 raise notice 'PASS: company civil time, exact appointment and unknown external coverage';
end $$;
-- Activation below exists only in this disposable synthetic company.
insert into private.agent_site_visit_workflow_effect_policy values('10000000-0000-4000-8000-000000000002','2026-09-10.v1',private.agent_site_visit_workflow_effect_revision());
create temp table workflow_fixture_state(name text primary key,value jsonb);
do $$ declare result jsonb;receipt jsonb;replay jsonb;ctx jsonb:=pg_temp.workflow_context();req jsonb:=
 '{"operation":"create_template","idempotency_key":"sealed-template-1","definition":{"name":"Deck checklist","slug":"deck-checklist","is_default":true,"fields":[{"id":"power","label":"Power available","kind":"checkbox","required":true,"sortOrder":1},{"id":"rise","label":"Rise","kind":"measurement","required":true,"sortOrder":2},{"id":"access","label":"Access","kind":"short_text","required":true,"sortOrder":3}]}}';
begin
 result:=public.prepare_site_visit_workflow_as_system('fixture-prepare',ctx,req);
 if result->>'status'<>'approval_required' or exists(select 1 from public.site_visit_types) then raise exception 'prepare wrote business row';end if;
 replay:=public.prepare_site_visit_workflow_as_system('fixture-replay',ctx,req);
 if replay->>'action_id'<>result->>'action_id' or replay->>'replayed'<>'true' then raise exception 'prepare replay changed approval';end if;
 begin perform public.commit_site_visit_workflow_as_actor((ctx->>'actor')::uuid,(ctx->>'company')::uuid,(result->>'action_id')::uuid,(result->>'change_set_id')::uuid,'sha256:'||repeat('0',64),'fixture-commit-1');raise exception 'altered approval accepted';
 exception when others then if sqlerrm<>'SITE_VISIT_IDEMPOTENCY_CONFLICT' then raise;end if;end;
 receipt:=public.commit_site_visit_workflow_as_actor((ctx->>'actor')::uuid,(ctx->>'company')::uuid,(result->>'action_id')::uuid,(result->>'change_set_id')::uuid,result->>'preview_sha256','fixture-commit-1');
 if receipt->>'ok'<>'true' or (select count(*) from public.site_visit_types)<>1 or not exists(select 1 from public.agent_actions where id=(result->>'action_id')::uuid and status='executed' and execution_result=receipt) then raise exception 'atomic save missing';end if;
 replay:=public.commit_site_visit_workflow_as_actor((ctx->>'actor')::uuid,(ctx->>'company')::uuid,(result->>'action_id')::uuid,(result->>'change_set_id')::uuid,result->>'preview_sha256','fixture-commit-1');
 if replay-'replayed' is distinct from receipt-'replayed' or replay->>'replayed'<>'true' or(select count(*) from public.site_visit_types)<>1 then raise exception 'lost response replay duplicated effect';end if;
 insert into workflow_fixture_state values('template',result);
 raise notice 'PASS: exact approval, atomic checklist receipt and lost-response replay';
end $$;
create function pg_temp.confirm_site_visit(p jsonb,k text) returns jsonb language sql as $$
 select public.commit_site_visit_workflow_as_actor('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',(p->>'action_id')::uuid,(p->>'change_set_id')::uuid,p->>'preview_sha256',k)
$$;
do $$ declare ctx jsonb:=pg_temp.workflow_context();req jsonb;p jsonb;receipt jsonb;form jsonb;template jsonb;v uuid;changes jsonb;raw_answer jsonb;begin
 template:=public.read_site_visit_workflow_as_system('template-read',ctx,jsonb_build_object('operation','get_template','template_id',(select value->>'change_set_id' from workflow_fixture_state where name='template')))->'template';
 if template->>'name'<>'Deck checklist' or jsonb_array_length(template->'fields')<>3 then raise exception 'template detail mismatch';end if;
 req:=jsonb_build_object('operation','book','opportunity_id','30000000-0000-4000-8000-000000000001','idempotency_key','golden-book-001',
 'local_start',to_char(current_date+20,'YYYY-MM-DD')||'T10:00:00','duration_minutes',60,'assignee_ids',jsonb_build_array('20000000-0000-4000-8000-000000000001'),'reminder_lead_minutes',30);
 p:=public.prepare_site_visit_workflow_as_system('golden-book',ctx,req);receipt:=pg_temp.confirm_site_visit(p,'golden-book-commit');v:=(receipt->>'site_visit_id')::uuid;
 if v is null or receipt->>'calendar_reconciled'<>'false' then raise exception 'booking receipt mismatch';end if;
 form:=public.read_site_visit_workflow_as_system('form-read',ctx,jsonb_build_object('operation','get_form','site_visit_id',v));
 req:=jsonb_build_object('operation','select_checklist','site_visit_id',v,'template_id',template->>'id','expected_template_revision',template->'revision','expected_form_sha256',form->>'form_sha256','idempotency_key','golden-select-001');
 p:=public.prepare_site_visit_workflow_as_system('golden-select',ctx,req);
 if jsonb_array_length(p->'proposal'->'missing_required')<>3 then raise exception 'required fields missing from preview';end if;
 receipt:=pg_temp.confirm_site_visit(p,'golden-select-commit');
 form:=public.read_site_visit_workflow_as_system('form-read-2',ctx,jsonb_build_object('operation','get_form','site_visit_id',v));
 select jsonb_agg(jsonb_build_object('answer_id',a->>'id','expected_revision',a->'revision','intent','set','value',
  case a->>'field_id' when 'power' then '{"boolValue":false}'::jsonb else '{"text":"0 mm"}'::jsonb end,
  'evidence',jsonb_build_array(jsonb_build_object('source_index',0,'quote',case a->>'field_id' when 'power' then 'No power available.' else 'Rise is 0 mm.' end)))) into changes
 from jsonb_array_elements(form->'answers')a where a->>'field_id' in('power','rise');
 req:=jsonb_build_object('operation','answer_form','site_visit_id',v,'changes',changes,'sources',jsonb_build_array(jsonb_build_object('kind','operator_notes','text','No power available. Rise is 0 mm. Access still needs confirmation.')),'idempotency_key','golden-answer-001');
 p:=public.prepare_site_visit_workflow_as_system('golden-answer',ctx,req);
 if jsonb_array_length(p->'proposal'->'missing_required')<>1 or p->'proposal'->'missing_required'->0->>'field_id'<>'access' then raise exception 'false/zero treated as missing';end if;
 receipt:=pg_temp.confirm_site_visit(p,'golden-answer-commit');
 if not exists(select 1 from public.site_visit_checklist_answers where site_visit_id=v and field_id='power' and answer_value='{"boolValue":false}' and answer_evidence->>'intent'='set') then raise exception 'false or evidence lost';end if;
 if not exists(select 1 from public.site_visits where id=v and status='scheduled' and completed_at is null) then raise exception 'form fill physically completed visit';end if;
 insert into workflow_fixture_state values('visit',to_jsonb(v));
 raise notice 'PASS: golden booking, reusable checklist, evidence answers, false/zero and missing access';
end $$;
do $$ declare ctx jsonb:=pg_temp.workflow_context();v uuid:=(select(value#>>'{}')::uuid from workflow_fixture_state where name='visit');a public.site_visit_checklist_answers%rowtype;
 req jsonb;p jsonb;p2 jsonb;form jsonb;begin
 select * into a from public.site_visit_checklist_answers where site_visit_id=v and field_id='access';
 req:=jsonb_build_object('operation','answer_form','site_visit_id',v,'idempotency_key','unknown-access-1','sources',jsonb_build_array(jsonb_build_object('kind','operator_notes','text','Access may be through the side gate. Owner is unsure.')),
  'changes',jsonb_build_array(jsonb_build_object('answer_id',a.id,'expected_revision',a.write_revision,'intent','unknown','value',null,'reason','Owner must confirm access.',
  'evidence',jsonb_build_array(jsonb_build_object('source_index',0,'quote','Owner is unsure.')),'uncertainty',jsonb_build_array(jsonb_build_object('reason','Access route is uncertain.','evidence',jsonb_build_array(jsonb_build_object('source_index',0,'quote','Access may be through the side gate.')))))));
 p:=public.prepare_site_visit_workflow_as_system('unknown-prepare',ctx,req);perform pg_temp.confirm_site_visit(p,'unknown-commit');
 if not exists(select 1 from public.site_visit_checklist_answers where id=a.id and answer_state='unknown' and answer_value='{}' and jsonb_array_length(answer_evidence->'uncertainty')=1) then raise exception 'uncertainty lost';end if;
 select * into a from public.site_visit_checklist_answers where id=a.id;
 req:=jsonb_set(jsonb_set(req,'{idempotency_key}','"clear-access-1"'),'{changes}',jsonb_build_array(jsonb_build_object('answer_id',a.id,'expected_revision',a.write_revision,'intent','clear','value',null,'reason','Operator explicitly cleared the field.','evidence','[]'::jsonb)));
 p:=public.prepare_site_visit_workflow_as_system('clear-prepare',ctx,req);perform pg_temp.confirm_site_visit(p,'clear-commit');
 if not exists(select 1 from public.site_visit_checklist_answers where id=a.id and answer_state='cleared' and answer_value='{}') then raise exception 'explicit clear lost';end if;
 begin perform public.prepare_site_visit_workflow_as_system('wrong-quote',ctx,jsonb_set(jsonb_set(req,'{idempotency_key}','"bad-quote-0001"'),'{changes}',jsonb_build_array(jsonb_build_object('answer_id',a.id,'expected_revision',a.write_revision+1,'intent','set','value','{"text":"Side gate"}'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('source_index',0,'quote','Verified side gate.'))))));raise exception 'fabricated quote accepted';
 exception when others then if sqlerrm<>'SITE_VISIT_QUOTE_NOT_IN_SOURCE' then raise;end if;end;
 raise notice 'PASS: uncertainty, explicit clear and fabricated source quote denial';
 -- A source graph changing and returning to its earlier content is still stale.
 select * into a from public.site_visit_checklist_answers where id=a.id;
 req:=jsonb_set(jsonb_set(req,'{idempotency_key}','"stale-access-01"'),'{changes,0,expected_revision}',to_jsonb(a.write_revision));
 p:=public.prepare_site_visit_workflow_as_system('stale-prepare',ctx,req);
 update public.companies set name='Changed' where id=(ctx->>'company')::uuid;
 update public.companies set name='Booking fixture' where id=(ctx->>'company')::uuid;
 begin perform pg_temp.confirm_site_visit(p,'stale-commit');raise exception 'ABA source accepted';exception when others then if sqlerrm<>'SITE_VISIT_SOURCE_STALE' then raise;end if;end;
 p2:=public.prepare_site_visit_workflow_as_system('supersede-prepare',ctx,jsonb_set(req,'{idempotency_key}','"superseding-001"')||jsonb_build_object('supersedes',p->>'change_set_id'));
 begin perform pg_temp.confirm_site_visit(p,'stale-commit');raise exception 'superseded accepted';exception when others then if sqlerrm<>'SITE_VISIT_CONFIRMATION_STALE' then raise;end if;end;
 perform public.reject_site_visit_workflow_as_actor((ctx->>'actor')::uuid,(ctx->>'company')::uuid,(p2->>'action_id')::uuid);
 begin perform pg_temp.confirm_site_visit(p2,'rejected-commit');raise exception 'rejected accepted';exception when others then if sqlerrm<>'SITE_VISIT_CONFIRMATION_STALE' then raise;end if;end;
 raise notice 'PASS: ABA source change, supersession and rejection invalidate old approvals';
end $$;

-- Independent review reproductions converted to regression assertions.
do $$ declare ctx jsonb:=pg_temp.workflow_context(); a public.site_visit_checklist_answers%rowtype;p jsonb;f jsonb;begin
 select * into a from public.site_visit_checklist_answers where field_id='access';
 insert into private.site_visit_write_tokens(transaction_id,backend_pid,entity,row_id) values(txid_current(),pg_backend_pid(),'site_visit_checklist_answers',a.id::text);
 update public.site_visit_checklist_answers set answer_evidence='{"evidence":[{"source_kind":"visit_artifact","quote":"PRIVATE PHOTO CAPTION"}]}'::jsonb,write_base_revision=a.write_revision where id=a.id;
 select * into a from public.site_visit_checklist_answers where id=a.id;
 f:=public.read_site_visit_workflow_as_system('review-read',ctx,jsonb_build_object('operation','get_form','site_visit_id',a.site_visit_id));
 if f::text like '%PRIVATE PHOTO CAPTION%' then raise exception 'read redaction baseline broken';end if;
 p:=public.inspect_site_visit_workflow_as_system('review-inspect',ctx,jsonb_build_object('operation','answer_form','site_visit_id',a.site_visit_id,'idempotency_key','review-leak-001','sources','[]'::jsonb,'changes',jsonb_build_array(jsonb_build_object('answer_id',a.id,'expected_revision',a.write_revision,'intent','clear','value',null,'reason','Operator clears','evidence','[]'::jsonb))));
 if p::text like '%PRIVATE PHOTO CAPTION%' then raise exception 'prior media evidence leaked';end if;
 raise notice 'PASS: text-answer inspection redacts inaccessible historical media evidence';
end $$;
set timezone='UTC';
do $$ declare ctx jsonb:=pg_temp.workflow_context();v public.site_visits%rowtype;p jsonb;p2 jsonb;req jsonb;t public.project_tasks%rowtype;begin
 select * into v from public.site_visits where id=(select(value#>>'{}')::uuid from workflow_fixture_state where name='visit');
 req:=jsonb_build_object('operation','reschedule','site_visit_id',v.id,'expected_sha256',private.agent_site_visit_workflow_hash(to_jsonb(v)),'local_start',to_char(current_date+21,'YYYY-MM-DD')||'T10:00:00','idempotency_key','review-super-001');
 p:=public.prepare_site_visit_workflow_as_system('review-super',ctx,req);
 select * into t from public.project_tasks where id='50000000-0000-4000-8000-000000000001';
 req:=req||jsonb_build_object('idempotency_key','review-super-002','supersedes',p->>'change_set_id','local_start',to_char((t.start_date at time zone 'UTC')::date,'YYYY-MM-DD')||'T08:00:00');
 p2:=public.prepare_site_visit_workflow_as_system('review-super-correct',ctx,req);
 if p2->>'status'<>'needs_input' then raise exception 'expected busy correction: %',p2;end if;
 begin perform pg_temp.confirm_site_visit(p,'review-super-commit');raise exception 'obsolete approval survived correction';exception when others then if sqlerrm<>'SITE_VISIT_CONFIRMATION_STALE' then raise;end if;end;
 p2:=public.prepare_site_visit_workflow_as_system('review-super-retry',ctx,req);
 if p2->>'status'<>'needs_input' or p2->>'replayed'<>'true' then raise exception 'correction retry lost its durable result';end if;
 raise notice 'PASS: needs-input correction closes old approval and replays durably';
end $$;
insert into public.users(id,company_id,first_name,last_name,firebase_uid,is_active) values('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Former','Employee','former-employee',true);
do $$ declare v uuid:=(select(value#>>'{}')::uuid from workflow_fixture_state where name='visit');begin
 perform private.reschedule_site_visit_for_actor('20000000-0000-4000-8000-000000000001',v,null,null,array['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003'],null);
end $$;
update public.users set is_active=false where id='20000000-0000-4000-8000-000000000003';
set timezone='UTC';
do $$ declare ctx jsonb:=pg_temp.workflow_context();v public.site_visits%rowtype;p jsonb;begin
 select * into v from public.site_visits where id=(select(value#>>'{}')::uuid from workflow_fixture_state where name='visit');
 p:=public.prepare_site_visit_workflow_as_system('review-cancel',ctx,jsonb_build_object('operation','cancel','site_visit_id',v.id,'expected_sha256',private.agent_site_visit_workflow_hash(to_jsonb(v)),'idempotency_key','review-cancel-01'));
 perform pg_temp.confirm_site_visit(p,'review-cancel-commit');
 if not exists(select 1 from public.site_visits where id=v.id and status='cancelled') then raise exception 'former employee cancellation failed';end if;
 raise notice 'PASS: approved cancellation preserves historical inactive assignees';
end $$;
-- The phone's actor-bound wrapper delegates to the real canonical completion.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fixture-firebase-non-uuid"}',false);
do $$ declare ctx jsonb:=pg_temp.workflow_context();v uuid;r jsonb;r2 jsonb;a uuid;begin
 v:=private.book_site_visit_for_actor((ctx->>'actor')::uuid,'30000000-0000-4000-8000-000000000001',now()+interval '32 days',60,null,null);
 r:=public.complete_site_visit_capture(v,'{}',(ctx->>'actor')::uuid);
 r2:=public.complete_site_visit_capture(v,'{}',(ctx->>'actor')::uuid);
 select activity_id into a from public.site_visits where id=v and status='completed' and completed_at is not null;
 if a is null or (select count(*) from public.activities where id=a)<>1 or r is distinct from r2 then raise exception 'canonical phone completion did not reconcile exactly: % %',r,r2;end if;
 raise notice 'PASS: actor-bound phone completion delegates canonical activity and replays once';
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
-- Cancelling preserves historical appointment values, including old crew states.
do $$ declare ctx jsonb:=pg_temp.workflow_context();v public.site_visits%rowtype;target_id uuid;p jsonb;begin
 target_id:=private.book_site_visit_for_actor((ctx->>'actor')::uuid,'30000000-0000-4000-8000-000000000001',now()+interval '33 days',60,null,null);
 perform private.allow_site_visit_booking_write(target_id,ctx->>'company','{"duration_minutes":600,"assignee_ids":[]}');
 update public.site_visits set duration_minutes=600,assignee_ids='{}' where site_visits.id=target_id;
 select * into v from public.site_visits where site_visits.id=target_id;
 p:=public.prepare_site_visit_workflow_as_system('legacy-cancel',ctx,jsonb_build_object('operation','cancel','site_visit_id',target_id,'expected_sha256',private.agent_site_visit_workflow_hash(to_jsonb(v)),'idempotency_key','legacy-cancel-01'));
 if p#>'{proposal,appointment,crew}'<>'[]' or p#>>'{proposal,appointment,duration_minutes}'<>'600' then raise exception 'historical cancellation preview changed stored values';end if;
 perform pg_temp.confirm_site_visit(p,'legacy-cancel-commit');
 if not exists(select 1 from public.site_visits where site_visits.id=target_id and status='cancelled' and duration_minutes=600 and assignee_ids='{}') then raise exception 'historical cancellation failed';end if;
 raise notice 'PASS: cancellation preserves legacy duration and empty crew';
end $$;
do $$ declare ctx jsonb:=pg_temp.workflow_context();p jsonb;req jsonb;begin
 update public.project_tasks set start_date=(current_date+35)::timestamptz,end_date=(current_date+32)::timestamptz,all_day=false,start_time='08:00',end_time='17:00' where id='50000000-0000-4000-8000-000000000001';
 req:=jsonb_build_object('operation','book','opportunity_id','30000000-0000-4000-8000-000000000001','idempotency_key','invalid-task-01','local_start',to_char(current_date+35,'YYYY-MM-DD')||'T10:00:00','duration_minutes',60,'assignee_ids',jsonb_build_array(ctx->>'actor'),'reminder_lead_minutes',null);
 p:=public.inspect_site_visit_workflow_as_system('invalid-task',ctx,req);
 if p#>>'{proposal,ready}'<>'false' or not(p#>'{proposal,availability,conflicts}' @> '[{"kind":"task","reason":"source_invalid"}]') then raise exception 'malformed task did not block approval: %',p;end if;
 update public.project_tasks set start_date=null where id='50000000-0000-4000-8000-000000000001';
 insert into public.calendar_user_events(user_id,company_id,type,title,start_date,end_date,all_day,status)
 values(ctx->>'actor',ctx->>'company','personal','Malformed current-day event',(current_date+35)::timestamptz,(current_date+32)::timestamptz,false,'none');
 p:=public.inspect_site_visit_workflow_as_system('invalid-calendar',ctx,req);
 if p#>>'{proposal,ready}'<>'false' or not(p#>'{proposal,availability,conflicts}' @> '[{"kind":"personal","reason":"unavailable"}]') then raise exception 'malformed calendar source did not block approval: %',p;end if;
 raise notice 'PASS: malformed assigned task and active calendar sources block availability';
end $$;
