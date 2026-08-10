import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { ApprovedActionEmailIntentService } from "@/lib/api/services/approved-action-email-intent-service";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
} from "@/lib/api/services/cron-workload-control-service";

function outer503Response() {
  return {
    data: [{ private_row: "must-not-enter-the-error-chain" }],
    error: {
      code: "",
      details: "",
      hint: "",
      message: "Service Unavailable",
    },
    count: null,
    status: 503,
    statusText: "Service Unavailable",
  };
}

function expectOuterResponsePressure(
  failure: unknown,
  response: ReturnType<typeof outer503Response>
): void {
  expect(failure).toBeInstanceOf(CronDatabaseOperationError);
  expect(failure).toMatchObject({
    cause: {
      error: response.error,
      status: 503,
      statusText: "Service Unavailable",
    },
  });
  expect((failure as Error & { cause: object }).cause).not.toHaveProperty(
    "data"
  );
  expect(isDatabasePressureError(failure)).toBe(true);
}

describe("approved-action email intent database pressure", () => {
  it.each([
    {
      boundary: "required reconciliation renewal",
      run: (service: ApprovedActionEmailIntentService) =>
        service.renewReconciliation({
          intentId: "intent-1",
          leaseToken: "lease-1",
          leaseSeconds: 180,
        }),
    },
    {
      boundary: "optional reconciliation claim",
      run: (service: ApprovedActionEmailIntentService) =>
        service.claimNextReconciliation({
          failedBefore: "2026-08-09T18:09:00.000Z",
          leaseSeconds: 180,
        }),
    },
    {
      boundary: "expired reconciliation finalization",
      run: (service: ApprovedActionEmailIntentService) =>
        service.finalizeExpiredReconciliations({ limit: 25 }),
    },
    {
      boundary: "alert projection",
      run: (service: ApprovedActionEmailIntentService) =>
        service.projectNextAlert(),
    },
    {
      boundary: "stale delivery quarantine",
      run: (service: ApprovedActionEmailIntentService) =>
        service.quarantineStaleDeliveries(),
    },
  ])("preserves the outer 503 envelope for $boundary", async ({ run }) => {
    const response = outer503Response();
    const service = new ApprovedActionEmailIntentService({
      rpc: vi.fn().mockResolvedValue(response),
    } as unknown as SupabaseClient);

    const failure = await run(service).catch((error: unknown) => error);

    expectOuterResponsePressure(failure, response);
  });

  it("preserves the outer 503 envelope for intent lookup", async () => {
    const response = outer503Response();
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(response),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const service = new ApprovedActionEmailIntentService({
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient);

    const failure = await service
      .getByActionId("action-1")
      .catch((error: unknown) => error);

    expectOuterResponsePressure(failure, response);
  });
});
