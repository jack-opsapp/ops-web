import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_mcp_oauth_chatgpt_rfc9207_callback.sql";
const CHATGPT_CALLBACK =
  "https://chatgpt.com/connector_platform_oauth_redirect";

function compact(source: string): string {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory)
    .filter((file) => file.endsWith(MIGRATION_SUFFIX))
    .sort();

  expect(
    matches,
    `expected exactly one migration ending in ${MIGRATION_SUFFIX}`
  ).toHaveLength(1);
  return matches.length === 1
    ? readFileSync(join(directory, matches[0]), "utf8")
    : "";
}

function runtimeSql(): string {
  return readFileSync(
    join(
      process.cwd(),
      "tests/sql/agent-mcp-oauth-chatgpt-rfc9207-runtime.sql"
    ),
    "utf8"
  );
}

describe("MCP OAuth ChatGPT RFC 9207 callback migration", () => {
  it("adds only the exact stable ChatGPT callback and keeps connector families pure", () => {
    const sql = compact(migrationSql());

    expect(sql).toContain(`'${CHATGPT_CALLBACK}'`);
    expect(sql).toContain("'https://claude.ai/api/mcp/auth_callback'");
    expect(sql).toContain("'https://claude.com/api/mcp/auth_callback'");
    expect(sql).toContain("v_claude_redirect_count");
    expect(sql).toContain("v_chatgpt_redirect_count");
    expect(sql).toContain("v_codex_redirect_count");
    expect(sql).toMatch(/v_callback_family_count is distinct from 1/i);
    expect(sql).toMatch(/v_chatgpt_redirect_count > 1/i);
    expect(sql).toMatch(/v_codex_redirect_count > 1/i);
    expect(sql).not.toContain("https://chatgpt.com/connector/oauth/");
    expect(sql).not.toMatch(/chatgpt[^']*\*/i);
  });

  it("preserves service-role-only execution and exact function metadata", () => {
    const sql = compact(migrationSql())
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .toLowerCase();
    const signature =
      "public.register_mcp_oauth_client_as_system(text, text[], text, text[], text, text, text, text)";

    expect(sql).toContain("language plpgsql volatile security definer");
    expect(sql).toContain(
      "set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'"
    );
    expect(sql).toContain(`revoke all on function ${signature}`);
    expect(sql).toContain(`grant execute on function ${signature}`);
    expect(sql).toContain("to service_role");
  });

  it("ships runtime proof for acceptance, exact binding, look-alikes, and mixed families", () => {
    const sql = compact(runtimeSql());

    expect(sql).toContain(CHATGPT_CALLBACK);
    expect(sql).toContain("chatgpt_callback_registration_or_storage_mismatch");
    expect(sql).toContain("unsafe_chatgpt_callback_unexpectedly_registered");
    expect(sql).toContain(
      "mixed_chatgpt_callback_family_unexpectedly_registered"
    );
    expect(sql).toContain("chatgpt_preview_exact_redirect_binding_failed");
    expect(sql).toContain("chatgpt_code_exact_redirect_binding_failed");
  });
});
