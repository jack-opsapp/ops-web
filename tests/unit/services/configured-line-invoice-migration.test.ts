import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260724170600_preserve_configured_lines_on_invoices.sql",
  ),
  "utf8",
).toLowerCase();

describe("configured line invoice migration", () => {
  it("preserves the signed configuration and task snapshots on full conversion", () => {
    expect(sql).toContain("create or replace function public.convert_estimate_to_invoice");
    expect(sql).toContain("task_type_ref");
    expect(sql).toContain("unit_id");
    expect(sql).toContain("resolved_unit_price");
    expect(sql).toContain("minimum_charge_snapshot");
    expect(sql).toContain("configured_options");
    expect(sql).toContain("resolved_options_label");
  });

  it("prorates the minimum snapshot and treats stored tax as a decimal", () => {
    expect(sql).toContain(
      "round(v_li.minimum_charge_snapshot * (v_pct / 100.0), 2)",
    );
    expect(sql).toContain(
      "v_tax_amount := round(v_taxable_total * coalesce(v_estimate.tax_rate, 0), 2)",
    );
    expect(sql).not.toContain(
      "v_taxable_total * coalesce(v_estimate.tax_rate, 0) / 100.0",
    );
  });
});
