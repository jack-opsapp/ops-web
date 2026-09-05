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
