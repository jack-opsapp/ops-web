// tests/unit/supabase/qbo-company-subclient-migration.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260603100000_qbo_company_subclient_mapping.sql"
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("qbo company/sub-client mapping migration", () => {
  it("wraps the whole body in a transaction", () => {
    const sql = migrationSql();
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("adds the five staging columns additively (IF NOT EXISTS, nullable)", () => {
    const sql = migrationSql();
    for (const col of ["company_name", "contact_name", "contact_title", "parent_qb_id", "is_job"]) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${col}\\b`, "i"));
      // Each ADD COLUMN line must not carry a NOT NULL constraint.
      const addColLine = sql.match(new RegExp(`add column if not exists ${col}[^\n,;]+`, "i"))?.[0] ?? "";
      expect(addColLine).not.toMatch(/not null/i);
    }
  });

  it("adds sub_clients.qb_id and a partial unique conflict target", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/alter table public\.sub_clients\s+add column if not exists qb_id text/i);
    expect(sql).toMatch(/create unique index if not exists sub_clients_company_qb_id_uniq/i);
    expect(sql).toMatch(/on public\.sub_clients \(company_id, qb_id\)\s*where qb_id is not null/i);
  });

  it("ends with a named sentinel guard that re-verifies the objects", () => {
    const sql = migrationSql();
    // Sentinel block exists and raises on failure
    expect(sql).toContain("qbo_subclient_mapping_sentinel");
    expect(sql).toMatch(/raise exception/i);
    // Index guard must filter relkind = 'i' so only true indexes satisfy the check
    expect(sql).toMatch(/relkind\s*=\s*'i'/);
  });
});
