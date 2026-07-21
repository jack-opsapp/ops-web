import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  requireEmailCompanyAccessMock,
  createEmailOAuthStateMock,
  consumeEmailOAuthStateMock,
  resolveEmailOAuthAlertConnectionMock,
  serviceRoleClient,
} = vi.hoisted(() => ({
  requireEmailCompanyAccessMock: vi.fn(),
  createEmailOAuthStateMock: vi.fn(),
  consumeEmailOAuthStateMock: vi.fn(),
  resolveEmailOAuthAlertConnectionMock: vi.fn(),
  serviceRoleClient: { from: vi.fn() },
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: requireEmailCompanyAccessMock,
}));
vi.mock("@/lib/email/email-oauth-state", () => ({
  createEmailOAuthState: createEmailOAuthStateMock,
  consumeEmailOAuthState: consumeEmailOAuthStateMock,
  resolveEmailOAuthAlertConnection: resolveEmailOAuthAlertConnectionMock,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceRoleClient,
}));
vi.mock("@/lib/utils/app-url", () => ({
  getAppUrl: () => "https://ops.test",
}));

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const USER_ID = "956263ff-b40e-4e8e-8341-cfcad966e207";

function initiationRequest(
  provider: "gmail" | "microsoft365",
  type = "company",
  alertBinding?: { connectionId: string; expectedEmail: string }
) {
  const params = new URLSearchParams({
    companyId: COMPANY_ID,
    userId: USER_ID,
    type,
  });
  if (alertBinding) {
    params.set("source", "alert");
    params.set("connectionId", alertBinding.connectionId);
    params.set("expectedEmail", alertBinding.expectedEmail);
  }
  return new NextRequest(
    `https://ops.test/api/integrations/${provider}?${params.toString()}`,
    { headers: { cookie: "ops-auth-token=firebase-token" } }
  );
}

describe("email OAuth initiation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "google-client");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "microsoft-client");
    requireEmailCompanyAccessMock.mockResolvedValue(null);
    createEmailOAuthStateMock.mockResolvedValue("opaque-state-token");
    resolveEmailOAuthAlertConnectionMock.mockResolvedValue({
      connectionId: "connection-1",
      expectedEmail: "crew@example.com",
    });
  });

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/route")],
    ["microsoft365", () => import("@/app/api/integrations/microsoft365/route")],
  ] as const)(
    "authenticates %s initiation against the exact company and user before issuing state",
    async (provider, loadRoute) => {
      const unauthorized = NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
      requireEmailCompanyAccessMock.mockResolvedValueOnce(unauthorized);
      const { GET } = await loadRoute();

      const rejected = await GET(initiationRequest(provider));

      expect(rejected.status).toBe(401);
      expect(createEmailOAuthStateMock).not.toHaveBeenCalled();

      requireEmailCompanyAccessMock.mockResolvedValueOnce(null);
      const accepted = await GET(initiationRequest(provider));

      expect(requireEmailCompanyAccessMock).toHaveBeenLastCalledWith(
        expect.any(NextRequest),
        COMPANY_ID,
        "settings.integrations",
        USER_ID
      );
      expect(createEmailOAuthStateMock).toHaveBeenCalledWith(
        serviceRoleClient,
        expect.objectContaining({
          provider,
          companyId: COMPANY_ID,
          userId: USER_ID,
          type: "company",
        })
      );
      expect(accepted.status).toBe(307);
      const redirect = new URL(accepted.headers.get("location")!);
      expect(redirect.searchParams.get("state")).toBe("opaque-state-token");
      expect(redirect.searchParams.get("state")).not.toContain(COMPANY_ID);
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/route")],
    ["microsoft365", () => import("@/app/api/integrations/microsoft365/route")],
  ] as const)(
    "rejects an invalid %s connection type",
    async (provider, loadRoute) => {
      const { GET } = await loadRoute();

      const response = await GET(initiationRequest(provider, "operator"));

      expect(response.status).toBe(400);
      expect(requireEmailCompanyAccessMock).not.toHaveBeenCalled();
      expect(createEmailOAuthStateMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/route")],
    ["microsoft365", () => import("@/app/api/integrations/microsoft365/route")],
  ] as const)(
    "binds an alert %s initiation to the exact server-verified connection and mailbox",
    async (provider, loadRoute) => {
      const { GET } = await loadRoute();
      const response = await GET(
        initiationRequest(provider, "company", {
          connectionId: "connection-1",
          expectedEmail: "crew@example.com",
        })
      );

      expect(resolveEmailOAuthAlertConnectionMock).toHaveBeenCalledWith(
        serviceRoleClient,
        {
          companyId: COMPANY_ID,
          provider,
          type: "company",
          connectionId: "connection-1",
          expectedEmail: "crew@example.com",
        }
      );
      expect(createEmailOAuthStateMock).toHaveBeenCalledWith(
        serviceRoleClient,
        expect.objectContaining({
          source: "alert",
          connectionId: "connection-1",
          expectedEmail: "crew@example.com",
        })
      );
      expect(response.status).toBe(307);
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/route")],
    ["microsoft365", () => import("@/app/api/integrations/microsoft365/route")],
  ] as const)(
    "rejects an alert %s initiation when its connection binding is stale or altered",
    async (provider, loadRoute) => {
      resolveEmailOAuthAlertConnectionMock.mockResolvedValueOnce(null);
      const { GET } = await loadRoute();

      const response = await GET(
        initiationRequest(provider, "company", {
          connectionId: "connection-1",
          expectedEmail: "wrong@example.com",
        })
      );

      expect(response.status).toBe(400);
      expect(createEmailOAuthStateMock).not.toHaveBeenCalled();
    }
  );
});

