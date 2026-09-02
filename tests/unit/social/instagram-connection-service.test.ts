/** @vitest-environment node */

import {
  InstagramConnectionError,
  InstagramConnectionService,
} from "@/lib/social/instagram-connection-service";
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
    authorizationUrl: vi.fn((state: string) => new URL(`https://instagram.test/login?state=${state}`)),
    exchangeAuthorizationCode: vi.fn(async () => ({
      accessToken: "long-lived-token",
      instagramUserId: connection.instagramUserId,
      username: connection.username,
      scopes: [...connection.requiredScopes],
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

function service(overrides: {
  repository?: InstagramConnectionRepository;
  oauth?: ReturnType<typeof oauth>;
  isAdminEmail?: (email: string) => Promise<boolean>;
} = {}) {
  return new InstagramConnectionService({
    repository: overrides.repository ?? repository(),
    oauth: overrides.oauth ?? oauth(),
    encryptToken: (token) => `enc:${token}`,
    decryptToken: (token) => token.replace(/^encrypted-token$/, "long-lived-token"),
    isAdminEmail: overrides.isAdminEmail ?? (async () => true),
    createClaimToken: () => "0f41c819-9292-4dd4-9527-55b23af09ba5",
    now: () => NOW,
  });
}

describe("Instagram connection service", () => {
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

    const status = await subject.completeAuthorization("opaque-state", "one-time-code");

    expect(repo.consume).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/));
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
      service({ repository: replayRepo, oauth: replayOAuth }).completeAuthorization(
        "replayed",
        "code"
      )
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

    await expect(service({ repository: repo }).getPublicStatus()).resolves.toEqual({
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

    expect(oauthClient.refreshLongLivedToken).toHaveBeenCalledWith("long-lived-token");
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
