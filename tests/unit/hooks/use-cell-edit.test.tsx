import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectTableService } from "@/lib/api/services/project-table-service";
import { useCellEdit } from "@/lib/hooks/projects-table/use-cell-edit";
import { ProjectStatus } from "@/lib/types/models";
import type { ProjectTableRow } from "@/lib/types/project-table";

vi.mock("@/lib/analytics/analytics-service", () => ({
  analyticsService: {
    track: vi.fn(),
  },
}));

type InfiniteRowsData = {
  pages: Array<{ rows: ProjectTableRow[]; count: number; nextPage: number | null }>;
  pageParams: number[];
};

const primaryKey = queryKeys.projects.tableRows({ companyId: "co-1", viewId: "view-1" });
const secondaryKey = queryKeys.projects.tableRows({ companyId: "co-1", viewId: "view-2" });

const baseRow: ProjectTableRow = {
  id: "p-1",
  companyId: "co-1",
  title: "Deck rebuild",
  status: ProjectStatus.Accepted,
  rawStatus: "accepted",
  clientId: null,
  clientName: null,
  clientEmail: null,
  clientPhone: null,
  address: "12 Site Rd",
  teamMemberIds: [],
  startDate: "2026-05-20",
  endDate: null,
  duration: null,
  progress: null,
  nextTask: null,
  taskCount: 0,
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
};

function makeRowsData(row: ProjectTableRow): InfiniteRowsData {
  return {
    pages: [{ rows: [row], count: 1, nextPage: null }],
    pageParams: [0],
  };
}

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

function seedTableRows(queryClient: QueryClient, row: ProjectTableRow = baseRow) {
  queryClient.setQueryData(primaryKey, makeRowsData(row));
  queryClient.setQueryData(secondaryKey, makeRowsData({ ...row, title: `${row.title} mirror` }));
  queryClient.setQueryData(queryKeys.projects.list("co-1"), {
    projects: [{ id: row.id, title: row.title }],
  });
}

