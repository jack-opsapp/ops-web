\set ON_ERROR_STOP on
create function pg_temp.fx(i integer) returns uuid language sql immutable as $$
 select ('71000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
$$;
create function pg_temp.save_expense_settings(actor uuid,connection uuid,configuration jsonb,categories jsonb,payees jsonb,taxes jsonb default null,projects jsonb default null)
returns void language plpgsql as $$ declare c public.accounting_connections; begin
 select * into strict c from public.accounting_connections where id=connection;
 perform public.save_expense_accounting_settings(actor,connection,configuration,categories,payees,taxes,
   c.provider,c.provider_environment,case c.provider when 'quickbooks' then c.realm_id_lookup else c.sage_business_id_lookup end,projects);
end; $$;
create temp table assertions(label text);
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAILED: %',label; end if;
 insert into assertions values(label); end; $$;
insert into companies(id) values(pg_temp.fx(1)),(pg_temp.fx(2));
insert into users(id,company_id,firebase_uid,is_active,is_company_admin)
 values(pg_temp.fx(10),pg_temp.fx(1),'p5-owner',true,true),
 (pg_temp.fx(11),pg_temp.fx(1),'p5-crew',true,false),
 (pg_temp.fx(20),pg_temp.fx(2),'p5-foreign',true,true);
insert into user_permission_overrides(user_id,company_id,permission,scope,granted)
 values(pg_temp.fx(11),pg_temp.fx(1),'expenses.view','own',true),
 (pg_temp.fx(11),pg_temp.fx(1),'expenses.edit','own',true);
insert into accounting_connections(id,company_id,provider,is_connected,sync_enabled,sync_direction,provider_environment,realm_id_lookup)
 values(pg_temp.fx(30),pg_temp.fx(1)::text,'quickbooks',true,true,'push_only','sandbox',repeat('a',64)),
 (pg_temp.fx(31),pg_temp.fx(2)::text,'quickbooks',true,true,'push_only','sandbox',repeat('b',64));
insert into expense_batches(id,company_id,submitted_by,status,batch_number,amendment_number)
 values(pg_temp.fx(100),pg_temp.fx(1),pg_temp.fx(11),'open','TEST-1',0),
 (pg_temp.fx(101),pg_temp.fx(1),pg_temp.fx(11),'open','TEST-2',0);
insert into expenses(id,company_id,submitted_by,batch_id,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(200),pg_temp.fx(1),pg_temp.fx(11),pg_temp.fx(100),'submitted',105,5,'CAD',current_date,'personal_card'),
 (pg_temp.fx(201),pg_temp.fx(1),pg_temp.fx(11),pg_temp.fx(100),'submitted',40,0,'CAD',current_date,'cash'),
 (pg_temp.fx(202),pg_temp.fx(1),pg_temp.fx(11),pg_temp.fx(100),'submitted',60,0,'CAD',current_date,'company_card'),
 (pg_temp.fx(203),pg_temp.fx(1),pg_temp.fx(11),pg_temp.fx(100),'rejected',50,0,'CAD',current_date,'personal_card'),
 (pg_temp.fx(204),pg_temp.fx(1),pg_temp.fx(11),pg_temp.fx(101),'submitted',25,0,'CAD',current_date,'company_card');
select pg_temp.ok((select count(*)=0 from expense_accounting_events),'submission creates no provider financial event');
select set_config('request.jwt.claims','{"sub":"p5-owner","role":"authenticated"}',false);
select approve_expense_batch(pg_temp.fx(100));
select pg_temp.ok((select reimbursement_amount=145 from expense_batches where id=pg_temp.fx(100)),'crew gross only, tax not added twice');
select pg_temp.ok((select count(*)=2 from expense_accounting_events where kind='accrual'),'approval creates two crew obligations');
select pg_temp.ok((select count(*)=1 from expense_accounting_events where kind='purchase'),'company card creates purchase, not debt');
select pg_temp.ok((select count(*)=0 from expense_accounting_events where kind='settlement'),'approval records no crew payment');
select pg_temp.ok((select count(*)=3 from accounting_sync_queue where connection_id=pg_temp.fx(30)),'decision commits durable work');
select pg_temp.ok((select count(*)=0 from accounting_sync_queue where connection_id=pg_temp.fx(31)),'foreign connection never receives work');
select approve_expense_batch(pg_temp.fx(100));
select pg_temp.ok((select count(*)=3 from expense_accounting_events),'replayed approval does not duplicate financial event');
select pg_temp.ok((request_expense_accounting_sync(pg_temp.fx(200))->>'queued')::integer=0,'legacy request replays existing work');
select mark_expense_batch_paid(pg_temp.fx(100));
select pg_temp.ok((select count(*)=2 from expense_accounting_events where kind='settlement'),'Mark paid records two crew payments');
select pg_temp.ok((select bool_and(original_event_id is not null) from expense_accounting_events where kind='settlement'),'payment retains original accrual identity');
select pg_temp.ok((select status='approved' from expenses where id=pg_temp.fx(202)),'company card never becomes reimbursed');
select pg_temp.ok((select reimbursement_amount=145 and paid_at is not null from expense_batches where id=pg_temp.fx(100)),'paid receipt retains crew principal');
select unmark_expense_batch_paid(pg_temp.fx(100));
select pg_temp.ok((select count(*)=2 from expense_accounting_events where kind='reversal'),'undo records two immutable reversals');
select pg_temp.ok((select reimbursement_amount=145 and paid_at is null from expense_batches where id=pg_temp.fx(100)),'undo returns same crew principal to owed');
select approve_expense_batch(pg_temp.fx(101));
select pg_temp.ok((select reimbursement_amount=0 from expense_batches where id=pg_temp.fx(101)),'company-card-only envelope owes zero');
do $$ begin
 begin perform mark_expense_batch_paid(pg_temp.fx(101)); raise exception 'expected payout denial';
 exception when invalid_parameter_value then perform pg_temp.ok(true,'zero crew payout rejected'); end;
 begin perform request_expense_accounting_sync(pg_temp.fx(200),pg_temp.fx(2)); raise exception 'expected company denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'forged legacy company denied'); end;
end; $$;
select set_config('request.jwt.claims','{"sub":"p5-foreign","role":"authenticated"}',false);
do $$ begin
 begin perform request_expense_accounting_sync(pg_temp.fx(200)); raise exception 'expected foreign denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'foreign expense denied'); end;
end; $$;
select set_config('request.jwt.claims','{"sub":"p5-crew","role":"authenticated"}',false);
do $$ begin
 begin update expenses set status='reimbursed' where id=pg_temp.fx(200); raise exception 'expected payment authority denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot forge payment via table write'); end;
 begin update expenses set amount=999 where id=pg_temp.fx(200); raise exception 'expected approved edit denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot silently change approved accounting'); end;
