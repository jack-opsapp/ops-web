import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  })),
}));

import { ProviderApiError } from "@/lib/api/services/email-provider";
import { Microsoft365Provider } from "@/lib/api/services/providers/microsoft365-provider";
import type { EmailConnection } from "@/lib/types/email-connection";

function connection(options: { expired?: boolean } = {}): EmailConnection {
  const now = new Date();
  return {
    id: "m365-connection",
    companyId: "company-1",
    provider: "microsoft365",
    type: "company",
    userId: null,
    email: "shared@example.com",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(
      now.getTime() + (options.expired ? -60_000 : 60 * 60_000)
    ),
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

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function graphMessage(id = "message-1") {
  return {
    id,
    conversationId: "conversation-1",
    from: { emailAddress: { address: "customer@example.com" } },
    toRecipients: [{ emailAddress: { address: "shared@example.com" } }],
    ccRecipients: [],
    subject: "Estimate",
    bodyPreview: "Please quote this",
    body: { contentType: "text", content: "Please quote this" },
    uniqueBody: { contentType: "text", content: "Please quote this" },
    receivedDateTime: "2026-07-21T10:00:00.000Z",
    categories: [],
    isDraft: false,
    isRead: false,
    hasAttachments: false,
  };
}

function graphDraft() {
  return {
    id: "draft-1",
    conversationId: "conversation-1",
    toRecipients: [{ emailAddress: { address: "customer@example.com" } }],
    ccRecipients: [],
    subject: "Estimate",
    body: { contentType: "text", content: "Draft body" },
    isDraft: true,
    lastModifiedDateTime: "2026-07-21T10:00:00.000Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Microsoft365Provider read policy", () => {
  it("retries a transient Graph read within the caller's absolute deadline", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "TooManyRequests", message: "Slow down" } },
          429,
          { "retry-after": "0" }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ value: [graphMessage()] }));
    vi.stubGlobal("fetch", fetchMock);

    const emails = await new Microsoft365Provider(connection()).searchEmails(
      "estimate",
      { readPolicy: { deadlineAt: Date.now() + 10_000 } }
    );

    expect(emails.map((email) => email.id)).toEqual(["message-1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("bounds transient Graph read retries", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { error: { code: "ServiceUnavailable", message: "Try again" } },
        503,
        { "retry-after": "0" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new Microsoft365Provider(connection()).searchEmails("estimate", {
        readPolicy: { deadlineAt: Date.now() + 10_000 },
      })
    ).rejects.toBeInstanceOf(ProviderApiError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("never retries a provider mutation", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(
          { error: { code: "ServiceUnavailable", message: "Try again" } },
          503,
          { "retry-after": "0" }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new Microsoft365Provider(connection()).createLabel("OPS Pipeline")
    ).rejects.toBeInstanceOf(ProviderApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("applies the draft deadline to both token refresh and the Graph read", async () => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "client-id");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "client-secret");
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        signals.push(init?.signal as AbortSignal);
        if (String(input).includes("login.microsoftonline.com")) {
          return jsonResponse({
            access_token: "refreshed-token",
            expires_in: 3_600,
          });
        }
        return jsonResponse(graphDraft());
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const draft = await new Microsoft365Provider(
      connection({ expired: true })
    ).getDraft("draft-1", {
      deadlineAt: Date.now() + 10_000,
      context: "draft reconciliation",
    });

    expect(draft?.id).toBe("draft-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
  });

  it("uses one bounded read policy for folder and message delta pages", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        signals.push(init?.signal);
        const url = String(input);
        if (url.includes("/me/mailFolders/delta")) {
          return jsonResponse({
            value: [{ id: "inbox-id" }],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/mailFolders/delta?$deltatoken=folders-terminal",
          });
        }
        if (url.includes("/mailFolders/inbox-id/messages/delta")) {
          return jsonResponse({
            value: [graphMessage()],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages/delta?$deltatoken=messages-terminal",
          });
        }
        throw new Error(`Unexpected Graph URL: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new Microsoft365Provider(connection());
    const result = await provider.fetchNewEmailsSince(
      await provider.getInitialSyncToken()
    );

    expect(result.emails.map((email) => email.id)).toEqual(["message-1"]);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it("propagates one caller deadline through attachment thread reads", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        signals.push(init?.signal);
        const url = String(input);
        if (url.includes("/me/messages?") && url.includes("conversationId")) {
          return jsonResponse({ value: [graphMessage()] });
        }
        if (url.includes("/messages/message-1/attachments")) {
          return jsonResponse({ value: [] });
        }
        throw new Error(`Unexpected Graph URL: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const attachments = await new Microsoft365Provider(
      connection()
    ).getAttachmentsFromThread("conversation-1", {
      deadlineAt: Date.now() + 10_000,
      context: "attachment sweep",
    });

    expect(attachments).toEqual([]);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it("bounds standalone list and profile reads by default", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        signals.push(init?.signal);
        const url = String(input);
        if (url.includes("mailFolders/drafts/messages")) {
          return jsonResponse({ value: [graphDraft()] });
        }
        if (url.includes("outlook/masterCategories")) {
          return jsonResponse({ value: [] });
        }
        if (url.endsWith("/me")) {
          return jsonResponse({
            mail: "shared@example.com",
            displayName: "Shared mailbox",
          });
        }
        return jsonResponse({ value: [], "@odata.nextLink": null });
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new Microsoft365Provider(connection());
    await provider.listThreadIds({});
    await provider.listDrafts();
    await provider.listLabels();
    await provider.getProfile();

    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it("rejects a read whose response body finishes after its deadline", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn(async () => {
        now = 2_001;
        return { value: [] };
      }),
    } as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response)
    );

    await expect(
      new Microsoft365Provider(connection()).searchEmails("estimate", {
        readPolicy: { deadlineAt: 2_000, context: "slow body" },
      })
    ).rejects.toMatchObject({
      providerStatus: 504,
      providerBody: { reason: "microsoft_read_deadline_exceeded" },
    });
  });
});
