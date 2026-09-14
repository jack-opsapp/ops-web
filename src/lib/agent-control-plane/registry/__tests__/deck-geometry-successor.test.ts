import { describe, expect, it } from "vitest";
import {
  MCP_EXPOSURE_V14,
  MCP_EXPOSURE_V23,
  capabilityManifestRevisionForExposure,
  resolveActiveMcpExposure,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";
import {
  MCP_CONSENT_CATALOG_V9,
  consentSnapshotForExposure,
  resolveActiveMcpConsentCatalog,
} from "../../mcp/oauth/scope-catalog";
import { resolveOAuthExposureForSubject } from "../../mcp/oauth/canary";
import type { ClientRow } from "../../mcp/oauth/grants";

function client(
  exposureRevision: string,
  scopes = [...MCP_EXPOSURE_V14.grantableScopes]
): ClientRow {
  return {
    client_id: "10000000-0000-4000-8000-000000000001",
    client_name: "Synthetic Claude",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    token_endpoint_auth_method: "none",
    scope: scopes.join(" "),
    scope_ceiling: scopes,
    consent_catalog_revision: MCP_CONSENT_CATALOG_V9.revision,
    exposure_revision: exposureRevision,
    disabled: false,
  };
}
const subject = {
  rpcClient: {
    rpc: async () => {
      throw new Error("Ordinary pins must not become trials");
    },
  },
  userId: "20000000-0000-4000-8000-000000000001",
  companyId: "30000000-0000-4000-8000-000000000001",
};
describe("full deck result v2 successor", () => {
  it("preserves the exact ordered V14 tools, ceiling, manifest and consent", () => {
    expect(MCP_EXPOSURE_V23.toolIds).toEqual(MCP_EXPOSURE_V14.toolIds);
    expect(MCP_EXPOSURE_V23.grantableScopes).toEqual(
      MCP_EXPOSURE_V14.grantableScopes
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V23.revision)
    ).toBe(capabilityManifestRevisionForExposure(MCP_EXPOSURE_V14.revision));
    expect(
      consentSnapshotForExposure(MCP_EXPOSURE_V23, MCP_CONSENT_CATALOG_V9)
    ).toEqual({
      ...consentSnapshotForExposure(MCP_EXPOSURE_V14, MCP_CONSENT_CATALOG_V9),
      exposureRevision: MCP_EXPOSURE_V23.revision,
    });
    expect(resolveActiveMcpExposure()).toBe(MCP_EXPOSURE_V23);
    expect(resolveActiveMcpConsentCatalog()).toBe(MCP_CONSENT_CATALOG_V9);
    expect(resolveMcpExposure(MCP_EXPOSURE_V14.revision)).toBe(
      MCP_EXPOSURE_V14
    );
  });
  it("keeps old V14 enrollment and allows V23 with identical scopes", async () => {
    for (const exposure of [MCP_EXPOSURE_V14, MCP_EXPOSURE_V23]) {
      expect(
        await resolveOAuthExposureForSubject({
          ...subject,
          client: client(exposure.revision),
        })
      ).toBe(exposure);
      expect(
        await resolveOAuthExposureForSubject({
          ...subject,
          client: client(exposure.revision, ["ops.jobs.read"]),
        })
      ).toBe(exposure);
    }
  });
  it("rejects disabled clients, unsorted or broadened ceilings and altered consent", async () => {
    for (const exposure of [MCP_EXPOSURE_V14, MCP_EXPOSURE_V23]) {
      for (const invalid of [
        { ...client(exposure.revision), disabled: true },
        client(
          exposure.revision,
          [...MCP_EXPOSURE_V14.grantableScopes].reverse()
        ),
        client(exposure.revision, ["ops.jobs.read", "ops.inventory.adjust"]),
        { ...client(exposure.revision), consent_catalog_revision: "unknown" },
      ])
        expect(
          await resolveOAuthExposureForSubject({ ...subject, client: invalid })
        ).toBeNull();
    }
  });
});
