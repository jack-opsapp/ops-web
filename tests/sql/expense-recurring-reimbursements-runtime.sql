\set ON_ERROR_STOP on
-- Recurring reimbursement vertical. Synthetic fixtures only; no customer data.
create function pg_temp.fx(i integer) returns uuid language sql immutable as $$
 select ('78000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
$$;
create temp table assertions(label text);
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAILED: %',label; end if;
 insert into assertions values(label); end; $$;
create function pg_temp.fails(statement text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute statement; raise exception 'Expected failure: %',label;
 exception when others then
   if sqlstate<>expected then raise exception 'FAILED: %, wanted %, got %: %',label,expected,sqlstate,sqlerrm; end if;
 end;
 perform pg_temp.ok(true,label);
end; $$;
create function pg_temp.as_user(sub text) returns void language sql as $$
 select set_config('request.jwt.claims',case when sub is null then '' else
   jsonb_build_object('sub',sub,'role','authenticated')::text end,false);
$$;

insert into companies(id,timezone,currency_code) values
 (pg_temp.fx(1),'America/Vancouver','CAD'),(pg_temp.fx(2),'America/New_York','USD'),(pg_temp.fx(3),'UTC','USD');
-- Company-local months relative to today.
create function pg_temp.m(k integer) returns date language sql stable as $$
 select (private.expense_recurring_month_start(private.expense_recurring_company_today('78000000-0000-4000-8000-000000000001'))
   + make_interval(months=>k))::date;
$$;
create function pg_temp.me(k integer) returns date language sql stable as $$
 select ((pg_temp.m(k)+interval '1 month')::date-1);
$$;
create function pg_temp.month_name(d date) returns text language sql immutable as $$
 select to_char(d,'FMMonth YYYY');
$$;

insert into users(id,company_id,firebase_uid,is_active,is_company_admin,first_name,last_name) values
 (pg_temp.fx(10),pg_temp.fx(1),'rr-owner',true,true,'Owen','Owner'),
 (pg_temp.fx(11),pg_temp.fx(1),'rr-office',true,false,'Olive','Office'),
 (pg_temp.fx(12),pg_temp.fx(1),'rr-crew',true,false,'Matt','Crew'),
 (pg_temp.fx(13),pg_temp.fx(1),'rr-crew2',true,false,'Casey','Crew'),
 (pg_temp.fx(14),pg_temp.fx(1),'rr-inactive',false,false,'Ina','Active'),
 (pg_temp.fx(15),pg_temp.fx(1),'rr-crew3',true,false,'Cam','Crew'),
 (pg_temp.fx(20),pg_temp.fx(2),'rr-foreign',true,true,'Fran','Foreign'),
 (pg_temp.fx(30),pg_temp.fx(3),'rr-perjob-admin',true,true,'Pat','Admin'),
 (pg_temp.fx(31),pg_temp.fx(3),'rr-perjob-crew',true,false,'Pete','Crew');
insert into user_permission_overrides(user_id,company_id,permission,scope,granted) values
 (pg_temp.fx(11),pg_temp.fx(1),'expenses.approve','all',true),
 (pg_temp.fx(11),pg_temp.fx(1),'expenses.view','all',true),
 (pg_temp.fx(12),pg_temp.fx(1),'expenses.view','own',true),
 (pg_temp.fx(12),pg_temp.fx(1),'expenses.edit','own',true),
 (pg_temp.fx(13),pg_temp.fx(1),'expenses.view','own',true),
 (pg_temp.fx(15),pg_temp.fx(1),'expenses.view','own',true);
insert into expense_settings(company_id,review_frequency,auto_approve_threshold,require_receipt_photo,require_project_assignment,auto_submit_grace_days)
 values(pg_temp.fx(1),'monthly',0,true,false,7),(pg_temp.fx(3),'per_job',0,true,false,7);
insert into expense_categories(id,company_id,name,is_active) values
 (pg_temp.fx(40),pg_temp.fx(1),'Advertising',true),
 (pg_temp.fx(41),pg_temp.fx(1),'Retired',false),
 (pg_temp.fx(42),pg_temp.fx(2),'Foreign',true);

-- Matt's history: M-3 paid, M-2 approved and owed, M-1 nothing, M filling.
insert into expense_batches(id,company_id,submitted_by,status,batch_number,amendment_number,period_start,period_end,paid_at,paid_by,reviewed_by,reviewed_at)
 values
 (pg_temp.fx(100),pg_temp.fx(1),pg_temp.fx(12),'approved','RR-M3',0,pg_temp.m(-3),pg_temp.me(-3),now(),pg_temp.fx(10),pg_temp.fx(10),now()),
 (pg_temp.fx(101),pg_temp.fx(1),pg_temp.fx(12),'approved','RR-M2',0,pg_temp.m(-2),pg_temp.me(-2),null,null,pg_temp.fx(10),now()),
 (pg_temp.fx(102),pg_temp.fx(1),pg_temp.fx(12),'open','RR-M0',0,pg_temp.m(0),pg_temp.me(0),null,null,null,null);
insert into expenses(id,company_id,submitted_by,batch_id,status,merchant_name,amount,currency,expense_date,payment_method,receipt_image_url)
 values
 (pg_temp.fx(200),pg_temp.fx(1),pg_temp.fx(12),pg_temp.fx(100),'reimbursed','Paid receipt',40,'CAD',pg_temp.m(-3)+3,'personal_card','https://example.test/r1.jpg'),
 (pg_temp.fx(201),pg_temp.fx(1),pg_temp.fx(12),pg_temp.fx(101),'approved','Owed receipt',307.60,'CAD',pg_temp.m(-2)+3,'personal_card','https://example.test/r2.jpg'),
 (pg_temp.fx(202),pg_temp.fx(1),pg_temp.fx(12),pg_temp.fx(102),'submitted','Filling receipt',20,'CAD',pg_temp.m(0),'personal_card','https://example.test/r3.jpg');
select public.recalculate_expense_batch_total(id) from expense_batches where id in (pg_temp.fx(100),pg_temp.fx(101),pg_temp.fx(102));

select pg_temp.ok(private.expense_recurring_money_text(350,'CAD')='CA$350.00','CAD money text');
select pg_temp.ok(private.expense_recurring_money_text(1234.5,'USD')='$1,234.50','USD money text with grouping');

-- ─── Authority and validation ─────────────────────────────────────────────
select pg_temp.as_user('rr-crew');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(-3)),'42501','crew cannot set up a reimbursement');
select pg_temp.as_user('rr-office');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,0,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(0)),'22023','zero amount denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,10000.01,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(0)),'22023','amount above ceiling denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,1.005,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(0)),'22023','sub-cent amount denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(12),'   ',pg_temp.m(0)),'22023','blank name denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(12),repeat('a',81),pg_temp.m(0)),'22023','long name denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(-13)),'22023','start more than 12 months back denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(13)),'22023','start more than 12 months ahead denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(0),pg_temp.fx(42)),'23503','foreign category denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(0),pg_temp.fx(41)),'23503','retired category denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(14),'Vehicle advertising',pg_temp.m(0)),'42501','inactive person denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(31),'Vehicle advertising',pg_temp.m(0)),'42501','person in another company denied');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(11),'Office phone',pg_temp.m(0)),'42501','non-admin approver cannot pay themselves');
select pg_temp.as_user('rr-foreign');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(12),'Vehicle advertising',pg_temp.m(0)),'42501','foreign admin denied');
select pg_temp.ok((select count(*)=0 from expense_recurring_reimbursements),'failed commands leave nothing behind');
select pg_temp.ok((select count(*)=0 from private.expense_recurring_reimbursement_scope),'failed commands leave no capability');

