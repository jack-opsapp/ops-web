import { describe, expect, it } from "vitest";

import {
  isAllowlistedRedirectUri,
  validateClientRegistration,
} from "../clients";
import { MCP_CONSENT_CATALOG_V9 } from "../scope-catalog";
import {
  MCP_EXPOSURE_V14,
  MCP_EXPOSURE_V23,
  MCP_EXPOSURE_V2,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const CALLBACK =
  "https://bpgayztkcuencdzinfxv.supabase.co/functions/v1/source-oauth";
function register(
  overrides: Record<string, unknown> = {},
  exposure: typeof MCP_EXPOSURE_V14 | typeof MCP_EXPOSURE_V23 = MCP_EXPOSURE_V14
) {
  return validateClientRegistration(
    {
      client_name: "Canpro cloud sources",
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "ops.company.read ops.jobs.read ops.purchasing.read",
      ...overrides,
    },
    exposure,
    MCP_CONSENT_CATALOG_V9
  );
}

describe("Canpro cloud callback boundary", () => {
  it("preserves the exact callback and explicit read ceiling on V23", () => {
    const result = register({}, MCP_EXPOSURE_V23);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.exposureRevision).toBe(
      MCP_EXPOSURE_V23.revision
    );
    expect(result.registration.redirectUris).toEqual([CALLBACK]);
    expect(result.registration.scopeCeiling).toEqual([
      "ops.company.read",
      "ops.jobs.read",
      "ops.purchasing.read",
    ]);
    for (const scope of [
      undefined,
      "",
      "ops.customers.prepare",
      "ops.jobs.read ops.customers.prepare",
    ]) {
      expect(register({ scope }, MCP_EXPOSURE_V23)).toMatchObject({
        ok: false,
        rejection: { error: "invalid_client_metadata" },
      });
    }
  });
  it("accepts the exact callback with an explicit immutable read ceiling", () => {
    expect(isAllowlistedRedirectUri(CALLBACK)).toBe(true);
    const result = register();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.redirectUris).toEqual([CALLBACK]);
    expect(result.registration.scopeCeiling).toEqual([
      "ops.company.read",
      "ops.jobs.read",
      "ops.purchasing.read",
    ]);
    expect(result.registration.exposureRevision).toBe(
      MCP_EXPOSURE_V14.revision
    );
    expect(result.registration.consentCatalogRevision).toBe(
      MCP_CONSENT_CATALOG_V9.revision
    );
    expect(Object.isFrozen(result.registration.scopeCeiling)).toBe(true);
  });

  it("supports every frozen v2 read without adding prepare authority", () => {
    const result = register({
      scope: MCP_EXPOSURE_V2.grantableScopes.join(" "),
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.registration.scopeCeiling).toEqual(
        [...MCP_EXPOSURE_V2.grantableScopes].sort()
      );
  });

  it.each([
    undefined,
    "",
    "  ",
    "ops.customers.prepare",
    "ops.company.read ops.customers.prepare",
    "ops.financial_documents.prepare",
    "ops.jobs.write",
    "openid",
  ])("rejects implicit or non-read scope %s", (scope) => {
    expect(register({ scope })).toMatchObject({
      ok: false,
      rejection: { error: "invalid_client_metadata" },
    });
  });

  it.each([
    `${CALLBACK}/`,
    `${CALLBACK}?`,
    `${CALLBACK}?code=x`,
    `${CALLBACK}#fragment`,
    `${CALLBACK}#`,
    `${CALLBACK}/extra`,
    `${CALLBACK}\n`,
    ` ${CALLBACK}`,
    CALLBACK.replace("https:", "http:"),
    CALLBACK.replace("https:", "HTTPS:"),
    CALLBACK.replace("bpgayztkcuencdzinfxv", "ijeekuhbatykdomumfjx"),
    CALLBACK.replace("supabase.co", "supabase.co.evil.example"),
    CALLBACK.replace("supabase.co", "supabase.co:443"),
    CALLBACK.replace("https://", "https://user@"),
    CALLBACK.replace("source-oauth", "%73ource-oauth"),
    CALLBACK.replace("source-oauth", "../v1/source-oauth"),
    CALLBACK.replace("bpgayztkcuencdzinfxv", "*"),
  ])("rejects callback alias %s", (uri) => {
    expect(isAllowlistedRedirectUri(uri)).toBe(false);
    expect(register({ redirect_uris: [uri] })).toMatchObject({
      ok: false,
      rejection: { error: "invalid_redirect_uri" },
    });
  });

  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "http://127.0.0.1:51759/callback/lwaKvnR9ZEom",
    CALLBACK,
  ])("rejects mixed or duplicate callback %s", (other) => {
    expect(register({ redirect_uris: [CALLBACK, other] }).ok).toBe(false);
  });
});
