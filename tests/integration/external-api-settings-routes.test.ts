import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  verifyAdminAuthMock,
  findUserByAuthMock,
  checkPermissionByIdMock,
  getOverridesMock,
  rpcMock,
  createCredentialSecretMock,
  readCredentialKeyRingMock,
} = vi.hoisted(() => ({
  verifyAdminAuthMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  checkPermissionByIdMock: vi.fn(),
  getOverridesMock: vi.fn(),
  rpcMock: vi.fn(),
  createCredentialSecretMock: vi.fn(),
  readCredentialKeyRingMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    getOverrides: getOverridesMock,
  },
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ rpc: rpcMock }),
}));

vi.mock("@/lib/external-api/auth/credential-secret", () => ({
  readExternalApiCredentialHmacKeyRing: readCredentialKeyRingMock,
  createCredentialSecret: createCredentialSecretMock,
}));

import { GET as getSettings } from "@/app/api/settings/external-api/route";
import { POST as createSource } from "@/app/api/settings/external-api/sources/route";
import { PATCH as updateSource } from "@/app/api/settings/external-api/sources/[sourceId]/route";
import { POST as createCredential } from "@/app/api/settings/external-api/credentials/route";
import { PATCH as updateCredential } from "@/app/api/settings/external-api/credentials/[credentialId]/route";
import { POST as rotateCredential } from "@/app/api/settings/external-api/credentials/[credentialId]/rotate/route";
import { POST as revokeCredential } from "@/app/api/settings/external-api/credentials/[credentialId]/revoke/route";

const USER_ID = "9f8c11d6-3a0b-4edf-aac8-24deff7d5a44";
const COMPANY_ID = "dcd6a54d-ea24-40c7-9801-b2b52aac7fce";
const SOURCE_ID = "a45b37e7-c226-40f8-9c53-479838d3d170";
const FORM_ID = "0854859f-eab9-4e7c-874a-c9d176852b92";
const CREDENTIAL_ID = "a8531078-5dd0-4ac6-bf28-ab9115ce7a42";
const NEW_CREDENTIAL_ID = "a6bffad8-9682-4de7-b903-4f7f70b7c2c1";
const NOW = "2026-07-26T20:00:00.000Z";
const FUTURE = "2027-07-26T20:00:00.000Z";
const RAW_SECRET =
  "opsx_7_testprefix_RawCredentialMaterialThatMustOnlyAppearOnce";

const sourceResult = {
  sourceId: SOURCE_ID,
  integrationType: "website",
  siteLabel: "Main website",
  canonicalHost: "example.com",
  defaultPhoneRegion: "CA",
  allowedBrowserOrigins: ["https://example.com"],
  defaultCoarseSource: "website",
  defaultIntakeOwnerId: USER_ID,
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
  forms: [
    {
      formId: FORM_ID,
      key: "default",
      label: "Default",
      isDefault: true,
      active: true,
    },
  ],
};

const credentialResult = {
  credentialId: CREDENTIAL_ID,
  principalId: "91966341-5309-42ad-b642-a02384c3f68b",
  name: "Website intake",
  class: "intake",
  scopes: ["intake.write"],
  sourceIds: [SOURCE_ID],
  prefix: "opsx_7_testprefix",
  status: "active",
  createdByUserId: USER_ID,
  createdAt: NOW,
  updatedAt: NOW,
  lastUsedAt: null,
  expiresAt: FUTURE,
  overlapUntil: null,
  rejectionCount: 0,
  recentRejectionCount: 0,
  authorizationEpoch: 1,
};

