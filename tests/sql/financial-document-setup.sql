\set ON_ERROR_STOP on
\ir agent-customer-update-setup.sql
\ir financial-document-live-schema.sql
\ir financial-document-rate-audit-schema.sql
\ir financial-document-rate-functions.sql
alter table public.estimates add primary key(id);
alter table public.line_items add primary key(id);
alter table public.projects add primary key(id);
alter table public.products add primary key(id);
alter table public.tax_rates add primary key(id);
alter table public.project_notes add primary key(id);
alter table public.document_sequences add primary key(company_id,document_type,fiscal_year);
\ir financial-document-live-functions.sql
create trigger trg_accounting_sync_queue_estimates after insert or update on public.estimates for each row execute function public.enqueue_accounting_sync();
create trigger trg_accounting_sync_queue_line_items after insert or update or delete on public.line_items for each row execute function public.enqueue_accounting_sync();
\ir ../../supabase/migrations/20260907062351_financial_document_private_drafts.sql
