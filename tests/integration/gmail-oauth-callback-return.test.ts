/**
 * Gmail OAuth callback — returnTo round-trip behavior.
 *
 * The pipeline connect banner starts the OAuth flow with returnTo=/pipeline
 * persisted behind an opaque one-time nonce. These tests pin the callback's redirect
 * contract:
 *   - success with a valid returnTo → `${returnTo}?connected=gmail`
 *   - denial/failure with a valid returnTo → `${returnTo}?connect_error=1`
 *   - hostile returnTo values in state → fall back to the /settings landing
 *   - no returnTo → legacy /settings landing preserved exactly
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumeState, persistConnection, requireAccess } = vi.hoisted(() => ({
  consumeState: vi.fn(),
  persistConnection: vi.fn(),
  requireAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({}),
}));

vi.mock("@/lib/email/email-oauth-state", () => ({
  consumeEmailOAuthState: consumeState,
}));

vi.mock("@/lib/email/email-oauth-connection", () => ({
  persistEmailOAuthConnection: persistConnection,
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: requireAccess,
}));

const APP_URL = "https://app.ops.test";

function callbackRequest(params: Record<string, string>) {
  const url = new URL(`${APP_URL}/api/integrations/gmail/callback`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString()) as never;
}

async function GET() {
  return (await import("@/app/api/integrations/gmail/callback/route")).GET;
}

function mockTokenExchangeSuccess() {
  const providerFetch = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
          }),
          { status: 200 }
        );
      }
      if (url.includes("gmail.googleapis.com/gmail/v1/users/me/profile")) {
        return new Response(
          JSON.stringify({ emailAddress: "owner@ops.test" }),
          {
            status: 200,
          }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  );
  vi.stubGlobal("fetch", providerFetch);
  return providerFetch;
}

describe("GET /api/integrations/gmail/callback returnTo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "client-secret");
    requireAccess.mockResolvedValue(null);
    persistConnection.mockResolvedValue(undefined);
  });

  it("redirects success to returnTo with ?connected=gmail", async () => {
    const providerFetch = mockTokenExchangeSuccess();
    consumeState.mockResolvedValue({
      companyId: "co-1",
      userId: "user-1",
      type: "company",
      source: "wizard",
      returnTo: "/pipeline",
    });
    const handler = await GET();

    const response = await handler(
      callbackRequest({
        code: "auth-code",
        state: "opaque-state-token",
      })
    );

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toBe(
      `${APP_URL}/pipeline?connected=gmail`
    );
    expect(persistConnection).toHaveBeenCalledTimes(1);
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(providerFetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(
      AbortSignal
    );
    expect(providerFetch.mock.calls[1]?.[1]?.signal).toBeInstanceOf(
      AbortSignal
    );
  });

  it("redirects user denial to returnTo with ?connect_error=1", async () => {
    consumeState.mockResolvedValue({
      companyId: "co-1",
      userId: "user-1",
      type: "company",
      source: "wizard",
      returnTo: "/pipeline",
    });
    const handler = await GET();

    const response = await handler(
      callbackRequest({
        error: "access_denied",
        state: "opaque-state-token",
      })
    );

    expect(response.headers.get("location")).toBe(
      `${APP_URL}/pipeline?connect_error=1`
    );
    expect(persistConnection).not.toHaveBeenCalled();
  });

  it.each(["https://evil.com", "//evil.com", "/\\evil.com"])(
    "ignores hostile returnTo %s and falls back to /settings",
    async (hostile) => {
      mockTokenExchangeSuccess();
      // Hostile values are rejected before state is persisted, so the
      // callback receives a trusted null return path.
      consumeState.mockResolvedValue({
        companyId: "co-1",
        userId: "user-1",
        type: "company",
        source: "wizard",
        returnTo: null,
      });
      const handler = await GET();

      const response = await handler(
        callbackRequest({
          code: "auth-code",
          state: `opaque-state-token-${encodeURIComponent(hostile)}`,
        })
      );

      const location = response.headers.get("location") ?? "";
      expect(location.startsWith(`${APP_URL}/settings`)).toBe(true);
      expect(location).not.toContain("evil.com");
    }
  );

  it("keeps the legacy /settings landing when no returnTo is present", async () => {
    mockTokenExchangeSuccess();
    consumeState.mockResolvedValue({
      companyId: "co-1",
      userId: "user-1",
      type: "company",
      source: "wizard",
      returnTo: null,
    });
    const handler = await GET();

    const response = await handler(
      callbackRequest({
        code: "auth-code",
        state: "opaque-state-token",
      })
    );

    expect(response.headers.get("location")).toBe(
      `${APP_URL}/settings?tab=integrations&status=connected&firstConnect=true`
    );
  });

  it("keeps the alert-flow landing untouched when source=alert", async () => {
    mockTokenExchangeSuccess();
    consumeState.mockResolvedValue({
      companyId: "co-1",
      userId: "user-1",
      type: "company",
      source: "alert",
      connectionId: "connection-1",
      expectedEmail: "owner@ops.test",
      returnTo: "/pipeline",
    });
    const handler = await GET();

    const response = await handler(
      callbackRequest({
        code: "auth-code",
        state: "opaque-state-token",
      })
    );

    const location = response.headers.get("location") ?? "";
    expect(location.startsWith(`${APP_URL}/reconnect-inbox/success`)).toBe(
      true
    );
  });
});
