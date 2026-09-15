\set ON_ERROR_STOP on
create function pg_temp.fx(i integer) returns uuid language sql immutable as $$
 select ('77000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
$$;
create temp table assertions(label text);
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAILED: %',label; end if;
 insert into assertions values(label); end; $$;
create function pg_temp.fail(command jsonb,expected text,label text) returns void language plpgsql as $$
begin
 begin perform public.correct_expense_for_review(command); raise exception 'Expected failure: %',label;
 exception when others then
   if sqlstate<>expected then raise exception 'FAILED: %, wanted %, got %: %',label,expected,sqlstate,sqlerrm; end if;
 end;
 perform pg_temp.ok(true,label);
end; $$;
insert into companies(id) values(pg_temp.fx(1)),(pg_temp.fx(2));
insert into users(id,company_id,firebase_uid,is_active,is_company_admin) values
 (pg_temp.fx(10),pg_temp.fx(1),'p7-reviewer',true,false),
 (pg_temp.fx(11),pg_temp.fx(1),'p7-crew',true,false),
 (pg_temp.fx(12),pg_temp.fx(1),'p7-peer',true,false),
 (pg_temp.fx(13),pg_temp.fx(1),'p7-admin',true,true),
 (pg_temp.fx(20),pg_temp.fx(2),'p7-foreign',true,true);
insert into user_permission_overrides(user_id,company_id,permission,scope,granted) values
 (pg_temp.fx(10),pg_temp.fx(1),'expenses.approve','all',true),
 (pg_temp.fx(10),pg_temp.fx(1),'expenses.view','all',true),
 (pg_temp.fx(11),pg_temp.fx(1),'expenses.view','own',true),
 (pg_temp.fx(11),pg_temp.fx(1),'expenses.edit','own',true),
 (pg_temp.fx(12),pg_temp.fx(1),'expenses.view','own',true);
insert into projects(id,company_id,title,status) values
 (pg_temp.fx(31),pg_temp.fx(1),'Original project','in_progress'),
 (pg_temp.fx(32),pg_temp.fx(1),'Corrected project','in_progress'),
 (pg_temp.fx(33),pg_temp.fx(2),'Foreign project','in_progress');
insert into expense_categories(id,company_id,name,is_active) values
 (pg_temp.fx(41),pg_temp.fx(1),'Original category',true),
 (pg_temp.fx(42),pg_temp.fx(1),'Corrected category',true),
 (pg_temp.fx(43),pg_temp.fx(2),'Foreign category',true);
insert into expense_settings(company_id,review_frequency,auto_approve_threshold,require_receipt_photo)
 values(pg_temp.fx(1),'monthly',0,true);
insert into expense_batches(id,company_id,submitted_by,status,batch_number,amendment_number)
 values(pg_temp.fx(100),pg_temp.fx(1),pg_temp.fx(11),'pending_review','CORRECTION-1',0),
 (pg_temp.fx(101),pg_temp.fx(1),pg_temp.fx(11),'approved','CORRECTION-2',0),
 (pg_temp.fx(102),pg_temp.fx(1),pg_temp.fx(11),'open','CORRECTION-3',0);
insert into expenses(id,company_id,submitted_by,batch_id,status,category_id,merchant_name,description,
 amount,tax_amount,currency,expense_date,payment_method,receipt_image_url,ocr_raw_data,accounting_sync_status)
 select pg_temp.fx(i),pg_temp.fx(1),pg_temp.fx(11),pg_temp.fx(100),'submitted',pg_temp.fx(41),'Original merchant',
 'Original description',100,5,'CAD',current_date,'personal_card','https://example.test/receipt.jpg','{"merchant":"original OCR"}','pending'
 from generate_series(200,240) i;
insert into expense_project_allocations(expense_id,project_id,percentage)
 select pg_temp.fx(i),pg_temp.fx(31)::text,100 from generate_series(200,240) i;
create function pg_temp.cmd(i integer,req integer default 500) returns jsonb language sql as $$
 select private.expense_correction_content(e)||jsonb_build_object('request_id',pg_temp.fx(req),'expense_id',e.id,
 'company_id',e.company_id,'actor_id',pg_temp.fx(10),'submitted_by',e.submitted_by,
 'expected_status',e.status,'expected_updated_at',e.updated_at,'correction_note','Use the receipt total, including tax.',
 'amount',105,'category_id',pg_temp.fx(42),'allocations',jsonb_build_array(jsonb_build_object(
 'project_id',pg_temp.fx(32),'percentage',100,'amount',null))) from expenses e where id=pg_temp.fx(i);
$$;
create temp table command_hold(command jsonb);
insert into command_hold values(pg_temp.cmd(200));
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
create temp table receipt_hold as select public.correct_expense_for_review((select command from command_hold)) receipt;
select pg_temp.ok((select status='rejected' and amount=105 and flagged_by=pg_temp.fx(10)
 and rejected_by=pg_temp.fx(10) and approved_at is null and approved_by is null from expenses where id=pg_temp.fx(200)),
 'correction changes content and returns without approval');
select pg_temp.ok((select receipt->>'replayed'='false' and receipt->'correction'->'before'->>'category_name'='Original category'
 and receipt->'correction'->'after'->>'category_name'='Corrected category'
 and receipt->'correction'->'before'->'allocations'->0->>'project_title'='Original project'
 and receipt->'correction'->'after'->'allocations'->0->>'project_title'='Corrected project' from receipt_hold),
 'immutable snapshots preserve before after and human labels');
select pg_temp.ok((select receipt_image_url='https://example.test/receipt.jpg' and ocr_raw_data='{"merchant":"original OCR"}'::jsonb
 from expenses where id=pg_temp.fx(200)),'receipt and OCR untouched');
select pg_temp.ok((select count(*)=1 from notifications where type='expense_rejected' and user_id=pg_temp.fx(11)::text
 and company_id=pg_temp.fx(1)::text and expense_id=pg_temp.fx(200)::text and batch_id=pg_temp.fx(100)::text
 and deep_link_type='expense' and dedupe_key='expense_correction:'||pg_temp.fx(500)::text),'one exact submitter notification');
select pg_temp.ok((public.correct_expense_for_review((select command from command_hold))->>'replayed')::boolean,
 'response-loss retry uses original immutable receipt');
select pg_temp.ok((select count(*)=1 from notifications),'replay does not duplicate notification');
select pg_temp.ok((select count(*)=0 from expense_accounting_events),'correction creates no financial ledger entries');
select pg_temp.ok((select count(*)=0 from accounting_sync_queue),'correction enqueues no provider effects');
select pg_temp.ok((select reimbursement_amount=0 from expense_batches where id=pg_temp.fx(100)),
 'correction creates no payroll reimbursement debt');
select pg_temp.ok((select count(*)=0 from private.expense_correction_scope),'transaction capability removed');
select pg_temp.fail((select command||jsonb_build_object('amount',106) from command_hold),'22023','request reuse with new content denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('expected_updated_at','2020-01-01T00:00:00Z'),
 'P0001','stale revision denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('actor_id',pg_temp.fx(13)),'42501','forged actor denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('company_id',pg_temp.fx(2)),'42501','forged company denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('submitted_by',pg_temp.fx(12)),'42501','forged submitter denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('receipt_image_url','https://example.test/replaced.jpg'),
 '22023','receipt fields unsupported');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('category_id',pg_temp.fx(43)),'23503','foreign category denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object(
 'project_id',pg_temp.fx(33),'percentage',100,'amount',null))),'23503','foreign allocation denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('amount',105.001),'22023','money precision denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('tax_amount',99),'22023','invalid tax denied');
