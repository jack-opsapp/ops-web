import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260606061000_qbo_sync_queue_fk_indexes.sql"),
  "utf8"
);

describe("QBO sync queue FK index migration", () => {
  it("is transaction-wrapped", () => {
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("adds covering indexes for queue and event foreign keys", () => {
    expect(sql).toContain("accounting_sync_queue_connection_idx");
    expect(sql).toContain("on public.accounting_sync_queue (connection_id)");
    expect(sql).toContain("accounting_sync_events_queue_idx");
    expect(sql).toContain("on public.accounting_sync_events (queue_id)");
    expect(sql).toContain("accounting_sync_events_connection_idx");
    expect(sql).toContain("on public.accounting_sync_events (connection_id)");
  });

  it("is idempotent and non-destructive", () => {
    expect(sql).toMatch(/create index if not exists/g);
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/\bdelete\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
  });
});
