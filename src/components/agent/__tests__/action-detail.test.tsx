import { render, screen } from "@testing-library/react";
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
});
