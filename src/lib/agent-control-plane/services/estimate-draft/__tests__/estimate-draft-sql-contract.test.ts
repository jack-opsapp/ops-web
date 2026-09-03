import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260902231632_agent_estimate_draft_preview.sql"
);

function migration(): string {
  return fs.readFileSync(migrationPath, "utf8");
}

describe("estimate draft SQL contract", () => {
  it("creates only a stable read snapshot and final assertion boundary", () => {
    const sql = migration();
    expect(sql).toContain(
      "create or replace function public.read_agent_estimate_draft_as_system"
    );
    expect(sql).toContain(
      "create or replace function public.assert_agent_estimate_draft_authority_as_system"
    );
    expect(sql).toContain("language plpgsql\nstable\nsecurity definer");
    expect(sql).not.toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+public\.(?:create|commit|persist|issue|approve|publish|send|number|update)_/i
    );
    expect(sql).not.toMatch(
      /^\s*(?:insert\s+into|update|delete\s+from)\s+(?:public|private)\./gim
    );
  });

  it("pins the exact dormant v16 and v10 authority envelope", () => {
    const sql = migration();
    for (const revision of [
      "2026-09-02.capability-manifest.v16",
      "2026-09-02.mcp-exposure.v10",
      "2026-09-02.mcp-consent-catalog.v5",
      "prepare_estimate_from_past_job:2026-09-02.v1",
    ]) {
      expect(sql).toContain(`'${revision}'`);
    }
    for (const scope of [
      "ops.company.read",
      "ops.customers.read",
      "ops.financial_documents.read",
      "ops.financials.prepare",
      "ops.jobs.read",
    ]) {
      expect(sql).toContain(`'${scope}'`);
    }
    for (const permission of [
      "clients.view",
      "estimates.create",
      "estimates.view",
      "pipeline.view",
      "projects.view",
      "settings.company",
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
    expect(sql).toContain(
      "Prepare exact draft estimates from authorized past jobs"
    );
    expect(sql).toContain("client_record.scope_ceiling = case");
    expect(sql).toContain("client_record.scope = pg_catalog.array_to_string(");
    expect(sql).toContain("grant_record.accepted_labels =");
  });

  it("binds an explicit open target and approved completed-job source in one tenant", () => {
    const sql = migration();
    for (const relation of [
      "public.companies",
      "public.clients",
      "public.opportunities",
      "public.projects",
      "public.estimates",
      "public.line_items",
      "public.tax_rates",
    ]) {
      expect(sql).toContain(relation);
    }
    expect(sql).toContain("opportunity.id = p_target_opportunity_id");
    expect(sql).toContain("estimate.id = p_source_estimate_id");
    expect(sql).toContain("opportunity.company_id = p_company_id");
    expect(sql).toContain("estimate.company_id = p_company_id");
    expect(sql).toContain("project.company_id = p_company_id");
    expect(sql).toContain("project.client_id = v_estimate.client_id");
    expect(sql).toContain("estimate.status in ('approved', 'converted')");
    expect(sql).toContain("project.status in ('completed', 'closed')");
    expect(sql).toContain("opportunity.merged_into_opportunity_id is null");
    expect(sql).toContain("client.merged_into_client_id is null");
    for (const stage of [
      "new_lead",
      "qualifying",
      "quoting",
      "quoted",
      "negotiation",
      "follow_up",
    ]) {
      expect(sql).toContain(`'${stage}'`);
    }
  });

  it("requires canonical line, deposit, totals, and current default-tax evidence", () => {
    const sql = migration();
    expect(sql).toContain("v_estimate.discount_type is not null");
    expect(sql).toContain("v_estimate.discount_value is not null");
    expect(sql).toContain("v_estimate.deposit_type in ('fixed', 'percentage')");
    expect(sql).toContain("tax_rate.is_active is true");
    expect(sql).toContain("tax_rate.is_default is true");
    expect(sql).toContain("v_tax_rate_count > 1");
    expect(sql).toContain("v_tax_rate.rate > 1");
    expect(sql).toContain("line_item.quantity <= 0");
    expect(sql).toContain("line_item.discount_percent, 0) not between 0 and 100");
    expect(sql).toContain("line_item.minimum_charge_snapshot < 0");
    expect(sql).toContain("line_item.is_optional is null");
    expect(sql).toContain("line_item.is_selected is null");
    expect(sql).toContain("line_item.line_total is null");
    expect(sql).toContain("group by line_item.sort_order");
    expect(sql).toContain("having count(*) > 1");
  });

  it("uses sentinel bounds, immutable hashes, and stale-source revalidation", () => {
    const sql = migration();
    expect(sql).toContain("p_line_item_limit is distinct from 101");
    expect(sql).toContain("limit p_line_item_limit");
    expect(sql).toContain("v_line_count >= p_line_item_limit");
    expect(sql).toContain("AGENT_ESTIMATE_DRAFT_SOURCE_BOUND");
    expect(sql).toContain("pg_catalog.octet_length(");
    expect(sql).toContain(") > 1000000");
    expect(sql).toContain("extensions.digest(");
    expect(sql).toContain("p_expected_source_revision !~ '^[0-9a-f]{64}$'");
    expect(sql).toContain(
      "v_snapshot->>'source_revision' is distinct from\n       p_expected_source_revision"
    );
    expect(sql).not.toMatch(/'client_message'\s*,/);
    expect(sql).not.toMatch(/'internal_notes'\s*,/);
    expect(sql).not.toMatch(/'terms'\s*,/);
    expect(sql).not.toMatch(/'notes'\s*,/);
  });

  it("keeps helpers private and public RPCs service-role only", () => {
    const sql = migration();
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke all on function private.build_agent_estimate_draft_snapshot"
    );
    expect(sql).toContain(
      "grant execute on function public.read_agent_estimate_draft_as_system"
    );
    expect(sql).toContain(
      "grant execute on function public.assert_agent_estimate_draft_authority_as_system"
    );
    expect(sql.match(/\) to service_role;/g)).toHaveLength(2);
    expect(sql).toContain("AGENT_ESTIMATE_DRAFT_FUNCTION_ACL_INVALID");
    expect(sql).toContain("AGENT_ESTIMATE_DRAFT_FUNCTION_SHAPE_INVALID");
  });
});
