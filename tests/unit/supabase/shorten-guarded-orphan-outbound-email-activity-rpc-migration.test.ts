import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260723225112_shorten_guarded_orphan_outbound_email_activity_rpc.sql"
);
const migration = readFileSync(migrationPath, "utf8");
const canonicalName =
  "adopt_orphan_outbound_email_activity_guarded_as_system";

describe("short guarded outbound orphan adoption RPC migration", () => {
  it("renames the PostgreSQL-truncated function to a stable PostgREST name", () => {
    expect(canonicalName.length).toBeLessThanOrEqual(63);
    expect(migration).toMatch(
      /alter function public\.adopt_orphan_outbound_email_activity_with_payload_guard_as_system\([\s\S]*?\)\s+rename to adopt_orphan_outbound_email_activity_guarded_as_system;/
    );
  });

  it("keeps the renamed function service-role-only", () => {
    expect(migration).toMatch(
      /revoke all on function public\.adopt_orphan_outbound_email_activity_guarded_as_system\([\s\S]*?\) from public, anon, authenticated, service_role;/
    );
    expect(migration).toMatch(
      /grant execute on function public\.adopt_orphan_outbound_email_activity_guarded_as_system\([\s\S]*?\) to service_role;/
    );
  });

  it("preserves one transactional migration boundary without data writes", () => {
    expect(migration.match(/\bbegin;/gi)).toHaveLength(1);
    expect(migration.match(/\bcommit;/gi)).toHaveLength(1);
    expect(migration).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:activities|opportunities|projects|email_threads|ai_draft_history)\b/i
    );
  });
});
