import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260724210000_phase_c_catalog_onboarding_fk_indexes.sql",
  ),
  "utf8",
).toLowerCase();

describe("Phase C catalog onboarding foreign-key indexes", () => {
  it.each([
    ["catalog_inventory_import_rows", "committed_event_id"],
    ["catalog_inventory_import_rows", "committed_stock_unit_id"],
    ["catalog_inventory_import_rows", "matched_variant_id"],
    ["catalog_inventory_imports", "operator_id"],
    ["catalog_product_capability_bindings", "product_id"],
    ["catalog_setup_verification_items", "resolved_by"],
    ["catalog_supplier_cost_profiles", "catalog_variant_id"],
    ["product_material_quantity_rules", "product_material_id"],
  ])("covers %s(%s)", (table, column) => {
    expect(sql).toMatch(
      new RegExp(
        `create index if not exists [a-z0-9_]+\\s+on public\\.${table}\\(${column}\\)`,
      ),
    );
  });
});