-- ─── Create and place ─────────────────────────────────────────────────────
select pg_temp.as_user('rr-office');
create temp table created as select public.create_expense_recurring_reimbursement(
 pg_temp.fx(12),'  Vehicle advertising ',350,pg_temp.m(-3)+14,pg_temp.fx(40)) receipt;
create temp table setup as select (receipt->>'id')::uuid id from created;
select pg_temp.as_user(null);

select pg_temp.ok((select r.name='Vehicle advertising' and r.amount=350 and r.currency='CAD'
 and r.first_period=pg_temp.m(-3) and r.next_period=pg_temp.m(1) and r.last_period is null
 and r.created_by=pg_temp.fx(11) and r.updated_by=pg_temp.fx(11) and r.category_id=pg_temp.fx(40)
 from expense_recurring_reimbursements r join setup s on s.id=r.id),'setup trimmed, normalised to month, company currency');
select pg_temp.ok((select jsonb_array_length(receipt->'lines')=4 from created),'command returns every placed month');
select pg_temp.ok((select count(*)=4 from expenses e join setup s on s.id=e.recurring_reimbursement_id where e.deleted_at is null),
 'four months filed from M-3 through this month');
select pg_temp.ok((select e.batch_id=pg_temp.fx(102) and e.description='Monthly · '||pg_temp.month_name(pg_temp.m(-3))
 and e.expense_date=pg_temp.m(-3) from expenses e join setup s on s.id=e.recurring_reimbursement_id
 where e.recurring_period=pg_temp.m(-3)),'a paid month rolls forward to the filling envelope and keeps its month');
