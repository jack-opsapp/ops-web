import { afterEach, describe, expect, it, vi } from "vitest";

import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function makeConnection(
  provider: EmailConnection["provider"]
): EmailConnection {
  const now = new Date();
  return {
    id: "connection-1",
    companyId: "company-1",
    provider,
    type: "company",
    userId: "user-1",
    email: "operator@example.com",
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

describe("provider targeted draft lookup", () => {
  it("fetches one Gmail draft by immutable draft resource id", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({
        id: "gmail-draft-older",
        message: {
          id: "gmail-message-older",
          threadId: "gmail-thread-1",
          internalDate: "1784044800000",
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "To", value: "Lead <lead@example.com>" },
              { name: "Subject", value: "Re: Quote" },
            ],
            body: {
              data: Buffer.from("Authored body").toString("base64url"),
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const draft = await new GmailProvider(makeConnection("gmail")).getDraft(
      "gmail-draft-older"
    );

    expect(draft).toMatchObject({
      id: "gmail-draft-older",
      threadId: "gmail-thread-1",
      to: ["Lead <lead@example.com>"],
      subject: "Re: Quote",
      bodyText: "Authored body",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/drafts/gmail-draft-older?format=full"
    );
  });

  it("returns null when the exact Gmail draft resource is gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 404))
    );

    await expect(
      new GmailProvider(makeConnection("gmail")).getDraft("gone")
    ).resolves.toBeNull();
  });

  it("returns only an M365 message that is still a draft", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          id: "immutable-message-1",
          isDraft: true,
          conversationId: "conversation-1",
          toRecipients: [{ emailAddress: { address: "lead@example.com" } }],
          ccRecipients: [],
          subject: "Re: Quote",
          body: { contentType: "text", content: "Authored body" },
          lastModifiedDateTime: "2026-07-14T18:00:00.000Z",
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const draft = await new Microsoft365Provider(
      makeConnection("microsoft365")
    ).getDraft("immutable-message-1");

    expect(draft).toMatchObject({
      id: "immutable-message-1",
      threadId: "conversation-1",
      bodyText: "Authored body",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/me/messages/immutable-message-1?"
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Prefer: 'IdType="ImmutableId"' }),
    });
  });

  it("returns null when an immutable M365 message id now points to sent mail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          id: "immutable-message-1",
          isDraft: false,
        })
      )
    );

    await expect(
      new Microsoft365Provider(makeConnection("microsoft365")).getDraft(
        "immutable-message-1"
      )
    ).resolves.toBeNull();
  });
});
