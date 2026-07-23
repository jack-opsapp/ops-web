import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260723083000_fix_exact_recovery_notification_company_cast.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = source.replace(/\s+/g, " ");

describe("exact recovery notification company cast repair", () => {
  it("replaces only the lifecycle recomputability guard with the legacy text cast", () => {
    expect(compact).toContain(
      "create or replace function private.assert_exact_message_lifecycle_recomputable"
    );
    expect(compact).toContain("notification.company_id = p_company_id::text");
    expect(compact).not.toMatch(
      /notification\.company_id\s*=\s*p_company_id(?:\s|$)/
    );
    expect(compact).toContain("state.company_id = p_company_id");
    expect(compact).toContain("draft.company_id = p_company_id");
    expect(compact).toContain("action.company_id = p_company_id");
  });

  it("is transactional, pinned, private, and forces PostgreSQL to plan the repaired predicate", () => {
    const executable = source.replace(/--[^\n]*/g, "").trim();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(source.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain("security definer");
    expect(compact).toContain(
      "set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'"
    );
    expect(compact).toMatch(
      /revoke all on function private\.assert_exact_message_lifecycle_recomputable\(\s*uuid, uuid\s*\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /perform private\.assert_exact_message_lifecycle_recomputable\(\s*gen_random_uuid\(\),\s*gen_random_uuid\(\)\s*\)/
    );
  });
});
