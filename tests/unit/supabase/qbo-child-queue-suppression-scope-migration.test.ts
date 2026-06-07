import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607074000_qbo_child_queue_suppression_scope.sql"),
  "utf8"
);

describe("qbo child queue suppression scope migration", () => {
  it("keeps parent QuickBooks suppressions from swallowing child-row queue entries", () => {
    expect(sql).toContain("qbo_child_queue_suppression_scope_sentinel");
    expect(sql).toContain("if tg_table_name not in (''sub_clients'', ''line_items'') and exists");
  });

  it("keeps the enqueue trigger function locked to service_role", () => {
    expect(sql).toContain("revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.enqueue_accounting_sync() to service_role");
  });
});
