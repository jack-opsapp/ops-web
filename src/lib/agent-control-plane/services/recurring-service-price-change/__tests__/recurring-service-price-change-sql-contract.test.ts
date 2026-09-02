import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260902010000_agent_recurring_service_price_change.sql"
);
const indexDedupeMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260902195000_agent_recurring_service_price_index_dedupe.sql"
);
const foreignKeyIndexMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260902195500_agent_recurring_service_price_fk_indexes.sql"
);

function migration(): string {
  return fs.readFileSync(migrationPath, "utf8");
}

describe("recurring-service price-change SQL contract", () => {
  it("creates only the private policy source and a stable read RPC", () => {
    const sql = migration();
    expect(sql).toContain(
      "create table private.agent_recurring_service_price_policies"
    );
    expect(sql).toContain(
      "create or replace function public.read_agent_recurring_service_price_change_as_system"
    );
    expect(sql).toContain(
      "create or replace function public.assert_agent_recurring_service_price_change_authority_as_system"
    );
    expect(sql).toContain("language plpgsql\nstable\nsecurity definer");
    expect(sql).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.(?:commit|persist|send|apply|update)_agent_recurring_service_price_change/i
    );
  });

  it("pins the exact dormant authority envelope", () => {
    const sql = migration();
    expect(sql).toContain("2026-09-01.capability-manifest.v15");
    expect(sql).toContain("2026-09-01.mcp-exposure.v9");
    expect(sql).toContain(
      "client_record.scope_ceiling = v_exposure_scope_ceiling"
    );
    expect(sql).toContain("client_record.scope = pg_catalog.array_to_string(");
    expect(sql).toContain("prepare_recurring_service_price_change");
    expect(sql).toContain(
      "prepare_recurring_service_price_change:2026-09-01.v1"
    );
    for (const scope of [
      "ops.catalog.read",
      "ops.company.read",
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.financial_documents.read",
      "ops.operations.prepare",
      "ops.schedule.read",
    ]) {
      expect(sql).toContain(`'${scope}'`);
    }
    for (const permission of [
      "calendar.view",
      "catalog.products.view",
      "catalog.view",
      "clients.view",
      "email.view",
      "estimates.view",
      "invoices.view",
      "settings.company",
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
  });

  it("bridges inherited tools only across their historical pair or the exact v15/v9 envelope", () => {
    const sql = migration();
    for (const functionName of [
      "assert_agent_additive_exposure_authority",
      "assert_agent_hiring_what_if_authority",
      "assert_agent_promise_recovery_authority",
      "assert_agent_sales_truth_authority",
      "assert_agent_payroll_readiness_authority",
    ]) {
      expect(sql).toContain(
        `create or replace function private.${functionName}`
      );
    }
    for (const revision of [
      "2026-08-31.capability-manifest.v11",
      "2026-08-31.mcp-exposure.v5",
      "2026-09-01.capability-manifest.v12",
      "2026-09-01.mcp-exposure.v6",
      "2026-09-01.capability-manifest.v13",
      "2026-09-01.mcp-exposure.v7",
      "2026-09-01.capability-manifest.v14",
      "2026-09-01.mcp-exposure.v8",
      "2026-09-01.capability-manifest.v15",
      "2026-09-01.mcp-exposure.v9",
    ]) {
      expect(sql).toContain(`'${revision}'`);
    }
    expect(sql).toContain(
      "client_record.scope_ceiling = v_v9_exposure_scope_ceiling"
    );
    expect(sql).toContain("client_record.scope = pg_catalog.array_to_string(");
    expect(sql).toContain("v_is_v9 or p_require_accepted_labels");
    expect(sql).toContain("2026-09-01.mcp-consent-catalog.v4");
    expect(sql).toContain(
      "AGENT_RECURRING_SERVICE_PRICE_CHANGE_BRIDGE_SHAPE_INVALID"
    );
  });

  it("binds recurrence, terms, accepted price, contact, provider evidence, and payment evidence", () => {
    const sql = migration();
    for (const relation of [
      "public.task_recurrences",
      "public.task_recurrence_exceptions",
      "public.task_types",
      "public.clients",
      "public.sub_clients",
      "public.line_items",
      "public.estimates",
      "public.invoices",
      "public.tax_rates",
      "public.users",
      "private.agent_provider_delivery_sources",
    ]) {
      expect(sql).toContain(relation);
    }
    for (const field of [
      "price_source_line_item_id",
      "price_source_sha256",
      "notice_period_days",
      "adjustment_allowed",
      "authorized_increase_percent",
      "authorized_effective_month",
      "grandfathered_until",
      "notice_contact_kind",
      "notice_contact_id",
      "policy_source_sha256",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("ops.correspondence.normalized-text.v2");
    expect(sql).toContain("normalization_status = 'normalized'");
    for (const signal of [
      "explicit_cancellation",
      "price_objection",
      "service_complaint",
      "overcharge_complaint",
    ]) {
      expect(sql).toContain(`'${signal}'`);
    }
    expect(sql).toContain("select distinct on (matched.category)");
    expect(sql).toContain("latest_signal_state as");
    expect(sql).toContain("resolution.code like '%_resolved'");
  });

  it("keeps the source bounded and omits provider body text from the response", () => {
    const sql = migration();
    expect(sql).toContain("p_account_limit is distinct from 101");
    expect(sql).toContain("limit 101");
    expect(sql).toContain("limit 10001");
    expect(sql).toContain("v_catalog_recurrence_count > 10000");
    expect(sql).toContain("'overflow', v_catalog_recurrence_count > 10000");
    expect(sql).toContain("p_read_phase not in ('catalog', 'detail')");
    expect(sql).toContain("AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_BOUND");
    expect(sql).toContain("recurrence_match_count");
    expect(sql).toContain("limit 1001");
    expect(sql).toContain("limit 101");
    expect(sql).toContain("limit 20");
    expect(sql).toContain("pg_catalog.octet_length");
    expect(sql).toContain("<= 20000");
    expect(sql.match(/interval '8760 hours'/g)).toHaveLength(3);
    expect(sql).not.toContain("interval '365 days'");
    expect(sql).toContain(
      "agent_provider_delivery_sources_sender_delivered_idx"
    );
    expect(sql).toContain(
      "agent_provider_delivery_sources_tenant_delivered_idx"
    );
    expect(sql).toContain("agent_provider_delivery_sources_recipients_gin_idx");
    expect(sql).toContain(
      "agent_provider_delivery_sources_cc_recipients_gin_idx"
    );
    expect(sql).toContain("clients_agent_active_normalized_email_idx");
    expect(sql).toContain("sub_clients_agent_active_normalized_email_idx");
    expect(sql).toContain("identified.normalized_email !~ '^[.]'");
    expect(sql).toContain("identified.normalized_email !~ '[.][.]'");
    expect(sql).toContain(
      "source.recipient_identities @>\n                array[contact.normalized_email]::text[]"
    );
    expect(sql).toContain(
      "source.cc_recipient_identities @>\n                array[contact.normalized_email]::text[]"
    );
    expect(sql).not.toMatch(/'normalized_plain_text'\s*,/);
    expect(sql).not.toMatch(/'content_value'\s*,/);
  });

  it("uses canonical tax, timezone, label-safety, and exact record-hash semantics", () => {
    const sql = migration();
    expect(sql).toContain("tax_rate.rate * 100");
    expect(sql).toContain("tax_rate.is_active is true");
    expect(sql).toContain("tax_rate on line_item.is_taxable is true");
    expect(sql).toContain("case when tax_rate.preview_valid");
    expect(sql).toContain("recurrence.rrule !~ '^[A-Z0-9=;,+-]+$'");
    expect(sql).toContain("coalesce(line_item.discount_percent, 0)");
    expect(sql).toContain("estimate.discount_amount, invoice.discount_amount");
    expect(sql).toContain("estimate.discount_value, invoice.discount_value, 0");
    expect(sql).toContain("document_discount_amount");
    expect(sql).toMatch(
      /pg_catalog\.trim_scale\(\s*line_item\.minimum_charge_snapshot\s*\)::text/
    );
    expect(sql).toContain("line_item.is_optional is not null");
    expect(sql).toContain("line_item.is_selected is not null");
    expect(sql).toContain("line_item.is_optional::text");
    expect(sql).toContain("line_item.is_selected::text");
    expect(sql).not.toContain("coalesce(line_item.is_optional, false)");
    expect(sql).not.toContain("coalesce(line_item.is_selected, true)");
    expect(sql).toContain("line_item.is_taxable is not null");
    expect(sql).toContain("recurrence_source_sha256");
    expect(sql).toContain(
      "private.agent_price_preview_label_is_safe(policy_source_ref)"
    );
    expect(sql).toContain("identified.active_identity_count::text");
    expect(sql).toContain("tax_rate_source_sha256");
    expect(sql).toContain("invoice.paid_at at time zone v_timezone");
    expect(sql).toContain("and v_business_date > invoice.due_date");
    expect(sql).toContain(
      "'sent', 'awaiting_payment', 'partially_paid', 'past_due'"
    );
    expect(sql).toContain("or invoice.status = 'paid'");
    expect(sql).toContain("and invoice.total > 0");
    expect(sql).toContain("and invoice.balance_due > 0");
    expect(sql).toContain("and invoice.balance_due <= invoice.total");
    expect(sql).toContain("and coalesce(invoice.balance_due, 0) = 0");
    expect(sql).not.toMatch(/greatest\(\s*1,\s*coalesce\(/);
    expect(sql).toMatch(
      /private\.agent_price_preview_label_is_safe\(\s*pg_catalog\.btrim\(line_item\.unit\)\s*\)/
    );
    expect(sql).toMatch(
      /private\.agent_price_preview_label_is_safe\(\s*pg_catalog\.btrim\(source_tax_rate\.name\)\s*\)/
    );
    expect(sql).toContain(
      "AGENT_RECURRING_SERVICE_PRICE_CHANGE_SOURCE_INVALID"
    );
    expect(sql).toContain("project.status in ('accepted', 'in_progress')");
    expect(sql).not.toContain("project.status in ('Accepted', 'In Progress')");
  });

  it("adds an exact dormant consent catalogue for price previews", () => {
    const sql = migration();
    expect(sql).toContain("2026-09-01.mcp-consent-catalog.v4");
    expect(sql).toContain(
      "Prepare recurring-service price-change previews and customer notice drafts"
    );
  });

  it("denies direct policy access and exposes execution only to service_role", () => {
    const sql = migration();
    expect(sql).toContain(
      "revoke all on table private.agent_recurring_service_price_policies"
    );
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain(
      "grant execute on function public.read_agent_recurring_service_price_change_as_system"
    );
    expect(sql).toContain(
      "grant execute on function public.assert_agent_recurring_service_price_change_authority_as_system"
    );
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("active_agent_mcp_exposure_revision");
  });

  it("keeps the read function mutation-free", () => {
    const body = migration().split(
      "create or replace function public.read_agent_recurring_service_price_change_as_system"
    )[1];
    expect(body).toBeDefined();
    expect(body!.split("revoke all on function")[0]).not.toMatch(
      /\b(?:insert\s+into|update\s+public\.|update\s+private\.|delete\s+from|merge\s+into|pg_notify)\b/i
    );
  });

  it("removes only the exact redundant provider-delivery index", () => {
    const sql = fs.readFileSync(indexDedupeMigrationPath, "utf8");
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
    expect(sql).toContain(
      "agent_provider_delivery_sources_company_delivered_idx"
    );
    expect(sql).toContain(
      "drop index if exists private.agent_provider_delivery_sources_tenant_delivered_idx"
    );
    expect(sql).toContain("agent_recurring_service_price_index_shape_invalid");
    expect(sql.match(/drop\s+index/gi)).toHaveLength(1);
  });

  it("covers every recurring-service policy foreign key", () => {
    const sql = fs.readFileSync(foreignKeyIndexMigrationPath, "utf8");
    for (const indexName of [
      "agent_recurring_service_price_policies_client_fk_idx",
      "agent_recurring_service_price_policies_created_by_fk_idx",
      "agent_recurring_service_price_policies_task_type_fk_idx",
      "agent_recurring_service_price_policies_price_source_line_item_fk_idx",
    ]) {
      expect(sql).toContain(indexName);
    }
    expect(sql).toContain("agent_recurring_service_price_fk_index_shape_invalid");
    expect(sql.match(/create\s+index\s+if\s+not\s+exists/gi)).toHaveLength(4);
  });
});