-- Use the expense company's business day; session tomorrow can be today in UTC.
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('expense_date',
 ((clock_timestamp() at time zone (select coalesce(timezone,'UTC') from companies where id=pg_temp.fx(1)))::date+1)::text),
 '22023','future date denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('correction_note',repeat('a',2001)),'22023','oversized explanation denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object(
 'project_id',pg_temp.fx(32),'percentage',99,'amount',null))),'22023','allocation total denied');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('amount',100,'category_id',pg_temp.fx(41),'allocations',
 jsonb_build_array(jsonb_build_object('project_id',pg_temp.fx(31),'percentage',100,'amount',null))),
 '22023','note-only correction uses existing flag path');
-- Revocation applies to fresh requests and completed receipt retries.
select set_config('request.jwt.claims','',false);
update user_permission_overrides set granted=false where user_id=pg_temp.fx(10) and permission='expenses.approve';
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
select pg_temp.fail((select command from command_hold),'42501','revoked approver cannot replay');
select pg_temp.fail(pg_temp.cmd(201,501),'42501','revoked approver cannot correct');
select set_config('request.jwt.claims','',false);
update user_permission_overrides set granted=true where user_id=pg_temp.fx(10) and permission='expenses.approve';
select set_config('request.jwt.claims','{"sub":"p7-crew","role":"authenticated"}',false);
select pg_temp.ok(jsonb_array_length(public.list_expense_corrections(pg_temp.fx(200),pg_temp.fx(1)))=1,'submitter reads own change history');
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('actor_id',pg_temp.fx(11)),'42501','self correction denied; ordinary save remains lane');
update expenses set description='Crew reviewed the correction' where id=pg_temp.fx(200);
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
select pg_temp.ok((public.correct_expense_for_review((select command from command_hold))->'correction')=
 (select receipt->'correction' from receipt_hold),'receipt immutable after crew changes');
