\set ON_ERROR_STOP on
do $$
declare row_id uuid:='10000000-0000-4000-8000-000000000004';v bigint;stamp timestamptz;blocked boolean;
begin
 select write_revision into v from public.site_visit_checklist_answers where id=row_id;
 update public.site_visit_checklist_answers set answer_value='{"text":"MCP answer"}',write_base_revision=v where id=row_id;
 blocked:=false;
 begin update public.site_visit_checklist_answers set answer_value='{"text":"other host"}',write_base_revision=v where id=row_id;
 exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL: two hosts lost an answer';end if;
 raise notice 'PASS: MCP-before-phone and two-host stale revisions are rejected';
 select write_revision,updated_at into v,stamp from public.site_visit_checklist_answers where id=row_id;
 update public.site_visit_checklist_answers set answer_value='{"text":"MCP answer"}',write_base_revision=v-1 where id=row_id;
 if (select write_revision<>v or updated_at<>stamp or write_base_revision is not null from public.site_visit_checklist_answers where id=row_id) then raise exception 'FAIL: duplicate replay changed revision';end if;
 raise notice 'PASS: exact duplicate replay preserves value, timestamp and revision';
 update public.site_visit_checklist_answers set answer_value='{"text":"phone first"}',write_base_revision=v where id=row_id;
 blocked:=false;
 begin update public.site_visit_checklist_answers set answer_value='{"text":"stale MCP approval"}',write_base_revision=v where id=row_id;
 exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL: stale approval lost phone work';end if;
 raise notice 'PASS: phone-before-MCP approval cannot overwrite the phone';
 blocked:=false;
 begin update public.site_visit_checklist_answers set deleted_at=now(),write_base_revision=v where id=row_id;
 exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL: stale tombstone removed an answer';end if;
 raise notice 'PASS: delayed deletion preserves newer work';
 select write_revision into v from public.site_visit_checklist_answers where id=row_id;
 blocked:=false;
 begin update public.site_visit_checklist_answers set label='Rewritten history',write_base_revision=v where id=row_id;
 exception when object_not_in_prerequisite_state then blocked:=true;end;
 if not blocked then raise exception 'FAIL: snapshot was rewritten';end if;
 raise notice 'PASS: per-visit definition snapshots are immutable';
 update public.site_visits set status='completed' where id='10000000-0000-4000-8000-000000000001';
 update public.site_visit_checklist_answers set answer_value='{"text":"phone first"}',write_base_revision=v-1 where id=row_id;
 blocked:=false;
 begin update public.site_visit_checklist_answers set answer_value='{"text":"after completion"}',write_base_revision=v where id=row_id;
 exception when object_not_in_prerequisite_state then blocked:=true;end;
 if not blocked then raise exception 'FAIL: completed record changed';end if;
 raise notice 'PASS: completed records reject changes but accept an exact saved duplicate';
 if exists(select 1 from public.site_visit_checklist_answers where id=row_id and answer_value<>'{"text":"phone first"}'::jsonb) then raise exception 'FAIL: independent readback mismatch';end if;
 raise notice 'PASS: independent answer readback matches the winning write';
end $$;

insert into public.site_visit_types(id,company_id,slug,name,fields,write_base_revision) values ('fixture-type','10000000-0000-4000-8000-000000000002','inspection','Inspection','[{"id":"access","label":"Access","kind":"short_text","required":true,"sortOrder":10}]',0);
do $$
declare blocked boolean:=false;
begin
 update public.site_visit_types set name='Revised inspection',write_base_revision=1 where id='fixture-type';
 begin update public.site_visit_types set name='Old phone inspection' where id='fixture-type';
 exception when serialization_failure then blocked:=true;end;
 if not blocked then raise exception 'FAIL: legacy template overwrite accepted';end if;
 if (select label from public.site_visit_checklist_answers where id='10000000-0000-4000-8000-000000000004')<>'Access' then raise exception 'FAIL: template changed historical snapshot';end if;
 raise notice 'PASS: template edits preserve history and reject delayed legacy edits';
 if has_table_privilege('anon','private.site_visit_concurrency_companies','INSERT') or has_table_privilege('service_role','private.site_visit_concurrency_companies','UPDATE')
 or has_function_privilege('anon','private.site_visit_guard_versioned_write()','EXECUTE') then raise exception 'FAIL: compatibility activation or trigger helper exposed';end if;
 raise notice 'PASS: compatibility activation is not granted to app or service roles';
end $$;