end; $$;
select set_config('request.jwt.claims','',false);
insert into expense_settings(company_id,auto_approve_threshold,review_frequency) values(pg_temp.fx(1),100,'monthly');
select set_config('request.jwt.claims','{"sub":"p5-crew","role":"authenticated"}',false);
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(205),pg_temp.fx(1),pg_temp.fx(11),'submitted',10,0,'CAD',current_date,'personal_card');
select pg_temp.ok((select status='approved' from expenses where id=pg_temp.fx(205)),'threshold autoapproval retained');
select pg_temp.ok((select count(*)=1 from expense_accounting_events where expense_id=pg_temp.fx(205) and kind='accrual'),'nested placement captures final approved row exactly once');
select pg_temp.ok((select count(*)=0 from expense_accounting_events where expense_id=pg_temp.fx(205) and kind in ('reversal','review')),'nested insertion does not reverse a stale NEW row');
select set_config('request.jwt.claims','',false);
do $$ declare q accounting_sync_queue; v jsonb; begin
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(200) order by created_at,id limit 1;
 update accounting_sync_queue set status='claimed',locked_by='worker-one',locked_at=now() where id=q.id;
 v:=prepare_expense_accounting_write(q.id,'worker-one','{"document":"original"}','{"debits":[],"credits":[]}');
 perform pg_temp.ok(v->'payload'->>'document'='original','worker freezes original provider payload');
 v:=prepare_expense_accounting_write(q.id,'worker-one','{"document":"changed"}','{"changed":true}');
 perform pg_temp.ok(v->'payload'->>'document'='original','retry cannot replace frozen provider payload');
 begin perform prepare_expense_accounting_write(q.id,'other-worker','{}','{}'); raise exception 'expected owner failure';
 exception when serialization_failure then perform pg_temp.ok(true,'wrong worker cannot prepare'); end;
 perform pg_temp.ok(finalize_expense_accounting_sync(q.id,'worker-one','provider-123','0',now()),'claimed owner finalizes prepared posting');
 perform pg_temp.ok(not finalize_expense_accounting_sync(q.id,'worker-one','provider-123','0',now()),'finalize cannot run twice after claim released');
 perform pg_temp.ok((select status='succeeded' and external_id='provider-123' from accounting_sync_queue where id=q.id),'finalization commits source link and queue receipt');
end; $$;
select pg_temp.ok(not has_function_privilege('authenticated','public.prepare_expense_accounting_write(uuid,text,jsonb,jsonb)','execute'),'clients cannot prepare provider writes');
select pg_temp.ok(not has_table_privilege('authenticated','public.expense_accounting_events','insert'),'clients cannot fabricate financial history');
select pg_temp.ok(not has_table_privilege('service_role','public.expense_accounting_events','update'),'ordinary service cannot rewrite financial history');
-- Settings writes independently enforce company custody and roll back as a unit.
insert into expense_categories(id,company_id) values(pg_temp.fx(400),pg_temp.fx(1)),(pg_temp.fx(401),pg_temp.fx(2));
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"CAD"}',
 jsonb_build_array(jsonb_build_object('categoryId',pg_temp.fx(400),'externalAccountId','expense-original')),
 jsonb_build_array(jsonb_build_object('userId',pg_temp.fx(11),'externalEmployeeId','employee-original')),'[]');
