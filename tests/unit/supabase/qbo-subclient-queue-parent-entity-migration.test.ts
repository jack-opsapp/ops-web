import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260607073000_qbo_subclient_queue_parent_entity.sql"),
  "utf8"
);

describe("qbo sub-client queue parent entity migration", () => {
  it("patches sub_clients to enqueue the parent client entity", () => {
    expect(sql).toContain("qbo_subclient_queue_parent_entity_sentinel");
    expect(sql).toContain("when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid");
  });

  it("preserves the changed contact row id in the queue payload", () => {
    expect(sql).toContain("''sourceRowId'', nullif(v_row_json->>''id'', '''')");
  });

  it("keeps the enqueue function locked to service_role", () => {
    expect(sql).toContain("revoke all on function public.enqueue_accounting_sync() from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.enqueue_accounting_sync() to service_role");
  });
});
