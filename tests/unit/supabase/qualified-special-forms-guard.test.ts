import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

/**
 * COALESCE / NULLIF / GREATEST / LEAST are SQL parser special forms, not
 * pg_catalog functions. Schema-qualifying them compiles at CREATE FUNCTION
 * time but raises 42883 ("function pg_catalog.coalesce(...) does not exist")
 * at runtime (bug f5ee8dc5 — the weekly financial digest, and the
 * /api/settings/invoice write path via merge_company_invoice_settings).
 *
 * The two historical files that introduced the defect stay byte-frozen
 * (migrations are append-only); the forward repair lives in
 * 20260901120000_fix_qualified_special_forms_financial_functions.sql.
 */
const FROZEN_DEFECTIVE_MIGRATIONS = new Set([
  "20260813170000_add_company_automation_settings.sql",
  "20260813173000_atomic_financial_analysis_memories.sql",
]);

const QUALIFIED_SPECIAL_FORM = /pg_catalog\s*\.\s*(coalesce|nullif|greatest|least)\s*\(/i;

describe("qualified SQL special forms guard", () => {
  it("no migration outside the frozen pair schema-qualifies a special form", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith(".sql") || FROZEN_DEFECTIVE_MIGRATIONS.has(file)) continue;
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      if (QUALIFIED_SPECIAL_FORM.test(sql)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the forward repair migration replaces both functions without qualified special forms", () => {
    const sql = readFileSync(
      resolve(
        MIGRATIONS_DIR,
        "20260901120000_fix_qualified_special_forms_financial_functions.sql"
      ),
      "utf8"
    );
    const lower = sql.toLowerCase();
    expect(lower).toContain("create or replace function public.replace_financial_analysis_memories");
    expect(lower).toContain("create or replace function public.merge_company_invoice_settings");
    expect(lower).toContain("security definer");
    expect(lower).toContain("service role required");
    expect(lower).toContain("for update");
    expect(lower).not.toMatch(QUALIFIED_SPECIAL_FORM);
    // The real pg_catalog functions keep their qualification.
    expect(lower).toContain("pg_catalog.btrim");
    expect(lower).toContain("pg_catalog.jsonb_typeof");
  });
});
