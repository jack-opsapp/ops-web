import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  archiveBatchMock,
  archiveMock,
  checkPermissionByIdMock,
  findUserByAuthMock,
  getThreadMock,
  markReadMock,
  resolveEmailOpportunityAccessMock,
  resolveEmailRouteActorMock,
  unarchiveBatchMock,
  unarchiveMock,
  verifyAdminAuthMock,
} = vi.hoisted(() => ({
  archiveBatchMock: vi.fn(),
  archiveMock: vi.fn(),
  checkPermissionByIdMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  getThreadMock: vi.fn(),
  markReadMock: vi.fn(),
  resolveEmailOpportunityAccessMock: vi.fn(),
  resolveEmailRouteActorMock: vi.fn(),
  unarchiveBatchMock: vi.fn(),
  unarchiveMock: vi.fn(),
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

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    archive: archiveMock,
    archiveBatch: archiveBatchMock,
    getThread: getThreadMock,
    markRead: markReadMock,
    unarchive: unarchiveMock,
    unarchiveBatch: unarchiveBatchMock,
  },
}));

vi.mock("@/lib/api/services/phase-c-learning-service", () => ({
  PhaseCLearningService: {
    applyCorrectionToSimilar: vi.fn(),
  },
}));

const supabase = { from: vi.fn() };

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabase,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, task: () => Promise<unknown>) =>
    task(),
}));

const actor = { userId: "user-1", companyId: "company-1" } as const;

function allowed(threadId: string, opportunityId = "opportunity-1") {
  return {
    allowed: true as const,
    actor,
    operation: "mutate" as const,
    threadId,
    connectionId: "connection-company",
    providerThreadId: `provider-${threadId}`,
    opportunityId,
    connectionType: "company" as const,
    connectionOwnerId: null,
    pipelineScope: "assigned" as const,
    inboxScope: "assigned" as const,
    usedLegacyPipelineManage: false,
    usedLegacyInboxViewCompany: false,
  };
}

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveEmailRouteActorMock.mockResolvedValue({ ok: true, actor });
  resolveEmailOpportunityAccessMock.mockImplementation(
    async ({ threadId }: { threadId: string }) => allowed(threadId)
  );
  checkPermissionByIdMock.mockResolvedValue(true);
  verifyAdminAuthMock.mockResolvedValue({
    uid: "firebase-subject",
    email: "login@example.com",
  });
  findUserByAuthMock.mockResolvedValue({
    id: actor.userId,
    company_id: actor.companyId,
  });
  archiveBatchMock.mockResolvedValue({
    archivedThreadIds: ["thread-a", "thread-b"],
    failedThreadIds: [],
    leadArchivedOpportunityId: "opportunity-1",
    failedOpportunityId: null,
  });
  unarchiveBatchMock.mockResolvedValue({
    unarchivedThreadIds: ["thread-a", "thread-b"],
    failedThreadIds: [],
    unarchivedOpportunityId: "opportunity-1",
    failedOpportunityId: null,
  });
  getThreadMock.mockResolvedValue({ id: "thread-a" });
  archiveMock.mockResolvedValue({
    archived: true,
    leadArchivedOpportunityId: "opportunity-1",
  });
  unarchiveMock.mockResolvedValue(undefined);
  markReadMock.mockResolvedValue(undefined);
});

describe("batch archive authorization", () => {
  it("rejects a mixed batch before any service or provider mutation", async () => {
    resolveEmailOpportunityAccessMock.mockImplementation(
      async ({ threadId }: { threadId: string }) =>
        threadId === "thread-b"
          ? { allowed: false, reason: "opportunity_other_assignee" }
          : allowed(threadId)
    );
    const { POST } =
      await import("@/app/api/inbox/threads/batch-archive/route");

    const response = await POST(
      jsonRequest("https://ops.test/api/inbox/threads/batch-archive", {
        threadIds: ["thread-a", "thread-b"],
        archiveOpportunityId: "opportunity-1",
      })
    );

    expect(response.status).toBe(404);
    expect(resolveEmailOpportunityAccessMock).toHaveBeenCalledWith({
      actor,
      operation: "mutate",
      threadId: "thread-a",
      supabase,
    });
    expect(resolveEmailOpportunityAccessMock).toHaveBeenCalledWith({
      actor,
      operation: "mutate",
      threadId: "thread-b",
      supabase,
    });
    expect(archiveBatchMock).not.toHaveBeenCalled();
  });

  it("rejects a forged opportunity id before the batch service runs", async () => {
    const { POST } =
      await import("@/app/api/inbox/threads/batch-archive/route");

    const response = await POST(
      jsonRequest("https://ops.test/api/inbox/threads/batch-archive", {
        threadIds: ["thread-a", "thread-b"],
        archiveOpportunityId: "opportunity-forged",
      })
    );

    expect(response.status).toBe(403);
    expect(archiveBatchMock).not.toHaveBeenCalled();
  });

  it("passes only preauthorized canonical ids into the archive service", async () => {
    const { POST } =
      await import("@/app/api/inbox/threads/batch-archive/route");

    const response = await POST(
      jsonRequest("https://ops.test/api/inbox/threads/batch-archive", {
        threadIds: ["thread-a", "thread-a", "thread-b"],
        archiveOpportunityId: "opportunity-1",
      })
    );

    expect(response.status).toBe(200);
    expect(resolveEmailRouteActorMock).toHaveBeenCalled();
    expect(findUserByAuthMock).not.toHaveBeenCalled();
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      actor.userId,
      "inbox.archive"
    );
    expect(archiveBatchMock).toHaveBeenCalledWith({
      companyId: actor.companyId,
      threadIds: ["thread-a", "thread-b"],
      archiveOpportunityId: "opportunity-1",
      authorizeProviderMutation: expect.any(Function),
    });
  });

  it("returns an actionable non-success response for any partial archive failure", async () => {
    archiveBatchMock.mockResolvedValueOnce({
      archivedThreadIds: ["thread-a"],
      failedThreadIds: ["thread-b"],
      leadArchivedOpportunityId: null,
      failedOpportunityId: "opportunity-1",
    });
    const { POST } =
      await import("@/app/api/inbox/threads/batch-archive/route");

    const response = await POST(
      jsonRequest("https://ops.test/api/inbox/threads/batch-archive", {
        threadIds: ["thread-a", "thread-b"],
        archiveOpportunityId: "opportunity-1",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      error: "Some threads could not be archived. Refresh and try again.",
      archivedThreadIds: ["thread-a"],
      failedThreadIds: ["thread-b"],
      failedOpportunityId: "opportunity-1",
    });
  });
});

