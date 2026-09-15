\set ON_ERROR_STOP on
-- Reproduce the reported boundary before the additive correction RPC exists.
begin;
insert into companies(id) values('77900000-0000-4000-8000-000000000001');
insert into users(id,company_id,firebase_uid,is_active,is_company_admin) values
 ('77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000001','baseline-admin',true,true),
 ('77900000-0000-4000-8000-000000000011','77900000-0000-4000-8000-000000000001','baseline-crew',true,false);
insert into expense_batches(id,company_id,submitted_by,status,batch_number,amendment_number) values
 ('77900000-0000-4000-8000-000000000100','77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000011','pending_review','BASELINE-CORRECTION',0);
insert into expenses(id,company_id,submitted_by,batch_id,status,merchant_name,amount,currency,expense_date,payment_method) values
 ('77900000-0000-4000-8000-000000000200','77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000011','77900000-0000-4000-8000-000000000100','submitted','Typo',100,'CAD',current_date,'cash');
select set_config('request.jwt.claims','{"sub":"baseline-admin","role":"authenticated"}',true);
do $$ begin
 if to_regprocedure('public.correct_expense_for_review(jsonb)') is not null then
   raise exception 'Correction RPC unexpectedly exists in baseline';
 end if;
 begin
   update expenses set merchant_name='Corrected' where id='77900000-0000-4000-8000-000000000200';
   raise exception 'Baseline unexpectedly allows ordinary admin correction';
 exception when insufficient_privilege then null; end;
end; $$;
rollback;
select 'Baseline reproduced: no correction command; ordinary admin edit denied' as result;
