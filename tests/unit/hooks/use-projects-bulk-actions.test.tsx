import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectTableService } from "@/lib/api/services/project-table-service";
import { useCellEdit } from "@/lib/hooks/projects-table/use-cell-edit";
import { useProjectsBulkActions } from "@/lib/hooks/projects-table/use-projects-bulk-actions";
import { useTableSelection } from "@/lib/hooks/projects-table/use-table-selection";
import { ProjectStatus } from "@/lib/types/models";
import type { ProjectTableRow } from "@/lib/types/project-table";

vi.mock("@/lib/api/services/project-table-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/services/project-table-service")>(
    "@/lib/api/services/project-table-service",
  );
  return {
    ...actual,
    ProjectTableService: {
      ...actual.ProjectTableService,
      bulkUpdateProjects: vi.fn(),
    },
  };
});

vi.mock("@/lib/analytics/analytics-service", () => ({
  analyticsService: {
    track: vi.fn(),
  },
}));

type InfiniteRowsData = {
  pages: Array<{ rows: ProjectTableRow[]; count: number; nextPage: number | null }>;
  pageParams: number[];
};

const rowA: ProjectTableRow = {
  id: "project-1",
  companyId: "company-1",
  title: "Deck rebuild",
  status: ProjectStatus.Accepted,
  rawStatus: "accepted",
  clientId: null,
  clientName: null,
  clientEmail: null,
  clientPhone: null,
  address: null,
  teamMemberIds: ["user-1"],
  startDate: "2026-05-20",
  endDate: null,
  duration: null,
  progress: null,
  nextTask: null,
  taskCount: 1,
  taskCompletedCount: 0,
  daysInStatus: null,
  estimateTotal: null,
  invoiceTotal: null,
  paidTotal: null,
  value: null,
  projectCost: null,
  margin: null,
  photoCount: 0,
  updatedAt: "2026-05-13T00:00:00Z",
  statusVersion: 1,
};

const rowB: ProjectTableRow = {
  ...rowA,
  id: "project-2",
  title: "Fence repair",
  status: ProjectStatus.Estimated,
  rawStatus: "estimated",
  teamMemberIds: [],
  updatedAt: "2026-05-13T00:10:00Z",
};

const hiddenRow: ProjectTableRow = {
  ...rowA,
  id: "project-hidden",
  title: "Hidden job",
  updatedAt: "2026-05-13T00:20:00Z",
};

const tableRowsKey = queryKeys.projects.tableRows({ companyId: "company-1", viewId: "view-1" });

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function seedTableRows(queryClient: QueryClient) {
  queryClient.setQueryData<InfiniteRowsData>(tableRowsKey, {
    pages: [{ rows: [rowA, rowB, hiddenRow], count: 3, nextPage: null }],
    pageParams: [0],
  });
}

