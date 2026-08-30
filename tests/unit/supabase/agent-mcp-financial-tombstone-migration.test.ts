import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_mcp_financial_tombstones.sql";
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
  join(process.cwd(), "tests/sql/agent-mcp-financial-tombstone-runtime.sql")
);
const REPLAY = read(
  join(
    process.cwd(),
    "tests/sql/agent-mcp-financial-tombstone-replay-runtime.sql"
  )
);
const PAYMENT_BODY = read(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/payments/sql/agent_payment_read.body.sql"
  )
);
const SALES_BODY = read(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/sales/sql/agent_sales_document_reads.body.sql"
  )
);

describe("P2 MCP financial tombstone repair", () => {
  it("ships one additive transactional migration with runtime and replay proofs", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^\d{14}_agent_mcp_financial_tombstones\.sql$/
    );
    expect(MIGRATION).not.toBe("");
    expect(RUNTIME).not.toBe("");
    expect(REPLAY).not.toBe("");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RUNTIME.trim().endsWith("rollback;")).toBe(true);
    expect(REPLAY.trim().endsWith("rollback;")).toBe(true);
  });

  it("rewrites only the two sealed current financial source functions", () => {
    for (const functionName of [
      "agent_p2_sales_document_header_source_v1",
      "agent_p2_payment_source_v1",
    ]) {
      expect(MIGRATION, functionName).toContain(functionName);
    }
    for (const hash of [
      "56103a36fd0382172856521b4b109a09757de71bfb4ed65dc4c4fca5ca9884e1",
      "2df0fad50f58bd3a803703a46058f7474a7bdbdc148fd50d2350366b65b6ad05",
      "3ba40f78d0448acd44482132bdfc15c2bd4c56eb10247a2722c5eda8c7559ac3",
      "7cb67a5c9e5e4bcebd396283aeff28c50e2659c511e1035e9c235f69526dfa71",
    ]) {
      expect(MIGRATION, hash).toContain(hash);
    }
    expect(MIGRATION).toContain("agent_mcp_financial_tombstone_source_drift");
    expect(MIGRATION).toContain("is distinct from 2::bigint");
    expect(MIGRATION).toContain("is distinct from 3::bigint");
  });

  it("omits only same-company tombstones before bounds and preserves fail-closed checks", () => {
    expect(MIGRATION).toContain("parent_client.company_id = p_company_id");
    expect(MIGRATION).toContain("parent_client.deleted_at is not null");
    expect(MIGRATION).toMatch(
      /parent_client\.deleted_at is not null\s+and parent_client\.merged_into_client_id is null/
    );
    expect(MIGRATION).toContain(
      "parent_client.merged_into_client_id is not null"
    );
    expect(MIGRATION).toMatch(
      /merge_target\.id\s*=\s*parent_client\.merged_into_client_id/
    );
    expect(MIGRATION).toContain(
      "merge_target.id is distinct from parent_client.id"
    );
    expect(MIGRATION).toContain("merge_target.company_id = p_company_id");
    expect(MIGRATION).toContain("merge_target.deleted_at is null");
    expect(MIGRATION).toContain("merge_target.merged_into_client_id is null");
    expect(MIGRATION).toContain("estimate.client_ref = estimate.client_id");
    expect(MIGRATION).toContain("invoice.client_ref = invoice.client_id");
    expect(MIGRATION).toContain("parent_invoice.company_id = p_company_id");
    expect(MIGRATION).toContain("parent_invoice.deleted_at is not null");
    expect(MIGRATION).toMatch(
      /coalesce\(\s*parent_invoice\.client_ref,\s*parent_invoice\.client_id\s*\)\s*=\s*source\.client_id/
    );
    expect(MIGRATION).toContain(
      "parent_invoice.client_ref = parent_invoice.client_id"
    );
    expect(MIGRATION).toContain("parent_client.id = source.client_id");
    expect(MIGRATION).toContain("parent_client.merged_into_client_id is null");
    expect(RUNTIME).toContain("v_foreign_invalid is distinct from true");
    expect(RUNTIME).toContain(
      "v_deleted_foreign_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_missing_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_self_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_invalid_target_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_chained_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_plain_deleted_client_header_count is distinct from 0"
    );
    expect(RUNTIME).toContain("v_valid_merge_header_count is distinct from 0");
    expect(RUNTIME).toContain(
      "v_deleted_invoice_dual_ref_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_invoice_mismatch_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_invoice_foreign_client_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_invoice_foreign_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_invoice_missing_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_invoice_self_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_invoice_deleted_target_invalid is distinct from true"
    );
    expect(RUNTIME).toContain(
      "v_deleted_invoice_chained_merge_invalid is distinct from true"
    );
    expect(RUNTIME).toContain("sales_bound");
    expect(RUNTIME).toContain("sales_invoice_bound");
    expect(RUNTIME).toContain("payment_bound");
  });

  it("preserves the complete function security and catalogue identity", () => {
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
      expect(REPLAY, field).toContain(field);
    }
    expect(MIGRATION).toContain("not pg_catalog.has_function_privilege");
  });

  it("keeps the canonical financial SQL bodies on the tombstone repair", () => {
    expect(
      SALES_BODY.match(/from public\.clients parent_client/g)
    ).toHaveLength(2);
    expect(SALES_BODY).toContain(
      "merge_target.id is distinct from parent_client.id"
    );
    expect(SALES_BODY).toContain("merge_target.merged_into_client_id is null");
    expect(SALES_BODY).toContain("estimate.client_ref = estimate.client_id");
    expect(SALES_BODY).toContain("invoice.client_ref = invoice.client_id");
    expect(PAYMENT_BODY).toContain("from public.invoices parent_invoice");
    expect(PAYMENT_BODY).toContain("parent_invoice.company_id = p_company_id");
    expect(PAYMENT_BODY).toContain("parent_invoice.deleted_at is not null");
    expect(PAYMENT_BODY).toMatch(
      /coalesce\(\s*parent_invoice\.client_ref,\s*parent_invoice\.client_id\s*\)\s*=\s*source\.client_id/
    );
    expect(PAYMENT_BODY).toContain(
      "parent_invoice.client_ref = parent_invoice.client_id"
    );
  });
});
