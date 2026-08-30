import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_mcp_scope_canonical_order.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  migrationNames[0] ?? "MISSING"
);

function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

const MIGRATION = read(MIGRATION_PATH);
const RUNTIME = read(
  join(process.cwd(), "tests/sql/agent-mcp-scope-canonical-order-runtime.sql")
);
const REPLAY = read(
  join(
    process.cwd(),
    "tests/sql/agent-mcp-scope-canonical-order-replay-runtime.sql"
  )
);
const BODY_PATHS = [
  "availability/sql/agent_team_availability_read.body.sql",
  "catalog/sql/agent_catalog_reads.body.sql",
  "company/sql/agent_company_context_read.body.sql",
  "deck-design/sql/agent_deck_design_geometry_read.body.sql",
  "expenses/sql/agent_expense_reads.body.sql",
  "integrations/sql/agent_integration_health_read.body.sql",
  "payments/sql/agent_payment_read.body.sql",
  "sales/sql/agent_sales_document_reads.body.sql",
  "site-visits/sql/agent_site_visit_reads.body.sql",
  "team/sql/agent_team_members_read.body.sql",
] as const;
const CANONICAL_BODIES = BODY_PATHS.map((path) =>
  read(join(process.cwd(), "src/lib/agent-control-plane/services/p2", path))
).join("\n");

const AFFECTED_FUNCTIONS = [
  "agent_p2_availability_summary_v1",
  "agent_p2_catalog_read_context_v1",
  "agent_p2_company_summary_v1",
  "read_agent_company_context_as_system",
  "agent_p2_customer_summary_v1",
  "read_agent_customer_context_as_system",
  "agent_p2_deck_design_geometry_v1",
  "agent_p2_expense_read_context_v1",
  "agent_p2_integration_health_summary_v1",
  "agent_p2_payment_read_context_v1",
  "agent_p2_sales_read_context_v1",
  "agent_p2_site_visit_context_v1",
  "agent_p2_site_visit_list_v1",
  "agent_p2_task_context_v1",
  "agent_p2_task_list_v1",
  "agent_p2_team_summary_v1",
] as const;

describe("P2 MCP scope canonical-order repair", () => {
  it("ships one additive, transactional migration with runtime and replay proofs", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^\d{14}_agent_mcp_scope_canonical_order\.sql$/
    );
    expect(MIGRATION).not.toBe("");
    expect(RUNTIME).not.toBe("");
    expect(REPLAY).not.toBe("");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RUNTIME.trim().endsWith("rollback;")).toBe(true);
    expect(REPLAY.trim().endsWith("rollback;")).toBe(true);
  });

  it("repairs exactly the 16 default-collation reader functions", () => {
    expect(AFFECTED_FUNCTIONS).toHaveLength(16);
    expect(new Set(AFFECTED_FUNCTIONS).size).toBe(16);
    for (const functionName of AFFECTED_FUNCTIONS) {
      expect(MIGRATION, functionName).toContain(functionName);
    }
    expect(MIGRATION).toContain(
      "v_expected_function_count constant integer := 16"
    );
    expect(MIGRATION).toContain("pre_repair_sha256");
    expect(MIGRATION).toContain("repaired_sha256");
    expect(MIGRATION).toContain("agent_mcp_scope_canonical_order_source_drift");
    expect(MIGRATION).toContain("extensions.digest(");
  });

  it("uses C ordering and preserves the complete function security identity", () => {
    expect(MIGRATION).toContain('order by scope.value collate "c"');
    expect(MIGRATION).toContain('order by granted.scope collate "c"');
    for (const field of [
      "procedure.oid",
      "procedure.proowner",
      "procedure.proacl",
      "procedure.proconfig",
      "procedure.prosecdef",
      "procedure.provolatile",
      "procedure.proparallel",
      "procedure.proargtypes",
    ]) {
      expect(MIGRATION, field).toContain(field);
    }
    expect(RUNTIME).toContain("ops.catalog.read");
    expect(RUNTIME).toContain("ops.catalog_costs.read");
    expect(RUNTIME).toContain("locale_order_visible");
  });

  it("keeps every canonical SQL body mirror on the repaired ordering", () => {
    expect(BODY_PATHS).toHaveLength(10);
    expect(
      CANONICAL_BODIES.match(/scope\.value order by scope\.value collate "c"/g)
    ).toHaveLength(11);
    expect(
      CANONICAL_BODIES.match(
        /granted\.scope order by granted\.scope collate "c"/g
      )
    ).toHaveLength(2);
    expect(CANONICAL_BODIES).not.toMatch(
      /scope\.value order by scope\.value\s*\)/
    );
    expect(CANONICAL_BODIES).not.toMatch(
      /granted\.scope order by granted\.scope\s*\)/
    );
  });
});
