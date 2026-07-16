import { beforeEach, describe, expect, it, vi } from "vitest";

const getDeckStateMock = vi.fn();
const resolveAccessMock = vi.fn();
const serviceClient = { service: true };

vi.mock("@/app/api/agent/_lib/auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    authenticateRequest: vi.fn().mockResolvedValue({
      id: "actor-1",
      companyId: "company-1",
      role: "operator",
    }),
    isErrorResponse: (value: unknown) => value instanceof NextResponse,
  };
});

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailInboxListAccess: (...args: unknown[]) =>
    resolveAccessMock(...args),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceClient,
}));

vi.mock("@/lib/api/services/calibration-service", () => ({
  CalibrationService: {
    getDeckState: (...args: unknown[]) => getDeckStateMock(...args),
  },
}));

import { GET } from "@/app/api/calibration/deck/route";

beforeEach(() => {
  getDeckStateMock.mockReset().mockResolvedValue({ milestones: {} });
  resolveAccessMock.mockReset().mockResolvedValue({
    allowed: true,
    actor: { userId: "actor-1", companyId: "company-1" },
    inboxScope: "assigned",
    pipelineScope: "assigned",
    ownPersonalConnectionIds: [],
    assignedOpportunityIds: ["opportunity-1"],
  });
});

describe("calibration deck actor scope", () => {
  it("passes the authenticated OPS actor UUID into milestone-backed deck reads", async () => {
    const response = await GET(
      new Request("https://ops.test/api/calibration/deck") as never
    );

    expect(response.status).toBe(200);
    expect(resolveAccessMock).toHaveBeenCalledWith({
      actor: { userId: "actor-1", companyId: "company-1" },
      supabase: serviceClient,
    });
    expect(getDeckStateMock).toHaveBeenCalledWith(
      "company-1",
      "actor-1",
      expect.objectContaining({
        inboxScope: "assigned",
        assignedOpportunityIds: ["opportunity-1"],
      })
    );
  });

  it("fails closed when the actor lacks the inbox/pipeline intersection", async () => {
    resolveAccessMock.mockResolvedValue({
      allowed: false,
      reason: "missing_inbox_permission",
    });

    const response = await GET(
      new Request("https://ops.test/api/calibration/deck") as never
    );

    expect(response.status).toBe(403);
    expect(getDeckStateMock).not.toHaveBeenCalled();
  });
});