select pg_temp.ok((select e.batch_id=pg_temp.fx(101) from expenses e join setup s on s.id=e.recurring_reimbursement_id
 where e.recurring_period=pg_temp.m(-2)),'an approved unpaid month joins the envelope the office already owes');
select pg_temp.ok((select b.reimbursement_amount=657.60 and b.total_amount=657.60 and b.status='approved' and b.paid_at is null
 from expense_batches b where b.id=pg_temp.fx(101)),'owed envelope now owes receipts plus the reimbursement');
select pg_temp.ok((select b.status='open' and b.period_start=pg_temp.m(-1) and b.period_end=pg_temp.me(-1) and b.submitted_by=pg_temp.fx(12)
 and b.total_amount=350 from expenses e join setup s on s.id=e.recurring_reimbursement_id join expense_batches b on b.id=e.batch_id
 where e.recurring_period=pg_temp.m(-1)),'a month with no envelope gets its own envelope');
select pg_temp.ok((select e.batch_id=pg_temp.fx(102) from expenses e join setup s on s.id=e.recurring_reimbursement_id
 where e.recurring_period=pg_temp.m(0)),'this month joins the filling envelope');
select pg_temp.ok((select total_amount=720 from expense_batches where id=pg_temp.fx(102)),'filling envelope total includes both recurring months');
select pg_temp.ok((select bool_and(e.status='approved' and e.approved_by=pg_temp.fx(11) and e.approved_at is not null
 and e.merchant_name='Vehicle advertising' and e.amount=350 and e.currency='CAD' and e.category_id=pg_temp.fx(40)
 and e.payment_method is null and e.receipt_missing_reason='other'
 and e.receipt_missing_note='Recurring reimbursement. No receipt needed.' and e.project_missing_reason is null
 and e.submitted_by=pg_temp.fx(12) and e.company_id=pg_temp.fx(1))
 from expenses e join setup s on s.id=e.recurring_reimbursement_id),'every line is pre-approved, office-stamped and receipt-exempt');
select pg_temp.ok((select count(*)=4 from expense_accounting_events ev join expenses e on e.id=ev.expense_id
 join setup s on s.id=e.recurring_reimbursement_id where ev.kind='accrual'),'each month records one accounting accrual');
select pg_temp.ok((select count(*)=1 from notifications n where n.user_id=pg_temp.fx(12)::text and n.type='expense_recurring'
 and n.title='Recurring reimbursement added'
 and n.body='Vehicle advertising · CA$350.00 a month, starting '||to_char(pg_temp.m(-3),'Mon YYYY')
 and n.deep_link_type='expense' and n.action_url like '/books?segment=expenses%' and n.company_id=pg_temp.fx(1)::text),
 'crew member gets one exact notice');