select pg_temp.ok((select description='Crew reviewed the correction' from expenses where id=pg_temp.fx(200)),
 'replay never overwrites later crew work');
do $$ begin
 begin update expenses set amount=106 where id=pg_temp.fx(200); raise exception 'expected direct deny';
 exception when insufficient_privilege then perform pg_temp.ok(true,'ordinary admin content edit still denied'); end;
 begin update expenses set receipt_image_url='https://example.test/new' where id=pg_temp.fx(200); raise exception 'expected receipt deny';
 exception when insufficient_privilege then perform pg_temp.ok(true,'ordinary admin receipt edit still denied'); end;
 begin update private.expense_correction_requests set correction='{}'; raise exception 'expected history deny';
 exception when insufficient_privilege then perform pg_temp.ok(true,'history cannot be rewritten'); end;
end; $$;
select set_config('request.jwt.claims','{"sub":"p7-peer","role":"authenticated"}',false);
do $$ begin
 begin perform public.list_expense_corrections(pg_temp.fx(200),pg_temp.fx(1)); raise exception 'expected peer deny';
 exception when insufficient_privilege then perform pg_temp.ok(true,'peer cannot read another crew history'); end;
end; $$;
select set_config('request.jwt.claims','{"sub":"p7-foreign","role":"authenticated"}',false);
select pg_temp.fail(pg_temp.cmd(201,501)||jsonb_build_object('actor_id',pg_temp.fx(20)),'42501','foreign admin denied');
do $$ begin
 begin perform public.list_expense_corrections(pg_temp.fx(200),pg_temp.fx(1)); raise exception 'expected foreign deny';
 exception when insufficient_privilege then perform pg_temp.ok(true,'foreign history denied'); end;
end; $$;
-- Financial locks are populated under trusted fixture context, then attempted
-- through real authenticated actor context. Existing P5 triggers run throughout.
select set_config('request.jwt.claims','',false);
update expenses set approved_by=pg_temp.fx(13) where id=pg_temp.fx(202);
update expenses set approved_at=now() where id=pg_temp.fx(203);
update expenses set accounting_sync_id='historical-export' where id=pg_temp.fx(204);
update expenses set accounting_synced_at=now() where id=pg_temp.fx(205);
update expenses set accounting_sync_status='synced' where id=pg_temp.fx(206);
update expenses set batch_id=pg_temp.fx(101) where id=pg_temp.fx(207);
update expense_batches set paid_by=pg_temp.fx(13),paid_at=now() where id=pg_temp.fx(102);
update expenses set batch_id=pg_temp.fx(102) where id=pg_temp.fx(208);
update expenses set status='approved' where id=pg_temp.fx(209);
update expenses set status='submitted' where id=pg_temp.fx(209);
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
select pg_temp.fail(pg_temp.cmd(202,502),'55000','approval actor evidence blocks correction');
select pg_temp.fail(pg_temp.cmd(203,503),'55000','approval timestamp evidence blocks correction');
select pg_temp.fail(pg_temp.cmd(204,504),'55000','external accounting identity blocks correction');
select pg_temp.fail(pg_temp.cmd(205,505),'55000','external accounting timestamp blocks correction');
select pg_temp.fail(pg_temp.cmd(206,506),'55000','synced state blocks correction');
select pg_temp.fail(pg_temp.cmd(207,507),'55000','approved envelope blocks correction');
select pg_temp.fail(pg_temp.cmd(208,508),'55000','paid envelope blocks correction');
select pg_temp.fail(pg_temp.cmd(209,509),'55000','prior financial history blocks even after resubmission');
select pg_temp.ok((select count(*)=1 from private.expense_correction_requests),'denials write no audit receipt');
select pg_temp.ok((select count(*)=1 from notifications where type='expense_rejected'),'denials send no correction notification');
-- Actual role ACL, not only simulated JWT claims.
set role authenticated;
do $$ begin
 begin insert into private.expense_correction_scope values(pg_current_xact_id(),pg_temp.fx(201),pg_temp.fx(1),pg_temp.fx(10),'{}','{}');
 raise exception 'expected scope denial'; exception when insufficient_privilege then null; end;
 begin update expenses set amount=999 where id=pg_temp.fx(201); raise exception 'expected direct denial';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select pg_temp.ok(not has_table_privilege('authenticated','private.expense_correction_requests','SELECT'),
 'private receipts readable only through guarded history RPC');
