import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260813173000_atomic_financial_analysis_memories.sql"
  ),
  "utf8"
).toLowerCase();

describe("atomic financial analysis memory replacement migration", () => {
  it("replaces the complete projection inside one service-only statement", () => {
    expect(sql).toContain("replace_financial_analysis_memories");
    expect(sql).toContain("security definer");
    expect(sql).toContain("service role required");
    expect(sql).toContain("for update");
    expect(sql).toContain("delete from public.agent_memories");
    expect(sql).toContain("insert into public.agent_memories");
    expect(sql).toContain("memory.source = 'financial_analysis'");
    expect(sql).toContain("grant execute on function");
  });
});
