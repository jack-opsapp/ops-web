import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServiceRoleClientMock, resolveActorMock, sendLeadFollowUpMock } =
  vi.hoisted(() => ({
    getServiceRoleClientMock: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })),
    resolveActorMock: vi.fn(),
    sendLeadFollowUpMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: resolveActorMock,
}));

vi.mock("@/lib/api/services/lead-follow-up-send-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/services/lead-follow-up-send-service")
  >("@/lib/api/services/lead-follow-up-send-service");
  return {
    ...actual,
    sendLeadFollowUp: sendLeadFollowUpMock,
  };
});

import { POST } from "@/app/api/leads/[opportunityId]/follow-up/route";
import { LeadFollowUpError } from "@/lib/api/services/lead-follow-up-send-service";

function request(body: unknown) {
  return new Request(
    "https://ops.test/api/leads/6bac5d9d-44c5-4af5-b36c-48beb64cbbdc/follow-up",
    {
      method: "POST",
      headers: {
        authorization: "Bearer firebase-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
}

const opportunityId = "6bac5d9d-44c5-4af5-b36c-48beb64cbbdc";
const context = {
  params: Promise.resolve({ opportunityId }),
};

describe("POST /api/leads/[opportunityId]/follow-up", () => {
  beforeEach(() => {
    resolveActorMock.mockReset();
    sendLeadFollowUpMock.mockReset();
    resolveActorMock.mockResolvedValue({
      ok: true,
      actor: {
        userId: "user-1",
        companyId: "company-1",
        email: "jackson@ops.test",
      },
    });
  });

  it("requires one stable UUID and never accepts transport facts from iOS", async () => {
    const response = await POST(
      request({
        idempotencyKey: "not-a-uuid",
        to: ["wrong@example.com"],
      }) as never,
      context
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "LEAD_FOLLOW_UP_IDEMPOTENCY_KEY_INVALID",
    });
    expect(sendLeadFollowUpMock).not.toHaveBeenCalled();
  });

  it("passes only the authenticated actor, opportunity, and idempotency key", async () => {
    sendLeadFollowUpMock.mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        delivered: true,
        reconciliationPending: false,
        deliveryUnknown: false,
        intentId: "intent-1",
        comebackAt: "2026-07-26T18:00:00.000Z",
        opportunity: { id: opportunityId },
      },
    });

    const response = await POST(
      request({
        idempotencyKey: "173e2538-60ed-4b12-a30e-b8c7f0825f4d",
        companyId: "attacker-company",
        connectionId: "attacker-mailbox",
        body: "attacker body",
      }) as never,
      context
    );

    expect(response.status).toBe(200);
    expect(sendLeadFollowUpMock).toHaveBeenCalledWith({
      actor: {
        userId: "user-1",
        companyId: "company-1",
        email: "jackson@ops.test",
      },
      opportunityId,
      idempotencyKey: "173e2538-60ed-4b12-a30e-b8c7f0825f4d",
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      delivered: true,
      comebackAt: "2026-07-26T18:00:00.000Z",
    });
  });

  it("preserves provider-accepted reconciliation-pending status", async () => {
    sendLeadFollowUpMock.mockResolvedValue({
      status: 202,
      body: {
        ok: true,
        delivered: true,
        reconciliationPending: true,
        deliveryUnknown: false,
        intentId: "intent-1",
        opportunity: { id: opportunityId },
      },
    });

    const response = await POST(
      request({
        idempotencyKey: "173e2538-60ed-4b12-a30e-b8c7f0825f4d",
      }) as never,
      context
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      delivered: true,
      reconciliationPending: true,
    });
  });

  it("returns safe service failures without collapsing them to 500", async () => {
    sendLeadFollowUpMock.mockRejectedValue(
      new LeadFollowUpError("LEAD_FOLLOW_UP_RESPONSE_REQUIRED", 409)
    );

    const response = await POST(
      request({
        idempotencyKey: "173e2538-60ed-4b12-a30e-b8c7f0825f4d",
      }) as never,
      context
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "LEAD_FOLLOW_UP_RESPONSE_REQUIRED",
    });
  });

  it("rejects malformed opportunity paths before service lookup", async () => {
    const response = await POST(
      request({
        idempotencyKey: "173e2538-60ed-4b12-a30e-b8c7f0825f4d",
      }) as never,
      { params: Promise.resolve({ opportunityId: "not-a-uuid" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "LEAD_FOLLOW_UP_OPPORTUNITY_INVALID",
    });
    expect(sendLeadFollowUpMock).not.toHaveBeenCalled();
  });
});
