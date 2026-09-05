import { describe, expect, it, vi } from "vitest";

import {
  McpOAuthStoreError,
  type ClientRow,
  type McpOAuthRpcClient,
} from "@/lib/agent-control-plane/mcp/oauth/grants";
import { resolveOAuthExposureForSubject } from "@/lib/agent-control-plane/mcp/oauth/canary";
import {
  MCP_EXPOSURE_V1,
  MCP_EXPOSURE_V14,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V3,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const CLIENT_ID = "ca000000-0000-4000-8000-000000000021";
const USER_ID = "ca000000-0000-4000-8000-000000000011";
const COMPANY_ID = "ca000000-0000-4000-8000-000000000001";
const V2_CONSENT_REVISION = "2026-08-22.mcp-consent-catalog.v1";
const V3_CONSENT_REVISION = "2026-08-30.mcp-consent-catalog.v2";

function client(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    client_id: CLIENT_ID,
    client_name: "OPS canary",
    redirect_uris: ["http://127.0.0.1:51759/callback/canary"],
    token_endpoint_auth_method: "none",
    scope: MCP_EXPOSURE_V2.grantableScopes.join(" "),
    scope_ceiling: [...MCP_EXPOSURE_V2.grantableScopes],
    consent_catalog_revision: V2_CONSENT_REVISION,
    exposure_revision: MCP_EXPOSURE_V2.revision,
    disabled: false,
    ...overrides,
  };
}

function rpcReturning(data: unknown): {
  readonly client: McpOAuthRpcClient;
  readonly rpc: ReturnType<typeof vi.fn<McpOAuthRpcClient["rpc"]>>;
} {
  const rpc = vi.fn<McpOAuthRpcClient["rpc"]>().mockResolvedValue({
    data,
    error: null,
  });
  return { client: { rpc }, rpc };
}

function canaryClient(overrides: Partial<ClientRow> = {}): ClientRow {
  return client({
    scope: MCP_EXPOSURE_V3.grantableScopes.join(" "),
    scope_ceiling: [...MCP_EXPOSURE_V3.grantableScopes],
    consent_catalog_revision: V3_CONSENT_REVISION,
    exposure_revision: MCP_EXPOSURE_V3.revision,
    ...overrides,
  });
}

