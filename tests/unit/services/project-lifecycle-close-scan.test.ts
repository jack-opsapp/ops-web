/**
 * Project lifecycle scan — completed + fully paid ⇒ propose close_project.
 *
 * The scan over `status = 'completed'` projects that have all tasks done and a
 * zero outstanding balance must propose a `close_project` agent action (terminal
 * success), NEVER `archive_project` (which is reserved for operator pause/cancel).
 * It also respects the outstanding-balance guard (don't close with money owed)
 * and de-dupes against already-pending `close_project` proposals.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
}));

vi.mock("@/lib/api/services/company-managers", () => ({
  getCompanyManagerUserIds: async () => ["admin-1"],
}));

const proposeActionMock = vi.fn(async (_params: Record<string, unknown>) => "action-id");
vi.mock("@/lib/api/services/approval-queue-service", () => ({
  ApprovalQueueService: {
    proposeAction: (params: Record<string, unknown>) => proposeActionMock(params),
  },
}));

const getProjectContextMock = vi.fn();
vi.mock("@/lib/api/services/business-context-service", () => ({
  BusinessContextService: {
    getProjectContext: (companyId: string, projectId: string) =>
      getProjectContextMock(companyId, projectId),
  },
}));

import { ProjectLifecycleService } from "@/lib/api/services/project-lifecycle-service";

const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

/**
 * Keyed Supabase fake: resolves each query by (table, selected columns). Every
 * chain is awaitable and also supports `.single()`.
 */
function makeScanSupabase(opts: {
  pendingCloseSourceIds?: string[];
  incompleteTasks?: unknown[];
  noRecentActivity?: boolean;
  allTasks?: unknown[];
  projectUpdatedAt?: string;
}) {
  const resultFor = (table: string, cols: string): { data: unknown } => {
    if (table === "companies") return { data: { lifecycle_settings: null } };
    if (table === "projects" && cols.includes("title"))
      return {
        data: [
          {
            id: "proj-1",
            title: "WJ ROYAL BAY",
            client_id: "c1",
            status: "completed",
            updated_at: opts.projectUpdatedAt ?? SIXTY_DAYS_AGO,
            status_version: 7,
          },
        ],
      };
    if (table === "agent_actions")
      return {
        data: (opts.pendingCloseSourceIds ?? []).map((s) => ({ source_id: s })),
      };
    if (table === "project_tasks" && cols === "id")
      return { data: opts.incompleteTasks ?? [] };
    if (table === "project_tasks" && cols === "id, status")
      return {
        data: opts.allTasks ?? [
          { id: "t1", status: "completed" },
          { id: "t2", status: "completed" },
        ],
      };
    if (table === "project_tasks" && cols === "updated_at")
      return {
        data: opts.noRecentActivity ? [] : [{ updated_at: SIXTY_DAYS_AGO }],
      };
    return { data: [] };
  };

  function from(table: string) {
    let cols = "";
    const builder: Record<string, unknown> = {
      select(c: string) {
        cols = c;
        return builder;
      },
      eq: () => builder,
      is: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => ({ ...resultFor(table, cols), error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ ...resultFor(table, cols), error: null }),
    };
    return builder;
  }

  return { from };
}

beforeEach(() => {
  requireSupabaseMock.mockReset();
  proposeActionMock.mockClear();
  getProjectContextMock.mockReset();
});

describe("ProjectLifecycleService — completed + paid ⇒ close_project", () => {
  it("proposes a close_project action (never archive_project) for a complete + fully paid project", async () => {
    requireSupabaseMock.mockReturnValue(makeScanSupabase({}));
    getProjectContextMock.mockResolvedValue({
      financials: { outstandingBalance: 0, invoicedTotal: 12000 },
    });

    const proposed = await ProjectLifecycleService.detectClosableProjects("co-1");

    expect(proposed).toBe(1);
    expect(proposeActionMock).toHaveBeenCalledTimes(1);
    const params = proposeActionMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.actionType).toBe("close_project");
    expect(params.actionType).not.toBe("archive_project");
    expect(params.sourceId).toBe("proj-1:close");
    expect(params.contextSummary).toBe(
      'Close "WJ ROYAL BAY" — completed 60 days ago, all tasks done, fully paid.'
    );
    expect(
      (params.actionData as Record<string, unknown>)
        .expected_project_status_version
    ).toBe(7);
  });

  it("does NOT propose a close when the project still owes money (outstanding > 0)", async () => {
    requireSupabaseMock.mockReturnValue(makeScanSupabase({}));
    getProjectContextMock.mockResolvedValue({
      financials: { outstandingBalance: 500, invoicedTotal: 12000 },
    });

    const proposed = await ProjectLifecycleService.detectClosableProjects("co-1");

    expect(proposed).toBe(0);
    expect(proposeActionMock).not.toHaveBeenCalled();
  });

  it("de-dupes against an already-pending close_project proposal", async () => {
    requireSupabaseMock.mockReturnValue(
      makeScanSupabase({ pendingCloseSourceIds: ["proj-1:close"] })
    );
    getProjectContextMock.mockResolvedValue({
      financials: { outstandingBalance: 0, invoicedTotal: 12000 },
    });

    const proposed = await ProjectLifecycleService.detectClosableProjects("co-1");

    expect(proposed).toBe(0);
    expect(proposeActionMock).not.toHaveBeenCalled();
  });

  it("does not close a recently updated project just because it has no task activity", async () => {
    requireSupabaseMock.mockReturnValue(
      makeScanSupabase({
        noRecentActivity: true,
        allTasks: [],
        projectUpdatedAt: new Date().toISOString(),
      })
    );
    getProjectContextMock.mockResolvedValue({
      financials: { outstandingBalance: 0, invoicedTotal: 12000 },
    });

    const proposed =
      await ProjectLifecycleService.detectClosableProjects("co-1");

    expect(proposed).toBe(0);
    expect(proposeActionMock).not.toHaveBeenCalled();
  });

  it("uses an old project update as the baseline for a zero-task project", async () => {
    requireSupabaseMock.mockReturnValue(
      makeScanSupabase({ noRecentActivity: true, allTasks: [] })
    );
    getProjectContextMock.mockResolvedValue({
      financials: { outstandingBalance: 0, invoicedTotal: 12000 },
    });

    const proposed =
      await ProjectLifecycleService.detectClosableProjects("co-1");

    expect(proposed).toBe(1);
    const params = proposeActionMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(params.actionType).toBe("close_project");
    expect(params.contextSummary).toBe(
      'Close "WJ ROYAL BAY" — completed 60 days ago, all tasks done, fully paid.'
    );
    const data = params.actionData as Record<string, unknown>;
    expect(data.days_since_completion).toBe(60);
    expect(data.completed_date).toBe(SIXTY_DAYS_AGO);
    expect(data.total_tasks).toBe(0);
  });
});
