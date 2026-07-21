import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  generateDraft: vi.fn(),
  ensureDraftHistory: vi.fn(),
  proposeAction: vi.fn(),
  renderServerString: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: mocks.generateDraft },
}));

vi.mock("@/lib/api/services/approval-draft-provenance", () => ({
  ensureApprovalDraftHistory: mocks.ensureDraftHistory,
}));

vi.mock("@/lib/api/services/approval-queue-service", () => ({
  ApprovalQueueService: { proposeAction: mocks.proposeAction },
}));

vi.mock("@/i18n/server-render", () => ({
  renderServerString: mocks.renderServerString,
}));

import { PaymentReminderService } from "@/lib/api/services/payment-reminder-service";

describe("PaymentReminderService.generateReminder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_payment_reminder_generation") {
        return {
          data: { acquired: true, claim_token: "claim-token" },
          error: null,
        };
      }
      if (name === "release_payment_reminder_generation") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    mocks.generateDraft.mockResolvedValue({
      available: true,
      draft: "Generated draft",
      draftHistoryId: "draft-1",
    });
    mocks.ensureDraftHistory.mockResolvedValue("draft-1");
    mocks.proposeAction.mockResolvedValue("action-1");
    mocks.renderServerString.mockImplementation(
      async (_locale: string, _dictionary: string, key: string) =>
        key.includes("subject") ? "Reminder subject" : "Fallback body"
    );
    vi.spyOn(
      PaymentReminderService,
      "getClientPaymentHistory"
    ).mockResolvedValue({
      clientId: "client-1",
      clientName: "Client",
      totalInvoices: 1,
      paidOnTime: 1,
      paidLate: 0,
      currentlyOverdue: 1,
      totalOutstanding: 500,
      avgDaysToPayment: 12,
      onTimeRate: 1,
      recentInvoices: [],
    });
  });

  it("claims once and snapshots Canadian invoice state into the proposal", async () => {
    await expect(
      PaymentReminderService.generateReminder(
        "company-1",
        "user-1",
        {
          invoiceId: "11111111-1111-4111-8111-111111111111",
          invoiceNumber: "1001",
          clientId: "client-1",
          clientEmail: "client@example.com",
          clientName: "Client",
          projectId: "project-1",
          projectTitle: "Project",
          balanceDue: 500,
          total: 750,
          dueDate: "2026-06-01",
          updatedAt: "2026-07-01T12:00:00Z",
          daysOverdue: 40,
          reminderLevel: 3,
          paymentTerms: "NET-30",
        },
        {
          enabled: true,
          reminder_days: [7, 14, 30, 45],
          max_reminders: 4,
          currency_code: "CAD",
          locale: "en",
          timezone: "America/Vancouver",
        },
        "company-connection-1"
      )
    ).resolves.toBe("action-1");

    expect(mocks.generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "company-connection-1",
        userInstruction: expect.stringContaining("CA$500.00"),
      })
    );
    expect(mocks.proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "11111111-1111-4111-8111-111111111111:reminder:3",
        actionData: expect.objectContaining({
          currency_code: "CAD",
          company_locale: "en",
          company_timezone: "America/Vancouver",
          payment_reminder_settings_snapshot: {},
          due_date: "2026-06-01",
          invoice_updated_at: "2026-07-01T12:00:00Z",
          connection_id: "company-connection-1",
        }),
      })
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "release_payment_reminder_generation",
      expect.objectContaining({ p_claim_token: "claim-token" })
    );
  });

  it("keeps a concurrent in-progress generation retryable", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        acquired: false,
        claim_token: null,
        reason: "generation_in_progress",
      },
      error: null,
    });

    await expect(
      PaymentReminderService.generateReminder(
        "company-1",
        "user-1",
        {
          invoiceId: "11111111-1111-4111-8111-111111111111",
          invoiceNumber: "1001",
          clientId: "client-1",
          clientEmail: "client@example.com",
          clientName: "Client",
          projectId: "project-1",
          projectTitle: "Project",
          balanceDue: 500,
          total: 750,
          dueDate: "2026-06-01",
          updatedAt: "2026-07-01T12:00:00Z",
          daysOverdue: 40,
          reminderLevel: 3,
          paymentTerms: "NET-30",
        },
        {
          enabled: true,
          reminder_days: [7, 14, 30, 45],
          max_reminders: 4,
          currency_code: "CAD",
          locale: "en",
          timezone: "America/Vancouver",
        },
        "company-connection-1"
      )
    ).rejects.toThrow("already in progress");

    expect(mocks.generateDraft).not.toHaveBeenCalled();
    expect(mocks.proposeAction).not.toHaveBeenCalled();
  });
});
