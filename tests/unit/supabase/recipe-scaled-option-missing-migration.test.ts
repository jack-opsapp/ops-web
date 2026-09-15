import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_recipe_scaled_option_missing_zero.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));

function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

const MIGRATION = read(
  join(process.cwd(), "supabase/migrations", migrationNames[0] ?? "missing")
);
const RUNTIME = read(
  join(process.cwd(), "supabase/tests/recipe_scaled_option_missing.sql")
);

/** The per-material loop body, from the variant-unresolved `continue` to the stock lookup. */
function scaledBlock(sql: string) {
  const start = sql.indexOf("recipe_material_variant_unresolved");
  const end = sql.indexOf(
    "v_available := private.catalog_variant_available_stock_summary",
    start
  );
  return start >= 0 && end > start ? sql.slice(start, end) : "";
}

describe("scaled recipe line with a missing option count", () => {
  it("ships one transactional migration that replaces only the demand resolver", () => {
    expect(migrationNames).toEqual([
      "20260915220000_recipe_scaled_option_missing_zero.sql",
    ]);
    expect(MIGRATION.trim().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("begin;");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(
      MIGRATION.match(/create or replace function/g) ?? []
    ).toHaveLength(1);
    expect(MIGRATION).toContain(
      "create or replace function private.resolve_estimate_material_demand_plan(p_estimate_id uuid, p_project_id uuid default null::uuid)"
    );
  });

  it("refuses to install over a drifted resolver and proves the installed body", () => {
    expect(MIGRATION).toContain("9cfa431e79c4df4e7aeed00d3c9ccd87");
    expect(MIGRATION).toContain("recipe_scaled_option_missing_source_drift");
    expect(MIGRATION).toContain("recipe_scaled_option_missing_install_drift");
  });

  it("declares the scaled-value working variables", () => {
    expect(MIGRATION).toContain("v_scaled_raw jsonb;");
    expect(MIGRATION).toContain("v_scaled_value numeric;");
    expect(MIGRATION).toContain("v_scaled_warning jsonb;");
  });

  it("zeroes the scaled line and warns when the option value is missing or not numeric", () => {
    const block = scaledBlock(MIGRATION);
    expect(block).not.toBe("");

    expect(block).toContain("if v_material.scaled_by_option_id is not null then");
    expect(block).toContain(
      "v_scaled_raw := v_line.configured_options -> v_material.scaled_by_option_id::text;"
    );
    expect(block).toContain("when jsonb_typeof(v_scaled_raw) = 'number'");
    expect(block).toContain("^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$");

    const missing = block.slice(
      block.indexOf("if v_scaled_value is null then"),
      block.indexOf("else", block.indexOf("if v_scaled_value is null then"))
    );
    expect(missing).toContain("v_required_quantity := 0;");
    expect(missing).toContain("'code', 'scaled_option_value_missing'");
    expect(missing).toContain("'product_option_id', v_material.scaled_by_option_id");
    expect(missing).toContain("v_warnings := v_warnings || jsonb_build_array(v_scaled_warning);");
    expect(missing).toContain(
      "v_material_warning_payload := v_material_warning_payload || jsonb_build_array(v_scaled_warning);"
    );
  });

  it("never falls back to quantity_per_unit x line quantity on a scaled line", () => {
    const block = scaledBlock(MIGRATION);
    const lineQuantityProducts = block.match(
      /\* greatest\(coalesce\(v_line\.line_quantity, 0\), 0\)/g
    ) ?? [];
    // Exactly one line-quantity product, and it lives in the unscaled else branch.
    expect(lineQuantityProducts).toHaveLength(1);
    const scaledIf = block.indexOf("if v_material.scaled_by_option_id is not null then");
    const lineQuantityAt = block.indexOf("greatest(coalesce(v_line.line_quantity, 0), 0)");
    const unscaledElse = block.lastIndexOf("else", lineQuantityAt);
    expect(scaledIf).toBeGreaterThanOrEqual(0);
    expect(lineQuantityAt).toBeGreaterThan(unscaledElse);
    expect(unscaledElse).toBeGreaterThan(block.indexOf("greatest(v_scaled_value, 0)"));
    // The old unconditional default before the scaled check is gone.
    expect(block).not.toMatch(
      /v_required_quantity := greatest\(coalesce\(v_material\.quantity_per_unit, 0\), 0\)\s*\* greatest\(coalesce\(v_line\.line_quantity, 0\), 0\);\s*if v_material\.scaled_by_option_id is not null\s+and/
    );
  });

  it("carries a rollback-only runtime proof for every configured-value case", () => {
    expect(RUNTIME.trim().endsWith("rollback;")).toBe(true);
    expect(RUNTIME).toContain("private.resolve_estimate_material_demand_plan");
    expect(RUNTIME).toContain("scaled_option_value_missing");
    expect(RUNTIME).toContain("request.jwt.claims");
  });
});
