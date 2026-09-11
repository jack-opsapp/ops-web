\set ON_ERROR_STOP on
select set_config('request.jwt.claims','{"sub":"phone-a"}',false);
create function public.phone_fixture_command(p_text text) returns jsonb language sql as $$
 select jsonb_build_object('protocol','site-visit-writes:2026-09-10.v1','company_id',company_id,'entity','answer','rows',
 jsonb_build_array(jsonb_build_object('id',id,'base_revision',write_revision,'before',to_jsonb(a),'values',
 (to_jsonb(a)-array['opportunity_id','created_by','created_at','updated_at','write_revision','write_base_revision','answer_state','answer_evidence'])||jsonb_build_object('answer_value',jsonb_build_object('text',p_text)))))
 from public.site_visit_checklist_answers a where id='10000000-0000-4000-8000-000000000004'
$$;
create function public.phone_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
-- Copied live company and granular child RLS; runtime executes as anon.
grant usage on schema private,auth to anon,authenticated;
grant select,insert,update on public.site_visits,public.site_visit_types,public.site_visit_checklist_answers to anon,authenticated;
alter table public.site_visits enable row level security;
alter table public.site_visit_types enable row level security;
alter table public.site_visit_checklist_answers enable row level security;
create policy company_isolation on public.site_visits for all using(company_id=private.get_user_company_id()::text);
create policy assigned_lead_scope_update on public.site_visits as restrictive for update using(private.current_user_can_edit_site_visit(company_id,opportunity_id,project_id,project_ref)) with check(private.current_user_can_edit_site_visit(company_id,opportunity_id,project_id,project_ref));
create policy company_isolation on public.site_visit_checklist_answers for all using(company_id=private.get_user_company_id()::text) with check(company_id=private.get_user_company_id()::text);
create policy parent_insert on public.site_visit_checklist_answers as restrictive for insert with check(private.current_user_can_access_site_visit_child(site_visit_id,company_id,true));
create policy parent_update on public.site_visit_checklist_answers as restrictive for update using(private.current_user_can_access_site_visit_child(site_visit_id,company_id,true)) with check(private.current_user_can_access_site_visit_child(site_visit_id,company_id,true));
create policy company_select on public.site_visit_types for select using(company_id=private.get_user_company_id()::text);
create policy company_update on public.site_visit_types for update using(company_id=private.get_user_company_id()::text and private.current_user_has_permission('settings.company','own')) with check(company_id=private.get_user_company_id()::text and private.current_user_has_permission('settings.company','own'));
create policy parent_select on public.site_visit_checklist_answers as restrictive for select using(private.current_user_can_access_site_visit_child(site_visit_id,company_id,false));
create policy assigned_lead_scope_select on public.site_visits as restrictive for select using(private.current_user_can_view_site_visit(company_id,opportunity_id,project_id,project_ref));
set role anon;

-- The current JWT actor has authority, but cannot execute another actor's queue.
do $$declare blocked boolean; command jsonb:=public.phone_fixture_command('wrong actor'); capture jsonb;
begin
 blocked:=false;begin perform public.apply_site_visit_write(gen_random_uuid(),command,'10000000-0000-4000-8000-000000000005');exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'authorized replacement session cannot submit another actor command');
 blocked:=false;begin perform public.review_site_visit_write(command,'10000000-0000-4000-8000-000000000005');exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'review binds the immutable originating actor');
 blocked:=false;begin perform public.resolve_site_visit_write(gen_random_uuid(),gen_random_uuid(),command,'current','[]','10000000-0000-4000-8000-000000000005');exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'resolution binds the immutable originating actor before supersession');
 select to_jsonb(v) into capture from public.site_visits v limit 1;
 blocked:=false;begin perform public.save_site_visit_capture(capture,'10000000-0000-4000-8000-000000000005');exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'capture rejects a different authenticated account');
 blocked:=false;begin perform public.complete_site_visit_capture((capture->>'id')::uuid,'{}','10000000-0000-4000-8000-000000000005');exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'completion rejects actor mismatch before canonical completion');
 blocked:=false;begin perform public.apply_site_visit_write(gen_random_uuid(),command,null);exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'missing expected actor is rejected');
