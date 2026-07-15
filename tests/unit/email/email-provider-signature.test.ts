import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderScopeError } from "@/lib/api/services/email-provider";
import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function makeConnection(
  provider: EmailConnection["provider"],
  email = "operator@example.com"
): EmailConnection {
  const now = new Date();
  return {
    id: "connection-1",
    companyId: "company-1",
    provider,
    type: "individual",
    userId: "user-1",
    email,
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    historyId: null,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GmailProvider email signature read", () => {
  it("reads the exact connected send-as identity before Gmail's default alias", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({
          sendAs: [
            {
              sendAsEmail: "alias@example.com",
              isDefault: true,
              isPrimary: false,
              signature: "<div>Alias signature</div>",
            },
            {
              sendAsEmail: "Operator@Example.com",
              isDefault: false,
              isPrimary: true,
              signature: "<div>Connected signature</div>",
            },
          ],
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GmailProvider(
      makeConnection("gmail")
    ).getEmailSignature();

    expect(result).toEqual({
      status: "available",
      source: "gmail_send_as",
      providerIdentity: "Operator@Example.com",
      contentHtml: "<div>Connected signature</div>",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/settings\/sendAs$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer access-token",
      }),
    });
  });

  it("does not import a default alias when the exact connected identity is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          sendAs: [
            {
              sendAsEmail: "primary@example.com",
              isPrimary: true,
              signature: "<div>Primary</div>",
            },
            {
              sendAsEmail: "default@example.com",
              isDefault: true,
              signature: "<div>Default</div>",
            },
          ],
        })
      )
    );

    await expect(
      new GmailProvider(
        makeConnection("gmail", "missing@example.com")
      ).getEmailSignature()
    ).resolves.toEqual({
      status: "not_configured",
      source: "gmail_send_as",
      providerIdentity: "missing@example.com",
      contentHtml: null,
    });
  });

  it("reports a configured identity with no signature without inventing content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          sendAs: [
            {
              sendAsEmail: "operator@example.com",
              isPrimary: true,
              signature: "   ",
            },
          ],
        })
      )
    );

    await expect(
      new GmailProvider(makeConnection("gmail")).getEmailSignature()
    ).resolves.toEqual({
      status: "not_configured",
      source: "gmail_send_as",
      providerIdentity: "operator@example.com",
      contentHtml: null,
    });
  });

  it("names gmail.settings.basic when the grant cannot read send-as settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 403,
              message: "Request had insufficient authentication scopes.",
              errors: [{ reason: "insufficientPermissions" }],
            },
          },
          403
        )
      )
    );

    const failure = new GmailProvider(
      makeConnection("gmail")
    ).getEmailSignature();
    await expect(failure).rejects.toBeInstanceOf(ProviderScopeError);
    await expect(failure).rejects.toMatchObject({
      requiredScope: "https://www.googleapis.com/auth/gmail.settings.basic",
    });
  });
});

describe("Microsoft365Provider email signature read", () => {
  it("returns unsupported without making a Graph request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new Microsoft365Provider(
        makeConnection("microsoft365")
      ).getEmailSignature()
    ).resolves.toEqual({
      status: "unsupported",
      source: "microsoft_confirmed",
      providerIdentity: "operator@example.com",
      contentHtml: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
