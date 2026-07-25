import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260724171000_phase_c_catalog_commit_rpc.sql",
  ),
  "utf8",
).toLowerCase();

describe("Phase C catalog commit migration", () => {
  it("derives actor scope and locks the server-owned session plan", () => {
    expect(sql).toContain(
      "create or replace function public.catalog_guided_setup_begin_commit",
    );
    expect(sql).toContain("private.get_user_company_id()");
    expect(sql).toContain("public.has_permission");
    expect(sql).toContain("'catalog.run_setup'");
    expect(sql).toContain("for update");
    expect(sql).toContain("proposed_plan_hash");
    expect(sql).toContain("approval hash");
  });

  it("journals allowlisted server-stored actions with content hashes", () => {
    expect(sql).toMatch(
      /jsonb_array_elements\(\s*coalesce\(v_session\.proposed_plan/,
    );
    expect(sql).toContain("catalog_guided_setup_actions");
    expect(sql).toContain("action_hash");
    expect(sql).toContain("extensions.digest");
    expect(sql).toContain("unsupported action type");
  });

  it("accepts only session identity and approval identity, never a browser action plan", () => {
    expect(sql).toMatch(
      /catalog_guided_setup_begin_commit\s*\(\s*p_session_id uuid,\s*p_approval_hash text\s*\)/,
    );
    expect(sql).not.toMatch(/p_(plan|actions|payload)\s+jsonb/);
  });

  it("supports verified completion and recoverable attention", () => {
    expect(sql).toContain(
      "create or replace function public.catalog_guided_setup_finish_commit",
    );
    expect(sql).toContain("'complete'");
    expect(sql).toContain("'attention'");
    expect(sql).toContain("commit_journal");
    expect(sql).toContain("readback");
  });

  it("preflights every known variant reference before archive", () => {
    expect(sql).toContain(
      "create or replace function public.catalog_guided_setup_archive_variant",
    );
    for (const table of [
      "catalog_order_items",
      "catalog_snapshot_items",
      "catalog_stock_unit_events",
      "catalog_stock_units",
      "catalog_variant_option_values",
      "catalog_supplier_cost_profiles",
      "inventory_deductions",
      "line_item_materials",
      "product_materials",
      "project_material_demands",
      "project_material_snapshot_items",
      "task_material_allocations",
      "task_materials",
    ]) {
      expect(sql).toContain(`from public.${table}`);
    }
    expect(sql).toContain("'variant_has_references'");
  });
});