select pg_temp.ok((select configuration->>'currency'='CAD' from expense_accounting_settings where connection_id=pg_temp.fx(30)),'authorized settings persist');
do $$ begin
 begin perform pg_temp.save_expense_settings(pg_temp.fx(20),pg_temp.fx(30),'{}','[]','[]'); raise exception 'expected foreign settings denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'foreign actor cannot change settings'); end;
 begin perform pg_temp.save_expense_settings(pg_temp.fx(11),pg_temp.fx(30),'{}','[]','[]'); raise exception 'expected crew settings denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot change provider accounts'); end;
 begin perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"USD"}',
 jsonb_build_array(jsonb_build_object('categoryId',pg_temp.fx(401),'externalAccountId','foreign')),'[]'); raise exception 'expected foreign category denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'foreign category mapping denied'); end;
 begin perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"USD"}','[]','[]','[{"taxRate":"bad","externalTaxCodeId":"x"}]'); raise exception 'expected invalid tax denial';
 exception when invalid_text_representation then perform pg_temp.ok(true,'late invalid tax mapping rolls back entire save'); end;
end; $$;
select pg_temp.ok((select configuration->>'currency'='CAD' from expense_accounting_settings where connection_id=pg_temp.fx(30)),'failed settings save preserves configuration');
select pg_temp.ok((select external_account_id='expense-original' from expense_accounting_category_mappings where connection_id=pg_temp.fx(30) and category_id=pg_temp.fx(400)),'failed settings save preserves category mappings');
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method,category_id)
 values(pg_temp.fx(210),pg_temp.fx(1),pg_temp.fx(11),'approved',125,0,'CAD',current_date,'personal_card',pg_temp.fx(400));
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"USD"}','[]','[]','[]');
select pg_temp.ok((select connection_bindings->pg_temp.fx(30)::text->'configuration'->>'currency'='CAD' from expense_accounting_events where expense_id=pg_temp.fx(210) and kind='accrual'),'decision retains original settings after later setup changes');
select pg_temp.ok((select connection_bindings->pg_temp.fx(30)::text->>'categoryAccountId'='expense-original' from expense_accounting_events where expense_id=pg_temp.fx(210) and kind='accrual'),'decision retains original account mapping');
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method,accounting_sync_id)
 values(pg_temp.fx(211),pg_temp.fx(1),pg_temp.fx(11),'submitted',125,0,'CAD',current_date,'personal_card','legacy-provider-id');
update expenses set status='approved' where id=pg_temp.fx(211);
select pg_temp.ok((select count(*)=1 from expense_accounting_events where expense_id=pg_temp.fx(211) and kind='review'),'legacy external ID requires reconciliation even when previously unapproved');
select pg_temp.ok((select count(*)=0 from expense_accounting_events where expense_id=pg_temp.fx(211) and kind in ('accrual','purchase','settlement')),'legacy external ID never silently duplicates financial history');
do $$ declare q accounting_sync_queue; v_original jsonb; begin
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(210) limit 1;
 v_original:=q.payload_snapshot;
 update accounting_sync_queue set status='needs_review' where id=q.id;
 begin perform retry_expense_accounting_before_write(pg_temp.fx(11),q.id); raise exception 'expected crew retry denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot authorize accounting retry'); end;
 begin perform retry_expense_accounting_before_write(pg_temp.fx(20),q.id); raise exception 'expected foreign retry denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'foreign actor cannot retry accounting'); end;
 perform retry_expense_accounting_before_write(pg_temp.fx(10),q.id);
 perform pg_temp.ok((select status='pending' and attempts=0 and payload_snapshot->'configurationSnapshot'->>'currency'='USD'
   and payload_snapshot->>'eventId'=v_original->>'eventId' from accounting_sync_queue where id=q.id),'explicit prewrite retry adopts corrected settings without changing event');
 update accounting_sync_queue set status='needs_review',provider_accepted_at=now(),idempotency_expires_at=now()+interval '7 days' where id=q.id;
 begin perform retry_expense_accounting_before_write(pg_temp.fx(10),q.id); raise exception 'expected accepted retry denial';
 exception when check_violation then perform pg_temp.ok(true,'accepted provider write never resets'); end;
 update accounting_sync_queue set provider_accepted_at=null,idempotency_expires_at=null,provider_request_id='uncertain' where id=q.id;
 begin perform retry_expense_accounting_before_write(pg_temp.fx(10),q.id); raise exception 'expected request retry denial';
 exception when check_violation then perform pg_temp.ok(true,'provider request evidence blocks retry'); end;
 update accounting_sync_queue set provider_request_id=null where id=q.id;
 update accounting_connections set realm_id_lookup=repeat('c',64) where id=pg_temp.fx(30);
 begin perform retry_expense_accounting_before_write(pg_temp.fx(10),q.id); raise exception 'expected relink denial';
 exception when check_violation then perform pg_temp.ok(true,'relinked provider company cannot receive old expenses'); end;
 update accounting_connections set realm_id_lookup=repeat('a',64) where id=pg_temp.fx(30);
 perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"CAD"}','[]','[]','[]');
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(200) and external_id='provider-123';
 update accounting_sync_queue set status='needs_review',external_id=null where id=q.id;
 begin perform retry_expense_accounting_before_write(pg_temp.fx(10),q.id); raise exception 'expected frozen retry denial';
 exception when check_violation then perform pg_temp.ok(true,'frozen posting blocks retry even with missing acceptance receipt'); end;
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(211) limit 1;
 update accounting_sync_queue set status='needs_review' where id=q.id;
 begin perform retry_expense_accounting_before_write(pg_temp.fx(10),q.id); raise exception 'expected legacy retry denial';
 exception when check_violation then perform pg_temp.ok(true,'legacy review cannot become a new posting through retry'); end;
