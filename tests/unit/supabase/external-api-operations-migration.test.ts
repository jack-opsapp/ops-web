import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727103500_external_api_operations.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("external API operations migration", () => {
  it("installs one service-role-only maintenance command with bounded health", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(source).toContain(
      "create or replace function public.maintain_external_api_operations_as_system"
    );
    expect(source).toMatch(/p_limit is null[\s\S]*between 1 and 500/);
    expect(source).toContain("private.require_external_api_service_role()");
    expect(source).toContain("'missing_idempotency_kids'");
    expect(source).toContain("'health'");
    expect(source).toMatch(
      /revoke all on function public\.maintain_external_api_operations_as_system[\s\S]*from public, anon, authenticated/
    );
    expect(source).toMatch(
      /grant execute on function public\.maintain_external_api_operations_as_system[\s\S]*to service_role/
    );
  });

  it("checks every retained idempotency ledger before retiring or deleting evidence", () => {
    expect(source).toContain("private.external_intake_upload_batches");
    expect(source).toContain(
      "private.external_intake_submission_replay_digests"
    );
    expect(source).toContain("external_api_idempotency_key_missing");
    expect(source.indexOf("external_api_idempotency_key_missing")).toBeLessThan(
      source.indexOf("set status = 'retired'")
    );
  });

  it("keeps network evidence short-lived without deleting its parent audit row", () => {
    expect(source).toContain(
      "public.purge_external_api_network_fingerprints_as_system"
    );
    expect(source).toMatch(
      /purge_external_api_network_fingerprints_as_system\(\s*v_now\s*\)/
    );
    expect(source).not.toMatch(
      /delete from private\.external_api_request_audit/
    );
    expect(source).toContain("interval '30 days'");
  });

  it("records content-free denials and unsafe uploads for durable owner alerts", () => {
    expect(source).toContain(
      "record_external_api_authorization_denial_as_system"
    );
    expect(source).toContain("'source_denied'");
    expect(source).toContain("'hostile_upload'");
    expect(source).toContain("'external_api_security'");
    expect(source).toContain("'/settings?section=website'");
    expect(source).toContain("'review connection'");
    expect(source).toMatch(
      /create unique index[\s\S]*notifications_external_api_security_dedupe/
    );
    expect(source).not.toMatch(
      /original_contact|original_work|ordered_answers|filename|storage_object_key/
    );
  });
});
