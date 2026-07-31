import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260724172000_catalog_inventory_import_commit_rpc.sql",
  ),
  "utf8",
).toLowerCase();

describe("catalog inventory import commit migration", () => {
  it("derives company and operator authority server-side", () => {
    expect(sql).toContain("private.get_user_company_id()");
    expect(sql).toContain("public.has_permission");
    expect(sql).toContain("'catalog.run_setup'");
    expect(sql).toContain("'inventory.manage'");
    expect(sql).not.toMatch(/p_(rows|payload|company_id)\s/);
  });

  it("locks staged rows and writes physical units plus receive events", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("insert into public.catalog_stock_units");
    expect(sql).toContain("insert into public.catalog_stock_unit_events");
    expect(sql).toContain("'receive'");
    expect(sql).toContain("committed_stock_unit_id");
    expect(sql).toContain("committed_event_id");
    expect(sql).toContain("for v_unit_index in 1..v_unit_count");
    expect(sql).toContain("then 1");
  });

  it("mirrors roll area and non-dimensional quantities back to variants", () => {
    expect(sql).toContain("(stock.width_value / 12.0)");
    expect(sql).toContain("stock.remaining_length_value");
    expect(sql).toContain("stock.unit_kind = 'length'");
    expect(sql).toContain("else stock.quantity_value");
    expect(sql).toContain("update public.catalog_variants");
  });

  it("is replay-safe and returns an attention state on transaction failure", () => {
    expect(sql).toContain("if v_import.status = 'complete'");
    expect(sql).toContain("'replayed', true");
    expect(sql).toContain("(v_import.summary ->> 'committed')::integer");
    expect(sql).toContain("when others then");
    expect(sql).toContain("'attention'");
  });
});