end; $$;
select pg_temp.ok(not has_function_privilege('authenticated','public.retry_expense_accounting_before_write(uuid,uuid)','execute'),'retry service RPC is unavailable to direct clients');
select pg_temp.ok((select count(*)>0 from notifications where dedupe_key like 'expense-accounting:%' and persistent),'accounting review is durably visible');
select pg_temp.ok((select count(*)=0 from notifications where dedupe_key like 'expense-accounting:%' and user_id<>pg_temp.fx(10)::text),'only authorized active accounting approver receives review');
do $$ declare v_queue uuid; v_key text; begin
 select id into v_queue from accounting_sync_queue where entity_id=pg_temp.fx(210) limit 1;
 v_key:='expense-accounting:'||v_queue::text;
 update accounting_sync_queue set status='pending' where id=v_queue;
 perform pg_temp.ok((select persistent and resolved_at is null from notifications where dedupe_key=v_key),'retry initiation does not falsely resolve review');
 update accounting_sync_queue set status='needs_review' where id=v_queue;
 perform pg_temp.ok((select count(*)=1 from notifications where dedupe_key=v_key),'repeated review reuses same notification');
 update accounting_sync_queue set status='cancelled' where id=v_queue;
 perform pg_temp.ok((select not persistent and is_read and resolved_at is not null from notifications where dedupe_key=v_key),'terminal completion resolves exact notification');
end; $$;
select set_config('request.jwt.claims','{"sub":"p5-crew","role":"authenticated"}',false);
do $$ begin
 begin update expense_batches set paid_at=now(),paid_by=pg_temp.fx(11) where id=pg_temp.fx(100); raise exception 'expected direct batch payment denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot bypass Mark paid through batch table'); end;
 begin delete from expenses where id=pg_temp.fx(210); raise exception 'expected approved delete denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot delete approved accounting history'); end;
 begin insert into expense_project_allocations(id,expense_id,project_id,amount,percentage)
   values(pg_temp.fx(501),pg_temp.fx(210),pg_temp.fx(500),125,100); raise exception 'expected allocation denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot redirect an approved receipt allocation'); end;
end; $$;
insert into expense_project_allocations(id,expense_id,project_id,amount,percentage)
 values(pg_temp.fx(502),pg_temp.fx(205),pg_temp.fx(500),10,100);
select pg_temp.ok((select count(*)=1 from expense_project_allocations where id=pg_temp.fx(502)),'automatic under-threshold approval retains own allocation editing');
select set_config('request.jwt.claims','',false);
update expenses set amount=70 where id=pg_temp.fx(202);
select pg_temp.ok((select count(*)=1 from expense_accounting_events where expense_id=pg_temp.fx(202) and kind='reversal'),'company card amount correction reverses original purchase');
select pg_temp.ok((select count(*)=2 from expense_accounting_events where expense_id=pg_temp.fx(202) and kind='purchase'),'company card amount correction creates replacement purchase');
select pg_temp.ok((select reimbursement_amount=145 from expense_batches where id=pg_temp.fx(100)),'company card correction never changes crew owed');
update expenses set status='rejected' where id=pg_temp.fx(201);
select pg_temp.ok((select reimbursement_amount=105 from expense_batches where id=pg_temp.fx(100)),'rejection removes only its crew obligation');
select pg_temp.ok((select count(*)=2 from expense_accounting_events where expense_id=pg_temp.fx(201) and kind='reversal'),'rejection reverses accrued debt after prior payment undo');
update expenses set deleted_at=now() where id=pg_temp.fx(202);
select pg_temp.ok((select count(*)=2 from expense_accounting_events where expense_id=pg_temp.fx(202) and kind='reversal'),'soft deletion reverses current company card purchase');
update expenses set updated_at=now(),accounting_sync_status='error' where id=pg_temp.fx(202);
select pg_temp.ok((select count(*)=2 from expense_accounting_events where expense_id=pg_temp.fx(202) and kind='reversal'),'sync metadata never fabricates another reversal');
-- Superseded work can disappear from the send queue only with complete
-- pre-write custody; the immutable original and reversal remain for audit.
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(800),pg_temp.fx(1),pg_temp.fx(11),'approved',125,null,'CAD',current_date,'personal_card');
do $$ declare original accounting_sync_queue; replacement accounting_sync_queue; begin
 select * into original from accounting_sync_queue where entity_id=pg_temp.fx(800);
 update accounting_sync_queue set status='needs_review' where id=original.id;
 update accounting_sync_queue set status='claimed',locked_by='stale-worker',locked_at=now() where id=original.id;
 update expenses set tax_amount=0 where id=pg_temp.fx(800);
 perform pg_temp.ok((select count(*)=2 from accounting_sync_queue where entity_id=pg_temp.fx(800)
   and status='cancelled' and private.expense_queue_cancelled_before_write(id)),'invalid original and exact reversal cancel together before preparation');
 perform pg_temp.ok((select source_snapshot->'tax_amount'='null'::jsonb from expense_accounting_events
   where id::text=original.payload_snapshot->>'eventId'),'cancellation preserves immutable unknown-tax source');
 perform pg_temp.ok((select not persistent and resolved_at is not null from notifications
   where dedupe_key='expense-accounting:'||original.id::text),'safe supersession resolves the exact review notification');
 begin perform prepare_expense_accounting_write(original.id,'stale-worker','{}','{}'); raise exception 'expected stale claim denial';
 exception when serialization_failure then perform pg_temp.ok(true,'cancelled claim cannot prepare a provider write'); end;
 perform pg_temp.ok(retry_expense_accounting_before_write(pg_temp.fx(10),original.id)->>'status'='cancelled','retry recognizes a proven pre-write cancellation');
 select * into replacement from accounting_sync_queue where entity_id=pg_temp.fx(800) and status='pending';
 update accounting_sync_queue set status='claimed',locked_by='replacement-worker',locked_at=now() where id=replacement.id;
 perform prepare_expense_accounting_write(replacement.id,'replacement-worker','{"corrected":true}','{}');
 perform pg_temp.ok(exists(select 1 from expense_accounting_postings where queue_id=replacement.id),'corrected replacement proceeds past proven cancelled predecessors');
 update accounting_sync_queue set payload_snapshot=payload_snapshot-'cancelledBeforeWrite' where id=original.id;
 begin perform prepare_expense_accounting_write(replacement.id,'replacement-worker','{}','{}'); raise exception 'expected unproven cancellation denial';
 exception when serialization_failure then perform pg_temp.ok(true,'generic cancelled status cannot bypass predecessor custody'); end;
