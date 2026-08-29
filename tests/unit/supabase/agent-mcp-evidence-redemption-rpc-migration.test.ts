import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_mcp_evidence_redemption_rpc.sql";

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

function runtimeSql(): string {
  return readFileSync(
    join(process.cwd(), "tests/sql/agent-mcp-evidence-runtime.sql"),
    "utf8"
  )
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("MCP evidence redemption RPC migration", () => {
  it("depends on the private Task 10 projection and exposes one fixed service-only volatile RPC", () => {
    const source = sql().replace(/\s*,\s*/g, ",");
    expect(source).toContain(
      "private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)"
    );
    expect(source).toContain(
      "private.agent_p2_artifact_evidence_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)"
    );
    expect(source).toContain(
      "create or replace function public.redeem_agent_mcp_evidence_as_system"
    );
    expect(source).toMatch(
      /language plpgsql volatile security definer set search_path = ''/
    );
    expect(source).toContain("auth.role() is distinct from 'service_role'");
    expect(source).toContain(
      "grant execute on function public.redeem_agent_mcp_evidence_as_system"
    );
    expect(source).toContain("to service_role");
    expect(source).toContain("from public,anon,authenticated,service_role");
    expect(source).toContain("execute pg_catalog.format(");
    expect(source).toMatch(
      /revoke all privileges on function [\s\S]*?redeem_agent_mcp_evidence_as_system\([\s\S]*?from %i cascade/
    );
  });

  it("claims the one-way nonce before delivery and loses concurrent or later replays", () => {
    const source = sql();
    expect(source).toMatch(
      /prune_agent_mcp_evidence_redemptions\(64\)[\s\S]*?insert into private\.agent_mcp_evidence_redemptions[\s\S]*?on conflict \(nonce_digest\) do nothing[\s\S]*?returning true/
    );
    expect(source).toContain("if not coalesce(v_nonce_claimed, false) then");
    expect(source).toContain("'replay'::text");
    expect(source).not.toMatch(
      /delete from private\.agent_mcp_evidence_redemptions/
    );
  });

  it("re-proves the current access token, grant, client, actor, company, parent, source revisions, and safe artifact in one statement", () => {
    const source = sql();
    for (const fragment of [
      "private.mcp_oauth_tokens",
      "token_row.token_hash = p_access_token_hash",
      "token_row.revoked_at is null",
      "token_row.expires_at > pg_catalog.statement_timestamp()",
      "token_row.audience = p_audience",
      "private.agent_p2_artifact_evidence_v1(",
      "private.agent_p2_artifact_private_evidence_v1(",
      "p_job_kind",
      "p_job_id",
      "p_source_kind",
      "p_evidence_ref",
      "'artifacts:'",
      "legacy_operational",
      "source_revisions",
    ]) {
      expect(source).toContain(fragment);
    }
    expect(source).toContain("p_source_limit => 501");
    expect(source).toContain("source.availability = 'available'");
    expect(source).toContain(
      "source.inspection_state in ('not_required', 'passed')"
    );
    expect(source).toContain("source.raw_byte_size = source.byte_size");
  });

  it("allows no redirectable locator, SVG/HTML MIME, range ambiguity, or oversized delivery", () => {
    const source = sql();
    expect(source).toContain("source.raw_locator_kind = 'storage_path'");
    expect(source).toContain("source.source_kind = 'email_attachment'");
    expect(source).toContain("application/pdf");
    expect(source).toContain("image/jpeg");
    expect(source).toContain("image/png");
    expect(source).not.toContain("image/svg+xml");
    expect(source).not.toContain("text/html");
    expect(source).toContain("26214400");
    expect(source).toContain("52428800");
  });

  it("writes only privacy-safe immutable audit facts and never the token, locator, filename, or payload", () => {
    const source = sql();
    expect(source).toContain("insert into private.mcp_request_audit");
    expect(source).toContain("p_binding_digest");
    const audit = source.match(
      /insert into private\.mcp_request_audit[\s\S]*?; /
    )?.[0];
    expect(audit).toBeTruthy();
    expect(audit).not.toMatch(/raw_locator|p_nonce|filename|payload|content/);
  });

  it("ships a self-contained rollback-only PG17 matrix for every same-statement denial boundary", () => {
    const runtime = runtimeSql();
    for (const fragment of [
      "agent_mcp_evidence_bootstrap",
      "agent_mcp_evidence_direct_role_guard_accepted",
      "task11-runtime-stale-source",
      "task11-runtime-pending-scan",
      "task11-runtime-unsafe-scan",
      "task11-runtime-wrong-bearer",
      "task11-runtime-wrong-client",
      "task11-runtime-revoked-token",
      "task11-runtime-revoked-grant",
      "task11-runtime-expired",
      "task11-runtime-binding-tamper",
      "task11-runtime-non-deliverable-source",
      "task11-runtime-unsafe-mime",
      "task11-runtime-oversized",
      "agent_mcp_evidence_typescript_sql_digest_mismatch",
      "agent_mcp_evidence_bounded_prune_failed",
      "rollback;",
    ]) {
      expect(runtime).toContain(fragment);
    }
    expect(runtime).toContain("pg_catalog.row_to_json(audit)::text");
    expect(runtime).toContain("audit.input_sha256 !~ '^[0-9a-f]{64}$'");
  });
});