select pg_temp.ok((select count(*)=0 from private.expense_recurring_reimbursement_scope),'capability released after create');

-- ─── Idempotency ──────────────────────────────────────────────────────────
select pg_temp.ok(private.generate_expense_recurring_lines()=0,'generator adds nothing twice');
select public.expense_envelope_sweep();
select pg_temp.ok((select count(*)=4 from expenses e join setup s on s.id=e.recurring_reimbursement_id),'sweep adds nothing twice');
select pg_temp.as_user('rr-office');
select pg_temp.fails(format('select public.create_expense_recurring_reimbursement(%L,%L,350,%L)',
 pg_temp.fx(12),'vehicle ADVERTISING',pg_temp.m(0)),'23505','same name for the same person denied');

-- ─── Line authority ───────────────────────────────────────────────────────
create temp table line as select e.id,e.recurring_period from expenses e join setup s on s.id=e.recurring_reimbursement_id;
create function pg_temp.line_at(k integer) returns uuid language sql stable as $$
 select id from line where recurring_period=pg_temp.m(k);
$$;
select pg_temp.as_user('rr-crew');
select pg_temp.fails(format('update expenses set amount=3500 where id=%L',pg_temp.line_at(-1)),'42501','crew cannot change the amount');
select pg_temp.fails(format('update expenses set deleted_at=now() where id=%L',pg_temp.line_at(-1)),'42501','crew cannot delete the line');
select pg_temp.fails(format('update expenses set status=%L where id=%L','submitted',pg_temp.line_at(-1)),'42501','crew cannot resubmit the line');
select pg_temp.as_user('rr-owner');
select pg_temp.fails(format('update expenses set merchant_name=%L where id=%L','Edited',pg_temp.line_at(-1)),'42501','admin cannot edit the line directly');
select pg_temp.fails(format('update expenses set flag_comment=%L,flagged_by=%L,flagged_at=now() where id=%L','why',pg_temp.fx(10),pg_temp.line_at(-1)),'42501','admin cannot flag the line');
select pg_temp.fails(format('update expenses set status=%L where id=%L','rejected',pg_temp.line_at(-1)),'42501','admin cannot reject the line');
select pg_temp.fails(format('update expenses set deleted_at=now() where id=%L',pg_temp.line_at(-1)),'42501','admin cannot soft-delete the line');
select pg_temp.fails(format('update expenses set batch_id=%L where id=%L',pg_temp.fx(101),pg_temp.line_at(-1)),'42501','admin cannot move the line');
select pg_temp.fails(format('delete from expenses where id=%L',pg_temp.line_at(-1)),'42501','admin cannot hard-delete the line');
select pg_temp.fails(format('update expenses set recurring_reimbursement_id=null,recurring_period=null where id=%L',pg_temp.line_at(-1)),'42501','admin cannot detach the line');
select pg_temp.fails(format('insert into expenses(company_id,submitted_by,status,merchant_name,amount,currency,expense_date,batch_id,recurring_reimbursement_id,recurring_period) values(%L,%L,%L,%L,1,%L,%L,%L,%L,%L)',
 pg_temp.fx(1),pg_temp.fx(12),'approved','Forged',
 'CAD',pg_temp.m(1),pg_temp.fx(102),(select id from setup),pg_temp.m(1)),'42501','nobody forges a recurring line');
update expenses set approved_by=pg_temp.fx(10),approved_at=now() where id=pg_temp.line_at(-1);
select pg_temp.ok((select approved_by=pg_temp.fx(10) from expenses where id=pg_temp.line_at(-1)),
 'approval stamps still move (reject-with-revisions clean-line write)');
select pg_temp.as_user(null);

