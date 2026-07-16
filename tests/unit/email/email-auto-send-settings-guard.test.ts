import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHumanDraftAccuracyMock, categoryGraduationMock } = vi.hoisted(
  () => ({
    getHumanDraftAccuracyMock: vi.fn(),
    categoryGraduationMock: vi.fn(),
  })
);

vi.mock("@/lib/api/services/phase-c-draft-accuracy-service", () => ({
  getHumanDraftAccuracy: getHumanDraftAccuracyMock,
}));

vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: { isGraduated: categoryGraduationMock },
}));

import { validateAutoSendSettingsTransition } from "@/lib/email/email-auto-send-settings-guard";

describe("auto-send settings graduation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHumanDraftAccuracyMock.mockResolvedValue({
      sampleSize: 20,
      approvalRate: 0.95,
    });
    categoryGraduationMock.mockResolvedValue({
      ready: true,
      sampleSize: 20,
      approvalRate: 0.95,
    });
  });

  it("blocks global auto-send enablement below 20 human-finalized outcomes", async () => {
    getHumanDraftAccuracyMock.mockResolvedValue({
      sampleSize: 19,
      approvalRate: 1,
    });

    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      actorUserId: "user-1",
      currentSettings: { enabled: false },
      requestedSettings: { enabled: true },
    });

    expect(result).toMatchObject({ allowed: false, reason: "not_graduated" });
    expect(getHumanDraftAccuracyMock).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "user-1",
    });
  });

  it("blocks global auto-send enablement below 95 percent unchanged approval", async () => {
    getHumanDraftAccuracyMock.mockResolvedValue({
      sampleSize: 100,
      approvalRate: 0.94,
    });

    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      actorUserId: "user-1",
      currentSettings: { enabled: false },
      requestedSettings: { enabled: true },
    });

    expect(result.allowed).toBe(false);
  });

  it("uses canonical category graduation for a new primary auto-send transition", async () => {
    categoryGraduationMock.mockResolvedValue({
      ready: false,
      sampleSize: 40,
      approvalRate: 0.9,
    });

    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      actorUserId: "user-1",
      currentSettings: {
        category_autonomy: { "primary:CUSTOMER": "auto_draft" },
      },
      requestedSettings: {
        category_autonomy: { "primary:CUSTOMER": "auto_send" },
      },
    });

    expect(result).toMatchObject({
      allowed: false,
      categoryKey: "primary:CUSTOMER",
    });
    expect(categoryGraduationMock).toHaveBeenCalledWith(
      "company-1",
      "user-1",
      "CUSTOMER"
    );
  });

  it("applies the same gate to autonomous follow-up transitions", async () => {
    categoryGraduationMock.mockResolvedValue({
      ready: false,
      sampleSize: 19,
      approvalRate: 1,
    });

    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      actorUserId: "user-1",
      currentSettings: {
        category_autonomy: { "primary:CUSTOMER": "auto_draft" },
      },
      requestedSettings: {
        category_autonomy: { "primary:CUSTOMER": "auto_follow_up" },
      },
    });

    expect(result).toMatchObject({
      allowed: false,
      categoryKey: "primary:CUSTOMER",
    });
  });

  it("does not gate disabling or an already-enabled category", async () => {
    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      actorUserId: "user-1",
      currentSettings: {
        enabled: true,
        category_autonomy: { "primary:CUSTOMER": "auto_send" },
      },
      requestedSettings: {
        enabled: false,
        category_autonomy: { "primary:CUSTOMER": "auto_send" },
      },
    });

    expect(result).toEqual({ allowed: true });
    expect(getHumanDraftAccuracyMock).not.toHaveBeenCalled();
    expect(categoryGraduationMock).not.toHaveBeenCalled();
  });
});