select pg_temp.ok(not has_function_privilege('anon','public.correct_expense_for_review(jsonb)','EXECUTE'),
 'anonymous correction RPC denied');
select pg_temp.ok(not has_function_privilege('service_role','public.correct_expense_for_review(jsonb)','EXECUTE'),
 'generic service role cannot call human correction RPC');
select pg_temp.ok(has_function_privilege('authenticated','public.correct_expense_for_review(jsonb)','EXECUTE'),
 'authenticated correction RPC available');

-- Optional explanation still produces structured feedback. Real authenticated
-- execution proves the public invoker wrapper can reach its guarded helper.
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
select set_config('test.p7.command',(pg_temp.cmd(210,510)||jsonb_build_object('correction_note','  '))::text,false);
set role authenticated;
select public.correct_expense_for_review(current_setting('test.p7.command')::jsonb)->>'replayed' as authenticated_result;
select jsonb_array_length(public.list_expense_corrections('77000000-0000-4000-8000-000000000210',
 '77000000-0000-4000-8000-000000000001')) as authenticated_history_count;
reset role;
select pg_temp.ok((select correction->>'correction_note'='' from private.expense_correction_requests where request_id=pg_temp.fx(510)),
 'optional note normalizes to empty string');
select pg_temp.ok((select flag_comment='Review corrected expense details.' from expenses where id=pg_temp.fx(210)),
 'legacy crew return retains helpful default feedback');
-- Construct the released uploader-owned command from the corrected snapshot.
create function pg_temp.submit_cmd(i integer,req integer) returns jsonb language sql as $$
 select private.expense_correction_content(e)||jsonb_build_object('request_id',pg_temp.fx(req),'expense_id',e.id,
 'company_id',e.company_id,'submitted_by',e.submitted_by,'expected_status',e.status,'expected_updated_at',e.updated_at,
 'receipt_image_url',e.receipt_image_url,'receipt_thumbnail_url',e.receipt_thumbnail_url,
 'receipt_missing_reason',e.receipt_missing_reason,'receipt_missing_note',e.receipt_missing_note,
 'ocr_raw_data',e.ocr_raw_data,'ocr_confidence',e.ocr_confidence,'submit',true,
 'allocations',coalesce((select jsonb_agg(jsonb_build_object('project_id',project_id,'percentage',percentage,'amount',amount))
 from expense_project_allocations where expense_id=e.id),'[]'::jsonb)) from expenses e where id=pg_temp.fx(i);
$$;
select set_config('request.jwt.claims','{"sub":"p7-crew","role":"authenticated"}',false);
select save_expense_atomic(pg_temp.submit_cmd(210,610))->>'status' as resubmitted_status;
select pg_temp.ok((select status='submitted' and batch_id is not null and flagged_by is null and flagged_at is null
 and flag_comment is null and rejected_by is null and rejected_at is null and rejection_reason is null
 from expenses where id=pg_temp.fx(210)),'crew resubmission clears exact correction markers and refiles');
select pg_temp.ok((select count(*)=0 from private.expense_correction_pending where expense_id=pg_temp.fx(210)),
 'crew resubmission consumes pending correction custody');
select pg_temp.ok(jsonb_array_length(list_expense_corrections(pg_temp.fx(210),pg_temp.fx(1)))=1,
 'resubmission retains immutable teaching history');
select pg_temp.ok((select count(*)=0 from expense_accounting_events where expense_id=pg_temp.fx(210)),
 'ordinary resubmission is still not approval');
