import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  verifyTokenMock,
  actorRpcMock,
  accessTokenClientMock,
  serviceRoleClientMock,
  refreshMock,
} = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  actorRpcMock: vi.fn(),
  accessTokenClientMock: vi.fn(),
  serviceRoleClientMock: { from: vi.fn(), rpc: vi.fn() },
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: verifyTokenMock,
}));
vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: accessTokenClientMock,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceRoleClientMock,
}));
vi.mock("@/lib/api/services/lead-summary-service", () => ({
  refreshLeadSummariesForOpportunities: refreshMock,
}));

import { POST } from "@/app/api/opportunities/[id]/summary-refresh/route";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";

function request(token: string | null = "firebase-token") {
  return {
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
  } as unknown as Parameters<typeof POST>[0];
}

const context = (id = OPPORTUNITY_ID) => ({
  params: Promise.resolve({ id }),
});
beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  serviceRoleClientMock.from.mockReturnValue(query);
  verifyTokenMock.mockResolvedValue({ uid: "firebase-user" });
  accessTokenClientMock.mockReturnValue({ rpc: actorRpcMock });
  actorRpcMock.mockResolvedValue({ data: COMPANY_ID, error: null });
  refreshMock.mockResolvedValue({
    requested: 1,
    attempted: 1,
    written: 1,
    skippedFeatureDisabled: false,
    failed: [],
    deferred: [],
    remainingOpportunityIds: [],
  });
});

describe("POST /api/opportunities/[id]/summary-refresh", () => {
  it("authorizes with the actor token before running one targeted refresh", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(verifyTokenMock).toHaveBeenCalledWith("firebase-token");
    expect(accessTokenClientMock).toHaveBeenCalledWith("firebase-token");
    expect(actorRpcMock).toHaveBeenCalledWith(
      "authorize_lead_summary_refresh",
      { p_opportunity_id: OPPORTUNITY_ID }
    );
    expect(refreshMock).toHaveBeenCalledWith({
      supabase: serviceRoleClientMock,
      companyId: COMPANY_ID,
      opportunityIds: [OPPORTUNITY_ID],
    });
    expect(await response.json()).toEqual({ ok: true, refreshed: true });
  });

  it("does not trust actor or company identity from request input", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(refreshMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ companyId: COMPANY_ID })
    );
  });

  it("returns accepted without a model call when Phase C is disabled", async () => {
    refreshMock.mockResolvedValueOnce({
      requested: 1,
      attempted: 0,
      written: 0,
      skippedFeatureDisabled: true,
      failed: [],
      deferred: [],
      remainingOpportunityIds: [OPPORTUNITY_ID],
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      refreshed: false,
      reason: "feature_disabled",
    });
  });

  it("keeps authorization and generation failures state-free", async () => {
    actorRpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "sensitive" },
    });
    const forbidden = await POST(request(), context());
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(await forbidden.json())).not.toContain("sensitive");
    expect(refreshMock).not.toHaveBeenCalled();

    actorRpcMock.mockResolvedValueOnce({ data: COMPANY_ID, error: null });
    refreshMock.mockResolvedValueOnce({
      requested: 1,
      attempted: 1,
      written: 0,
      skippedFeatureDisabled: false,
      failed: [],
      deferred: [
        {
          opportunityId: OPPORTUNITY_ID,
          error: "provider",
          reason: "provider_unavailable",
        },
      ],
      remainingOpportunityIds: [OPPORTUNITY_ID],
    });
    const deferred = await POST(request(), context());
    expect(deferred.status).toBe(503);
    expect(await deferred.json()).toEqual({
      error: "Summary refresh deferred",
    });
  });

  it("rejects missing auth and malformed ids before database work", async () => {
    expect((await POST(request(null), context())).status).toBe(401);
    expect((await POST(request(), context("not-a-uuid"))).status).toBe(400);
    expect(actorRpcMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
