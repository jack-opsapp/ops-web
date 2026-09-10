import { describe, expect, it, vi } from "vitest";
import { resolveOAuthExposureForSubject } from "../canary";
import type { ClientRow, McpOAuthRpcClient } from "../grants";
import {
  resolveActiveMcpExposure,
  resolveMcpExposure,
  capabilityManifestRevisionForExposure,
} from "../../../registry/mcp-exposure-catalog";
import {
  consentSnapshotForExposure,
  resolveMcpConsentCatalogRevision,
  resolveActiveMcpConsentCatalog,
} from "../scope-catalog";
import { resolveRequestedScopes } from "../scopes";

const scopes = [
  "ops.catalog.prepare",
  "ops.catalog.read",
  "ops.catalog_costs.read",
  "ops.catalog_costs.write",
  "ops.catalog_prices.write",
  "ops.company.read",
  "ops.inventory.adjust",
];
const client = {
  client_id: "00000000-0000-4000-8000-000000000001",
  client_name: "Catalog trial",
  redirect_uris: ["http://127.0.0.1:43177/callback/catalogtrial"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: scopes.join(" "),
  scope_ceiling: scopes,
  consent_catalog_revision: "2026-09-08.mcp-consent-catalog.v14",
  exposure_revision: "2026-09-08.mcp-exposure.v19",
  disabled: false,
} as ClientRow;
const subject = {
  userId: "10000000-0000-4000-8000-000000000001",
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const binding = {
  exposure_revision: client.exposure_revision,
  consent_catalog_revision: client.consent_catalog_revision,
  expires_at: "2099-09-08T20:00:00Z",
};

describe("catalog trial authorization", () => {
  it("selects only six tools for the exact bound subject, with no commit or public activation", async () => {
    const rpc = vi
      .fn<McpOAuthRpcClient["rpc"]>()
      .mockResolvedValue({ data: [binding], error: null });
    const exposure = await resolveOAuthExposureForSubject({
      ...subject,
      client,
      rpcClient: { rpc },
    });
    expect(exposure?.toolIds).toEqual([
      "get_company_context",
      "search_catalog_items",
      "get_catalog_item",
      "inspect_catalog_changes",
      "prepare_catalog_changes",
      "prepare_inventory_adjustment",
    ]);
    expect(exposure?.grantableScopes).toEqual(scopes);
    expect(resolveRequestedScopes(undefined, exposure!)).toEqual(scopes);
    expect(exposure).toBe(resolveMcpExposure(client.exposure_revision));
    expect(
      capabilityManifestRevisionForExposure(client.exposure_revision)
    ).toBe("2026-09-08.capability-manifest.v24");
    expect(rpc).toHaveBeenCalledWith("resolve_mcp_oauth_canary_as_system", {
      p_oauth_client_id: client.client_id,
      p_user_id: subject.userId,
      p_company_id: subject.companyId,
      p_exposure_revision: client.exposure_revision,
      p_consent_catalog_revision: client.consent_catalog_revision,
    });
    expect(
      consentSnapshotForExposure(
        exposure!,
        resolveMcpConsentCatalogRevision(client.consent_catalog_revision)
      ).acceptedLabels
    ).toHaveLength(7);
    expect(resolveActiveMcpExposure().revision).toBe(
      "2026-09-10.mcp-exposure.v23"
    );
    expect(resolveActiveMcpConsentCatalog().revision).toBe(
      "2026-09-04.mcp-consent-catalog.v9"
    );
  });
  it.each([
    { data: [] },
    { data: [{ ...binding, expires_at: "2000-01-01T00:00:00Z" }] },
    {
      data: [
        {
          ...binding,
          consent_catalog_revision: "2026-09-04.mcp-consent-catalog.v9",
        },
      ],
    },
  ])("denies unavailable or stale trial with no fallback", async ({ data }) => {
    const rpc = vi
      .fn<McpOAuthRpcClient["rpc"]>()
      .mockResolvedValue({ data, error: null });
    expect(
      await resolveOAuthExposureForSubject({
        ...subject,
        client,
        rpcClient: { rpc },
      })
    ).toBeNull();
  });
  it.each([
    { disabled: true },
    { scope_ceiling: [...scopes, "ops.customers.prepare"] },
    { scope_ceiling: scopes.slice(1) },
    { scope: "ops.catalog.read" },
  ])("rejects client drift before looking up binding", async (changes) => {
    const rpc = vi.fn<McpOAuthRpcClient["rpc"]>();
    expect(
      await resolveOAuthExposureForSubject({
        ...subject,
        client: { ...client, ...changes },
        rpcClient: { rpc },
      })
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
