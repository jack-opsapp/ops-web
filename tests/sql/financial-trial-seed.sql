\set ON_ERROR_STOP on
-- Fictional data only. This script refuses any non-disposable database.
do $$ begin if current_database() !~ '^ops_p16_[0-9]+_[0-9]+$' then raise exception 'LOCAL_FIXTURE_ONLY';end if;end $$;
set timezone='UTC';
set request.jwt.claim.role='service_role';
create schema financial_test;
insert into public.companies(id,name,public_handle,currency_code) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Financial fixture','financial-fixture','CAD'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other company','other-financial','CAD');
insert into public.users(id,company_id,first_name,last_name,is_company_admin) values('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Operator','Fixture',true),('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Other','Operator',true);
insert into public.clients(id,company_id,name) values('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fixture customer');
insert into public.projects(id,company_id,client_id,title,status) values('30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','Fixture repair','accepted');
insert into public.project_notes(id,project_id,company_id,author_id,content) values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','Approved fictional pricing source. Operator rates may be entered explicitly. Terms: payment on completion.');
update public.companies set name='OPS FICTIONAL FINANCIAL TRIAL',account_holder_id='10000000-0000-4000-8000-000000000001' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.tax_rates(company_id,name,rate,is_default,is_active) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','GST',0.05,true,true);
create function financial_test.request(key text) returns jsonb language sql set timezone='UTC' as $$
select jsonb_build_object('document_kind','estimate','operation','create','client_id','20000000-0000-4000-8000-000000000001','project_id','30000000-0000-4000-8000-000000000001','opportunity_id',null,'revises_estimate_id',null,'expected_revision_sha256',null,'baseline_estimate_id',null,'policy_id',p.id,'policy_sha256',private.financial_document_hash(to_jsonb(p)),'currency','CAD','issue_date',current_date,'expiration_date',current_date+30,'title','Fixture repair','client_message','','terms',p.terms,'inclusions','Replace damaged boards','exclusions','Railing','scope_evidence',jsonb_build_object('kind','operator','reference_id',null,'sha256',null,'statement','Measured additional repair scope'),'increase_percent','8','adjustment_base','unit_prices_and_minimum_charges','lines','[{"name":"Board installation","description":"","quantity":"1.125","unit":"hour","type":"LABOR","source":{"kind":"operator","reference_id":null,"sha256":null,"unit_price":"12.50","minimum_charge":"0.00"},"discount_percent":"0","is_taxable":true}]'::jsonb,'idempotency_key',key) from private.financial_document_policies p where p.company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and p.status='active'
$$;
insert into public.projects(id,company_id,client_id,title,status,completed_at) values('30000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','Past fictional deck','completed',clock_timestamp());
insert into public.estimates(id,company_id,client_id,client_ref,project_id,project_ref,estimate_number,status,currency_code,total,subtotal)
values('80000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','FICTIONAL-HISTORY-001','approved','CAD',210,200);
insert into public.line_items(id,company_id,estimate_id,name,description,quantity,unit,unit_price,type,is_taxable,discount_percent,minimum_charge_snapshot,sort_order)
values('90000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','80000000-0000-4000-8000-000000000002','Deck labour','',2,'hour',100,'LABOR',true,0,0,0);
-- The only effect installation is in this guarded local fixture, after all real functions.
update private.financial_document_effect_policy set effect_revision=private.financial_document_effect_revision();
