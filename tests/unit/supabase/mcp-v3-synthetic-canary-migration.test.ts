import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_mcp_v3_synthetic_canary.sql";

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

function compact(source: string): string {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function functionDefinition(source: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${escaped}[\\s\\S]*?\\$function\\$\\s*;`,
      "i"
    )
  );
  expect(match, `${name} is missing`).toBeTruthy();
  return compact(match?.[0] ?? "");
}

describe("MCP v3 synthetic canary migration", () => {
  it("keeps exact canary subjects in a fail-closed private table", () => {
    const sql = compact(migrationSql());

    expect(sql).toContain("create table private.mcp_oauth_canary_bindings");
    for (const column of [
      "id uuid",
      "oauth_client_id uuid",
      "user_id uuid",
      "company_id uuid",
      "exposure_revision text",
      "consent_catalog_revision text",
      "expires_at timestamp with time zone",
      "disabled_at timestamp with time zone",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain(
      "alter table private.mcp_oauth_canary_bindings enable row level security"
    );
    expect(sql).toContain(
      "revoke all on table private.mcp_oauth_canary_bindings from public, anon, authenticated, service_role"
    );
    expect(sql).toMatch(
      /unique\s*\(oauth_client_id\)|oauth_client_id uuid[^,]*unique/i
    );
    expect(sql).toContain("mcp_oauth_canary_bindings_user_company_idx");
    expect(sql).toContain("mcp_oauth_canary_bindings_company_user_idx");
    expect(sql).toContain("references public.users (id)");
    expect(sql).toContain("references public.companies (id)");
  });

  it("makes provisioning exact, bounded, and idempotent", () => {
    const provision = functionDefinition(
      migrationSql(),
      "public.provision_mcp_oauth_canary_as_system"
    );

    expect(provision).toContain("auth.role() is distinct from 'service_role'");
    expect(provision).toContain("private.user_is_active_company_member");
    expect(provision).toContain("ops mcp synthetic canary");
    expect(provision).not.toContain("persona test pool");
    expect(provision).toContain("public.has_permission");
    expect(provision).toContain("settings.integrations");
    expect(provision).toContain("private.resolve_agent_actor_authority");
    expect(provision).toContain("2026-08-30.mcp-exposure.v3");
    expect(provision).toContain("2026-08-30.mcp-consent-catalog.v2");
    expect(provision).toMatch(/p_expires_at\s*>\s*statement_timestamp\(\)/);
    expect(provision).toMatch(
      /p_expires_at\s*<=\s*statement_timestamp\(\)\s*\+\s*interval '24 hours'/
    );
    expect(provision).toContain("on conflict (oauth_client_id)");
    expect(provision).toContain("mcp_oauth_canary_conflict");
  });

  it("resolves only an enabled, unexpired, exact subject binding", () => {
    const resolve = functionDefinition(
      migrationSql(),
      "public.resolve_mcp_oauth_canary_as_system"
    );

    for (const predicate of [
      "binding.oauth_client_id = p_oauth_client_id",
      "binding.user_id = p_user_id",
      "binding.company_id = p_company_id",
      "binding.exposure_revision = p_exposure_revision",
      "binding.consent_catalog_revision = p_consent_catalog_revision",
      "binding.disabled_at is null",
      "binding.expires_at > statement_timestamp()",
      "client.disabled_at is null",
      "private.user_is_active_company_member",
    ]) {
      expect(resolve).toContain(predicate);
    }
  });

  it("keeps every canary RPC service-role only and search-path pinned", () => {
    const sql = compact(migrationSql()).replace(/\s*,\s*/g, ",");
    for (const name of [
      "provision_mcp_oauth_canary_as_system",
      "resolve_mcp_oauth_canary_as_system",
      "disable_mcp_oauth_canary_as_system",
      "inspect_mcp_oauth_canary_acceptance_as_system",
      "verify_mcp_oauth_canary_cleanup_as_system",
    ]) {
      const definition = functionDefinition(migrationSql(), `public.${name}`);
      expect(definition).toContain("security definer");
      expect(definition).toContain(
        "set search_path = pg_catalog, public, private, pg_temp"
      );
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([^;]+?\\) from public,anon,authenticated,service_role`
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^;]+?\\) to service_role`
        )
      );
    }
  });

  it("invalidates exact v3 grants, tokens, and routines on disable", () => {
    const disable = functionDefinition(
      migrationSql(),
      "public.disable_mcp_oauth_canary_as_system"
    );

    expect(disable).toContain("update private.mcp_oauth_canary_bindings");
    expect(disable).toContain("update private.mcp_oauth_grants");
    expect(disable).toContain("update private.mcp_oauth_tokens");
    expect(disable).toContain("update private.mcp_oauth_clients");
    expect(disable).toContain("update private.agent_day_closeout_routines");
    expect(disable).toContain(
      "where routine.oauth_client_id = p_oauth_client_id"
    );
    expect(disable).toContain("routine.company_id = p_company_id");
    expect(disable).toContain("routine.actor_user_id = p_user_id");
  });

  it("verifies operator proof and cleanup without returning identifiers", () => {
    const inspection = functionDefinition(
      migrationSql(),
      "public.inspect_mcp_oauth_canary_acceptance_as_system"
    );
    const cleanup = functionDefinition(
      migrationSql(),
      "public.verify_mcp_oauth_canary_cleanup_as_system"
    );

    expect(inspection).toContain("prepared_with_approval boolean");
    expect(inspection).toContain("receipt_verified boolean");
    expect(inspection).toContain("routine_enabled boolean");
    expect(inspection).toContain("private.mcp_oauth_canary_is_current");
    expect(inspection).toContain("grant_record.revoked_at is null");
    expect(inspection).toContain("filed_inside_ops");
    expect(inspection).toContain("messages_sent");
    expect(inspection).toContain("money_moved");
    expect(cleanup).toContain("binding_inactive boolean");
    expect(cleanup).toContain("grants_inactive boolean");
    expect(cleanup).toContain("tokens_inactive boolean");
    expect(cleanup).toContain("routines_safe boolean");
  });

  it("rechecks v3 in every durable OAuth write and bearer resolution", () => {
    const sql = compact(migrationSql());
    const trigger = functionDefinition(
      migrationSql(),
      "private.enforce_mcp_v3_canary_write"
    );
    const bearer = functionDefinition(
      migrationSql(),
      "public.resolve_mcp_oauth_access_token_as_system"
    );

    for (const table of [
      "private.mcp_oauth_consent_previews",
      "private.mcp_oauth_authorization_codes",
      "private.mcp_oauth_grants",
      "private.mcp_oauth_tokens",
    ]) {
      expect(sql).toContain(`before insert on ${table}`);
    }
    expect(trigger).toContain("private.mcp_oauth_canary_is_current");
    expect(trigger).toContain("mcp_oauth_canary_unavailable");
    expect(bearer).toContain("p_active_exposure_revision text");
    expect(bearer).toContain("2026-08-29.mcp-exposure.v2");
    expect(bearer).toContain("private.mcp_oauth_canary_is_current");
    expect(sql).toContain(
      "grant execute on function public.resolve_mcp_oauth_access_token_as_system(text) to service_role"
    );
    expect(sql).toContain(
      "where resolved.exposure_revision <> '2026-08-30.mcp-exposure.v3'"
    );
  });

  it("revokes a v3 family and de-leases its routine when refresh loses the canary", () => {
    const refresh = functionDefinition(
      migrationSql(),
      "public.rotate_mcp_oauth_refresh_token_as_system"
    );

    expect(refresh).toContain("private.mcp_oauth_canary_is_current");
    expect(refresh).toContain("update private.mcp_oauth_tokens");
    expect(refresh).toContain("update private.mcp_oauth_grants");
    expect(refresh).toContain("update private.agent_day_closeout_routines");
    expect(refresh).toContain("oauth_canary_unavailable");
    expect(refresh).toContain("if v_rotated.reuse_detected");
    expect(refresh).toContain("oauth_grant_revoked");
    expect(refresh).toContain("claim_token = null");
  });

  it("binds routine discovery and every business read to the current canary", () => {
    const assertion = functionDefinition(
      migrationSql(),
      "private.assert_agent_day_closeout_authority"
    );
    const list = functionDefinition(
      migrationSql(),
      "public.list_agent_day_closeout_routine_configs_as_system"
    );

    expect(assertion).toContain("private.mcp_oauth_canary_is_current");
    expect(assertion).toContain("agent_day_closeout_canary_stale_or_denied");
    expect(list).toContain("private.mcp_oauth_canary_is_current");
    expect(list).toContain("2026-08-30.mcp-exposure.v3");
  });
});
