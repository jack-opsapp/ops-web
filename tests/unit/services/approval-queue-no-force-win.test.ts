/**
 * Approval-queue create_project must NOT force-win the opportunity.
 *
 * The approval-queue path creates a project from an AI proposal at `rfq`
 * WITHOUT winning the source opportunity — only the Won dialog wins a deal.
 * Behaviorally, that means executeCreateProject routes an opportunity-sourced
 * proposal through ProjectConversionService with `sourcePath: "approval_queue"`,
 * which the conversion service maps to `p_win_opportunity=false` (locked in
 * project-conversion-service.test.ts). This test drives the real
 * approveAction → executeAction → executeCreateProject → convert seam and
 * asserts the approval queue passes the approval_queue source path and seeds
 * the AI scope — and never requests a win.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const convertMock = vi.fn(async (_p: Record<string, unknown>) => ({
  converted: true,
  alreadyConverted: false,
  projectId: "proj-1",
  opportunityId: "opp-9",
}));
vi.mock("@/lib/api/services/project-conversion-service", () => ({
  ProjectConversionService: {
    convertOpportunityToProject: (p: Record<string, unknown>) => convertMock(p),
  },
}));

// Fire-and-forget task suggestion after creation — stub so nothing real runs.
vi.mock("@/lib/api/services/task-suggestion-service", () => ({
  TaskSuggestionService: {
    suggestTasksForProject: async () => [],
    proposeTaskCreation: async () => {},
  },
}));

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
}));

import { ApprovalQueueService } from "@/lib/api/services/approval-queue-service";

function makeActionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "act-1",
    company_id: "co-1",
    user_id: "user-1",
    action_type: "create_project",
    action_data: {
      source_opportunity_id: "opp-9",
      scope: "Tear-off + re-shingle",
      // A title is present in the proposal but is irrelevant on the conversion
      // path — the project is auto-named by the DB trigger.
      title: "Junk subject-line name",
    },
    context_summary: "Convert won lead",
    context_source: "opportunity_won",
    source_id: "opp-9",
    confidence: 0.9,
    priority: "normal",
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    executed_at: null,
    execution_result: null,
    error: null,
    expires_at: null,
    auto_execute_at: null,
    created_at: "2026-06-03T00:00:00Z",
    updated_at: "2026-06-03T00:00:00Z",
    ...overrides,
  };
}

function makeFakeSupabase() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    update: () => builder,
    eq: () => builder,
    select: () => builder,
    single: async () => ({ data: makeActionRow(), error: null }),
  });
  return { from: () => builder };
}

beforeEach(() => {
  requireSupabaseMock.mockReset();
  convertMock.mockClear();
  requireSupabaseMock.mockReturnValue(makeFakeSupabase());
});

describe("approval-queue create_project — no force-win", () => {
  it("routes an opportunity-sourced proposal through convert with sourcePath=approval_queue + scope seed", async () => {
    await ApprovalQueueService.approveAction("act-1", "co-1", "user-1");

    expect(convertMock).toHaveBeenCalledTimes(1);
    const args = convertMock.mock.calls[0][0];
    expect(args.sourcePath).toBe("approval_queue");
    expect(args.opportunityId).toBe("opp-9");
    expect(args.notesSeed).toBe("Tear-off + re-shingle");
  });

  it("passes NO winning override — the win/no-win decision is the service's (won_dialog only)", async () => {
    await ApprovalQueueService.approveAction("act-1", "co-1", "user-1");

    const args = convertMock.mock.calls[0][0];
    // The approval queue must not smuggle in a win flag; win is derived from
    // sourcePath inside the service (approval_queue ⇒ false).
    expect(args.winOpportunity).toBeUndefined();
    expect(args.expectedStage).toBeUndefined();
  });
});
