/**
 * Incremental Google Calendar consent through the Gmail OAuth pair.
 *
 * Start route: `?include_calendar=1&connectionId=...` widens the requested
 * scope to mail + calendar.events against the bound connection. Every Gmail
 * auth URL carries `include_granted_scopes=true` so re-consents union with
 * prior grants instead of silently narrowing the stored refresh token.
 *
 * Callback: the token response's `scope` field is the source of truth for
 * what the stored credential can now do — it is parsed and persisted on
 * every path. Calendar upgrades land back on the settings mailbox card.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  createStateMock,
  consumeStateMock,
  resolveAlertMock,
  resolveCalendarMock,
  persistMock,
  requireAccessMock,
  fetchOnceMock,
  fetchReadMock,
} = vi.hoisted(() => ({
  createStateMock: vi.fn(),
  consumeStateMock: vi.fn(),
  resolveAlertMock: vi.fn(),
  resolveCalendarMock: vi.fn(),
  persistMock: vi.fn(),
  requireAccessMock: vi.fn(),
  fetchOnceMock: vi.fn(),
  fetchReadMock: vi.fn(),
}));

vi.mock("@/lib/email/email-oauth-state", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/email/email-oauth-state")>();
  return {
    ...actual,
    createEmailOAuthState: createStateMock,
    consumeEmailOAuthState: consumeStateMock,
    resolveEmailOAuthAlertConnection: resolveAlertMock,
    resolveEmailOAuthCalendarConnection: resolveCalendarMock,
  };
});

vi.mock("@/lib/email/email-oauth-connection", () => ({
  persistEmailOAuthConnection: persistMock,
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: requireAccessMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({}),
}));

vi.mock("@/lib/api/services/providers/gmail-read", () => ({
  fetchGmailOnceWithinDeadline: fetchOnceMock,
  fetchGmailRead: fetchReadMock,
}));

const APP_URL = "https://app.test";
const GMAIL_SCOPE = "https://mail.google.com/";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function startRequest(query: Record<string, string>): NextRequest {
  const params = new URLSearchParams(query);
  return new Request(
    `${APP_URL}/api/integrations/gmail?${params.toString()}`
  ) as unknown as NextRequest;
}

function callbackRequest(query: Record<string, string>): NextRequest {
  const params = new URLSearchParams(query);
  return new Request(
    `${APP_URL}/api/integrations/gmail/callback?${params.toString()}`
  ) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_GMAIL_CLIENT_ID = "client-id";
  process.env.GOOGLE_GMAIL_CLIENT_SECRET = "client-secret";
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  requireAccessMock.mockResolvedValue(null);
  createStateMock.mockResolvedValue("opaque-state");
});

describe("GET /api/integrations/gmail — calendar consent", () => {
  it("widens the scope and binds state when include_calendar=1", async () => {
    resolveCalendarMock.mockResolvedValue({
      connectionId: "connection-1",
      expectedEmail: "ops@example.com",
    });

    const { GET } = await import("@/app/api/integrations/gmail/route");
    const response = await GET(
      startRequest({
        companyId: "company-1",
        userId: "user-1",
        type: "company",
        include_calendar: "1",
        connectionId: "connection-1",
        returnTo: "/settings?section=email",
      })
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("scope")).toBe(
      `${GMAIL_SCOPE} ${CALENDAR_SCOPE}`
    );
    expect(location.searchParams.get("include_granted_scopes")).toBe("true");
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("prompt")).toBe("consent");

    expect(resolveCalendarMock).toHaveBeenCalledWith(expect.anything(), {
      companyId: "company-1",
      provider: "gmail",
      type: "company",
      connectionId: "connection-1",
    });
    expect(createStateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "calendar",
        connectionId: "connection-1",
        expectedEmail: "ops@example.com",
        returnTo: "/settings?section=email",
      })
    );
  });

  it("rejects a calendar request without its connection", async () => {
    const { GET } = await import("@/app/api/integrations/gmail/route");
    const response = await GET(
      startRequest({
        companyId: "company-1",
        userId: "user-1",
        type: "company",
        include_calendar: "1",
      })
    );
    expect(response.status).toBe(400);
    expect(createStateMock).not.toHaveBeenCalled();
  });

  it("rejects a calendar request when the connection is not upgradeable", async () => {
    resolveCalendarMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/integrations/gmail/route");
    const response = await GET(
      startRequest({
        companyId: "company-1",
        userId: "user-1",
        type: "company",
        include_calendar: "1",
        connectionId: "connection-1",
      })
    );
    expect(response.status).toBe(400);
    expect(createStateMock).not.toHaveBeenCalled();
  });

  it("keeps the base mailbox flow on the mail scope with incremental grants on", async () => {
    const { GET } = await import("@/app/api/integrations/gmail/route");
    const response = await GET(
      startRequest({
        companyId: "company-1",
        userId: "user-1",
        type: "company",
      })
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("scope")).toBe(GMAIL_SCOPE);
    expect(location.searchParams.get("include_granted_scopes")).toBe("true");
    expect(createStateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "wizard" })
    );
  });
});

describe("GET /api/integrations/gmail/callback — calendar consent", () => {
  function scriptTokenExchange(scope: string | undefined) {
    fetchOnceMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        ...(scope === undefined ? {} : { scope }),
      }),
    });
  }

  function scriptProfile(email: string) {
    fetchReadMock.mockResolvedValue({
      ok: true,
      json: async () => ({ emailAddress: email }),
    });
  }

  it("persists the reported scopes and lands back on the mailbox card", async () => {
    consumeStateMock.mockResolvedValue({
      companyId: "company-1",
      userId: "user-1",
      type: "company",
      source: "calendar",
      connectionId: "connection-1",
      expectedEmail: "ops@example.com",
      returnTo: "/settings?section=email",
    });
    scriptTokenExchange(`${GMAIL_SCOPE} ${CALENDAR_SCOPE}`);
    scriptProfile("ops@example.com");
    persistMock.mockResolvedValue(undefined);

    const { GET } = await import(
      "@/app/api/integrations/gmail/callback/route"
    );
    const response = await GET(
      callbackRequest({ code: "auth-code", state: "opaque-state" })
    );

    expect(persistMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "gmail",
        email: "ops@example.com",
        grantedScopes: [GMAIL_SCOPE, CALENDAR_SCOPE],
        state: expect.objectContaining({ source: "calendar" }),
      })
    );
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/settings");
    expect(location.searchParams.get("section")).toBe("email");
    expect(location.searchParams.get("calendar")).toBe("connected");
  });

  it("reports a calendar-flow failure back to the mailbox card", async () => {
    consumeStateMock.mockResolvedValue({
      companyId: "company-1",
      userId: "user-1",
      type: "company",
      source: "calendar",
      connectionId: "connection-1",
      expectedEmail: "ops@example.com",
      returnTo: "/settings?section=email",
    });
    scriptTokenExchange(`${GMAIL_SCOPE} ${CALENDAR_SCOPE}`);
    scriptProfile("someone-else@example.com");

    const { GET } = await import(
      "@/app/api/integrations/gmail/callback/route"
    );
    const response = await GET(
      callbackRequest({ code: "auth-code", state: "opaque-state" })
    );

    expect(persistMock).not.toHaveBeenCalled();
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("calendar")).toBe("error");
  });

  it("persists reported scopes for the wizard flow too", async () => {
    consumeStateMock.mockResolvedValue({
      companyId: "company-1",
      userId: "user-1",
      type: "company",
      source: "wizard",
      returnTo: null,
    });
    scriptTokenExchange(GMAIL_SCOPE);
    scriptProfile("ops@example.com");
    persistMock.mockResolvedValue(undefined);

    const { GET } = await import(
      "@/app/api/integrations/gmail/callback/route"
    );
    const response = await GET(
      callbackRequest({ code: "auth-code", state: "opaque-state" })
    );

    expect(persistMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ grantedScopes: [GMAIL_SCOPE] })
    );
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("status")).toBe("connected");
  });

  it("passes no scope list when the provider omitted the field", async () => {
    consumeStateMock.mockResolvedValue({
      companyId: "company-1",
      userId: "user-1",
      type: "company",
      source: "wizard",
      returnTo: null,
    });
    scriptTokenExchange(undefined);
    scriptProfile("ops@example.com");
    persistMock.mockResolvedValue(undefined);

    const { GET } = await import(
      "@/app/api/integrations/gmail/callback/route"
    );
    await GET(callbackRequest({ code: "auth-code", state: "opaque-state" }));

    expect(persistMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ grantedScopes: null })
    );
  });
});
