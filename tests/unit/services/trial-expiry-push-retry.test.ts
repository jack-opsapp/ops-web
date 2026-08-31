import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendDiscountMock, sendWarningMock, sendReengagementMock, sendPushMock, quietHoursMock } =
  vi.hoisted(() => ({
    sendDiscountMock: vi.fn(async () => undefined),
    sendWarningMock: vi.fn(async () => undefined),
    sendReengagementMock: vi.fn(async () => undefined),
    sendPushMock: vi.fn(),
    quietHoursMock: vi.fn(),
  }));

vi.mock("@/lib/email/sendgrid", () => ({
  sendTrialExpiryWarning: sendWarningMock,
  sendTrialExpiryDiscount: sendDiscountMock,
  sendTrialExpiryReengagement: sendReengagementMock,
}));

vi.mock("@/lib/integrations/onesignal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/integrations/onesignal")>();
  return { ...actual, sendOneSignalPush: sendPushMock };
});

vi.mock("@/lib/notifications/server-notification-service", () => ({
  filterPushRecipientsByQuietHours: quietHoursMock,
}));

import { parseOneSignalInvalidAliases } from "@/lib/integrations/onesignal";
import {
  TRIAL_EXPIRY_PUSH_MAX_ATTEMPTS,
  TrialExpiryService,
  type ProcessResult,
} from "@/lib/api/services/trial-expiry-service";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_ID = "33333333-3333-3333-3333-333333333333";
const DUPLICATE_CLAIM = { code: "23505", message: "duplicate key value" };

type DatabaseError = { code?: string; message: string };

interface ExistingClaim {
  id: string;
  push_status: string;
  push_attempts: number;
}

interface FakeState {
  claimInserts: Record<string, unknown>[];
  pushStateWrites: Record<string, unknown>[];
  inAppInserts: unknown[];
  readFilters: Array<[string, unknown]>;
}

function newState(): FakeState {
  return {
    claimInserts: [],
    pushStateWrites: [],
    inAppInserts: [],
    readFilters: [],
  };
}

/**
 * discount_3d is the only type that pushes, so every scenario here uses a
 * company whose trial ends in exactly three days.
 */
function discountCompany(now: Date) {
  return {
    id: COMPANY_ID,
    name: "Push Retry Test Co",
    trial_end_date: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
    latitude: null,
    longitude: null,
    default_project_color: null,
    logo_url: null,
    admin_ids: [ADMIN_ID],
  };
}

