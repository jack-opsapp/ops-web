import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260604010000_accounting_propagate_deletes.sql"),
  "utf8",
);

describe("accounting propagate_deletes migration", () => {
  it("is transaction-wrapped", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("adds propagate_deletes additively (IF NOT EXISTS, default false, NOT NULL)", () => {
    expect(sql).toMatch(/alter table public\.accounting_connections/i);
    expect(sql).toMatch(/add column if not exists propagate_deletes boolean not null default false/i);
  });

  it("has a sentinel that re-verifies the column", () => {
    expect(sql).toMatch(/do \$\$/i);
    expect(sql).toMatch(/raise exception 'accounting_propagate_deletes_sentinel/i);
  });
});
