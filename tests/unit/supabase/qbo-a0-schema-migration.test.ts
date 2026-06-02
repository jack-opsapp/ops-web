import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260602000000_qbo_readonly_sync_a0_schema.sql"
);

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("QBO read-only sync A0 schema migration", () => {
  it("is wrapped in a single transaction with a sentinel rollback guard", () => {
    const sql = migrationSql();
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    // Sentinel: verifies every new object exists before commit; raises (=> rollback) otherwise.
    expect(sql).toContain("qbo_a0_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("adds sync_direction as an additive, defaulted, checked column", () => {
    const sql = migrationSql();
    expect(sql).toContain("alter table public.accounting_connections");
    expect(sql).toContain("add column if not exists sync_direction text not null default 'pull_only'");
    expect(sql).toContain("check (sync_direction in ('pull_only', 'push_only', 'bidirectional'))");
  });

  it("creates the import-run + all six staging/match tables", () => {
    const sql = migrationSql();
    for (const table of [
      "public.qbo_import_runs",
      "public.qbo_staging_customers",
      "public.qbo_staging_estimates",
      "public.qbo_staging_invoices",
      "public.qbo_staging_line_items",
      "public.qbo_staging_payments",
      "public.qbo_customer_matches",
    ]) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }
  });

  it("constrains run status, match action/basis/confidence, and line-item parent type", () => {
    const sql = migrationSql();
    expect(sql).toContain("check (status in ('pending', 'pulling', 'staged', 'applying', 'applied', 'error'))");
    expect(sql).toContain("check (proposed_action in ('link', 'create', 'skip', 'needs_review'))");
    expect(sql).toContain("check (match_basis in ('email', 'name_exact', 'name_fuzzy', 'none'))");
    expect(sql).toContain("check (confidence in ('high', 'medium', 'low'))");
    expect(sql).toContain("check (parent_type in ('invoice', 'estimate'))");
  });

  it("uses run-scoped uniqueness and cascading run_id foreign keys", () => {
    const sql = migrationSql();
    expect(sql).toContain("references public.qbo_import_runs(id) on delete cascade");
    expect(sql).toContain("unique (run_id, qb_id)");
    expect(sql).toContain("unique (run_id, customer_qb_id)");
  });

  it("enables RLS with a company-scoped accounting.view SELECT policy on every new table", () => {
    const sql = migrationSql();
    for (const table of [
      "public.qbo_import_runs",
      "public.qbo_staging_customers",
      "public.qbo_staging_estimates",
      "public.qbo_staging_invoices",
      "public.qbo_staging_line_items",
      "public.qbo_staging_payments",
      "public.qbo_customer_matches",
    ]) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
    }
    expect(sql).toContain("public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')");
    expect(sql).toContain("company_id = (select private.get_user_company_id())");
    // Reads only — no broad authenticated write policy.
    expect(sql).not.toMatch(/for all\s+to authenticated/i);
    expect(sql).not.toMatch(/for insert/i);
  });

  it("enables pg_trgm and seeds the owner-only accounting feature-flag override without disturbing existing rows", () => {
    const sql = migrationSql();
    expect(sql).toContain("create extension if not exists pg_trgm");
    expect(sql).toContain("insert into public.feature_flag_overrides");
    expect(sql).toContain("'accounting'");
    expect(sql).toContain("'1746a0c1-be43-45d6-ab4d-584e82594b1b'");
    expect(sql).toContain("on conflict (flag_slug, user_id) do nothing");
  });
});
