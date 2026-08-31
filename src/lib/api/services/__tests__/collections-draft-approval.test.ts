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

const actionId = "33333333-3333-4333-8333-333333333333";
const companyId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const changeSetId = "66666666-6666-4666-8666-666666666666";
const runId = "77777777-7777-4777-8777-777777777777";
const confirmationId = "88888888-8888-4888-8888-888888888888";
const previewSha256 = `sha256:${"a".repeat(64)}`;

function action(status = "executed") {
  return {
    id: actionId,
    company_id: companyId,
    user_id: userId,
    action_type: "approve_collections_draft",
    action_data: {
      change_set_id: changeSetId,
      preview_sha256: previewSha256,
    },
    context_summary: "Collection draft ready for review",
    context_source: "collections",
    source_id: `agent-collections:${changeSetId}`,
    confidence: 1,
    priority: "normal",
    status,
    created_at: "2026-08-31T20:00:00.000Z",
    updated_at: "2026-08-31T20:01:00.000Z",
  };
}

function receipt(replayed = false) {
  return {
    ok: true,
    effect: "collections_draft_approved_inside_ops",
    run_id: runId,
    action_id: actionId,
    change_set_id: changeSetId,
    confirmation_receipt_id: confirmationId,
    preview_sha256: previewSha256,
    messages_sent: 0,
    money_moved: false,
    financial_documents_issued: 0,
    committed_at: "2026-08-31T20:01:00.000Z",
    replayed,
    receipt_sha256: `sha256:${"b".repeat(64)}`,
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
    single: async () => ({ data: finalAction, error: null }),
    update: () => builder,
  });
  return { client: { from: () => builder, rpc }, rpc };
}

describe("collection draft approval boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves the exact immutable draft inside OPS without invoking delivery", async () => {
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
      "commit_agent_collections_draft_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_change_set_id: changeSetId,
        p_preview_sha256: previewSha256,
        p_idempotency_key: `approve-collections-draft:${actionId}`,
      }
    );
    expect(executeManualMock).not.toHaveBeenCalled();
    expect(executeAutonomousMock).not.toHaveBeenCalled();
  });

  it("reconciles one ambiguous response by replaying the identical commit", async () => {
    const fixture = fakeSupabase();
    fixture.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "timeout" } })
      .mockResolvedValueOnce({ data: receipt(true), error: null });
    requireSupabaseMock.mockReturnValue(fixture.client);

    await ApprovalQueueService.approveAction(actionId, companyId, userId);

    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.rpc.mock.calls[1]).toEqual(fixture.rpc.mock.calls[0]);
  });

  it("rejects edits and invalid receipts before any generic executor can run", async () => {
    const fixture = fakeSupabase();
    requireSupabaseMock.mockReturnValue(fixture.client);
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        subject: "Changed",
      })
    ).rejects.toThrow("Collection draft previews cannot be edited");
    expect(fixture.rpc).not.toHaveBeenCalled();

    fixture.rpc.mockResolvedValueOnce({
      data: { ...receipt(), messages_sent: 1 },
      error: null,
    });
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId)
    ).rejects.toThrow();
    expect(executeManualMock).not.toHaveBeenCalled();
  });

  it("leaves the exact draft open through the coherent database decision", async () => {
    const fixture = fakeSupabase(action("rejected"));
    fixture.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        effect: "left_open_inside_ops",
        action_id: actionId,
        change_set_id: changeSetId,
        messages_sent: 0,
        money_moved: false,
        financial_documents_issued: 0,
        rejected_at: "2026-08-31T20:01:00.000Z",
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
      "reject_agent_collections_draft_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_review_notes: null,
      }
    );
  });

  it("forbids autonomous execution before any transport call", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);
    await expect(
      ApprovalQueueService.executeAutonomousAction(actionId)
    ).rejects.toThrow("Collection drafts require operator approval");
    expect(executeAutonomousMock).not.toHaveBeenCalled();
  });

  it("forbids bulk approval so each debtor remains an explicit decision", async () => {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      limit: vi.fn(),
    } as Record<string, unknown>;
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn(() => builder);
    builder.limit = vi.fn(async () => ({
      data: [{ id: actionId, action_type: "approve_collections_draft" }],
      error: null,
    }));
    requireSupabaseMock.mockReturnValue({
      from: () => builder,
      rpc: vi.fn(),
    });

    await expect(
      ApprovalQueueService.bulkApprove([actionId], companyId, userId)
    ).rejects.toThrow("Collection drafts must be approved one at a time");
  });
});
