import { beforeEach, describe, expect, it, vi } from "vitest";

const accuracyMock = vi.fn();

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

vi.mock("@/lib/api/services/phase-c-draft-accuracy-service", () => ({
  getHumanDraftAccuracy: (...args: unknown[]) => accuracyMock(...args),
}));

import { PhaseCCategoryAutonomy } from "@/lib/api/services/phase-c-category-autonomy-service";

beforeEach(() => accuracyMock.mockReset());

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
      PhaseCCategoryAutonomy.isGraduated("company-1", "actor-1", "CUSTOMER")
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
      PhaseCCategoryAutonomy.isGraduated("company-1", "actor-1", "CUSTOMER")
    ).resolves.toEqual({ ready: true, approvalRate: 0.95, sampleSize: 20 });

    expect(accuracyMock).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "actor-1",
      profileTypes: [
        "client_new_inquiry",
        "client_quoting",
        "client_active_project",
        "client_followup",
      ],
    });
  });

  it("never graduates categories that have no drafting profile", async () => {
    await expect(
      PhaseCCategoryAutonomy.isGraduated("company-1", "actor-1", "LEGAL")
    ).resolves.toEqual({ ready: false, approvalRate: 0, sampleSize: 0 });
    expect(accuracyMock).not.toHaveBeenCalled();
  });
});
