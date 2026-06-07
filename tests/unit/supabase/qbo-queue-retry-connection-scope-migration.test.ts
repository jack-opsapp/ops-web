import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607173000_qbo_queue_retry_connection_scope.sql"),
  "utf8"
);

describe("qbo queue retry connection-scope migration", () => {
  it("patches stale-claim duplicate lookup by connection", () => {
    expect(sql).toContain("qbo_queue_retry_connection_scope_sentinel");
    expect(sql).toContain("pending.connection_id = v_stale.connection_id");
  });

  it("patches retry duplicate lookup by connection", () => {
    expect(sql).toContain("connection_id = v_row.connection_id");
    expect(sql).toContain("public.retry_accounting_sync_queue(uuid, text, text, timestamptz)");
  });

  it("keeps the queue RPC grants on service_role", () => {
    expect(sql).toContain("grant execute on function public.claim_accounting_sync_queue");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("grant execute on function public.retry_accounting_sync_queue");
  });
});
