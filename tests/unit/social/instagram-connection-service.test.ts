/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  InstagramConnectionError,
  InstagramConnectionService,
} from "@/lib/social/instagram-connection-service";
import {
  InstagramOAuthClient,
  type InstagramOAuthConnectionResult,
} from "@/lib/social/instagram-oauth-client";
import {
  decryptInstagramToken,
  encryptInstagramToken,
} from "@/lib/social/token-cipher";
import type {
  InstagramConnectionRecord,
  InstagramConnectionRepository,
} from "@/lib/social/instagram-connection-repository";

const NOW = new Date("2026-09-02T20:00:00.000Z");
const connection: InstagramConnectionRecord = {
  instagramUserId: "17841400000000000",
  username: "opsjournal",
  accountType: null,
  accessTokenCiphertext: "encrypted-token",
  requiredScopes: [
    "instagram_business_basic",
    "instagram_business_content_publish",
  ],
  tokenIssuedAt: "2026-08-01T20:00:00.000Z",
  tokenExpiresAt: "2026-09-05T20:00:00.000Z",
  lastRefreshedAt: null,
  lastRefreshErrorCode: null,
  connectedByEmail: "jackson@opsapp.co",
  connectedAt: "2026-08-01T20:00:00.000Z",
};

function repository(): InstagramConnectionRepository {
  return {
    pruneExpired: vi.fn(async () => undefined),
    insert: vi.fn(async () => undefined),
    consume: vi.fn(async () => "jackson@opsapp.co"),
    getConnection: vi.fn(async () => null),
    upsertConnection: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    claimRefresh: vi.fn(async () => null),
    completeRefresh: vi.fn(async () => true),
    releaseRefresh: vi.fn(async () => true),
  };
}

function oauth() {
  return {
    authorizationUrl: vi.fn(
      (state: string) => new URL(`https://instagram.test/login?state=${state}`)
    ),
    exchangeAuthorizationCode: vi.fn(async () => ({
      accessToken: "long-lived-token",
      instagramUserId: connection.instagramUserId,
      username: connection.username,
      scopes: [
        "instagram_business_basic",
        "instagram_business_content_publish",
      ] as InstagramOAuthConnectionResult["scopes"],
      issuedAt: NOW.toISOString(),
      expiresAt: "2026-11-01T20:00:00.000Z",
    })),
    refreshLongLivedToken: vi.fn(async () => ({
      accessToken: "rotated-token",
      issuedAt: NOW.toISOString(),
      expiresAt: "2026-11-01T20:00:00.000Z",
    })),
  };
}

function service(
  overrides: {
    repository?: InstagramConnectionRepository;
    oauth?: ReturnType<typeof oauth>;
    isAdminEmail?: (email: string) => Promise<boolean>;
    encryptToken?: (token: string) => string;
  } = {}
) {
  return new InstagramConnectionService({
    repository: overrides.repository ?? repository(),
    oauth: overrides.oauth ?? oauth(),
    encryptToken: overrides.encryptToken ?? ((token) => `enc:${token}`),
    decryptToken: (token) =>
      token.replace(/^encrypted-token$/, "long-lived-token"),
    isAdminEmail: overrides.isAdminEmail ?? (async () => true),
    createClaimToken: () => "0f41c819-9292-4dd4-9527-55b23af09ba5",
    now: () => NOW,
  });
}