function firstRow(queryClient: QueryClient, key = primaryKey) {
  return queryClient.getQueryData<InfiniteRowsData>(key)?.pages[0]?.rows[0] ?? null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useCellEdit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistically updates all project table row pages for a direct field edit", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    const save = deferred<{ updatedAt: string }>();
    vi.spyOn(ProjectTableService, "updateProjectField").mockReturnValue(save.promise);
    vi.spyOn(ProjectTableService, "changeProjectStatus").mockRejectedValue(new Error("wrong path"));

    const { result } = renderHook(
      () => useCellEdit({ rows: [baseRow], refetchRows: vi.fn() }),
      { wrapper: makeWrapper(queryClient) },
    );

    let commitPromise: Promise<void>;
    act(() => {
      commitPromise = result.current.commitEdit("p-1", "name", "New deck name");
    });

    expect(firstRow(queryClient, primaryKey)?.title).toBe("New deck name");
    expect(firstRow(queryClient, secondaryKey)?.title).toBe("New deck name");
    expect(queryClient.getQueryData<{ projects: Array<{ title: string }> }>(
      queryKeys.projects.list("co-1"),
    )?.projects[0]?.title).toBe("Deck rebuild");
    expect(result.current.saveStates.get("p-1:name")).toBe("saving");

    await act(async () => {
      save.resolve({ updatedAt: "2026-05-13T01:00:00Z" });
      await commitPromise;
    });

    expect(ProjectTableService.updateProjectField).toHaveBeenCalledWith({
      projectId: "p-1",
      columnId: "name",
      value: "New deck name",
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    });
    expect(firstRow(queryClient, primaryKey)?.updatedAt).toBe("2026-05-13T01:00:00Z");
    expect(result.current.saveStates.get("p-1:name")).toBe("saved");
    expect(result.current.latestUndo).toMatchObject({
      rowId: "p-1",
      columnId: "name",
      before: "Deck rebuild",
      after: "New deck name",
    });
  });

  it("records a max 50-entry undo stack and drops the oldest entry on overflow", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    vi.spyOn(ProjectTableService, "updateProjectField").mockImplementation(async () => ({
      updatedAt: `2026-05-13T01:00:${String(
        vi.mocked(ProjectTableService.updateProjectField).mock.calls.length,
      ).padStart(2, "0")}Z`,
    }));

    const { result } = renderHook(
      () => useCellEdit({ rows: [baseRow], refetchRows: vi.fn() }),
      { wrapper: makeWrapper(queryClient) },
    );

    for (let index = 0; index < 51; index += 1) {
      await act(async () => {
        await result.current.commitEdit("p-1", "name", `Name ${index}`);
      });
    }

    expect(result.current.undoStack).toHaveLength(50);
    expect(result.current.undoStack[0]).toMatchObject({ after: "Name 1" });
    expect(result.current.latestUndo).toMatchObject({ after: "Name 50" });
  });

  it("maps P0001 into a conflict object without swallowing the user's attempted value", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    const refetchRows = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ProjectTableService, "updateProjectField").mockRejectedValue(
      Object.assign(new Error("Project conflict"), { code: "P0001" }),
    );

    const { result } = renderHook(
      () => useCellEdit({ rows: [baseRow], refetchRows }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.commitEdit("p-1", "address", "98 Changed Ave");
    });

    expect(refetchRows).toHaveBeenCalledTimes(1);
    expect(result.current.conflict).toEqual({
      rowId: "p-1",
      columnId: "address",
      projectTitle: "Deck rebuild",
      attemptedValue: "98 Changed Ave",
      previousValue: "12 Site Rd",
    });
    expect(result.current.saveStates.get("p-1:address")).toBe("conflict");
  });

  it("undoes the newest saved edit through the same mutation path", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    vi.spyOn(ProjectTableService, "updateProjectField")
      .mockResolvedValueOnce({ updatedAt: "2026-05-13T01:00:00Z" })
      .mockResolvedValueOnce({ updatedAt: "2026-05-13T02:00:00Z" });

    const { result } = renderHook(
      () => useCellEdit({ rows: [baseRow], refetchRows: vi.fn() }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.commitEdit("p-1", "name", "New deck name");
    });
    await act(async () => {
      await result.current.undoLatest();
    });

    expect(ProjectTableService.updateProjectField).toHaveBeenLastCalledWith({
      projectId: "p-1",
      columnId: "name",
      value: "Deck rebuild",
      expectedUpdatedAt: "2026-05-13T01:00:00Z",
    });
    expect(firstRow(queryClient)?.title).toBe("Deck rebuild");
    expect(firstRow(queryClient)?.updatedAt).toBe("2026-05-13T02:00:00Z");
    expect(result.current.undoStack).toHaveLength(0);
  });

  it("uses the newest cached row token when table views contain the same project", async () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(
      primaryKey,
      makeRowsData({ ...baseRow, title: "Stale deck", updatedAt: "2026-05-13T01:00:00Z" }),
    );
    queryClient.setQueryData(
      secondaryKey,
      makeRowsData({ ...baseRow, title: "Fresh deck", updatedAt: "2026-05-13T02:00:00Z" }),
    );
    vi.spyOn(ProjectTableService, "updateProjectField").mockResolvedValue({
      updatedAt: "2026-05-13T03:00:00Z",
    });

    const { result } = renderHook(
      () =>
        useCellEdit({
          rows: [
            { ...baseRow, title: "Stale deck", updatedAt: "2026-05-13T01:00:00Z" },
          ],
          refetchRows: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.commitEdit("p-1", "name", "Final deck");
    });

    expect(ProjectTableService.updateProjectField).toHaveBeenCalledWith({
      projectId: "p-1",
      columnId: "name",
      value: "Final deck",
      expectedUpdatedAt: "2026-05-13T02:00:00Z",
    });
  });

  it("hides the undo toast without removing the command-z undo entry", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    vi.spyOn(ProjectTableService, "updateProjectField")
      .mockResolvedValueOnce({ updatedAt: "2026-05-13T01:00:00Z" })
      .mockResolvedValueOnce({ updatedAt: "2026-05-13T02:00:00Z" });

    const { result } = renderHook(
      () => useCellEdit({ rows: [baseRow], refetchRows: vi.fn() }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.commitEdit("p-1", "name", "New deck name");
    });
    expect(result.current.latestUndo).toMatchObject({ after: "New deck name" });

    act(() => {
      result.current.clearLatestUndo();
    });

    expect(result.current.latestUndo).toBeNull();
    expect(result.current.undoStack).toHaveLength(1);

    await act(async () => {
      await result.current.undoLatest();
    });

    expect(ProjectTableService.updateProjectField).toHaveBeenLastCalledWith({
      projectId: "p-1",
      columnId: "name",
      value: "Deck rebuild",
      expectedUpdatedAt: "2026-05-13T01:00:00Z",
    });
    expect(firstRow(queryClient)?.title).toBe("Deck rebuild");
    expect(result.current.undoStack).toHaveLength(0);
  });

  it("routes status saves through the status RPC mutation", async () => {
    const queryClient = makeQueryClient();
    seedTableRows(queryClient);
    vi.spyOn(ProjectTableService, "updateProjectField").mockRejectedValue(new Error("wrong path"));
    vi.spyOn(ProjectTableService, "changeProjectStatus").mockResolvedValue({
      updatedAt: "2026-05-13T01:00:00Z",
    });

    const { result } = renderHook(
      () => useCellEdit({ rows: [baseRow], refetchRows: vi.fn() }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.commitEdit("p-1", "status", ProjectStatus.InProgress);
    });

    expect(ProjectTableService.changeProjectStatus).toHaveBeenCalledWith({
      projectId: "p-1",
      status: ProjectStatus.InProgress,
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    });
    expect(firstRow(queryClient)?.status).toBe(ProjectStatus.InProgress);
    expect(ProjectTableService.updateProjectField).not.toHaveBeenCalled();
  });

  it("tracks bulk undo invocation when the latest undo entry is bulk", async () => {
    const queryClient = makeQueryClient();
    const changedRow = {
      ...baseRow,
      status: ProjectStatus.InProgress,
      rawStatus: "in_progress",
    };
    seedTableRows(queryClient, changedRow);
    vi.spyOn(ProjectTableService, "bulkUpdateProjects").mockResolvedValue({
      success: [
        {
          projectId: "p-1",
          action: "status",
          updatedAt: "2026-05-13T02:00:00Z",
        },
      ],
      failed: [],
      successCount: 1,
      failedCount: 0,
    });

    const { result } = renderHook(
      () =>
        useCellEdit({
          rows: [changedRow],
          refetchRows: vi.fn(),
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    act(() => {
      result.current.pushBulkUndo({
        id: "bulk-undo-1",
        kind: "bulk",
        action: "status",
        projectIds: ["p-1"],
        before: [
          {
            projectId: "p-1",
            columnId: "status",
            value: ProjectStatus.Accepted,
            updatedAt: "2026-05-13T00:00:00Z",
          },
        ],
        after: [
          {
            projectId: "p-1",
            value: ProjectStatus.InProgress,
            updatedAt: "2026-05-13T01:00:00Z",
          },
        ],
        labelKey: "table.bulk.undo.status",
        createdAt: Date.now(),
        columnId: "status",
        projectTitle: "Deck rebuild",
        undoOperations: [
          {
            action: "status",
            projectId: "p-1",
            status: ProjectStatus.Accepted,
            expectedUpdatedAt: "2026-05-13T01:00:00Z",
            expectedStatusVersion: 1,
          },
        ],
      });
    });

    await act(async () => {
      await result.current.undoLatest();
    });

    expect(analyticsService.track).toHaveBeenCalledWith(
      "action",
      "project_table_undo_invoked",
      {
        action: "bulk",
      },
    );
    expect(ProjectTableService.bulkUpdateProjects).toHaveBeenCalledWith({
      operations: [
        {
          action: "status",
          projectId: "p-1",
          status: ProjectStatus.Accepted,
          expectedUpdatedAt: "2026-05-13T01:00:00Z",
          expectedStatusVersion: 1,
        },
      ],
    });
  });

  it("refetches and marks the cell error when updatedAt is missing", async () => {
    const queryClient = makeQueryClient();
    const rowWithoutToken = { ...baseRow, updatedAt: null };
    seedTableRows(queryClient, rowWithoutToken);
    const refetchRows = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ProjectTableService, "updateProjectField").mockResolvedValue({
      updatedAt: "2026-05-13T01:00:00Z",
    });

    const { result } = renderHook(
      () => useCellEdit({ rows: [rowWithoutToken], refetchRows }),
      { wrapper: makeWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.commitEdit("p-1", "name", "Should not save");
    });

    await waitFor(() => expect(refetchRows).toHaveBeenCalledTimes(1));
    expect(ProjectTableService.updateProjectField).not.toHaveBeenCalled();
    expect(result.current.saveStates.get("p-1:name")).toBe("error");
    expect(firstRow(queryClient)?.title).toBe("Deck rebuild");
  });
});
