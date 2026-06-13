import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260608012000_qbo_single_writable_connection.sql"),
  "utf8"
);

describe("qbo single writable connection migration", () => {
  it("adds a company/provider partial unique index for connected writable QuickBooks rows", () => {
    expect(sql).toContain("accounting_connections_one_qbo_writable_per_company");
    expect(sql).toContain("on public.accounting_connections (company_id, provider)");
    expect(sql).toContain("provider = 'quickbooks'");
    expect(sql).toContain("is_connected = true");
    expect(sql).toContain("sync_enabled = true");
    expect(sql).toContain("sync_direction <> 'pull_only'");
  });

  it("has a sentinel that verifies the partial predicate", () => {
    expect(sql).toContain("qbo_single_writable_connection_sentinel");
    expect(sql).toContain("raise exception");
  });
});
