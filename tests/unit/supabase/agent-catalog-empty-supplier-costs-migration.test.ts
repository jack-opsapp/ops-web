import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_empty_supplier_costs.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));

function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

const MIGRATION = read(
  join(process.cwd(), "supabase/migrations", migrationNames[0] ?? "missing")
);
const BODY = read(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/catalog/sql/agent_catalog_reads.body.sql"
  )
);
const RUNTIME = read(
  join(
    process.cwd(),
    "tests/sql/agent-catalog-empty-supplier-costs-runtime.sql"
  )
);
const REPLAY = read(
  join(
    process.cwd(),
    "tests/sql/agent-catalog-empty-supplier-costs-replay-runtime.sql"
  )
);
const CATALOG_RUNTIME = read(
  join(process.cwd(), "tests/sql/agent-catalog-reads-runtime.sql")
);

describe("P2 catalogue empty supplier-cost repair", () => {
  it("ships one additive transactional migration with runtime and replay proof", () => {
    expect(migrationNames).toEqual([
      "20260830180000_agent_catalog_empty_supplier_costs.sql",
    ]);
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RUNTIME).toContain("agent_catalog_empty_supplier_costs_repaired");
    expect(REPLAY.trim().endsWith("rollback;")).toBe(true);
  });

  it("patches only the catalogue detail reader and fails on source drift", () => {
    expect(MIGRATION).toContain("agent_p2_catalog_detail_v1");
    expect(MIGRATION).not.toContain(
      "create or replace function private.agent_p2_catalog_read_context_v1"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_empty_supplier_costs_source_drift"
    );
    expect(MIGRATION).toContain(
      "8f0765db5ded1e534950a05d0e27bae77ef70f104a6ab5aa43b0974c79f9efd4"
    );
    expect(MIGRATION).toContain(
      "8cd62292b72bb7dab9baa3b4db1eac406127c85ee8e7e0d694ef834589d6019d"
    );
  });

  it("anchors zero-row aggregation and preserves the security identity", () => {
    for (const sql of [MIGRATION, BODY]) {
      expect(sql).toContain("count(projection.id)::integer");
      expect(sql).toContain("filter (where projection.id is not null)");
      expect(sql).toContain("from duplicate_state duplicate");
      expect(sql).toContain("left join cost_projection projection on true");
    }
    for (const field of [
      "procedure.proowner",
      "procedure.proacl",
      "procedure.proconfig",
      "procedure.prosecdef",
      "procedure.provolatile",
      "procedure.proparallel",
      "procedure.proargtypes",
    ]) {
      expect(MIGRATION).toContain(field);
    }
    for (const sql of [MIGRATION, REPLAY]) {
      expect(sql).toContain("where role.rolname = current_user");
      expect(sql).toContain("namespace.nspname = 'private'");
      expect(sql).toContain("language.lanname = 'plpgsql'");
      expect(sql).toContain("procedure.proowner = v_expected_owner");
      expect(sql).toContain("pg_catalog.aclexplode(");
      expect(sql).toContain("acl.grantee <> procedure.proowner");
      expect(sql).toContain(
        "agent_catalog_empty_supplier_costs_security_identity_drift"
      );
    }
  });

  it("proves the authorized empty result is an array with count zero", () => {
    expect(CATALOG_RUNTIME).toContain("$supplier_cost_empty_is_canonical$");
    expect(CATALOG_RUNTIME).toContain(
      "'{result,supplier_costs}' is distinct from '[]'::jsonb"
    );
    expect(CATALOG_RUNTIME).toContain(
      "'{source_inspected,supplier_costs}' <> '0'"
    );
    expect(CATALOG_RUNTIME).toContain(
      '\'["catalog", "supplier_costs"]\'::jsonb'
    );
  });
});