-- Payout stamps move through the ordinary decision path.
select pg_temp.as_user('rr-office');
select public.mark_expense_batch_paid(pg_temp.fx(101));
select pg_temp.ok((select status='reimbursed' from expenses where id=pg_temp.line_at(-2)),'Mark paid pays the reimbursement');
select public.unmark_expense_batch_paid(pg_temp.fx(101));
select pg_temp.ok((select status='approved' from expenses where id=pg_temp.line_at(-2)),'Undo paid returns it to owed');
select public.mark_expense_batch_paid(pg_temp.fx(101));
select pg_temp.as_user(null);

-- ─── Update ───────────────────────────────────────────────────────────────
select pg_temp.as_user('rr-office');
select pg_temp.fails(format('select public.update_expense_recurring_reimbursement(%L,%L,400,null,%L)',
 (select id from setup),'Vehicle advertising','2020-01-01T00:00:00Z'),'P0001','stale form denied');
create temp table before_update as select updated_at from expense_recurring_reimbursements where id=(select id from setup);
select public.update_expense_recurring_reimbursement((select id from setup),'Vehicle advertising',350,pg_temp.fx(40),
 (select updated_at from before_update));
select pg_temp.ok((select updated_at=(select updated_at from before_update) from expense_recurring_reimbursements
 where id=(select id from setup)),'unchanged update writes nothing');
select public.update_expense_recurring_reimbursement((select id from setup),'Vehicle advertising',400,null,
 (select updated_at from before_update));
select pg_temp.as_user(null);
select pg_temp.ok((select amount=350 and status='reimbursed' and category_id=pg_temp.fx(40) from expenses where id=pg_temp.line_at(-2)),
 'paid month keeps what was paid');
select pg_temp.ok((select bool_and(amount=400 and category_id is null and approved_by=pg_temp.fx(11)) from expenses
 where id in (pg_temp.line_at(-3),pg_temp.line_at(-1),pg_temp.line_at(0))),'unpaid months follow the new amount');
select pg_temp.ok((select total_amount=820 from expense_batches where id=pg_temp.fx(102)),'envelope totals follow the update');
select pg_temp.ok((select count(*)=1 from notifications where user_id=pg_temp.fx(12)::text and type='expense_recurring'
 and title='Recurring reimbursement updated' and body='Vehicle advertising · CA$400.00 a month'),'amount change notifies the crew member');

-- ─── Skip and restore ─────────────────────────────────────────────────────
select pg_temp.as_user('rr-office');
select public.skip_expense_recurring_reimbursement_line(pg_temp.line_at(-1));
select pg_temp.as_user(null);
select pg_temp.ok((select deleted_at is not null from expenses where id=pg_temp.line_at(-1)),'skip removes the month');
select pg_temp.ok((select b.total_amount=0 from expenses e join expense_batches b on b.id=e.batch_id where e.id=pg_temp.line_at(-1)),
 'skip lowers the envelope');
select pg_temp.ok((select count(*)=1 from notifications where user_id=pg_temp.fx(12)::text and title='Recurring reimbursement skipped'
 and body='Vehicle advertising · '||to_char(pg_temp.m(-1),'Mon YYYY') and resolved_at is null),'skip notifies the crew member');
select pg_temp.ok((select count(*) from expense_accounting_events ev where ev.expense_id=pg_temp.line_at(-1) and ev.kind='reversal')>=1,
 'skip reverses the accrual');
select pg_temp.ok(private.generate_expense_recurring_lines()=0,'a skipped month is never regenerated');
select pg_temp.as_user('rr-office');
select public.skip_expense_recurring_reimbursement_line(pg_temp.line_at(-1));
select pg_temp.fails(format('select public.skip_expense_recurring_reimbursement_line(%L)',pg_temp.line_at(-2)),'55000','a paid month cannot be skipped');
select pg_temp.fails(format('select public.skip_expense_recurring_reimbursement_line(%L)',pg_temp.fx(201)),'42501','an ordinary receipt is not skippable');
select public.restore_expense_recurring_reimbursement_line(pg_temp.line_at(-1));
select pg_temp.as_user(null);
select pg_temp.ok((select e.deleted_at is null and e.amount=400 and b.total_amount=400 from expenses e
 join expense_batches b on b.id=e.batch_id where e.id=pg_temp.line_at(-1)),'restore puts the month back at the current amount');
