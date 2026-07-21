import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  afterCallbacks,
  afterError,
  classifyEmailsMock,
  getServiceRoleClientMock,
  getValidGmailTokenMock,
  jobUpdateErrorMock,
  jobUpdates,
  syncLock,
} = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
  afterError: { current: null as Error | null },
  classifyEmailsMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  getValidGmailTokenMock: vi.fn(),
  jobUpdateErrorMock: vi.fn(),
  jobUpdates: [] as Array<Record<string, unknown>>,
  syncLock: { result: "lock-owner-1" as string | null },
}));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (callback: () => unknown | Promise<unknown>) => {
      if (afterError.current) throw afterError.current;
      afterCallbacks.push(callback);
    },
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
  runWithSupabase: (_client: unknown, callback: () => Promise<unknown>) =>
    callback(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: vi.fn(async () => null),
}));

vi.mock("@/lib/email/email-connection-operation-access", () => ({
  resolveEmailConnectionOperationAccess: vi.fn(async () => ({
    allowed: true,
    actor: { userId: "user-1", companyId: "company-1" },
    connections: [
      {
        id: "connection-1",
        company_id: "company-1",
        provider: "gmail",
        type: "company",
        user_id: null,
        status: "active",
        sync_enabled: true,
      },
    ],
    connectionIds: ["connection-1"],
  })),
}));

vi.mock("@/lib/api/services/email-filter-service", () => ({
  EmailFilterService: {
    buildBlocklist: vi.fn(async () => ({ domains: new Set<string>() })),
  },
}));

vi.mock("@/lib/api/services/email-classifier", () => ({
  classifyEmails: classifyEmailsMock,
}));

vi.mock("@/lib/api/services/gmail-token", () => ({
  getValidGmailToken: getValidGmailTokenMock,
}));

import { NextRequest } from "next/server";
import { GET as scanPreviewGET } from "@/app/api/integrations/gmail/scan-preview/route";
import { POST as scanStartPOST } from "@/app/api/integrations/gmail/scan-start/route";

const messages = [
  { id: "message-inbox", labelIds: ["INBOX"] },
  { id: "message-sent", labelIds: ["SENT"] },
  { id: "message-draft", labelIds: ["DRAFT"] },
  { id: "message-spam", labelIds: ["SPAM"] },
  { id: "message-trash", labelIds: ["TRASH"] },
];

function makeSupabaseDouble() {
  class Query {
    private action: "select" | "insert" | "update" = "select";
    private payload: Record<string, unknown> | null = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq() {
      return this;
    }

    in() {
      return this;
    }

    gte() {
      return this;
    }

    lt() {
      return this;
    }

    order() {
      return this;
    }

    limit() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      this.payload = payload;
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      if (this.table === "gmail_scan_jobs") jobUpdates.push(payload);
      return this;
    }

    async single() {
      if (this.table === "email_connections") {
        return {
          data: {
            id: "connection-1",
            company_id: "company-1",
            provider: "gmail",
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_at: "2999-01-01T00:00:00.000Z",
            sync_filters: {},
          },
          error: null,
        };
      }

      if (this.table === "gmail_scan_jobs" && this.action === "insert") {
        return { data: { id: "job-1", ...this.payload }, error: null };
      }

      return { data: null, error: null };
    }

    async maybeSingle() {
      return { data: null, error: null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      const jobUpdateError =
        this.table === "gmail_scan_jobs" && this.action === "update"
          ? jobUpdateErrorMock(this.payload)
          : null;
      return Promise.resolve({
        data:
          this.table === "email_connections" && this.action === "update"
            ? [{ id: "connection-1" }]
            : null,
        error: jobUpdateError ? { message: jobUpdateError } : null,
      }).then(onfulfilled, onrejected);
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
    rpc: vi.fn(async (name: string) => {
      if (name === "acquire_email_connection_sync_lock_as_system") {
        return { data: syncLock.result, error: null };
      }
      if (name === "renew_email_connection_sync_lock_as_system") {
        return { data: true, error: null };
      }
      if (name === "release_email_connection_sync_lock_as_system") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }),
  };
}

function installGmailFetchDouble() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/gmail/v1/users/me/messages?")) {
        return Response.json({
          messages: messages.map(({ id }) => ({
            id,
            threadId: `thread-${id}`,
          })),
        });
      }

      const messageId = url.match(/\/messages\/([^?]+)/)?.[1];
      const message = messages.find(({ id }) => id === messageId);
      if (!message) return new Response("not found", { status: 404 });

      return Response.json({
        id: message.id,
        threadId: `thread-${message.id}`,
        labelIds: message.labelIds,
        snippet: `Snippet ${message.id}`,
        payload: {
          headers: [
            { name: "From", value: `${message.id}@example.com` },
            { name: "To", value: "operator@example.com" },
            { name: "Subject", value: `Subject ${message.id}` },
            { name: "Date", value: "Tue, 14 Jul 2026 12:00:00 +0000" },
          ],
        },
      });
    })
  );
}

