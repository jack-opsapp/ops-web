import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  dispatchConfirmed: vi.fn(),
  dispatchUnconfirmed: vi.fn(),
  confirmFullAuto: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: vi.fn(
    async (_db: unknown, operation: () => Promise<unknown>) => operation()
  ),
}));

vi.mock("@/lib/integrations/onesignal", () => ({
  sendOneSignalPush: vi.fn(),
}));

vi.mock("../client-scheduling-comms-service", () => ({
  ClientSchedulingCommsService: {
    dispatchConfirmedScheduleProof: serviceMocks.dispatchConfirmed,
    dispatchUnconfirmedScheduleProof: serviceMocks.dispatchUnconfirmed,
    confirmFullAutoScheduleFromLease: serviceMocks.confirmFullAuto,
  },
  taskMatchesScheduleChange: vi.fn(() => true),
}));

vi.mock("../cron-workload-control-service", () => ({
  CronDatabaseOperationError: class CronDatabaseOperationError extends Error {},
  isDatabasePressureError: vi.fn(() => false),
}));

vi.mock("../schedule-optimization-service", () => ({
  ScheduleOptimizationService: {},
}));

import { TaskMutationAutomationOutboxService } from "../task-mutation-automation-outbox-service";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const LEASE_TOKEN = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const CONFIRMED_AT = "2026-08-12T20:00:00.000Z";

function scheduleSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    start_date: "2026-08-20T00:00:00.000Z",
    end_date: "2026-08-20T00:00:00.000Z",
    start_time: "09:00:00",
    end_time: "10:00:00",
    all_day: false,
    duration: 1,
    team_member_ids: [],
    schedule_confirmed_at: null,
    schedule_confirmed_by: null,
    confirmed_schedule_version: null,
    ...overrides,
  };
}

function purposeClaim(
  kind: "schedule_confirmation_dispatch" | "schedule_unconfirmation_dispatch",
  overrides: Record<string, unknown> = {}
) {
  const proof = scheduleSnapshot({
    schedule_confirmed_at: CONFIRMED_AT,
    schedule_confirmed_by:
      kind === "schedule_confirmation_dispatch" ? ACTOR_ID : null,
    confirmed_schedule_version:
      kind === "schedule_confirmation_dispatch" ? 0 : null,
    confirmation_origin:
      kind === "schedule_confirmation_dispatch" ? "manual" : null,
    schedule_unconfirmation_origin:
      kind === "schedule_unconfirmation_dispatch" ? "schedule_edit" : null,
  });
  return {
    event_id: EVENT_ID,
    lease_token: LEASE_TOKEN,
    kind,
    company_id: COMPANY_ID,
    task_id: TASK_ID,
    actor_user_id: ACTOR_ID,
    before_snapshot: kind === "schedule_unconfirmation_dispatch" ? proof : {},
    after_snapshot:
      kind === "schedule_confirmation_dispatch"
        ? proof
        : scheduleSnapshot({
            schedule_unconfirmation_origin: "schedule_edit",
          }),
    task_schedule_version: 0,
    task_updated_at: "2026-08-12T20:00:00.000Z",
    attempt: 1,
    ...overrides,
  };
}

function liveTask(
  claim: ReturnType<typeof purposeClaim>,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: TASK_ID,
    company_id: COMPANY_ID,
    project_id: "66666666-6666-4666-8666-666666666666",
    status: "active",
    schedule_version: claim.task_schedule_version,
    updated_at: claim.task_updated_at,
    ...claim.after_snapshot,
    ...overrides,
  };
}