end$$;
do $$declare command jsonb;result jsonb;receipt jsonb;review jsonb;original_id uuid:=gen_random_uuid();resolution_id uuid:=gen_random_uuid();blocked boolean:=false;
begin
 command:=public.phone_fixture_command('phone durable');
 receipt:=public.apply_site_visit_write(original_id,command,'10000000-0000-4000-8000-000000000003');
 perform set_config('phone.fixture.receipt_id',original_id::text,false);
 perform set_config('phone.fixture.saved_command',command::text,false);
 perform set_config('phone.fixture.receipt',receipt::text,false);
 perform public.phone_assert(receipt->>'outcome'='saved','phone wrapper saves under actual anon role and JWT identity');
 result:=public.apply_site_visit_write(original_id,command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result=receipt,'timeout and duplicate replay return exact receipt');
 begin perform public.apply_site_visit_write(original_id,jsonb_set(command,'{rows,0,values,answer_value,text}','"tampered"'),'10000000-0000-4000-8000-000000000003');exception when invalid_parameter_value then blocked:=true;end;
 perform public.phone_assert(blocked,'immutable command identity rejects changed payload');
 command:=public.phone_fixture_command('cancel before original arrives');original_id:=gen_random_uuid();
 review:=public.review_site_visit_write(command,'10000000-0000-4000-8000-000000000003')->'rows';
 receipt:=public.resolve_site_visit_write(resolution_id,original_id,command,'current',review,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(receipt->>'outcome'='resolved','current-version choice durably cancels an undelivered original');
 perform public.phone_assert(public.resolve_site_visit_write(resolution_id,original_id,command,'current',review,'10000000-0000-4000-8000-000000000003')=receipt,'resolution lost-response replay is exact');
 result:=public.apply_site_visit_write(original_id,command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->>'outcome'='superseded' and (result->'rows'->0->'answer_value'->>'text')='phone durable','delayed original cannot execute after current-version choice');
 command:=public.phone_fixture_command('explicit pending choice');original_id:=gen_random_uuid();resolution_id:=gen_random_uuid();
 perform public.apply_site_visit_write(gen_random_uuid(),public.phone_fixture_command('other phone'),'10000000-0000-4000-8000-000000000003');
 result:=public.apply_site_visit_write(original_id,command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->>'outcome'='conflict','two phones retain pending and current versions');
 review:=public.review_site_visit_write(command,'10000000-0000-4000-8000-000000000003')->'rows';
 result:=public.resolve_site_visit_write(resolution_id,original_id,command,'pending',review,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->>'outcome'='saved' and result->'rows'->0->'answer_value'->>'text'='explicit pending choice','reviewed pending version saves against the exact displayed current revision');
 perform public.phone_assert(public.apply_site_visit_write(original_id,command,'10000000-0000-4000-8000-000000000003')->>'outcome'='superseded','resolved stale command stays superseded on replay');
 blocked:=false;
 begin perform public.apply_site_visit_write(gen_random_uuid(),jsonb_set(public.phone_fixture_command('forged'),'{rows,0,values,answer_evidence}','{"source":"mcp"}'),'10000000-0000-4000-8000-000000000003');exception when invalid_parameter_value then blocked:=true;end;
 perform public.phone_assert(blocked,'phone wrapper rejects fabricated MCP evidence');
 blocked:=false;
 begin update public.site_visit_checklist_answers set answer_evidence='{"source":"mcp"}',write_base_revision=write_revision;exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'direct REST writer cannot fabricate provenance');
