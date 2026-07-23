import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260723084000_harden_orphan_email_activity_replay_evidence.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compact = source.replace(/\s+/g, " ");

describe("orphan email-activity replay evidence hardening", () => {
  it("locks the exact activity before comparing every caller-supplied event field", () => {
    expect(compact).toContain(
      "create or replace function public.adopt_orphan_email_activity_with_payload_guard_as_system"
    );
    expect(compact).toMatch(
      /from public\.activities activity[\s\S]*?for update/
    );
    for (const comparison of [
      "v_activity.created_at is distinct from p_occurred_at",
      "v_activity.subject is distinct from p_subject",
      "pg_catalog.lower(pg_catalog.btrim(v_activity.from_email)) is distinct from pg_catalog.lower(pg_catalog.btrim(p_from_email))",
      "coalesce(v_activity.to_emails, '{}'::text[]) is distinct from coalesce(p_to_emails, '{}'::text[])",
      "coalesce(v_activity.cc_emails, '{}'::text[]) is distinct from coalesce(p_cc_emails, '{}'::text[])",
      "v_activity.content is distinct from p_content",
      "v_activity.body_text is distinct from p_body_text",
      "v_activity.body_text_clean is distinct from p_body_text_clean",
      "coalesce(v_activity.has_attachments, false) is true",
      "coalesce(v_activity.attachment_count, 0) <> 0",
    ]) {
      expect(compact).toContain(comparison);
    }
    expect(compact).toContain("orphan_email_activity_payload_changed");
    expect(compact).not.toContain("pg_catalog.coalesce");
  });

  it("preserves the service-only lease and delegates the CAS to the canonical guarded RPC", () => {
    const executable = source.replace(/--[^\n]*/g, "").trim();
    expect(executable.startsWith("begin;")).toBe(true);
    expect(source.trim().endsWith("commit;")).toBe(true);
    expect(compact).toContain("security definer set search_path = ''");
    expect(compact).toContain("auth.role() is distinct from 'service_role'");
    expect(compact).toContain(
      "from private.email_provider_mailbox_sync_leases lease"
    );
    expect(compact).toContain(
      "v_result := public.adopt_orphan_email_activity_as_system("
    );
    expect(compact).toMatch(
      /revoke all on function public\.adopt_orphan_email_activity_with_payload_guard_as_system\([\s\S]*?\) from public, anon, authenticated, service_role/
    );
    expect(compact).toMatch(
      /grant execute on function public\.adopt_orphan_email_activity_with_payload_guard_as_system\([\s\S]*?\) to service_role/
    );
  });
});
