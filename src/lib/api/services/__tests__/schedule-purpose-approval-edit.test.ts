import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSupabaseMock = vi.fn();
const executeManualMock = vi.fn();
const executeAutonomousMock = vi.fn();
const inspectDeliveryBoundaryMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (value: unknown) => (value ? new Date(value as string) : null),
}));
vi.mock("../approved-action-email-transport-service", () => ({
  ApprovedActionEmailTransportService: {
    executeManual: (...args: unknown[]) => executeManualMock(...args),
    executeAutonomous: (...args: unknown[]) => executeAutonomousMock(...args),
    inspectDeliveryBoundary: (...args: unknown[]) =>
      inspectDeliveryBoundaryMock(...args),
    recover: vi.fn(),
  },
}));

import { ApprovalQueueService } from "../approval-queue-service";

function fakeSupabase(action: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const rpc = vi.fn(
    async (
      _name: string,
      args: Record<string, unknown>
    ): Promise<{
      data: Record<string, unknown> | null;
      error: { message: string } | null;
    }> => ({
      data: {
        action_id: args.p_action_id,
        reset: true,
        status: "pending",
        previous_intent_status: "prepared",
      },
      error: null,
    })
  );
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    single: async () => ({ data: action, error: null }),
    update: (payload: Record<string, unknown>) => {
      updates.push(payload);
      return builder;
    },
  });
  return { client: { from: () => builder, rpc }, updates, rpc };
}