function request(
  pathname: string,
  method = "GET",
  body?: Record<string, unknown>
): NextRequest {
  return new NextRequest(`https://ops.test${pathname}`, {
    method,
    headers: {
      authorization: "Bearer firebase-token",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

function rpcData(data: unknown) {
  return Promise.resolve({ data, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyAdminAuthMock.mockResolvedValue({
    uid: "firebase-uid",
    email: "legacy-email@example.com",
  });
  findUserByAuthMock.mockResolvedValue({
    id: USER_ID,
    company_id: COMPANY_ID,
    is_active: true,
    deleted_at: null,
  });
  checkPermissionByIdMock.mockResolvedValue(true);
  getOverridesMock.mockResolvedValue([
    {
      companyId: COMPANY_ID,
      featureKey: "external_api",
      enabled: true,
    },
  ]);
  readCredentialKeyRingMock.mockReturnValue({ activeKid: 7, keys: new Map() });
  createCredentialSecretMock.mockReturnValue({
    secret: RAW_SECRET,
    visiblePrefix: "opsx_7_testprefix",
    digestVersion: 7,
    lookupDigest: Buffer.alloc(32, 9),
  });
  rpcMock.mockImplementation((name: string) => {
    if (name === "list_external_api_settings_as_system") {
      return rpcData({
        featureEnabled: true,
        sources: [sourceResult],
        credentials: [credentialResult],
      });
    }
    if (name === "create_lead_intake_source_as_system") {
      return rpcData(sourceResult);
    }
    if (name === "update_lead_intake_source_as_system") {
      return rpcData({ ...sourceResult, siteLabel: "Updated website" });
    }
    if (name === "create_external_api_credential_as_system") {
      return rpcData(credentialResult);
    }
    if (name === "update_external_api_credential_as_system") {
      return rpcData({ ...credentialResult, name: "Renamed key" });
    }
    if (name === "rotate_external_api_credential_as_system") {
      return rpcData({
        ...credentialResult,
        credentialId: NEW_CREDENTIAL_ID,
        replacesCredentialId: CREDENTIAL_ID,
      });
    }
    if (name === "revoke_external_api_credential_as_system") {
      return rpcData({
        credentialId: CREDENTIAL_ID,
        principalId: credentialResult.principalId,
        status: "revoked",
        revokedAt: NOW,
        authorizationEpoch: 2,
        idempotent: false,
      });
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
});

describe("Website API settings actor", () => {
  it("resolves only a cryptographically linked active actor and never uses email fallback", async () => {
    const response = await getSettings(
      request("/api/settings/external-api?companyId=attacker-company")
    );

    expect(response.status).toBe(200);
    expect(findUserByAuthMock).toHaveBeenCalledWith(
      "firebase-uid",
      undefined,
      "id, company_id, is_active, deleted_at"
    );
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      USER_ID,
      "settings.integrations",
      "all"
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "list_external_api_settings_as_system",
      { p_actor_user_id: USER_ID }
    );
  });

  it.each([
    ["missing authentication", null, true, true, 401],
    ["unlinked identity", { uid: "firebase-uid" }, null, true, 403],
    [
      "inactive actor",
      { uid: "firebase-uid" },
      { id: USER_ID, company_id: COMPANY_ID, is_active: false },
      true,
      403,
    ],
  ])(
    "fails closed for %s",
    async (_label, auth, actor, permission, expectedStatus) => {
      verifyAdminAuthMock.mockResolvedValue(auth);
      findUserByAuthMock.mockResolvedValue(actor);
      checkPermissionByIdMock.mockResolvedValue(permission);

      const response = await getSettings(request("/api/settings/external-api"));

      expect(response.status).toBe(expectedStatus);
      expect(rpcMock).not.toHaveBeenCalled();
    }
  );

  it("fails closed without all-company integration permission", async () => {
    checkPermissionByIdMock.mockResolvedValue(false);

    const response = await getSettings(request("/api/settings/external-api"));

    expect(response.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed when the pilot flag is off or cannot be read", async () => {
    getOverridesMock.mockResolvedValue([]);
    const disabled = await getSettings(request("/api/settings/external-api"));
    expect(disabled.status).toBe(404);

    getOverridesMock.mockRejectedValue(new Error("database unavailable"));
    const unavailable = await getSettings(
      request("/api/settings/external-api")
    );
    expect(unavailable.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not expose guarded RPC errors or secret material", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: `denied ${RAW_SECRET}`,
        details: RAW_SECRET,
      },
    });

    const response = await getSettings(request("/api/settings/external-api"));
    const text = await response.text();

    expect(response.status).toBe(403);
    expect(text).not.toContain(RAW_SECRET);
    expect(text).not.toContain("42501");
  });
});

describe("Website API settings projection", () => {
  it("returns only allowlisted source and credential health fields", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        featureEnabled: true,
        companyId: COMPANY_ID,
        secret: RAW_SECRET,
        secretDigest: RAW_SECRET,
        sources: [
          {
            ...sourceResult,
            internalSourceId: "private-source",
            secret: RAW_SECRET,
          },
        ],
        credentials: [
          {
            ...credentialResult,
            secret: RAW_SECRET,
            secretDigest: RAW_SECRET,
            companyId: COMPANY_ID,
          },
        ],
      },
      error: null,
    });

    const response = await getSettings(request("/api/settings/external-api"));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain(RAW_SECRET);
    expect(serialized).not.toContain("secretDigest");
    expect(serialized).not.toContain("internalSourceId");
    expect(serialized).not.toContain(COMPANY_ID);
    expect(body.sources[0].sourceId).toBe(SOURCE_ID);
    expect(body.sources[0].forms).toContainEqual(
      expect.objectContaining({ key: "default", isDefault: true })
    );
    expect(body.credentials[0]).toEqual(
      expect.objectContaining({
        prefix: "opsx_7_testprefix",
        lastUsedAt: null,
        rejectionCount: 0,
        recentRejectionCount: 0,
      })
    );
    expect(body.credentials[0].principalId).toBeUndefined();
    expect(body.credentials[0].authorizationEpoch).toBeUndefined();
  });

  it("fails closed when a source projection lacks the required default form", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        featureEnabled: true,
        sources: [{ ...sourceResult, forms: [] }],
        credentials: [],
      },
      error: null,
    });

    const response = await getSettings(request("/api/settings/external-api"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Settings unavailable" });
  });

  it("rejects credential material hidden inside an otherwise allowlisted field", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        featureEnabled: true,
        sources: [sourceResult],
        credentials: [{ ...credentialResult, name: RAW_SECRET }],
      },
      error: null,
    });

    const response = await getSettings(request("/api/settings/external-api"));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain(RAW_SECRET);
  });

  it("fails closed when credential health is incomplete", async () => {
    const { recentRejectionCount: _missing, ...incompleteCredential } =
      credentialResult;
    rpcMock.mockResolvedValueOnce({
      data: {
        featureEnabled: true,
        sources: [sourceResult],
        credentials: [incompleteCredential],
      },
      error: null,
    });

    const response = await getSettings(request("/api/settings/external-api"));

    expect(response.status).toBe(500);
  });
});

