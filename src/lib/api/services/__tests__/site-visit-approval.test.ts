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
const confirmationId = "68888888-8888-4888-8888-888888888888";
const previewSha256 = "sha256:" + "a".repeat(64);

function action(status = "executed") {
  return {
    id: actionId,
    company_id: companyId,
    user_id: userId,
    action_type: "approve_site_visit_changes",
    action_data: {
      change_set_id: changeSetId,
      preview_sha256: previewSha256,
      proposal: proposal(),
    },
    context_summary: "Site visit save ready for exact review",
    context_source: "control_room",
    source_id: "site_visit:" + changeSetId,
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
    effect: "site_visit_changes_saved",
    operation: "answer_form",
    actor_user_id: userId,
    company_id: companyId,
    committed_at: "2026-09-10T12:00:00Z",
    receipt_sha256: "sha256:" + "b".repeat(64),
    records: [
      {
        entity: "answer",
        id: changeSetId,
        before: null,
        after: {
          id: changeSetId,
          company_id: companyId,
          site_visit_id: "57777777-7777-4777-8777-777777777777",
          answer_value: { boolValue: false },
        },
        sha256: "sha256:" + "c".repeat(64),
      },
    ],
    effects: {
      records: 1,
      physical_visit_status_changed: false,
      calendar_intent: "not_requested",
      customer_messages_sent: 0,
    },
    missing_required: [],
    site_visit_id: "57777777-7777-4777-8777-777777777777",
    appointment: null,
    timezone_proof: null,
    calendar_reconciled: false,
    customer_messages_sent: 0,
    action_id: actionId,
    change_set_id: changeSetId,
    confirmation_receipt_id: confirmationId,
    preview_sha256: previewSha256,
    replayed,
  };
}

function proposal() {
  const r = receipt();
  return {
    operation: "answer_form",
    title: "Update site visit answers",
    ready: true,
    entity: "answer",
    site_visit_id: r.site_visit_id,
    visit_context: {
      id: r.site_visit_id,
      title: "Deck assessment",
      address: null,
      local_start: "2026-09-10T10:00:00",
      timezone: "America/Edmonton",
      utc_offset_minutes: -360,
    },
    rows: r.records.map((row) => ({
      id: row.id,
      base_revision: 1,
      before: null,
      values: row.after,
    })),
    sources: [],
    missing_required: [],
    source_sha256: previewSha256,
    timezone_proof: null,
    effects: r.effects,
    content_kind: "untrusted_business_data",
  };
}

function fakeSupabase(finalAction = action()) {
  const rpc = vi.fn(
    async (): Promise<{
      data: unknown;
      error: { message: string; code?: string } | null;
    }> => ({ data: receipt(), error: null })
  );
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    limit: async () => ({
      data: [{ id: actionId, action_type: "approve_site_visit_changes" }],
      error: null,
    }),
    single: async () => ({ data: finalAction, error: null }),
    update: () => builder,
  });
  return { client: { from: () => builder, rpc }, rpc };
}

