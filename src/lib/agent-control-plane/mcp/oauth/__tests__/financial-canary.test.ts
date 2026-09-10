import { describe, expect, it, vi } from "vitest";
import { resolveOAuthExposureForSubject } from "../canary";
import { resolveActiveMcpExposure } from "../../../registry/mcp-exposure-catalog";
import type { ClientRow, McpOAuthRpcClient } from "../grants";
const scopes = [
  "ops.company.read",
  "ops.customers.read",
  "ops.financial_documents.prepare",
  "ops.financial_documents.read",
  "ops.jobs.read",
];
const client: ClientRow = {
  client_id: "60000000-0000-4000-8000-000000000001",
  client_name: "Fictional financial trial",
  redirect_uris: ["https://example.invalid/callback"],
  token_endpoint_auth_method: "none",
  scope: scopes.join(" "),
  scope_ceiling: scopes,
  consent_catalog_revision: "2026-09-07.mcp-consent-catalog.v12",
  exposure_revision: "2026-09-07.mcp-exposure.v17",
  disabled: false,
};
const subject = {
  userId: "10000000-0000-4000-8000-000000000001",
  companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const binding = {
  exposure_revision: client.exposure_revision,
  consent_catalog_revision: client.consent_catalog_revision,
  expires_at: "2099-09-08T20:00:00Z",
};
describe("financial trial OAuth boundary", () => {
  it("resolves only the narrow financial slice for the exact bound subject", async () => {
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
      "inspect_financial_document",
      "prepare_financial_document",
    ]);
    expect(exposure?.grantableScopes).toEqual(scopes);
    expect(rpc).toHaveBeenCalledWith("resolve_mcp_oauth_canary_as_system", {
      p_oauth_client_id: client.client_id,
      p_user_id: subject.userId,
      p_company_id: subject.companyId,
      p_exposure_revision: client.exposure_revision,
      p_consent_catalog_revision: client.consent_catalog_revision,
    });
    expect(resolveActiveMcpExposure().revision).toBe(
      "2026-09-10.mcp-exposure.v23"
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
  ])("rejects unavailable or stale binding without fallback", async ({ data }) => {
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
  it("rejects client scope expansion before consulting authority", async () => {
    const rpc = vi.fn<McpOAuthRpcClient["rpc"]>();
    expect(
      await resolveOAuthExposureForSubject({
        ...subject,
        client: {
          ...client,
          scope_ceiling: [...scopes, "ops.customers.prepare"],
        },
        rpcClient: { rpc },
      })
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
