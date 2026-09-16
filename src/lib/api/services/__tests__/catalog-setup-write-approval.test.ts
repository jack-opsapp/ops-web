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

import { resultFixture } from "@/lib/agent-control-plane/services/catalog-setup-write/__tests__/fixtures";
import { ApprovalQueueService } from "../approval-queue-service";

const actionId = "13333333-3333-4333-8333-333333333333";
const companyId = "24444444-4444-4444-8444-444444444444";
const userId = "35555555-5555-4555-8555-555555555555";
const changeSetId = "46666666-6666-4666-8666-666666666666";
const runId = "57777777-7777-4777-8777-777777777777";
const confirmationId = "68888888-8888-4888-8888-888888888888";
const variantId = "79999999-9999-4999-8999-999999999999";
const previewSha256 = "sha256:" + "a".repeat(64);

function receipt(replayed = false) {
  const fixture = resultFixture();
  return {
    ok: true,
    effect: "catalog_setup_write_saved_inside_ops",
    kind: "create_variant",
    run_id: runId,
    action_id: actionId,
    change_set_id: changeSetId,
    confirmation_receipt_id: confirmationId,
    preview_sha256: previewSha256,
    readback_sha256: "sha256:" + "b".repeat(64),
    readback: fixture.proposal.after.variant,
    variant_ref: { kind: "catalog_variant", id: variantId },
    effects: fixture.proposal.effects,
    committed_at: "2026-09-15T21:35:00.000Z",
    replayed,
    receipt_sha256: "sha256:" + "c".repeat(64),
  };
}

function action(status = "executed") {
  return {
    id: actionId,
    company_id: companyId,
    user_id: userId,
    action_type: "approve_catalog_setup_write",
    action_data: { change_set_id: changeSetId, preview_sha256: previewSha256 },
    context_summary: "Catalog change ready for review",
    context_source: "control_room",
    source_id: "agent-catalog-setup-write:" + changeSetId,
    confidence: 1,
    priority: "normal",
    status,
    execution_result: status === "executed" ? receipt() : null,
    created_at: "2026-09-15T21:00:00.000Z",
    updated_at: "2026-09-15T21:01:00.000Z",
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
    neq: () => builder,
    limit: async () => ({
      data: [{ id: actionId, action_type: "approve_catalog_setup_write" }],
      error: null,
    }),
    single: async () => ({ data: finalAction, error: null }),
    update: () => builder,
  });
  return { client: { from: () => builder, rpc }, rpc };
}

beforeEach(() => {
  requireSupabaseMock.mockReset();
  executeManualMock.mockReset();
  executeAutonomousMock.mockReset();
});

describe("catalogue setup write approval boundary", () => {
  it("commits only the displayed exact preview and validates its readback receipt", async () => {
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
      "commit_catalog_setup_write_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_change_set_id: changeSetId,
        p_preview_sha256: previewSha256,
        p_idempotency_key: "approve-catalog-setup-write:" + actionId,
      }
    );
    expect(executeManualMock).not.toHaveBeenCalled();
    expect(executeAutonomousMock).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous response by replaying the identical commit once", async () => {
    const fixture = fakeSupabase();
    requireSupabaseMock.mockReturnValue(fixture.client);
    fixture.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "network" },
    });
    fixture.rpc.mockResolvedValueOnce({ data: receipt(true), error: null });

    const result = await ApprovalQueueService.approveAction(
      actionId,
      companyId,
      userId,
      { preview_sha256: previewSha256, change_set_id: changeSetId }
    );

    expect(result.status).toBe("executed");
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.rpc.mock.calls[0]).toEqual(fixture.rpc.mock.calls[1]);
  });

  it("rejects edits, autonomous execution and a receipt claiming extra effects", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);

    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        price_override: { amount: "1.0000", currency: "CAD" },
      })
    ).rejects.toThrow(
      "Review the current catalog change preview before approving"
    );
    expect(fixture.rpc).not.toHaveBeenCalled();

    await expect(
      ApprovalQueueService.executeAutonomousAction(actionId)
    ).rejects.toThrow("Catalog changes require operator approval");
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

  it("refuses a receipt bound to another action or another seal", async () => {
    for (const substitution of [
      { action_id: "89999999-9999-4999-8999-999999999991" },
      { preview_sha256: "sha256:" + "f".repeat(64) },
      { change_set_id: "89999999-9999-4999-8999-999999999992" },
    ]) {
      const fixture = fakeSupabase(action("pending"));
      requireSupabaseMock.mockReturnValue(fixture.client);
      fixture.rpc.mockResolvedValue({
        data: { ...receipt(), ...substitution },
        error: null,
      });
      await expect(
        ApprovalQueueService.approveAction(actionId, companyId, userId, {
          preview_sha256: previewSha256,
          change_set_id: changeSetId,
        })
      ).rejects.toThrow();
    }
  });

  it("cannot be proposed generically, swept into bulk approval, or cancelled", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);

    await expect(
      ApprovalQueueService.proposeAction({
        companyId,
        userId,
        actionType: "approve_catalog_setup_write",
        actionData: {},
        contextSummary: "forged",
      } as never)
    ).rejects.toThrow("This action requires a sealed domain proposal");

    await expect(
      ApprovalQueueService.bulkApprove([actionId], companyId, userId)
    ).rejects.toThrow("Catalog changes must be approved one at a time");
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("rejects through the database and reads the rejection back", async () => {
    const fixture = fakeSupabase(action("rejected"));
    requireSupabaseMock.mockReturnValue(fixture.client);
    fixture.rpc.mockResolvedValue({
      data: {
        ok: true,
        effect: "left_unchanged_inside_ops",
        action_id: actionId,
        change_set_id: changeSetId,
      },
      error: null,
    });

    const result = await ApprovalQueueService.rejectAction(
      actionId,
      companyId,
      userId,
      "Wrong colour."
    );

    expect(result.status).toBe("rejected");
    expect(fixture.rpc).toHaveBeenCalledWith(
      "reject_catalog_setup_write_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_review_notes: "Wrong colour.",
      }
    );
  });
});

describe("catalogue setup write queue privacy", () => {
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

  it("excludes another operator's preview and fails closed without a viewer", async () => {
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

  it("masks the payload after record permission loss, keeping rejection available", async () => {
    queueFixture(
      [
        {
          ...action(),
          action_data: {
            change_set_id: changeSetId,
            preview_sha256: previewSha256,
            proposal: { family: { name: "Private family name" } },
          },
        } as ReturnType<typeof action>,
      ],
      []
    );
    const rows = await ApprovalQueueService.getQueue(companyId, {}, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actionData).toEqual({});
    expect(rows[0]!.executionResult).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Private family name");
  });

  it("returns full content only when the database allows the exact actor/action", async () => {
    const rpc = queueFixture([action()], [actionId]);
    const rows = await ApprovalQueueService.getQueue(companyId, {}, userId);
    expect(rows[0]!.actionData.preview_sha256).toBe(previewSha256);
    expect(rpc).toHaveBeenCalledWith(
      "filter_catalog_setup_write_actions_as_actor",
      { p_actor: userId, p_company: companyId, p_actions: [actionId] }
    );
  });
});
