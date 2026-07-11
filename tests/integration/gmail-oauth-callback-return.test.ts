/**
 * Gmail OAuth callback — returnTo round-trip behavior.
 *
 * The pipeline connect banner starts the OAuth flow with returnTo=/pipeline
 * packed into the base64 state. These tests pin the callback's redirect
 * contract:
 *   - success with a valid returnTo → `${returnTo}?connected=gmail`
 *   - denial/failure with a valid returnTo → `${returnTo}?connect_error=1`
 *   - hostile returnTo values in state → fall back to the /settings landing
 *   - no returnTo → legacy /settings landing preserved exactly
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertCall = vi.fn();

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
      upsert: (...args: unknown[]) => {
        upsertCall(...args);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  }),
}));

vi.mock("@/lib/api/services/mailbox-draft-helpers", () => ({
  defaultAutoSendSettings: () => ({}),
}));

const APP_URL = "https://app.ops.test";

function encodeState(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
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
      if (url.includes("googleapis.com/oauth2/v2/userinfo")) {
        return new Response(JSON.stringify({ email: "owner@ops.test" }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

describe("GET /api/integrations/gmail/callback returnTo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "client-secret");
  });

  it("redirects success to returnTo with ?connected=gmail", async () => {
    mockTokenExchangeSuccess();
    const handler = await GET();

    const response = await handler(
      callbackRequest({
        code: "auth-code",
        state: encodeState({
          companyId: "co-1",
          userId: "user-1",
          type: "company",
          source: "wizard",
          returnTo: "/pipeline",
        }),
      })
    );

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toBe(
      `${APP_URL}/pipeline?connected=gmail`
    );
    expect(upsertCall).toHaveBeenCalledTimes(1);
  });

  it("redirects user denial to returnTo with ?connect_error=1", async () => {
    const handler = await GET();

    const response = await handler(
      callbackRequest({
        error: "access_denied",
        state: encodeState({
          companyId: "co-1",
          userId: "user-1",
          type: "company",
          source: "wizard",
          returnTo: "/pipeline",
        }),
      })
    );

    expect(response.headers.get("location")).toBe(
      `${APP_URL}/pipeline?connect_error=1`
    );
    expect(upsertCall).not.toHaveBeenCalled();
  });

  it.each(["https://evil.com", "//evil.com", "/\\evil.com"])(
    "ignores hostile returnTo %s and falls back to /settings",
    async (hostile) => {
      mockTokenExchangeSuccess();
      const handler = await GET();

      const response = await handler(
        callbackRequest({
          code: "auth-code",
          state: encodeState({
            companyId: "co-1",
            userId: "user-1",
            type: "company",
            source: "wizard",
            returnTo: hostile,
          }),
        })
      );

      const location = response.headers.get("location") ?? "";
      expect(location.startsWith(`${APP_URL}/settings`)).toBe(true);
      expect(location).not.toContain("evil.com");
    }
  );

  it("keeps the legacy /settings landing when no returnTo is present", async () => {
    mockTokenExchangeSuccess();
    const handler = await GET();

    const response = await handler(
      callbackRequest({
        code: "auth-code",
        state: encodeState({
          companyId: "co-1",
          userId: "user-1",
          type: "company",
          source: "wizard",
        }),
      })
    );

    expect(response.headers.get("location")).toBe(
      `${APP_URL}/settings?tab=integrations&status=connected&firstConnect=true`
    );
  });

  it("keeps the alert-flow landing untouched when source=alert", async () => {
    mockTokenExchangeSuccess();
    const handler = await GET();

    const response = await handler(
      callbackRequest({
        code: "auth-code",
        state: encodeState({
          companyId: "co-1",
          userId: "user-1",
          type: "company",
          source: "alert",
          returnTo: "/pipeline",
        }),
      })
    );

    const location = response.headers.get("location") ?? "";
    expect(location.startsWith(`${APP_URL}/reconnect-inbox/success`)).toBe(
      true
    );
  });
});
