/**
 * Approval-queue project lifecycle terminals — close vs archive.
 *
 * A project that is COMPLETE and PAID is a terminal SUCCESS → it must land in
 * `closed`. `archived` is reserved for operator pause/cancel. The agent queue
 * therefore has two distinct executors:
 *
 *   - close_project   → projects.status = 'closed'   (completion success)
 *   - archive_project → projects.status = 'archived'  (operator pause/cancel)
 *
 * These tests drive the real approveAction → executeAction → executor seam and
 * assert each terminal writes its own status. Conflating the two (repointing the
 * archive executor to 'closed') would fail the archive guard below.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
}));

import { ApprovalQueueService } from "@/lib/api/services/approval-queue-service";

interface FromCall {
  table: string;
  update?: Record<string, unknown>;
}

/**
 * Minimal chainable Supabase fake that records every `.from(table)` call and
 * the payload passed to `.update()`. `agent_actions` reads resolve to the
 * supplied action row; every other terminal resolves to `{ error: null }`.
 */
function makeFakeSupabase(actionRow: Record<string, unknown>) {
  const calls: FromCall[] = [];

  function from(table: string) {
    const record: FromCall = { table };
    calls.push(record);

    const result =
      table === "agent_actions"
        ? { data: actionRow, error: null }
        : { data: null, error: null };

    const builder: Record<string, unknown> = {
      update(payload: Record<string, unknown>) {
        record.update = payload;
        return builder;
      },
      eq: () => builder,
      is: () => builder,
      select: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => result,
      // Awaited terminal (executors do `await supabase.from(...).update().eq()...`)
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
    return builder;
  }

  return { supabase: { from }, calls };
}

function makeActionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "act-1",
    company_id: "co-1",
    user_id: "user-1",
    action_type: "close_project",
    action_data: {
      project_id: "proj-1",
      project_title: "WJ ROYAL BAY",
      completed_date: "2026-05-01T00:00:00Z",
      days_since_completion: 53,
      total_tasks: 6,
      completed_tasks: 6,
      total_invoiced: 12000,
      outstanding_balance: 0,
    },
    context_summary: 'Close "WJ ROYAL BAY" — completed 53 days ago, all tasks done, fully paid.',
    context_source: "lifecycle_automation",
    source_id: "proj-1:close",
    confidence: 0.9,
    priority: "low",
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

beforeEach(() => {
  requireSupabaseMock.mockReset();
});

describe("approval-queue close_project executor", () => {
  it("writes projects.status = 'closed' when a close_project action is approved", async () => {
    const { supabase, calls } = makeFakeSupabase(makeActionRow());
    requireSupabaseMock.mockReturnValue(supabase);

    await ApprovalQueueService.approveAction("act-1", "co-1", "user-1");

    const projectsUpdate = calls.find(
      (c) => c.table === "projects" && c.update !== undefined
    );
    expect(projectsUpdate).toBeDefined();
    expect(projectsUpdate!.update).toEqual({ status: "closed" });
  });

  it("never writes 'archived' on the close path", async () => {
    const { supabase, calls } = makeFakeSupabase(makeActionRow());
    requireSupabaseMock.mockReturnValue(supabase);

    await ApprovalQueueService.approveAction("act-1", "co-1", "user-1");

    const wroteArchived = calls.some(
      (c) => c.table === "projects" && c.update?.status === "archived"
    );
    expect(wroteArchived).toBe(false);
  });
});

describe("approval-queue archive_project executor — reserved for operator pause/cancel", () => {
  it("still writes projects.status = 'archived' when an archive_project action is approved", async () => {
    const archiveRow = makeActionRow({
      action_type: "archive_project",
      source_id: "proj-1:archive",
      context_source: "lifecycle_automation",
    });
    const { supabase, calls } = makeFakeSupabase(archiveRow);
    requireSupabaseMock.mockReturnValue(supabase);

    await ApprovalQueueService.approveAction("act-1", "co-1", "user-1");

    const projectsUpdate = calls.find(
      (c) => c.table === "projects" && c.update !== undefined
    );
    expect(projectsUpdate).toBeDefined();
    expect(projectsUpdate!.update).toEqual({ status: "archived" });
  });
});
