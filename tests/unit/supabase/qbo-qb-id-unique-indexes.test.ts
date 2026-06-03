import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260602200000_qbo_qb_id_unique_indexes.sql"
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("QBO qb_id unique-index migration", () => {
  it("is wrapped in a single transaction with a sentinel rollback guard", () => {
    const sql = migrationSql();
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    // Sentinel: verifies every new index exists before commit; raises (=> rollback) otherwise.
    expect(sql).toContain("qbo_qb_id_uniq_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("creates a partial unique conflict-target index on (company_id, qb_id) for each canonical table", () => {
    const sql = migrationSql();
    const normalized = sql.toLowerCase().replace(/\s+/g, " ");
    for (const table of ["clients", "estimates", "invoices", "payments"]) {
      expect(normalized).toContain(
        `create unique index if not exists ${table}_company_qb_id_uniq on public.${table} (company_id, qb_id) where qb_id is not null`
      );
    }
  });

  it("only adds indexes — no destructive or non-additive statements", () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/drop\s+index/i);
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/alter\s+table/i);
    // Repo convention: plain CREATE UNIQUE INDEX inside the txn, never CONCURRENTLY.
    expect(sql).not.toMatch(/create\s+(unique\s+)?index\s+concurrently/i);
  });
});