describe("MCP OAuth canary exposure resolver", () => {
  it("keeps an ordinary active client on the server-owned v2 exposure", async () => {
    const { client: rpcClient, rpc } = rpcReturning([]);

    await expect(
      resolveOAuthExposureForSubject({
        rpcClient,
        client: client(),
        userId: USER_ID,
        companyId: COMPANY_ID,
      })
    ).resolves.toBe(MCP_EXPOSURE_V2);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("resolves v3 only from one exact current database binding", async () => {
    const { client: rpcClient, rpc } = rpcReturning([
      {
        exposure_revision: MCP_EXPOSURE_V3.revision,
        consent_catalog_revision: V3_CONSENT_REVISION,
        expires_at: "2099-08-31T20:00:00.000Z",
      },
    ]);

    await expect(
      resolveOAuthExposureForSubject({
        rpcClient,
        client: canaryClient(),
        userId: USER_ID,
        companyId: COMPANY_ID,
      })
    ).resolves.toBe(MCP_EXPOSURE_V3);
    expect(rpc).toHaveBeenCalledWith("resolve_mcp_oauth_canary_as_system", {
      p_oauth_client_id: CLIENT_ID,
      p_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_exposure_revision: MCP_EXPOSURE_V3.revision,
      p_consent_catalog_revision: V3_CONSENT_REVISION,
    });
  });

  it.each([
    ["missing", []],
    [
      "expired",
      [
        {
          exposure_revision: MCP_EXPOSURE_V3.revision,
          consent_catalog_revision: V3_CONSENT_REVISION,
          expires_at: "2025-08-31T20:00:00.000Z",
        },
      ],
    ],
    [
      "wrong exposure",
      [
        {
          exposure_revision: MCP_EXPOSURE_V2.revision,
          consent_catalog_revision: V3_CONSENT_REVISION,
          expires_at: "2099-08-31T20:00:00.000Z",
        },
      ],
    ],
    [
      "wrong consent catalogue",
      [
        {
          exposure_revision: MCP_EXPOSURE_V3.revision,
          consent_catalog_revision: V2_CONSENT_REVISION,
          expires_at: "2099-08-31T20:00:00.000Z",
        },
      ],
    ],
    [
      "malformed expiry",
      [
        {
          exposure_revision: MCP_EXPOSURE_V3.revision,
          consent_catalog_revision: V3_CONSENT_REVISION,
          expires_at: "not-an-instant",
        },
      ],
    ],
  ])("fails closed for a %s canary result", async (_name, data) => {
    const { client: rpcClient } = rpcReturning(data);

    await expect(
      resolveOAuthExposureForSubject({
        rpcClient,
        client: canaryClient(),
        userId: USER_ID,
        companyId: COMPANY_ID,
      })
    ).resolves.toBeNull();
  });

  it("never falls back when an inactive v3 client is disabled or unavailable", async () => {
    const disabledRpc = rpcReturning([]);
    await expect(
      resolveOAuthExposureForSubject({
        rpcClient: disabledRpc.client,
        client: canaryClient({ disabled: true }),
        userId: USER_ID,
        companyId: COMPANY_ID,
      })
    ).resolves.toBeNull();
    expect(disabledRpc.rpc).not.toHaveBeenCalled();

    const failedRpc = vi
      .fn<McpOAuthRpcClient["rpc"]>()
      .mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(
      resolveOAuthExposureForSubject({
        rpcClient: { rpc: failedRpc },
        client: canaryClient(),
        userId: USER_ID,
        companyId: COMPANY_ID,
      })
    ).resolves.toBeNull();
  });

  it("derives every revision from the stored client, never request input", async () => {
    const { client: rpcClient, rpc } = rpcReturning([]);
    const input = {
      rpcClient,
      client: canaryClient(),
      userId: USER_ID,
      companyId: COMPANY_ID,
      exposureRevision: MCP_EXPOSURE_V2.revision,
    };

    await expect(resolveOAuthExposureForSubject(input)).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith(
      "resolve_mcp_oauth_canary_as_system",
      expect.objectContaining({
        p_exposure_revision: MCP_EXPOSURE_V3.revision,
        p_consent_catalog_revision: V3_CONSENT_REVISION,
      })
    );
  });

  it("keeps the typed store adapter opaque when called directly", async () => {
    const failedRpc = vi
      .fn<McpOAuthRpcClient["rpc"]>()
      .mockRejectedValue(new Error("database details"));
    const rpcClient = { rpc: failedRpc };

    await expect(
      import("@/lib/agent-control-plane/mcp/oauth/grants").then(
        ({ resolveCanaryBinding }) =>
          resolveCanaryBinding(rpcClient, {
            clientId: CLIENT_ID,
            userId: USER_ID,
            companyId: COMPANY_ID,
            exposureRevision: MCP_EXPOSURE_V3.revision,
            consentCatalogRevision: V3_CONSENT_REVISION,
          })
      )
    ).rejects.toBeInstanceOf(McpOAuthStoreError);
  });
});

describe("approved customer update OAuth activation", () => {
  function updateClient(overrides: Partial<ClientRow> = {}): ClientRow {
    return client({
      exposure_revision: MCP_EXPOSURE_V14.revision,
      consent_catalog_revision: "2026-09-04.mcp-consent-catalog.v9",
      scope: MCP_EXPOSURE_V14.grantableScopes.join(" "),
      scope_ceiling: [...MCP_EXPOSURE_V14.grantableScopes],
      ...overrides,
    });
  }
  it("accepts the exact active v14 client without a canary binding", async () => {
    const r = rpcReturning([]);
    await expect(
      resolveOAuthExposureForSubject({
        rpcClient: r.client,
        client: updateClient(),
        userId: USER_ID,
        companyId: COMPANY_ID,
      })
    ).resolves.toBe(MCP_EXPOSURE_V14);
    expect(r.rpc).not.toHaveBeenCalled();
  });
  it("preserves a historical v1 client without expanding its seven scopes", async () => {
    const r = rpcReturning([]);
    await expect(
      resolveOAuthExposureForSubject({
        rpcClient: r.client,
        client: client({
          exposure_revision: MCP_EXPOSURE_V1.revision,
          scope: MCP_EXPOSURE_V1.grantableScopes.join(" "),
          scope_ceiling: [...MCP_EXPOSURE_V1.grantableScopes],
        }),
        userId: USER_ID,
        companyId: COMPANY_ID,
      })
    ).resolves.toBe(MCP_EXPOSURE_V1);
    expect(r.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { disabled: true },
    { consent_catalog_revision: V2_CONSENT_REVISION },
    { scope_ceiling: [...MCP_EXPOSURE_V2.grantableScopes] },
    { scope: MCP_EXPOSURE_V2.grantableScopes.join(" ") },
    { exposure_revision: "2026-09-03.mcp-exposure.v13" },
  ])(
    "rejects mismatched or disabled customer update authority %j",
    async (overrides) => {
      const r = rpcReturning([]);
      await expect(
        resolveOAuthExposureForSubject({
          rpcClient: r.client,
          client: updateClient(overrides),
          userId: USER_ID,
          companyId: COMPANY_ID,
        })
      ).resolves.toBeNull();
      expect(r.rpc).not.toHaveBeenCalled();
    }
  );
});
