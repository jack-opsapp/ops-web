import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260729174500_preserve_referenced_staff_false_lead_client.sql"
);
const migrationExists = existsSync(migrationPath);
const source = migrationExists ? readFileSync(migrationPath, "utf8") : "";
const compact = source.toLowerCase().replace(/\s+/g, " ");

describe("referenced staff false-lead client preservation", () => {
  it("deletes the source client only when the schema-wide reference count is zero", () => {
    expect(migrationExists).toBe(true);
    expect(compact).toContain(
      "v_total_client_reference_count bigint := 0"
    );
    expect(compact).toContain(
      "v_total_client_reference_count := v_total_client_reference_count + v_reference_count"
    );
    expect(compact).toContain(
      "if v_total_client_reference_count = 0 then"
    );
    expect(compact).toContain("update public.clients client");
    expect(compact).toContain("set deleted_at = v_now");
    expect(compact).not.toContain("client_reference_remains:");
  });

  it("records whether the shared client was retained without changing the guarded repair scope", () => {
    expect(compact).toContain("v_source_client_deleted boolean := false");
    expect(compact).toContain(
      "'source_client_deleted', v_source_client_deleted"
    );
    expect(compact).toContain(
      "'source_client_reference_count', v_total_client_reference_count"
    );
    expect(compact).toContain(
      "create or replace function public.apply_staff_authored_false_lead_correction_guarded"
    );
    expect(compact).toContain("notification.company_id = p_company_id::text");
    expect(compact).toContain("coalesce(auth.role(), '') <> 'service_role'");
  });

  it("remains transactional and service-role only", () => {
    const executable = source.replace(/--[^\n]*/g, "").trim().toLowerCase();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(executable.endsWith("commit;")).toBe(true);
    expect(compact).toMatch(
      /revoke all on function public\.apply_staff_authored_false_lead_correction_guarded\(\s*uuid, uuid, text, text, text, text, jsonb\s*\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.apply_staff_authored_false_lead_correction_guarded\(\s*uuid, uuid, text, text, text, text, jsonb\s*\) to service_role/
    );
  });
});