function installThrottledGmailFetchDouble(
  options: { alwaysThrottle?: boolean } = {}
) {
  let messageAttempts = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/gmail/v1/users/me/messages?")) {
      return Response.json({
        messages: [{ id: "message-inbox", threadId: "thread-message-inbox" }],
      });
    }

    if (url.includes("/messages/message-inbox?")) {
      messageAttempts += 1;
      if (options.alwaysThrottle || messageAttempts === 1) {
        return Response.json(
          {
            error: {
              code: 429,
              message: "Too many concurrent requests for user",
              errors: [{ reason: "rateLimitExceeded" }],
            },
          },
          { status: 429 }
        );
      }
      return Response.json({
        id: "message-inbox",
        threadId: "thread-message-inbox",
        labelIds: ["INBOX"],
        snippet: "Need an estimate",
        payload: {
          headers: [
            { name: "From", value: "customer@example.com" },
            { name: "To", value: "operator@example.com" },
            { name: "Subject", value: "New project" },
            { name: "Date", value: "Tue, 14 Jul 2026 12:00:00 +0000" },
          ],
        },
      });
    }

    throw new Error(`Unexpected Gmail request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getMessageAttempts: () => messageAttempts };
}

describe("Gmail scan non-delivery filtering", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    afterError.current = null;
    jobUpdates.length = 0;
    syncLock.result = "lock-owner-1";
    classifyEmailsMock.mockReset();
    classifyEmailsMock.mockResolvedValue({
      filters: {
        excludeDomains: [],
        excludeAddresses: [],
        excludeSubjectKeywords: [],
      },
    });
    getValidGmailTokenMock.mockReset();
    getValidGmailTokenMock.mockResolvedValue("access-token");
    jobUpdateErrorMock.mockReset();
    jobUpdateErrorMock.mockReturnValue(null);
    getServiceRoleClientMock.mockReset();
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble());
    installGmailFetchDouble();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not start the background scan while another mailbox operation owns the lease", async () => {
    syncLock.result = null;
    const fetchMock = vi.mocked(fetch);

    const response = await scanStartPOST(
      new NextRequest("https://ops.test/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1" }),
      })
    );

    expect(response.status).toBe(409);
    expect(afterCallbacks).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps Inbox and Sent but excludes Draft, Spam, and Trash from preview and AI", async () => {
    const response = await scanPreviewGET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/scan-preview?connectionId=connection-1"
      )
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      emails: Array<{ id: string }>;
      total: number;
      aiAnalyzed: number;
    };
    expect(body.emails.map(({ id }) => id)).toEqual([
      "message-inbox",
      "message-sent",
    ]);
    expect(body.total).toBe(2);
    expect(body.aiAnalyzed).toBe(2);
    expect(classifyEmailsMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: "message-inbox" }),
      expect.objectContaining({ id: "message-sent" }),
    ]);
  });

  it("keeps Inbox and Sent but excludes Draft, Spam, and Trash from the background scan result and AI", async () => {
    const response = await scanStartPOST(
      new NextRequest("https://ops.test/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1" }),
      })
    );

    expect(response.status).toBe(200);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks.shift()!();

    const completed = jobUpdates.find(
      (update) => update.status === "complete" && update.result
    );
    expect(completed).toBeDefined();
    const result = completed?.result as {
      emails: Array<{ id: string }>;
      total: number;
      aiAnalyzed: number;
    };
    expect(result.emails.map(({ id }) => id)).toEqual([
      "message-inbox",
      "message-sent",
    ]);
    expect(result.total).toBe(2);
    expect(result.aiAnalyzed).toBe(2);
    expect(classifyEmailsMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: "message-inbox" }),
      expect.objectContaining({ id: "message-sent" }),
    ]);
  });

  it("retries a throttled preview read instead of silently dropping the lead candidate", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { getMessageAttempts } = installThrottledGmailFetchDouble();

    const responsePromise = scanPreviewGET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/scan-preview?connectionId=connection-1"
      )
    );
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    const body = (await response.json()) as { emails: Array<{ id: string }> };
    expect(body.emails.map(({ id }) => id)).toEqual(["message-inbox"]);
    expect(getMessageAttempts()).toBe(2);
  });

  it("retries a throttled background read instead of silently dropping the lead candidate", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { getMessageAttempts } = installThrottledGmailFetchDouble();

    const response = await scanStartPOST(
      new NextRequest("https://ops.test/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1" }),
      })
    );
    expect(response.status).toBe(200);
    expect(afterCallbacks).toHaveLength(1);

    const jobPromise = afterCallbacks.shift()!();
    await vi.runAllTimersAsync();
    await jobPromise;

    const completed = jobUpdates.find(
      (update) => update.status === "complete" && update.result
    );
    const result = completed?.result as { emails: Array<{ id: string }> };
    expect(result.emails.map(({ id }) => id)).toEqual(["message-inbox"]);
    expect(getMessageAttempts()).toBe(2);
  });

  it("fails the background scan when a progress update cannot be persisted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const completeLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    jobUpdateErrorMock.mockImplementation(
      (payload: Record<string, unknown> | null) =>
        payload?.status === "listing" ? "progress update unavailable" : null
    );

    const response = await scanStartPOST(
      new NextRequest("https://ops.test/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1" }),
      })
    );
    expect(response.status).toBe(200);

    await afterCallbacks.shift()!();

    expect(jobUpdates).toContainEqual(
      expect.objectContaining({ status: "error" })
    );
    expect(jobUpdates).not.toContainEqual(
      expect.objectContaining({ status: "complete" })
    );
    expect(console.error).toHaveBeenCalledWith(
      "[scan-job] Job job-1 failed:",
      expect.objectContaining({
        message: expect.stringContaining("progress update unavailable"),
      })
    );
    expect(completeLog).not.toHaveBeenCalledWith(
      expect.stringContaining("Job job-1 complete")
    );
  });

  it("never reports completion when the final scan result cannot be persisted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const completeLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    jobUpdateErrorMock.mockImplementation(
      (payload: Record<string, unknown> | null) =>
        payload?.status === "complete" ? "final result unavailable" : null
    );

    const response = await scanStartPOST(
      new NextRequest("https://ops.test/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1" }),
      })
    );
    expect(response.status).toBe(200);

    await afterCallbacks.shift()!();

    expect(jobUpdates).toContainEqual(
      expect.objectContaining({ status: "complete", result: expect.anything() })
    );
    expect(jobUpdates).toContainEqual(
      expect.objectContaining({
        status: "error",
        error_message: expect.stringContaining("final result unavailable"),
      })
    );
    expect(completeLog).not.toHaveBeenCalledWith(
      expect.stringContaining("Job job-1 complete")
    );
  });

  it("fails closed when the empty scan result cannot be persisted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ messages: [] }))
    );
    jobUpdateErrorMock.mockImplementation(
      (payload: Record<string, unknown> | null) =>
        payload?.status === "complete" ? "empty result unavailable" : null
    );

    const response = await scanStartPOST(
      new NextRequest("https://ops.test/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1" }),
      })
    );
    expect(response.status).toBe(200);

    await afterCallbacks.shift()!();

    expect(jobUpdates).toContainEqual(
      expect.objectContaining({
        status: "error",
        error_message: expect.stringContaining("empty result unavailable"),
      })
    );
  });

  it("surfaces a failed failure-state write instead of hiding it", async () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    jobUpdateErrorMock.mockImplementation(
      (payload: Record<string, unknown> | null) => {
        if (payload?.status === "listing") return "progress update unavailable";
        if (payload?.status === "error") return "failure state unavailable";
        return null;
      }
    );

    const response = await scanStartPOST(
      new NextRequest("https://ops.test/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1" }),
      })
    );
    expect(response.status).toBe(200);

    await expect(afterCallbacks.shift()!()).rejects.toThrow(
      "Failed to persist Gmail scan job error: failure state unavailable"
    );
    expect(errorLog).toHaveBeenCalled();
  });

  it("marks the inserted scan job failed when the background handoff cannot register", async () => {
    afterError.current = new Error("background handoff unavailable");

    const response = await scanStartPOST(
      new NextRequest("https://ops.test/api/integrations/gmail/scan-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "connection-1" }),
      })
    );

    expect(response.status).toBe(500);
    expect(jobUpdates).toContainEqual(
      expect.objectContaining({
        status: "error",
        error_message: expect.stringContaining(
          "background handoff unavailable"
        ),
      })
    );
    expect(afterCallbacks).toHaveLength(0);
  });

  it("fails the preview closed after bounded throttling retries", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getMessageAttempts } = installThrottledGmailFetchDouble({
      alwaysThrottle: true,
    });

    const responsePromise = scanPreviewGET(
      new NextRequest(
        "https://ops.test/api/integrations/gmail/scan-preview?connectionId=connection-1"
      )
    );
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.status).toBe(500);
    expect(getMessageAttempts()).toBe(4);
    expect(classifyEmailsMock).not.toHaveBeenCalled();
  });
});