end; $$;
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(801),pg_temp.fx(1),pg_temp.fx(11),'approved',125,0,'CAD',current_date,'personal_card');
do $$ declare original accounting_sync_queue; begin
 select * into original from accounting_sync_queue where entity_id=pg_temp.fx(801);
 update accounting_sync_queue set status='claimed',locked_by='frozen-worker',locked_at=now() where id=original.id;
 perform prepare_expense_accounting_write(original.id,'frozen-worker','{"frozen":true}','{}');
 update expenses set amount=130 where id=pg_temp.fx(801);
 perform pg_temp.ok((select count(*)=0 from accounting_sync_queue where entity_id=pg_temp.fx(801) and status='cancelled'),'a frozen request without acceptance still prevents cancellation');
end; $$;
do $$ declare i integer; q accounting_sync_queue; begin
 for i in 1..3 loop
  insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
   values(pg_temp.fx(810+i),pg_temp.fx(1),pg_temp.fx(11),'approved',125,0,'CAD',current_date,'personal_card');
  select * into q from accounting_sync_queue where entity_id=pg_temp.fx(810+i);
  update accounting_sync_queue set status='needs_review',
    external_id=case when i=1 then 'external-evidence' end,
    provider_request_id=case when i=2 then 'request-evidence' end,
    provider_accepted_at=case when i=3 then now() end,
    idempotency_expires_at=case when i=3 then now()+interval '7 days' end where id=q.id;
  update expenses set amount=130 where id=pg_temp.fx(810+i);
  perform pg_temp.ok((select count(*)=0 from accounting_sync_queue where entity_id=pg_temp.fx(810+i) and status='cancelled'),
    'provider custody evidence prevents cancellation case '||i);
 end loop;
end; $$;
-- A real posted reimbursement still requires a provider reversal on undo.
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(900),pg_temp.fx(1),pg_temp.fx(11),'approved',125,0,'CAD',current_date,'personal_card');
do $$ declare q accounting_sync_queue; begin
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(900);
 update accounting_sync_queue set status='claimed',locked_by='posted-worker',locked_at=now() where id=q.id;
 perform prepare_expense_accounting_write(q.id,'posted-worker','{"kind":"accrual"}','{}');
 perform finalize_expense_accounting_sync(q.id,'posted-worker','posted-accrual');
 update expenses set status='reimbursed' where id=pg_temp.fx(900);
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(900) and status='pending';
 update accounting_sync_queue set status='claimed',locked_by='posted-worker',locked_at=now() where id=q.id;
 perform prepare_expense_accounting_write(q.id,'posted-worker','{"kind":"settlement"}','{}');
 perform finalize_expense_accounting_sync(q.id,'posted-worker','posted-settlement');
end; $$;
select set_config('request.jwt.claims','{"sub":"p5-crew","role":"authenticated"}',false);
do $$ begin
 begin update expenses set expense_date=current_date-1 where id=pg_temp.fx(900); raise exception 'expected paid date denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot replace paid accounting by changing receipt date'); end;
 begin update expenses set merchant_name='Changed merchant' where id=pg_temp.fx(900); raise exception 'expected paid merchant denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot replace paid accounting by changing merchant'); end;
 begin update expenses set description='Changed description' where id=pg_temp.fx(900); raise exception 'expected paid description denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot replace paid accounting by changing description'); end;
end; $$;
select set_config('request.jwt.claims','',false);
update expenses set status='approved' where id=pg_temp.fx(900);
select pg_temp.ok((select count(*)=0 from accounting_sync_queue where entity_id=pg_temp.fx(900) and status='cancelled'),'posted reimbursement undo is never compacted away');
do $$ declare q accounting_sync_queue; begin
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(900) and status='pending';
 update accounting_sync_queue set status='claimed',locked_by='undo-worker',locked_at=now() where id=q.id;
 perform prepare_expense_accounting_write(q.id,'undo-worker','{"kind":"reversal"}','{}');
 perform pg_temp.ok((select kind='reversal' from expense_accounting_events where id::text=q.payload_snapshot->>'eventId'),'posted payment undo prepares its original reversal');