select pg_temp.ok((select count(*)=0 from notifications where user_id=pg_temp.fx(12)::text and title='Recurring reimbursement skipped'
 and resolved_at is null),'restore resolves the skip notice');
-- Skip again, pay that envelope out, then restore: the month rolls forward.
select pg_temp.as_user('rr-office');
select public.skip_expense_recurring_reimbursement_line(pg_temp.line_at(-1));
select pg_temp.as_user(null);
create temp table m1_batch as select batch_id id from expenses where id=pg_temp.line_at(-1);
insert into expenses(id,company_id,submitted_by,batch_id,status,merchant_name,amount,currency,expense_date,payment_method,receipt_image_url)
 values(pg_temp.fx(203),pg_temp.fx(1),pg_temp.fx(12),(select id from m1_batch),'submitted','Late receipt',15,'CAD',pg_temp.m(-1)+5,'cash','https://example.test/r4.jpg');
select pg_temp.as_user('rr-office');
select public.approve_expense_batch((select id from m1_batch));
select public.mark_expense_batch_paid((select id from m1_batch));
select public.restore_expense_recurring_reimbursement_line(pg_temp.line_at(-1));
select pg_temp.as_user(null);
select pg_temp.ok((select e.batch_id=pg_temp.fx(102) and e.deleted_at is null from expenses e where e.id=pg_temp.line_at(-1)),
 'restoring into a paid month rolls forward to the filling envelope');

-- ─── End ──────────────────────────────────────────────────────────────────
select pg_temp.as_user('rr-office');
select pg_temp.fails(format('select public.end_expense_recurring_reimbursement(%L,%L,%L)',(select id from setup),pg_temp.m(-2),
 (select updated_at from expense_recurring_reimbursements where id=(select id from setup))),'22023','ending before a filed month denied');
select pg_temp.fails(format('select public.end_expense_recurring_reimbursement(%L,%L,%L)',(select id from setup),pg_temp.m(-4),
 (select updated_at from expense_recurring_reimbursements where id=(select id from setup))),'22023','ending before the first month denied');
select public.end_expense_recurring_reimbursement((select id from setup),pg_temp.m(2),
 (select updated_at from expense_recurring_reimbursements where id=(select id from setup)));
select pg_temp.as_user(null);
select pg_temp.ok((select last_period=pg_temp.m(2) from expense_recurring_reimbursements where id=(select id from setup)),'end recorded');
select pg_temp.ok((select count(*)=4 from expenses where recurring_reimbursement_id=(select id from setup) and deleted_at is null),
 'ending removes no line');
select pg_temp.ok((select count(*)=1 from notifications where user_id=pg_temp.fx(12)::text and title='Recurring reimbursement ending'
 and body='Vehicle advertising · last month '||to_char(pg_temp.m(2),'Mon YYYY')),'end notifies the crew member');
select pg_temp.as_user('rr-office');
select public.end_expense_recurring_reimbursement((select id from setup),null,
 (select updated_at from expense_recurring_reimbursements where id=(select id from setup)));
select pg_temp.as_user(null);
select pg_temp.ok((select last_period is null and next_period=pg_temp.m(1) from expense_recurring_reimbursements
 where id=(select id from setup)),'removing an end that has not passed keeps the schedule');
-- A setup that stopped long ago resumes from this month without backfilling.
update expense_recurring_reimbursements set last_period=pg_temp.m(-2),next_period=pg_temp.m(-1)
 where id=(select id from setup);
select pg_temp.as_user('rr-office');
select public.end_expense_recurring_reimbursement((select id from setup),null,
 (select updated_at from expense_recurring_reimbursements where id=(select id from setup)));
select pg_temp.as_user(null);
select pg_temp.ok((select next_period=pg_temp.m(1) from expense_recurring_reimbursements where id=(select id from setup)),
 'resume starts from this month');
select pg_temp.ok((select count(*)=4 from expenses where recurring_reimbursement_id=(select id from setup)),'resume backfills nothing');

