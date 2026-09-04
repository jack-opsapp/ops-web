import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260904060000_sage_reconciliation.sql"
  ),
  "utf8"
);
const sql = migration.toLowerCase().replace(/\s+/g, " ");

describe("Sage reconciliation migration", () => {
  it("selects all seven lanes fairly from exact readable connections", () => {
    expect(sql).toContain(
      "create or replace function public.list_sage_reconcile_candidates"
    );
    expect(sql).toContain(
      "partition by audited.connection_id, audited.entity_type"
    );
    expect(sql).toContain(
      "connection.sync_direction in ('pull_only', 'bidirectional')"
    );
    for (const entity of [
      "customer",
      "invoice",
      "estimate",
      "payment",
      "supplier",
      "supplier_bill",
      "supplier_bill_payment",
    ]) {
      expect(sql).toContain(`'${entity}'`);
    }
  });

  it("uses an atomic exact-identity apply boundary with full line handling", () => {
    expect(sql).toContain(
      "create or replace function public.apply_sage_reconcile_entity"
    );
    expect(sql).toContain("ops record changed after selection");
    expect(sql).toContain("jsonb_array_elements(p_payload->'lines')");
    expect(sql).toContain(
      "perform set_config('ops.sync_source', 'sage', true)"
    );
    expect(sql).toContain("sage customer link unavailable");
    expect(sql).toContain("ap provider identity changed");
  });

  it("adds exact purchase mappings and mutable payment clocks", () => {
    expect(sql).toContain("public.sage_purchase_account_mappings");
    expect(sql).toContain("add column if not exists updated_at");
    expect(sql).toContain("payments_accounting_sync_touch_updated_at");
    expect(sql).toContain(
      "supplier_bill_payments_accounting_sync_touch_updated_at"
    );
    expect(sql).toContain("'sage_won'");
  });

  it("is service-role-only and atomic", () => {
    expect(sql).toContain(
      "sage_reconciliation_sentinel: browser privilege leak"
    );
    expect(migration.trim().startsWith("begin;")).toBe(true);
    expect(migration.trim().endsWith("commit;")).toBe(true);
  });
});