end$$;
reset role;
do $$declare cmd jsonb;r jsonb;v jsonb;saved jsonb;blocked boolean:=false;i integer;
begin
 cmd:=public.phone_fixture_command('evidence retained');
 cmd:=jsonb_set(cmd,'{rows,0,values,answer_evidence}','{"source":"fixture-host","quote":"evidence retained"}');
 saved:=private.apply_site_visit_rows('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','answer',cmd->'rows');
 cmd:=public.phone_fixture_command('evidence retained');
 r:=public.apply_site_visit_write(gen_random_uuid(),cmd,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(r->'rows'->0->'answer_evidence'=saved->'rows'->0->'answer_evidence','incidental phone no-op preserves host evidence');
 v:=cmd->'rows'->0->'values';v:=v||'{"kind":"photo","answer_value":{"artifactIds":["99999999-0000-4000-8000-000000000001"]}}';
 begin perform private.apply_site_visit_rows('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','answer',jsonb_build_array(jsonb_build_object('id',v->'id','base_revision',r->'rows'->0->'write_revision','values',v)));exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'syntactically valid absent media is rejected');

 -- Real artifact kinds and rendered-only uploaded markup are accepted.
 for i in 1..2 loop
   insert into public.site_visit_artifacts(id,site_visit_id,company_id,kind,source,rendered_asset_url,created_by)
     select ('88888888-0000-4000-8000-00000000000'||i)::uuid,(v->>'site_visit_id')::uuid,v->>'company_id',
       case i when 1 then 'annotated_photo' else 'dimensioned_photo' end,'camera','https://fixture.invalid/rendered.jpg','phone-a';
   v:=v||jsonb_build_object('id',('77777777-0000-4000-8000-00000000000'||i),'field_id','markup-'||i,'kind','photo_markup',
     'answer_value',jsonb_build_object('artifactIds',jsonb_build_array('88888888-0000-4000-8000-00000000000'||i)));
   r:=private.apply_site_visit_rows('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','answer',
     jsonb_build_array(jsonb_build_object('id',v->'id','base_revision',0,'values',v)));
   perform public.phone_assert(r->>'outcome'='saved','valid uploaded markup kind '||i||' saves with rendered asset custody');
 end loop;
 insert into public.site_visit_artifacts(id,site_visit_id,company_id,kind,source,asset_url,created_by)
   values('88888888-0000-4000-8000-000000000003',(v->>'site_visit_id')::uuid,v->>'company_id','photo','camera','https://fixture.invalid/photo.jpg','phone-a');
 v:=v||'{"id":"77777777-0000-4000-8000-000000000003","field_id":"markup-ordinary","answer_value":{"artifactIds":["88888888-0000-4000-8000-000000000003"]}}';
 blocked:=false;
 begin perform private.apply_site_visit_rows('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','answer',jsonb_build_array(jsonb_build_object('id',v->'id','base_revision',0,'values',v)));exception when insufficient_privilege then blocked:=true;end;
 perform public.phone_assert(blocked,'ordinary photo cannot satisfy a markup field');
 v:=v||'{"kind":"photo"}';
 r:=private.apply_site_visit_rows('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','answer',jsonb_build_array(jsonb_build_object('id',v->'id','base_revision',0,'values',v)));
 perform public.phone_assert(r->>'outcome'='saved','ordinary uploaded photo satisfies a photo field');
 update public.site_visits set status='completed',completed_at=now();
 perform public.phone_assert(public.apply_site_visit_write(current_setting('phone.fixture.receipt_id')::uuid,current_setting('phone.fixture.saved_command')::jsonb,'10000000-0000-4000-8000-000000000003')=current_setting('phone.fixture.receipt')::jsonb,'saved receipt replays exactly after completion without executing new work');
 perform public.phone_assert(public.apply_site_visit_write(gen_random_uuid(),cmd,'10000000-0000-4000-8000-000000000003')->>'reason'='capture_closed','completed capture denies new answer command');
 blocked:=false;
 begin perform public.save_site_visit_capture(to_jsonb(s)||'{"status":"in_progress","completed_at":null}','10000000-0000-4000-8000-000000000003') from public.site_visits s;exception when object_not_in_prerequisite_state then blocked:=true;end;
 perform public.phone_assert(blocked,'completed capture RPC denies content overwrite');
 update public.site_visits set status='in_progress',completed_at=null,booked_at=now(),scheduled_at='2026-12-01T12:00:00Z',duration_minutes=90,calendar_event_id='canonical-calendar';
 select to_jsonb(s) into v from public.site_visits s;
 r:=to_jsonb(public.save_site_visit_capture(v||'{"scheduled_at":"2020-01-01T00:00:00Z","duration_minutes":1,"calendar_event_id":null,"status":"scheduled","notes":"capture content"}','10000000-0000-4000-8000-000000000003'));
 perform public.phone_assert(r->>'scheduled_at'=v->>'scheduled_at' and r->>'duration_minutes'='90' and r->>'calendar_event_id'='canonical-calendar' and r->>'status'='in_progress','lost-insert-response capture preserves canonical booking metadata and started status');
