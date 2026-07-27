import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ExternalApiAuthError,
  authenticateExternalApiCredential,
  parseExternalApiBearer,
} from "@/lib/external-api/auth/credential-auth";
import { parseExternalApiHmacKeyRing } from "@/lib/external-api/auth/credential-secret";

const keyMaterial = Buffer.alloc(32, 7);
const ring = parseExternalApiHmacKeyRing(
  JSON.stringify({
    activeKid: "1",
    keys: { "1": keyMaterial.toString("base64url") },
  }),
  "TEST_RING"
);
const bearer = `opsx_1_abcdefghijkl_${"A".repeat(43)}`;

function request(
  authorization = `Bearer ${bearer}`,
  extra: Record<string, string> = {},
  url = "https://app.opsapp.co/v1/intake/submissions"
): Request {
  return new Request(url, {
    headers: {
      authorization,
      ...extra,
    },
  });
}

function authenticatedRow(overrides: Record<string, unknown> = {}) {
  return {
    authenticated: true,
    denial_code: null,
    principal_id: "10000000-0000-4000-8000-000000000001",
    credential_id: "10000000-0000-4000-8000-000000000002",
    company_id: "10000000-0000-4000-8000-000000000003",
    credential_class: "intake",
    scopes: ["intake.write"],
    allowed_source_ids: ["10000000-0000-4000-8000-000000000004"],
    authorization_epoch: 4,
    ...overrides,
  };
}

describe("external API bearer parsing", () => {
  it("accepts only one bounded Authorization bearer value", () => {
    expect(parseExternalApiBearer(request())).toEqual({
      digestVersion: 1,
      secret: bearer,
      visiblePrefix: "opsx_1_abcdefghijkl",
    });

    for (const invalid of [
      request(`Basic ${bearer}`),
      request(`Bearer ${bearer}, Bearer ${bearer}`),
      request(`Bearer malformed`),
      request(`Bearer ${"a".repeat(300)}`),
      request(`Bearer  ${bearer}`),
    ]) {
      expect(() => parseExternalApiBearer(invalid)).toThrow(
        ExternalApiAuthError
      );
    }
  });

  it("rejects cookies and credential-like query parameters", () => {
    expect(() =>
      parseExternalApiBearer(request(`Bearer ${bearer}`, { cookie: "x=1" }))
    ).toThrow("invalid_credentials");
    expect(() =>
      parseExternalApiBearer(
        request(
          `Bearer ${bearer}`,
          {},
          "https://app.opsapp.co/v1/intake/submissions?api_key=leak"
        )
      )
    ).toThrow("invalid_credentials");

    for (const name of [
      "auth_token",
      "client_secret",
      "access-token",
      "credential_value",
    ]) {
      expect(() =>
        parseExternalApiBearer(
          request(
            `Bearer ${bearer}`,
            {},
            `https://app.opsapp.co/v1/intake/submissions?${name}=leak`
          )
        )
      ).toThrow("invalid_credentials");
    }
  });
});

describe("external API credential authentication", () => {
  it("resolves an immutable tenant-bound actor without caller company input", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [authenticatedRow()],
      error: null,
    });
    const actor = await authenticateExternalApiCredential({
      request: request(),
      requiredCredentialClass: "intake",
      requiredScopes: ["intake.write"],
      keyRing: ring,
      client: { rpc },
    });

    const expectedDigest = `\\x${createHmac("sha256", keyMaterial)
      .update(bearer)
      .digest("hex")}`;
    expect(rpc).toHaveBeenCalledWith(
      "authenticate_external_api_credential_as_system",
      {
        p_digest_version: 1,
        p_secret_digest: expectedDigest,
        p_visible_prefix: "opsx_1_abcdefghijkl",
      }
    );
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("company_id");
    expect(actor).toEqual({
      principalId: "10000000-0000-4000-8000-000000000001",
      credentialId: "10000000-0000-4000-8000-000000000002",
      companyId: "10000000-0000-4000-8000-000000000003",
      credentialClass: "intake",
      scopes: ["intake.write"],
      allowedSourceIds: ["10000000-0000-4000-8000-000000000004"],
      authorizationEpoch: 4,
      digestVersion: 1,
      credentialDigest: expect.stringMatching(/^\\x[0-9a-f]{64}$/),
      visiblePrefix: "opsx_1_abcdefghijkl",
    });
    expect(Object.isFrozen(actor)).toBe(true);
    expect(Object.isFrozen(actor.scopes)).toBe(true);
    expect(Object.isFrozen(actor.allowedSourceIds)).toBe(true);
  });

  it.each([
    "invalid_credential",
    "feature_disabled",
    "expired",
    "revoked",
    "overlap_retired",
  ])("maps %s to the same safe credential error", async (denialCode) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          authenticated: false,
          denial_code: denialCode,
          principal_id: null,
          credential_id: null,
          company_id: null,
          credential_class: null,
          scopes: null,
          allowed_source_ids: null,
          authorization_epoch: null,
        },
      ],
      error: null,
    });

    await expect(
      authenticateExternalApiCredential({
        request: request(),
        requiredCredentialClass: "intake",
        requiredScopes: ["intake.write"],
        keyRing: ring,
        client: { rpc },
      })
    ).rejects.toMatchObject({
      code: "invalid_credentials",
      status: 401,
    });
  });

  it("fails safely for the wrong class, missing scope, and database failure", async () => {
    const analyticsRpc = vi.fn().mockResolvedValue({
      data: [
        authenticatedRow({
          credential_class: "analytics",
          scopes: ["analytics.leads.read"],
          allowed_source_ids: [],
        }),
      ],
      error: null,
    });
    await expect(
      authenticateExternalApiCredential({
        request: request(),
        requiredCredentialClass: "intake",
        requiredScopes: ["intake.write"],
        keyRing: ring,
        client: { rpc: analyticsRpc },
      })
    ).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });

    const missingScopeRpc = vi.fn().mockResolvedValue({
      data: [authenticatedRow({ scopes: [] })],
      error: null,
    });
    await expect(
      authenticateExternalApiCredential({
        request: request(),
        requiredCredentialClass: "intake",
        requiredScopes: ["intake.write"],
        keyRing: ring,
        client: { rpc: missingScopeRpc },
      })
    ).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });

    const failedRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "database_unavailable", message: "raw backend detail" },
    });
    await expect(
      authenticateExternalApiCredential({
        request: request(),
        requiredCredentialClass: "intake",
        requiredScopes: ["intake.write"],
        keyRing: ring,
        client: { rpc: failedRpc },
      })
    ).rejects.toMatchObject({
      code: "temporarily_unavailable",
      status: 503,
      message: "temporarily_unavailable",
    });
  });
});
