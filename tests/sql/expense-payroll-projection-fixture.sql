\set ON_ERROR_STOP on
-- Projection writes are tested with the full lifecycle migration separately.
-- This read-contract fixture supplies its three verified column additions.
alter table public.expense_batches add column reimbursement_amount numeric;
alter table public.expenses add column status text;
alter table public.expenses add column payment_method text;
update public.expense_batches set reimbursement_amount=150;
update public.expenses set status='approved',payment_method='personal_card';
update public.expenses set payment_method='company_card',currency='USD'
 where id='41000000-0000-4000-8000-000000000002';
create table public.expense_payroll_projection_revision_fixture as
 select source_revision from private.agent_read_domain_revisions
 where company_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and domain='payroll_readiness';