end; $$;
-- A delayed enqueue keeps the decision environment even if the connection changed.
update accounting_connections set sync_enabled=false where id=pg_temp.fx(30);
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(950),pg_temp.fx(1),pg_temp.fx(11),'approved',125,0,'CAD',current_date,'personal_card'),
       (pg_temp.fx(951),pg_temp.fx(1),pg_temp.fx(11),'approved',125,null,'CAD',current_date,'personal_card');
update expenses set tax_amount=0 where id=pg_temp.fx(951);
update accounting_connections set sync_enabled=true,provider_environment='production' where id=pg_temp.fx(30);
select set_config('request.jwt.claims','{"sub":"p5-owner","role":"authenticated"}',false);
select request_expense_accounting_sync(pg_temp.fx(950));
select pg_temp.ok((select payload_snapshot->>'providerEnvironment'='sandbox' from accounting_sync_queue where entity_id=pg_temp.fx(950)),'delayed enqueue retains original provider environment');
select set_config('request.jwt.claims','',false);
do $$ declare q accounting_sync_queue; begin
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(950);
 update accounting_sync_queue set status='claimed',locked_by='wrong-environment',locked_at=now() where id=q.id;
 begin perform prepare_expense_accounting_write(q.id,'wrong-environment','{}','{}'); raise exception 'expected environment denial';
 exception when check_violation then perform pg_temp.ok(true,'changed provider environment cannot receive delayed work'); end;
end; $$;
update accounting_connections set provider_environment='sandbox' where id=pg_temp.fx(30);
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"CAD"}','[]','[]','[]');
select set_config('request.jwt.claims','{"sub":"p5-owner","role":"authenticated"}',false);
select request_expense_accounting_sync(pg_temp.fx(951));
select pg_temp.ok((select count(*)=2 from accounting_sync_queue where entity_id=pg_temp.fx(951)
  and private.expense_queue_cancelled_before_write(id)),'delayed enqueue cancels the exact invalid original and reversal');
select request_expense_accounting_sync(pg_temp.fx(951));
select pg_temp.ok((select count(*)=3 from accounting_sync_queue where entity_id=pg_temp.fx(951)),'repeated delayed enqueue preserves cancellation tombstones without duplicates');
select set_config('request.jwt.claims','',false);
do $$ declare q accounting_sync_queue; begin
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(951) and status='pending';
 update accounting_sync_queue set status='failed',attempts=max_attempts where id=q.id;
 perform pg_temp.ok(retry_expense_accounting_before_write(pg_temp.fx(10),q.id)->>'status'='pending','exhausted pre-write read failure can be explicitly retried');
end; $$;
select pg_temp.ok(not has_function_privilege('authenticated','private.cancel_unwritten_expense_reversals(uuid)','execute'),'clients cannot invoke financial pair cancellation');
select pg_temp.ok(not has_function_privilege('service_role','private.cancel_unwritten_expense_reversals(uuid)','execute'),'ordinary service cannot invoke private pair cancellation');
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(960),pg_temp.fx(1),pg_temp.fx(11),'approved',125,0,'CAD',current_date,'personal_card'),
       (pg_temp.fx(961),pg_temp.fx(1),pg_temp.fx(11),'submitted',125,0,'CAD',current_date,'personal_card');
select set_config('request.jwt.claims','{"sub":"p5-crew","role":"authenticated"}',false);
do $$ begin
 begin update expenses set deleted_at=now() where id=pg_temp.fx(960); raise exception 'expected approved soft delete denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot soft-delete approved provider accounting'); end;
 begin update expenses set status='rejected' where id=pg_temp.fx(960); raise exception 'expected approved rejection denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'crew cannot reject approved provider accounting'); end;
 begin update expenses set status='submitted',deleted_at=now() where id=pg_temp.fx(960); raise exception 'expected combined delete denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'resubmission cannot hide a simultaneous approved deletion'); end;
 update expenses set status='submitted' where id=pg_temp.fx(960);
 perform pg_temp.ok((select status='submitted' from expenses where id=pg_temp.fx(960)),'crew can explicitly resubmit their approved receipt');
 delete from expenses where id=pg_temp.fx(961);
 perform pg_temp.ok(not exists(select 1 from expenses where id=pg_temp.fx(961)),'crew retains deletion of their unapproved receipt');
end; $$;
select set_config('request.jwt.claims','',false);
-- Queued work cannot outlive the OPS company's active state.
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(970),pg_temp.fx(1),pg_temp.fx(11),'approved',125,0,'CAD',current_date,'personal_card');
do $$ declare q accounting_sync_queue; v_count integer; begin
 select * into q from accounting_sync_queue where entity_id=pg_temp.fx(970);
 update accounting_sync_queue set status='claimed',locked_by='deleted-company-worker',locked_at=now() where id=q.id;
 update companies set deleted_at=now() where id=pg_temp.fx(1);
 begin perform prepare_expense_accounting_write(q.id,'deleted-company-worker','{}','{}'); raise exception 'expected deleted company denial';
 exception when check_violation then perform pg_temp.ok(true,'deleted company cannot prepare existing provider work'); end;
 select count(*) into v_count from accounting_sync_queue where company_id=pg_temp.fx(1);
 update expenses set amount=130 where id=pg_temp.fx(970);
 perform pg_temp.ok((select count(*)=v_count from accounting_sync_queue where company_id=pg_temp.fx(1)),'deleted company does not enqueue newly captured financial events');
 update companies set deleted_at=null where id=pg_temp.fx(1);