-- A newer unrelated flag is not cleared by acknowledging an older correction.
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
select correct_expense_for_review(pg_temp.cmd(211,511))->>'replayed';
update expenses set flag_comment='A newer receipt concern',flagged_at=clock_timestamp() where id=pg_temp.fx(211);
select set_config('request.jwt.claims','{"sub":"p7-crew","role":"authenticated"}',false);
select save_expense_atomic(pg_temp.submit_cmd(211,611))->>'status';
select pg_temp.ok((select flag_comment='A newer receipt concern' and flagged_by=pg_temp.fx(10) from expenses where id=pg_temp.fx(211)),
 'resubmission never clears a newer independent flag');
-- An actual orphan is captured before raising the automatic approval threshold.
select set_config('request.jwt.claims','',false);
alter table expenses disable trigger trg_place_expense;
update expenses set batch_id=null where id=pg_temp.fx(212);
alter table expenses enable trigger trg_place_expense;
update expense_settings set auto_approve_threshold=1000 where company_id=pg_temp.fx(1);
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
select correct_expense_for_review(pg_temp.cmd(212,512))->>'replayed';
select pg_temp.ok((select status='rejected' and batch_id is null from expenses where id=pg_temp.fx(212)),
 'unbatched correction does not autoapprove');
select set_config('request.jwt.claims','',false);
select place_expense(pg_temp.fx(212));
select pg_temp.ok((select status='rejected' and batch_id is null from expenses where id=pg_temp.fx(212)),
 'later sweep placement leaves pending crew correction unchanged');
select pg_temp.ok((select count(*)=0 from expense_accounting_events where expense_id=pg_temp.fx(212)),
 'waiting correction never creates premature accounting');
select set_config('request.jwt.claims','{"sub":"p7-crew","role":"authenticated"}',false);
select save_expense_atomic(pg_temp.submit_cmd(212,612))->>'status';
select pg_temp.ok((select status='approved' and batch_id is not null and flagged_by is null from expenses where id=pg_temp.fx(212)),
 'explicit crew resubmit resumes normal under-threshold policy');
select pg_temp.ok((select count(*)=1 from expense_accounting_events where expense_id=pg_temp.fx(212) and kind='accrual'),
 'resubmitted under-threshold crew expense creates one accrual');
select pg_temp.ok((select count(*)=0 from expense_accounting_events where expense_id=pg_temp.fx(212) and kind='settlement'),
 'resubmission does not record a reimbursement payment');
-- History labels remain stable if current category/project labels later change.
select set_config('request.jwt.claims','',false);
update expense_categories set name='Renamed category' where id=pg_temp.fx(42);
update projects set title='Renamed project' where id=pg_temp.fx(32);
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
select pg_temp.ok((list_expense_corrections(pg_temp.fx(210),pg_temp.fx(1))->0->'after'->>'category_name')='Corrected category',
 'history freezes category labels');
select pg_temp.ok((list_expense_corrections(pg_temp.fx(210),pg_temp.fx(1))->0->'after'->'allocations'->0->>'project_title')='Corrected project',
 'history freezes project labels');
-- Any last-stage failure rolls back content, allocations, pending custody and audit.
select set_config('request.jwt.claims','',false);
create function private.test_reject_correction_notification() returns trigger language plpgsql as $$
begin if new.dedupe_key='expense_correction:'||'77000000-0000-4000-8000-000000000513' then
 raise exception 'injected notification failure' using errcode='23514'; end if; return new; end; $$;
create trigger test_reject_correction_notification before insert on notifications for each row
 execute function private.test_reject_correction_notification();
select set_config('request.jwt.claims','{"sub":"p7-reviewer","role":"authenticated"}',false);
select pg_temp.fail(pg_temp.cmd(213,513),'23514','notification failure aborts entire correction');
select pg_temp.ok((select amount=100 and status='submitted' and category_id=pg_temp.fx(41) from expenses where id=pg_temp.fx(213)),
 'failed correction rolls back content');
select pg_temp.ok((select count(*)=1 and bool_and(project_id=pg_temp.fx(31)::text) from expense_project_allocations where expense_id=pg_temp.fx(213)),
 'failed correction rolls back allocations');
select pg_temp.ok((select count(*)=0 from private.expense_correction_requests where request_id=pg_temp.fx(513))
 and (select count(*)=0 from private.expense_correction_pending where expense_id=pg_temp.fx(213))
 and (select count(*)=0 from private.expense_correction_scope),'failed correction leaves no receipt or capability');
select set_config('request.jwt.claims','',false);
drop trigger test_reject_correction_notification on notifications;
drop function private.test_reject_correction_notification();

select count(*)||' expense correction assertions passed' as result from assertions;