describe("useProjectsBulkActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ProjectTableService.bulkUpdateProjects).mockResolvedValue({
      success: [],
      failed: [],
      successCount: 0,
      failedCount: 0,
    });
  });

  it("builds operations only from selected rows that are currently visible", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    const onClearSelection = vi.fn();
    vi.mocked(ProjectTableService.bulkUpdateProjects).mockResolvedValue({
      success: [
        {
          projectId: "project-1",
          action: "status",
          updatedAt: "2026-05-13T01:00:00Z",
          statusVersion: 2,
        },
      ],
      failed: [],
      successCount: 1,
      failedCount: 0,
    });

    const { result } = renderHook(
      () =>
        useProjectsBulkActions({
          visibleRows: [rowA, rowB],
          selectedIds: new Set(["project-1", "project-hidden"]),
          onClearSelection,
          recordBulkUndo: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.updateStatus(ProjectStatus.Completed);
    });

    expect(ProjectTableService.bulkUpdateProjects).toHaveBeenCalledWith({
      operations: [
        {
          action: "status",
          projectId: "project-1",
          status: ProjectStatus.Completed,
          expectedUpdatedAt: "2026-05-13T00:00:00Z",
          expectedStatusVersion: 1,
        },
      ],
    });
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(analyticsService.track).toHaveBeenCalledWith(
      "action",
      "project_table_bulk_applied",
      {
        action: "status",
        row_count: 1,
        partial_failure_count: 0,
      },
    );
    expect(
      queryClient.getQueryData<InfiniteRowsData>(tableRowsKey)?.pages[0]?.rows.find(
        (row) => row.id === "project-hidden",
      )?.status,
    ).toBe(ProjectStatus.Accepted);
  });

  it("records one bulk undo entry with successful visible rows only", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    const recordBulkUndo = vi.fn();
    vi.mocked(ProjectTableService.bulkUpdateProjects).mockResolvedValue({
      success: [
        {
          projectId: "project-1",
          action: "date",
          updatedAt: "2026-05-13T01:00:00Z",
        },
      ],
      failed: [
        {
          projectId: "project-2",
          action: "date",
          code: "P0001",
          message: "project conflict",
        },
      ],
      successCount: 1,
      failedCount: 1,
    });

    const { result } = renderHook(
      () =>
        useProjectsBulkActions({
          visibleRows: [rowA, rowB],
          selectedIds: new Set(["project-1", "project-2"]),
          onClearSelection: vi.fn(),
          recordBulkUndo,
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.updateDate("end_date", "2026-06-01");
    });

    expect(recordBulkUndo).toHaveBeenCalledTimes(1);
    expect(recordBulkUndo).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "bulk",
        action: "date",
        projectIds: ["project-1"],
        before: [
          {
            projectId: "project-1",
            columnId: "end_date",
            value: null,
            updatedAt: "2026-05-13T00:00:00Z",
            statusVersion: 1,
          },
        ],
        after: [
          {
            projectId: "project-1",
            value: "2026-06-01",
            updatedAt: "2026-05-13T01:00:00Z",
            statusVersion: null,
          },
        ],
      }),
    );
  });

  it("applies successful bulk assignments through the guarded service", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    vi.mocked(ProjectTableService.bulkUpdateProjects).mockResolvedValue({
      success: [
        {
          projectId: "project-1",
          action: "assign_team",
          updatedAt: "2026-05-13T01:00:00Z",
        },
        {
          projectId: "project-2",
          action: "assign_team",
          updatedAt: "2026-05-13T01:10:00Z",
        },
      ],
      failed: [],
      successCount: 2,
      failedCount: 0,
    });

    const { result } = renderHook(
      () =>
        useProjectsBulkActions({
          visibleRows: [rowA, rowB],
          selectedIds: new Set(["project-1", "project-2"]),
          onClearSelection: vi.fn(),
          recordBulkUndo: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.assignTeamMember({
        userId: "user-1",
        taskIdsByProjectId: new Map([
          ["project-1", ["task-1"]],
          ["project-2", ["task-2"]],
        ]),
      });
    });

    expect(analyticsService.track).toHaveBeenCalledWith(
      "action",
      "project_table_bulk_applied",
      {
        action: "assign_team",
        row_count: 2,
        partial_failure_count: 0,
      },
    );
  });

  it("exposes partial failure counts plus retry and discard callbacks", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    const onClearSelection = vi.fn();
    vi.mocked(ProjectTableService.bulkUpdateProjects)
      .mockResolvedValueOnce({
        success: [
          {
            projectId: "project-1",
            action: "status",
            updatedAt: "2026-05-13T01:00:00Z",
            statusVersion: 2,
          },
        ],
        failed: [
          {
            projectId: "project-2",
            action: "status",
            code: "P0001",
            message: "project conflict",
          },
        ],
        successCount: 1,
        failedCount: 1,
      })
      .mockResolvedValueOnce({
        success: [
          {
            projectId: "project-2",
            action: "status",
            updatedAt: "2026-05-13T01:10:00Z",
            statusVersion: 2,
          },
        ],
        failed: [],
        successCount: 1,
        failedCount: 0,
      });

    const { result } = renderHook(
      () =>
        useProjectsBulkActions({
          visibleRows: [rowA, rowB],
          selectedIds: new Set(["project-1", "project-2"]),
          onClearSelection,
          recordBulkUndo: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.updateStatus(ProjectStatus.InProgress);
    });

    expect(onClearSelection).not.toHaveBeenCalled();
    expect(result.current.partialFailure).toMatchObject({
      successCount: 1,
      failedCount: 1,
    });

    await act(async () => {
      await result.current.partialFailure?.retry();
    });

    expect(ProjectTableService.bulkUpdateProjects).toHaveBeenLastCalledWith({
      operations: [
        {
          action: "status",
          projectId: "project-2",
          status: ProjectStatus.InProgress,
          expectedUpdatedAt: "2026-05-13T00:10:00Z",
          expectedStatusVersion: 1,
        },
      ],
    });
    expect(result.current.partialFailure).toBeNull();
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("discard clears partial failure state and selection", async () => {
    const queryClient = makeQueryClient();
    const onClearSelection = vi.fn();
    vi.mocked(ProjectTableService.bulkUpdateProjects).mockResolvedValue({
      success: [],
      failed: [
        {
          projectId: "project-1",
          action: "status",
          code: "P0001",
          message: "project conflict",
        },
      ],
      successCount: 0,
      failedCount: 1,
    });

    const { result } = renderHook(
      () =>
        useProjectsBulkActions({
          visibleRows: [rowA],
          selectedIds: new Set(["project-1"]),
          onClearSelection,
          recordBulkUndo: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.updateStatus(ProjectStatus.Completed);
    });
    act(() => {
      result.current.partialFailure?.discard();
    });

    expect(result.current.partialFailure).toBeNull();
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("can record and undo bulk entries through useCellEdit", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    vi.mocked(ProjectTableService.bulkUpdateProjects)
      .mockResolvedValueOnce({
        success: [
          {
            projectId: "project-1",
            action: "status",
            updatedAt: "2026-05-13T01:00:00Z",
            statusVersion: 2,
          },
        ],
        failed: [],
        successCount: 1,
        failedCount: 0,
      })
      .mockResolvedValueOnce({
        success: [
          {
            projectId: "project-1",
            action: "status",
            updatedAt: "2026-05-13T02:00:00Z",
            statusVersion: 3,
          },
        ],
        failed: [],
        successCount: 1,
        failedCount: 0,
      });

    const { result } = renderHook(
      () => {
        const cellEdit = useCellEdit({ rows: [rowA], refetchRows: vi.fn() });
        const bulkActions = useProjectsBulkActions({
          visibleRows: [rowA],
          selectedIds: new Set(["project-1"]),
          onClearSelection: vi.fn(),
          recordBulkUndo: cellEdit.pushBulkUndo,
        });
        return { cellEdit, bulkActions };
      },
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.bulkActions.updateStatus(ProjectStatus.InProgress);
    });

    expect(result.current.cellEdit.latestUndo).toMatchObject({
      kind: "bulk",
      projectIds: ["project-1"],
    });

    await act(async () => {
      await result.current.cellEdit.undoLatest();
    });

    expect(ProjectTableService.bulkUpdateProjects).toHaveBeenLastCalledWith({
      operations: [
        {
          action: "status",
          projectId: "project-1",
          status: ProjectStatus.Accepted,
          expectedUpdatedAt: "2026-05-13T01:00:00Z",
          expectedStatusVersion: 2,
        },
      ],
    });
    expect(analyticsService.track).toHaveBeenCalledWith(
      "action",
      "project_table_undo_invoked",
      {
        action: "bulk",
      },
    );
    expect(result.current.cellEdit.undoStack).toHaveLength(0);
  });
});

describe("useTableSelection reset behavior", () => {
  it("clears selection when resetKey changes and can select all visible rows", () => {
    const { result, rerender } = renderHook(
      ({ visibleRowIds, resetKey }) => useTableSelection(visibleRowIds, resetKey),
      {
        initialProps: {
          visibleRowIds: ["project-1", "project-2"],
          resetKey: "view-a",
        },
      },
    );

    act(() => {
      result.current.selectAllVisible();
    });
    expect([...result.current.selectedIds].sort()).toEqual(["project-1", "project-2"]);

    rerender({
      visibleRowIds: ["project-1", "project-2"],
      resetKey: "view-b",
    });

    expect([...result.current.selectedIds]).toEqual([]);
  });
});
