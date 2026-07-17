import { beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({
  fullAuto: vi.fn(),
  rescheduled: vi.fn(),
  cascade: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/api/services/client-scheduling-comms-service", () => ({
  ClientSchedulingCommsService: {
    onTaskCreatedMaybeFullAuto: effects.fullAuto,
    onConfirmedTaskRescheduled: effects.rescheduled,
  },
  taskMatchesScheduleChange: (
    task: Record<string, unknown>,
    change: { after: Record<string, unknown>; scheduleVersion: number | null }
  ) =>
    (change.scheduleVersion === null ||
      task.schedule_version === change.scheduleVersion) &&
    task.start_date === change.after.startDate &&
    task.start_time === change.after.startTime,
}));
vi.mock("@/lib/api/services/schedule-optimization-service", () => ({
  ScheduleOptimizationService: {
    handleRescheduleCascade: effects.cascade,
  },
}));
vi.mock("@/lib/integrations/onesignal", () => ({
  sendOneSignalPush: effects.push,
}));

import { TaskMutationAutomationOutboxService } from "@/lib/api/services/task-mutation-automation-outbox-service";

const before = {
  start_date: "2026-07-21T16:00:00.000Z",
  end_date: null,
  start_time: "08:00:00",
  end_time: "16:00:00",
  all_day: false,
  duration: 1,
  team_member_ids: ["actor-1"],
  project_id: "project-1",
  status: "active",
  schedule_confirmed_at: "2026-07-20T10:00:00.000Z",
};
const after = {
  ...before,
  start_date: "2026-07-22T16:00:00.000Z",
  start_time: "09:00:00",
};
const claim = {
  event_id: "event-1",
  lease_token: "lease-1",
  kind: "confirmed_reschedule",
  company_id: "company-1",
  task_id: "task-1",
  actor_user_id: "actor-1",
  before_snapshot: before,
  after_snapshot: after,
  task_schedule_version: 7,
  task_updated_at: "2026-07-20T11:05:00.000Z",
  attempt: 1,
};

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

