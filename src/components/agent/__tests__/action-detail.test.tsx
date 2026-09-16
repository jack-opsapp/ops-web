import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentAction,
  AgentActionPriority,
  AgentActionStatus,
} from "@/lib/types/approval-queue";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: "en" }),
}));

import { ActionDetail } from "../action-detail";

/**
 * Minimal `reassign_task` proposal. Every field of the real `AgentAction`
 * interface is present — the detail reads `status`, `actionData`, and
 * `contextSource` directly, so the fixture must not weaken the contract
 * with `any`.
 */
function make(over: Partial<AgentAction> = {}): AgentAction {
  return {
    id: "action-1",
    companyId: "company-1",
    userId: "user-1",
    actionType: "reassign_task",
    actionData: {
      task_id: "task-1",
      task_title: "Rough-in inspection",
      project_id: "project-1",
      project_title: "Maple St. rebuild",
      current_team_member_id: "user-2",
      current_team_member_name: "Tom",
      suggested_team_member_id: "user-3",
      suggested_team_member_name: "Mike",
      new_start_date: "2026-09-04T00:00:00.000Z",
      new_end_date: "2026-09-05T00:00:00.000Z",
      overdue_days: 6,
      assignment_reason: "Tom is over capacity on Tuesday",
    },
    contextSummary: "Crew is over capacity on Tuesday",
    contextSource: null,
    sourceId: null,
    confidence: 0.82,
    priority: "normal" as AgentActionPriority,
    status: "pending" as AgentActionStatus,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    executedAt: null,
    executionResult: null,
    error: null,
    expiresAt: null,
    autoExecuteAt: null,
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    ...over,
  };
}

function renderDetail(over: Partial<AgentAction> = {}) {
  return render(
    <ActionDetail
      action={make(over)}
      onApprove={() => {}}
      onReject={() => {}}
      t={(k: string) => k}
    />
  );
}

describe("ActionDetail", () => {
  it("renders the per-type detail body and the approve/reject pair for a pending proposal", () => {
    renderDetail();

    // Per-type body: the reassign block surfaces the project and the reason.
    expect(screen.getByText("Maple St. rebuild")).toBeInTheDocument();
    expect(
      screen.getByText("Tom is over capacity on Tuesday")
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "action.approve" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "action.reject" })
    ).toBeInTheDocument();
  });

  it("renders no approve/reject pair once the proposal is decided", () => {
    renderDetail({ status: "approved" as AgentActionStatus });

    expect(
      screen.queryByRole("button", { name: "action.approve" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "action.reject" })
    ).not.toBeInTheDocument();
  });

  it("renders the exact evidence, policy, effect boundary, and commit choice for a control-room task", () => {
    renderDetail({
      actionType: "approve_dispatch_confirmation_task",
      contextSource: "control_room",
      actionData: {
        schema_revision: "2026-09-03.v1",
        run_id: "57777777-7777-4777-8777-777777777777",
        change_set_id: "46666666-6666-4666-8666-666666666666",
        policy: {
          policy_id: "dispatch-confirmation",
          version: "canpro.1",
          rule_key: "unacknowledged-dispatch-follow-up",
          source_document_id: "CANPRO-PRD-002",
          source_document_version: "1.0",
          source_sha256: "sha256:" + "a".repeat(64),
          system_document_id: "CANPRO-SYS-001",
          system_document_version: "1.0",
          system_source_sha256: "sha256:" + "b".repeat(64),
        },
        evidence: {
          source_kind: "schedule",
          source_reason: "confirmation_required",
          source_task_id: "11111111-1111-4111-8111-111111111111",
          source_task_title: {
            value: "Dispatch crew to Alder Street",
            content_kind: "untrusted_business_data",
          },
          project_id: "22222222-2222-4222-8222-222222222222",
          project_title: {
            value: "Alder Street",
            content_kind: "untrusted_business_data",
          },
          schedule_version: 7,
          scheduled_start_at: "2026-09-04T15:00:00.000Z",
          source_sha256: "sha256:" + "c".repeat(64),
          operational_overview_proof_ref:
            "ops_proof:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          work_queue_proof_ref: "ops_proof:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          task_context_proof_ref:
            "ops_proof:v1:cccccccccccccccccccccccccccccccc",
        },
        proposal: {
          operation: "create_internal_task",
          task: {
            task_id: "79999999-9999-4999-8999-999999999999",
            project_id: "22222222-2222-4222-8222-222222222222",
            task_type_id: "88888888-8888-4888-8888-888888888888",
            title: "Confirm dispatch",
            assigned_user_id: "35555555-5555-4555-8555-555555555555",
            status: "active",
          },
          priority: "high",
          preview_sha256: "sha256:" + "d".repeat(64),
          expires_at: "2026-09-04T20:00:00.000Z",
        },
        preview_sha256: "sha256:" + "d".repeat(64),
        expires_at: "2026-09-04T20:00:00.000Z",
        truth_boundary:
          "Preview only. No task created or updated. No assignment changed. No message sent. No money moved. No financial document issued.",
      },
    });

    expect(screen.getByText("Alder Street")).toBeInTheDocument();
    expect(
      screen.getByText("Dispatch crew to Alder Street")
    ).toBeInTheDocument();
    expect(screen.getByText("Confirm dispatch")).toBeInTheDocument();
    expect(screen.getByText("CANPRO-PRD-002 · 1.0")).toBeInTheDocument();
    expect(screen.getByText(/No task created or updated/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "dispatch.action.create" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "dispatch.action.leaveOpen" })
    ).toBeInTheDocument();
  });
});

