import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  afterCallbacks,
  classifyEmailsMock,
  getServiceRoleClientMock,
  getValidGmailTokenMock,
  jobUpdates,
} = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
  classifyEmailsMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  getValidGmailTokenMock: vi.fn(),
  jobUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (callback: () => unknown | Promise<unknown>) => {
      afterCallbacks.push(callback);
    },
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  requireEmailCompanyAccess: vi.fn(async () => null),
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
      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
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

describe("Gmail scan non-delivery filtering", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    jobUpdates.length = 0;
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
    getServiceRoleClientMock.mockReset();
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble());
    installGmailFetchDouble();
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
});