end; $$;
-- Settings must remain bound to the provider company validated by the API.
insert into users(id,company_id,firebase_uid,is_active,is_company_admin)
 values(pg_temp.fx(980),pg_temp.fx(1),'p5-archived',true,false),
       (pg_temp.fx(981),pg_temp.fx(1),'p5-inactive-unmapped',false,false);
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"CAD"}',
 jsonb_build_array(jsonb_build_object('categoryId',pg_temp.fx(400),'externalAccountId','old-account')),
 jsonb_build_array(jsonb_build_object('userId',pg_temp.fx(980),'externalEmployeeId','old-employee')),
 '[{"taxRate":5,"externalTaxCodeId":"old-tax"}]');
update users set is_active=false where id=pg_temp.fx(980);
do $$ begin
 perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"CAD"}','[]',
   jsonb_build_array(jsonb_build_object('userId',pg_temp.fx(980),'externalEmployeeId','old-employee')));
 perform pg_temp.ok((select count(*)=1 from expense_accounting_payee_mappings where connection_id=pg_temp.fx(30)),'unchanged inactive OPS crew mapping can be preserved');
 begin perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]',
   jsonb_build_array(jsonb_build_object('userId',pg_temp.fx(980),'externalEmployeeId','changed-employee'))); raise exception 'expected archived reassignment denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'inactive OPS crew cannot receive a changed employee mapping'); end;
 begin perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]',
   jsonb_build_array(jsonb_build_object('userId',pg_temp.fx(981),'externalEmployeeId','new-employee'))); raise exception 'expected inactive assignment denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'unmapped inactive OPS crew cannot receive a new mapping'); end;
end; $$;
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"CAD"}',
 jsonb_build_array(jsonb_build_object('categoryId',pg_temp.fx(400),'externalAccountId','old-account')),
 jsonb_build_array(jsonb_build_object('userId',pg_temp.fx(980),'externalEmployeeId','old-employee')),
 '[{"taxRate":5,"externalTaxCodeId":"old-tax"}]');
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method,category_id)
 values(pg_temp.fx(982),pg_temp.fx(1),pg_temp.fx(11),'approved',125,0,'CAD',current_date,'personal_card',pg_temp.fx(400));
update accounting_connections set realm_id_lookup=repeat('e',64) where id=pg_temp.fx(30);
select pg_temp.ok(not exists(select 1 from expense_accounting_settings where connection_id=pg_temp.fx(30))
  and not exists(select 1 from expense_accounting_category_mappings where connection_id=pg_temp.fx(30))
  and not exists(select 1 from expense_accounting_payee_mappings where connection_id=pg_temp.fx(30))
  and not exists(select 1 from expense_accounting_tax_mappings where connection_id=pg_temp.fx(30)),'relink clears every expense-owned provider mapping atomically');
select pg_temp.ok((select connection_bindings->pg_temp.fx(30)::text->>'categoryAccountId'='old-account'
  and connection_bindings->pg_temp.fx(30)::text->>'providerIdentity'=repeat('a',64)
  from expense_accounting_events where expense_id=pg_temp.fx(982) and kind='accrual'),'relink preserves immutable former-company event bindings');
do $$ begin
 begin perform public.save_expense_accounting_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]','[]','quickbooks','sandbox',repeat('a',64)); raise exception 'expected stale validation denial';
 exception when serialization_failure then perform pg_temp.ok(true,'settings validated against a previous provider company cannot save'); end;
 begin perform public.save_expense_accounting_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]'); raise exception 'expected missing identity denial';
 exception when serialization_failure then perform pg_temp.ok(true,'missing provider validation identity fails closed'); end;
end; $$;
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{"currency":"CAD"}','[]','[]','[]');
update accounting_connections set updated_at=clock_timestamp() where id=pg_temp.fx(30);
select pg_temp.ok(exists(select 1 from expense_accounting_settings where connection_id=pg_temp.fx(30)),'ordinary connection refresh preserves same-company settings');
update accounting_connections set provider_environment='production' where id=pg_temp.fx(30);
select pg_temp.ok(not exists(select 1 from expense_accounting_settings where connection_id=pg_temp.fx(30)),'environment change also clears provider-specific settings');
select pg_temp.ok(not has_function_privilege('authenticated','public.save_expense_accounting_settings(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text,text,jsonb)','execute'),'identity-bound settings write remains service-only');
-- Expense-owned project selection, event custody and explicit recovery.
select set_config('request.jwt.claims','',false);
insert into projects(id,company_id,title,status,deleted_at) values
 (pg_temp.fx(990),pg_temp.fx(1),'Completed expense project','completed',null),
 (pg_temp.fx(991),pg_temp.fx(1),'Unrelated project','active',null),
 (pg_temp.fx(992),pg_temp.fx(2),'Foreign project','active',null),
 (pg_temp.fx(993),pg_temp.fx(1),'Deleted project','active',clock_timestamp());
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]',null,
 jsonb_build_array(jsonb_build_object('projectId',pg_temp.fx(990),'externalProjectId','job-original'),
 jsonb_build_object('projectId',pg_temp.fx(991),'externalProjectId','job-unrelated')));
