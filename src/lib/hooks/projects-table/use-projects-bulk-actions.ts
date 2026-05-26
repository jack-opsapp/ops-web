import { useCallback, useMemo, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { queryKeys } from "@/lib/api/query-client";
import { dispatchProjectAssignment } from "@/lib/api/services/notification-dispatch";
import {
  ProjectTableMutationError,
  ProjectTableService,
} from "@/lib/api/services/project-table-service";
import { ProjectStatus } from "@/lib/types/models";
import {
  type ProjectTableBulkAction,
  type ProjectTableBulkOperation,
  type ProjectTableBulkResult,
  type ProjectTableBulkSuccess,
  type ProjectTableRow,
} from "@/lib/types/project-table";
import { serializeProjectTableStatus } from "@/lib/utils/project-table-formatters";
import type {
  ProjectTableBulkUndoEntry,
  ProjectTableBulkUndoPoint,
} from "@/lib/hooks/projects-table/use-cell-edit";

type InfiniteProjectTableRowsData = {
  pages: Array<{ rows?: ProjectTableRow[] }>;
};

type TeamTaskMap = Record<string, string[] | null> | Map<string, string[] | null>;

interface BulkDescriptor {
  row: ProjectTableRow;
  operation: ProjectTableBulkOperation;
  columnId: ProjectTableBulkUndoPoint["columnId"];
  beforeValue: unknown;
  afterValue: unknown;
  undoOperation?: ProjectTableBulkOperation;
}

interface PartialFailureState {
  action: ProjectTableBulkAction;
  result: ProjectTableBulkResult;
  failedDescriptors: BulkDescriptor[];
}

let bulkUndoEntryCounter = 0;

function createBulkUndoEntryId() {
  bulkUndoEntryCounter += 1;
  return `project-table-bulk-undo-${Date.now()}-${bulkUndoEntryCounter}`;
}

function isProjectTableRowsQuery(queryKey: readonly unknown[]) {
  return queryKey[0] === "projects" && queryKey[1] === "tableRows";
}

function updateRows(
  queryClient: QueryClient,
  projectIds: Set<string>,
  updater: (row: ProjectTableRow) => ProjectTableRow,
) {
  queryClient.setQueriesData<unknown>(
    {
      queryKey: queryKeys.projects.all,
      exact: false,
      predicate: (query) =>
        Array.isArray(query.queryKey) && isProjectTableRowsQuery(query.queryKey),
    },
    (oldData: unknown) => {
      if (!oldData || typeof oldData !== "object" || !("pages" in oldData)) return oldData;
      const data = oldData as InfiniteProjectTableRowsData;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          rows: page.rows?.map((row) => (projectIds.has(row.id) ? updater(row) : row)),
        })),
      };
    },
  );
}

function requireUpdateToken(row: ProjectTableRow) {
  if (!row.updatedAt) {
    throw new ProjectTableMutationError("Project update token is missing", "22023");
  }
  return row.updatedAt;
}

function teamTaskIdsForProject(taskIdsByProjectId: TeamTaskMap | undefined, projectId: string) {
  if (!taskIdsByProjectId) return null;
  if (taskIdsByProjectId instanceof Map) return taskIdsByProjectId.get(projectId) ?? null;
  return Object.prototype.hasOwnProperty.call(taskIdsByProjectId, projectId)
    ? taskIdsByProjectId[projectId] ?? null
    : null;
}

function requireAssignTaskIds(
  projectId: string,
  taskIds: string[] | null,
): asserts taskIds is string[] {
  if (!taskIds || taskIds.length === 0) {
    throw new ProjectTableMutationError(
      `Team assignment for ${projectId} requires at least one task`,
      "22023",
    );
  }
}

function successByProjectId(success: ProjectTableBulkSuccess[]) {
  return new Map(success.map((item) => [item.projectId, item]));
}

function applySuccessfulOperation(
  row: ProjectTableRow,
  descriptor: BulkDescriptor,
  updatedAt: string | null,
): ProjectTableRow {
  const operation = descriptor.operation;
  switch (operation.action) {
    case "status":
      return {
        ...row,
        status: operation.status,
        rawStatus: serializeProjectTableStatus(operation.status),
        updatedAt,
      };
    case "date":
      return operation.field === "start_date"
        ? { ...row, startDate: operation.value, updatedAt }
        : { ...row, endDate: operation.value, updatedAt };
    case "assign_team":
      return {
        ...row,
        teamMemberIds: Array.from(new Set([...row.teamMemberIds, operation.userId])),
        updatedAt,
      };
    case "remove_team":
      return {
        ...row,
        teamMemberIds:
          operation.taskIds === null
            ? row.teamMemberIds.filter((id) => id !== operation.userId)
            : row.teamMemberIds,
        updatedAt,
      };
  }
}