-- ─── Delete ───────────────────────────────────────────────────────────────
select pg_temp.as_user('rr-office');
select pg_temp.fails(format('select public.delete_expense_recurring_reimbursement(%L,%L)',(select id from setup),
 (select updated_at from expense_recurring_reimbursements where id=(select id from setup))),'55000','a paid setup cannot be deleted');
create temp table phone as select (public.create_expense_recurring_reimbursement(pg_temp.fx(13),'Phone plan',85,pg_temp.m(0))->>'id')::uuid id;
select public.delete_expense_recurring_reimbursement((select id from phone),
 (select updated_at from expense_recurring_reimbursements where id=(select id from phone)));
select pg_temp.as_user(null);
select pg_temp.ok((select deleted_at is not null and deleted_by=pg_temp.fx(11) from expense_recurring_reimbursements where id=(select id from phone)),
 'setup made in error is removed');
select pg_temp.ok((select bool_and(e.deleted_at is not null) and bool_and(b.total_amount=0) from expenses e
 join expense_batches b on b.id=e.batch_id where e.recurring_reimbursement_id=(select id from phone)),'its lines leave the envelope');
select pg_temp.ok((select count(*)=1 from notifications where user_id=pg_temp.fx(13)::text and title='Recurring reimbursement removed'
 and body='Phone plan'),'removal notifies the crew member');
select pg_temp.as_user('rr-office');
select pg_temp.fails(format('select public.update_expense_recurring_reimbursement(%L,%L,90,null,%L)',(select id from phone),'Phone plan',
 (select updated_at from expense_recurring_reimbursements where id=(select id from phone))),'42501','a removed setup cannot change');
select pg_temp.fails(format('select public.restore_expense_recurring_reimbursement_line(%L)',
 (select id from expenses where recurring_reimbursement_id=(select id from phone))),'55000','a removed setup cannot restore months');

-- ─── Self, inactive and rescue ────────────────────────────────────────────
select pg_temp.as_user('rr-owner');
create temp table own as select (public.create_expense_recurring_reimbursement(pg_temp.fx(10),'Truck signage',200,pg_temp.m(0))->>'id')::uuid id;
select pg_temp.as_user(null);
select pg_temp.ok((select count(*)=1 from expenses where recurring_reimbursement_id=(select id from own)),'an admin may set up their own');
select pg_temp.ok((select count(*)=0 from notifications where user_id=pg_temp.fx(10)::text and type='expense_recurring'),
 'no notice to yourself');

insert into expense_recurring_reimbursements(id,company_id,user_id,name,amount,currency,first_period,next_period,created_by,updated_by)
 values(pg_temp.fx(300),pg_temp.fx(1),pg_temp.fx(14),'Old arrangement',100,'CAD',pg_temp.m(-2),pg_temp.m(-2),pg_temp.fx(10),pg_temp.fx(10));
select private.generate_expense_recurring_lines();
select pg_temp.ok((select count(*)=0 from expenses where recurring_reimbursement_id=pg_temp.fx(300)),'inactive person gets no lines');
select pg_temp.ok((select next_period=pg_temp.m(1) from expense_recurring_reimbursements where id=pg_temp.fx(300)),
 'inactive months are passed, not queued');

select pg_temp.as_user('rr-office');
create temp table tool as select (public.create_expense_recurring_reimbursement(pg_temp.fx(15),'Tool rental',50,pg_temp.m(0))->>'id')::uuid id;
select pg_temp.as_user(null);
create temp table returned as select batch_id id from expenses where recurring_reimbursement_id=(select id from tool);
select pg_temp.as_user('rr-owner');
update expense_batches set status='rejected',reviewed_by=pg_temp.fx(10),reviewed_at=now(),review_notes='Fix receipts'
 where id=(select id from returned);
select pg_temp.as_user(null);
select pg_temp.ok(private.generate_expense_recurring_lines()>=1,'rescue runs');
select pg_temp.ok((select e.batch_id<>(select id from returned) and b.status='open' and b.period_start=pg_temp.m(0)
 from expenses e join expense_batches b on b.id=e.batch_id where e.recurring_reimbursement_id=(select id from tool)),
 'a line stranded in a returned envelope moves to where it will be paid');
