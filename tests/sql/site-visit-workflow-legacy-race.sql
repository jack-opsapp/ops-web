\set ON_ERROR_STOP on
-- The assertion is deliberately against an unconditional legacy upsert.
-- RED on baseline; GREEN when the enabled-company trigger denies the overwrite.
insert into public.site_visits(id,company_id,scheduled_at,created_by) values
('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',now(),'10000000-0000-4000-8000-000000000003');
insert into public.site_visit_checklist_answers(id,site_visit_id,company_id,field_id,label,kind,answer_value,created_by) values
('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','access','Access','short_text','{"text":"server answer"}','10000000-0000-4000-8000-000000000003');
do $$ begin if to_regclass('private.site_visit_concurrency_companies') is not null then execute 'insert into private.site_visit_concurrency_companies(company_id) values (''10000000-0000-4000-8000-000000000002'')';end if;end $$;
do $$
declare blocked boolean:=false;
begin
 begin
  update public.site_visit_checklist_answers set answer_value='{"text":"delayed offline phone"}' where id='10000000-0000-4000-8000-000000000004';
 exception when sqlstate '40001' then blocked:=true;
 end;
 if not blocked then raise exception 'FAIL: legacy delayed phone silently overwrote the server answer';end if;
 if (select answer_value from public.site_visit_checklist_answers where id='10000000-0000-4000-8000-000000000004')<>'{"text":"server answer"}'::jsonb then raise exception 'FAIL: server version lost';end if;
 raise notice 'PASS: legacy delayed answer is rejected and the current answer is preserved';
end $$;
