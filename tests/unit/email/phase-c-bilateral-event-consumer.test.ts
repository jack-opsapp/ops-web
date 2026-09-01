import { describe, expect, it, vi } from "vitest";

import {
  PhaseCBilateralEventConsumerService,
  type ClaimedPhaseCBilateralEventHandoff,
  type PhaseCBilateralEventConsumerDependencies,
  type PhaseCBilateralEventOutcome,
} from "@/lib/email/phase-c-bilateral-event-consumer";

const HANDOFF_ID = "11111111-1111-4111-8111-111111111111";
const VISIT_ID = "22222222-2222-4222-8222-222222222222";

function claimed(
  overrides: Partial<ClaimedPhaseCBilateralEventHandoff> = {}
): ClaimedPhaseCBilateralEventHandoff {
  return {
    id: HANDOFF_ID,
    companyId: "33333333-3333-4333-8333-333333333333",
    opportunityId: "44444444-4444-4444-8444-444444444444",
    requestedOwnerUserId: "55555555-5555-4555-8555-555555555555",
    status: "ready",
    canonicalEventKind: null,
    canonicalEventId: null,
    attemptCount: 1,
    ...overrides,
  };
}

function booked(): PhaseCBilateralEventOutcome {
  return {
    handoffId: HANDOFF_ID,
    companyId: "33333333-3333-4333-8333-333333333333",
    opportunityId: "44444444-4444-4444-8444-444444444444",
    requestedOwnerUserId: "55555555-5555-4555-8555-555555555555",
    status: "consumed",
    reviewReason: null,
    canonicalEventKind: "site_visit",
    canonicalEventId: VISIT_ID,
  };
}

function dependencies(
  rows: ClaimedPhaseCBilateralEventHandoff[] = [claimed()]
): PhaseCBilateralEventConsumerDependencies & {
  claim: ReturnType<typeof vi.fn>;
  consume: ReturnType<typeof vi.fn>;
  readback: ReturnType<typeof vi.fn>;
  dispatchNotification: ReturnType<typeof vi.fn>;
  acknowledge: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} {
  return {
    workerId: () => "worker-1",
    claim: vi.fn(async () => rows),
    consume: vi.fn(async () => booked()),
    readback: vi.fn(async () => booked()),
    dispatchNotification: vi.fn(async () => ({ notified: 1, pushed: 1 })),
    acknowledge: vi.fn(async () => "acknowledged" as const),
    fail: vi.fn(async () => "retrying" as const),
  };
}

describe("Phase C bilateral-event consumer", () => {
  it("creates, reads back, notifies, and acknowledges one confirmed appointment", async () => {
    const deps = dependencies();
    const result = await new PhaseCBilateralEventConsumerService(
      deps
    ).runWorker({
      limit: 2,
      leaseSeconds: 120,
    });

    expect(deps.consume).toHaveBeenCalledWith({
      handoffId: HANDOFF_ID,
      workerId: "worker-1",
    });
    expect(deps.readback).toHaveBeenCalledWith({
      handoffId: HANDOFF_ID,
      canonicalEventId: VISIT_ID,
    });
    expect(deps.dispatchNotification).toHaveBeenCalledWith(booked());
    expect(deps.acknowledge).toHaveBeenCalledWith({
      handoffId: HANDOFF_ID,
      workerId: "worker-1",
    });
    expect(result).toEqual({
      claimed: 1,
      booked: 1,
      reviewed: 0,
      cancelled: 0,
      notified: 1,
      pushed: 1,
      retrying: 0,
      failed: 0,
      errors: [],
    });
  });

  it("retries notification after an already-consumed handoff without creating again", async () => {
    const deps = dependencies([
      claimed({
        status: "consumed",
        canonicalEventKind: "site_visit",
        canonicalEventId: VISIT_ID,
      }),
    ]);

    await new PhaseCBilateralEventConsumerService(deps).runWorker({ limit: 1 });

    expect(deps.consume).not.toHaveBeenCalled();
    expect(deps.readback).toHaveBeenCalledWith({
      handoffId: HANDOFF_ID,
      canonicalEventId: VISIT_ID,
    });
    expect(deps.dispatchNotification).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledTimes(1);
  });

  it("surfaces an atomic permission or conflict review without a canonical appointment", async () => {
    const review: PhaseCBilateralEventOutcome = {
      ...booked(),
      status: "review",
      reviewReason: "calendar_create_permission_missing",
      canonicalEventKind: null,
      canonicalEventId: null,
    };
    const deps = dependencies();
    deps.consume.mockResolvedValue(review);
    deps.readback.mockResolvedValue(review);

    const result = await new PhaseCBilateralEventConsumerService(
      deps
    ).runWorker({
      limit: 1,
    });

    expect(deps.readback).toHaveBeenCalledWith({
      handoffId: HANDOFF_ID,
      canonicalEventId: null,
    });
    expect(deps.dispatchNotification).toHaveBeenCalledWith(review);
    expect(result.booked).toBe(0);
    expect(result.reviewed).toBe(1);
  });

  it("retains a consumed appointment for notification retry when delivery fails", async () => {
    const deps = dependencies();
    deps.dispatchNotification.mockRejectedValue(
      new Error("notification provider unavailable")
    );

    const result = await new PhaseCBilateralEventConsumerService(
      deps
    ).runWorker({
      limit: 1,
    });

    expect(deps.acknowledge).not.toHaveBeenCalled();
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffId: HANDOFF_ID,
        workerId: "worker-1",
        errorCode: "notification_failed",
      })
    );
    expect(result.booked).toBe(1);
    expect(result.retrying).toBe(1);
  });

  it("never consumes a cancelled handoff returned by the lease boundary", async () => {
    const deps = dependencies([claimed({ status: "cancelled" })]);

    const result = await new PhaseCBilateralEventConsumerService(
      deps
    ).runWorker({
      limit: 1,
    });

    expect(deps.consume).not.toHaveBeenCalled();
    expect(deps.readback).not.toHaveBeenCalled();
    expect(deps.dispatchNotification).not.toHaveBeenCalled();
    expect(deps.acknowledge).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(1);
  });
});
