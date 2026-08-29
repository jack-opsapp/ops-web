import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_mcp_evidence_nonce_ledger.sql";

function sql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory).filter((name) =>
    name.endsWith(SUFFIX)
  );
  expect(matches).toHaveLength(1);
  return readFileSync(join(directory, matches[0]!), "utf8")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("MCP evidence nonce ledger migration", () => {
  it("creates only a private digest ledger and bounded private cleanup helper", () => {
    const source = sql();
    expect(source).toContain(
      "create table if not exists private.agent_mcp_evidence_redemptions"
    );
    for (const column of [
      "nonce_digest bytea not null",
      "authority_binding_digest bytea not null",
      "source_revision_digest bytea not null",
      "issued_at timestamptz not null",
      "expires_at timestamptz not null",
      "redeemed_at timestamptz not null",
      "outcome_code text not null",
    ]) {
      expect(source).toContain(column);
    }
    expect(source).toMatch(/primary key\s*\(\s*nonce_digest\s*\)/);
    expect(source).toMatch(/octet_length\(nonce_digest\) = 32/);
    expect(source).toMatch(/octet_length\(authority_binding_digest\) = 32/);
    expect(source).toMatch(/octet_length\(source_revision_digest\) = 32/);
    expect(source).toContain("expires_at <= issued_at + interval '5 minutes'");
    expect(source).toContain(
      "outcome_code in ('pending', 'delivered', 'denied', 'expired')"
    );
    expect(source).toContain(
      "agent_mcp_evidence_redemptions_expiry_idx on private.agent_mcp_evidence_redemptions (expires_at, nonce_digest)"
    );
    expect(source).toContain(
      "create or replace function private.prune_agent_mcp_evidence_redemptions"
    );
    expect(source).toMatch(/p_limit between 1 and 64/);
    expect(source).toMatch(/for update skip locked/);
    expect(source).toMatch(/limit p_limit/);
    expect(source).not.toContain("create or replace function public.");
  });

  it("stores no identity, bearer, URL, locator, filename, payload, or bytes", () => {
    const source = sql();
    const table = source.match(
      /create table if not exists private\.agent_mcp_evidence_redemptions\s*\(([\s\S]*?)\);/
    )?.[1];
    expect(table).toBeTruthy();
    expect(table).not.toMatch(
      /actor|company|client|grant|user|bearer|token|url|locator|path|filename|mime|payload|content|byte_size|object_key/
    );
  });

  it("is owner-only, trigger-free, replay-guarded, and uses fixed empty search paths", () => {
    const source = sql().replace(/\s*,\s*/g, ",");
    expect(source).toContain(
      "revoke all on table private.agent_mcp_evidence_redemptions from public,anon,authenticated,service_role"
    );
    expect(source).toContain("and not relation.relhastriggers");
    expect(source).toContain("pg_catalog.pg_get_constraintdef");
    expect(source).toContain("pg_catalog.aclexplode");
    expect(source).toMatch(
      /private\.prune_agent_mcp_evidence_redemptions[\s\S]*?language plpgsql[\s\S]*?volatile[\s\S]*?security definer[\s\S]*?set search_path = ''/
    );
    expect(source).toContain(
      "revoke all on function private.prune_agent_mcp_evidence_redemptions(integer) from public,anon,authenticated,service_role"
    );
    expect(source).toContain("execute pg_catalog.format(");
    expect(source).toMatch(
      /revoke all privileges on table [\s\S]*?agent_mcp_evidence_redemptions from %i cascade/
    );
    expect(source).toMatch(
      /revoke all privileges on function [\s\S]*?prune_agent_mcp_evidence_redemptions\(integer\)[\s\S]*?from %i cascade/
    );
    expect(source).toContain("agent_mcp_evidence_prune_acl_failed");
  });
});
