import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260608011000_qbo_subclient_delete_updates_customer.sql"),
  "utf8"
);

describe("qbo sub-client delete updates customer migration", () => {
  it("keeps client tombstones as inactivate but makes sub-client tombstones update the parent customer", () => {
    expect(sql).toContain("qbo_subclient_delete_updates_customer_sentinel");
    expect(sql).toContain("tg_table_name = ''clients''");
    expect(sql).toContain("then ''inactivate''");
    expect(sql).toContain("tg_table_name = ''sub_clients''");
    expect(sql).toContain("then ''update''");
  });

  it("preserves sub-client queue ownership on parent client_id", () => {
    expect(sql).toContain("when ''sub_clients'' then nullif(v_row_json->>''client_id'', '''')::uuid");
  });
});
