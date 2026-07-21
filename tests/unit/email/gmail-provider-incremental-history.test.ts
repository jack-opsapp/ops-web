import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProviderApiError,
  SyncTokenExpiredError,
} from "@/lib/api/services/email-provider";
import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function makeConnection(): EmailConnection {
  const now = new Date();
  return {
    id: "connection-1",
    companyId: "company-1",
    provider: "gmail",
    type: "company",
    userId: null,
    email: "operator@example.com",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    historyId: "history-start",
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

function gmailMessage(id: string, labelIds: string[] = ["INBOX"]) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: "1710000000000",
    labelIds,
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: `Customer ${id} <${id}@example.com>` },
        { name: "To", value: "operator@example.com" },
        { name: "Subject", value: `Message ${id}` },
      ],
      body: {
        data: Buffer.from(`Body ${id}`, "utf8").toString("base64url"),
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  { label: null, method: "fetchNewEmailsSince" as const },
  { label: "SENT", method: "fetchSentEmailsSince" as const },
])("GmailProvider $label incremental history", ({ label, method }) => {
  it("reads every history page, deduplicates message ids, and returns the final history id", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/history")) {
        expect(url.searchParams.get("startHistoryId")).toBe("history-start");
        expect(url.searchParams.get("labelId")).toBe(label);

        if (!url.searchParams.get("pageToken")) {
          return jsonResponse({
            history: [
              {
                messagesAdded: [
                  { message: { id: "message-1" } },
                  { message: { id: "message-2" } },
                ],
              },
            ],
            nextPageToken: "page-2",
            historyId: "history-intermediate",
          });
        }

        expect(url.searchParams.get("pageToken")).toBe("page-2");
        return jsonResponse({
          history: [
            {
              messagesAdded: [
                { message: { id: "message-2" } },
                { message: { id: "message-3" } },
              ],
            },
          ],
          historyId: "history-final",
        });
      }

      const messageId = url.pathname.match(/\/messages\/([^/]+)$/)?.[1];
      if (messageId) return jsonResponse(gmailMessage(messageId));

      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GmailProvider(makeConnection())[method](
      "history-start"
    );

    expect(result.nextSyncToken).toBe("history-final");
    expect(result.emails.map((email) => email.id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);

    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(
      requestedUrls.filter((url) => url.includes("/history?"))
    ).toHaveLength(2);
    expect(
      requestedUrls.filter((url) => url.includes("/messages/"))
    ).toHaveLength(3);
  });
});

