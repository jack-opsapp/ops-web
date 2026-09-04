import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createSageOAuthSecrets,
  digestSageOAuthState,
  discoverEligibleSageBusinesses,
  exchangeSageAuthorizationCode,
  refreshSageOAuthGrant,
  SageOAuthError,
} from "../sage-oauth-service";

const credentials = {
  clientId: "sandbox-client",
  clientSecret: "sandbox-secret",
  redirectUri: "https://example.test/api/integrations/sage/callback",
  environment: "sandbox" as const,
};

function response(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "x-request-id": "sage-r1" },
  });
}

describe("Sage OAuth PKCE", () => {
  it("creates opaque state and an S256 verifier/challenge pair", () => {
    const secrets = createSageOAuthSecrets();
    const expectedChallenge = createHash("sha256")
      .update(secrets.verifier)
      .digest("base64url");

    expect(secrets.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.challenge).toBe(expectedChallenge);
    expect(secrets.state).not.toContain(":");
    expect(digestSageOAuthState(secrets.state)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Sage OAuth provider calls", () => {
  it("exchanges an authorization code with PKCE and exact profile credentials", async () => {
    const fetchFn = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        response(200, {
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 300,
          token_type: "bearer",
        })
    );

    const grant = await exchangeSageAuthorizationCode(
      { code: "code-1", verifier: "verifier-1", credentials },
      fetchFn
    );

    expect(grant).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresInSeconds: 300,
    });
    const [, init] = fetchFn.mock.calls[0];
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("code_verifier")).toBe("verifier-1");
    expect(body.get("client_id")).toBe("sandbox-client");
    expect(body.get("client_secret")).toBe("sandbox-secret");
  });

  it("rejects malformed success payloads and never exposes provider bodies", async () => {
    const malformedFetch = vi.fn(async () =>
      response(200, { access_token: "x" })
    );
    await expect(
      exchangeSageAuthorizationCode(
        { code: "code", verifier: "verifier", credentials },
        malformedFetch
      )
    ).rejects.toMatchObject({ code: "invalid_response" });

    const failedFetch = vi.fn(async () =>
      response(400, { error: "bad", client_secret: "do-not-expose" })
    );
    let error: SageOAuthError | undefined;
    try {
      await exchangeSageAuthorizationCode(
        { code: "code", verifier: "verifier", credentials },
        failedFetch
      );
    } catch (caught) {
      error = caught as SageOAuthError;
    }
    expect(error).toBeInstanceOf(SageOAuthError);
    if (!error) throw new Error("expected SageOAuthError");
    expect(error.message).toBe("Sage token exchange failed (HTTP 400)");
    expect(error.message).not.toContain("do-not-expose");
    expect(error.requestId).toBe("sage-r1");
  });

  it("keeps only active, structurally valid, allow-listed sandbox businesses", async () => {
    const fetchFn = vi.fn(async () =>
      response(200, {
        $items: [
          { id: "allowed-a", name: "Test A", subscription_status: "ACTIVE" },
          { id: "blocked", name: "Test B", subscription_status: "ACTIVE" },
          { id: "inactive", name: "Old", subscription_status: "CANCELLED" },
          { id: "", name: "Broken", subscription_status: "ACTIVE" },
        ],
      })
    );

    await expect(
      discoverEligibleSageBusinesses(
        {
          accessToken: "access",
          environment: "sandbox",
          allowedSandboxBusinessIds: ["allowed-a"],
        },
        fetchFn
      )
    ).resolves.toEqual([{ id: "allowed-a", name: "Test A" }]);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/businesses"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access" }),
      })
    );
  });

  it("fails closed when a sandbox profile has no business allow-list", async () => {
    const fetchFn = vi.fn();
    await expect(
      discoverEligibleSageBusinesses(
        {
          accessToken: "access",
          environment: "sandbox",
          allowedSandboxBusinessIds: [],
        },
        fetchFn
      )
    ).rejects.toMatchObject({ code: "sandbox_allow_list_missing" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("requires Sage to rotate the refresh token", async () => {
    const fetchFn = vi.fn(async () =>
      response(200, { access_token: "new-access", expires_in: 300 })
    );

    await expect(
      refreshSageOAuthGrant({ refreshToken: "spent", credentials }, fetchFn)
    ).rejects.toMatchObject({ code: "missing_rotated_refresh_token" });
  });
});
