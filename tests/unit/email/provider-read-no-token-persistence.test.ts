import { afterEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => {
  const eq = vi.fn(async () => ({ data: null, error: null }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const requireSupabase = vi.fn(() => ({ from }));
  return { eq, update, from, requireSupabase };
});

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: persistence.requireSupabase,
}));

import { ProviderApiError } from "@/lib/api/services/email-provider";
import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function connection(
  provider: "gmail" | "microsoft365",
  expired = true
): EmailConnection {
  const now = new Date();
  return {
    id: `${provider}-connection`,
    companyId: "company-1",
    provider,
    type: "company",
    userId: null,
    email: "operator@example.com",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(now.getTime() + (expired ? -60_000 : 60 * 60_000)),
    historyId: provider === "gmail" ? "history-start" : null,
    syncEnabled: true,
    lastSyncedAt: null,
    syncIntervalMinutes: 5,
    syncFilters: {},
    webhookSubscriptionId: null,
    webhookExpiresAt: null,
    opsLabelId: null,
    aiReviewEnabled: false,
    aiMemoryEnabled: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("provider credential-static reads", () => {
  it("refuses an expired Gmail token without OAuth or database writes", async () => {
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "gmail-client");
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "gmail-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "gmail-fresh", expires_in: 3_600 })
      )
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(connection("gmail")).fetchThread("gmail-thread", {
        context: "exact recovery",
        oauthTokenMode: "current_only_no_persist",
      })
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerBody: { reason: "gmail_oauth_refresh_forbidden" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(persistence.requireSupabase).not.toHaveBeenCalled();
    expect(persistence.update).not.toHaveBeenCalled();
  });

  it("refuses an expired Microsoft token without OAuth or database writes", async () => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "microsoft-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "microsoft-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "microsoft-fresh", expires_in: 3_600 })
      )
      .mockResolvedValueOnce(jsonResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new Microsoft365Provider(connection("microsoft365")).fetchThread(
        "microsoft-thread",
        {
          context: "exact recovery",
          oauthTokenMode: "current_only_no_persist",
        }
      )
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerBody: { reason: "microsoft_oauth_refresh_forbidden" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(persistence.requireSupabase).not.toHaveBeenCalled();
    expect(persistence.update).not.toHaveBeenCalled();
  });

  it("keeps normal Gmail reads refresh-and-persist by default", async () => {
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "gmail-client");
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "gmail-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "gmail-fresh", expires_in: 3_600 })
      )
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(connection("gmail")).fetchThread("gmail-thread")
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(persistence.from).toHaveBeenCalledWith("email_connections");
    expect(persistence.update).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "gmail-fresh" })
    );
  });

  it("keeps normal Microsoft reads refresh-and-persist by default", async () => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "microsoft-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "microsoft-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "microsoft-fresh", expires_in: 3_600 })
      )
      .mockResolvedValueOnce(jsonResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new Microsoft365Provider(connection("microsoft365")).fetchThread(
        "microsoft-thread"
      )
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(persistence.from).toHaveBeenCalledWith("email_connections");
    expect(persistence.update).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "microsoft-fresh" })
    );
  });
});
