import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260715165000_email_sensitive_table_privileges.sql"
  ),
  "utf8"
).toLowerCase();

describe("email sensitive table browser privileges migration", () => {
  it.each([
    "email_connections",
    "ai_draft_history",
    "pending_auto_sends",
    "email_attachments",
  ])("revokes every direct browser privilege on %s", (table) => {
    expect(sql).toContain(
      `revoke all on table public.${table} from anon, authenticated`
    );
  });

  it("preserves service-role access for authenticated server routes and workers", () => {
    for (const table of [
      "email_connections",
      "ai_draft_history",
      "pending_auto_sends",
      "email_attachments",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+select, insert, update, delete\\s+on table public\\.${table} to service_role`
        )
      );
    }
  });

  it("does not revoke email_threads because the iOS notification resolver still reads it directly", () => {
    expect(sql).not.toContain("revoke all on table public.email_threads");
  });
});
