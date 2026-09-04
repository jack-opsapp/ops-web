import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730213000_external_api_rate_limits.sql"
  ),
  "utf8"
);

describe("external API rate limit migration", () => {
  it("stores only bounded private fixed windows and denies direct table access", () => {
    expect(sql).toContain(
      "create table private.external_api_rate_limit_windows"
    );
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table");
    expect(sql).toContain("identity_digest");
    expect(sql).not.toContain("raw_ip");
    expect(sql).not.toContain("credential_secret");
  });

  it("uses the database clock and an atomic upsert for approved policy scopes", () => {
    expect(sql).toContain(
      "consume_external_api_rate_limits_as_system"
    );
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("on conflict");
    expect(sql).toContain("request_count + 1");
    expect(sql).toContain("'preauth_network'");
    expect(sql).toContain("'preauth_prefix'");
    expect(sql).toContain("'principal_intake'");
    expect(sql).toContain("'principal_analytics'");
    expect(sql).toContain("'company'");
    expect(sql).toContain("external_api_rate_limit_scope_invalid");
  });

  it("requires service role and provides only bounded expired-window cleanup", () => {
    expect(sql).toContain("private.require_external_api_service_role()");
    expect(sql).toContain(
      "purge_external_api_rate_limit_windows_as_system"
    );
    expect(sql).toContain("least(p_limit, 5000)");
    expect(sql).toContain("grant execute on function");
    expect(sql).toContain("to service_role");
  });
});