describe("batch unarchive authorization", () => {
  it("rejects an unauthorized or stale thread before any service mutation", async () => {
    resolveEmailOpportunityAccessMock.mockImplementation(
      async ({ threadId }: { threadId: string }) =>
        threadId === "thread-b"
          ? { allowed: false, reason: "opportunity_other_assignee" }
          : allowed(threadId)
    );
    const { POST } =
      await import("@/app/api/inbox/threads/batch-unarchive/route");

    const response = await POST(
      jsonRequest("https://ops.test/api/inbox/threads/batch-unarchive", {
        threadIds: ["thread-a", "thread-b"],
        unarchiveOpportunityId: "opportunity-1",
      })
    );

    expect(response.status).toBe(404);
    expect(unarchiveBatchMock).not.toHaveBeenCalled();
  });

  it("rejects a forged opportunity id before the unarchive service runs", async () => {
    const { POST } =
      await import("@/app/api/inbox/threads/batch-unarchive/route");

    const response = await POST(
      jsonRequest("https://ops.test/api/inbox/threads/batch-unarchive", {
        threadIds: ["thread-a", "thread-b"],
        unarchiveOpportunityId: "opportunity-forged",
      })
    );

    expect(response.status).toBe(403);
    expect(unarchiveBatchMock).not.toHaveBeenCalled();
  });

  it("returns an actionable non-success response for any partial unarchive failure", async () => {
    unarchiveBatchMock.mockResolvedValueOnce({
      unarchivedThreadIds: ["thread-a"],
      failedThreadIds: ["thread-b"],
      unarchivedOpportunityId: null,
      failedOpportunityId: "opportunity-1",
    });
    const { POST } =
      await import("@/app/api/inbox/threads/batch-unarchive/route");

    const response = await POST(
      jsonRequest("https://ops.test/api/inbox/threads/batch-unarchive", {
        threadIds: ["thread-a", "thread-b"],
        unarchiveOpportunityId: "opportunity-1",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      error: "Some threads could not be restored. Refresh and try again.",
      unarchivedThreadIds: ["thread-a"],
      failedThreadIds: ["thread-b"],
      failedOpportunityId: "opportunity-1",
    });
  });
});

describe("single-thread archive authorization", () => {
  it("requires mutate authorization before loading or archiving the thread", async () => {
    resolveEmailOpportunityAccessMock.mockImplementation(
      async ({
        operation,
        threadId,
      }: {
        operation: string;
        threadId: string;
      }) =>
        operation === "mutate"
          ? { allowed: false, reason: "missing_pipeline_permission" }
          : allowed(threadId)
    );
    const { PATCH } = await import("@/app/api/inbox/threads/[id]/route");

    const response = await PATCH(
      jsonRequest("https://ops.test/api/inbox/threads/thread-a", {
        action: "archive",
      }),
      { params: Promise.resolve({ id: "thread-a" }) }
    );

    expect(response.status).toBe(404);
    expect(resolveEmailOpportunityAccessMock).toHaveBeenCalledWith({
      actor,
      operation: "mutate",
      threadId: "thread-a",
      supabase,
    });
    expect(getThreadMock).not.toHaveBeenCalled();
    expect(archiveMock).not.toHaveBeenCalled();
  });

  it("keeps non-provider mark-read actions on read authorization", async () => {
    const { PATCH } = await import("@/app/api/inbox/threads/[id]/route");

    const response = await PATCH(
      jsonRequest("https://ops.test/api/inbox/threads/thread-a", {
        action: "markRead",
        isRead: true,
      }),
      { params: Promise.resolve({ id: "thread-a" }) }
    );

    expect(response.status).toBe(200);
    expect(resolveEmailOpportunityAccessMock).toHaveBeenCalledWith({
      actor,
      operation: "read",
      threadId: "thread-a",
      supabase,
    });
    expect(markReadMock).toHaveBeenCalledWith("thread-a", true);
  });

  it("does not report ok when the provider or OPS mirror action fails", async () => {
    markReadMock.mockRejectedValueOnce(
      new Error("markRead mirror update failed: database unavailable")
    );
    const { PATCH } = await import("@/app/api/inbox/threads/[id]/route");

    const response = await PATCH(
      jsonRequest("https://ops.test/api/inbox/threads/thread-a", {
        action: "markRead",
        isRead: true,
      }),
      { params: Promise.resolve({ id: "thread-a" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error:
        "Action failed: markRead mirror update failed: database unavailable",
    });
    expect(body.ok).not.toBe(true);
  });
});