describe("Website lead source management", () => {
  it("creates a source through the guarded RPC without accepting a company ID", async () => {
    const response = await createSource(
      request("/api/settings/external-api/sources", "POST", {
        siteLabel: "Main website",
        canonicalHost: "example.com",
        defaultPhoneRegion: "CA",
        allowedBrowserOrigins: ["https://example.com"],
        defaultCoarseSource: "website",
        defaultIntakeOwnerId: USER_ID,
        forms: [{ key: "quote", label: "Quote request", active: true }],
      })
    );

    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_lead_intake_source_as_system",
      expect.objectContaining({
        p_actor_user_id: USER_ID,
        p_canonical_host: "example.com",
        p_forms: [{ key: "quote", label: "Quote request", active: true }],
      })
    );
    expect((await response.json()).forms[0].key).toBe("default");

    const rejected = await createSource(
      request("/api/settings/external-api/sources", "POST", {
        companyId: COMPANY_ID,
        siteLabel: "Main website",
      })
    );
    expect(rejected.status).toBe(400);
  });

  it("updates by opaque source ID and preserves guarded optimistic concurrency", async () => {
    const response = await updateSource(
      request(`/api/settings/external-api/sources/${SOURCE_ID}`, "PATCH", {
        expectedUpdatedAt: NOW,
        siteLabel: "Updated website",
        canonicalHost: "example.com",
        defaultPhoneRegion: "CA",
        allowedBrowserOrigins: ["https://example.com"],
        defaultCoarseSource: "website",
        defaultIntakeOwnerId: null,
        active: true,
        forms: null,
      }),
      params({ sourceId: SOURCE_ID })
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "update_lead_intake_source_as_system",
      expect.objectContaining({
        p_actor_user_id: USER_ID,
        p_source_id: SOURCE_ID,
        p_expected_updated_at: NOW,
      })
    );
  });
});

