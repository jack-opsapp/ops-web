import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260603000000_qbo_realm_lookup.sql"
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("QBO realm-lookup migration", () => {
  it("is wrapped in a single transaction with a sentinel rollback guard", () => {
    const sql = migrationSql();
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    // Sentinel: verifies the column + index exist before commit; raises (=> rollback) otherwise.
    expect(sql).toContain("qbo_realm_lookup_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("adds the realm_id_lookup column (idempotently) to accounting_connections", () => {
    const sql = migrationSql().toLowerCase().replace(/\s+/g, " ");
    expect(sql).toContain(
      "alter table public.accounting_connections add column if not exists realm_id_lookup text"
    );
  });

  it("creates the routing index on realm_id_lookup (idempotently)", () => {
    const sql = migrationSql().toLowerCase().replace(/\s+/g, " ");
    expect(sql).toContain(
      "create index if not exists idx_accounting_connections_realm_lookup on public.accounting_connections (realm_id_lookup)"
    );
  });

  it("only adds a column + index — no destructive or non-additive statements", () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/drop\s+index/i);
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/drop\s+column/i);
    // ADD COLUMN is the only ALTER TABLE allowed (no rename / retype / drop).
    expect(sql).not.toMatch(/alter\s+table[^;]*\b(rename|drop|alter\s+column)\b/i);
    // Repo convention: plain CREATE INDEX inside the txn, never CONCURRENTLY.
    expect(sql).not.toMatch(/create\s+(unique\s+)?index\s+concurrently/i);
  });
});