end$$;
update public.users set is_active=false where firebase_uid='phone-a';
set role anon;
do $$declare denied boolean:=false;begin
 begin perform public.apply_site_visit_write(current_setting('phone.fixture.receipt_id')::uuid,current_setting('phone.fixture.saved_command')::jsonb,'10000000-0000-4000-8000-000000000003');exception when insufficient_privilege then denied:=true;end;
 perform public.phone_assert(denied,'revoked actor cannot replay a formerly authorized receipt');
end$$;
reset role;
update public.users set is_active=true where firebase_uid='phone-a';
set role anon;
do $$declare denied boolean:=false;begin
 begin perform public.apply_site_visit_write(gen_random_uuid(),jsonb_set(current_setting('phone.fixture.saved_command')::jsonb,'{company_id}','"other-company"'),'10000000-0000-4000-8000-000000000003');exception when insufficient_privilege then denied:=true;end;
 perform public.phone_assert(denied,'phone command cannot cross tenant boundary');
end$$;
reset role;
do $$declare command jsonb;result jsonb;review jsonb;original uuid:=gen_random_uuid();collision uuid:=gen_random_uuid();v jsonb;
begin
 command:=public.phone_fixture_command('reviewed logical collision');
 command:=jsonb_set(jsonb_set(jsonb_set(command,'{rows,0,id}',to_jsonb(collision::text)),'{rows,0,values,id}',to_jsonb(collision::text)),'{rows,0,base_revision}','0');
 result:=public.apply_site_visit_write(original,command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->>'reason'='field_exists','different row IDs preserve a logical field collision');
 review:=public.review_site_visit_write(command,'10000000-0000-4000-8000-000000000003')->'rows';
 result:=public.resolve_site_visit_write(gen_random_uuid(),original,command,'pending',review,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->>'outcome'='saved' and result->'rows'->0->>'id'='10000000-0000-4000-8000-000000000004','explicit pending choice reconciles logical identity without retargeting original command');
 select to_jsonb(t)-array['created_at','updated_at','write_revision','write_base_revision'] into v from public.site_visit_types t where id='new-default';
 v:=v||'{"id":"phone-slug-collision","name":"Reviewed company default"}';
 command:=jsonb_build_object('protocol','site-visit-writes:2026-09-10.v1','company_id',v->'company_id','entity','template','rows',jsonb_build_array(jsonb_build_object('id',v->'id','base_revision',0,'values',v)));
 original:=gen_random_uuid();result:=public.apply_site_visit_write(original,command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->>'outcome'='conflict' and jsonb_array_length(result->'rows')>0,'slug/default insertion conflict returns current company rows');
 review:=public.review_site_visit_write(command,'10000000-0000-4000-8000-000000000003')->'rows';
 result:=public.resolve_site_visit_write(gen_random_uuid(),original,command,'pending',review,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->>'outcome'='saved' and result->'rows'->0->>'id'='new-default','explicit review reconciles a template slug collision');
