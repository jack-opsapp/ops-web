\set ON_ERROR_STOP on
\ir agent-p2-full-wave-postgres17-baseline.sql
\ir ../../supabase/migrations/20260823072831_agent_read_domain_revisions.sql
\ir ../../supabase/migrations/20260823072837_mcp_oauth_consent_catalog_versioning.sql
\ir ../../supabase/migrations/20260823072843_agent_mcp_durable_rate_limit.sql
\ir ../../supabase/migrations/20260823072849_agent_mcp_evidence_nonce_ledger.sql
\ir ../../supabase/migrations/20260823080451_agent_p2_legacy_attention_projections.sql
\ir ../../supabase/migrations/20260823100016_agent_customer_context_sources.sql
\ir ../../supabase/migrations/20260823100019_agent_customer_context_read.sql
\ir ../../supabase/migrations/20260827233026_agent_task_sources.sql
\ir ../../supabase/migrations/20260827233034_agent_task_reads.sql
\ir ../../supabase/migrations/20260827233630_agent_artifact_sources.sql
\ir ../../supabase/migrations/20260827233640_agent_artifact_reads.sql
\ir ../../supabase/migrations/20260828211556_agent_site_visit_sources.sql
\ir ../../supabase/migrations/20260828211605_agent_site_visit_reads.sql
\ir ../../supabase/migrations/20260829011311_agent_deck_design_sources.sql
\ir ../../supabase/migrations/20260829011319_agent_deck_design_geometry_read.sql
\ir ../../supabase/migrations/20260829013804_agent_mcp_evidence_redemption_rpc.sql
\ir ../../supabase/migrations/20260829024746_agent_sales_document_sources.sql
\ir ../../supabase/migrations/20260829024749_agent_sales_document_reads.sql
\ir ../../supabase/migrations/20260829040045_agent_expense_reimbursement_sources.sql
\ir ../../supabase/migrations/20260829040046_agent_expense_reads.sql
\ir ../../supabase/migrations/20260829040356_agent_company_sources.sql
\ir ../../supabase/migrations/20260829040402_agent_company_context_read.sql
\ir ../../supabase/migrations/20260829061203_agent_catalog_sources.sql
\ir ../../supabase/migrations/20260829061214_agent_catalog_reads.sql
\ir ../../supabase/migrations/20260829063450_agent_team_sources.sql
\ir ../../supabase/migrations/20260829063451_agent_team_members_read.sql
\ir ../../supabase/migrations/20260829074110_agent_availability_sources.sql
\ir ../../supabase/migrations/20260829074111_agent_team_availability_read.sql
\ir ../../supabase/migrations/20260829081500_agent_payment_sources.sql
\ir ../../supabase/migrations/20260829081501_agent_payment_read.sql
\ir ../../supabase/migrations/20260829091311_agent_purchasing_sources.sql
\ir ../../supabase/migrations/20260829091329_agent_purchase_order_reads.sql
\ir ../../supabase/migrations/20260829102510_agent_integration_health_sources.sql
\ir ../../supabase/migrations/20260829102520_agent_integration_health_read.sql
\ir ../../supabase/migrations/20260829110000_agent_work_queue_sources.sql
\ir ../../supabase/migrations/20260829110001_agent_work_queue_read.sql
\ir ../../supabase/migrations/20260829110002_agent_operational_overview_read.sql
\ir ../../supabase/migrations/20260829192448_mcp_oauth_codex_dcr_callbacks.sql
\ir ../../supabase/migrations/20260830113800_mcp_oauth_chatgpt_rfc9207_callback.sql
\ir ../../supabase/migrations/20260830120000_agent_mcp_scope_set_binding.sql
\ir ../../supabase/migrations/20260830140000_agent_mcp_scope_canonical_order.sql
\ir ../../supabase/migrations/20260830150000_agent_mcp_financial_tombstones.sql
\ir ../../supabase/migrations/20260830160000_agent_mcp_postgres_uuid_compatibility.sql
\ir ../../supabase/migrations/20260830170000_agent_site_visit_nullable_client_visibility.sql
\ir ../../supabase/migrations/20260830180000_agent_catalog_empty_supplier_costs.sql
alter table public.projects add column if not exists completed_at timestamptz;
alter table public.opportunities add column if not exists actual_close_date date;
alter table public.opportunities add column if not exists expected_close_date date;
alter table public.opportunities add column if not exists archived_at timestamptz;
\ir fixtures/maverick-conversation-tables.sql
\ir fixtures/maverick-conversation-live-20260905.sql
