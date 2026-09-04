import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

describe("supplier bill intake foreign-key indexes", () => {
  it("ships a covering index for every intake foreign key reported by the database advisor", () => {
    const migration = readdirSync(MIGRATIONS).find((file) =>
      file.endsWith("_supplier_bill_intake_fk_indexes.sql")
    );

    expect(migration).toBeDefined();
    if (!migration) return;

    const sql = readFileSync(join(MIGRATIONS, migration), "utf8")
      .replace(/\s+/g, " ")
      .toLowerCase();

    for (const index of [
      "supplier_bill_intake_allocations_line_intake_company_idx",
      "supplier_bill_intake_allocations_company_idx",
      "supplier_bill_intake_allocations_confirmed_by_idx",
      "supplier_bill_intake_checks_dispositioned_by_idx",
      "supplier_bill_intake_checks_intake_company_idx",
      "supplier_bill_intake_documents_intake_company_idx",
      "supplier_bill_intake_events_company_idx",
      "supplier_bill_intake_events_intake_company_idx",
      "supplier_bill_intake_lines_intake_company_idx",
      "supplier_bill_intake_lines_match_confirmed_by_idx",
      "supplier_bill_intakes_approved_by_idx",
      "supplier_bill_intakes_promoted_expense_idx",
      "supplier_bill_intakes_routed_to_payroll_by_idx",
    ]) {
      expect(sql).toContain(`create index if not exists ${index}`);
    }
  });
});