function fakeDb(
  claim: Record<string, unknown>,
  task: Record<string, unknown>,
  failureDisposition: "pending" | "failed" = "pending"
) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "finalize_exhausted_task_schedule_automation_events") {
      return { data: 0, error: null };
    }
    if (name === "claim_task_schedule_automation_events") {
      return { data: [claim], error: null };
    }
    if (name === "complete_task_schedule_automation_event") {
      return { data: true, error: null };
    }
    if (name === "authorize_task_action_as_system") {
      return { data: true, error: null };
    }
    if (name === "fail_task_schedule_automation_event") {
      return { data: failureDisposition, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const maybeSingle = vi.fn(async () => ({ data: task, error: null }));
  const chain: Record<string, unknown> = { maybeSingle };
  for (const name of ["select", "eq", "is"]) {
    chain[name] = vi.fn(() => chain);
  }
  const from = vi.fn(() => chain);
  return { db: { rpc, from } as never, calls, rpc, maybeSingle };
}

describe("purpose schedule outbox state machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes a version-zero confirmation through the exact proof bridge", async () => {
    const claim = purposeClaim("schedule_confirmation_dispatch");
    const fixture = fakeDb(claim, liveTask(claim));
    serviceMocks.dispatchConfirmed.mockResolvedValue({
      actionTaken: "draft_on_confirm",
      actionId: "77777777-7777-4777-8777-777777777777",
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fixture.db,
      { limit: 1, workerId: "purpose-test" }
    );

    expect(result).toMatchObject({ claimed: 1, completed: 1, requeued: 0 });
    expect(serviceMocks.dispatchConfirmed).toHaveBeenCalledWith(
      COMPANY_ID,
      ACTOR_ID,
      TASK_ID,
      expect.objectContaining({
        scheduleVersion: 0,
        confirmedAt: CONFIRMED_AT,
        confirmedBy: ACTOR_ID,
        confirmationOrigin: "manual",
      }),
      expect.any(Object),
      "manual",
      expect.objectContaining({
        eventId: EVENT_ID,
        leaseToken: LEASE_TOKEN,
        taskId: TASK_ID,
        scheduleVersion: 0,
      })
    );
    expect(fixture.calls).toContainEqual(
      expect.objectContaining({
        name: "complete_task_schedule_automation_event",
        args: expect.objectContaining({ p_disposition: "processed" }),
      })
    );
  });

  it("processes a version-zero unconfirmation with a company/actor-bound nominal guard", async () => {
    const claim = purposeClaim("schedule_unconfirmation_dispatch");
    const fixture = fakeDb(claim, liveTask(claim));
    serviceMocks.dispatchUnconfirmed.mockResolvedValue({
      actionTaken: "notify",
      actionId: null,
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fixture.db,
      { limit: 1, workerId: "purpose-test" }
    );

    expect(result.completed).toBe(1);
    expect(serviceMocks.dispatchUnconfirmed).toHaveBeenCalledWith(
      COMPANY_ID,
      ACTOR_ID,
      TASK_ID,
      0,
      CONFIRMED_AT,
      expect.objectContaining({
        companyId: COMPANY_ID,
        actorUserId: ACTOR_ID,
        scheduleVersion: 0,
        previousConfirmedAt: CONFIRMED_AT,
        unconfirmationOrigin: "schedule_edit",
      })
    );
  });

  it("terminalizes an unconfirmation proof whose immutable origin is missing", async () => {
    const claim = purposeClaim("schedule_unconfirmation_dispatch");
    delete (claim.after_snapshot as Record<string, unknown>)
      .schedule_unconfirmation_origin;
    const fixture = fakeDb(claim, liveTask(claim));

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fixture.db,
      { limit: 1, workerId: "purpose-test" }
    );

    expect(result).toMatchObject({ claimed: 1, superseded: 1, requeued: 0 });
    expect(serviceMocks.dispatchUnconfirmed).not.toHaveBeenCalled();
  });

  it("terminally supersedes a confirmation whose proof changed before claim", async () => {
    const claim = purposeClaim("schedule_confirmation_dispatch");
    const fixture = fakeDb(
      claim,
      liveTask(claim, { schedule_confirmed_at: null })
    );

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fixture.db,
      { limit: 1, workerId: "purpose-test" }
    );

    expect(result.superseded).toBe(1);
    expect(serviceMocks.dispatchConfirmed).not.toHaveBeenCalled();
    expect(fixture.calls).toContainEqual(
      expect.objectContaining({
        name: "complete_task_schedule_automation_event",
        args: expect.objectContaining({ p_disposition: "superseded" }),
      })
    );
  });

  it("terminally supersedes an unconfirmation that was concurrently reconfirmed", async () => {
    const claim = purposeClaim("schedule_unconfirmation_dispatch");
    const fixture = fakeDb(
      claim,
      liveTask(claim, {
        schedule_confirmed_at: "2026-08-12T21:00:00.000Z",
        schedule_confirmed_by: ACTOR_ID,
        confirmed_schedule_version: 0,
      })
    );

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fixture.db,
      { limit: 1, workerId: "purpose-test" }
    );

    expect(result.superseded).toBe(1);
    expect(serviceMocks.dispatchUnconfirmed).not.toHaveBeenCalled();
  });

  it("requeues a transient purpose-dispatch failure under the same lease proof", async () => {
    const claim = purposeClaim("schedule_confirmation_dispatch");
    const fixture = fakeDb(claim, liveTask(claim), "pending");
    serviceMocks.dispatchConfirmed.mockRejectedValue(
      new Error("temporary provider preparation failure")
    );

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fixture.db,
      { limit: 1, workerId: "purpose-test" }
    );

    expect(result.requeued).toBe(1);
    expect(fixture.calls).toContainEqual(
      expect.objectContaining({
        name: "fail_task_schedule_automation_event",
        args: expect.objectContaining({ p_retryable: true }),
      })
    );
  });

  it("terminally skips a legacy full-auto event when current policy is not full-auto", async () => {
    const claim = {
      ...purposeClaim("schedule_confirmation_dispatch"),
      kind: "full_auto_confirmation",
      task_schedule_version: 1,
      before_snapshot: scheduleSnapshot(),
      after_snapshot: scheduleSnapshot(),
    };
    const fixture = fakeDb(claim, liveTask(claim as never));
    serviceMocks.confirmFullAuto.mockResolvedValue({
      disposition: "no_action",
      reason: "not_full_auto",
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fixture.db,
      { limit: 1, workerId: "purpose-test" }
    );

    expect(result).toMatchObject({ claimed: 1, skipped: 1, requeued: 0 });
    expect(serviceMocks.confirmFullAuto).toHaveBeenCalledWith(
      EVENT_ID,
      LEASE_TOKEN,
      TASK_ID,
      1
    );
    expect(fixture.calls).toContainEqual(
      expect.objectContaining({
        name: "complete_task_schedule_automation_event",
        args: expect.objectContaining({ p_disposition: "no_action" }),
      })
    );
  });

  it("terminalizes a malformed leased purpose row instead of churning the queue", async () => {
    const malformed = {
      ...purposeClaim("schedule_confirmation_dispatch"),
      kind: "unknown_purpose_kind",
    };
    const fixture = fakeDb(malformed, {});

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fixture.db,
      { limit: 1, workerId: "purpose-test" }
    );

    expect(result).toMatchObject({ claimed: 1, failed: 1, requeued: 0 });
    expect(fixture.calls).toContainEqual(
      expect.objectContaining({
        name: "fail_task_schedule_automation_event",
        args: expect.objectContaining({
          p_event_id: EVENT_ID,
          p_lease_token: LEASE_TOKEN,
          p_retryable: false,
        }),
      })
    );
  });
});
