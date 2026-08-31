import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { resolveMcpBearer } from "@/lib/agent-control-plane/mcp/bearer";
import { credentialDigest } from "@/lib/agent-control-plane/mcp/oauth";
import type { McpServerRuntime } from "@/lib/agent-control-plane/mcp/runtime";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const GRANT_REVISION = "0123456789abcdef0123456789abcdef";
const EXPOSURE_REVISION = "2026-08-22.mcp-exposure.v1";
const TOKEN = `ops_mcp_at_${"a".repeat(43)}`;

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: USER_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: ["projects.view"],
    effectivePermissions: [{ permission: "projects.view", scope: "all" }],
    permissionSnapshotRevision: "sha256:mcp-bearer-test",
  };
}

function runtime(exposureRevision = EXPOSURE_REVISION): McpServerRuntime {
  const authorityClient = new StubAuthoritySupabaseRpcClient(authority());
  return {
    domainService: {} as McpServerRuntime["domainService"],
    dayCloseout: {} as McpServerRuntime["dayCloseout"],
    collections: {} as McpServerRuntime["collections"],
    authorityRepository: authorityClient.repository,
    rpcClient: {
      async rpc(functionName) {
        if (functionName !== "resolve_mcp_oauth_access_token_as_system") {
          throw new Error("unexpected RPC");
        }
        return {
          data: [
            {
              grant_id: GRANT_ID,
              client_id: CLIENT_ID,
              client_name: "Codex",
              user_id: USER_ID,
              company_id: COMPANY_ID,
              scopes: ["ops.jobs.read"],
              accepted_labels: ["See your jobs and their status"],
              consent_catalog_revision: "2026-08-22.mcp-consent-catalog.v1",
              exposure_revision: exposureRevision,
              revision: GRANT_REVISION,
              issuer: "https://app.opsapp.co",
              audience: "https://app.opsapp.co/api/mcp",
              expires_at: "2099-08-29T12:10:00+00:00",
              token_revoked: false,
              grant_revoked: false,
              client_disabled: false,
            },
          ],
          error: null,
        };
      },
    },
    durableRateLimiter: {} as McpServerRuntime["durableRateLimiter"],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MCP bearer grant boundary", () => {
  it("carries the database exposure revision unchanged into immutable grant facts", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.opsapp.co");

    const resolution = await resolveMcpBearer(
      new Request("https://app.opsapp.co/api/mcp", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      runtime()
    );

    expect(resolution.kind).toBe("authenticated");
    if (resolution.kind !== "authenticated") return;
    expect(resolution.grantFacts.exposureRevision).toBe(EXPOSURE_REVISION);
    expect(resolution.grantFacts).toEqual({
      grantId: GRANT_ID,
      clientId: CLIENT_ID,
      clientName: "Codex",
      actorUserId: USER_ID,
      companyId: COMPANY_ID,
      scopes: ["ops.jobs.read"],
      exposureRevision: EXPOSURE_REVISION,
      tokenId: credentialDigest(TOKEN, "ops_mcp_at_"),
      expiresAtEpochSeconds: Date.parse("2099-08-29T12:10:00+00:00") / 1000,
    });
    expect(Object.isFrozen(resolution.grantFacts)).toBe(true);
    expect(Object.isFrozen(resolution.grantFacts.scopes)).toBe(true);
  });

  it("rejects a token whose stored exposure revision is not code-owned", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.opsapp.co");

    const resolution = await resolveMcpBearer(
      new Request("https://app.opsapp.co/api/mcp", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      runtime("unknown.mcp-exposure")
    );

    expect(resolution).toEqual({ kind: "invalid_token" });
  });

  it("binds an inactive v3 grant to v9 authority without changing active v2", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.opsapp.co");

    const resolution = await resolveMcpBearer(
      new Request("https://app.opsapp.co/api/mcp", {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      runtime("2026-08-30.mcp-exposure.v3")
    );

    expect(resolution.kind).toBe("authenticated");
    if (resolution.kind !== "authenticated") return;
    expect(resolution.actorContext.capabilityManifestRevision).toBe(
      "2026-08-30.capability-manifest.v9"
    );
    expect(resolution.grantFacts.exposureRevision).toBe(
      "2026-08-30.mcp-exposure.v3"
    );
  });
});