function mockProviderFetch(provider: "gmail" | "microsoft365", email: string) {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          provider === "gmail"
            ? { emailAddress: email }
            : { mail: email, userPrincipalName: email }
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
}

function mockEmailConnectionTable(options?: {
  lookupData?: Record<string, unknown> | null;
  lookupError?: { message: string } | null;
  updateData?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
  upsertError?: { message: string } | null;
}) {
  const lookupBuilder: {
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: options?.lookupData ?? null,
      error: options?.lookupError ?? null,
    }),
  };
  lookupBuilder.eq.mockReturnValue(lookupBuilder);

  const updateBuilder: {
    eq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        options && "updateData" in options
          ? options.updateData
          : { id: "connection-1" },
      error: options?.updateError ?? null,
    }),
  };
  updateBuilder.eq.mockReturnValue(updateBuilder);
  updateBuilder.select.mockReturnValue(updateBuilder);

  const table = {
    select: vi.fn(() => lookupBuilder),
    update: vi.fn(() => updateBuilder),
    upsert: vi.fn().mockResolvedValue({
      data: null,
      error: options?.upsertError ?? null,
    }),
  };
  serviceRoleClient.from.mockImplementation((tableName: string) => {
    if (tableName !== "email_connections") {
      throw new Error(`Unexpected table: ${tableName}`);
    }
    return table;
  });

  return { table, lookupBuilder, updateBuilder };
}

