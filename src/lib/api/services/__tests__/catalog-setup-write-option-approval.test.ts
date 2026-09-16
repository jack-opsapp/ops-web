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
const familyId = "79999999-9999-4999-8999-999999999999";
const optionId = "8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const variantId = "9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const colourId = "0ccccccc-cccc-4ccc-8ccc-cccccccccccc";
const blackId = "1ddddddd-dddd-4ddd-8ddd-dddddddddddd";
const fortyTwoId = "2eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const previewSha256 = "sha256:" + "a".repeat(64);

const effects = {
  variants_created: 0,
  stock_units_created: 0,
  stock_events_recorded: 0,
  prices_changed: 0,
  supplier_cost_profiles_written: 0,
  messages_sent: 0,
  accounting_sync_enqueued: 0,
  options_created: 1,
  option_values_created: 1,
  variants_backfilled: 1,
  variants_updated: 1,
} as const;

const readback = {
  family: {
    family_ref: { kind: "catalog_family", id: familyId },
    name: "Endcap rail",
  },
  options: [
    {
      option_ref: { kind: "catalog_option", id: colourId },
      name: "Color",
      sort_order: 10,
      values: [
        {
          value_ref: { kind: "catalog_option_value", id: blackId },
          value: "Black",
          sort_order: 10,
        },
      ],
    },
    {
      option_ref: { kind: "catalog_option", id: optionId },
      name: "Height",
      sort_order: 20,
      values: [
        {
          value_ref: { kind: "catalog_option_value", id: fortyTwoId },
          value: '42"',
          sort_order: 10,
        },
      ],
    },
  ],
  variants: [
    {
      variant_ref: { kind: "catalog_variant", id: variantId },
      value_labels: ["Black", '42"'],
    },
  ],
  backfill: { option_name: "Height", value: '42"', variant_count: 1 },
} as const;

function receipt(replayed = false) {
  return {
    ok: true,
    effect: "catalog_setup_write_saved_inside_ops",
    kind: "create_option",
    run_id: runId,
    action_id: actionId,
    change_set_id: changeSetId,
    confirmation_receipt_id: confirmationId,
    preview_sha256: previewSha256,
    readback_sha256: "sha256:" + "b".repeat(64),
    readback,
    option_ref: { kind: "catalog_option", id: optionId },
    effects,
    committed_at: "2026-09-16T01:35:00.000Z",
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
    created_at: "2026-09-16T01:00:00.000Z",
    updated_at: "2026-09-16T01:01:00.000Z",
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

describe("create option approval boundary", () => {
  it("commits the displayed seal through the one shared commit and validates the read-back", async () => {
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

  it("refuses a read-back that could not have come from a live grid", async () => {
    for (const substitution of [
      // A read of live rows carries the ids they landed under.
      {
        readback: {
          ...readback,
          options: [
            readback.options[0],
            { ...readback.options[1], option_ref: null },
          ],
        },
      },
      // A per-row state is a prediction about a write, never a read.
      {
        readback: {
          ...readback,
          variants: readback.variants.map((entry) => ({
            ...entry,
            state: "backfilled",
          })),
        },
      },
      // A variant projection can never be served under this kind.
      {
        readback: {
          option_values: [],
          sku: null,
          sale_price: { amount: null, origin: "none" },
          unit_cost: { amount: null, origin: "none" },
          warning_threshold: { value: null, origin: "none" },
          critical_threshold: { value: null, origin: "none" },
          quantity: "0",
          is_active: true,
          stock_units: 0,
          stock_events: 0,
        },
      },
      // Counters this write cannot produce.
      { effects: { ...effects, options_created: 0 } },
      { effects: { ...effects, prices_changed: 1 } },
      { effects: { ...effects, stock_events_recorded: 1 } },
      { effects: { ...effects, variants_updated: 2 } },
      // The option the receipt names is the one the operator gets back.
      { option_ref: null },
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

  it("accepts a family that had nothing to backfill", async () => {
    const fixture = fakeSupabase();
    requireSupabaseMock.mockReturnValue(fixture.client);
    fixture.rpc.mockResolvedValue({
      data: {
        ...receipt(),
        readback: {
          ...readback,
          variants: [],
          backfill: { option_name: "Height", value: null, variant_count: 0 },
        },
        effects: { ...effects, variants_backfilled: 0, variants_updated: 0 },
      },
      error: null,
    });
    const result = await ApprovalQueueService.approveAction(
      actionId,
      companyId,
      userId,
      { preview_sha256: previewSha256, change_set_id: changeSetId }
    );
    expect(result.status).toBe("executed");
  });

  it("never runs a catalogue dimension change autonomously or on an edited seal", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);

    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        name: "Depth",
      })
    ).rejects.toThrow(
      "Review the current catalog change preview before approving"
    );
    expect(fixture.rpc).not.toHaveBeenCalled();

    await expect(
      ApprovalQueueService.executeAutonomousAction(actionId)
    ).rejects.toThrow("Catalog changes require operator approval");
    expect(executeAutonomousMock).not.toHaveBeenCalled();
  });
});
