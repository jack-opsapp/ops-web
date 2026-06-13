import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260608010000_qbo_estimate_delete_operation.sql"),
  "utf8"
);

describe("qbo estimate delete operation migration", () => {
  it("extends queue/event operation checks to include delete", () => {
    expect(sql).toContain("qbo_estimate_delete_operation_sentinel");
    expect(sql).toContain("'delete'");
    expect(sql).toContain("operation in ('create', 'update', 'void', 'inactivate', 'delete_soft', 'delete', 'link', 'reconcile')");
  });

  it("changes estimate tombstones from void to delete while invoices remain void", () => {
    expect(sql).toContain("tg_table_name = ''estimates''");
    expect(sql).toContain("then ''delete''");
    expect(sql).toContain("tg_table_name = ''invoices''");
    expect(sql).toContain("then ''void''");
  });

  it("keeps delete/void propagation behind propagate_deletes", () => {
    expect(sql).toContain("v_operation in (''inactivate'', ''void'', ''delete'')");
    expect(sql).toContain("delete is not gated by propagate_deletes");
  });
});