describe("email OAuth callback state validation", () => {
  const validState = {
    companyId: COMPANY_ID,
    userId: USER_ID,
    type: "company" as const,
    source: "wizard" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "google-secret");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "microsoft-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "microsoft-secret");
    consumeEmailOAuthStateMock.mockResolvedValue(null);
    requireEmailCompanyAccessMock.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("bounds both Microsoft OAuth callback network requests", async () => {
    consumeEmailOAuthStateMock.mockResolvedValueOnce(validState);
    mockProviderFetch("microsoft365", "crew@example.com");
    mockEmailConnectionTable();
    const { GET } =
      await import("@/app/api/integrations/microsoft365/callback/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/microsoft365/callback?code=oauth-code&state=opaque-state-token"
      )
    );

    expect(response.headers.get("location")).toContain("status=connected");
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/callback/route")],
    [
      "microsoft365",
      () => import("@/app/api/integrations/microsoft365/callback/route"),
    ],
  ] as const)(
    "rejects unsigned, expired, or replayed %s state before token exchange",
    async (provider, loadRoute) => {
      const legacyState = Buffer.from(
        JSON.stringify({ companyId: COMPANY_ID, userId: USER_ID })
      ).toString("base64");
      const { GET } = await loadRoute();
      const response = await GET(
        new NextRequest(
          `https://ops.test/api/integrations/${provider}/callback?code=oauth-code&state=${encodeURIComponent(legacyState)}`
        )
      );

      expect(consumeEmailOAuthStateMock).toHaveBeenCalledWith(
        serviceRoleClient,
        provider,
        legacyState
      );
      expect(response.headers.get("location")).toContain(
        "message=invalid_state"
      );
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/callback/route")],
    [
      "microsoft365",
      () => import("@/app/api/integrations/microsoft365/callback/route"),
    ],
  ] as const)(
    "rejects a relayed %s consent URL when the callback OPS session does not match the initiator",
    async (provider, loadRoute) => {
      consumeEmailOAuthStateMock.mockResolvedValueOnce(validState);
      requireEmailCompanyAccessMock.mockResolvedValueOnce(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
      const { GET } = await loadRoute();

      const response = await GET(
        new NextRequest(
          `https://ops.test/api/integrations/${provider}/callback?code=oauth-code&state=opaque-state-token`
        )
      );

      expect(requireEmailCompanyAccessMock).toHaveBeenCalledWith(
        expect.any(NextRequest),
        COMPANY_ID,
        "settings.integrations",
        USER_ID
      );
      expect(response.headers.get("location")).toContain(
        "https://ops.test/login?redirect="
      );
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("consumes denied Gmail callbacks so their state cannot be replayed", async () => {
    consumeEmailOAuthStateMock.mockResolvedValueOnce(validState);
    const { GET } = await import("@/app/api/integrations/gmail/callback/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/callback?error=access_denied&state=opaque-state-token"
      )
    );

    expect(consumeEmailOAuthStateMock).toHaveBeenCalledWith(
      serviceRoleClient,
      "gmail",
      "opaque-state-token"
    );
    expect(response.headers.get("location")).toContain("message=access_denied");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses to persist Gmail tokens when the mailbox profile has no valid email", async () => {
    consumeEmailOAuthStateMock.mockResolvedValueOnce(validState);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ emailAddress: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    const { GET } = await import("@/app/api/integrations/gmail/callback/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/callback?code=oauth-code&state=opaque-state-token"
      )
    );

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      expect.objectContaining({
        headers: { Authorization: "Bearer access-token" },
      })
    );
    expect(response.headers.get("location")).toContain(
      "message=mailbox_identity_failed"
    );
    expect(serviceRoleClient.from).not.toHaveBeenCalled();
  });

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/callback/route")],
    [
      "microsoft365",
      () => import("@/app/api/integrations/microsoft365/callback/route"),
    ],
  ] as const)(
    "fails closed when the existing %s mailbox row cannot be read",
    async (provider, loadRoute) => {
      consumeEmailOAuthStateMock.mockResolvedValueOnce(validState);
      mockProviderFetch(provider, "crew@example.com");
      const { table, lookupBuilder } = mockEmailConnectionTable({
        lookupError: { message: "read failed" },
      });
      const { GET } = await loadRoute();

      const response = await GET(
        new NextRequest(
          `https://ops.test/api/integrations/${provider}/callback?code=oauth-code&state=opaque-state-token`
        )
      );

      expect(response.headers.get("location")).toContain(
        "message=storage_failed"
      );
      expect(lookupBuilder.eq).toHaveBeenCalledWith("provider", provider);
      expect(table.upsert).not.toHaveBeenCalled();
      expect(table.update).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/callback/route")],
    [
      "microsoft365",
      () => import("@/app/api/integrations/microsoft365/callback/route"),
    ],
  ] as const)(
    "keeps a wizard %s mailbox isolated behind provider-scoped upsert identity",
    async (provider, loadRoute) => {
      consumeEmailOAuthStateMock.mockResolvedValueOnce(validState);
      mockProviderFetch(provider, "crew@example.com");
      const { table, lookupBuilder } = mockEmailConnectionTable();
      const { GET } = await loadRoute();

      const response = await GET(
        new NextRequest(
          `https://ops.test/api/integrations/${provider}/callback?code=oauth-code&state=opaque-state-token`
        )
      );

      expect(response.headers.get("location")).toContain("status=connected");
      expect(lookupBuilder.eq).toHaveBeenCalledWith("provider", provider);
      expect(table.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ provider, email: "crew@example.com" }),
        { onConflict: "company_id,provider,email" }
      );
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/callback/route")],
    [
      "microsoft365",
      () => import("@/app/api/integrations/microsoft365/callback/route"),
    ],
  ] as const)(
    "rejects the wrong mailbox during an alert %s reconnect",
    async (provider, loadRoute) => {
      consumeEmailOAuthStateMock.mockResolvedValueOnce({
        ...validState,
        source: "alert",
        connectionId: "connection-1",
        expectedEmail: "crew@example.com",
      });
      mockProviderFetch(provider, "attacker@example.com");
      const { GET } = await loadRoute();

      const response = await GET(
        new NextRequest(
          `https://ops.test/api/integrations/${provider}/callback?code=oauth-code&state=opaque-state-token`
        )
      );

      expect(response.headers.get("location")).toContain(
        "message=mailbox_identity_mismatch"
      );
      expect(serviceRoleClient.from).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/callback/route")],
    [
      "microsoft365",
      () => import("@/app/api/integrations/microsoft365/callback/route"),
    ],
  ] as const)(
    "updates only the bound %s row during an alert reconnect",
    async (provider, loadRoute) => {
      consumeEmailOAuthStateMock.mockResolvedValueOnce({
        ...validState,
        source: "alert",
        connectionId: "connection-1",
        expectedEmail: "crew@example.com",
      });
      mockProviderFetch(provider, "crew@example.com");
      const { table, lookupBuilder, updateBuilder } = mockEmailConnectionTable({
        lookupData: {
          id: "connection-1",
          email: "Crew@Example.com",
          refresh_token: "old-refresh-token",
          status: "needs_reconnect",
          sync_enabled: true,
        },
      });
      const { GET } = await loadRoute();

      const response = await GET(
        new NextRequest(
          `https://ops.test/api/integrations/${provider}/callback?code=oauth-code&state=opaque-state-token`
        )
      );

      expect(response.headers.get("location")).toContain(
        "/reconnect-inbox/success?"
      );
      expect(lookupBuilder.eq.mock.calls).toEqual(
        expect.arrayContaining([
          ["id", "connection-1"],
          ["company_id", COMPANY_ID],
          ["provider", provider],
          ["type", "company"],
        ])
      );
      expect(table.update).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          status: "active",
          sync_enabled: true,
        })
      );
      expect(updateBuilder.eq.mock.calls).toEqual(
        expect.arrayContaining([
          ["id", "connection-1"],
          ["company_id", COMPANY_ID],
          ["provider", provider],
          ["type", "company"],
          ["email", "Crew@Example.com"],
          ["status", "needs_reconnect"],
          ["sync_enabled", true],
        ])
      );
      expect(table.upsert).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/callback/route")],
    [
      "microsoft365",
      () => import("@/app/api/integrations/microsoft365/callback/route"),
    ],
  ] as const)(
    "does not resurrect a disconnected %s row from a stale alert callback",
    async (provider, loadRoute) => {
      consumeEmailOAuthStateMock.mockResolvedValueOnce({
        ...validState,
        source: "alert",
        connectionId: "connection-1",
        expectedEmail: "crew@example.com",
      });
      mockProviderFetch(provider, "crew@example.com");
      const { table } = mockEmailConnectionTable({
        lookupData: {
          id: "connection-1",
          email: "crew@example.com",
          refresh_token: "",
          status: "disconnected",
          sync_enabled: false,
        },
      });
      const { GET } = await loadRoute();

      const response = await GET(
        new NextRequest(
          `https://ops.test/api/integrations/${provider}/callback?code=oauth-code&state=opaque-state-token`
        )
      );

      expect(response.headers.get("location")).toContain(
        "message=storage_failed"
      );
      expect(table.update).not.toHaveBeenCalled();
      expect(table.upsert).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["gmail", () => import("@/app/api/integrations/gmail/callback/route")],
    [
      "microsoft365",
      () => import("@/app/api/integrations/microsoft365/callback/route"),
    ],
  ] as const)(
    "fails closed if a %s mailbox is disconnected during the callback write",
    async (provider, loadRoute) => {
      consumeEmailOAuthStateMock.mockResolvedValueOnce({
        ...validState,
        source: "alert",
        connectionId: "connection-1",
        expectedEmail: "crew@example.com",
      });
      mockProviderFetch(provider, "crew@example.com");
      const { table } = mockEmailConnectionTable({
        lookupData: {
          id: "connection-1",
          email: "crew@example.com",
          refresh_token: "",
          status: "needs_reconnect",
          sync_enabled: true,
        },
        updateData: null,
      });
      const { GET } = await loadRoute();

      const response = await GET(
        new NextRequest(
          `https://ops.test/api/integrations/${provider}/callback?code=oauth-code&state=opaque-state-token`
        )
      );

      expect(response.headers.get("location")).toContain(
        "message=storage_failed"
      );
      expect(table.update).toHaveBeenCalledTimes(1);
      expect(table.upsert).not.toHaveBeenCalled();
    }
  );
});
