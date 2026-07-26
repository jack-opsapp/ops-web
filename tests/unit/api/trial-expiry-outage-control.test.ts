import { beforeEach, describe, expect, it, vi } from "vitest";

const { deliveryOrder, sendWarningMock } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    deliveryOrder: order,
    sendWarningMock: vi.fn(async (..._args: unknown[]) => {
      order.push("email");
    }),
  };
});

vi.mock("@/lib/email/sendgrid", () => ({
  sendTrialExpiryWarning: sendWarningMock,
  sendTrialExpiryDiscount: vi.fn(async () => undefined),
  sendTrialExpiryReengagement: vi.fn(async () => undefined),
}));

vi.mock("@/lib/integrations/onesignal", () => ({
  sendOneSignalPush: vi.fn(async () => ({ ok: true })),
}));

import { TrialExpiryService } from "@/lib/api/services/trial-expiry-service";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "@/lib/api/services/cron-workload-control-service";

type DatabaseError = { code?: string; message: string };

function companyEndingInSevenDays(now: Date) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Bounded Test Co",
    trial_end_date: new Date(
      now.getTime() + 7 * 86_400_000
    ).toISOString(),
    latitude: null,
    longitude: null,
    default_project_color: null,
    logo_url: null,
    admin_ids: ["22222222-2222-2222-2222-222222222222"],
  };
}

function fakeSupabase(claimError: DatabaseError | null = null) {
  return {
    from(table: string) {
      if (table === "users") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.in = () => builder;
        builder.then = (
          resolve: (value: unknown) => unknown,
          reject?: (error: unknown) => unknown
        ) =>
          Promise.resolve({
            data: [
              {
                id: "22222222-2222-2222-2222-222222222222",
                email: "owner@example.com",
                first_name: "Owner",
                last_name: "Operator",
                deleted_at: null,
              },
            ],
            error: null,
          }).then(resolve, reject);
        return builder;
      }

      if (table === "trial_expiry_notifications") {
        const builder: Record<string, unknown> = {};
        builder.insert = () => {
          deliveryOrder.push("claim");
          return builder;
        };
        builder.then = (
          resolve: (value: unknown) => unknown,
          reject?: (error: unknown) => unknown
        ) =>
          Promise.resolve({ data: null, error: claimError }).then(
            resolve,
            reject
          );
        return builder;
      }

      throw new Error(`unexpected table ${table}`);
    },
  };
}

function emptyResult() {
  return {
    scanned: 1,
    sent: [],
    skipped: [],
    errors: [],
    nextCompanyCursor: null,
  };
}

describe("trial expiry durable pre-send claim", () => {
  beforeEach(() => {
    deliveryOrder.length = 0;
    sendWarningMock.mockClear();
  });

  it("commits the unique claim before sending any provider email", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    const result = emptyResult();

    await TrialExpiryService.processCompany(
      fakeSupabase() as never,
      companyEndingInSevenDays(now),
      now,
      result
    );

    expect(deliveryOrder).toEqual(["claim", "email"]);
    expect(result.sent).toEqual([
      {
        companyId: "11111111-1111-1111-1111-111111111111",
        type: "warning_7d",
      },
    ]);
  });

  it("does not resend when another invocation already owns the claim", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");

    await TrialExpiryService.processCompany(
      fakeSupabase({
        code: "23505",
        message: "duplicate key",
      }) as never,
      companyEndingInSevenDays(now),
      now,
      emptyResult()
    );

    expect(deliveryOrder).toEqual(["claim"]);
    expect(sendWarningMock).not.toHaveBeenCalled();
  });

  it("retains a raw 53300 claim failure for the database circuit", async () => {
    const now = new Date("2026-07-24T12:00:00.000Z");

    const error = await TrialExpiryService.processCompany(
      fakeSupabase({
        code: "53300",
        message: "remaining connection slots are reserved",
      }) as never,
      companyEndingInSevenDays(now),
      now,
      emptyResult()
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(CronDatabaseOperationError);
    expect(isDatabasePressureError(error)).toBe(true);
    expect(sendWarningMock).not.toHaveBeenCalled();
  });
});
