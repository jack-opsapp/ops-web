/**
 * /api/data-review[/[id]/link|quarantine] — actor-scoped dispatch.
 *
 * Asserts every route derives actor + company from the authenticated OPS user,
 * requires an exact mailbox selector, never trusts body authority, and leaves
 * row-specific pipeline/inbox authorization to the guarded service/RPC layer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUserMock,
  verifyAuthMock,
  getQueueMock,
  linkThreadMock,
  quarantineThreadMock,
  createTrustedNotificationsMock,
} = vi.hoisted(() => ({
  findUserMock: vi.fn(),
  verifyAuthMock: vi.fn(),
  getQueueMock: vi.fn(),
  linkThreadMock: vi.fn(),
  quarantineThreadMock: vi.fn(),
  createTrustedNotificationsMock: vi.fn(),
}));

const serviceClient = {};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceClient,
}));
vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: (_db: unknown, callback: () => Promise<unknown>) =>
    callback(),
}));
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAuthMock,
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserMock,
}));
vi.mock("@/lib/api/services/lead-data-review-service", () => ({
  isDataReviewAccessDenied: () => false,
  LeadDataReviewService: {
    getQueue: getQueueMock,
    linkThread: linkThreadMock,
    quarantineThread: quarantineThreadMock,
  },
}));
vi.mock("@/lib/notifications/server-notification-service", () => ({
  createTrustedNotifications: createTrustedNotificationsMock,
}));

import { GET } from "@/app/api/data-review/route";
import { POST as LINK } from "@/app/api/data-review/[id]/link/route";
import { POST as QUARANTINE } from "@/app/api/data-review/[id]/quarantine/route";

function getReq() {
  return {} as unknown as Parameters<typeof GET>[0];
}
function postReq(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof LINK>[0];
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  verifyAuthMock.mockResolvedValue({ uid: "fb-1", email: "u@co.com" });
  findUserMock.mockResolvedValue({
    id: "user-1",
    company_id: "co-1",
    is_active: true,
  });
  getQueueMock.mockResolvedValue({
    split: [],
    terminalLive: [],
    quarantinedCount: 2198,
  });
  linkThreadMock.mockResolvedValue({
    providerThreadId: "T",
    targetOpportunityId: "opp-1",
    targetTitle: "Deck",
    activitiesRepointed: 3,
    resolutionVersion: 1,
  });
  quarantineThreadMock.mockResolvedValue({
    providerThreadId: "T",
    subject: "Deck quote",
    activitiesQuarantined: 4,
    resolutionVersion: 1,
  });
  createTrustedNotificationsMock.mockResolvedValue({
    attempted: 1,
    errors: 0,
    createdRecipientIds: ["user-1"],
    createdNotifications: [
      { notificationId: "notification-1", recipientUserId: "user-1" },
    ],
  });
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/data-review — gate + shape", () => {
  it("401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(getQueueMock).not.toHaveBeenCalled();
  });

  it("200 returns the queue incl. the muted quarantined count", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(findUserMock).toHaveBeenCalledWith(
      "fb-1",
      undefined,
      "id, company_id, is_active"
    );
    expect(getQueueMock).toHaveBeenCalledWith({
      actorUserId: "user-1",
      companyId: "co-1",
    });
    await expect(res.json()).resolves.toEqual({
      split: [],
      terminalLive: [],
      quarantinedCount: 2198,
    });
  });

  it("403 when the cryptographically linked OPS user is inactive", async () => {
    findUserMock.mockResolvedValue({
      id: "user-1",
      company_id: "co-1",
      is_active: false,
    });

    const res = await GET(getReq());

    expect(res.status).toBe(403);
    expect(getQueueMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/data-review/[id]/link", () => {
  it("400 when targetOpportunityId is missing", async () => {
    const res = await LINK(postReq({ connectionId: "conn-1" }), params("T"));
    expect(res.status).toBe(400);
    expect(linkThreadMock).not.toHaveBeenCalled();
  });

  it("400 when the exact mailbox connection is missing", async () => {
    const res = await LINK(
      postReq({ targetOpportunityId: "opp-1" }),
      params("T")
    );
    expect(res.status).toBe(400);
    expect(linkThreadMock).not.toHaveBeenCalled();
  });

  it("uses server actor/company plus exact mailbox and inserts a dismissible notification", async () => {
    const res = await LINK(
      postReq({
        targetOpportunityId: "opp-1",
        connectionId: "conn-1",
        actorUserId: "spoof-user",
        companyId: "spoof-company",
      }),
      params("T")
    );
    expect(res.status).toBe(200);
    expect(linkThreadMock).toHaveBeenCalledWith({
      actorUserId: "user-1",
      companyId: "co-1",
      connectionId: "conn-1",
      providerThreadId: "T",
      targetOpportunityId: "opp-1",
      kind: "split",
    });
    const payload = createTrustedNotificationsMock.mock.calls[0][0];
    expect(payload.persistent).toBe(false);
    // Purpose-named outcome type (not the borrowed duplicates_found).
    expect(payload.type).toBe("data_review_resolved");
    expect(payload.title).toContain("LINK RESOLVED");
    // Action label is UPPERCASE authority, resolved from the dictionary.
    expect(payload.actionLabel).toBe("VIEW");
    expect(payload.companyId).toBe("co-1");
    expect(payload.durableDedupe).toBe(true);
    expect(payload.dedupeKey).toBe(
      "data_review_resolution:v1:link:conn-1:T:split:opp-1" + ":r1"
    );
  });

  it("forwards the terminal_live kind through to the service", async () => {
    // For terminal_live items the URL [id] is the provider thread id; the
    // service aligns the cache row keyed on it.
    const res = await LINK(
      postReq({
        targetOpportunityId: "opp-1",
        connectionId: "conn-2",
        kind: "terminal_live",
      }),
      params("provider-thread-x")
    );
    expect(res.status).toBe(200);
    expect(linkThreadMock).toHaveBeenCalledWith({
      actorUserId: "user-1",
      companyId: "co-1",
      connectionId: "conn-2",
      providerThreadId: "provider-thread-x",
      targetOpportunityId: "opp-1",
      kind: "terminal_live",
    });
  });

  it("normalizes the exact link identity before mutation and notification dedupe", async () => {
    const res = await LINK(
      postReq({
        targetOpportunityId: " opp-1 ",
        connectionId: " conn-1 ",
        kind: "split",
      }),
      params(" T ")
    );

    expect(res.status).toBe(200);
    expect(linkThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-1",
        providerThreadId: "T",
        targetOpportunityId: "opp-1",
      })
    );
    expect(createTrustedNotificationsMock.mock.calls[0][0].dedupeKey).toBe(
      "data_review_resolution:v1:link:conn-1:T:split:opp-1" + ":r1"
    );
  });
});

describe("POST /api/data-review/[id]/quarantine", () => {
  it("400 + never quarantines without an exact mailbox connection", async () => {
    const res = await QUARANTINE(postReq({ kind: "split" }), params("T"));
    expect(res.status).toBe(400);
    expect(quarantineThreadMock).not.toHaveBeenCalled();
  });

  it("uses server authority plus exact mailbox and inserts a dismissible notification", async () => {
    const res = await QUARANTINE(
      postReq({
        connectionId: "conn-1",
        actorUserId: "spoof-user",
        companyId: "spoof-company",
      }),
      params("T")
    );
    expect(res.status).toBe(200);
    expect(quarantineThreadMock).toHaveBeenCalledWith({
      actorUserId: "user-1",
      companyId: "co-1",
      connectionId: "conn-1",
      providerThreadId: "T",
      kind: "split",
    });
    const payload = createTrustedNotificationsMock.mock.calls[0][0];
    expect(payload.persistent).toBe(false);
    expect(payload.type).toBe("data_review_resolved");
    expect(payload.title).toContain("QUARANTINED");
    expect(payload.durableDedupe).toBe(true);
    expect(payload.dedupeKey).toBe(
      "data_review_resolution:v1:quarantine:conn-1:T:split" + ":r1"
    );
  });

  it("keeps a completed quarantine successful when notification reconciliation fails", async () => {
    createTrustedNotificationsMock.mockRejectedValueOnce(
      new Error("notification insert could not be reconciled")
    );
    const res = await QUARANTINE(
      postReq({ connectionId: "conn-1", kind: "split" }),
      params("T")
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      notificationStatus: "failed",
    });
    expect(quarantineThreadMock).toHaveBeenCalledTimes(1);
  });

  it("forwards the terminal_live kind to quarantineThread", async () => {
    const res = await QUARANTINE(
      postReq({ connectionId: "conn-2", kind: "terminal_live" }),
      params("T")
    );
    expect(res.status).toBe(200);
    expect(quarantineThreadMock).toHaveBeenCalledWith({
      actorUserId: "user-1",
      companyId: "co-1",
      connectionId: "conn-2",
      providerThreadId: "T",
      kind: "terminal_live",
    });
  });

  it("normalizes the exact quarantine identity before mutation and notification dedupe", async () => {
    const res = await QUARANTINE(
      postReq({ connectionId: " conn-1 ", kind: "split" }),
      params(" T ")
    );

    expect(res.status).toBe(200);
    expect(quarantineThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-1",
        providerThreadId: "T",
      })
    );
    expect(createTrustedNotificationsMock.mock.calls[0][0].dedupeKey).toBe(
      "data_review_resolution:v1:quarantine:conn-1:T:split" + ":r1"
    );
  });
});
