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

  it("rejects mailbox-wide enablement without an exact category acceptance", async () => {
    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      connectionId: "connection-1",
      actorUserId: "user-1",
      currentSettings: { enabled: false },
      requestedSettings: { enabled: true },
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: "category_required",
    });
    expect(getHumanDraftAccuracyMock).not.toHaveBeenCalled();
    expect(categoryGraduationMock).not.toHaveBeenCalled();
  });

  it("never substitutes mailbox-wide accuracy for exact category proof", async () => {
    getHumanDraftAccuracyMock.mockResolvedValue({
      sampleSize: 100,
      approvalRate: 1,
    });

    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      connectionId: "connection-1",
      actorUserId: "user-1",
      currentSettings: { enabled: false },
      requestedSettings: { enabled: true },
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: "category_required",
    });
    expect(getHumanDraftAccuracyMock).not.toHaveBeenCalled();
    expect(categoryGraduationMock).not.toHaveBeenCalled();
  });

  it("uses canonical category graduation for a new primary auto-send transition", async () => {
    categoryGraduationMock.mockResolvedValue({
      ready: false,
      sampleSize: 40,
      approvalRate: 0.9,
    });

    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      connectionId: "connection-1",
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
      "connection-1",
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
      connectionId: "connection-1",
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

  it.each(["auto_send", "auto_follow_up"] as const)(
    "rejects legacy relationship-key %s transitions instead of using mailbox-wide proof",
    async (level) => {
      const result = await validateAutoSendSettingsTransition({
        companyId: "company-1",
        connectionId: "connection-1",
        actorUserId: "user-1",
        currentSettings: {
          category_autonomy: { client_new_inquiry: "auto_draft" },
        },
        requestedSettings: {
          category_autonomy: { client_new_inquiry: level },
        },
      });

      expect(result).toMatchObject({
        allowed: false,
        reason: "invalid_category",
        categoryKey: "client_new_inquiry",
      });
      expect(getHumanDraftAccuracyMock).not.toHaveBeenCalled();
      expect(categoryGraduationMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["primary:LEGAL", "auto_send"],
    ["primary:VENDOR", "auto_follow_up"],
    ["primary:CUSTOMER", "auto_archive"],
    ["primary:NOT_REAL", "auto_draft"],
  ] as const)(
    "rejects a primary-category policy violation for %s=%s",
    async (categoryKey, level) => {
      const result = await validateAutoSendSettingsTransition({
        companyId: "company-1",
        connectionId: "connection-1",
        actorUserId: "user-1",
        currentSettings: {},
        requestedSettings: {
          category_autonomy: { [categoryKey]: level },
        },
      });

      expect(result).toMatchObject({
        allowed: false,
        reason: "invalid_category",
        categoryKey,
      });
      expect(categoryGraduationMock).not.toHaveBeenCalled();
    }
  );

  it("always allows an explicit transport disable", async () => {
    const result = await validateAutoSendSettingsTransition({
      companyId: "company-1",
      connectionId: "connection-1",
      actorUserId: "user-1",
      currentSettings: {
        enabled: true,
        category_autonomy: { "primary:CUSTOMER": "auto_send" },
      },
      requestedSettings: {
        enabled: false,
      },
    });

    expect(result).toEqual({ allowed: true });
    expect(getHumanDraftAccuracyMock).not.toHaveBeenCalled();
    expect(categoryGraduationMock).not.toHaveBeenCalled();
  });
});
