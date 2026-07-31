import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260729173000_fix_staff_false_lead_notification_company_cast.sql"
);
const migrationExists = existsSync(migrationPath);
const source = migrationExists ? readFileSync(migrationPath, "utf8") : "";
const compact = source.toLowerCase().replace(/\s+/g, " ");

describe("staff false-lead notification company cast", () => {
  it("uses the live text notification tenant key for every guarded read and write", () => {
    expect(migrationExists).toBe(true);
    const matches =
      compact.match(/notification\.company_id = p_company_id::text/g) ?? [];
    expect(matches).toHaveLength(3);
    expect(compact).not.toMatch(
      /notification\.company_id = p_company_id(?!::text)/
    );
    expect(compact).toContain(
      "create or replace function public.apply_staff_authored_false_lead_correction_guarded"
    );
  });

  it("preserves the service-only boundary and transactional replacement", () => {
    const executable = source.replace(/--[^\n]*/g, "").trim().toLowerCase();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(executable.endsWith("commit;")).toBe(true);
    expect(compact).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(compact).toMatch(
      /revoke all on function public\.apply_staff_authored_false_lead_correction_guarded\(\s*uuid, uuid, text, text, text, text, jsonb\s*\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.apply_staff_authored_false_lead_correction_guarded\(\s*uuid, uuid, text, text, text, text, jsonb\s*\) to service_role/
    );
  });
});