import { resultFixture as catalogSetupWriteFixture } from "@/lib/agent-control-plane/services/catalog-setup-write/__tests__/fixtures";
describe("catalogue setup write exact approval", () => {
  it("renders the family, the new variant's money and stock, and the operator's own words", () => {
    const result = catalogSetupWriteFixture();
    const approve = vi.fn();
    render(
      <ActionDetail
        action={make({
          actionType: "approve_catalog_setup_write",
          actionData: {
            proposal: result.proposal,
            preview_sha256: result.preview_sha256,
            change_set_id: result.change_set_id,
          },
        })}
        onApprove={approve}
        onReject={() => {}}
        t={(k) => k}
      />
    );
    expect(screen.getAllByText(/Vinyl/).length).toBeGreaterThan(0);
    expect(screen.getByText("Boardwalk / 60mil Smooth")).toBeInTheDocument();
    expect(
      screen.getByText(result.proposal.evidence[0]!.text)
    ).toBeInTheDocument();
    // Opening stock is shown as what it is: a recorded receipt, not a count.
    expect(
      screen.getByText(/catalogSetupWrite.openingStockNote/)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "catalogSetupWrite.save" })
    );
    expect(approve).toHaveBeenCalledWith("action-1", {
      preview_sha256: result.preview_sha256,
      change_set_id: result.change_set_id,
    });
  });

  it("shows an unset field as an em dash rather than hiding it", () => {
    const result = catalogSetupWriteFixture();
    result.proposal.after.variant.sku = null;
    result.proposal.after.variant.unit_cost = null;
    renderDetail({
      actionType: "approve_catalog_setup_write",
      actionData: { proposal: result.proposal },
    });
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("disables approval when the displayed preview is invalid or expired", () => {
    const result = catalogSetupWriteFixture();
    result.proposal.expires_at = "2000-01-01T00:00:00.000Z";
    const { unmount } = renderDetail({
      actionType: "approve_catalog_setup_write",
      actionData: { proposal: result.proposal },
    });
    expect(
      screen.getByRole("button", { name: "catalogSetupWrite.save" })
    ).toBeDisabled();
    unmount();
    renderDetail({
      actionType: "approve_catalog_setup_write",
      actionData: { proposal: {} },
    });
    expect(
      screen.getByRole("button", { name: "catalogSetupWrite.save" })
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "catalogSetupWrite.invalid"
    );
  });

  it("reads a threshold change as now/after with the level each value comes from", () => {
    const proposal = thresholdsProposal();
    const approve = vi.fn();
    render(
      <ActionDetail
        action={make({
          actionType: "approve_catalog_setup_write",
          actionData: {
            proposal,
            preview_sha256: `sha256:${"e".repeat(64)}`,
            change_set_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        })}
        onApprove={approve}
        onReject={() => {}}
        t={(k) => k}
      />
    );
    expect(screen.getAllByText(/Line/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Black \/ Topmount \/ 72"/)
    ).toBeInTheDocument();
    // Both levels are shown, including the one the request left alone.
    expect(
      screen.getByText("catalogSetupWrite.warning")
    ).toBeInTheDocument();
    expect(
      screen.getByText("catalogSetupWrite.critical")
    ).toBeInTheDocument();
    // An untracked level reads as an em dash, not as a missing row.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(
      screen.getAllByText(/catalogSetupWrite.origin.none/).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/catalogSetupWrite.origin.variant/).length
    ).toBeGreaterThan(0);
    // This kind never claims the create kind's stock sentence.
    expect(
      screen.queryByText(/catalogSetupWrite.openingStockNote/)
    ).toBeNull();
    expect(
      screen.getByText(/catalogSetupWrite.thresholdEffects/)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "catalogSetupWrite.save" })
    );
    expect(approve).toHaveBeenCalledWith("action-1", {
      preview_sha256: `sha256:${"e".repeat(64)}`,
      change_set_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
  });

  it("refuses a threshold preview whose origin and value disagree", () => {
    const proposal = thresholdsProposal();
    (
      proposal as unknown as {
        after: { warning: { value: string | null; origin: string } };
      }
    ).after.warning = { value: null, origin: "variant" };
    renderDetail({
      actionType: "approve_catalog_setup_write",
      actionData: { proposal },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "catalogSetupWrite.invalid"
    );
    expect(
      screen.getByRole("button", { name: "catalogSetupWrite.save" })
    ).toBeDisabled();
  });

  it("reads a price change as now/after and lists every variant it moves", () => {
    const approve = vi.fn();
    render(
      <ActionDetail
        action={make({
          actionType: "approve_catalog_setup_write",
          actionData: {
            proposal: pricingProposal(),
            preview_sha256: `sha256:${"f".repeat(64)}`,
            change_set_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
        })}
        onApprove={approve}
        onReject={() => {}}
        t={(k) => k}
      />
    );
    expect(screen.getAllByText(/Endcap rail/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/catalogSetupWrite.targetFamily/)
    ).toBeInTheDocument();
    // The price reads in the same now/after idiom as the levels, with the
    // level each answer comes from.
    expect(screen.getByText("catalogSetupWrite.salePrice")).toBeInTheDocument();
    expect(
      screen.getAllByText(/catalogSetupWrite.priceOrigin.family/).length
    ).toBeGreaterThan(0);
    // Every affected variant is listed, not counted.
    expect(screen.getByText(/catalogSetupWrite.affected/)).toBeInTheDocument();
    expect(screen.getByText("Black")).toBeInTheDocument();
    expect(screen.getByText("Sand")).toBeInTheDocument();
    expect(
      screen.getByText(/catalogSetupWrite.pricingEffects/)
    ).toBeInTheDocument();
    // This kind never claims the create kind's stock sentence.
    expect(screen.queryByText(/catalogSetupWrite.openingStockNote/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "catalogSetupWrite.save" })
    );
    expect(approve).toHaveBeenCalledWith("action-1", {
      preview_sha256: `sha256:${"f".repeat(64)}`,
      change_set_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  it("calls out the variants a cleared price leaves with nothing", () => {
    const proposal = pricingProposal();
    const after = (
      proposal as unknown as {
        after: {
          price: { amount: string | null; currency: string; origin: string };
          affected_variants: Array<{
            sale_price: string | null;
            sale_price_origin: string;
          }>;
        };
      }
    ).after;
    after.price = { amount: null, currency: "CAD", origin: "none" };
    for (const row of after.affected_variants) {
      row.sale_price = null;
      row.sale_price_origin = "none";
    }
    renderDetail({
      actionType: "approve_catalog_setup_write",
      actionData: { proposal },
    });
    expect(
      screen.getByText(/catalogSetupWrite.losingPrice/)
    ).toBeInTheDocument();
    // An unpriced variant reads as an em dash, never as a missing row.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a price preview whose origin and amount disagree", () => {
    const proposal = pricingProposal();
    (
      proposal as unknown as {
        after: {
          price: { amount: string | null; currency: string; origin: string };
        };
      }
    ).after.price = { amount: null, currency: "CAD", origin: "family" };
    renderDetail({
      actionType: "approve_catalog_setup_write",
      actionData: { proposal },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "catalogSetupWrite.invalid"
    );
    expect(
      screen.getByRole("button", { name: "catalogSetupWrite.save" })
    ).toBeDisabled();
  });

});

function pricingProposal() {
  const target = {
    item_ref: {
      kind: "catalog_family",
      id: "948ac4a0-882f-efe9-3bc4-b6f7c53fb12f",
    },
    name: "Endcap rail",
    value_labels: [] as string[],
  };
  const variant = (id: string, label: string, price: string) => ({
    variant_ref: { kind: "catalog_variant", id },
    value_labels: [label],
    sale_price: price,
    sale_price_origin: "family",
  });
  return {
    operation: "set_catalog_pricing",
    kind: "set_pricing",
    policy_revision: "2026-09-15.catalog-setup-write.v1",
    family: {
      family_ref: {
        kind: "catalog_family",
        id: "948ac4a0-882f-efe9-3bc4-b6f7c53fb12f",
      },
      name: "Endcap rail",
    },
    before: {
      target,
      price: { amount: "6.0000", currency: "CAD", origin: "family" },
      affected_variants: [
        variant("7d82d8e3-b62b-4a6c-85cc-ee02642b99c4", "Black", "6.0000"),
        variant("7d82d8e3-b62b-4a6c-85cc-ee02642b99c5", "Sand", "6.0000"),
      ],
    },
    after: {
      target,
      price: { amount: "7.5000", currency: "CAD", origin: "family" },
      affected_variants: [
        variant("7d82d8e3-b62b-4a6c-85cc-ee02642b99c4", "Black", "7.5000"),
        variant("7d82d8e3-b62b-4a6c-85cc-ee02642b99c5", "Sand", "7.5000"),
      ],
    },
    effects: {
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
      prices_changed: 2,
    },
    evidence: [
      {
        kind: "operator_statement",
        text: "Jackson raised the endcap rail family price to 7.50.",
        source_sha256: `sha256:${"a".repeat(64)}`,
        content_kind: "untrusted_business_data",
      },
    ],
    expires_at: "2099-09-15T21:30:00.000Z",
    reversal: "A correction requires a fresh preview and approval.",
  };
}

function thresholdsProposal() {
  const variant = {
    variant_ref: {
      kind: "catalog_variant",
      id: "411f89c9-d2a1-44a8-8377-6c11a098f0f7",
    },
    value_labels: ["Black", "Topmount", '72"'],
    sku: null,
  };
  return {
    operation: "set_variant_thresholds",
    kind: "set_thresholds",
    policy_revision: "2026-09-15.catalog-setup-write.v1",
    family: {
      family_ref: {
        kind: "catalog_family",
        id: "393c5c83-d9df-2a48-9837-2e04501b34c6",
      },
      name: "Line",
    },
    before: {
      variant,
      warning: { value: null, origin: "none" },
      critical: { value: null, origin: "none" },
    },
    after: {
      variant,
      warning: { value: "24", origin: "variant" },
      critical: { value: "6", origin: "variant" },
    },
    effects: {
      variants_created: 0,
      stock_units_created: 0,
      stock_events_recorded: 0,
      prices_changed: 0,
      options_created: 0,
      variants_backfilled: 0,
      supplier_cost_profiles_written: 0,
      messages_sent: 0,
      accounting_sync_enqueued: 0,
      variants_updated: 1,
      thresholds_changed: 2,
    },
    evidence: [
      {
        kind: "operator_statement",
        text: "Jackson wants this line warning at 24 and critical at 6.",
        source_sha256: `sha256:${"f".repeat(64)}`,
        content_kind: "untrusted_business_data",
      },
    ],
    expires_at: "2099-09-15T21:30:00.000Z",
    reversal: "A correction requires a fresh preview and approval.",
  };
}
import { resultFixture } from "@/lib/agent-control-plane/services/customer-update/__tests__/fixtures";
describe("customer update exact approval", () => {
  it("renders literal evidence and submits the displayed seal without proposed edits", () => {
    const result = resultFixture();
    const approve = vi.fn();
    render(
      <ActionDetail
        action={make({
          actionType: "approve_customer_update",
          actionData: {
            proposal: result.proposal,
            preview_sha256: result.preview_sha256,
            change_set_id: result.change_set_id,
          },
        })}
        onApprove={approve}
        onReject={() => {}}
        t={(k) => k}
      />
    );
    expect(screen.getAllByText(/Inspect the west roof/).length).toBeGreaterThan(
      0
    );
    expect(
      screen.getByText(result.proposal.evidence[0]!.text)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "customerUpdate.save" })
    );
    expect(approve).toHaveBeenCalledWith("action-1", {
      preview_sha256: result.preview_sha256,
      change_set_id: result.change_set_id,
    });
  });
  it("disables approval when the displayed preview is invalid or expired", () => {
    const result = resultFixture();
    result.proposal.expires_at = "2000-01-01T00:00:00.000Z";
    const { unmount } = renderDetail({
      actionType: "approve_customer_update",
      actionData: { proposal: result.proposal },
    });
    expect(
      screen.getByRole("button", { name: "customerUpdate.save" })
    ).toBeDisabled();
    unmount();
    renderDetail({
      actionType: "approve_customer_update",
      actionData: { proposal: {} },
    });
    expect(
      screen.getByRole("button", { name: "customerUpdate.save" })
    ).toBeDisabled();
  });
});

describe("customer message exact approval", () => {
  const proposal = {
    operation: "send_customer_email_follow_up" as const,
    policy_revision: "customer-message-follow-up:2026-09-06.v1" as const,
    opportunity: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Patio expansion",
      updated_at: "2026-09-06T17:00:00.000Z",
    },
    sender: {
      connection_id: "22222222-2222-4222-8222-222222222222",
      address: "operator@example.com",
      mailbox_type: "individual" as const,
    },
    recipients: {
      to: ["customer@example.com"] as [string],
      cc: [] as [],
      bcc: [] as [],
    },
    thread: {
      internal_thread_id: "33333333-3333-4333-8333-333333333333",
      provider_thread_id: "thread-1",
      in_reply_to: "message-1",
    },
    message: {
      subject: "Re: Patio expansion",
      body: "Thanks for the update. We can meet Tuesday morning.",
      content_type: "text" as const,
      attachment_ids: [] as [],
    },
    source: {
      activity_id: "44444444-4444-4444-8444-444444444444",
      provider_source_id: "55555555-5555-4555-8555-555555555555",
      source_sha256: "sha256:" + "a".repeat(64),
      sender_identity: "customer@example.com",
      direction: "inbound" as const,
      delivered_at: "2026-09-06T16:55:00.000Z",
      excerpt: "Tuesday morning works for us.",
      content_kind: "untrusted_business_data" as const,
    },
    effects: {
      external_messages_attempted: 1 as const,
      recipients: 1 as const,
      cc_recipients: 0 as const,
      bcc_recipients: 0 as const,
      attachments: 0 as const,
      business_records_changed: 0 as const,
      schedules_changed: 0 as const,
      money_moved: false as const,
    },
    approval: {
      required: true as const,
      named_approver_id: "66666666-6666-4666-8666-666666666666",
      expires_at: "2099-09-06T18:00:00.000Z",
      single_use: true as const,
    },
    cancellation:
      "Cancellation is available until approval. After approval, OPS may already be attempting the send." as const,
  };

  it("shows exact addressing and submits only the visible seal", () => {
    const approve = vi.fn();
    render(
      <ActionDetail
        action={make({
          actionType: "send_customer_follow_up",
          actionData: {
            proposal,
            preview_sha256: "sha256:" + "b".repeat(64),
            change_set_id: "77777777-7777-4777-8777-777777777777",
          },
        })}
        onApprove={approve}
        onReject={() => {}}
        t={(k) => k}
      />
    );
    expect(screen.getByText("operator@example.com")).toBeInTheDocument();
    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
    expect(screen.getByText(proposal.message.body)).toBeInTheDocument();
    expect(screen.getByText(proposal.source.excerpt)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "customerMessage.send" })
    );
    expect(approve).toHaveBeenCalledWith("action-1", {
      preview_sha256: "sha256:" + "b".repeat(64),
      change_set_id: "77777777-7777-4777-8777-777777777777",
    });
  });
});