describe("purpose schedule approval edits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inspectDeliveryBoundaryMock.mockResolvedValue("pre_provider_retryable");
    executeAutonomousMock.mockReset();
  });

  it.each([
    {
      action_type: "send_appointment_confirmation",
      source_id:
        "schedule-confirmation:11111111-1111-4111-8111-111111111111:v0:2026-08-12T20:00:00.000Z",
      action_data: { task_id: "11111111-1111-4111-8111-111111111111" },
    },
    {
      action_type: "send_schedule_changed",
      source_id:
        "task-automation:22222222-2222-4222-8222-222222222222:schedule-unconfirmation",
      action_data: {
        task_automation_guard: {
          event_id: "22222222-2222-4222-8222-222222222222",
          task_id: "11111111-1111-4111-8111-111111111111",
          schedule_version: 0,
        },
      },
    },
  ])("rejects edits before pending status can change", async (identity) => {
    const fixture = fakeSupabase({ status: "pending", ...identity });
    requireSupabaseMock.mockReturnValue(fixture.client);

    await expect(
      ApprovalQueueService.approveAction(
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
        { draft_text: "retarget this protected message" }
      )
    ).rejects.toThrow("Schedule communication proposals cannot be edited");

    expect(fixture.updates).toEqual([]);
  });

  it("keeps a newly approved purpose action retryable after a pre-provider failure", async () => {
    const fixture = fakeSupabase({
      id: "33333333-3333-4333-8333-333333333333",
      company_id: "44444444-4444-4444-8444-444444444444",
      user_id: "55555555-5555-4555-8555-555555555555",
      action_type: "send_appointment_confirmation",
      source_id:
        "schedule-confirmation:11111111-1111-4111-8111-111111111111:v0:2026-08-12T20:00:00.000Z",
      action_data: { task_id: "11111111-1111-4111-8111-111111111111" },
      status: "pending",
    });
    requireSupabaseMock.mockReturnValue(fixture.client);
    executeManualMock.mockRejectedValue(new Error("signature lookup failed"));

    await expect(
      ApprovalQueueService.approveAction(
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555"
      )
    ).rejects.toThrow("Action execution failed: signature lookup failed");

    expect(fixture.rpc).toHaveBeenCalledWith(
      "reset_purpose_schedule_email_action_for_retry_as_system",
      {
        p_action_id: "33333333-3333-4333-8333-333333333333",
        p_error: "signature lookup failed",
      }
    );
    expect(fixture.updates).toContainEqual(
      expect.objectContaining({ status: "approved" })
    );
    expect(fixture.updates).not.toContainEqual(
      expect.objectContaining({ status: "failed" })
    );
  });

  it("resumes an already-approved purpose action without repeating approval", async () => {
    const fixture = fakeSupabase({
      id: "33333333-3333-4333-8333-333333333333",
      company_id: "44444444-4444-4444-8444-444444444444",
      user_id: "55555555-5555-4555-8555-555555555555",
      action_type: "send_schedule_changed",
      source_id:
        "task-automation:22222222-2222-4222-8222-222222222222:schedule-unconfirmation",
      action_data: {
        task_automation_guard: {
          event_id: "22222222-2222-4222-8222-222222222222",
          task_id: "11111111-1111-4111-8111-111111111111",
          schedule_version: 0,
        },
      },
      status: "approved",
    });
    requireSupabaseMock.mockReturnValue(fixture.client);
    executeManualMock.mockRejectedValue(new Error("mailbox lease busy"));

    await expect(
      ApprovalQueueService.approveAction(
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555"
      )
    ).rejects.toThrow("Action execution failed: mailbox lease busy");

    expect(executeManualMock).toHaveBeenCalledTimes(1);
    expect(fixture.updates).toEqual([]);
    expect(fixture.rpc).toHaveBeenCalledWith(
      "reset_purpose_schedule_email_action_for_retry_as_system",
      {
        p_action_id: "33333333-3333-4333-8333-333333333333",
        p_error: "mailbox lease busy",
      }
    );
  });

  it.each(["awaiting_signature", "pending"] as const)(
    "resets a nonthrowing %s manual outcome to the review queue",
    async (state) => {
      const fixture = fakeSupabase({
        id: "33333333-3333-4333-8333-333333333333",
        company_id: "44444444-4444-4444-8444-444444444444",
        user_id: "55555555-5555-4555-8555-555555555555",
        action_type: "send_appointment_confirmation",
        source_id:
          "schedule-confirmation:11111111-1111-4111-8111-111111111111:v0:2026-08-12T20:00:00.000Z",
        action_data: {
          task_id: "11111111-1111-4111-8111-111111111111",
        },
        status: "pending",
      });
      requireSupabaseMock.mockReturnValue(fixture.client);
      executeManualMock.mockResolvedValue({
        state,
        delivered: false,
        error:
          state === "awaiting_signature"
            ? "EMAIL_SIGNATURE_REQUIRED"
            : "MAILBOX_BUSY",
      });

      const result = await ApprovalQueueService.approveAction(
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555"
      );

      expect(result.status).toBe("pending");
      expect(fixture.rpc).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["provider_outcome_owned", "unknown"] as const)(
    "never applies a generic failed transition for %s delivery state",
    async (boundary) => {
      const fixture = fakeSupabase({
        id: "33333333-3333-4333-8333-333333333333",
        company_id: "44444444-4444-4444-8444-444444444444",
        user_id: "55555555-5555-4555-8555-555555555555",
        action_type: "send_appointment_confirmation",
        source_id:
          "schedule-confirmation:11111111-1111-4111-8111-111111111111:v0:2026-08-12T20:00:00.000Z",
        action_data: {
          task_id: "11111111-1111-4111-8111-111111111111",
        },
        status: "approved",
      });
      requireSupabaseMock.mockReturnValue(fixture.client);
      executeManualMock.mockRejectedValue(
        new Error("provider state uncertain")
      );
      inspectDeliveryBoundaryMock.mockResolvedValue(boundary);
      fixture.rpc.mockResolvedValue({
        data: null,
        error: { message: "PURPOSE_SCHEDULE_EMAIL_RETRY_NOT_SAFE" },
      });

      await expect(
        ApprovalQueueService.approveAction(
          "33333333-3333-4333-8333-333333333333",
          "44444444-4444-4444-8444-444444444444",
          "55555555-5555-4555-8555-555555555555"
        )
      ).rejects.toThrow("provider state uncertain");

      expect(fixture.updates).toEqual([]);
    }
  );

  it.each([
    { mode: "throw", state: null },
    { mode: "outcome", state: "awaiting_signature" },
    { mode: "outcome", state: "pending" },
  ] as const)(
    "resets autonomous pre-provider $mode/$state work to pending",
    async ({ mode, state }) => {
      const fixture = fakeSupabase({
        id: "33333333-3333-4333-8333-333333333333",
        company_id: "44444444-4444-4444-8444-444444444444",
        user_id: "55555555-5555-4555-8555-555555555555",
        action_type: "send_appointment_confirmation",
        source_id:
          "schedule-confirmation:11111111-1111-4111-8111-111111111111:v0:2026-08-12T20:00:00.000Z",
        action_data: {
          task_id: "11111111-1111-4111-8111-111111111111",
        },
        status: "pending",
        reviewed_by: null,
      });
      requireSupabaseMock.mockReturnValue(fixture.client);
      if (mode === "throw") {
        executeAutonomousMock.mockRejectedValue(
          new Error("pre-provider authorization unavailable")
        );
      } else {
        executeAutonomousMock.mockResolvedValue({
          state,
          delivered: false,
          error: "pre-provider retry",
        });
      }

      if (mode === "throw") {
        await expect(
          ApprovalQueueService.executeAutonomousAction(
            "33333333-3333-4333-8333-333333333333"
          )
        ).rejects.toThrow("pre-provider authorization unavailable");
      } else {
        const result = await ApprovalQueueService.executeAutonomousAction(
          "33333333-3333-4333-8333-333333333333"
        );
        expect(result.status).toBe("pending");
      }
      expect(fixture.rpc).toHaveBeenCalledTimes(1);
      expect(fixture.updates).not.toContainEqual(
        expect.objectContaining({ status: "failed" })
      );
    }
  );

  it.each(["provider_outcome_owned", "unknown"] as const)(
    "leaves autonomous %s work to the durable transport",
    async (boundary) => {
      const fixture = fakeSupabase({
        id: "33333333-3333-4333-8333-333333333333",
        company_id: "44444444-4444-4444-8444-444444444444",
        user_id: "55555555-5555-4555-8555-555555555555",
        action_type: "send_appointment_confirmation",
        source_id:
          "schedule-confirmation:11111111-1111-4111-8111-111111111111:v0:2026-08-12T20:00:00.000Z",
        action_data: {
          task_id: "11111111-1111-4111-8111-111111111111",
        },
        status: "approved",
        reviewed_by: null,
      });
      requireSupabaseMock.mockReturnValue(fixture.client);
      executeAutonomousMock.mockRejectedValue(new Error("provider uncertain"));
      inspectDeliveryBoundaryMock.mockResolvedValue(boundary);
      fixture.rpc.mockResolvedValue({
        data: null,
        error: { message: "PURPOSE_SCHEDULE_EMAIL_RETRY_NOT_SAFE" },
      });

      await expect(
        ApprovalQueueService.executeAutonomousAction(
          "33333333-3333-4333-8333-333333333333"
        )
      ).rejects.toThrow("provider uncertain");

      expect(fixture.updates).toEqual([]);
    }
  );

  it("uses the bounded selector only to reset stranded purpose actions", async () => {
    const firstActionId = "33333333-3333-4333-8333-333333333333";
    const secondActionId = "66666666-6666-4666-8666-666666666666";
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "list_due_purpose_schedule_email_action_retries_as_system") {
        return {
          data: [{ action_id: firstActionId }, { action_id: secondActionId }],
          error: null,
        };
      }
      if (name === "reset_purpose_schedule_email_action_for_retry_as_system") {
        return {
          data: {
            action_id: args?.p_action_id,
            reset: true,
            status: "pending",
            previous_intent_status: "prepared",
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue({ rpc });

    const result =
      await ApprovalQueueService.recoverPurposeScheduleEmailActionRetries();

    expect(result).toEqual({
      selected: 2,
      reset: 2,
      skipped: 0,
      failed: 0,
      actionIds: [firstActionId, secondActionId],
      errors: [],
    });
    expect(executeManualMock).not.toHaveBeenCalled();
    expect(executeAutonomousMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "list_due_purpose_schedule_email_action_retries_as_system"
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "reset_purpose_schedule_email_action_for_retry_as_system",
      {
        p_action_id: firstActionId,
        p_error: "Recovered stranded pre-provider schedule communication",
      }
    );
  });
});
