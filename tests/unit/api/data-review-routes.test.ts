/**
 * /api/data-review[/[id]/link|quarantine] — granular-permission gate + dispatch.
 *
 * Asserts every route requires pipeline.manage (never a role filter), calls the
 * correct LeadDataReviewService method, validates input, and that the action
 * routes insert a standard dismissible rail notification on success.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkPermMock,
  findUserMock,
  verifyAuthMock,
  getQueueMock,
  linkThreadMock,
  quarantineThreadMock,
  insertMock,
  fromMock,
} = vi.hoisted(() => ({
  checkPermMock: vi.fn(),
  findUserMock: vi.fn(),
  verifyAuthMock: vi.fn(),
  getQueueMock: vi.fn(),
  linkThreadMock: vi.fn(),
  quarantineThreadMock: vi.fn(),
  insertMock: vi.fn(),
  fromMock: vi.fn(),
}));

const serviceClient = {
  from: (...args: unknown[]) => {
    fromMock(...args);
    return { insert: insertMock };
  },
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceClient,
}));
vi.mock("@/lib/supabase/helpers", () => ({ setSupabaseOverride: vi.fn() }));
vi.mock("@/lib/firebase/admin-verify", () => ({ verifyAdminAuth: verifyAuthMock }));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({ findUserByAuth: findUserMock }));
vi.mock("@/lib/supabase/check-permission", () => ({ checkPermissionById: checkPermMock }));
vi.mock("@/lib/api/services/lead-data-review-service", () => ({
  LeadDataReviewService: {
    getQueue: getQueueMock,
    linkThread: linkThreadMock,
    quarantineThread: quarantineThreadMock,
  },
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
  findUserMock.mockResolvedValue({ id: "user-1", company_id: "co-1" });
  checkPermMock.mockResolvedValue(true);
  getQueueMock.mockResolvedValue({ split: [], terminalLive: [], quarantinedCount: 2198 });
  linkThreadMock.mockResolvedValue({
    providerThreadId: "T",
    targetOpportunityId: "opp-1",
    targetTitle: "Deck",
    activitiesRepointed: 3,
  });
  quarantineThreadMock.mockResolvedValue({
    providerThreadId: "T",
    subject: "Deck quote",
    activitiesQuarantined: 4,
  });
  insertMock.mockResolvedValue({ error: null });
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/data-review — gate + shape", () => {
  it("403 + never reads when pipeline.manage is denied", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect(checkPermMock).toHaveBeenCalledWith("user-1", "pipeline.manage");
    expect(getQueueMock).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(getQueueMock).not.toHaveBeenCalled();
  });

  it("200 returns the queue incl. the muted quarantined count", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      split: [],
      terminalLive: [],
      quarantinedCount: 2198,
    });
  });
});

describe("POST /api/data-review/[id]/link", () => {
  it("403 + never links when pipeline.manage is denied", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await LINK(postReq({ targetOpportunityId: "opp-1" }), params("T"));
    expect(res.status).toBe(403);
    expect(linkThreadMock).not.toHaveBeenCalled();
  });

  it("400 when targetOpportunityId is missing", async () => {
    const res = await LINK(postReq({}), params("T"));
    expect(res.status).toBe(400);
    expect(linkThreadMock).not.toHaveBeenCalled();
  });

  it("calls linkThread(id, target) and inserts a dismissible notification", async () => {
    const res = await LINK(postReq({ targetOpportunityId: "opp-1" }), params("T"));
    expect(res.status).toBe(200);
    expect(linkThreadMock).toHaveBeenCalledWith("T", "opp-1");
    expect(fromMock).toHaveBeenCalledWith("notifications");
    const payload = insertMock.mock.calls[0][0];
    expect(payload.persistent).toBe(false);
    expect(payload.title).toContain("LINK RESOLVED");
    expect(payload.company_id).toBe("co-1");
  });
});

describe("POST /api/data-review/[id]/quarantine", () => {
  it("403 + never quarantines when denied", async () => {
    checkPermMock.mockResolvedValue(false);
    const res = await QUARANTINE(postReq({}), params("T"));
    expect(res.status).toBe(403);
    expect(quarantineThreadMock).not.toHaveBeenCalled();
  });

  it("calls quarantineThread(id) and inserts a dismissible notification", async () => {
    const res = await QUARANTINE(postReq({}), params("T"));
    expect(res.status).toBe(200);
    expect(quarantineThreadMock).toHaveBeenCalledWith("T");
    const payload = insertMock.mock.calls[0][0];
    expect(payload.persistent).toBe(false);
    expect(payload.title).toContain("QUARANTINED");
  });
});
