import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderApiError } from "@/lib/api/services/email-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function makeConnection(): EmailConnection {
  const now = new Date();
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "microsoft365",
    type: "company",
    userId: null,
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

function m365Message(id: string, conversationId = `conversation-${id}`) {
  return {
    id,
    conversationId,
    from: {
      emailAddress: { address: "customer@example.com", name: "Customer" },
    },
    toRecipients: [{ emailAddress: { address: "operator@example.com" } }],
    ccRecipients: [],
    subject: "Estimate",
    bodyPreview: "Details",
    body: { contentType: "text", content: "Details" },
    receivedDateTime: "2026-07-13T18:00:00.000Z",
    categories: [],
    isRead: true,
    hasAttachments: false,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Microsoft365Provider mailbox-wide folder delta cursor", () => {
  it("discovers every mailbox folder and ingests archive/custom-folder mail", async () => {
    const requestedUrls: string[] = [];
    const requestedHeaders: HeadersInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requestedUrls.push(url);
        requestedHeaders.push(init?.headers ?? {});
        if (url.includes("/me/mailFolders/delta")) {
          return jsonResponse({
            value: [
              { id: "inbox-id" },
              { id: "sent-id" },
              { id: "archive-id" },
              { id: "custom-rule-id" },
              { id: "drafts-id" },
            ],
            "@odata.deltaLink": "https://graph.test/folders-delta-1",
          });
        }
        const folderId = [
          "inbox-id",
          "sent-id",
          "archive-id",
          "custom-rule-id",
          "drafts-id",
        ].find((id) => url.includes(`/mailFolders/${id}/messages/delta`));
        if (folderId) {
          return jsonResponse({
            value:
              folderId === "archive-id" || folderId === "custom-rule-id"
                ? [m365Message(`message-${folderId}`)]
                : folderId === "drafts-id"
                  ? [{ ...m365Message("message-draft"), isDraft: true }]
                  : [],
            "@odata.deltaLink": `https://graph.test/${folderId}-delta-1`,
          });
        }
        throw new Error(`Unexpected Microsoft Graph request: ${url}`);
      })
    );

    const provider = new Microsoft365Provider(makeConnection());
    const initialToken = await provider.getInitialSyncToken();
    const mailbox = await provider.fetchNewEmailsSince(initialToken);
    const sent = await provider.fetchSentEmailsSince(mailbox.nextSyncToken);

    expect(initialToken).toMatch(/^m365:v2:/);
    expect(mailbox.emails.map((email) => email.id).sort()).toEqual([
      "message-archive-id",
      "message-custom-rule-id",
    ]);
    expect(requestedUrls).toHaveLength(6);
    expect(requestedHeaders).toEqual(
      Array.from({ length: 6 }, () =>
        expect.objectContaining({ Prefer: 'IdType="ImmutableId"' })
      )
    );
    expect(sent.emails).toEqual([]);
    expect(sent.nextSyncToken).toBe(mailbox.nextSyncToken);
    expect(mailbox.nextSyncToken).toContain("folders-delta-1");
    expect(mailbox.nextSyncToken).toContain("custom-rule-id-delta-1");
  });

  it("rebuilds a legacy Inbox/Sent cursor from the complete folder inventory", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("/me/mailFolders/delta")) {
          return jsonResponse({
            value: [{ id: "custom-id" }],
            "@odata.deltaLink": "https://graph.test/folders-after-upgrade",
          });
        }
        if (url.includes("/mailFolders/custom-id/messages/delta")) {
          return jsonResponse({
            value: [m365Message("message-custom")],
            "@odata.deltaLink": "https://graph.test/custom-after-upgrade",
          });
        }
        throw new Error(`Unexpected Microsoft Graph request: ${url}`);
      })
    );

    const provider = new Microsoft365Provider(makeConnection());
    const result = await provider.fetchNewEmailsSince(
      'm365:v1:{"inboxDeltaLink":"https://graph.test/old-inbox","sentDeltaLink":"https://graph.test/old-sent"}'
    );

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toContain("/me/mailFolders/delta");
    expect(requestedUrls.join("\n")).not.toContain("old-inbox");
    expect(requestedUrls.join("\n")).not.toContain("old-sent");
    expect(result.emails.map((email) => email.id)).toEqual(["message-custom"]);
  });

  it("resumes a paginated folder inventory before walking message deltas", async () => {
    let folderPage = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        folderPage += 1;
        return jsonResponse({
          value: [],
          "@odata.nextLink": `https://graph.test/folder-page-${folderPage + 1}`,
        });
      })
    );

    const provider = new Microsoft365Provider(makeConnection());
    const first = await provider.fetchNewEmailsSince(
      await provider.getInitialSyncToken()
    );

    expect(folderPage).toBe(50);
    expect(first.emails).toEqual([]);
    expect(first.nextSyncToken).toContain("https://graph.test/folder-page-51");

    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url === "https://graph.test/folder-page-51") {
          return jsonResponse({
            value: [{ id: "late-custom-folder" }],
            "@odata.deltaLink": "https://graph.test/folders-terminal",
          });
        }
        return jsonResponse({
          value: [m365Message("message-late-custom")],
          "@odata.deltaLink": "https://graph.test/late-custom-terminal",
        });
      })
    );

    const resumed = await provider.fetchNewEmailsSince(first.nextSyncToken);

    expect(requestedUrls[0]).toBe("https://graph.test/folder-page-51");
    expect(requestedUrls[1]).toContain(
      "/mailFolders/late-custom-folder/messages/delta"
    );
    expect(resumed.emails.map((email) => email.id)).toEqual([
      "message-late-custom",
    ]);
  });

  it("resumes a folder message delta continuation without restarting discovery", async () => {
    let messagePage = 0;
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("/me/mailFolders/delta")) {
          return jsonResponse({
            value: [{ id: "large-folder" }],
            "@odata.deltaLink": "https://graph.test/folders-stable",
          });
        }
        messagePage += 1;
        return jsonResponse({
          value: [],
          "@odata.nextLink": `https://graph.test/message-page-${messagePage + 1}`,
        });
      })
    );

    const provider = new Microsoft365Provider(makeConnection());
    const first = await provider.fetchNewEmailsSince(
      await provider.getInitialSyncToken()
    );

    expect(requestedUrls).toHaveLength(50);
    expect(messagePage).toBe(49);
    expect(first.nextSyncToken).toContain("https://graph.test/message-page-50");

    requestedUrls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(String(input));
        return jsonResponse({
          value: [m365Message("message-after-resume")],
          "@odata.deltaLink": "https://graph.test/large-folder-terminal",
        });
      })
    );

    const resumed = await provider.fetchNewEmailsSince(first.nextSyncToken);

    expect(requestedUrls[0]).toBe("https://graph.test/message-page-50");
    expect(requestedUrls.join("\n")).not.toContain("/me/mailFolders/delta");
    expect(resumed.emails.map((email) => email.id)).toEqual([
      "message-after-resume",
    ]);
  });

  it("fails closed when Graph omits both terminal and continuation cursors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ value: [] }))
    );

    const provider = new Microsoft365Provider(makeConnection());
    await expect(
      provider.fetchNewEmailsSince(await provider.getInitialSyncToken())
    ).rejects.toBeInstanceOf(ProviderApiError);
  });

  it("keeps correspondence append-only across move/deletion tombstones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/me/mailFolders/delta")) {
          return jsonResponse({
            value: [{ id: "source-folder" }, { id: "destination-folder" }],
            "@odata.deltaLink": "https://graph.test/folders-after-move",
          });
        }
        if (url.includes("source-folder")) {
          return jsonResponse({
            value: [
              { id: "immutable-message", "@removed": { reason: "changed" } },
            ],
            "@odata.deltaLink": "https://graph.test/source-after-move",
          });
        }
        return jsonResponse({
          value: [m365Message("immutable-message")],
          "@odata.deltaLink": "https://graph.test/destination-after-move",
        });
      })
    );

    const provider = new Microsoft365Provider(makeConnection());
    const result = await provider.fetchNewEmailsSince(
      await provider.getInitialSyncToken()
    );

    expect(result.emails.map((email) => email.id)).toEqual([
      "immutable-message",
    ]);
    expect(result.nextSyncToken).toContain("source-after-move");
    expect(result.nextSyncToken).toContain("destination-after-move");
  });

  it("retries a folder after a transient 404 instead of forgetting its cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/me/mailFolders/delta")) {
          return jsonResponse({
            value: [{ id: "gone-folder" }, { id: "live-folder" }],
            "@odata.deltaLink": "https://graph.test/folders-after-first",
          });
        }
        if (url.includes("gone-folder")) {
          return jsonResponse(
            {
              error: {
                code: "ErrorItemNotFound",
                message: "Folder was temporarily unavailable",
              },
            },
            404
          );
        }
        return jsonResponse({
          value: [],
          "@odata.deltaLink": "https://graph.test/live-terminal",
        });
      })
    );

    const provider = new Microsoft365Provider(makeConnection());
    const first = await provider.fetchNewEmailsSince(
      await provider.getInitialSyncToken()
    );

    const retriedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        retriedUrls.push(url);
        if (url === "https://graph.test/folders-after-first") {
          return jsonResponse({
            value: [],
            "@odata.deltaLink": "https://graph.test/folders-after-retry",
          });
        }
        if (url.includes("gone-folder")) {
          return jsonResponse({
            value: [m365Message("message-after-transient-404")],
            "@odata.deltaLink": "https://graph.test/gone-now-readable",
          });
        }
        return jsonResponse({
          value: [],
          "@odata.deltaLink": "https://graph.test/live-after-retry",
        });
      })
    );

    const retried = await provider.fetchNewEmailsSince(first.nextSyncToken);

    expect(retriedUrls.some((url) => url.includes("gone-folder"))).toBe(true);
    expect(retried.emails.map((email) => email.id)).toEqual([
      "message-after-transient-404",
    ]);
  });

  it("collects every page of a long Microsoft 365 conversation", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        return url.includes("thread-page-2")
          ? jsonResponse({
              value: [m365Message("message-2", "conversation-1")],
            })
          : jsonResponse({
              value: [m365Message("message-1", "conversation-1")],
              "@odata.nextLink": "https://graph.test/thread-page-2",
            });
      })
    );

    const provider = new Microsoft365Provider(makeConnection());
    const messages = await provider.fetchThread("conversation-1");

    expect(requestedUrls).toHaveLength(2);
    expect(messages.map((message) => message.id)).toEqual([
      "message-1",
      "message-2",
    ]);
  });

  it("requests draft state and excludes unsent drafts from a conversation", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(String(input));
        return jsonResponse({
          value: [
            {
              ...m365Message("message-sent", "conversation-1"),
              isDraft: false,
            },
            {
              ...m365Message("message-draft", "conversation-1"),
              isDraft: true,
            },
          ],
        });
      })
    );

    const messages = await new Microsoft365Provider(
      makeConnection()
    ).fetchThread("conversation-1");

    expect(new URL(requestedUrls[0]).searchParams.get("$select")).toContain(
      "isDraft"
    );
    expect(messages.map((message) => message.id)).toEqual(["message-sent"]);
  });

  it("fails closed when a later conversation page cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("thread-page-2")
          ? jsonResponse(
              {
                error: {
                  code: "ErrorInternalServerError",
                  message: "Backend unavailable",
                },
              },
              503
            )
          : jsonResponse({
              value: [m365Message("message-1", "conversation-1")],
              "@odata.nextLink": "https://graph.test/thread-page-2",
            })
      )
    );

    await expect(
      new Microsoft365Provider(makeConnection()).fetchThread("conversation-1")
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      code: "provider_api_error",
      providerStatus: 503,
    });
  });

  it("creates subscriptions with a random clientState secret", async () => {
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          id: "subscription-1",
          expirationDateTime: "2026-07-16T18:00:00.000Z",
        });
      })
    );

    const provider = new Microsoft365Provider(makeConnection());
    const subscription = await provider.setupWebhook(
      "https://ops.test/api/integrations/email/webhook/microsoft365"
    );
    const capturedBody = requestBody as Record<string, unknown> | null;

    expect(capturedBody?.clientState).toEqual(expect.any(String));
    expect(capturedBody?.clientState).not.toBe("connection-1");
    expect(subscription.clientState).toBe(capturedBody?.clientState);
  });
});
