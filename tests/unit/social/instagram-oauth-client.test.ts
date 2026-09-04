/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
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
  return vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("Unexpected fetch");
    return next;
  });
}

describe("Instagram OAuth client", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    { stage: "code_exchange", before: [] },
    {
      stage: "token_upgrade",
      before: [
        {
          data: [
            {
              access_token: SHORT_TOKEN,
              permissions:
                "instagram_business_basic,instagram_business_content_publish",
            },
          ],
        },
      ],
    },
    {
      stage: "profile_lookup",
      before: [
        {
          data: [
            {
              access_token: SHORT_TOKEN,
              permissions:
                "instagram_business_basic,instagram_business_content_publish",
            },
          ],
        },
        { access_token: LONG_TOKEN, expires_in: 5_184_000 },
      ],
    },
  ])(
    "identifies a Meta rejection at $stage without exposing the response",
    async ({ stage, before }) => {
      const fetcher = fetchSequence(
        ...before.map((body) => response(body)),
        response(
          {
            error: {
              code: 190,
              error_subcode: 460,
              message: `${APP_SECRET} ${SHORT_TOKEN} ${LONG_TOKEN} single-use-code`,
              fbtrace_id: "private-provider-trace",
            },
          },
          400
        )
      );
      const client = new InstagramOAuthClient(config, { fetcher });

      await expect(
        client.exchangeAuthorizationCode("single-use-code")
      ).rejects.toMatchObject({
        code: "INSTAGRAM_OAUTH_REJECTED",
        httpStatus: 400,
      });
      expect(console.error).toHaveBeenCalledWith(
        "[admin-social-instagram] OAuth exchange failed",
        {
          stage,
          code: "INSTAGRAM_OAUTH_REJECTED",
          httpStatus: 400,
          providerCode: 190,
          providerSubcode: 460,
        }
      );
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
      for (const secret of [
        APP_SECRET,
        SHORT_TOKEN,
        LONG_TOKEN,
        "single-use-code",
        "private-provider-trace",
      ])
        expect(logged).not.toContain(secret);
    }
  );

  it("identifies malformed token responses using only a fixed shape label", async () => {
    const client = new InstagramOAuthClient(config, {
      fetcher: fetchSequence(response({ unexpected: SHORT_TOKEN })),
    });
    await expect(
      client.exchangeAuthorizationCode("single-use-code")
    ).rejects.toMatchObject({
      code: "INSTAGRAM_OAUTH_RESPONSE_INVALID",
    });
    expect(console.error).toHaveBeenCalledWith(
      "[admin-social-instagram] OAuth exchange failed",
      {
        stage: "code_exchange",
        code: "INSTAGRAM_OAUTH_RESPONSE_INVALID",
        responseShape: "object",
      }
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      SHORT_TOKEN
    );
  });

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

  it.each([
    {
      stage: "token_upgrade",
      invalidJson: false,
      code: "INSTAGRAM_OAUTH_RESPONSE_INVALID",
      shape: "object",
    },
    {
      stage: "token_upgrade",
      invalidJson: true,
      code: "INSTAGRAM_OAUTH_RESPONSE_INVALID",
      shape: "unavailable",
    },
    {
      stage: "profile_lookup",
      invalidJson: false,
      code: "INSTAGRAM_PROFILE_INVALID",
      shape: "data_array",
    },
    {
      stage: "profile_lookup",
      invalidJson: true,
      code: "INSTAGRAM_OAUTH_RESPONSE_INVALID",
      shape: "unavailable",
    },
  ])(
    "reports the current response at $stage (invalid JSON: $invalidJson)",
    async ({ stage, invalidJson, code, shape }) => {
      const responses = [
        response({
          data: [
            {
              access_token: SHORT_TOKEN,
              permissions:
                "instagram_business_basic,instagram_business_content_publish",
            },
          ],
        }),
      ];
      if (stage === "profile_lookup")
        responses.push(
          response({ access_token: LONG_TOKEN, expires_in: 5_184_000 })
        );
      responses.push(
        invalidJson
          ? new Response("private-invalid-json")
          : stage === "token_upgrade"
            ? response({ access_token: LONG_TOKEN, expires_in: 0 })
            : response({ data: [] })
      );
      const client = new InstagramOAuthClient(config, {
        fetcher: fetchSequence(...responses),
      });

      await expect(
        client.exchangeAuthorizationCode("single-use-code")
      ).rejects.toMatchObject({ code });
      expect(console.error).toHaveBeenCalledWith(
        "[admin-social-instagram] OAuth exchange failed",
        {
          stage,
          code,
          responseShape: shape,
          ...(invalidJson ? { httpStatus: 200 } : {}),
        }
      );
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
      for (const secret of [
        SHORT_TOKEN,
        LONG_TOKEN,
        "private-invalid-json",
        "single-use-code",
      ])
        expect(logged).not.toContain(secret);
    }
  );

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

    expect(console.error).not.toHaveBeenCalled();
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

  it.each([
    { tokenWrapped: false, profileWrapped: false },
    { tokenWrapped: false, profileWrapped: true },
    { tokenWrapped: true, profileWrapped: false },
    { tokenWrapped: true, profileWrapped: true },
  ])(
    "connects with token wrapper $tokenWrapped and profile wrapper $profileWrapped",
    async ({ tokenWrapped, profileWrapped }) => {
      const token = {
        access_token: SHORT_TOKEN,
        user_id: "102000000000000",
        permissions: tokenWrapped
          ? ["instagram_business_basic", "instagram_business_content_publish"]
          : "instagram_business_basic,instagram_business_content_publish",
      };
      const profile = {
        user_id: "17841400000000000",
        username: "opsjournal",
      };
      const fetcher = fetchSequence(
        response(tokenWrapped ? { data: [token] } : token),
        response({ access_token: LONG_TOKEN, expires_in: 5_184_000 }),
        response(profileWrapped ? { data: [profile] } : profile)
      );
      const client = new InstagramOAuthClient(config, { fetcher });

      await expect(
        client.exchangeAuthorizationCode("single-use-code")
      ).resolves.toMatchObject({
        accessToken: LONG_TOKEN,
        instagramUserId: profile.user_id,
        username: profile.username,
        scopes: [
          "instagram_business_basic",
          "instagram_business_content_publish",
        ],
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(console.error).not.toHaveBeenCalled();
    }
  );

  it.each(
    [
      undefined,
      null,
      [],
      "instagram_business_basic",
      ["instagram_business_basic"],
      { instagram_business_content_publish: true },
    ].map((permissions) => ({ permissions }))
  )(
    "rejects a direct token without both granted scopes: $permissions",
    async ({ permissions }) => {
      const fetcher = fetchSequence(
        response({ access_token: SHORT_TOKEN, permissions })
      );
      const client = new InstagramOAuthClient(config, { fetcher });

      await expect(
        client.exchangeAuthorizationCode("code")
      ).rejects.toMatchObject({
        code: "INSTAGRAM_SCOPE_MISSING",
        retryable: false,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        SHORT_TOKEN
      );
    }
  );

  it.each(
    [
      null,
      [],
      "invalid",
      { access_token: "" },
      { access_token: 123 },
      { data: [] },
      { data: [null] },
      { data: [[]] },
      {
        data: [
          {
            access_token: SHORT_TOKEN,
            permissions:
              "instagram_business_basic,instagram_business_content_publish",
          },
          {
            access_token: "other-token",
            permissions:
              "instagram_business_basic,instagram_business_content_publish",
          },
        ],
      },
      { data: { access_token: SHORT_TOKEN } },
      {
        data: [],
        access_token: SHORT_TOKEN,
        permissions:
          "instagram_business_basic,instagram_business_content_publish",
      },
    ].map((payload) => ({ payload }))
  )(
    "rejects malformed or ambiguous token records: $payload",
    async ({ payload }) => {
      const fetcher = fetchSequence(response(payload));
      const client = new InstagramOAuthClient(config, { fetcher });

      await expect(
        client.exchangeAuthorizationCode("code")
      ).rejects.toMatchObject({
        code: "INSTAGRAM_OAUTH_RESPONSE_INVALID",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each(
    [
      null,
      [],
      "invalid",
      {},
      { id: "102000000000000", username: "opsjournal" },
      { user_id: "17841400000000000", username: " " },
      { user_id: 17841400000000000, username: "opsjournal" },
      { data: [] },
      { data: [null] },
      { data: { user_id: "17841400000000000", username: "opsjournal" } },
      {
        data: [
          { user_id: "17841400000000000", username: "opsjournal" },
          { user_id: "17841400000000001", username: "otheraccount" },
        ],
      },
      { data: [], user_id: "17841400000000000", username: "opsjournal" },
    ].map((profile) => ({ profile }))
  )(
    "rejects malformed or ambiguous profile records: $profile",
    async ({ profile }) => {
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
        response({ access_token: LONG_TOKEN, expires_in: 5_184_000 }),
        response(profile)
      );
      const client = new InstagramOAuthClient(config, { fetcher });

      await expect(
        client.exchangeAuthorizationCode("code")
      ).rejects.toMatchObject({
        code: "INSTAGRAM_PROFILE_INVALID",
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logged).not.toContain(SHORT_TOKEN);
      expect(logged).not.toContain(LONG_TOKEN);
    }
  );

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