function buildUndoEntry(args: {
  action: ProjectTableBulkAction;
  descriptors: BulkDescriptor[];
  result: ProjectTableBulkResult;
}): ProjectTableBulkUndoEntry | null {
  const successMap = successByProjectId(args.result.success);
  const successfulDescriptors = args.descriptors.filter((descriptor) =>
    successMap.has(descriptor.operation.projectId),
  );

  if (successfulDescriptors.length === 0) return null;

  const before: ProjectTableBulkUndoPoint[] = successfulDescriptors.map((descriptor) => ({
    projectId: descriptor.operation.projectId,
    columnId: descriptor.columnId,
    value: descriptor.beforeValue,
    updatedAt: descriptor.row.updatedAt,
  }));

  const after = successfulDescriptors.map((descriptor) => ({
    projectId: descriptor.operation.projectId,
    value: descriptor.afterValue,
    updatedAt: successMap.get(descriptor.operation.projectId)?.updatedAt ?? null,
  }));

  const undoOperations = successfulDescriptors
    .map((descriptor) => {
      const success = successMap.get(descriptor.operation.projectId);
      if (!success?.updatedAt || !descriptor.undoOperation) return null;
      return {
        ...descriptor.undoOperation,
        expectedUpdatedAt: success.updatedAt,
      };
    })
    .filter((operation): operation is ProjectTableBulkOperation => operation !== null);

  return {
    id: createBulkUndoEntryId(),
    kind: "bulk",
    action: args.action,
    projectIds: successfulDescriptors.map((descriptor) => descriptor.operation.projectId),
    before,
    after,
    labelKey: `table.bulk.undo.${args.action}`,
    createdAt: Date.now(),
    columnId: before[0]?.columnId === "team" ? "status" : before[0]?.columnId ?? "status",
    projectTitle:
      successfulDescriptors.length === 1
        ? successfulDescriptors[0].row.title
        : `${successfulDescriptors.length} projects`,
    undoOperations,
  };
}

function failedDescriptorSet(result: ProjectTableBulkResult, descriptors: BulkDescriptor[]) {
  const failedProjectIds = new Set(result.failed.map((failure) => failure.projectId));
  return descriptors.filter((descriptor) =>
    failedProjectIds.has(descriptor.operation.projectId),
  );
}

function trackBulkApplied(args: {
  action: ProjectTableBulkAction;
  rowCount: number;
  partialFailureCount: number;
}) {
  analyticsService?.track?.("action", "project_table_bulk_applied", {
    action: args.action,
    row_count: args.rowCount,
    partial_failure_count: args.partialFailureCount,
  });
}

function dispatchSuccessfulBulkAssignments(
  descriptors: BulkDescriptor[],
  successfulProjectIds: Set<string>,
) {
  descriptors.forEach((descriptor) => {
    const operation = descriptor.operation;
    if (operation.action !== "assign_team") return;
    if (!successfulProjectIds.has(operation.projectId)) return;
    if (descriptor.row.teamMemberIds.includes(operation.userId)) return;

    dispatchProjectAssignment({
      projectId: operation.projectId,
      projectTitle: descriptor.row.title,
      newMemberIds: [operation.userId],
      companyId: descriptor.row.companyId,
    });
  });
}

