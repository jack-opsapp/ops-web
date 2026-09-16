import { describe, expect, it } from "vitest";

import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_CATALOG,
  MCP_EXPOSURE_V14,
  MCP_EXPOSURE_V23,
  MCP_EXPOSURE_V24,
  capabilityManifestRevisionForExposure,
  isCustomerUpdateMcpExposure,
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

describe("catalogue recipe read successor exposure", () => {
  it("is V23's authority exactly, published as the new active revision", () => {
    expect(MCP_EXPOSURE_V24.revision).toBe("2026-09-15.mcp-exposure.v24");
    expect(MCP_EXPOSURE_V24.toolIds).toEqual(MCP_EXPOSURE_V23.toolIds);
    expect(MCP_EXPOSURE_V24.grantableScopes).toEqual(
      MCP_EXPOSURE_V23.grantableScopes
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V24.revision)
    ).toBe(capabilityManifestRevisionForExposure(MCP_EXPOSURE_V23.revision));
    expect(isCustomerUpdateMcpExposure(MCP_EXPOSURE_V24.revision)).toBe(true);
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(MCP_EXPOSURE_V24.revision);
    expect(resolveActiveMcpExposure()).toBe(MCP_EXPOSURE_V24);
    expect(resolveMcpExposure(MCP_EXPOSURE_V24.revision)).toBe(
      MCP_EXPOSURE_V24
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V24.revision]).toBe(
      MCP_EXPOSURE_V24
    );
  });

  it("reuses consent catalogue v9 because the grantable scopes did not move", () => {
    expect(resolveActiveMcpConsentCatalog()).toBe(MCP_CONSENT_CATALOG_V9);
    expect(
      consentSnapshotForExposure(MCP_EXPOSURE_V24, MCP_CONSENT_CATALOG_V9)
    ).toEqual({
      ...consentSnapshotForExposure(MCP_EXPOSURE_V23, MCP_CONSENT_CATALOG_V9),
      exposureRevision: MCP_EXPOSURE_V24.revision,
    });
  });

  it("leaves the V14 and V23 pins immutable and still resolvable", () => {
    expect(MCP_EXPOSURE_V23.revision).toBe("2026-09-10.mcp-exposure.v23");
    expect(MCP_EXPOSURE_V14.revision).toBe("2026-09-04.mcp-exposure.v14");
    expect(resolveMcpExposure(MCP_EXPOSURE_V23.revision)).toBe(
      MCP_EXPOSURE_V23
    );
    expect(resolveMcpExposure(MCP_EXPOSURE_V14.revision)).toBe(
      MCP_EXPOSURE_V14
    );
    expect(Object.isFrozen(MCP_EXPOSURE_V24)).toBe(true);
    expect(Object.isFrozen(MCP_EXPOSURE_V24.toolIds)).toBe(true);
    expect(Object.isFrozen(MCP_EXPOSURE_V24.grantableScopes)).toBe(true);
  });

  it("enrolls a V24 client and keeps enrolling V14 and V23 clients", async () => {
    for (const exposure of [
      MCP_EXPOSURE_V14,
      MCP_EXPOSURE_V23,
      MCP_EXPOSURE_V24,
    ]) {
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

  it("rejects a disabled, broadened or re-consented V24 client", async () => {
    for (const invalid of [
      { ...client(MCP_EXPOSURE_V24.revision), disabled: true },
      client(MCP_EXPOSURE_V24.revision, [
        "ops.jobs.read",
        "ops.inventory.adjust",
      ]),
      {
        ...client(MCP_EXPOSURE_V24.revision),
        consent_catalog_revision: "unknown",
      },
    ]) {
      expect(
        await resolveOAuthExposureForSubject({ ...subject, client: invalid })
      ).toBeNull();
    }
  });
});
