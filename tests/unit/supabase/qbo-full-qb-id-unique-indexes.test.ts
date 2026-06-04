import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260604000000_qbo_full_qb_id_unique_indexes.sql"),
  "utf8",
);

const TABLES = ["clients", "sub_clients", "invoices", "estimates", "payments"];

describe("qbo full (company_id, qb_id) unique index migration", () => {
  it("is transaction-wrapped", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("drops the partial index and recreates a FULL (no WHERE) unique index per table", () => {
    for (const t of TABLES) {
      const idx = `${t}_company_qb_id_uniq`;
      expect(sql, `drop ${idx}`).toMatch(new RegExp(`drop index if exists public\\.${idx}`, "i"));
      // full unique index on (company_id, qb_id) with NO WHERE predicate
      const createRe = new RegExp(
        `create unique index ${idx}\\s+on public\\.${t} \\(company_id, qb_id\\)\\s*;`,
        "i",
      );
      expect(sql, `full create ${idx}`).toMatch(createRe);
    }
  });

  it("does NOT recreate any partial (WHERE qb_id IS NOT NULL) index", () => {
    // The whole point of the fix: no `create unique index ... where qb_id is not null`
    expect(sql).not.toMatch(/create unique index[\s\S]*?where\s+qb_id\s+is\s+not\s+null/i);
  });

  it("sentinel verifies the indexes are unique and NON-partial (indpred is null)", () => {
    expect(sql).toMatch(/i\.indisunique/i);
    expect(sql).toMatch(/i\.indpred is null/i);
    expect(sql).toMatch(/raise exception 'qbo_full_uniq_sentinel/i);
  });
});
