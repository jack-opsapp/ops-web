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
const variantId = "8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const previewSha256 = "sha256:" + "a".repeat(64);

const effects = {
  variants_created: 0,
  stock_units_created: 0,
  stock_events_recorded: 0,
  options_created: 0,
  variants_backfilled: 0,
  supplier_cost_profiles_written: 0,
  messages_sent: 0,
  accounting_sync_enqueued: 0,
  families_updated: 1,
  variants_updated: 0,
  prices_changed: 1,
} as const;

const readback = {
  target: {
    item_ref: { kind: "catalog_family", id: familyId },
    name: "Endcap rail",
    value_labels: [],
  },
  price: { amount: "7.5000", currency: "CAD", origin: "family" },
  affected_variants: [
    {
      variant_ref: { kind: "catalog_variant", id: variantId },
      value_labels: ["Black"],
      sale_price: "7.5000",
      sale_price_origin: "family",
    },
  ],
} as const;

function receipt(replayed = false) {
  return {
    ok: true,
    effect: "catalog_setup_write_saved_inside_ops",
    kind: "set_pricing",
    run_id: runId,
    action_id: actionId,
    change_set_id: changeSetId,
    confirmation_receipt_id: confirmationId,
    preview_sha256: previewSha256,
    readback_sha256: "sha256:" + "b".repeat(64),
    readback,
    item_ref: { kind: "catalog_family", id: familyId },
    effects,
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

describe("price change approval boundary", () => {
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

  it("refuses a receipt that lies about the price, the level or what it moved", async () => {
    for (const substitution of [
      // An amount with no level, and a level with no amount: both are lies
      // about whether the price is the item's own or one it inherits.
      {
        readback: {
          ...readback,
          price: { amount: "7.5000", currency: "CAD", origin: "none" },
        },
      },
      {
        readback: {
          ...readback,
          price: { amount: null, currency: "CAD", origin: "family" },
        },
      },
      // A variant row that names no level for the price it shows.
      {
        readback: {
          ...readback,
          affected_variants: [
            { ...readback.affected_variants[0], sale_price_origin: "none" },
          ],
        },
      },
      // A thresholds read-back can never be served under this kind.
      {
        readback: {
          variant: {
            variant_ref: { kind: "catalog_variant", id: variantId },
            value_labels: [],
            sku: null,
          },
          warning: { value: null, origin: "none" },
          critical: { value: null, origin: "none" },
        },
      },
      // One write moves one level, never both and never neither.
      { effects: { ...effects, variants_updated: 1 } },
      { effects: { ...effects, families_updated: 0 } },
      { effects: { ...effects, stock_events_recorded: 1 } },
      { effects: { ...effects, supplier_cost_profiles_written: 1 } },
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

  it("never runs a price change autonomously or on an edited seal", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);

    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        sale_price: { amount: "9.00", currency: "CAD" },
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
