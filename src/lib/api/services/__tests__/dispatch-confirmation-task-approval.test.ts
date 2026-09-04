import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSupabaseMock = vi.fn();
const executeManualMock = vi.fn();
const executeAutonomousMock = vi.fn();

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (value: unknown) => (value ? new Date(value as string) : null),
}));
vi.mock("../approved-action-email-transport-service", () => ({
  ApprovedActionEmailTransportService: {
    executeManual: (...args: unknown[]) => executeManualMock(...args),
    executeAutonomous: (...args: unknown[]) => executeAutonomousMock(...args),
    inspectDeliveryBoundary: vi.fn(),
    recover: vi.fn(),
  },
}));

import { ApprovalQueueService } from "../approval-queue-service";

const actionId = "13333333-3333-4333-8333-333333333333";
const companyId = "24444444-4444-4444-8444-444444444444";
const userId = "35555555-5555-4555-8555-555555555555";
const changeSetId = "46666666-6666-4666-8666-666666666666";
const runId = "57777777-7777-4777-8777-777777777777";
const confirmationId = "68888888-8888-4888-8888-888888888888";
const taskId = "79999999-9999-4999-8999-999999999999";
const previewSha256 = "sha256:" + "a".repeat(64);

function action(status = "executed") {
  return {
    id: actionId,
    company_id: companyId,
    user_id: userId,
    action_type: "approve_dispatch_confirmation_task",
    action_data: { change_set_id: changeSetId, preview_sha256: previewSha256 },
    context_summary: "Dispatch confirmation task ready for exact review",
    context_source: "control_room",
    source_id: "agent-dispatch-confirmation:" + changeSetId,
    confidence: 1,
    priority: "high",
    status,
    created_at: "2026-09-03T20:00:00.000Z",
    updated_at: "2026-09-03T20:01:00.000Z",
  };
}

function receipt(replayed = false) {
  return {
    ok: true,
    effect: "internal_task_created_inside_ops",
    run_id: runId,
    action_id: actionId,
    change_set_id: changeSetId,
    confirmation_receipt_id: confirmationId,
    task_id: taskId,
    preview_sha256: previewSha256,
    readback_sha256: "sha256:" + "b".repeat(64),
    tasks_created: 1,
    tasks_updated: 0,
    assignments_changed: 0,
    messages_sent: 0,
    money_moved: false,
    financial_documents_issued: 0,
    truth_boundary:
      "One internal OPS task created. No source task updated. No assignment changed. No message sent. No money moved. No financial document issued.",
    committed_at: "2026-09-03T20:01:00.000Z",
    replayed,
    receipt_sha256: "sha256:" + "c".repeat(64),
  };
}

function fakeSupabase(finalAction = action()) {
  const rpc = vi.fn(
    async (): Promise<{
      data: unknown;
      error: { message: string } | null;
    }> => ({ data: receipt(), error: null })
  );
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    limit: async () => ({
      data: [
        { id: actionId, action_type: "approve_dispatch_confirmation_task" },
      ],
      error: null,
    }),
    single: async () => ({ data: finalAction, error: null }),
    update: () => builder,
  });
  return { client: { from: () => builder, rpc }, rpc };
}

describe("dispatch confirmation task approval boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("commits exactly one immutable internal task and validates its readback receipt", async () => {
    const fixture = fakeSupabase();
    requireSupabaseMock.mockReturnValue(fixture.client);

    const result = await ApprovalQueueService.approveAction(
      actionId,
      companyId,
      userId
    );

    expect(result.status).toBe("executed");
    expect(fixture.rpc).toHaveBeenCalledOnce();
    expect(fixture.rpc).toHaveBeenCalledWith(
      "commit_agent_dispatch_confirmation_task_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_change_set_id: changeSetId,
        p_preview_sha256: previewSha256,
        p_idempotency_key: "approve-dispatch-confirmation-task:" + actionId,
      }
    );
    expect(executeManualMock).not.toHaveBeenCalled();
    expect(executeAutonomousMock).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous response by replaying the identical commit once", async () => {
    const fixture = fakeSupabase();
    fixture.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "timeout" } })
      .mockResolvedValueOnce({ data: receipt(true), error: null });
    requireSupabaseMock.mockReturnValue(fixture.client);

    await ApprovalQueueService.approveAction(actionId, companyId, userId);

    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.rpc.mock.calls[1]).toEqual(fixture.rpc.mock.calls[0]);
  });

  it("rejects edits, autonomous execution, and invalid effect receipts", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        title: "Retargeted",
      })
    ).rejects.toThrow("Dispatch confirmation task previews cannot be edited");
    expect(fixture.rpc).not.toHaveBeenCalled();

    await expect(
      ApprovalQueueService.executeAutonomousAction(actionId)
    ).rejects.toThrow("Dispatch confirmation tasks require operator approval");
    expect(executeAutonomousMock).not.toHaveBeenCalled();

    fixture.rpc.mockResolvedValueOnce({
      data: { ...receipt(), tasks_created: 2 },
      error: null,
    });
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId)
    ).rejects.toThrow();
  });

  it("records leave-open through the coherent database decision", async () => {
    const fixture = fakeSupabase(action("rejected"));
    fixture.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        effect: "left_open_inside_ops",
        action_id: actionId,
        change_set_id: changeSetId,
        tasks_created: 0,
        messages_sent: 0,
        money_moved: false,
        financial_documents_issued: 0,
        rejected_at: "2026-09-03T20:01:00.000Z",
      },
      error: null,
    });
    requireSupabaseMock.mockReturnValue(fixture.client);

    const result = await ApprovalQueueService.rejectAction(
      actionId,
      companyId,
      userId
    );

    expect(result.status).toBe("rejected");
    expect(fixture.rpc).toHaveBeenCalledWith(
      "reject_agent_dispatch_confirmation_task_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_review_notes: null,
      }
    );
  });

  it("cannot be swept into bulk approval", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);

    await expect(
      ApprovalQueueService.bulkApprove([actionId], companyId, userId)
    ).rejects.toThrow(
      "Dispatch confirmation tasks must be approved one at a time"
    );
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
