import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607070000_qbo_sync_queue_connection_scope.sql"),
  "utf8"
);

describe("QBO sync queue connection scope migration", () => {
  it("is transaction-wrapped and sentinel-guarded", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
    expect(sql).toContain("qbo_sync_queue_connection_scope_sentinel");
    expect(sql).toContain("raise exception");
  });

  it("rebuilds active queue uniqueness with connection_id in the conflict key", () => {
    expect(sql).toContain("drop index if exists public.accounting_sync_queue_active_uniq");
    expect(sql).toContain("create unique index if not exists accounting_sync_queue_active_uniq");
    expect(sql).toContain("on public.accounting_sync_queue (\n    company_id,\n    connection_id,");
    expect(sql).toContain(
      "on conflict (company_id, connection_id, provider, entity_type, entity_id, operation, idempotency_key)"
    );
    expect(sql).toContain("where status = 'pending'");
  });

  it("only enqueues against connected sync-enabled writable QuickBooks connections", () => {
    const connectionSelect = sql.slice(
      sql.indexOf("from public.accounting_connections"),
      sql.indexOf("order by updated_at desc nulls last")
    );
    expect(connectionSelect).toContain("and provider = 'quickbooks'");
    expect(connectionSelect).toContain("and is_connected = true");
    expect(connectionSelect).toContain("and sync_enabled = true");
    expect(connectionSelect).toContain("and sync_direction <> 'pull_only'");
  });
});
