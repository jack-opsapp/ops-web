import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordOutcomeMock, resolveActorMock, resolveDraftAccessMock } =
  vi.hoisted(() => ({
    recordOutcomeMock: vi.fn(async () => {}),
    resolveActorMock: vi.fn(),
    resolveDraftAccessMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({ from: vi.fn() }),
}));
vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
}));
vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveActorMock,
}));
vi.mock("@/lib/email/email-draft-access", () => ({
  resolveEmailDraftAccess: resolveDraftAccessMock,
}));
vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { recordDraftOutcome: recordOutcomeMock },
}));

import { POST } from "@/app/api/integrations/email/draft-feedback/route";

const actor = { userId: "user-1", companyId: "co-1" } as const;

function makeRequest(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  resolveActorMock.mockResolvedValue({ ok: true, actor });
  resolveDraftAccessMock.mockResolvedValue({
    allowed: true,
    draft: { id: "d-1", status: "drafted" },
  });
});

afterEach(() => vi.clearAllMocks());

describe("draft-feedback current-access boundary", () => {
  it("denies stale access after reassignment before recording feedback", async () => {
    resolveDraftAccessMock.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });

    const res = await POST(
      makeRequest({ draftHistoryId: "d-1", outcome: "discarded" })
    );

    expect(res.status).toBe(404);
    expect(resolveDraftAccessMock).toHaveBeenCalledWith({
      actor,
      draftHistoryId: "d-1",
      operation: "send",
      supabase: expect.anything(),
    });
    expect(recordOutcomeMock).not.toHaveBeenCalled();
  });

  it("attributes feedback only to the canonical OPS actor", async () => {
    const res = await POST(
      makeRequest({
        draftHistoryId: "d-1",
        companyId: "spoof-company",
        userId: "spoof-user",
        outcome: "discarded",
      })
    );

    expect(res.status).toBe(200);
    expect(recordOutcomeMock).toHaveBeenCalledWith(
      "d-1",
      "co-1",
      "user-1",
      "discarded"
    );
  });

  it("rejects a browser-reported sent outcome before it can train", async () => {
    const res = await POST(
      makeRequest({
        draftHistoryId: "d-1",
        outcome: "sent",
        finalVersion: "body",
      })
    );

    expect(res.status).toBe(400);
    expect(resolveDraftAccessMock).not.toHaveBeenCalled();
    expect(recordOutcomeMock).not.toHaveBeenCalled();
  });
});