end$$;
-- Authority tests use the live assignment/view-prerequisite permission helpers.
insert into public.opportunities(id,company_id,assigned_to) values('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003');
update public.site_visits set opportunity_id='10000000-0000-4000-8000-000000000011';
select set_config('phone.fixture.command',public.phone_fixture_command('unassigned')::text,false);
select set_config('request.jwt.claims','{"sub":"phone-b"}',false);
set role anon;
do $$declare denied boolean:=false;cmd jsonb;
begin
 cmd:=current_setting('phone.fixture.command')::jsonb;
 perform public.phone_assert((select count(*)=0 from public.site_visit_checklist_answers),'RLS hides answers on inaccessible visits');
 begin perform public.apply_site_visit_write(gen_random_uuid(),cmd,'10000000-0000-4000-8000-000000000005');exception when insufficient_privilege then denied:=true;end;
 perform public.phone_assert(denied,'assigned-only actor cannot write another actors locked visit');
 denied:=false;
 begin perform public.review_site_visit_write(cmd,'10000000-0000-4000-8000-000000000005');exception when insufficient_privilege then denied:=true;end;
 perform public.phone_assert(denied,'review does not disclose inaccessible current values');
end$$;
reset role;
update public.site_visits set opportunity_id=null;
select set_config('request.jwt.claims','{"sub":"phone-a"}',false);
insert into public.site_visits(id,company_id,scheduled_at,status,created_by)
 values('99999999-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002',now(),'in_progress','10000000-0000-4000-8000-000000000003');
