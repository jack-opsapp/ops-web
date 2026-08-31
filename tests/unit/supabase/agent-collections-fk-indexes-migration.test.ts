import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260831220500_agent_collections_fk_indexes.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("agent collections foreign-key indexes", () => {
  it("covers every composite foreign key reported by the database linter", () => {
    expect(sql).toContain(
      "on private.agent_collections_change_sets (company_id, run_id)"
    );
    expect(sql).toContain(
      "on private.agent_collections_receipts (company_id, change_set_id)"
    );
    expect(sql).toContain(
      "on private.agent_collections_receipts (company_id, run_id)"
    );
  });

  it("is retry-safe and additive", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql.match(/create index if not exists/g)).toHaveLength(3);
    expect(sql).not.toMatch(/\b(drop|delete|truncate)\b/);
  });
});
