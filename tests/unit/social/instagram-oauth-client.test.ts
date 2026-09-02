/** @vitest-environment node */

import {
  InstagramOAuthClient,
  InstagramOAuthError,
  createInstagramOAuthClientFromEnv,
} from "@/lib/social/instagram-oauth-client";

const APP_SECRET = "meta-app-secret-never-log";
const SHORT_TOKEN = "short-token-never-log";
const LONG_TOKEN = "long-token-never-log";
const config = {
  appId: "990602627938098",
  appSecret: APP_SECRET,
  redirectUri: "https://app.opsapp.co/api/admin/social/instagram/callback",
  apiVersion: "v25.0",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchSequence(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("Unexpected fetch");
    return next;
  });
}

describe("Instagram OAuth client", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds the official Instagram Login authorization URL", () => {
    const client = new InstagramOAuthClient(config);
    const url = client.authorizationUrl("opaque-state");

    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(config.appId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("scope")?.split(",").sort()).toEqual([
      "instagram_business_basic",
      "instagram_business_content_publish",
    ]);
  });

  it("exchanges, verifies scopes, upgrades, and resolves the professional account", async () => {
    const fetcher = fetchSequence(
      response({
        data: [
          {
            access_token: SHORT_TOKEN,
            user_id: "102000000000000",
            permissions:
              "instagram_business_basic,instagram_business_content_publish",
          },
        ],
      }),
      response({
        access_token: LONG_TOKEN,
        token_type: "bearer",
        expires_in: 5_183_944,
      }),
      response({
        data: [{ user_id: "17841400000000000", username: "opsjournal" }],
      })
    );
    const now = new Date("2026-09-02T20:00:00.000Z");
    const client = new InstagramOAuthClient(config, {
      fetcher,
      now: () => now,
    });

    const result = await client.exchangeAuthorizationCode("single-use-code");

    expect(result).toEqual({
      accessToken: LONG_TOKEN,
      instagramUserId: "17841400000000000",
      username: "opsjournal",
      scopes: [
        "instagram_business_basic",
        "instagram_business_content_publish",
      ],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5_183_944_000).toISOString(),
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const shortBody = fetcher.mock.calls[0][1]?.body as FormData;
    expect(shortBody.get("client_secret")).toBe(APP_SECRET);
    expect(shortBody.get("code")).toBe("single-use-code");
    const profileUrl = fetcher.mock.calls[2][0] as URL;
    expect(profileUrl.toString()).toContain(
      "https://graph.instagram.com/v25.0/me"
    );
    expect(profileUrl.searchParams.get("fields")).toBe("user_id,username");
  });

  it("stops before long-token exchange when required publishing scope is absent", async () => {
    const fetcher = fetchSequence(
      response({
        data: [
          {
            access_token: SHORT_TOKEN,
            user_id: "102000000000000",
            permissions: "instagram_business_basic",
          },
        ],
      })
    );
    const client = new InstagramOAuthClient(config, { fetcher });

    await expect(
      client.exchangeAuthorizationCode("code")
    ).rejects.toMatchObject({
      code: "INSTAGRAM_SCOPE_MISSING",
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refreshes a long-lived token for another validated lifetime", async () => {
    const now = new Date("2026-09-02T20:00:00.000Z");
    const fetcher = fetchSequence(
      response({
        access_token: "rotated-token",
        token_type: "bearer",
        expires_in: 5_184_000,
      })
    );
    const client = new InstagramOAuthClient(config, {
      fetcher,
      now: () => now,
    });

    await expect(client.refreshLongLivedToken(LONG_TOKEN)).resolves.toEqual({
      accessToken: "rotated-token",
      issuedAt: now.toISOString(),
      expiresAt: "2026-11-01T20:00:00.000Z",
    });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/refresh_access_token");
    expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token");
  });

  it("rejects malformed Meta responses and redacts all known secrets", async () => {
    const fetcher = fetchSequence(
      response(
        {
          error: {
            message: `Bad ${APP_SECRET} ${SHORT_TOKEN} single-use-code`,
            code: 190,
          },
        },
        400
      )
    );
    const client = new InstagramOAuthClient(config, { fetcher });

    let caught: unknown;
    try {
      await client.exchangeAuthorizationCode("single-use-code");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InstagramOAuthError);
    expect((caught as Error).message).not.toContain(APP_SECRET);
    expect((caught as Error).message).not.toContain(SHORT_TOKEN);
    expect((caught as Error).message).not.toContain("single-use-code");
  });

  it("fails closed when Meta app credentials are absent", () => {
    vi.stubEnv("INSTAGRAM_APP_ID", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    vi.stubEnv("INSTAGRAM_API_VERSION", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.opsapp.co");

    expect(() => createInstagramOAuthClientFromEnv()).toThrow(
      /INSTAGRAM_APP_ID/
    );
  });
});
