import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchThreadMock,
  findUserByAuthMock,
  getImageAttachmentsMock,
  getProviderMock,
  resolveEmailOpportunityAccessMock,
  resolveEmailRouteActorMock,
  searchEmailsMock,
  verifyAdminAuthMock,
} = vi.hoisted(() => ({
  fetchThreadMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  getImageAttachmentsMock: vi.fn(),
  getProviderMock: vi.fn(),
  resolveEmailOpportunityAccessMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
  searchEmailsMock: vi.fn(),
  verifyAdminAuthMock: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: resolveEmailOpportunityAccessMock,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getProvider: getProviderMock },
}));

type Row = Record<string, unknown>;

const rows: Record<string, Row[]> = {
  email_connections: [
    {
      id: "connection-other-personal",
      company_id: "company-1",
      provider: "gmail",
      type: "individual",
      user_id: "user-2",
      email: "other@example.com",
      access_token: "other-access",
      refresh_token: "other-refresh",
      expires_at: "2026-07-16T00:00:00.000Z",
      sync_enabled: true,
      status: "active",
      created_at: "2026-07-15T12:00:00.000Z",
      updated_at: "2026-07-15T12:00:00.000Z",
    },
    {
      id: "connection-company",
      company_id: "company-1",
      provider: "gmail",
      type: "company",
      user_id: null,
      email: "office@example.com",
      access_token: "company-access",
      refresh_token: "company-refresh",
      expires_at: "2026-07-16T00:00:00.000Z",
      sync_enabled: true,
      status: "active",
      created_at: "2026-07-14T12:00:00.000Z",
      updated_at: "2026-07-14T12:00:00.000Z",
    },
  ],
  clients: [
    {
      id: "client-1",
      company_id: "company-1",
      email: "client@example.com",
      deleted_at: null,
    },
  ],
  sub_clients: [],
};

function createQuery(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let limitCount: number | null = null;
  let orderColumn: string | null = null;
  let orderAscending = true;
  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return query;
    },
    is(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      orderColumn = column;
      orderAscending = options?.ascending ?? true;
      return query;
    },
    limit(value: number) {
      limitCount = value;
      return query;
    },
    update() {
      return query;
    },
    async single() {
      return { data: result()[0] ?? null, error: null };
    },
    async maybeSingle() {
      const data = result();
      return {
        data: data.length === 1 ? data[0] : null,
        error: data.length > 1 ? { message: "multiple rows" } : null,
      };
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve({ data: result(), error: null }).then(
        onfulfilled,
        onrejected
      );
    },
  };

  function result() {
    let data = [...(rows[table] ?? [])].filter((row) =>
      filters.every((filter) => filter(row))
    );
    if (orderColumn) {
      const column = orderColumn;
      data.sort((left, right) => {
        const comparison = String(left[column] ?? "").localeCompare(
          String(right[column] ?? "")
        );
        return orderAscending ? comparison : -comparison;
      });
    }
    if (limitCount !== null) data = data.slice(0, limitCount);
    return data;
  }

  return query;
}

const supabase = {
  from(table: string) {
    return createQuery(table);
  },
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabase,
}));

const actor = { userId: "user-1", companyId: "company-1" } as const;
const providerMessage = {
  id: "message-1",
  threadId: "provider-thread-1",
  from: "client@example.com",
  fromName: "Client",
  to: ["office@example.com"],
  cc: [],
  subject: "Framing inquiry",
  snippet: "Can you quote this?",
  bodyText: "Can you quote this?",
  bodyHtml: null,
  date: new Date("2026-07-15T10:00:00.000Z"),
  isRead: false,
  hasAttachments: false,
  attachments: [],
  labels: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyAdminAuthMock.mockResolvedValue({
    uid: "firebase-subject",
    email: "login@example.com",
  });
  findUserByAuthMock.mockResolvedValue({
    id: actor.userId,
    company_id: actor.companyId,
  });
  resolveEmailRouteActorMock.mockResolvedValue({ ok: true, actor });
  resolveEmailOpportunityAccessMock.mockResolvedValue({
    allowed: true,
    actor,
    operation: "read",
    threadId: "thread-internal",
    connectionId: "connection-company",
    providerThreadId: "provider-thread-1",
    opportunityId: "opportunity-1",
    connectionType: "company",
    connectionOwnerId: null,
    pipelineScope: "assigned",
    inboxScope: "assigned",
    usedLegacyPipelineManage: false,
    usedLegacyInboxViewCompany: false,
  });
  fetchThreadMock.mockResolvedValue([providerMessage]);
  getImageAttachmentsMock.mockResolvedValue([]);
  searchEmailsMock.mockResolvedValue([providerMessage]);
  getProviderMock.mockReturnValue({
    fetchThread: fetchThreadMock,
    getImageAttachmentsFromThread: getImageAttachmentsMock,
    searchEmails: searchEmailsMock,
  });
});

describe("legacy provider-route authorization", () => {
  it("fails closed on the unanchored raw inbox-list mode", async () => {
    const { GET } = await import("@/app/api/integrations/email/inbox/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/email/inbox?companyId=company-1"
      )
    );

    expect(response.status).toBe(404);
    expect(resolveEmailRouteActorMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { claimedCompanyId: "company-1" }
    );
    expect(findUserByAuthMock).not.toHaveBeenCalled();
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(searchEmailsMock).not.toHaveBeenCalled();
  });

  it("loads an authorized provider thread through its canonical mailbox identity", async () => {
    const { GET } = await import("@/app/api/integrations/email/inbox/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/email/inbox?companyId=company-1&threadId=thread-internal"
      )
    );

    expect(response.status).toBe(200);
    expect(resolveEmailOpportunityAccessMock).toHaveBeenCalledWith({
      actor,
      operation: "read",
      threadId: "thread-internal",
      supabase,
    });
    expect(getProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "connection-company",
        type: "company",
        email: "office@example.com",
      })
    );
    expect(fetchThreadMock).toHaveBeenCalledWith("provider-thread-1");
  });

  it("ignores legacy connector metadata on an authorized company mailbox", async () => {
    const companyConnection = rows.email_connections.find(
      (row) => row.id === "connection-company"
    );
    expect(companyConnection).toBeDefined();
    companyConnection!.user_id = "legacy-connector-user";

    try {
      const { GET } = await import("@/app/api/integrations/email/inbox/route");
      const response = await GET(
        new NextRequest(
          "https://ops.test/api/integrations/email/inbox?companyId=company-1&threadId=thread-internal"
        )
      );

      expect(response.status).toBe(200);
      expect(getProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "connection-company",
          type: "company",
        })
      );
    } finally {
      companyConnection!.user_id = null;
    }
  });

  it("denies an unauthorized canonical thread before selecting a mailbox or provider", async () => {
    resolveEmailOpportunityAccessMock.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
    const { GET } = await import("@/app/api/integrations/email/inbox/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/email/inbox?companyId=company-1&threadId=thread-other"
      )
    );

    expect(response.status).toBe(404);
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(fetchThreadMock).not.toHaveBeenCalled();
  });

  it("fails closed on the unanchored client provider-search route", async () => {
    const { GET } = await import(
      "@/app/api/integrations/email/client-threads/route"
    );

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/integrations/email/client-threads?companyId=company-1&clientId=client-1"
      )
    );

    expect(response.status).toBe(404);
    expect(resolveEmailRouteActorMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { claimedCompanyId: "company-1" }
    );
    expect(findUserByAuthMock).not.toHaveBeenCalled();
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(searchEmailsMock).not.toHaveBeenCalled();
  });
});