describe("Instagram connection service", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    "state_validation",
    "admin_validation",
    "token_encryption",
    "connection_storage",
  ] as const)(
    "identifies a %s failure without logging arbitrary errors",
    async (stage) => {
      const repo = repository();
      const failure = Object.assign(
        new Error("private-token-and-database-details"),
        {
          code: "private-untrusted-error-code",
          httpStatus: "private-http-value",
          providerCode: "private-provider-value",
        }
      );
      if (stage === "state_validation")
        vi.mocked(repo.consume).mockRejectedValue(failure);
      if (stage === "connection_storage")
        vi.mocked(repo.upsertConnection).mockRejectedValue(failure);
      const subject = service({
        repository: repo,
        isAdminEmail: async () => {
          if (stage === "admin_validation") throw failure;
          return true;
        },
        encryptToken: (token) => {
          if (stage === "token_encryption") throw failure;
          return `enc:${token}`;
        },
      });
      await expect(
        subject.completeAuthorization("opaque-state", "single-use-code")
      ).rejects.toBe(failure);
      expect(console.error).toHaveBeenCalledWith(
        "[admin-social-instagram] Connection completion failed",
        { stage, code: "INSTAGRAM_CONNECTION_FAILED" }
      );
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logged).not.toContain("private-");
      expect(logged).not.toContain("opaque-state");
      expect(logged).not.toContain("single-use-code");
    }
  );

  it("creates an opaque admin-bound authorization handoff", async () => {
    const repo = repository();
    const oauthClient = oauth();
    const subject = service({ repository: repo, oauth: oauthClient });

    const url = await subject.createAuthorizationUrl("JACKSON@OPSAPP.CO");

    expect(url.origin).toBe("https://instagram.test");
    expect(repo.insert).toHaveBeenCalledWith({
      nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      adminEmail: "jackson@opsapp.co",
      expiresAt: "2026-09-02T20:10:00.000Z",
    });
    expect(oauthClient.authorizationUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/)
    );
  });

  it("consumes state, rechecks the admin, encrypts, and stores the verified account", async () => {
    const repo = repository();
    const subject = service({ repository: repo });

    const status = await subject.completeAuthorization(
      "opaque-state",
      "one-time-code"
    );

    expect(repo.consume).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
    expect(repo.upsertConnection).toHaveBeenCalledWith({
      instagramUserId: connection.instagramUserId,
      username: connection.username,
      accountType: null,
      accessTokenCiphertext: "enc:long-lived-token",
      requiredScopes: connection.requiredScopes,
      tokenIssuedAt: NOW.toISOString(),
      tokenExpiresAt: "2026-11-01T20:00:00.000Z",
      connectedByEmail: "jackson@opsapp.co",
    });
    expect(status).toEqual({
      connected: true,
      username: "opsjournal",
      connectedAt: NOW.toISOString(),
      tokenExpiresAt: "2026-11-01T20:00:00.000Z",
      lastRefreshedAt: null,
      needsReconnect: false,
    });
    expect(JSON.stringify(status)).not.toContain("long-lived-token");
  });

  it("fails before exchange for replayed state or a removed admin", async () => {
    const replayRepo = repository();
    vi.mocked(replayRepo.consume).mockResolvedValue(null);
    const replayOAuth = oauth();
    await expect(
      service({
        repository: replayRepo,
        oauth: replayOAuth,
      }).completeAuthorization("replayed", "code")
    ).rejects.toMatchObject({ code: "INSTAGRAM_OAUTH_STATE_INVALID" });
    expect(replayOAuth.exchangeAuthorizationCode).not.toHaveBeenCalled();

    const revokedRepo = repository();
    const revokedOAuth = oauth();
    await expect(
      service({
        repository: revokedRepo,
        oauth: revokedOAuth,
        isAdminEmail: async () => false,
      }).completeAuthorization("valid", "code")
    ).rejects.toMatchObject({ code: "INSTAGRAM_OAUTH_ADMIN_REVOKED" });
    expect(revokedOAuth.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("stores an encrypted renewable connection from direct Meta responses", async () => {
    vi.stubEnv(
      "INSTAGRAM_TOKEN_ENC_KEY",
      Buffer.alloc(32, 7).toString("base64")
    );
    const repo = repository();
    const payloads = [
      {
        access_token: "short-live-fixture",
        user_id: "102000000000000",
        permissions:
          "instagram_business_basic,instagram_business_content_publish",
      },
      { access_token: "long-live-fixture", expires_in: 5_184_000 },
      { user_id: connection.instagramUserId, username: connection.username },
    ];
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (payloads.length === 0) throw new Error("Unexpected Meta request");
      return new Response(JSON.stringify(payloads.shift()), {
        headers: { "content-type": "application/json" },
      });
    });
    const subject = new InstagramConnectionService({
      repository: repo,
      oauth: new InstagramOAuthClient(
        {
          appId: "fixture-app-id",
          appSecret: "fixture-app-secret",
          redirectUri:
            "https://app.opsapp.co/api/admin/social/instagram/callback",
          apiVersion: "v25.0",
        },
        { fetcher, now: () => NOW }
      ),
      encryptToken: encryptInstagramToken,
      decryptToken: decryptInstagramToken,
      isAdminEmail: async () => true,
      createClaimToken: () => "unused-refresh-claim",
      now: () => NOW,
    });

    const status = await subject.completeAuthorization(
      "opaque-state",
      "one-time-code"
    );

    expect(status).toMatchObject({
      connected: true,
      username: connection.username,
      tokenExpiresAt: "2026-11-01T20:00:00.000Z",
      needsReconnect: false,
    });
    expect(repo.upsertConnection).toHaveBeenCalledOnce();
    const stored = vi.mocked(repo.upsertConnection).mock.calls[0][0];
    expect(stored.instagramUserId).toBe(connection.instagramUserId);
    expect(stored.accessTokenCiphertext).toMatch(/^ig-token:v1:/);
    expect(decryptInstagramToken(stored.accessTokenCiphertext)).toBe(
      "long-live-fixture"
    );
    expect(JSON.stringify(stored)).not.toContain("long-live-fixture");
    expect(JSON.stringify(status)).not.toContain("long-live-fixture");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never exposes credentials in public status", async () => {
    const repo = repository();
    vi.mocked(repo.getConnection).mockResolvedValue(connection);

    const status = await service({ repository: repo }).getPublicStatus();

    expect(status).toEqual({
      connected: true,
      username: "opsjournal",
      connectedAt: connection.connectedAt,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastRefreshedAt: null,
      needsReconnect: false,
    });
    expect(JSON.stringify(status)).not.toContain("encrypted-token");
    expect(JSON.stringify(status)).not.toContain(connection.instagramUserId);
  });

  it("marks an expired stored connection as requiring login", async () => {
    const repo = repository();
    vi.mocked(repo.getConnection).mockResolvedValue({
      ...connection,
      tokenExpiresAt: "2026-09-01T20:00:00.000Z",
    });

    await expect(
      service({ repository: repo }).getPublicStatus()
    ).resolves.toEqual({
      connected: false,
      username: "opsjournal",
      reason: "expired",
      needsReconnect: true,
    });
  });

  it("refreshes under the database claim and persists the encrypted replacement", async () => {
    const repo = repository();
    vi.mocked(repo.claimRefresh).mockResolvedValue({
      instagramUserId: connection.instagramUserId,
      username: connection.username,
      accessTokenCiphertext: connection.accessTokenCiphertext,
      tokenIssuedAt: connection.tokenIssuedAt,
      tokenExpiresAt: connection.tokenExpiresAt,
    });
    const oauthClient = oauth();

    await service({ repository: repo, oauth: oauthClient }).refreshIfDue();

    expect(oauthClient.refreshLongLivedToken).toHaveBeenCalledWith(
      "long-lived-token"
    );
    expect(repo.completeRefresh).toHaveBeenCalledWith({
      claimToken: "0f41c819-9292-4dd4-9527-55b23af09ba5",
      accessTokenCiphertext: "enc:rotated-token",
      tokenIssuedAt: NOW.toISOString(),
      tokenExpiresAt: "2026-11-01T20:00:00.000Z",
    });
  });

  it("releases a failed refresh lease without persisting secret-bearing errors", async () => {
    const repo = repository();
    vi.mocked(repo.claimRefresh).mockResolvedValue({
      instagramUserId: connection.instagramUserId,
      username: connection.username,
      accessTokenCiphertext: connection.accessTokenCiphertext,
      tokenIssuedAt: connection.tokenIssuedAt,
      tokenExpiresAt: connection.tokenExpiresAt,
    });
    const oauthClient = oauth();
    oauthClient.refreshLongLivedToken.mockRejectedValue(
      new InstagramConnectionError(
        "META_REJECTED",
        "Secret long-lived-token was rejected",
        true
      )
    );

    await expect(
      service({ repository: repo, oauth: oauthClient }).refreshIfDue()
    ).rejects.toThrow();
    expect(repo.releaseRefresh).toHaveBeenCalledWith({
      claimToken: "0f41c819-9292-4dd4-9527-55b23af09ba5",
      errorCode: "INSTAGRAM_REFRESH_FAILED",
      errorMessage: "Instagram credential refresh failed",
    });
  });
});
