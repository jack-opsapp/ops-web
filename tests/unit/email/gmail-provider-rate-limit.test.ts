import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProviderApiError,
  type NormalizedEmail,
} from "@/lib/api/services/email-provider";
import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import {
  fetchGmailRead,
  mapGmailReads,
} from "@/lib/api/services/providers/gmail-read";
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

function gmailMessage(id: string) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: "1710000000000",
    labelIds: ["INBOX"],
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

function historyResponse(ids: string[]): Response {
  return jsonResponse({
    history: [
      {
        messagesAdded: ids.map((id) => ({ message: { id } })),
      },
    ],
    historyId: "history-final",
  });
}

function messageRequests(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes("/messages/"));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GmailProvider read throttling", () => {
  it("keeps the deadline active until the Gmail response body is consumed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"emailAddress":'));
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(init.signal?.reason),
                { once: true }
              );
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchGmailRead(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {},
      { context: "profile body", deadlineAt: Date.now() + 1_000 }
    );
    const rejection = expect(response.json()).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 504,
      providerBody: { reason: "gmail_read_deadline_exceeded" },
    });
    await vi.advanceTimersByTimeAsync(1_001);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the typed deadline when a provider JSON body stalls", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"emailAddress":'));
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(init.signal?.reason),
                { once: true }
              );
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(makeConnection()).getProfile();
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 504,
      providerBody: { reason: "gmail_read_deadline_exceeded" },
    });
    await vi.advanceTimersByTimeAsync(45_001);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh bounded deadline when a provider method begins", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    const provider = new GmailProvider(makeConnection());
    vi.setSystemTime(new Date("2026-07-21T08:00:45.001Z"));
    const fetchMock = vi.fn(async () =>
      jsonResponse({ emailAddress: "operator@example.com" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider.getProfile()).resolves.toEqual({
      email: "operator@example.com",
      name: "operator@example.com",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one deadline across history discovery and message reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T08:00:00.000Z"));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        vi.setSystemTime(new Date("2026-07-21T08:00:45.001Z"));
        return historyResponse(["message-1"]);
      }
      return jsonResponse(gmailMessage("message-1"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(makeConnection()).fetchNewEmailsSince("history-start")
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 504,
      providerBody: { reason: "gmail_read_deadline_exceeded" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds an expired-token refresh and its body with the same read deadline", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "gmail-client");
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "gmail-secret");
    const expiredConnection = makeConnection();
    expiredConnection.expiresAt = new Date(Date.now() - 1);
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe("https://oauth2.googleapis.com/token");
        expect(init?.method).toBe("POST");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('{"access_token":"fresh-token",')
              );
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(init.signal?.reason),
                { once: true }
              );
            },
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(expiredConnection).getProfile();
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 504,
      providerBody: { reason: "gmail_read_deadline_exceeded" },
    });
    await vi.advanceTimersByTimeAsync(45_001);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exposes one bounded valid-token read without calling Gmail", async () => {
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "gmail-client");
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "gmail-secret");
    const expiredConnection = makeConnection();
    expiredConnection.expiresAt = new Date(Date.now() - 1);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      return jsonResponse({ access_token: "fresh-token", expires_in: 3_600 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      new GmailProvider(expiredConnection).getValidAccessToken({
        deadlineAt: Date.now() + 10_000,
        context: "phase C connection rehydration",
      })
    ).resolves.toBe("fresh-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries the token-refresh POST used by a Gmail read", async () => {
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "gmail-client");
    vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "gmail-secret");
    const expiredConnection = makeConnection();
    expiredConnection.expiresAt = new Date(Date.now() - 1);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      return jsonResponse({ error: "temporarily_unavailable" }, 503, {
        "retry-after": "1",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(expiredConnection).getProfile()
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors a caller deadline passed into fetchThread", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ messages: [gmailMessage("message-1")] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(makeConnection()).fetchThread("thread-recovery", {
        deadlineAt: Date.now() - 1,
        context: "expired Gmail history thread recovery",
      })
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 504,
      providerBody: { reason: "gmail_read_deadline_exceeded" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never shortens a long Retry-After delay", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 429,
              message: "Too many requests",
              errors: [{ reason: "rateLimitExceeded" }],
            },
          },
          429,
          { "retry-after": "120" }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchGmailRead(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {},
      { context: "profile", deadlineAt: Date.now() + 130_000 }
    );
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      timeoutSpy.mock.calls.filter(([, delay]) => delay === 120_000)
    ).toHaveLength(1);
  });

  it("fails immediately instead of retrying before Retry-After when the shared deadline is shorter", async () => {
    const providerBody = {
      error: {
        code: 429,
        message: "Too many requests",
        errors: [{ reason: "rateLimitExceeded" }],
      },
    };
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn(async () =>
      jsonResponse(providerBody, 429, { "retry-after": "120" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGmailRead(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/message-1",
        {},
        {
          context: "messages.get (message-1)",
          deadlineAt: Date.now() + 10_000,
        }
      )
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      message: "Gmail messages.get (message-1): Too many requests",
      providerStatus: 429,
      providerBody,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      timeoutSpy.mock.calls.filter(([, delay]) => delay !== 10_000)
    ).toHaveLength(0);
  });

  it("aborts an in-flight Gmail read when its deadline expires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if (!init?.signal) return jsonResponse({ ok: true });
        return new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener(
            "abort",
            () => reject(init.signal!.reason),
            { once: true }
          );
        });
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchGmailRead(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {},
      { context: "profile", deadlineAt: Date.now() + 1_000 }
    );
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 504,
      providerBody: { reason: "gmail_read_deadline_exceeded" },
    });
    await vi.advanceTimersByTimeAsync(1_001);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes one shared deadline policy to every paced mapper call", async () => {
    const deadlineAt = Date.now() + 60_000;
    const policies: Array<{ deadlineAt?: number; context?: string }> = [];

    const results = await mapGmailReads(
      ["one", "two"],
      async (item, _index, policy) => {
        policies.push(policy);
        return item.toUpperCase();
      },
      { deadlineAt, context: "profile batch" }
    );

    expect(results).toEqual(["ONE", "TWO"]);
    expect(policies).toEqual([
      { deadlineAt, context: "profile batch" },
      { deadlineAt, context: "profile batch" },
    ]);
  });

  it("caps messages.get fan-out while preserving provider order", async () => {
    const ids = Array.from(
      { length: 12 },
      (_, index) => `message-${index + 1}`
    );
    let activeReads = 0;
    let maxActiveReads = 0;

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) return historyResponse(ids);

      const messageId = url.pathname.match(/\/messages\/([^/]+)$/)?.[1];
      if (!messageId) throw new Error(`Unexpected Gmail request: ${url}`);

      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeReads -= 1;
      return jsonResponse(gmailMessage(messageId));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GmailProvider(
      makeConnection()
    ).fetchNewEmailsSince("history-start");

    expect(maxActiveReads).toBeLessThanOrEqual(5);
    expect(result.emails.map((email: NormalizedEmail) => email.id)).toEqual(
      ids
    );
  });

  it("retries a throttled messages.get with exponential backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return historyResponse(["message-1"]);
      }

      const attempt = messageRequests(fetchMock).length;
      if (attempt === 1) {
        return jsonResponse(
          {
            error: {
              code: 429,
              message: "Too many concurrent requests for user",
              errors: [{ reason: "rateLimitExceeded" }],
            },
          },
          429
        );
      }
      return jsonResponse(gmailMessage("message-1"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(
      makeConnection()
    ).fetchNewEmailsSince("history-start");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.emails.map((email) => email.id)).toEqual(["message-1"]);
    expect(messageRequests(fetchMock)).toHaveLength(2);
    expect(timeoutSpy.mock.calls.map(([, delay]) => delay)).toContain(1_000);
  });

  it("retries Gmail 403 user rate limits", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return historyResponse(["message-1"]);
      }

      attempts += 1;
      if (attempts === 1) {
        return jsonResponse(
          {
            error: {
              code: 403,
              message: "User Rate Limit Exceeded",
              errors: [{ reason: "userRateLimitExceeded" }],
            },
          },
          403
        );
      }
      return jsonResponse(gmailMessage("message-1"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(
      makeConnection()
    ).fetchNewEmailsSince("history-start");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.emails.map((email) => email.id)).toEqual(["message-1"]);
    expect(attempts).toBe(2);
  });

  it("does not retry permanent Gmail 403 responses", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return historyResponse(["message-1"]);
      }
      return jsonResponse(
        {
          error: {
            code: 403,
            message: "Forbidden",
            errors: [{ reason: "forbidden" }],
          },
        },
        403
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(makeConnection()).fetchNewEmailsSince("history-start")
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 403,
    });
    expect(messageRequests(fetchMock)).toHaveLength(1);
  });

  it("stops after four attempts and surfaces the original typed provider failure", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return historyResponse(["message-1"]);
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
      message: "Gmail messages.get (message-1): Backend unavailable",
      providerStatus: 503,
      providerBody: {
        error: {
          code: 503,
          message: "Backend unavailable",
          errors: [{ reason: "backendError" }],
        },
      },
    });
    await vi.runAllTimersAsync();

    await rejection;
    expect(messageRequests(fetchMock)).toHaveLength(4);
    expect(
      timeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .filter((delay) => [1_000, 2_000, 4_000].includes(delay as number))
    ).toEqual([1_000, 2_000, 4_000]);
  });

  it("retries only the throttled message and emits every message once", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ids = Array.from({ length: 6 }, (_, index) => `message-${index + 1}`);
    const attemptsById = new Map<string, number>();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) return historyResponse(ids);

      const messageId = url.pathname.match(/\/messages\/([^/]+)$/)?.[1];
      if (!messageId) throw new Error(`Unexpected Gmail request: ${url}`);
      const attempt = (attemptsById.get(messageId) ?? 0) + 1;
      attemptsById.set(messageId, attempt);
      if (messageId === "message-3" && attempt === 1) {
        return jsonResponse(
          {
            error: {
              code: 429,
              message: "Too many concurrent requests for user",
              errors: [{ reason: "rateLimitExceeded" }],
            },
          },
          429
        );
      }
      return jsonResponse(gmailMessage(messageId));
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(
      makeConnection()
    ).fetchNewEmailsSince("history-start");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.nextSyncToken).toBe("history-final");
    expect(result.emails.map((email) => email.id)).toEqual(ids);
    expect(attemptsById.get("message-3")).toBe(2);
    for (const id of ids.filter((id) => id !== "message-3")) {
      expect(attemptsById.get(id)).toBe(1);
    }
  });

  it("honors Retry-After when it exceeds exponential backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return historyResponse(["message-1"]);
      }
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse(
          {
            error: {
              code: 429,
              message: "Too many requests",
              errors: [{ reason: "rateLimitExceeded" }],
            },
          },
          429,
          { "retry-after": "5" }
        );
      }
      return jsonResponse(gmailMessage("message-1"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(
      makeConnection()
    ).fetchNewEmailsSince("history-start");
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(timeoutSpy.mock.calls.map(([, delay]) => delay)).toContain(5_000);
  });

  it("never retries a Gmail send mutation", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 429,
            message: "Too many requests",
            errors: [{ reason: "rateLimitExceeded" }],
          },
        },
        429
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(makeConnection()).sendEmail({
        to: ["customer@example.com"],
        subject: "Estimate",
        body: "Hello",
      })
    ).rejects.toThrow("Gmail send failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when labels.list returns a provider error", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const providerBody = {
      error: {
        code: 503,
        message: "Labels unavailable",
        errors: [{ reason: "backendError" }],
      },
    };
    const fetchMock = vi.fn(async () => jsonResponse(providerBody, 503));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(makeConnection()).listLabels();
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: ProviderApiError.name,
      message: "Gmail labels.list: Labels unavailable",
      providerStatus: 503,
      providerBody,
    });
    await vi.runAllTimersAsync();

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails closed when labels.list returns a malformed success payload", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(makeConnection()).listLabels()
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      providerStatus: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when profile.get returns a provider error", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const providerBody = {
      error: {
        code: 503,
        message: "Profile unavailable",
        errors: [{ reason: "backendError" }],
      },
    };
    const fetchMock = vi.fn(async () => jsonResponse(providerBody, 503));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(makeConnection()).getProfile();
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: ProviderApiError.name,
      message: "Gmail profile.get: Profile unavailable",
      providerStatus: 503,
      providerBody,
    });
    await vi.runAllTimersAsync();

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not send when reply metadata cannot be read", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const providerBody = {
      error: {
        code: 503,
        message: "Reply metadata unavailable",
        errors: [{ reason: "backendError" }],
      },
    };
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse(providerBody, 503)
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GmailProvider(makeConnection()).sendEmail({
      to: ["customer@example.com"],
      subject: "Re: Estimate",
      body: "Hello",
      inReplyTo: "original-message",
      threadId: "thread-1",
    });
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: ProviderApiError.name,
      message:
        "Gmail messages.get reply metadata (original-message): Reply metadata unavailable",
      providerStatus: 503,
      providerBody,
    });
    await vi.runAllTimersAsync();

    await rejection;
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.endsWith("/messages/send"))).toHaveLength(
      0
    );
    expect(urls).toHaveLength(4);
  });

  it("does not send a reply when Gmail omits the source Message-ID", async () => {
    const metadataBody = { payload: { headers: [] } };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/messages/original-message?")) {
        return jsonResponse(metadataBody);
      }
      return jsonResponse({ id: "sent-message", threadId: "thread-1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GmailProvider(makeConnection()).sendEmail({
        to: ["customer@example.com"],
        subject: "Re: Estimate",
        body: "Hello",
        inReplyTo: "original-message",
        threadId: "thread-1",
      })
    ).rejects.toMatchObject({
      name: ProviderApiError.name,
      message:
        "Gmail messages.get reply metadata (original-message): response did not contain Message-ID",
      providerStatus: 200,
      providerBody: metadataBody,
    });

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.endsWith("/messages/send"))).toHaveLength(
      0
    );
    expect(urls).toHaveLength(1);
  });
});
