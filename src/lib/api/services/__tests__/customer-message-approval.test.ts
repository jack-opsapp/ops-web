import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSupabaseMock = vi.fn();
const executeManualMock = vi.fn();
const inspectDeliveryBoundaryMock = vi.fn();
const executeAutonomousMock = vi.fn();

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

const actionId = "13333333-3333-4333-8333-333333333333";
const companyId = "24444444-4444-4444-8444-444444444444";
const userId = "35555555-5555-4555-8555-555555555555";
const changeSetId = "46666666-6666-4666-8666-666666666666";
const intentId = "57777777-7777-4777-8777-777777777777";
const previewSha256 = "sha256:" + "a".repeat(64);

function receipt(state = "reconciled_sent") {
  return {
    ok: true,
    effect: `customer_message_${state}`,
    action_id: actionId,
    change_set_id: changeSetId,
    intent_id: intentId,
    preview_sha256: previewSha256,
    state,
    sender: "operator@example.com",
    recipients: ["customer@example.com"],
    provider_message_id: "provider-message",
    provider_thread_id: "provider-thread",
    activity_id: "68888888-8888-4888-8888-888888888888",
    provider_accepted_at: "2026-09-06T18:00:00.000Z",
    reconciled_at: "2026-09-06T18:00:01.000Z",
    delivered_at: null,
    replayed: false,
    receipt_sha256: "sha256:" + "b".repeat(64),
  };
}

function action(status = "executed") {
  return {
    id: actionId,
    company_id: companyId,
    user_id: userId,
    action_type: "send_customer_follow_up",
    action_data: { change_set_id: changeSetId, preview_sha256: previewSha256 },
    context_summary: "Customer reply ready for review",
    context_source: "control_room",
    source_id: `agent-customer-message:${changeSetId}`,
    confidence: 1,
    priority: "high",
    status,
    execution_result: receipt(),
    created_at: "2026-09-06T17:59:00.000Z",
    updated_at: "2026-09-06T18:00:01.000Z",
  };
}

function fakeSupabase() {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === "reject_agent_customer_message_as_actor"
        ? receipt("cancelled_before_send")
        : receipt("approved_queued"),
    error: null,
  }));
  let final = action();
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    neq: () => builder,
    update: () => builder,
    order: () => builder,
    limit: async () => ({ data: [final], error: null }),
    single: async () => ({ data: final, error: null }),
  });
  return {
    client: { from: () => builder, rpc },
    rpc,
    setFinal(value: ReturnType<typeof action>) {
      final = value;
    },
  };
}

describe("customer message exact approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeManualMock.mockResolvedValue({
      state: "reconciled",
      delivered: true,
      intentId,
    });
    inspectDeliveryBoundaryMock.mockResolvedValue("provider_outcome_owned");
  });

  it("approves the sealed preview, sends one durable intent, and validates the receipt", async () => {
    const fixture = fakeSupabase();
    requireSupabaseMock.mockReturnValue(fixture.client);
    const result = await ApprovalQueueService.approveAction(
      actionId,
      companyId,
      userId,
      { preview_sha256: previewSha256, change_set_id: changeSetId }
    );
    expect(fixture.rpc).toHaveBeenCalledWith(
      "approve_agent_customer_message_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_change_set_id: changeSetId,
        p_preview_sha256: previewSha256,
        p_idempotency_key: `approve-customer-message:${actionId}`,
      }
    );
    expect(executeManualMock).toHaveBeenCalledOnce();
    expect(executeAutonomousMock).not.toHaveBeenCalled();
    expect(result.executionResult?.state).toBe("reconciled_sent");
  });

  it("rejects edits and never fabricates a second send after an uncertain provider boundary", async () => {
    const fixture = fakeSupabase();
    requireSupabaseMock.mockReturnValue(fixture.client);
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        subject: "Retargeted",
      })
    ).rejects.toThrow("Review the exact customer reply before approving");
    expect(fixture.rpc).not.toHaveBeenCalled();

    executeManualMock.mockRejectedValueOnce(new Error("provider timeout"));
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        preview_sha256: previewSha256,
        change_set_id: changeSetId,
      })
    ).rejects.toThrow("provider outcome is being reconciled");
    expect(executeManualMock).toHaveBeenCalledOnce();
    expect(inspectDeliveryBoundaryMock).toHaveBeenCalledOnce();
  });

  it("records cancellation only through the domain boundary", async () => {
    const fixture = fakeSupabase();
    fixture.setFinal(action("rejected"));
    requireSupabaseMock.mockReturnValue(fixture.client);
    const result = await ApprovalQueueService.rejectAction(
      actionId,
      companyId,
      userId,
      "Draft no longer needed"
    );
    expect(fixture.rpc).toHaveBeenCalledWith(
      "reject_agent_customer_message_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_review_notes: "Draft no longer needed",
      }
    );
    expect(result.status).toBe("rejected");
    expect(executeManualMock).not.toHaveBeenCalled();
  });
});
