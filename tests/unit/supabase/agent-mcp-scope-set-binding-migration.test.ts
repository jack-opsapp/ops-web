import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_mcp_scope_set_binding.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  migrationNames[0] ?? "MISSING"
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-mcp-scope-set-binding-runtime.sql"
);
const BOUNDARIES_RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-mcp-scope-set-binding-boundaries-runtime.sql"
);

function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

const MIGRATION = read(MIGRATION_PATH);
const RUNTIME = read(RUNTIME_PATH);
const BOUNDARIES_RUNTIME = read(BOUNDARIES_RUNTIME_PATH);

const AFFECTED_SIGNATURES = [
  "private.agent_p2_artifact_evidence_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)",
  "private.agent_p2_artifact_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)",
  "private.agent_p2_availability_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)",
  "private.agent_p2_catalog_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)",
  "private.agent_p2_company_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,timestamp with time zone)",
  "private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)",
  "private.agent_p2_deck_design_geometry_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)",
  "private.agent_p2_expense_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text)",
  "private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)",
  "private.agent_p2_operational_overview_summary_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,jsonb,jsonb,integer,integer,integer)",
  "private.agent_p2_payment_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb)",
  "private.agent_p2_purchase_order_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)",
  "private.agent_p2_sales_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[])",
  "private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)",
  "private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)",
  "private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)",
  "private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)",
  "private.agent_p2_team_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)",
  "private.agent_p2_work_queue_read_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)",
  "public.redeem_agent_mcp_evidence_as_system(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text[],text,text[],text[],jsonb,text,uuid,text,text,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone)",
] as const;

describe("P2 MCP scope-set binding repair", () => {
  it("ships one additive migration and a real PostgreSQL runtime proof", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^\d{14}_agent_mcp_scope_set_binding\.sql$/
    );
    expect(MIGRATION).not.toBe("");
    expect(RUNTIME).not.toBe("");
    expect(BOUNDARIES_RUNTIME).not.toBe("");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RUNTIME.trim().endsWith("rollback;")).toBe(true);
  });

  it("repairs exactly the 20 closed read boundaries", () => {
    expect(AFFECTED_SIGNATURES).toHaveLength(20);
    expect(new Set(AFFECTED_SIGNATURES).size).toBe(20);
    for (const signature of AFFECTED_SIGNATURES) {
      expect(MIGRATION, signature).toContain(`'${signature}'`);
    }
    expect(MIGRATION).toContain(
      "v_expected_function_count constant integer := 20"
    );
    expect(MIGRATION).toContain("agent_mcp_scope_set_binding_gate_count");
    expect(MIGRATION).toContain("v_pre_repair_sha256");
    expect(MIGRATION).toContain("v_repaired_sha256");
    expect(MIGRATION).toContain("agent_mcp_scope_set_binding_source_drift");
    expect(MIGRATION).toContain("extensions.digest(");
  });

  it("uses a private immutable set-equivalence primitive and preserves fail-closed mismatches", () => {
    expect(MIGRATION).toContain(
      "create or replace function private.agent_mcp_oauth_scope_sets_equal("
    );
    expect(MIGRATION).toContain("language sql");
    expect(MIGRATION).toContain("immutable");
    expect(MIGRATION).toContain("strict");
    expect(MIGRATION).toContain("parallel safe");
    expect(MIGRATION).toContain(
      "revoke all on function private.agent_mcp_oauth_scope_sets_equal(text[], text[])"
    );
    expect(RUNTIME).toContain(
      "array['ops.jobs.read', 'ops.company.read']::text[]"
    );
    expect(RUNTIME).toContain(
      "array['ops.company.read', 'ops.jobs.read']::text[]"
    );
    expect(RUNTIME).toContain("scope_member_mismatch_visible");
    expect(MIGRATION).toContain("procedure.proowner is distinct from");
    expect(MIGRATION).toContain("procedure.proconfig is distinct from");
  });

  it("re-executes every rewritten boundary after the repair", () => {
    for (const fixture of [
      "agent-customer-context-runtime.sql",
      "agent-task-reads-runtime.sql",
      "agent-artifact-reads-runtime.sql",
      "agent-site-visit-reads-runtime.sql",
      "agent-deck-design-geometry-runtime.sql",
      "agent-mcp-evidence-runtime.sql",
      "agent-sales-document-reads-runtime.sql",
      "agent-expense-reads-runtime.sql",
      "agent-company-context-runtime.sql",
      "agent-catalog-reads-runtime.sql",
      "agent-team-members-runtime.sql",
      "agent-team-availability-runtime.sql",
      "agent-payment-reads-runtime.sql",
      "agent-purchase-order-reads-runtime.sql",
      "agent-integration-health-runtime.sql",
      "agent-work-queue-reads-runtime.sql",
      "agent-operational-overview-runtime.sql",
    ]) {
      expect(BOUNDARIES_RUNTIME, fixture).toContain(`\\ir ${fixture}`);
    }
  });
});
