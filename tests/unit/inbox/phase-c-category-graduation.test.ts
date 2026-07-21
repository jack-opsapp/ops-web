import { beforeEach, describe, expect, it, vi } from "vitest";

const { accuracyMock, requireSupabaseMock } = vi.hoisted(() => ({
  accuracyMock: vi.fn(),
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

vi.mock("@/lib/api/services/phase-c-draft-accuracy-service", () => ({
  getHumanDraftAccuracy: (...args: unknown[]) => accuracyMock(...args),
}));

import { PhaseCCategoryAutonomy } from "@/lib/api/services/phase-c-category-autonomy-service";

beforeEach(() => {
  accuracyMock.mockReset();
  requireSupabaseMock.mockReset();
});

describe("Phase C category graduation", () => {
  it("requires at least 20 strict human outcomes", async () => {
    accuracyMock.mockResolvedValue({
      sampleSize: 19,
      approvedWithoutChanges: 19,
      errors: 0,
      approvalRate: 1,
      errorRate: 0,
    });

    await expect(
      PhaseCCategoryAutonomy.isGraduated(
        "company-1",
        "connection-1",
        "actor-1",
        "CUSTOMER"
      )
    ).resolves.toEqual({ ready: false, approvalRate: 1, sampleSize: 19 });
  });

  it("graduates only at 95% or better for the exact actor and category profiles", async () => {
    accuracyMock.mockResolvedValue({
      sampleSize: 20,
      approvedWithoutChanges: 19,
      errors: 1,
      approvalRate: 0.95,
      errorRate: 0.05,
    });

    await expect(
      PhaseCCategoryAutonomy.isGraduated(
        "company-1",
        "connection-1",
        "actor-1",
        "CUSTOMER"
      )
    ).resolves.toEqual({ ready: true, approvalRate: 0.95, sampleSize: 20 });

    expect(accuracyMock).toHaveBeenCalledWith({
      companyId: "company-1",
      connectionId: "connection-1",
      userId: "actor-1",
      primaryCategory: "CUSTOMER",
    });
  });

  it("never graduates categories that have no drafting profile", async () => {
    await expect(
      PhaseCCategoryAutonomy.isGraduated(
        "company-1",
        "connection-1",
        "actor-1",
        "LEGAL"
      )
    ).resolves.toEqual({ ready: false, approvalRate: 0, sampleSize: 0 });
    expect(accuracyMock).not.toHaveBeenCalled();
  });

  it("caps another actor's shared mailbox auto-send policy until this actor accepts", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        auto_send_settings: {
          category_autonomy: {
            "primary:CUSTOMER": "auto_send",
            "primary:PLATFORM_BID": "auto_send",
          },
        },
      },
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          primary_category: "PLATFORM_BID",
          accepted_level: "auto_send",
        },
      ],
      error: null,
    });
    requireSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue(query),
      rpc,
    });

    const levels = await PhaseCCategoryAutonomy.get("connection-1", "actor-1");

    expect(levels.CUSTOMER).toBe("auto_draft");
    expect(levels.PLATFORM_BID).toBe("auto_send");
    expect(rpc).toHaveBeenCalledWith(
      "get_phase_c_actor_category_acceptances_as_system",
      {
        p_connection_id: "connection-1",
        p_actor_user_id: "actor-1",
      }
    );
  });
});