select pg_temp.ok((select total_amount=0 from expense_batches where id=(select id from returned)),'returned envelope drains');

-- ─── Read access ──────────────────────────────────────────────────────────
grant usage on schema private to authenticated;
grant select,insert on assertions to authenticated;
grant select on setup to authenticated;
create temp table direct_write as select format('insert into expense_recurring_reimbursements(company_id,user_id,name,amount,currency,first_period,next_period,created_by,updated_by) values(%L,%L,%L,1,%L,%L,%L,%L,%L)',
 pg_temp.fx(1),pg_temp.fx(12),'Direct','CAD',pg_temp.m(0),pg_temp.m(0),pg_temp.fx(10),pg_temp.fx(10)) statement;
grant select on direct_write to authenticated;
begin;
set local role authenticated;
select pg_temp.as_user('rr-crew');
select pg_temp.ok((select count(*)=1 from expense_recurring_reimbursements),'crew member reads only their own');
select pg_temp.as_user('rr-crew2');
select pg_temp.ok((select count(*)=1 from expense_recurring_reimbursements where user_id=pg_temp.fx(13)),'another crew member reads only theirs');
select pg_temp.ok((select count(*)=0 from expense_recurring_reimbursements where user_id=pg_temp.fx(12)),'and never a teammate''s');
select pg_temp.as_user('rr-office');
select pg_temp.ok((select count(*)=5 from expense_recurring_reimbursements),'office reads the company''s');
select pg_temp.as_user('rr-foreign');
select pg_temp.ok((select count(*)=0 from expense_recurring_reimbursements),'another company reads none');
select pg_temp.as_user('rr-owner');
select pg_temp.fails((select statement from direct_write),'42501','no direct setup writes');
select pg_temp.fails(format('update expense_recurring_reimbursements set amount=1 where id=%L',(select id from setup)),'42501','no direct setup updates');
commit;
reset role;
select pg_temp.as_user(null);

-- ─── Per-job companies ────────────────────────────────────────────────────
select pg_temp.as_user('rr-perjob-admin');
create temp table perjob as select (public.create_expense_recurring_reimbursement(pg_temp.fx(31),'Vehicle advertising',120,pg_temp.m(0))->>'id')::uuid id;
select pg_temp.as_user(null);
select pg_temp.ok((select b.scope_project_id is null and b.period_start=private.expense_recurring_month_start(private.expense_recurring_company_today(pg_temp.fx(3)))
 and b.period_end=(b.period_start+interval '1 month')::date-1 from expenses e join expense_batches b on b.id=e.batch_id
 where e.recurring_reimbursement_id=(select id from perjob)),'per-job company files the reimbursement in a calendar-month envelope');
insert into projects(id,company_id,title,status) values(pg_temp.fx(400),pg_temp.fx(3),'Unfinished job','in_progress');
insert into expense_batches(id,company_id,submitted_by,status,batch_number,amendment_number,period_start,period_end,scope_project_id)
 values(pg_temp.fx(401),pg_temp.fx(3),pg_temp.fx(31),'open','PJ-OVERHEAD',0,current_date-40,current_date-40,null),
 (pg_temp.fx(402),pg_temp.fx(3),pg_temp.fx(31),'open','PJ-JOB',0,current_date-40,current_date-40,pg_temp.fx(400));
select public.expense_envelope_sweep();
select pg_temp.ok((select status='pending_review' from expense_batches where id=pg_temp.fx(401)),'a job-less per-job envelope now sends on its date');
select pg_temp.ok((select status='open' from expense_batches where id=pg_temp.fx(402)),'a job envelope still waits for the job to finish');

select pg_temp.ok((select count(*)=0 from private.expense_recurring_reimbursement_scope),'no capability survives any command');
select count(*)||' recurring reimbursement assertions passed' as result from assertions;
