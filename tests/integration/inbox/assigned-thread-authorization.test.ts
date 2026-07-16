import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkPermissionByIdMock,
  getThreadMock,
  listMock,
  listSiblingsMock,
  resolveEmailInboxListAccessMock,
  resolveEmailOpportunityAccessMock,
  resolveEmailRouteActorMock,
} = vi.hoisted(() => ({
  checkPermissionByIdMock: vi.fn(),
  getThreadMock: vi.fn(),
  listMock: vi.fn(),
  listSiblingsMock: vi.fn(),
  resolveEmailInboxListAccessMock: vi.fn(),
  resolveEmailOpportunityAccessMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveEmailRouteActorMock,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailInboxListAccess: resolveEmailInboxListAccessMock,
  resolveEmailOpportunityAccess: resolveEmailOpportunityAccessMock,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: vi.fn(async () => ({
    uid: "firebase-subject",
    email: "login@example.com",
  })),
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: vi.fn(async () => ({
    id: "user-1",
    company_id: "company-1",
  })),
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    getThread: getThreadMock,
    list: listMock,
    listSiblings: listSiblingsMock,
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getProvider: vi.fn(() => {
      throw new Error("provider must not be reached by this test");
    }),
  },
}));

vi.mock("@/lib/api/services/phase-c-learning-service", () => ({
  PhaseCLearningService: {
    applyCorrectionToSimilar: vi.fn(),
  },
}));

function query(result: unknown[] = []) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    or: () => builder,
    in: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => ({ data: result[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: result, error: null }).then(resolve),
  });
  return builder;
}

const supabase = {
  from(table: string) {
    if (table === "email_connections") {
      return query([{ id: "connection-company" }]);
    }
    if (table === "opportunities") {
      return query([
        {
          id: "opportunity-assigned",
          client_id: null,
          title: "Framing inquiry",
          description: null,
          stage: "qualifying",
          estimated_value: null,
          priority: null,
          source: "email",
          contact_name: "Client",
          contact_email: "client@example.com",
          contact_phone: null,
          address: null,
        },
      ]);
    }
    return query([]);
  },
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabase,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, task: () => Promise<unknown>) =>
    task(),
}));

const actor = { userId: "user-1", companyId: "company-1" } as const;
const listAccess = {
  allowed: true,
  actor,
  inboxScope: "assigned",
  pipelineScope: "assigned",
  ownPersonalConnectionIds: ["connection-own"],
  assignedOpportunityIds: ["opportunity-assigned"],
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
} as const;

const thread = {
  id: "thread-internal",
  companyId: "company-1",
  connectionId: "connection-company",
  providerThreadId: "provider-thread",
  primaryCategory: "CUSTOMER",
  categoryConfidence: 1,
  categoryManuallySet: false,
  labels: [],
  archivedAt: null,
  snoozedUntil: null,
  priorityScore: 0,
  aiSummary: null,
  subject: "Framing inquiry",
  participants: ["client@example.com"],
  firstMessageAt: new Date("2026-07-15T10:00:00.000Z"),
  lastMessageAt: new Date("2026-07-15T11:00:00.000Z"),
  messageCount: 1,
  unreadCount: 1,
  latestDirection: "inbound",
  latestSenderEmail: "client@example.com",
  latestSenderName: "Client",
  latestSnippet: "Can you quote this?",
  opportunityId: "opportunity-assigned",
  clientId: null,
  nextCommitmentDueAt: null,
  hasUnresolvedCommitments: false,
  nextCommitmentId: null,
  phaseC: "none",
  agentBlockingQuestion: null,
  routing: null,
  routingReasons: [],
  routerConfidence: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveEmailRouteActorMock.mockResolvedValue({ ok: true, actor });
  resolveEmailInboxListAccessMock.mockResolvedValue(listAccess);
  resolveEmailOpportunityAccessMock.mockResolvedValue({
    allowed: true,
    actor,
    operation: "read",
    threadId: thread.id,
    connectionId: thread.connectionId,
    providerThreadId: thread.providerThreadId,
    opportunityId: thread.opportunityId,
    connectionType: "company",
    connectionOwnerId: null,
    pipelineScope: "assigned",
    inboxScope: "assigned",
    usedLegacyPipelineManage: false,
    usedLegacyInboxViewCompany: false,
  });
  checkPermissionByIdMock.mockResolvedValue(true);
  getThreadMock.mockResolvedValue(thread);
  listMock.mockResolvedValue({ threads: [thread], nextCursor: null });
  listSiblingsMock.mockResolvedValue([]);
});