function fakeSupabase(
  state: FakeState,
  config: {
    claimError?: DatabaseError | null;
    existingClaim?: ExistingClaim | null;
    existingReadError?: DatabaseError | null;
  } = {}
) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};

      if (table === "users") {
        builder.select = () => builder;
        builder.in = () => builder;
        builder.then = (
          resolve: (value: unknown) => unknown,
          reject?: (error: unknown) => unknown
        ) =>
          Promise.resolve({
            data: [
              {
                id: ADMIN_ID,
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
        let mode: "read" | "insert" | "update" = "read";
        builder.insert = (row: Record<string, unknown>) => {
          state.claimInserts.push(row);
          mode = "insert";
          return builder;
        };
        builder.update = (patch: Record<string, unknown>) => {
          state.pushStateWrites.push(patch);
          mode = "update";
          return builder;
        };
        builder.select = () => builder;
        builder.eq = (column: string, value: unknown) => {
          state.readFilters.push([column, value]);
          return builder;
        };
        builder.single = () =>
          mode === "insert"
            ? Promise.resolve(
                config.claimError
                  ? { data: null, error: config.claimError }
                  : { data: { id: CLAIM_ID }, error: null }
              )
            : Promise.resolve({
                data: config.existingClaim ?? null,
                error: config.existingReadError ?? null,
              });
        builder.then = (
          resolve: (value: unknown) => unknown,
          reject?: (error: unknown) => unknown
        ) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
        return builder;
      }

      if (table === "notifications") {
        builder.insert = (rows: unknown) => {
          state.inAppInserts.push(rows);
          return builder;
        };
        builder.then = (
          resolve: (value: unknown) => unknown,
          reject?: (error: unknown) => unknown
        ) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
        return builder;
      }

      throw new Error(`unexpected table ${table}`);
    },
  };
}

function emptyResult(): ProcessResult {
  return {
    scanned: 1,
    sent: [],
    skipped: [],
    errors: [],
    pushRetries: [],
    nextCompanyCursor: null,
  };
}

const INVALID_ALIAS_FAILURE = {
  ok: false as const,
  status: 200,
  error: { errors: { invalid_aliases: { external_id: [ADMIN_ID] } } },
  invalidAliases: [ADMIN_ID],
};

const NOW = new Date("2026-08-31T12:44:00.000Z");

async function runOnce(
  state: FakeState,
  config: Parameters<typeof fakeSupabase>[1] = {}
): Promise<ProcessResult> {
  const result = emptyResult();
  await TrialExpiryService.processCompany(
    fakeSupabase(state, config) as never,
    discountCompany(NOW),
    NOW,
    result
  );
  return result;
}

describe("trial expiry push-leg durable outcome", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PROMO_PREEXPIRY_50", "PROMO50");
    vi.stubEnv("STRIPE_PROMO_PREEXPIRY_30", "PROMO30");
    sendDiscountMock.mockClear();
    sendWarningMock.mockClear();
    sendReengagementMock.mockClear();
    sendPushMock.mockReset();
    quietHoursMock.mockReset();
    quietHoursMock.mockResolvedValue([ADMIN_ID]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records a retryable push failure when every alias is rejected", async () => {
    const state = newState();
    sendPushMock.mockResolvedValue(INVALID_ALIAS_FAILURE);

    const result = await runOnce(state);

    expect(state.pushStateWrites).toHaveLength(1);
    expect(state.pushStateWrites[0]).toMatchObject({
      push_status: "retry_eligible",
      push_attempts: 1,
      push_last_error: `invalid_aliases: ${ADMIN_ID}`,
    });
    expect(typeof state.pushStateWrites[0].push_last_attempt_at).toBe("string");

    // The push failure is visible to the route...
    expect(result.errors).toEqual([
      {
        companyId: COMPANY_ID,
        error: `push failed (will retry): invalid_aliases: ${ADMIN_ID}`,
      },
    ]);
    // ...while the company still counts as sent: emails and in-app landed.
    expect(result.sent).toEqual([{ companyId: COMPANY_ID, type: "discount_3d" }]);
    expect(sendDiscountMock).toHaveBeenCalledTimes(1);
    expect(state.inAppInserts).toHaveLength(1);
  });

  it("uses the claim row id as the OneSignal idempotency key", async () => {
    const state = newState();
    sendPushMock.mockResolvedValue({ ok: true, recipients: 1, onesignalId: "n1" });

    await runOnce(state);

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: CLAIM_ID })
    );
    expect(state.pushStateWrites[0]).toMatchObject({
      push_status: "sent",
      push_attempts: 1,
      push_last_error: null,
    });
  });

  it("retries only the push leg on a later run and never re-sends email", async () => {
    const state = newState();
    sendPushMock.mockResolvedValue({ ok: true, recipients: 1, onesignalId: "n2" });

    const result = await runOnce(state, {
      claimError: DUPLICATE_CLAIM,
      existingClaim: {
        id: CLAIM_ID,
        push_status: "retry_eligible",
        push_attempts: 1,
      },
    });

    expect(sendDiscountMock).not.toHaveBeenCalled();
    expect(sendWarningMock).not.toHaveBeenCalled();
    expect(sendReengagementMock).not.toHaveBeenCalled();
    expect(state.inAppInserts).toHaveLength(0);
    // The readback targets this company's claim for this exact type, and the
    // state write targets the row it read back.
    expect(state.readFilters).toEqual([
      ["company_id", COMPANY_ID],
      ["notification_type", "discount_3d"],
      ["id", CLAIM_ID],
    ]);
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(state.pushStateWrites).toEqual([
      expect.objectContaining({
        push_status: "sent",
        push_attempts: 2,
        push_last_error: null,
      }),
    ]);
    expect(result.pushRetries).toEqual([{ companyId: COMPANY_ID }]);
    expect(result.sent).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("does nothing on a duplicate claim whose push already succeeded", async () => {
    const state = newState();

    const result = await runOnce(state, {
      claimError: DUPLICATE_CLAIM,
      existingClaim: { id: CLAIM_ID, push_status: "sent", push_attempts: 1 },
    });

    expect(sendPushMock).not.toHaveBeenCalled();
    expect(quietHoursMock).not.toHaveBeenCalled();
    expect(state.pushStateWrites).toEqual([]);
    expect(result.sent).toEqual([]);
    expect(result.pushRetries).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("writes the push off as failed once the retry budget is exhausted", async () => {
    sendPushMock.mockResolvedValue(INVALID_ALIAS_FAILURE);

    // Attempt 1 — the original claim.
    const first = newState();
    await runOnce(first);
    expect(first.pushStateWrites[0]).toMatchObject({
      push_status: "retry_eligible",
      push_attempts: 1,
    });

    // Attempt 2 — a later daily run.
    const second = newState();
    await runOnce(second, {
      claimError: DUPLICATE_CLAIM,
      existingClaim: {
        id: CLAIM_ID,
        push_status: "retry_eligible",
        push_attempts: 1,
      },
    });
    expect(second.pushStateWrites[0]).toMatchObject({
      push_status: "retry_eligible",
      push_attempts: 2,
    });

    // Attempt 3 — budget reached, so the outcome is terminal and visible.
    const third = newState();
    const thirdResult = await runOnce(third, {
      claimError: DUPLICATE_CLAIM,
      existingClaim: {
        id: CLAIM_ID,
        push_status: "retry_eligible",
        push_attempts: 2,
      },
    });
    expect(third.pushStateWrites[0]).toMatchObject({
      push_status: "failed",
      push_attempts: TRIAL_EXPIRY_PUSH_MAX_ATTEMPTS,
    });
    expect(thirdResult.errors).toHaveLength(1);

    // Any later run leaves the exhausted row completely alone.
    sendPushMock.mockClear();
    const fourth = newState();
    await runOnce(fourth, {
      claimError: DUPLICATE_CLAIM,
      existingClaim: {
        id: CLAIM_ID,
        push_status: "failed",
        push_attempts: TRIAL_EXPIRY_PUSH_MAX_ATTEMPTS,
      },
    });
    expect(sendPushMock).not.toHaveBeenCalled();
    expect(fourth.pushStateWrites).toEqual([]);
  });

  it("records quiet-hours suppression as terminal, without an attempt", async () => {
    const state = newState();
    quietHoursMock.mockResolvedValue([]);

    const result = await runOnce(state);

    expect(sendPushMock).not.toHaveBeenCalled();
    expect(state.pushStateWrites).toEqual([
      {
        push_status: "skipped_quiet_hours",
        push_attempts: 0,
        push_last_error: null,
      },
    ]);
    expect(state.pushStateWrites[0]).not.toHaveProperty("push_last_attempt_at");
    expect(result.errors).toEqual([]);
    // Email and in-app still carried the message.
    expect(sendDiscountMock).toHaveBeenCalledTimes(1);
    expect(state.inAppInserts).toHaveLength(1);
  });

  it("counts a partially-delivered push as sent", async () => {
    const state = newState();
    sendPushMock.mockResolvedValue({
      ok: true,
      recipients: 1,
      onesignalId: "n3",
      invalidAliases: ["someone-else"],
    });

    const result = await runOnce(state);

    expect(state.pushStateWrites[0]).toMatchObject({
      push_status: "sent",
      push_attempts: 1,
    });
    expect(result.errors).toEqual([]);
  });

  it("treats transport failures as retry-eligible with the provider reason", async () => {
    const state = newState();
    sendPushMock.mockResolvedValue({ ok: false, error: "Timed out" });

    const result = await runOnce(state);

    expect(state.pushStateWrites[0]).toMatchObject({
      push_status: "retry_eligible",
      push_attempts: 1,
      push_last_error: "Timed out",
    });
    expect(result.errors).toEqual([
      {
        companyId: COMPANY_ID,
        error: "push failed (will retry): Timed out",
      },
    ]);
  });
});

describe("parseOneSignalInvalidAliases", () => {
  it("extracts the rejected external ids", () => {
    expect(
      parseOneSignalInvalidAliases({
        errors: { invalid_aliases: { external_id: ["a", "b"] } },
      })
    ).toEqual(["a", "b"]);
  });

  it("filters non-string ids", () => {
    expect(
      parseOneSignalInvalidAliases({
        errors: { invalid_aliases: { external_id: ["a", 7, null, "b"] } },
      })
    ).toEqual(["a", "b"]);
  });

  it("returns an empty list for every shape that is not an alias failure", () => {
    expect(parseOneSignalInvalidAliases(null)).toEqual([]);
    expect(parseOneSignalInvalidAliases(undefined)).toEqual([]);
    expect(parseOneSignalInvalidAliases("boom")).toEqual([]);
    expect(parseOneSignalInvalidAliases({})).toEqual([]);
    expect(parseOneSignalInvalidAliases({ errors: ["Invalid app_id"] })).toEqual([]);
    expect(parseOneSignalInvalidAliases({ errors: { invalid_aliases: [] } })).toEqual(
      []
    );
    expect(
      parseOneSignalInvalidAliases({ errors: { invalid_aliases: { external_id: "a" } } })
    ).toEqual([]);
  });
});