describe("Website API credential lifecycle", () => {
  it("rejects simple cross-site form content before parsing a mutation", async () => {
    const response = await createCredential(
      new NextRequest(
        "https://ops.test/api/settings/external-api/credentials",
        {
          method: "POST",
          headers: {
            authorization: "Bearer firebase-token",
            "content-type": "text/plain",
          },
          body: JSON.stringify({
            name: "Website intake",
            class: "intake",
            scopes: ["intake.write"],
            sourceIds: [SOURCE_ID],
            expiresAt: FUTURE,
          }),
        }
      )
    );

    expect(response.status).toBe(415);
    expect(createCredentialSecretMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("creates an intake key, persists only its digest, and reveals the raw secret once", async () => {
    const response = await createCredential(
      request("/api/settings/external-api/credentials", "POST", {
        name: "Website intake",
        class: "intake",
        scopes: ["intake.write"],
        sourceIds: [SOURCE_ID],
        expiresAt: FUTURE,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.secret).toBe(RAW_SECRET);
    expect(body.credential.secret).toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith(
      "create_external_api_credential_as_system",
      expect.objectContaining({
        p_actor_user_id: USER_ID,
        p_credential_class: "intake",
        p_scopes: ["intake.write"],
        p_source_ids: [SOURCE_ID],
        p_digest_version: 7,
        p_secret_digest: `\\x${Buffer.alloc(32, 9).toString("hex")}`,
        p_visible_prefix: "opsx_7_testprefix",
      })
    );
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain(RAW_SECRET);

    const listResponse = await getSettings(
      request("/api/settings/external-api")
    );
    expect(await listResponse.text()).not.toContain(RAW_SECRET);
  });

  it.each([
    {
      name: "raw credential material in its display name",
      body: {
        name: RAW_SECRET,
        class: "intake",
        scopes: ["intake.write"],
        sourceIds: [SOURCE_ID],
        expiresAt: FUTURE,
      },
    },
    {
      name: "intake key with analytics scope",
      body: {
        name: "Bad intake",
        class: "intake",
        scopes: ["intake.write", "analytics.leads.read"],
        sourceIds: [SOURCE_ID],
        expiresAt: FUTURE,
      },
    },
    {
      name: "analytics key with intake scope",
      body: {
        name: "Bad analytics",
        class: "analytics",
        scopes: ["intake.write"],
        sourceIds: [],
        expiresAt: FUTURE,
      },
    },
    {
      name: "financial scope without lead scope",
      body: {
        name: "Bad financial",
        class: "analytics",
        scopes: ["analytics.financial.read"],
        sourceIds: [],
        expiresAt: FUTURE,
      },
    },
  ])("rejects $name before secret generation or an RPC", async ({ body }) => {
    const response = await createCredential(
      request("/api/settings/external-api/credentials", "POST", body)
    );

    expect(response.status).toBe(400);
    expect(createCredentialSecretMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("allows PATCH to rename or change future expiry only", async () => {
    const response = await updateCredential(
      request(
        `/api/settings/external-api/credentials/${CREDENTIAL_ID}`,
        "PATCH",
        {
          expectedUpdatedAt: NOW,
          name: "Renamed key",
          expiresAt: FUTURE,
        }
      ),
      params({ credentialId: CREDENTIAL_ID })
    );

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "update_external_api_credential_as_system",
      {
        p_actor_user_id: USER_ID,
        p_credential_id: CREDENTIAL_ID,
        p_expected_updated_at: NOW,
        p_name: "Renamed key",
        p_expires_at: FUTURE,
      }
    );

    const classMutation = await updateCredential(
      request(
        `/api/settings/external-api/credentials/${CREDENTIAL_ID}`,
        "PATCH",
        {
          expectedUpdatedAt: NOW,
          name: "Renamed key",
          expiresAt: FUTURE,
          class: "analytics",
          companyId: COMPANY_ID,
        }
      ),
      params({ credentialId: CREDENTIAL_ID })
    );
    expect(classMutation.status).toBe(400);
  });

  it("rotates through the guarded RPC and reveals only the replacement secret", async () => {
    const response = await rotateCredential(
      request(
        `/api/settings/external-api/credentials/${CREDENTIAL_ID}/rotate`,
        "POST",
        {
          expectedUpdatedAt: NOW,
          overlapSeconds: 900,
          expiresAt: FUTURE,
        }
      ),
      params({ credentialId: CREDENTIAL_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.secret).toBe(RAW_SECRET);
    expect(body.credential.credentialId).toBe(NEW_CREDENTIAL_ID);
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain(RAW_SECRET);
  });

  it("revokes immediately and preserves an idempotent guarded result", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        credentialId: CREDENTIAL_ID,
        principalId: credentialResult.principalId,
        status: "revoked",
        revokedAt: NOW,
        authorizationEpoch: 2,
        idempotent: true,
      },
      error: null,
    });

    const response = await revokeCredential(
      request(
        `/api/settings/external-api/credentials/${CREDENTIAL_ID}/revoke`,
        "POST",
        { reasonCode: "owner_revoked" }
      ),
      params({ credentialId: CREDENTIAL_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("revoked");
    expect(body.idempotent).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "revoke_external_api_credential_as_system",
      {
        p_actor_user_id: USER_ID,
        p_credential_id: CREDENTIAL_ID,
        p_reason_code: "owner_revoked",
      }
    );
  });
});
