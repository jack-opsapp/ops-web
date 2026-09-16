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
const variantId = "79999999-9999-4999-8999-999999999999";
const previewSha256 = "sha256:" + "a".repeat(64);

const effects = {
  variants_created: 0,
  stock_units_created: 0,
  stock_events_recorded: 0,
  prices_changed: 0,
  options_created: 0,
  variants_backfilled: 0,
  messages_sent: 0,
  accounting_sync_enqueued: 0,
  supplier_cost_profiles_written: 2,
  profiles_created: 0,
  profiles_revived: 0,
  profiles_updated: 1,
  profiles_demoted: 1,
  profiles_promoted: 1,
  variant_unit_cost_mirrored: true,
} as const;

function profile(key: string, cost: string, isDefault: boolean) {
  return {
    profile_key: key,
    label: `${key} rate card`,
    unit_cost: cost,
    currency: "CAD",
    is_default: isDefault,
    activation_rule: {},
    source: {},
    content_kind: "untrusted_business_data",
  };
}

const readback = {
  variant: {
    variant_ref: { kind: "catalog_variant", id: variantId },
    value_labels: ["Boardwalk", "60mil Smooth"],
    sku: null,
  },
  profiles: [
    profile("rails-direct-2026", "18.2500", true),
    profile("deksmart-standard", "16.9200", false),
  ],
  variant_unit_cost: "18.2500",
} as const;

function receipt(replayed = false) {
  return {
    ok: true,
    effect: "catalog_setup_write_saved_inside_ops",
    kind: "set_supplier_cost",
    run_id: runId,
    action_id: actionId,
    change_set_id: changeSetId,
    confirmation_receipt_id: confirmationId,
    preview_sha256: previewSha256,
    readback_sha256: "sha256:" + "b".repeat(64),
    readback,
    variant_ref: { kind: "catalog_variant", id: variantId },
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

describe("supplier cost approval boundary", () => {
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

  it("refuses a receipt that breaks the one-default rule or the counters", async () => {
    for (const substitution of [
      // Two defaults, and none: both are cost sheets OPS cannot have produced.
      {
        readback: {
          ...readback,
          profiles: [
            profile("rails-direct-2026", "18.2500", true),
            profile("deksmart-standard", "16.9200", true),
          ],
        },
      },
      {
        readback: {
          ...readback,
          profiles: [
            profile("rails-direct-2026", "18.2500", false),
            profile("deksmart-standard", "16.9200", false),
          ],
        },
      },
      // A read-back is live rows; a per-row state is a prediction.
      {
        readback: {
          ...readback,
          profiles: readback.profiles.map((entry) => ({
            ...entry,
            state: "unchanged",
          })),
        },
      },
      // A pricing read-back can never be served under this kind.
      {
        readback: {
          target: {
            item_ref: { kind: "catalog_family", id: variantId },
            name: "Vinyl",
            value_labels: [],
          },
          price: { amount: "7.5000", currency: "CAD", origin: "family" },
          affected_variants: [],
        },
      },
      // One row written, plus the current default when promoting demotes it.
      { effects: { ...effects, supplier_cost_profiles_written: 1 } },
      { effects: { ...effects, prices_changed: 1 } },
      { effects: { ...effects, stock_events_recorded: 1 } },
      // A write that does nothing to the profile it names.
      {
        effects: {
          ...effects,
          profiles_created: 0,
          profiles_revived: 0,
          profiles_updated: 0,
          profiles_promoted: 0,
        },
      },
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

  it("accepts a read-back whose row text OPS would not render, with the text withheld", async () => {
    const fixture = fakeSupabase();
    requireSupabaseMock.mockReturnValue(fixture.client);
    fixture.rpc.mockResolvedValue({
      data: {
        ...receipt(),
        readback: {
          ...readback,
          profiles: [
            profile("rails-direct-2026", "18.2500", true),
            {
              ...profile("deksmart-standard", "16.9200", false),
              label: null,
            },
          ],
        },
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

  it("never runs a cost change autonomously or on an edited seal", async () => {
    const fixture = fakeSupabase(action("pending"));
    requireSupabaseMock.mockReturnValue(fixture.client);

    await expect(
      ApprovalQueueService.approveAction(actionId, companyId, userId, {
        unit_cost: { amount: "9.00", currency: "CAD" },
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
