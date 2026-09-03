import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260901153000_agent_sales_truth_read.sql"
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("sales-truth SQL contract", () => {
  it("pins the exact dormant v13/v7 authority and least privilege grants", () => {
    const sql = migration();

    expect(sql).toContain("'2026-09-01.capability-manifest.v13'");
    expect(sql).toContain("'2026-09-01.mcp-exposure.v7'");
    expect(sql).toContain("'analyze_sales_truth:2026-09-01.v1'");
    expect(sql).toContain("'ops.correspondence.read'");
    expect(sql).toContain("'ops.operations.read'");
    expect(sql).toContain("'email.view'");
    expect(sql).toContain("'pipeline.view'");
    expect(sql).toContain("security definer");
    expect(sql.match(/set search_path = ''/gu)).toHaveLength(2);
    expect(sql).toMatch(
      /revoke all on function public\.read_agent_sales_truth_as_system[\s\S]*from public, anon, authenticated;/u
    );
    expect(sql).toMatch(
      /grant execute on function public\.read_agent_sales_truth_as_system[\s\S]*to service_role;/u
    );
  });

  it("reads only the verified sources and returns no free-form business content", () => {
    const sql = migration();

    for (const source of [
      "public.companies",
      "public.opportunities",
      "public.stage_transitions",
      "public.opportunity_dispositions",
      "public.activities",
    ]) {
      expect(sql).toContain(source);
    }
    expect(sql).toContain("merged_into_opportunity_id is null");
    expect(sql).toContain("deleted_at is null");
    expect(sql).toContain("activity.type in ('email', 'text_message')");
    expect(sql).toContain("activity.direction in ('inbound', 'outbound')");
    expect(sql).not.toMatch(/activity\.(?:body|content|subject)/u);
    expect(sql).not.toMatch(/opportunity\.(?:title|description|lost_notes)/u);
    expect(sql).not.toMatch(/disposition\.reason_notes/u);
  });

  it("pins all source bounds, the company-local window, and explicit source revisions", () => {
    const sql = migration();

    expect(sql).toContain("p_window_days is distinct from 180");
    expect(sql).toContain("p_opportunity_limit is distinct from 5000");
    expect(sql).toContain("p_transition_limit is distinct from 20000");
    expect(sql).toContain("p_disposition_limit is distinct from 5000");
    expect(sql).toContain("p_activity_limit is distinct from 20000");
    expect(sql).toContain("private.agent_unambiguous_local_instant");
    expect(sql).toContain("'company', v_company_revision");
    expect(sql).toContain("'sales_truth', v_sales_truth_revision");
    expect(sql).toContain("domain = 'sales_truth'");
  });

  it("adds guarded access paths and revision triggers without changing business rows", () => {
    const sql = migration();

    expect(sql).toContain("opportunities_agent_sales_truth_cohort_v1_idx");
    expect(sql).toContain("activities_agent_sales_truth_history_v1_idx");
    expect(sql).toContain("index_row.indisvalid");
    expect(sql).toContain("index_row.indisready");
    expect(sql).toContain("index_row.indislive");
    expect(sql).toContain("index_relation.reloptions is null");
    expect(sql).toContain("pg_catalog.pg_get_indexdef");
    expect(sql).toContain("pg_catalog.pg_get_expr");
    expect(sql).toContain("AGENT_SALES_TRUTH_TRANSITION_DURATION_INVALID");
    expect(sql).toContain("agent_sales_truth_source_revision_v1");
    for (const table of [
      "opportunities",
      "stage_transitions",
      "opportunity_dispositions",
      "activities",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_agent_sales_truth_source_revision_v1`,
          "u"
        )
      );
    }
    const readBody = sql.slice(
      sql.indexOf(
        "create or replace function public.read_agent_sales_truth_as_system"
      ),
      sql.indexOf(
        "revoke all on function public.read_agent_sales_truth_as_system"
      )
    );
    expect(readBody).not.toMatch(/\b(?:insert|update|delete|merge|notify)\b/iu);
  });
});
