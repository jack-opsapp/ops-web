-- Cover every foreign key introduced by supplier bill intake clearance.
-- The tables are empty at release, so ordinary transactional index creation
-- avoids a concurrent-build failure mode without taking a customer-data lock.

begin;

create index if not exists supplier_bill_intake_allocations_line_intake_company_idx
  on public.supplier_bill_intake_allocations (line_item_id, intake_id, company_id);
create index if not exists supplier_bill_intake_allocations_company_idx
  on public.supplier_bill_intake_allocations (company_id);
create index if not exists supplier_bill_intake_allocations_confirmed_by_idx
  on public.supplier_bill_intake_allocations (confirmed_by)
  where confirmed_by is not null;

create index if not exists supplier_bill_intake_checks_dispositioned_by_idx
  on public.supplier_bill_intake_checks (dispositioned_by)
  where dispositioned_by is not null;
create index if not exists supplier_bill_intake_checks_intake_company_idx
  on public.supplier_bill_intake_checks (intake_id, company_id);

create index if not exists supplier_bill_intake_documents_intake_company_idx
  on public.supplier_bill_intake_documents (intake_id, company_id);

create index if not exists supplier_bill_intake_events_company_idx
  on public.supplier_bill_intake_events (company_id);
create index if not exists supplier_bill_intake_events_intake_company_idx
  on public.supplier_bill_intake_events (intake_id, company_id);

create index if not exists supplier_bill_intake_lines_intake_company_idx
  on public.supplier_bill_intake_line_items (intake_id, company_id);
create index if not exists supplier_bill_intake_lines_match_confirmed_by_idx
  on public.supplier_bill_intake_line_items (match_confirmed_by)
  where match_confirmed_by is not null;

create index if not exists supplier_bill_intakes_approved_by_idx
  on public.supplier_bill_intakes (approved_by)
  where approved_by is not null;
create index if not exists supplier_bill_intakes_promoted_expense_idx
  on public.supplier_bill_intakes (promoted_expense_id)
  where promoted_expense_id is not null;
create index if not exists supplier_bill_intakes_routed_to_payroll_by_idx
  on public.supplier_bill_intakes (routed_to_payroll_by)
  where routed_to_payroll_by is not null;

commit;
