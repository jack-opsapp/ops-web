import { beforeEach, describe, expect, it, vi } from "vitest";

const actorMock = vi.fn();
const accessMock = vi.fn();
const summaryMock = vi.fn();
const serviceClient = { service: true };

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: (...args: unknown[]) => actorMock(...args),
}));
vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailInboxListAccess: (...args: unknown[]) => accessMock(...args),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceClient,
}));
vi.mock("@/lib/api/services/phase-c-week-summary-service", () => ({
  getPhaseCWeekSummary: (...args: unknown[]) => summaryMock(...args),
}));

import { GET } from "@/app/api/agent/phase-c-week-summary/route";

const request = {} as Parameters<typeof GET>[0];
const actor = { userId: "actor-1", companyId: "company-1" };
const access = {
  allowed: true as const,
  actor,
  inboxScope: "assigned" as const,
  pipelineScope: "assigned" as const,
  ownPersonalConnectionIds: [],
  assignedOpportunityIds: ["opp-1"],
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  actorMock.mockResolvedValue({ ok: true, actor });
  accessMock.mockResolvedValue(access);
  summaryMock.mockResolvedValue({
    auto: 1,
    draft: 2,
    surfaced: 3,
    autonomyMap: {},
  });
});

describe("GET /api/agent/phase-c-week-summary", () => {
  it("derives actor and scope server-side before aggregating", async () => {
    const response = await GET(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      auto: 1,
      draft: 2,
      surfaced: 3,
    });
    expect(accessMock).toHaveBeenCalledWith({
      actor,
      supabase: serviceClient,
    });
    expect(summaryMock).toHaveBeenCalledWith({
      actor,
      access,
      supabase: serviceClient,
    });
  });

  it("fails closed when the inbox/pipeline intersection is denied", async () => {
    accessMock.mockResolvedValue({ allowed: false, reason: "missing_inbox_permission" });
    const response = await GET(request);
    expect(response.status).toBe(403);
    expect(summaryMock).not.toHaveBeenCalled();
  });
});