function database(options: {
  claims?: unknown[];
  claimBatches?: unknown[][];
  task?: Record<string, unknown> | null;
  actor?: Record<string, unknown> | null;
  permission?: boolean;
  permissions?: boolean[];
  terminalFailed?: number;
  notificationProof?: Record<string, unknown>;
}) {
  const permissions = [...(options.permissions ?? [])];
  const claimBatches = [
    ...(options.claimBatches ?? [options.claims ?? [claim]]),
  ];
  const leaseOrder: string[] = [];
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "finalize_exhausted_task_schedule_automation_events") {
      return { data: options.terminalFailed ?? 0, error: null };
    }
    if (name === "claim_task_schedule_automation_events") {
      const batch = claimBatches.shift() ?? [];
      const event = batch[0] as Record<string, unknown> | undefined;
      leaseOrder.push(`claim:${String(event?.event_id ?? "empty")}`);
      return { data: batch, error: null };
    }
    if (name === "authorize_task_action_as_system") {
      return {
        data:
          permissions.length > 0
            ? permissions.shift()
            : (options.permission ?? true),
        error: null,
      };
    }
    if (name === "persist_task_mutation_notification_as_system") {
      return {
        data: options.notificationProof ?? {
          disposition: "processed",
          type: "task_assigned",
          title: "New Task Assignment",
          body: "A team member assigned you Site visit on Canpro shop.",
          push_title: "New Task Assignment",
          push_body: "A team member assigned you Site visit on Canpro shop.",
          project_id: "project-1",
          action_url: "/dashboard?openProject=project-1&mode=view",
          action_label: "View Task",
          push_recipient_ids: ["recipient-1"],
        },
        error: null,
      };
    }
    if (name === "complete_task_schedule_automation_event") {
      leaseOrder.push(`complete:${String(args?.p_event_id)}`);
      return { data: true, error: null };
    }
    if (name === "fail_task_schedule_automation_event") {
      return { data: "pending", error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const from = vi.fn((table: string) => {
    if (table === "project_tasks") {
      return query({
        data:
          options.task === undefined
            ? {
                id: "task-1",
                company_id: "company-1",
                project_id: "project-1",
                status: "active",
                start_date: after.start_date,
                end_date: after.end_date,
                start_time: after.start_time,
                end_time: after.end_time,
                all_day: after.all_day,
                duration: after.duration,
                team_member_ids: after.team_member_ids,
                schedule_version: claim.task_schedule_version,
                updated_at: claim.task_updated_at,
                schedule_confirmed_at: after.schedule_confirmed_at,
              }
            : options.task,
        error: null,
      });
    }
    if (table === "users") {
      return query({
        data:
          options.actor === undefined
            ? { id: "actor-1", company_id: "company-1", is_active: true }
            : options.actor,
        error: null,
      });
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return { client: { rpc, from }, rpc, leaseOrder };
}

beforeEach(() => {
  vi.clearAllMocks();
  effects.fullAuto.mockResolvedValue({
    actionTaken: "full_auto",
    actionId: "action-1",
  });
  effects.rescheduled.mockResolvedValue({
    actionTaken: "draft",
    actionId: "action-1",
  });
  effects.cascade.mockResolvedValue({ cascadeProposed: 1 });
  effects.push.mockResolvedValue({ ok: true, recipients: 1 });
});

describe("TaskMutationAutomationOutboxService", () => {
  it("runs an exact live reschedule once and completes its fenced lease", async () => {
    const fake = database({});

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never,
      { workerId: "worker-1" }
    );

    expect(effects.rescheduled).toHaveBeenCalledWith(
      "company-1",
      "actor-1",
      "task-1",
      {
        before: {
          startDate: before.start_date,
          endDate: null,
          startTime: before.start_time,
          endTime: before.end_time,
          allDay: false,
          duration: 1,
          teamMemberIds: ["actor-1"],
        },
        after: {
          startDate: after.start_date,
          endDate: null,
          startTime: after.start_time,
          endTime: after.end_time,
          allDay: false,
          duration: 1,
          teamMemberIds: ["actor-1"],
        },
        scheduleVersion: claim.task_schedule_version,
      },
      expect.objectContaining({
        sourceId: "task-automation:event-1:confirmed-reschedule",
        throwOnError: true,
        prePersistGuard: expect.any(Function),
        taskAutomationGuard: {
          eventId: "event-1",
          leaseToken: "lease-1",
          taskId: "task-1",
          scheduleVersion: 7,
        },
      })
    );
    expect(fake.rpc).toHaveBeenCalledWith(
      "claim_task_schedule_automation_events",
      expect.objectContaining({ p_limit: 1 })
    );
    expect(fake.rpc).toHaveBeenCalledWith(
      "complete_task_schedule_automation_event",
      expect.objectContaining({
        p_event_id: "event-1",
        p_lease_token: "lease-1",
        p_disposition: "processed",
      })
    );
    expect(result).toMatchObject({ claimed: 1, completed: 1, superseded: 0 });
  });

  it("rejects an ABA-equivalent snapshot when its monotonic version is stale", async () => {
    const fake = database({
      task: {
        id: "task-1",
        status: "active",
        schedule_version: claim.task_schedule_version + 2,
        start_date: after.start_date,
        start_time: after.start_time,
      },
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never
    );

    expect(effects.rescheduled).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledWith(
      "complete_task_schedule_automation_event",
      expect.objectContaining({ p_disposition: "superseded" })
    );
    expect(result.superseded).toBe(1);
  });

  it("consumes actorless events fail closed", async () => {
    const fake = database({ claims: [{ ...claim, actor_user_id: null }] });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never
    );

    expect(effects.rescheduled).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledWith(
      "complete_task_schedule_automation_event",
      expect.objectContaining({ p_disposition: "actor_missing" })
    );
    expect(result.skipped).toBe(1);
  });

  it("requeues a leased event when its effect throws", async () => {
    effects.rescheduled.mockRejectedValueOnce(new Error("draft unavailable"));
    const fake = database({});

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never
    );

    expect(fake.rpc).toHaveBeenCalledWith(
      "fail_task_schedule_automation_event",
      expect.objectContaining({
        p_event_id: "event-1",
        p_lease_token: "lease-1",
        p_error: "draft unavailable",
        p_retryable: true,
      })
    );
    expect(result.requeued).toBe(1);
  });

  it("surfaces expired max-attempt events even when there is nothing left to claim", async () => {
    const fake = database({ claims: [], terminalFailed: 2 });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never
    );

    expect(result).toMatchObject({ claimed: 0, terminalFailed: 2 });
  });

  it("rechecks actor access inside the effect immediately before persistence", async () => {
    const fake = database({ permissions: [true, false] });
    effects.rescheduled.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[4] as {
        prePersistGuard: () => Promise<boolean>;
      };
      expect(await options.prePersistGuard()).toBe(false);
      return { actionTaken: "draft", actionId: null };
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never
    );

    expect(fake.rpc).toHaveBeenCalledWith(
      "complete_task_schedule_automation_event",
      expect.objectContaining({ p_disposition: "access_lost" })
    );
    expect(result).toMatchObject({ skipped: 1, requeued: 0 });
  });

  it("requeues an unscheduled confirmation when configured drafting creates no action", async () => {
    const unscheduledClaim = {
      ...claim,
      after_snapshot: {
        ...after,
        start_date: null,
        start_time: null,
      },
    };
    const fake = database({
      claims: [unscheduledClaim],
      task: {
        id: "task-1",
        company_id: "company-1",
        project_id: "project-1",
        status: "active",
        start_date: null,
        end_date: null,
        start_time: null,
        end_time: null,
        all_day: false,
        duration: 1,
        team_member_ids: ["actor-1"],
        schedule_version: claim.task_schedule_version,
        updated_at: claim.task_updated_at,
        schedule_confirmed_at: after.schedule_confirmed_at,
      },
    });
    effects.rescheduled.mockResolvedValueOnce({
      actionTaken: "draft",
      actionId: null,
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never
    );

    expect(fake.rpc).toHaveBeenCalledWith(
      "fail_task_schedule_automation_event",
      expect.objectContaining({
        p_error: "Configured schedule communication produced no durable action",
        p_retryable: true,
      })
    );
    expect(result).toMatchObject({ requeued: 1, completed: 0 });
  });

  it("claims and finishes one lease before claiming the next batch row", async () => {
    const second = {
      ...claim,
      event_id: "event-2",
      lease_token: "lease-2",
    };
    const fake = database({ claimBatches: [[claim], [second], []] });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never,
      { limit: 2, workerId: "worker-1" }
    );

    expect(result).toMatchObject({ claimed: 2, completed: 2 });
    expect(fake.leaseOrder).toEqual([
      "claim:event-1",
      "complete:event-1",
      "claim:event-2",
      "complete:event-2",
    ]);
    const claimCalls = fake.rpc.mock.calls.filter(
      ([name]) => name === "claim_task_schedule_automation_events"
    );
    expect(claimCalls).toHaveLength(2);
    expect(claimCalls.every(([, args]) => args?.p_limit === 1)).toBe(true);
  });

  it("passes the fenced durable lease to full-auto persistence", async () => {
    const fullAutoClaim = {
      ...claim,
      kind: "full_auto_confirmation",
      before_snapshot: {},
    };
    const fake = database({ claims: [fullAutoClaim] });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never,
      { limit: 1 }
    );

    expect(effects.fullAuto).toHaveBeenCalledWith(
      "company-1",
      "actor-1",
      "task-1",
      expect.objectContaining({
        taskAutomationGuard: {
          eventId: "event-1",
          leaseToken: "lease-1",
          taskId: "task-1",
          scheduleVersion: 7,
        },
      })
    );
    expect(result).toMatchObject({ claimed: 1, completed: 1 });
  });

  it("completes a coalesced A-to-B-to-A schedule as a no-op", async () => {
    const noOpClaim = {
      ...claim,
      after_snapshot: before,
    };
    const fake = database({
      claims: [noOpClaim],
      task: {
        id: "task-1",
        company_id: "company-1",
        project_id: "project-1",
        status: "active",
        start_date: before.start_date,
        end_date: before.end_date,
        start_time: before.start_time,
        end_time: before.end_time,
        all_day: before.all_day,
        duration: before.duration,
        team_member_ids: before.team_member_ids,
        schedule_version: claim.task_schedule_version,
        schedule_confirmed_at: before.schedule_confirmed_at,
      },
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never,
      { limit: 1 }
    );

    expect(effects.rescheduled).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledWith(
      "complete_task_schedule_automation_event",
      expect.objectContaining({
        p_disposition: "no_action",
        p_result: expect.objectContaining({
          reason: "coalesced_schedule_no_op",
          scheduleVersion: 7,
        }),
      })
    );
    expect(result).toMatchObject({ claimed: 1, skipped: 1, requeued: 0 });
  });

  it.each([
    ["task_assigned", "taskAssignment"],
    ["task_completed", "taskCompletion"],
    ["schedule_change", "scheduleChange"],
  ])(
    "persists and pushes %s from server-derived immutable proof",
    async (kind, pushType) => {
      const notificationClaim = {
        ...claim,
        kind,
        actor_user_id: null,
      };
      const fake = database({
        claims: [notificationClaim],
        notificationProof: {
          disposition: "processed",
          type: kind,
          title: "Task update",
          body: "Task details changed.",
          push_title:
            kind === "schedule_change" ? "Schedule Updated" : "Task update",
          push_body:
            kind === "schedule_change"
              ? "A task was changed or removed from your schedule."
              : "Task details changed.",
          project_id: "project-1",
          action_url: "/dashboard?openProject=project-1&mode=view",
          action_label: "View Task",
          push_recipient_ids: ["recipient-1", "recipient-2"],
        },
      });

      const result = await TaskMutationAutomationOutboxService.processBatch(
        fake.client as never,
        { limit: 1 }
      );

      expect(fake.rpc).toHaveBeenCalledWith(
        "persist_task_mutation_notification_as_system",
        {
          p_event_id: "event-1",
          p_lease_token: "lease-1",
        }
      );
      expect(effects.push).toHaveBeenCalledWith({
        recipientUserIds: ["recipient-1", "recipient-2"],
        title: kind === "schedule_change" ? "Schedule Updated" : "Task update",
        body:
          kind === "schedule_change"
            ? "A task was changed or removed from your schedule."
            : "Task details changed.",
        data:
          kind === "schedule_change"
            ? { type: pushType, screen: "schedule" }
            : {
                type: pushType,
                taskId: "task-1",
                projectId: "project-1",
                screen:
                  kind === "task_completed" ? "projectDetails" : "taskDetails",
              },
        idempotencyKey: "event-1",
      });
      expect(fake.rpc).not.toHaveBeenCalledWith(
        "authorize_task_action_as_system",
        expect.anything()
      );
      expect(fake.rpc).toHaveBeenCalledWith(
        "complete_task_schedule_automation_event",
        expect.objectContaining({
          p_event_id: "event-1",
          p_disposition: "processed",
        })
      );
      expect(result).toMatchObject({ claimed: 1, completed: 1 });
    }
  );

  it("retries a task notification when idempotent push delivery fails", async () => {
    effects.push.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    const fake = database({
      claims: [{ ...claim, kind: "task_assigned" }],
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never,
      { limit: 1 }
    );

    expect(fake.rpc).toHaveBeenCalledWith(
      "fail_task_schedule_automation_event",
      expect.objectContaining({
        p_event_id: "event-1",
        p_error: "Task notification push failed",
        p_retryable: true,
      })
    );
    expect(result).toMatchObject({ requeued: 1, completed: 0 });
  });

  it("completes stale notification proof without writing or pushing", async () => {
    const fake = database({
      claims: [{ ...claim, kind: "schedule_change" }],
      notificationProof: {
        disposition: "superseded",
        push_recipient_ids: [],
      },
    });

    const result = await TaskMutationAutomationOutboxService.processBatch(
      fake.client as never,
      { limit: 1 }
    );

    expect(effects.push).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledWith(
      "complete_task_schedule_automation_event",
      expect.objectContaining({ p_disposition: "superseded" })
    );
    expect(result).toMatchObject({ superseded: 1, completed: 0 });
  });
});