set role anon;
do $$declare denied boolean:=false;v public.site_visits%rowtype;
begin
 begin perform public.delete_site_visit_capture('99999999-0000-4000-8000-000000000010',now(),'10000000-0000-4000-8000-000000000005');exception when insufficient_privilege then denied:=true;end;
 perform public.phone_assert(denied,'capture deletion rejects replacement actor');
 v:=public.delete_site_visit_capture('99999999-0000-4000-8000-000000000010','2026-09-10T12:00:00Z','10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(v.deleted_at='2026-09-10T12:00:00Z' and v.status='in_progress','actor-bound deletion preserves started status');
 v:=public.delete_site_visit_capture(v.id,'2026-09-11T12:00:00Z','10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(v.deleted_at='2026-09-10T12:00:00Z','replayed capture deletion preserves original timestamp');
end$$;
reset role;
update public.site_visits set deleted_at=null,booked_at=now() where id='99999999-0000-4000-8000-000000000010';
set role anon;
do $$declare denied boolean:=false;begin
 begin perform public.delete_site_visit_capture('99999999-0000-4000-8000-000000000010',now(),'10000000-0000-4000-8000-000000000003');exception when object_not_in_prerequisite_state then denied:=true;end;
 perform public.phone_assert(denied,'capture deletion cannot bypass canonical booking cancellation');
end$$;
reset role;
update public.site_visits set booked_at=null,status='completed',completed_at=now() where id='99999999-0000-4000-8000-000000000010';
set role anon;
do $$declare denied boolean:=false;begin
 begin perform public.delete_site_visit_capture('99999999-0000-4000-8000-000000000010',now(),'10000000-0000-4000-8000-000000000003');exception when object_not_in_prerequisite_state then denied:=true;end;
 perform public.phone_assert(denied,'capture deletion cannot hide a completed visit');
end$$;
reset role;
set role anon;
do $$declare command jsonb;result jsonb;again jsonb;cid uuid:=gen_random_uuid();denied boolean:=false;
begin
 command:=public.phone_fixture_command('unused');
 command:=jsonb_set(command,'{rows,0,id}','"99999999-0000-4000-8000-000000000011"');
 command:=jsonb_set(command,'{rows,0,base_revision}','0');
 command:=jsonb_set(command,'{rows,0,values,id}','"99999999-0000-4000-8000-000000000011"');
 command:=jsonb_set(command,'{rows,0,values,field_id}','"initial-empty"');
 command:=jsonb_set(command,'{rows,0,values,answer_value}','{}');
 result:=public.apply_site_visit_write(cid,command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->'rows'->0->'answer_state'='null'::jsonb,'untouched phone snapshot remains unanswered');
 command:=jsonb_set(command,'{rows,0,base_revision}',result->'rows'->0->'write_revision');
 command:=jsonb_set(command,'{rows,0,clear_answer}','true');
 cid:=gen_random_uuid();
 result:=public.apply_site_visit_write(cid,command,'10000000-0000-4000-8000-000000000003');
 again:=public.apply_site_visit_write(cid,command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result=again and result->'rows'->0->>'answer_state'='cleared','explicit empty clear is durable and replays identically');
 command:=jsonb_set(command,'{rows,0,values,answer_value}','{"text":"nonempty"}');
 begin perform public.apply_site_visit_write(gen_random_uuid(),command,'10000000-0000-4000-8000-000000000003');exception when invalid_parameter_value then denied:=true;end;
 perform public.phone_assert(denied,'clear intent cannot carry nonempty answer');
 command:=jsonb_set(command,'{rows,0,values,answer_value}','{}');
 command:=jsonb_set(command,'{rows,0,id}','"99999999-0000-4000-8000-000000000012"');
 command:=jsonb_set(command,'{rows,0,values,id}','"99999999-0000-4000-8000-000000000012"');
 command:=jsonb_set(command,'{rows,0,values,field_id}','"initial-explicit-clear"');
 command:=jsonb_set(command,'{rows,0,values,kind}','"measurement"');
 command:=jsonb_set(command,'{rows,0,base_revision}','0');
 result:=public.apply_site_visit_write(gen_random_uuid(),command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->'rows'->0->>'answer_state'='cleared','canonical empty measurement clear differs from untouched initial snapshot');
end$$;
reset role;
do $$declare command jsonb;result jsonb;begin
 command:=public.phone_fixture_command('unused');
 command:=jsonb_set(command,'{rows,0,values,answer_value}','{}');
 command:=jsonb_set(command,'{rows,0,values,answer_state}','"unknown"');
 result:=private.apply_site_visit_rows('10000000-0000-4000-8000-000000000003',command->>'company_id','answer',command->'rows');
 perform public.phone_assert(result->'rows'->0->>'answer_state'='unknown','host unknown remains distinct from untouched phone snapshot');
end$$;
set role anon;
do $$declare command jsonb;result jsonb;current_rows jsonb;begin
 command:=jsonb_set(public.phone_fixture_command('unused'),'{rows,0,values,answer_value}','{}');
 result:=public.apply_site_visit_write(gen_random_uuid(),command,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->'rows'->0->>'answer_state'='unknown','phone semantic no-op preserves authoritative unknown');
 command:=jsonb_set(command,'{rows,0,base_revision}',result->'rows'->0->'write_revision');
 command:=jsonb_set(command,'{rows,0,clear_answer}','true');
 current_rows:=public.review_site_visit_write(command,'10000000-0000-4000-8000-000000000003')->'rows';
 result:=public.resolve_site_visit_write(gen_random_uuid(),gen_random_uuid(),command,'pending',current_rows,'10000000-0000-4000-8000-000000000003');
 perform public.phone_assert(result->'rows'->0->>'answer_state'='cleared','pending resolution preserves explicit clear intent against unknown');
end$$;
reset role;
create table public.phone_fixture_races(id text primary key,command jsonb,result jsonb);
insert into public.phone_fixture_races(id,command) values('one',public.phone_fixture_command('simultaneous phone one')),('two',public.phone_fixture_command('simultaneous phone two'));
