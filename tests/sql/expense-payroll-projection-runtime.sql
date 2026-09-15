\set ON_ERROR_STOP on
create function pg_temp.payroll_snapshot()
returns jsonb
language sql
volatile
as $function$
  select public.read_agent_payroll_readiness_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('b', 32),
    array[
      'ops.company.read',
      'ops.expenses.read',
      'ops.financial_documents.read',
      'ops.financials.read',
      'ops.payments.read'
    ],
    'sha256:' || repeat('a', 64),
    '2026-09-01.capability-manifest.v14',
    '2026-09-01.mcp-exposure.v8',
    'check_payroll_readiness',
    'check_payroll_readiness:2026-09-01.v1',
    '2026-09-01 16:00:00+00',
    '2026-09-15',
    40,
    50,
    100,
    500
  );
$function$;
create temp table projection_assertions(label text);
create function pg_temp.projection_ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAILED: %',label; end if;
 insert into projection_assertions values(label); end; $$;
select pg_temp.projection_ok((select source_revision from private.agent_read_domain_revisions where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and domain='payroll_readiness')=(select source_revision+1 from public.expense_payroll_projection_revision_fixture),'migration invalidates read revision once across replay');
select pg_temp.projection_ok(pg_temp.payroll_snapshot()->'reimbursement_batches'->0->>'owed_amount'='150','payroll uses crew projection, not legacy total');
select pg_temp.projection_ok(pg_temp.payroll_snapshot()->'reimbursement_batches'->0->>'line_count'='1','company card does not inflate eligible receipt count');
select pg_temp.projection_ok(pg_temp.payroll_snapshot()->'reimbursement_batches'->0->'currency_codes'='["CAD"]'::jsonb,'company card foreign currency does not poison crew obligations');
select pg_temp.projection_ok(jsonb_array_length(pg_temp.payroll_snapshot()->'reimbursement_batches')=1,'foreign company stays excluded');
update public.expenses set payment_method='company_card' where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.expense_batches set reimbursement_amount=0 where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.projection_ok(jsonb_array_length(pg_temp.payroll_snapshot()->'reimbursement_batches')=0,'company-funded-only zero debt is excluded');
select pg_temp.projection_ok(pg_temp.payroll_snapshot()->'source_counts'->>'reimbursement_batches'='0','zero debt does not consume source bounds');
update public.expenses set payment_method='personal_card' where id='41000000-0000-4000-8000-000000000001';
update public.expense_batches set reimbursement_amount=150,paid_at=now() where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.projection_ok(jsonb_array_length(pg_temp.payroll_snapshot()->'reimbursement_batches')=0,'Mark paid removes owed reimbursement');
update public.expense_batches set paid_at=null where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.projection_ok(pg_temp.payroll_snapshot()->'reimbursement_batches'->0->>'owed_amount'='150','undo restores exact crew principal');
update public.expenses set payment_method='personal_card' where id='41000000-0000-4000-8000-000000000002';
update public.expense_batches set reimbursement_amount=0 where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.projection_ok(jsonb_array_length(pg_temp.payroll_snapshot()->'reimbursement_batches')=1,'zero sum retains eligible crew currency evidence');
select pg_temp.projection_ok((pg_temp.payroll_snapshot()->'reimbursement_batches'->0->'currency_codes') ? '__mismatch__','zero sum cannot hide mixed-currency obligations');
update public.expenses set payment_method='company_card' where id='41000000-0000-4000-8000-000000000002';
update public.expense_batches set reimbursement_amount=150 where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.expenses set currency='USD' where id='41000000-0000-4000-8000-000000000001';
select pg_temp.projection_ok(pg_temp.payroll_snapshot()->'reimbursement_batches'->0->'currency_codes'='["__mismatch__"]'::jsonb,'crew currency mismatch remains visible');
update public.expense_batches set reimbursement_amount=null where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.projection_ok(pg_temp.payroll_snapshot()->'reimbursement_batches'->0->'owed_amount'='null'::jsonb,'missing projection is not silently treated as zero');
update public.expense_batches set reimbursement_amount='NaN' where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.projection_ok(pg_temp.payroll_snapshot()->'reimbursement_batches'->0->>'owed_amount'='__invalid__','invalid numeric remains bounded review evidence');
select pg_temp.projection_ok(not has_function_privilege('authenticated','public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer,integer)','execute'),'direct clients retain no payroll system execution grant');
select pg_temp.projection_ok(not has_function_privilege('anon','public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer,integer)','execute'),'anonymous caller retains no payroll system execution grant');
select pg_temp.projection_ok(has_function_privilege('service_role','public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer,integer)','execute'),'system execution grant preserved');
select count(*)||' payroll reimbursement projection assertions passed' from projection_assertions;
