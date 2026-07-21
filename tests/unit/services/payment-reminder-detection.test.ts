import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ from: mocks.from }),
}));

import {
  PaymentReminderService,
  type PaymentReminderSettings,
} from "@/lib/api/services/payment-reminder-service";

let invoiceDueDate = "2020-01-01";
let existingActions: Array<{ source_id: string; status: string }> = [];

function query(result: { data: unknown; error?: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "gt",
    "lt",
    "is",
    "or",
    "order",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const settings: PaymentReminderSettings = {
  enabled: true,
  reminder_days: [1, 2, 3, 4],
  max_reminders: 4,
  currency_code: "CAD",
  locale: "en",
  timezone: "America/Vancouver",
};

describe("PaymentReminderService.detectOverdueInvoices", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    invoiceDueDate = "2020-01-01";
    existingActions = [
      {
        source_id: "invoice-1:reminder:4",
        status: "pending",
      },
    ];
    mocks.from.mockImplementation((table: string) => {
      switch (table) {
        case "invoices":
          return query({
            data: [
              {
                id: "invoice-1",
                invoice_number: "1001",
                client_id: "client-1",
                project_id: "project-1",
                project_ref: null,
                balance_due: 500,
                total: 500,
                due_date: invoiceDueDate,
                status: "past_due",
                payment_terms: "NET-30",
                updated_at: "2026-07-01T00:00:00Z",
              },
            ],
            error: null,
          });
        case "clients":
          return query({
            data: [
              {
                id: "client-1",
                name: "Client",
                email: "client@example.com",
              },
            ],
          });
        case "projects":
          return query({
            data: [{ id: "project-1", title: "Project" }],
          });
        case "agent_actions":
          return query({
            data: existingActions,
          });
        default:
          throw new Error(`Unexpected table: ${table}`);
      }
    });
  });

  it("keeps queued tiers hidden from the scheduler but visible to manual review", async () => {
    await expect(
      PaymentReminderService.detectOverdueInvoices("company-1", settings)
    ).resolves.toEqual([]);

    const manual = await PaymentReminderService.detectOverdueInvoices(
      "company-1",
      settings,
      { includeAlreadyQueued: true }
    );

    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({
      invoiceId: "invoice-1",
      projectId: "project-1",
      existingActionStatus: "queued",
    });
  });

  it("lets a deliberate review swipe queue tier one as soon as debt is overdue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T18:00:00.000Z"));
    invoiceDueDate = "2026-07-19";
    existingActions = [];

    const standardSettings: PaymentReminderSettings = {
      ...settings,
      reminder_days: [7, 14, 30, 45],
    };

    await expect(
      PaymentReminderService.detectOverdueInvoices(
        "company-1",
        standardSettings
      )
    ).resolves.toEqual([]);

    const manual = await PaymentReminderService.detectOverdueInvoices(
      "company-1",
      standardSettings,
      { forceFirstTierForOverdue: true }
    );

    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({
      invoiceId: "invoice-1",
      daysOverdue: 1,
      reminderLevel: 1,
    });
  });
});