select pg_temp.ok((select count(*)=2 from expense_accounting_project_mappings where connection_id=pg_temp.fx(30)),
 'completed same-company projects can receive expense-specific assignments');
select pg_temp.ok(not has_table_privilege('authenticated','public.expense_accounting_project_mappings','SELECT,INSERT,UPDATE,DELETE'),
 'project mapping storage is service-only');
do $$ begin
 begin perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]',null,
  jsonb_build_array(jsonb_build_object('projectId',pg_temp.fx(992),'externalProjectId','job-foreign'))); raise exception 'expected foreign project denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'foreign project mappings denied atomically'); end;
 begin perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]',null,
  jsonb_build_array(jsonb_build_object('projectId',pg_temp.fx(993),'externalProjectId','job-deleted'))); raise exception 'expected deleted project denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'new mapping to deleted project denied'); end;
end; $$;
select pg_temp.ok((select count(*)=2 from expense_accounting_project_mappings where connection_id=pg_temp.fx(30)),
 'invalid project assignments retain existing setup');
update accounting_connections set sync_enabled=false where id=pg_temp.fx(30);
insert into expenses(id,company_id,submitted_by,status,amount,tax_amount,currency,expense_date,payment_method)
 values(pg_temp.fx(994),pg_temp.fx(1),pg_temp.fx(11),'submitted',100,0,'CAD',current_date,'personal_card');
insert into expense_project_allocations(id,expense_id,project_id,percentage,amount)
 values(pg_temp.fx(995),pg_temp.fx(994),pg_temp.fx(990)::text,100,100);
update expenses set status='approved' where id=pg_temp.fx(994);
select pg_temp.ok((select connection_bindings->pg_temp.fx(30)::text->'projectMappings'
 =jsonb_build_object(pg_temp.fx(990)::text,'job-original') from expense_accounting_events where expense_id=pg_temp.fx(994)),
 'decision freezes only its allocated project mapping while sync is disabled');
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]',null,
 jsonb_build_array(jsonb_build_object('projectId',pg_temp.fx(990),'externalProjectId','job-replacement')));
update accounting_connections set sync_enabled=true where id=pg_temp.fx(30);
select set_config('request.jwt.claims','{"sub":"p5-owner","role":"authenticated"}',false);
select request_expense_accounting_sync(pg_temp.fx(994));
select pg_temp.ok((select payload_snapshot->'projectMappingsSnapshot'=jsonb_build_object(pg_temp.fx(990)::text,'job-original')
 from accounting_sync_queue where entity_id=pg_temp.fx(994)), 'delayed queue reuses decision project despite setup changes');
select set_config('request.jwt.claims','',false);
update accounting_sync_queue set status='needs_review' where entity_id=pg_temp.fx(994);
select retry_expense_accounting_before_write(pg_temp.fx(10),(select id from accounting_sync_queue where entity_id=pg_temp.fx(994)));
select pg_temp.ok((select payload_snapshot->'projectMappingsSnapshot'=jsonb_build_object(pg_temp.fx(990)::text,'job-replacement')
 from accounting_sync_queue where entity_id=pg_temp.fx(994)), 'explicit safe recovery adopts current project choice');
update projects set deleted_at=clock_timestamp() where id=pg_temp.fx(990);
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]',null,
 jsonb_build_array(jsonb_build_object('projectId',pg_temp.fx(990),'externalProjectId','job-replacement')));
select pg_temp.ok((select count(*)=1 from expense_accounting_project_mappings where connection_id=pg_temp.fx(30)),
 'exact stored project assignment survives project archival');
do $$ begin
 begin perform pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]',null,
  jsonb_build_array(jsonb_build_object('projectId',pg_temp.fx(990),'externalProjectId','different-job'))); raise exception 'expected archived project reassignment denial';
 exception when insufficient_privilege then perform pg_temp.ok(true,'archived project cannot be reassigned'); end;
end; $$;
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]');
select pg_temp.ok((select count(*)=1 from expense_accounting_project_mappings where connection_id=pg_temp.fx(30)),
 'omitted project selections preserve existing assignments');
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]',null,'[]');
select pg_temp.ok(not exists(select 1 from expense_accounting_project_mappings where connection_id=pg_temp.fx(30)),
 'explicit empty project selections remove archived assignments');
select pg_temp.save_expense_settings(pg_temp.fx(10),pg_temp.fx(30),'{}','[]','[]',null,
 jsonb_build_array(jsonb_build_object('projectId',pg_temp.fx(991),'externalProjectId','job-unrelated')));
update accounting_connections set realm_id_lookup=repeat('f',64) where id=pg_temp.fx(30);
select pg_temp.ok(not exists(select 1 from expense_accounting_project_mappings where connection_id=pg_temp.fx(30)),
 'provider relink clears expense-owned project assignments');
select pg_temp.ok((select connection_bindings->pg_temp.fx(30)::text->'projectMappings'
 =jsonb_build_object(pg_temp.fx(990)::text,'job-original') from expense_accounting_events where expense_id=pg_temp.fx(994)),
 'project relink leaves original immutable cost assignment intact');
select count(*)||' expense accounting runtime assertions passed' from assertions;