describe("site_visit approval boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not report success when both reconciliation responses are uncertain", async () => {
    const fixture = fakeSupabase();
    fixture.rpc.mockResolvedValue({
      data: null,
      error: { message: "timeout" },
    });
    requireSupabaseMock.mockReturnValue(fixture.client);
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        preview_sha256: previewSha256,
        change_set_id: changeSetId,
      })
    ).rejects.toThrow("could not be reconciled");
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.rpc.mock.calls[0]).toEqual(fixture.rpc.mock.calls[1]);
  });

  it("preserves the exact approval and asks for a retry when site_visit writers are busy", async () => {
    const fixture = fakeSupabase();
    fixture.rpc.mockResolvedValue({
      data: null,
      error: { code: "55P03", message: "lock unavailable" },
    });
    requireSupabaseMock.mockReturnValue(fixture.client);
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        preview_sha256: previewSha256,
        change_set_id: changeSetId,
      })
    ).rejects.toThrow("Retry this approval shortly");
    expect(fixture.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    "action_id",
    "change_set_id",
    "preview_sha256",
    "company_id",
    "actor_user_id",
  ])("rejects substituted receipt identity %s", async (field) => {
    const fixture = fakeSupabase();
    fixture.rpc.mockResolvedValueOnce({
      data: {
        ...receipt(),
        [field]:
          field === "preview_sha256"
            ? "sha256:" + "f".repeat(64)
            : "ffffffff-ffff-4fff-8fff-ffffffffffff",
      },
      error: null,
    });
    requireSupabaseMock.mockReturnValue(fixture.client);
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        preview_sha256: previewSha256,
        change_set_id: changeSetId,
      })
    ).rejects.toThrow("receipt is invalid");
  });

  it("requires an executed saved action with matching receipt seal", async () => {
    for (const finalAction of [
      action("pending"),
      {
        ...action(),
        execution_result: {
          ...receipt(),
          receipt_sha256: "sha256:" + "f".repeat(64),
        },
      },
    ]) {
      const fixture = fakeSupabase(finalAction);
      requireSupabaseMock.mockReturnValue(fixture.client);
      await expect(
        ApprovalQueueService.approveAction(actionId, companyId, userId, {
          preview_sha256: previewSha256,
          change_set_id: changeSetId,
        })
      ).rejects.toThrow(/readback/);
    }
  });

  it("rejects changed persisted receipt content even when a stale hash is copied", async () => {
    const fixture = fakeSupabase({
      ...action(),
      execution_result: {
        ...receipt(),
        company_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      },
    });
    requireSupabaseMock.mockReturnValue(fixture.client);
    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        preview_sha256: previewSha256,
        change_set_id: changeSetId,
      })
    ).rejects.toThrow(/readback/);
  });

  it.each([
    undefined,
    { preview_sha256: previewSha256 },
    {
      preview_sha256: previewSha256,
      change_set_id: changeSetId,
      total: "1.00",
    },
  ])(
    "rejects missing or modified confirmation without invoking commit",
    async (args) => {
      const fixture = fakeSupabase();
      requireSupabaseMock.mockReturnValue(fixture.client);
      await expect(
        ApprovalQueueService.approveAction(actionId, companyId, userId, args)
      ).rejects.toThrow("Review the current site visit preview");
      expect(fixture.rpc).not.toHaveBeenCalled();
    }
  );

  it("saves only the displayed exact site_visit and validates its readback receipt", async () => {
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
      "commit_site_visit_workflow_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
        p_change_set_id: changeSetId,
        p_preview_sha256: previewSha256,
        p_idempotency_key: "approve-site-visit:" + actionId,
      }
    );
    expect(executeManualMock).not.toHaveBeenCalled();
    expect(executeAutonomousMock).not.toHaveBeenCalled();
  });
  it.each([
    "visit",
    "company",
    "row",
    "value",
    "operation",
    "missing",
    "effects",
  ])(
    "rejects a changed %s even when both receipt copies agree",
    async (mode) => {
      const altered = receipt();
      if (mode === "visit")
        altered.site_visit_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      if (mode === "company")
        altered.records[0].after.company_id =
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      if (mode === "row")
        altered.records[0].id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      if (mode === "value")
        altered.records[0].after.answer_value.boolValue = true;
      if (mode === "operation") altered.operation = "select_checklist";
      if (mode === "missing")
        Object.assign(altered, {
          missing_required: [
            {
              answer_id: changeSetId,
              field_id: "x",
              label: "Still unknown",
              kind: "short_text",
            },
          ],
        });
      if (mode === "effects") altered.effects.records = 2;
      const fixture = fakeSupabase({ ...action(), execution_result: altered });
      fixture.rpc.mockResolvedValue({ data: altered, error: null });
      requireSupabaseMock.mockReturnValue(fixture.client);
      await expect(
        ApprovalQueueService.approveAction(actionId, companyId, userId, {
          preview_sha256: previewSha256,
          change_set_id: changeSetId,
        })
      ).rejects.toThrow("receipt is invalid");
    }
  );

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
    ).rejects.toThrow("Review the current site visit preview before approving");
    expect(fixture.rpc).not.toHaveBeenCalled();

    await expect(
      ApprovalQueueService.executeAutonomousAction(actionId)
    ).rejects.toThrow("Site visit changes require exact operator approval");
    expect(executeAutonomousMock).not.toHaveBeenCalled();

    fixture.rpc.mockResolvedValueOnce({
      data: {
        ...receipt(),
        effects: { ...receipt().effects, customer_messages_sent: 1 },
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
        effect: "rejected",
        action_id: actionId,
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
      "reject_site_visit_workflow_as_actor",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_action_id: actionId,
      }
    );
  });

  it("cannot be swept into bulk approval", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);

    await expect(
      ApprovalQueueService.bulkApprove([actionId], companyId, userId)
    ).rejects.toThrow(
      "Site visit changes must be approved one proposal at a time"
    );
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});

describe("site_visit queue privacy", () => {
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
      "filter_site_visit_workflow_actions_as_actor",
      {
        p_actor: userId,
        p_company: companyId,
        p_actions: [actionId],
      }
    );
  });
});
