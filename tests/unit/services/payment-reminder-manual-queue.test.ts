import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  single: vi.fn(),
  isAIFeatureEnabled: vi.fn(),
  resolveCompanyConnection: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: mocks.single }),
      }),
    }),
  }),
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: mocks.isAIFeatureEnabled,
  },
}));

vi.mock("@/lib/email/email-connection-selection", () => ({
  resolveCompanyEmailConversationConnectionId: mocks.resolveCompanyConnection,
}));

import { PaymentReminderService } from "@/lib/api/services/payment-reminder-service";

const baseInvoice = {
  invoiceId: "invoice-1",
  invoiceNumber: "1001",
  clientId: "client-1",
  clientName: "Client",
  clientEmail: "client@example.com",
  projectId: "project-1",
  projectTitle: "Project",
  balanceDue: 500,
  total: 500,
  dueDate: "2026-06-01",
  updatedAt: "2026-07-01T00:00:00Z",
  daysOverdue: 40,
  reminderLevel: 3,
  paymentTerms: "NET-30",
};

describe("PaymentReminderService.queueProjectReminders", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.single.mockResolvedValue({
      data: {
        client_comms_settings: null,
        currency_code: "CAD",
        locale: "en",
        timezone: "America/Vancouver",
      },
      error: null,
    });
    mocks.isAIFeatureEnabled.mockResolvedValue(true);
    mocks.resolveCompanyConnection.mockResolvedValue("connection-1");
  });

  it("reports an existing pending proposal without generating another draft", async () => {
    vi.spyOn(PaymentReminderService, "detectOverdueInvoices").mockResolvedValue(
      [{ ...baseInvoice, existingActionStatus: "queued" }]
    );
    const generate = vi.spyOn(PaymentReminderService, "generateReminder");

    await expect(
      PaymentReminderService.queueProjectReminders(
        "company-1",
        "user-1",
        "project-1"
      )
    ).resolves.toEqual({
      eligibleCount: 1,
      queuedCount: 0,
      alreadyQueuedCount: 1,
      failedCount: 0,
      clientEmailBlockedCount: 0,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("honors the company AI feature gate for manual reminder generation", async () => {
    mocks.isAIFeatureEnabled.mockResolvedValue(false);
    const detect = vi.spyOn(PaymentReminderService, "detectOverdueInvoices");

    await expect(
      PaymentReminderService.queueProjectReminders(
        "company-1",
        "user-1",
        "project-1"
      )
    ).resolves.toEqual({
      eligibleCount: 0,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
      clientEmailBlockedCount: 0,
      blockedReason: "feature_disabled",
    });
    expect(detect).not.toHaveBeenCalled();
  });

  it("filters to the selected project and counts duplicate proposals truthfully", async () => {
    const detect = vi
      .spyOn(PaymentReminderService, "detectOverdueInvoices")
      .mockResolvedValue([
        baseInvoice,
        { ...baseInvoice, invoiceId: "invoice-2", invoiceNumber: "1002" },
        { ...baseInvoice, invoiceId: "other", projectId: "other-project" },
      ]);
    vi.spyOn(PaymentReminderService, "generateReminder")
      .mockResolvedValueOnce("action-1")
      .mockResolvedValueOnce(null);

    await expect(
      PaymentReminderService.queueProjectReminders(
        "company-1",
        "user-1",
        "project-1"
      )
    ).resolves.toEqual({
      eligibleCount: 2,
      queuedCount: 1,
      alreadyQueuedCount: 1,
      failedCount: 0,
      clientEmailBlockedCount: 0,
    });
    expect(detect).toHaveBeenCalledWith(
      "company-1",
      expect.any(Object),
      expect.objectContaining({
        projectId: "project-1",
        forceFirstTierForOverdue: true,
      })
    );
  });

  it("queues nothing when company reminder settings disable the workflow", async () => {
    mocks.single.mockResolvedValue({
      data: {
        client_comms_settings: {
          payment_reminder: { enabled: false },
        },
        currency_code: "CAD",
        locale: "en",
        timezone: "America/Vancouver",
      },
    });
    const detect = vi.spyOn(PaymentReminderService, "detectOverdueInvoices");

    await expect(
      PaymentReminderService.queueProjectReminders(
        "company-1",
        "user-1",
        "project-1"
      )
    ).resolves.toEqual({
      eligibleCount: 0,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
      clientEmailBlockedCount: 0,
      blockedReason: "reminders_disabled",
    });
    expect(detect).not.toHaveBeenCalled();
  });

  it("loads canonical preset, currency, locale, and timezone fields", async () => {
    mocks.single.mockResolvedValue({
      data: {
        client_comms_settings: {
          payment_reminder: {
            enabled: true,
            preset: "gentle",
            custom_days: [2, 4, 8, 16],
            max_reminders: 2.9,
          },
        },
        currency_code: "cad",
        locale: "es",
        timezone: "America/Toronto",
      },
    });

    await expect(
      PaymentReminderService.getReminderSettings("company-1", {
        throwOnError: true,
      })
    ).resolves.toEqual({
      enabled: true,
      reminder_days: [14, 30, 45, 60],
      max_reminders: 2,
      currency_code: "CAD",
      locale: "es",
      timezone: "America/Toronto",
      source_snapshot: {
        enabled: true,
        preset: "gentle",
        custom_days: [2, 4, 8, 16],
        max_reminders: 2.9,
      },
    });
  });

  it("fails closed when company reminder settings cannot be loaded", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "settings unavailable" },
    });
    const detect = vi.spyOn(PaymentReminderService, "detectOverdueInvoices");

    await expect(
      PaymentReminderService.queueProjectReminders(
        "company-1",
        "user-1",
        "project-1"
      )
    ).rejects.toThrow("Failed to load reminder settings");
    expect(detect).not.toHaveBeenCalled();
  });

  it("fails closed rather than silently changing an invalid company timezone", async () => {
    mocks.single.mockResolvedValue({
      data: {
        client_comms_settings: null,
        currency_code: "CAD",
        locale: "en",
        timezone: "Mars/Olympus",
      },
      error: null,
    });

    await expect(
      PaymentReminderService.getReminderSettings("company-1", {
        throwOnError: true,
      })
    ).rejects.toThrow("Invalid company timezone");
  });

  it("fails closed when payment reminder settings have an invalid shape", async () => {
    mocks.single.mockResolvedValue({
      data: {
        client_comms_settings: { payment_reminder: "enabled" },
        currency_code: "CAD",
        locale: "en",
        timezone: "America/Vancouver",
      },
      error: null,
    });

    await expect(
      PaymentReminderService.getReminderSettings("company-1", {
        throwOnError: true,
      })
    ).rejects.toThrow("Invalid company payment reminder settings");
  });

  it("fails closed when company currency is invalid", async () => {
    mocks.single.mockResolvedValue({
      data: {
        client_comms_settings: null,
        currency_code: "",
        locale: "en",
        timezone: "America/Vancouver",
      },
      error: null,
    });

    await expect(
      PaymentReminderService.getReminderSettings("company-1", {
        throwOnError: true,
      })
    ).rejects.toThrow("Invalid company currency");
  });

  it("fails before drafting when no shared company mailbox is connected", async () => {
    vi.spyOn(PaymentReminderService, "detectOverdueInvoices").mockResolvedValue(
      [baseInvoice]
    );
    const generate = vi.spyOn(PaymentReminderService, "generateReminder");
    mocks.resolveCompanyConnection.mockResolvedValue(null);

    await expect(
      PaymentReminderService.queueProjectReminders(
        "company-1",
        "user-1",
        "project-1"
      )
    ).resolves.toEqual({
      eligibleCount: 1,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
      clientEmailBlockedCount: 0,
      blockedReason: "mailbox_required",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps the card actionable when an overdue client has no email", async () => {
    vi.spyOn(PaymentReminderService, "detectOverdueInvoices").mockResolvedValue(
      [
        {
          ...baseInvoice,
          clientEmail: "",
          blockedReason: "client_email_required",
        },
      ]
    );
    const generate = vi.spyOn(PaymentReminderService, "generateReminder");

    await expect(
      PaymentReminderService.queueProjectReminders(
        "company-1",
        "user-1",
        "project-1"
      )
    ).resolves.toEqual({
      eligibleCount: 1,
      queuedCount: 0,
      alreadyQueuedCount: 0,
      failedCount: 0,
      clientEmailBlockedCount: 1,
      blockedReason: "client_email_required",
    });
    expect(generate).not.toHaveBeenCalled();
  });
});
