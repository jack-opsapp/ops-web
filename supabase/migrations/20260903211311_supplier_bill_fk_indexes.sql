-- Cover every supplier-bill foreign key used by joins and parent-row changes.

begin;

create index if not exists supplier_bill_documents_bill_company_idx on public.supplier_bill_documents (bill_id, company_id);
create index if not exists supplier_bill_documents_created_by_idx on public.supplier_bill_documents (created_by);
create index if not exists supplier_bill_events_actor_idx on public.supplier_bill_events (actor_user_id);
create index if not exists supplier_bill_events_company_idx on public.supplier_bill_events (company_id);
create index if not exists supplier_bill_lines_bill_company_idx on public.supplier_bill_line_items (bill_id, company_id);
create index if not exists supplier_bill_lines_category_idx on public.supplier_bill_line_items (category_id);
create index if not exists supplier_bill_lines_company_idx on public.supplier_bill_line_items (company_id);
create index if not exists supplier_bill_payment_accounts_company_idx on public.supplier_bill_payment_account_mappings (company_id);
create index if not exists supplier_bill_payments_bill_company_idx on public.supplier_bill_payments (bill_id, company_id);
create index if not exists supplier_bill_payments_company_idx on public.supplier_bill_payments (company_id);
create index if not exists supplier_bill_payments_recorded_by_idx on public.supplier_bill_payments (recorded_by);
create index if not exists supplier_bill_payments_voided_by_idx on public.supplier_bill_payments (voided_by);
create index if not exists supplier_bill_allocations_line_bill_company_idx on public.supplier_bill_project_allocations (line_item_id, bill_id, company_id);
create index if not exists supplier_bill_allocations_project_only_idx on public.supplier_bill_project_allocations (project_id);
create index if not exists supplier_bill_project_mappings_company_idx on public.supplier_bill_project_mappings (company_id);
create index if not exists supplier_bill_project_mappings_project_idx on public.supplier_bill_project_mappings (project_id);
create index if not exists supplier_bill_provider_links_company_idx on public.supplier_bill_provider_links (company_id);
create index if not exists supplier_bill_tax_mappings_company_idx on public.supplier_bill_tax_mappings (company_id);
create index if not exists supplier_bills_category_idx on public.supplier_bills (category_id);
create index if not exists supplier_bills_confirmed_by_idx on public.supplier_bills (confirmed_by);
create index if not exists supplier_bills_created_by_idx on public.supplier_bills (created_by);
create index if not exists supplier_bills_supplier_company_idx on public.supplier_bills (supplier_id, company_id);
create index if not exists supplier_bills_voided_by_idx on public.supplier_bills (voided_by);
create index if not exists suppliers_created_by_idx on public.suppliers (created_by);

commit;