describe("GmailProvider incremental history failures", () => {
  it("throws a typed token error from a later history page before fetching messages", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (!url.searchParams.get("pageToken")) {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "message-1" } }] }],
          nextPageToken: "page-2",
          historyId: "history-intermediate",
        });
      }
      return jsonResponse(
        {
          error: {
            code: 404,
            message: "Requested startHistoryId is no longer available",
            errors: [{ reason: "notFound" }],
          },
        },
        404
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(makeConnection()).fetchNewEmailsSince("history-start")
    ).rejects.toBeInstanceOf(SyncTokenExpiredError);

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/messages/")
      )
    ).toBe(false);
  });

  it("throws a typed provider error when any message fetch fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "message-1" } }] }],
          historyId: "history-final",
        });
      }
      return jsonResponse(
        {
          error: {
            code: 503,
            message: "Backend unavailable",
            errors: [{ reason: "backendError" }],
          },
        },
        503
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(
      makeConnection()
    ).fetchNewEmailsSince("history-start");
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: ProviderApiError.name,
      code: "provider_api_error",
      providerStatus: 503,
    });
    await vi.runAllTimersAsync();
    await rejection;
  });

  it.each([404, 410])(
    "advances the history cursor when a discovered message becomes a %s tombstone",
    async (status) => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/history")) {
          return jsonResponse({
            history: [
              {
                messagesAdded: [
                  { message: { id: "message-gone" } },
                  { message: { id: "message-present" } },
                ],
              },
            ],
            historyId: "history-final",
          });
        }
        if (url.pathname.endsWith("/messages/message-gone")) {
          return jsonResponse(
            {
              error: {
                code: status,
                message: "Requested message no longer exists",
                errors: [{ reason: "notFound" }],
              },
            },
            status
          );
        }
        if (url.pathname.endsWith("/messages/message-present")) {
          return jsonResponse(gmailMessage("message-present"));
        }
        throw new Error(`Unexpected Gmail request: ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await new GmailProvider(
        makeConnection()
      ).fetchNewEmailsSince("history-start");

      expect(result.nextSyncToken).toBe("history-final");
      expect(result.emails.map((email) => email.id)).toEqual([
        "message-present",
      ]);
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes("/messages/message-gone")
        )
      ).toHaveLength(1);
    }
  );

  it("does not downgrade a search-time 404 into a tombstone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/messages")) {
          return jsonResponse({ messages: [{ id: "message-gone" }] });
        }
        return jsonResponse(
          {
            error: {
              code: 404,
              message: "Requested message no longer exists",
              errors: [{ reason: "notFound" }],
            },
          },
          404
        );
      })
    );

    await expect(
      new GmailProvider(makeConnection()).searchEmails("estimate")
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      code: "provider_api_error",
      providerStatus: 404,
    });
  });

  it("throws a typed provider error when an expired-history thread fetch fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 503,
              message: "Backend unavailable",
              errors: [{ reason: "backendError" }],
            },
          },
          503
        )
      )
    );

    const resultPromise = new GmailProvider(makeConnection()).fetchThread(
      "thread-recovery"
    );
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: ProviderApiError.name,
      code: "provider_api_error",
      providerStatus: 503,
    });
    await vi.runAllTimersAsync();
    await rejection;
  });
});

describe("GmailProvider incremental history delivery labels", () => {
  it("excludes draft, spam, and trash messages while retaining inbox and sent delivery", async () => {
    const labelsByMessageId = new Map<string, string[]>([
      ["message-inbox", ["INBOX"]],
      ["message-sent", ["SENT"]],
      ["message-draft", ["DRAFT"]],
      ["message-spam", ["SPAM"]],
      ["message-trash", ["TRASH"]],
    ]);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        expect(url.searchParams.get("labelId")).toBeNull();
        return jsonResponse({
          history: [
            {
              messagesAdded: [...labelsByMessageId.keys()].map((id) => ({
                message: { id },
              })),
            },
          ],
          historyId: "history-final",
        });
      }

      const messageId = url.pathname.match(/\/messages\/([^/]+)$/)?.[1];
      if (messageId) {
        return jsonResponse(
          gmailMessage(messageId, labelsByMessageId.get(messageId))
        );
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GmailProvider(
      makeConnection()
    ).fetchNewEmailsSince("history-start");

    expect(result.nextSyncToken).toBe("history-final");
    expect(result.emails.map((email) => email.id)).toEqual([
      "message-inbox",
      "message-sent",
    ]);
  });
});

describe("GmailProvider full-thread delivery labels", () => {
  it("excludes draft, spam, and trash objects while retaining inbox and sent messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          messages: [
            gmailMessage("message-inbox", ["INBOX"]),
            gmailMessage("message-sent", ["SENT"]),
            gmailMessage("message-draft", ["DRAFT"]),
            gmailMessage("message-spam", ["SPAM"]),
            gmailMessage("message-trash", ["TRASH"]),
          ],
        })
      )
    );

    const messages = await new GmailProvider(makeConnection()).fetchThread(
      "thread-1"
    );

    expect(messages.map((message) => message.id)).toEqual([
      "message-inbox",
      "message-sent",
    ]);
  });
});

describe("GmailProvider bounded search pagination", () => {
  it("walks result pages up to the requested unique-message limit", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages")) {
        expect(url.searchParams.get("q")).toBe("in:anywhere after:1700000000");
        if (!url.searchParams.get("pageToken")) {
          expect(url.searchParams.get("maxResults")).toBe("3");
          return jsonResponse({
            messages: [{ id: "message-1" }, { id: "message-2" }],
            nextPageToken: "page-2",
          });
        }
        expect(url.searchParams.get("pageToken")).toBe("page-2");
        expect(url.searchParams.get("maxResults")).toBe("1");
        return jsonResponse({ messages: [{ id: "message-3" }] });
      }

      const messageId = url.pathname.match(/\/messages\/([^/]+)$/)?.[1];
      if (messageId) return jsonResponse(gmailMessage(messageId));
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const emails = await new GmailProvider(makeConnection()).searchEmails(
      "in:anywhere",
      {
        maxResults: 3,
        after: new Date(1_700_000_000_000),
      }
    );

    expect(emails.map((email) => email.id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        new URL(String(input)).pathname.endsWith("/messages")
      )
    ).toHaveLength(2);
  });
});
