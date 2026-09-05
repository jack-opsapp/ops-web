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

import { resultFixture } from "@/lib/agent-control-plane/services/customer-update/__tests__/fixtures";
import { ApprovalQueueService } from "../approval-queue-service";

const actionId = "13333333-3333-4333-8333-333333333333";
const companyId = "24444444-4444-4444-8444-444444444444";
const userId = "35555555-5555-4555-8555-555555555555";
const changeSetId = "46666666-6666-4666-8666-666666666666";
const runId = "57777777-7777-4777-8777-777777777777";
const confirmationId = "68888888-8888-4888-8888-888888888888";
const previewSha256 = "sha256:" + "a".repeat(64);

function action(status = "executed") {
  return {
    id: actionId,
    company_id: companyId,
    user_id: userId,
    action_type: "approve_customer_update",
    action_data: { change_set_id: changeSetId, preview_sha256: previewSha256 },
    context_summary: "Dispatch confirmation task ready for exact review",
    context_source: "control_room",
    source_id: "agent-dispatch-confirmation:" + changeSetId,
    confidence: 1,
    priority: "high",
    status,
    execution_result: status === "executed" ? receipt() : null,
    created_at: "2026-09-03T20:00:00.000Z",
    updated_at: "2026-09-03T20:01:00.000Z",
  };
}

function receipt(replayed = false) {
  return {
    ok: true,
    effect: "customer_opportunity_updated_inside_ops",
    run_id: runId,
    action_id: actionId,
    change_set_id: changeSetId,
    confirmation_receipt_id: confirmationId,
    preview_sha256: previewSha256,
    readback_sha256: "sha256:" + "b".repeat(64),
    readback: resultFixture().proposal.after,
    effects: resultFixture().proposal.effects,
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
      data: [{ id: actionId, action_type: "approve_customer_update" }],
      error: null,
    }),
    single: async () => ({ data: finalAction, error: null }),
    update: () => builder,
  });
  return { client: { from: () => builder, rpc }, rpc };
}

describe("customer update approval boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("commits only the displayed exact customer update and validates its readback receipt", async () => {
    const fixture = fakeSupabase();
    requireSupabaseMock.mockReturnValue(fixture.client);

    const result = await ApprovalQueueService.approveAction(
      actionId,
      companyId,
      userId,
      { preview_sha256: previewSha256, change_set_id: changeSetId }
    );

    expect(result.status).toBe("executed");
    expect(fixture.rpc).toHaveBeenCalledOnce();
    expect(fixture.rpc).toHaveBeenCalledWith(
      "commit_agent_customer_update_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_change_set_id: changeSetId,
        p_preview_sha256: previewSha256,
        p_idempotency_key: "approve-customer-update:" + actionId,
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

    await ApprovalQueueService.approveAction(actionId, companyId, userId, {
      preview_sha256: previewSha256,
      change_set_id: changeSetId,
    });

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
    ).rejects.toThrow(
      "Review the current customer update preview before approving"
    );
    expect(fixture.rpc).not.toHaveBeenCalled();

    await expect(
      ApprovalQueueService.executeAutonomousAction(actionId)
    ).rejects.toThrow("Customer updates require operator approval");
    expect(executeAutonomousMock).not.toHaveBeenCalled();

    fixture.rpc.mockResolvedValueOnce({
      data: {
        ...receipt(),
        effects: { ...receipt().effects, messages_sent: 1 },
      },
      error: null,
    });
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        preview_sha256: previewSha256,
        change_set_id: changeSetId,
      })
    ).rejects.toThrow();
  });

  it("records rejection through the coherent database decision", async () => {
    const fixture = fakeSupabase(action("rejected"));
    fixture.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        effect: "left_unchanged_inside_ops",
        action_id: actionId,
        change_set_id: changeSetId,
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
      "reject_agent_customer_update_as_actor",
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
    ).rejects.toThrow("Customer updates must be approved one at a time");
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});

describe("customer update queue privacy", () => {
  function queueFixture(rows: ReturnType<typeof action>[], visible: string[]) {
    const rpc = vi.fn().mockResolvedValue({ data: visible, error: null });
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: async () => ({ data: rows, error: null }),
    });
    requireSupabaseMock.mockReturnValue({ from: () => builder, rpc });
    return rpc;
  }
  it("excludes another operator's previews and fails closed when no viewer identity was supplied", async () => {
    const rpc = queueFixture([action()], [actionId]);
    expect(
      await ApprovalQueueService.getQueue(
        companyId,
        {},
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      )
    ).toEqual([]);
    expect(await ApprovalQueueService.getQueue(companyId)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("masks a named operator's sensitive payload after record permission loss, while keeping rejection available", async () => {
    queueFixture(
      [
        {
          ...action(),
          action_data: {
            change_set_id: changeSetId,
            preview_sha256: previewSha256,
            secret: "Private correspondence",
          },
        } as ReturnType<typeof action>,
      ],
      []
    );
    const rows = await ApprovalQueueService.getQueue(companyId, {}, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actionData).toEqual({});
    expect(rows[0]!.executionResult).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Private correspondence");
  });
  it("returns full content only when the database independently allows the exact actor/action", async () => {
    const rpc = queueFixture([action()], [actionId]);
    const rows = await ApprovalQueueService.getQueue(companyId, {}, userId);
    expect(rows[0]!.actionData.preview_sha256).toBe(previewSha256);
    expect(rpc).toHaveBeenCalledWith(
      "filter_agent_customer_update_actions_as_actor",
      { p_actor: userId, p_company: companyId, p_actions: [actionId] }
    );
  });
});