describe("assigned inbox thread authorization", () => {
  it("denies detail before loading any thread or provider data", async () => {
    resolveEmailOpportunityAccessMock.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
    const { GET } = await import("@/app/api/inbox/threads/[id]/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/threads/thread-internal"),
      { params: Promise.resolve({ id: "thread-internal" }) }
    );

    expect(response.status).toBe(404);
    expect(getThreadMock).not.toHaveBeenCalled();
  });

  it("returns the canonical mailbox and provider-thread identities in detail", async () => {
    const { GET } = await import("@/app/api/inbox/threads/[id]/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/threads/thread-internal"),
      { params: Promise.resolve({ id: "thread-internal" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread).toMatchObject({
      id: "thread-internal",
      connectionId: "connection-company",
      providerThreadId: "provider-thread",
      opportunityId: "opportunity-assigned",
    });
    expect(resolveEmailOpportunityAccessMock).toHaveBeenCalledWith({
      actor,
      operation: "read",
      threadId: "thread-internal",
      supabase,
    });
  });

  it("fails closed if the thread identity changes after authorization", async () => {
    getThreadMock.mockResolvedValue({
      ...thread,
      connectionId: "connection-raced",
    });
    const { GET } = await import("@/app/api/inbox/threads/[id]/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/threads/thread-internal"),
      { params: Promise.resolve({ id: "thread-internal" }) }
    );

    expect(response.status).toBe(404);
  });

  it("uses the assigned-lead union instead of narrowing to the actor's mailboxes", async () => {
    const { GET } = await import("@/app/api/inbox/threads/route");

    const response = await GET(
      new NextRequest("https://ops.test/api/inbox/threads?scope=own")
    );

    expect(response.status).toBe(200);
    expect(resolveEmailInboxListAccessMock).toHaveBeenCalledWith({
      actor,
      supabase,
    });
    expect(listMock).toHaveBeenCalledWith(
      "company-1",
      [],
      expect.objectContaining({ scope: "company" }),
      listAccess
    );
  });

  it("fails closed before listing siblings when the anchor thread is unauthorized", async () => {
    resolveEmailOpportunityAccessMock.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
    const { GET } = await import("@/app/api/inbox/threads/[id]/siblings/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/inbox/threads/thread-internal/siblings"
      ),
      { params: Promise.resolve({ id: "thread-internal" }) }
    );

    expect(response.status).toBe(404);
    expect(getThreadMock).not.toHaveBeenCalled();
    expect(listSiblingsMock).not.toHaveBeenCalled();
  });

  it("lists sibling context through the assigned authorization union", async () => {
    const anchor = { ...thread, clientId: "client-1" };
    const sibling = {
      ...thread,
      id: "thread-sibling",
      providerThreadId: "provider-sibling",
      subject: "Second inquiry",
    };
    getThreadMock.mockResolvedValue(anchor);
    listSiblingsMock.mockResolvedValue([sibling]);
    resolveEmailOpportunityAccessMock.mockImplementation(
      async ({ threadId: requestedThreadId }: { threadId: string }) => ({
        allowed: true,
        actor,
        operation: "read",
        threadId: requestedThreadId,
        connectionId: thread.connectionId,
        providerThreadId:
          requestedThreadId === sibling.id
            ? sibling.providerThreadId
            : thread.providerThreadId,
        opportunityId: thread.opportunityId,
        connectionType: "company",
        connectionOwnerId: null,
        pipelineScope: "assigned",
        inboxScope: "assigned",
        usedLegacyPipelineManage: false,
        usedLegacyInboxViewCompany: false,
      })
    );
    const { GET } = await import("@/app/api/inbox/threads/[id]/siblings/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/inbox/threads/thread-internal/siblings"
      ),
      { params: Promise.resolve({ id: "thread-internal" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listSiblingsMock).toHaveBeenCalledWith(
      "company-1",
      "client-1",
      "thread-internal",
      listAccess,
      50
    );
    expect(body.threads).toEqual([
      expect.objectContaining({
        id: "thread-sibling",
        subject: "Second inquiry",
        lastMessageAt: "2026-07-15T11:00:00.000Z",
      }),
    ]);
  });

  it("fails closed if the sibling anchor changes after authorization", async () => {
    getThreadMock.mockResolvedValue({
      ...thread,
      clientId: "client-1",
      opportunityId: "opportunity-raced",
    });
    const { GET } = await import("@/app/api/inbox/threads/[id]/siblings/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/inbox/threads/thread-internal/siblings"
      ),
      { params: Promise.resolve({ id: "thread-internal" }) }
    );

    expect(response.status).toBe(404);
    expect(listSiblingsMock).not.toHaveBeenCalled();
  });

  it("drops a sibling whose identity changes after its access check", async () => {
    const anchor = { ...thread, clientId: "client-1" };
    const sibling = {
      ...thread,
      id: "thread-sibling",
      providerThreadId: "provider-sibling",
      subject: "Second inquiry",
    };
    getThreadMock.mockResolvedValue(anchor);
    listSiblingsMock.mockResolvedValue([sibling]);
    resolveEmailOpportunityAccessMock.mockImplementation(
      async ({ threadId: requestedThreadId }: { threadId: string }) => ({
        allowed: true,
        actor,
        operation: "read",
        threadId: requestedThreadId,
        connectionId: thread.connectionId,
        providerThreadId:
          requestedThreadId === sibling.id
            ? "provider-raced"
            : thread.providerThreadId,
        opportunityId: thread.opportunityId,
        connectionType: "company",
        connectionOwnerId: null,
        pipelineScope: "assigned",
        inboxScope: "assigned",
        usedLegacyPipelineManage: false,
        usedLegacyInboxViewCompany: false,
      })
    );
    const { GET } = await import("@/app/api/inbox/threads/[id]/siblings/route");

    const response = await GET(
      new NextRequest(
        "https://ops.test/api/inbox/threads/thread-internal/siblings"
      ),
      { params: Promise.resolve({ id: "thread-internal" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.threads).toEqual([]);
  });
});