export function useProjectsBulkActions({
  visibleRows,
  selectedIds,
  onClearSelection,
  recordBulkUndo,
}: {
  visibleRows: ProjectTableRow[];
  selectedIds: Set<string>;
  onClearSelection: () => void;
  recordBulkUndo?: (entry: ProjectTableBulkUndoEntry) => void;
}) {
  const queryClient = useQueryClient();
  const [partialFailureState, setPartialFailureState] =
    useState<PartialFailureState | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const targetRows = useMemo(
    () => visibleRows.filter((row) => selectedIds.has(row.id)),
    [selectedIds, visibleRows],
  );

  const runDescriptors = useCallback(
    async (action: ProjectTableBulkAction, descriptors: BulkDescriptor[]) => {
      if (descriptors.length === 0) {
        setPartialFailureState(null);
        return {
          success: [],
          failed: [],
          successCount: 0,
          failedCount: 0,
        } satisfies ProjectTableBulkResult;
      }

      setIsRunning(true);
      try {
        const result = await ProjectTableService.bulkUpdateProjects({
          operations: descriptors.map((descriptor) => descriptor.operation),
        });

        const successMap = successByProjectId(result.success);
        const successfulProjectIds = new Set(successMap.keys());

        trackBulkApplied({
          action,
          rowCount: descriptors.length,
          partialFailureCount: result.failedCount,
        });
        dispatchSuccessfulBulkAssignments(descriptors, successfulProjectIds);

        updateRows(queryClient, successfulProjectIds, (row) => {
          const descriptor = descriptors.find(
            (candidate) => candidate.operation.projectId === row.id,
          );
          if (!descriptor) return row;
          return applySuccessfulOperation(
            row,
            descriptor,
            successMap.get(row.id)?.updatedAt ?? row.updatedAt,
          );
        });

        const undoEntry = buildUndoEntry({ action, descriptors, result });
        if (undoEntry && recordBulkUndo) {
          recordBulkUndo(undoEntry);
        }

        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.all,
          exact: false,
          predicate: (query) =>
            Array.isArray(query.queryKey) && isProjectTableRowsQuery(query.queryKey),
        });

        if (result.failedCount > 0) {
          setPartialFailureState({
            action,
            result,
            failedDescriptors: failedDescriptorSet(result, descriptors),
          });
        } else {
          setPartialFailureState(null);
          onClearSelection();
        }

        return result;
      } finally {
        setIsRunning(false);
      }
    },
    [onClearSelection, queryClient, recordBulkUndo],
  );

  const updateStatus = useCallback(
    (status: ProjectStatus) =>
      runDescriptors(
        "status",
        targetRows.map((row) => ({
          row,
          operation: {
            action: "status",
            projectId: row.id,
            status,
            expectedUpdatedAt: requireUpdateToken(row),
          },
          columnId: "status",
          beforeValue: row.status,
          afterValue: status,
          undoOperation: {
            action: "status",
            projectId: row.id,
            status: row.status,
            expectedUpdatedAt: row.updatedAt ?? "",
          },
        })),
      ),
    [runDescriptors, targetRows],
  );

  const updateDate = useCallback(
    (field: "start_date" | "end_date", value: string | null) =>
      runDescriptors(
        "date",
        targetRows.map((row) => ({
          row,
          operation: {
            action: "date",
            projectId: row.id,
            field,
            value,
            expectedUpdatedAt: requireUpdateToken(row),
          },
          columnId: field,
          beforeValue: field === "start_date" ? row.startDate : row.endDate,
          afterValue: value,
          undoOperation: {
            action: "date",
            projectId: row.id,
            field,
            value: field === "start_date" ? row.startDate : row.endDate,
            expectedUpdatedAt: row.updatedAt ?? "",
          },
        })),
      ),
    [runDescriptors, targetRows],
  );

  const assignTeamMember = useCallback(
    ({ userId, taskIdsByProjectId }: { userId: string; taskIdsByProjectId: TeamTaskMap }) =>
      runDescriptors(
        "assign_team",
        targetRows.map((row) => {
          const taskIds = teamTaskIdsForProject(taskIdsByProjectId, row.id);
          requireAssignTaskIds(row.id, taskIds);
          return {
            row,
            operation: {
              action: "assign_team",
              projectId: row.id,
              userId,
              taskIds,
              expectedUpdatedAt: requireUpdateToken(row),
            },
            columnId: "team",
            beforeValue: row.teamMemberIds,
            afterValue: Array.from(new Set([...row.teamMemberIds, userId])),
            undoOperation: {
              action: "remove_team",
              projectId: row.id,
              userId,
              taskIds,
              expectedUpdatedAt: row.updatedAt ?? "",
            },
          };
        }),
      ),
    [runDescriptors, targetRows],
  );

  const removeTeamMember = useCallback(
    ({ userId, taskIdsByProjectId }: { userId: string; taskIdsByProjectId?: TeamTaskMap }) =>
      runDescriptors(
        "remove_team",
        targetRows.map((row) => {
          const taskIds = teamTaskIdsForProject(taskIdsByProjectId, row.id);
          return {
            row,
            operation: {
              action: "remove_team",
              projectId: row.id,
              userId,
              taskIds,
              expectedUpdatedAt: requireUpdateToken(row),
            },
            columnId: "team",
            beforeValue: row.teamMemberIds,
            afterValue:
              taskIds === null ? row.teamMemberIds.filter((id) => id !== userId) : row.teamMemberIds,
            undoOperation: taskIds
              ? {
                  action: "assign_team",
                  projectId: row.id,
                  userId,
                  taskIds,
                  expectedUpdatedAt: row.updatedAt ?? "",
                }
              : undefined,
          };
        }),
      ),
    [runDescriptors, targetRows],
  );

  const retryPartialFailure = useCallback(async () => {
    if (!partialFailureState) return null;
    return runDescriptors(partialFailureState.action, partialFailureState.failedDescriptors);
  }, [partialFailureState, runDescriptors]);

  const discardPartialFailure = useCallback(() => {
    setPartialFailureState(null);
    onClearSelection();
  }, [onClearSelection]);

  const partialFailure = useMemo(
    () =>
      partialFailureState
        ? {
            action: partialFailureState.action,
            successCount: partialFailureState.result.successCount,
            failedCount: partialFailureState.result.failedCount,
            failed: partialFailureState.result.failed,
            retry: retryPartialFailure,
            discard: discardPartialFailure,
          }
        : null,
    [discardPartialFailure, partialFailureState, retryPartialFailure],
  );

  return {
    targetRows,
    isRunning,
    partialFailure,
    updateStatus,
    updateDate,
    assignTeamMember,
    removeTeamMember,
  };
}
