import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260615190000_qbo_suppress_child_table_echoes.sql"),
  "utf8"
);

describe("qbo suppress child-table echoes migration", () => {
  it("removes the sub_clients/line_items exclusion from the suppression check", () => {
    // The buggy guard skipped suppression for child tables; the migration
    // replaces it with an unconditional suppression check.
    expect(sql).toContain("if tg_table_name not in (''sub_clients'', ''line_items'') and exists (");
    expect(sql).toContain("'if exists ('");
  });

  it("self-verifies via sentinel that child tables are no longer excluded", () => {
    expect(sql).toContain("qbo_suppress_child_table_echoes_sentinel");
    expect(sql).toContain("child-table suppression skip still present");
    expect(sql).toContain("from public.accounting_sync_suppressions s");
  });

  it("preserves sub-client parent-id resolution (suppression keys on parent client_id)", () => {
    expect(sql).toContain("when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid");
  });

  it("relocks the trigger function to service_role only", () => {
    expect(sql).toContain("revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.enqueue_accounting_sync() to service_role");
  });
});
