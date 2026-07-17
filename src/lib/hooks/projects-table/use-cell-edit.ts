import { useCallback, useMemo, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { analyticsService } from "@/lib/analytics/analytics-service";
import { queryKeys } from "@/lib/api/query-client";
import { ProjectTableService } from "@/lib/api/services/project-table-service";
import { ProjectStatus } from "@/lib/types/models";
import {
  getProjectTableEditValue,
  type ProjectTableClientEditValue,
  type ProjectTableBulkOperation,
  type ProjectTableDirectEditColumnId,
  type ProjectTableEditableColumnId,
  type ProjectTableEditValue,
  type ProjectTableRow,
} from "@/lib/types/project-table";
import { serializeProjectTableStatus } from "@/lib/utils/project-table-formatters";

export type ProjectTableSaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export interface ProjectTableCellKey {
  rowId: string;
  columnId: ProjectTableEditableColumnId;
}

export interface ProjectTableCellUndoEntry {
  id: string;
  rowId: string;
  columnId: ProjectTableEditableColumnId;
  projectTitle: string;
  before: ProjectTableEditValue;
  after: ProjectTableEditValue;
  expectedUpdatedAt: string;
  savedUpdatedAt: string;
}

export interface ProjectTableBulkUndoPoint {
  projectId: string;
  columnId: "status" | "start_date" | "end_date" | "team";
  value: unknown;
  updatedAt: string | null;
  statusVersion?: number | null;
}

export interface ProjectTableBulkUndoAfterPoint {
  projectId: string;
  value: unknown;
  updatedAt: string | null;
  statusVersion?: number | null;
}

export interface ProjectTableBulkUndoEntry {
  id: string;
  kind: "bulk";
  action: "status" | "date" | "assign_team" | "remove_team";
  projectIds: string[];
  before: ProjectTableBulkUndoPoint[];
  after: ProjectTableBulkUndoAfterPoint[];
  labelKey: string;
  createdAt: number;
  columnId: ProjectTableEditableColumnId;
  projectTitle: string;
  undoOperations?: ProjectTableBulkOperation[];
}

export type ProjectTableUndoEntry = ProjectTableCellUndoEntry | ProjectTableBulkUndoEntry;

export interface ProjectTableConflict {
  rowId: string;
  columnId: ProjectTableEditableColumnId;
  projectTitle: string;
  attemptedValue: ProjectTableEditValue;
  previousValue: ProjectTableEditValue;
}

type ProjectTableMutationCode = "P0001" | "42501" | "22023" | "NETWORK" | "UNKNOWN";

type InfiniteProjectTableRowsData = {
  pages: Array<{ rows?: ProjectTableRow[] }>;
};

type CommitEdit = {
  (
    rowId: string,
    columnId: ProjectTableEditableColumnId,
    value: ProjectTableEditValue,
  ): Promise<void>;
  (
    row: ProjectTableRow,
    columnId: ProjectTableEditableColumnId,
    value: ProjectTableEditValue,
  ): Promise<void>;
  (cellKey: ProjectTableCellKey, value: ProjectTableEditValue): Promise<void>;
};

const TABLE_ROWS_PREFIX = ["projects", "tableRows"] as const;
const UNDO_STACK_LIMIT = 50;
let undoEntryCounter = 0;

function cellStateKey(rowId: string, columnId: ProjectTableEditableColumnId) {
  return `${rowId}:${columnId}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function queryKeyPartEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function queryKeyStartsWith(queryKey: readonly unknown[], prefix: readonly unknown[]) {
  if (prefix.length > queryKey.length) return false;
  return prefix.every((part, index) => queryKeyPartEquals(queryKey[index], part));
}

function tableRowsPrefix(prefix?: readonly unknown[]) {
  if (
    prefix &&
    queryKeyStartsWith(prefix, TABLE_ROWS_PREFIX) &&
    prefix.length >= TABLE_ROWS_PREFIX.length
  ) {
    return prefix;
  }
  return TABLE_ROWS_PREFIX;
}

function isProjectTableRowsQuery(queryKey: readonly unknown[], prefix?: readonly unknown[]) {
  const safePrefix = tableRowsPrefix(prefix);
  return (
    queryKeyStartsWith(queryKey, TABLE_ROWS_PREFIX) &&
    queryKeyStartsWith(queryKey, safePrefix)
  );
}

function updateRowsInCache(
  queryClient: QueryClient,
  updater: (row: ProjectTableRow) => ProjectTableRow,
  tableQueryKeyPrefix?: readonly unknown[],
) {
  queryClient.setQueriesData<unknown>(
    {
      queryKey: queryKeys.projects.all,
      exact: false,
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        isProjectTableRowsQuery(query.queryKey, tableQueryKeyPrefix),
    },
    (oldData: unknown) => {
      if (!oldData || typeof oldData !== "object" || !("pages" in oldData)) return oldData;
      const data = oldData as InfiniteProjectTableRowsData;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          rows: Array.isArray(page.rows) ? page.rows.map(updater) : page.rows,
        })),
      };
    },
  );
}

function findRowInTableCache(
  queryClient: QueryClient,
  rowId: string,
  tableQueryKeyPrefix?: readonly unknown[],
) {
  const cachedQueries = queryClient.getQueriesData<unknown>({
    queryKey: queryKeys.projects.all,
    exact: false,
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      isProjectTableRowsQuery(query.queryKey, tableQueryKeyPrefix),
  });

  let newestRow: ProjectTableRow | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;

  for (const [, data] of cachedQueries) {
    if (!data || typeof data !== "object" || !("pages" in data)) continue;
    const rowsData = data as InfiniteProjectTableRowsData;
    for (const page of rowsData.pages) {
      const row = page.rows?.find((candidate) => candidate.id === rowId);
      if (!row) continue;
      const rowTime = row.updatedAt ? Date.parse(row.updatedAt) : Number.NEGATIVE_INFINITY;
      if (!newestRow || rowTime > newestTime) {
        newestRow = row;
        newestTime = rowTime;
      }
    }
  }

  return newestRow;
}

function isDirectEditColumn(
  columnId: ProjectTableEditableColumnId,
): columnId is ProjectTableDirectEditColumnId {
  return columnId !== "status";
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return Object.values(ProjectStatus).includes(value as ProjectStatus);
}

function isClientEditValue(value: unknown): value is ProjectTableClientEditValue {
  return value !== null && typeof value === "object" && "clientId" in value;
}

function clientIdFromEditValue(value: ProjectTableEditValue): string | null {
  if (value == null) return null;
  if (isClientEditValue(value)) return value.clientId;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function clientNameFromEditValue(value: ProjectTableEditValue): string | null {
  if (!isClientEditValue(value)) return null;
  return value.clientName;
}

function applyEditValue(
  row: ProjectTableRow,
  columnId: ProjectTableEditableColumnId,
  value: ProjectTableEditValue,
  updatedAt: string | null = row.updatedAt,
): ProjectTableRow {
  switch (columnId) {
    case "name":
      return { ...row, title: value == null ? "" : String(value), updatedAt };
    case "client":
      return {
        ...row,
        clientId: clientIdFromEditValue(value),
        clientName: clientNameFromEditValue(value),
        updatedAt,
      };
    case "address":
      return { ...row, address: value == null ? null : String(value), updatedAt };
    case "start_date":
      return { ...row, startDate: value == null ? null : String(value), updatedAt };
    case "end_date":
      return { ...row, endDate: value == null ? null : String(value), updatedAt };
    case "status":
      return isProjectStatus(value)
        ? { ...row, status: value, rawStatus: serializeProjectTableStatus(value), updatedAt }
        : row;
  }
}

function applyBulkUndoValue(
  row: ProjectTableRow,
  point: ProjectTableBulkUndoPoint,
  updatedAt: string | null = row.updatedAt,
): ProjectTableRow {
  switch (point.columnId) {
    case "status":
      return isProjectStatus(point.value)
        ? {
            ...row,
            status: point.value,
            rawStatus: serializeProjectTableStatus(point.value),
            updatedAt,
          }
        : row;
    case "start_date":
      return { ...row, startDate: point.value == null ? null : String(point.value), updatedAt };
    case "end_date":
      return { ...row, endDate: point.value == null ? null : String(point.value), updatedAt };
    case "team":
      return Array.isArray(point.value)
        ? {
            ...row,
            teamMemberIds: point.value.filter((id): id is string => typeof id === "string"),
            updatedAt,
          }
        : row;
  }
}

function valuesEqual(left: ProjectTableEditValue, right: ProjectTableEditValue) {
  if (isClientEditValue(left) || isClientEditValue(right)) {
    return clientIdFromEditValue(left) === clientIdFromEditValue(right);
  }
  return left === right;
}

function mutationCode(error: unknown): ProjectTableMutationCode | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return code === "P0001" ||
    code === "42501" ||
    code === "22023" ||
    code === "NETWORK" ||
    code === "UNKNOWN"
    ? code
    : null;
}

function isRetryableMutationError(error: unknown) {
  const code = mutationCode(error);
  return code === "NETWORK" || code === "UNKNOWN";
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function retryOnceForTransient<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableMutationError(error)) throw error;
    await wait(2_000);
    return operation();
  }
}

function createUndoEntryId() {
  undoEntryCounter += 1;
  return `project-table-undo-${Date.now()}-${undoEntryCounter}`;
}

function pushUndoEntry(
  entries: ProjectTableUndoEntry[],
  entry: ProjectTableUndoEntry,
) {
  return [...entries, entry].slice(-UNDO_STACK_LIMIT);
}

function isBulkUndoEntry(entry: ProjectTableUndoEntry): entry is ProjectTableBulkUndoEntry {
  return "kind" in entry && entry.kind === "bulk";
}

function afterPointForProject(entry: ProjectTableBulkUndoEntry, projectId: string) {
  return entry.after.find((point) => point.projectId === projectId) ?? null;
}

function buildBulkUndoOperations(
  entry: ProjectTableBulkUndoEntry,
  findLatestRow: (rowId: string) => ProjectTableRow | null,
): ProjectTableBulkOperation[] {
  if (entry.undoOperations?.length) return entry.undoOperations;

  return entry.before
    .map((point): ProjectTableBulkOperation | null => {
      const expectedUpdatedAt =
        afterPointForProject(entry, point.projectId)?.updatedAt ??
        findLatestRow(point.projectId)?.updatedAt ??
        null;
      if (!expectedUpdatedAt) return null;

      if (point.columnId === "status" && isProjectStatus(point.value)) {
        const statusVersion =
          afterPointForProject(entry, point.projectId)?.statusVersion ??
          findLatestRow(point.projectId)?.statusVersion;
        if (
          typeof statusVersion !== "number" ||
          !Number.isSafeInteger(statusVersion) ||
          statusVersion < 0
        ) {
          return null;
        }
        return {
          action: "status",
          projectId: point.projectId,
          status: point.value,
          expectedUpdatedAt,
          expectedStatusVersion: statusVersion,
        };
      }

      if (point.columnId === "start_date" || point.columnId === "end_date") {
        return {
          action: "date",
          projectId: point.projectId,
          field: point.columnId,
          value: point.value == null ? null : String(point.value),
          expectedUpdatedAt,
        };
      }

      return null;
    })
    .filter((operation): operation is ProjectTableBulkOperation => operation !== null);
}

export function useCellEdit(args: {
  rows: ProjectTableRow[];
  tableQueryKeyPrefix?: readonly unknown[];
  refetchRows: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [saveStates, setSaveStates] = useState<Map<string, ProjectTableSaveState>>(
    () => new Map(),
  );
  const [undoStack, setUndoStack] = useState<ProjectTableUndoEntry[]>([]);
  const [visibleUndoId, setVisibleUndoId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ProjectTableConflict | null>(null);

  const setCellSaveState = useCallback(
    (rowId: string, columnId: ProjectTableEditableColumnId, state: ProjectTableSaveState) => {
      setSaveStates((current) => {
        const next = new Map(current);
        if (state === "idle") {
          next.delete(cellStateKey(rowId, columnId));
        } else {
          next.set(cellStateKey(rowId, columnId), state);
        }
        return next;
      });
    },
    [],
  );

  const findLatestRow = useCallback(
    (rowId: string, rowOverride?: ProjectTableRow | null) =>
      rowOverride ??
      findRowInTableCache(queryClient, rowId, args.tableQueryKeyPrefix) ??
      args.rows.find((row) => row.id === rowId) ??
      null,
    [args.rows, args.tableQueryKeyPrefix, queryClient],
  );

  const refetchRowsSafely = useCallback(async () => {
    try {
      await args.refetchRows();
    } catch {
      // The cell state still carries the failure path; refetch errors should not hide conflicts.
    }
  }, [args]);

  const runSave = useCallback(
    async ({
      rowId,
      columnId,
      value,
      rowOverride,
      recordUndo,
      consumeUndoEntryId,
    }: {
      rowId: string;
      columnId: ProjectTableEditableColumnId;
      value: ProjectTableEditValue;
      rowOverride?: ProjectTableRow | null;
      recordUndo: boolean;
      consumeUndoEntryId?: string;
    }) => {
      const row = findLatestRow(rowId, rowOverride);
      if (!row) {
        setCellSaveState(rowId, columnId, "error");
        return;
      }

      const previousValue = getProjectTableEditValue(row, columnId);
      if (valuesEqual(previousValue, value)) {
        setCellSaveState(rowId, columnId, "idle");
        if (consumeUndoEntryId) {
          setUndoStack((current) => current.filter((entry) => entry.id !== consumeUndoEntryId));
        }
        return;
      }

      if (!row.updatedAt) {
        setCellSaveState(rowId, columnId, "saving");
        await refetchRowsSafely();
        setCellSaveState(rowId, columnId, "error");
        return;
      }

      const expectedUpdatedAt = row.updatedAt;
      setCellSaveState(rowId, columnId, "saving");
      updateRowsInCache(
        queryClient,
        (cachedRow) =>
          cachedRow.id === rowId ? applyEditValue(cachedRow, columnId, value) : cachedRow,
        args.tableQueryKeyPrefix,
      );

      try {
        const saveResult = await retryOnceForTransient(() => {
          if (columnId === "status") {
            if (!isProjectStatus(value)) {
              return Promise.reject(
                Object.assign(new Error("Project status is required"), { code: "22023" }),
              );
            }
            return ProjectTableService.changeProjectStatus({
              projectId: rowId,
              status: value,
              expectedUpdatedAt,
            });
          }

          if (!isDirectEditColumn(columnId)) {
            return Promise.reject(
              Object.assign(new Error("Project edit field is unsupported"), { code: "22023" }),
            );
          }

          return ProjectTableService.updateProjectField({
            projectId: rowId,
            columnId,
            value,
            expectedUpdatedAt,
          });
        });

        updateRowsInCache(
          queryClient,
          (cachedRow) =>
            cachedRow.id === rowId
              ? applyEditValue(cachedRow, columnId, value, saveResult.updatedAt)
              : cachedRow,
          args.tableQueryKeyPrefix,
        );

        setCellSaveState(rowId, columnId, "saved");
        setConflict((current) =>
          current?.rowId === rowId && current.columnId === columnId ? null : current,
        );

        if (recordUndo) {
          const undoEntry = {
            id: createUndoEntryId(),
            rowId,
            columnId,
            projectTitle: row.title,
            before: previousValue,
            after: value,
            expectedUpdatedAt,
            savedUpdatedAt: saveResult.updatedAt,
          };
          setUndoStack((current) => pushUndoEntry(current, undoEntry));
          setVisibleUndoId(undoEntry.id);
        }

        if (consumeUndoEntryId) {
          setUndoStack((current) => current.filter((entry) => entry.id !== consumeUndoEntryId));
        }
      } catch (error) {
        updateRowsInCache(
          queryClient,
          (cachedRow) =>
            cachedRow.id === rowId
              ? applyEditValue(cachedRow, columnId, previousValue, expectedUpdatedAt)
              : cachedRow,
          args.tableQueryKeyPrefix,
        );

        if (mutationCode(error) === "P0001") {
          await refetchRowsSafely();
          setConflict({
            rowId,
            columnId,
            projectTitle: row.title,
            attemptedValue: value,
            previousValue,
          });
          setCellSaveState(rowId, columnId, "conflict");
          return;
        }

        setCellSaveState(rowId, columnId, "error");
      }
    },
    [
      args.tableQueryKeyPrefix,
      findLatestRow,
      queryClient,
      refetchRowsSafely,
      setCellSaveState,
    ],
  );

  const commitEdit = useCallback(
    (async (
      target: string | ProjectTableRow | ProjectTableCellKey,
      columnOrValue: ProjectTableEditableColumnId | ProjectTableEditValue,
      maybeValue?: ProjectTableEditValue,
    ) => {
      if (typeof target === "string") {
        await runSave({
          rowId: target,
          columnId: columnOrValue as ProjectTableEditableColumnId,
          value: maybeValue ?? null,
          recordUndo: true,
        });
        return;
      }

      if ("rowId" in target) {
        await runSave({
          rowId: target.rowId,
          columnId: target.columnId,
          value: columnOrValue as ProjectTableEditValue,
          recordUndo: true,
        });
        return;
      }

      await runSave({
        rowId: target.id,
        columnId: columnOrValue as ProjectTableEditableColumnId,
        value: maybeValue ?? null,
        rowOverride: target,
        recordUndo: true,
      });
    }) as CommitEdit,
    [runSave],
  );

  const pushBulkUndo = useCallback((entry: ProjectTableBulkUndoEntry) => {
    setUndoStack((current) => pushUndoEntry(current, entry));
    setVisibleUndoId(entry.id);
  }, []);

  const undoBulk = useCallback(
    async (entry: ProjectTableBulkUndoEntry) => {
      const operations = buildBulkUndoOperations(entry, (rowId) => findLatestRow(rowId));
      if (operations.length === 0) return;

      analyticsService?.track?.("action", "project_table_undo_invoked", {
        action: "bulk",
      });

      const result = await ProjectTableService.bulkUpdateProjects({ operations });
      const successfulIds = new Set(result.success.map((success) => success.projectId));

      updateRowsInCache(
        queryClient,
        (cachedRow) => {
          if (!successfulIds.has(cachedRow.id)) return cachedRow;
          const beforePoint = entry.before.find((point) => point.projectId === cachedRow.id);
          if (!beforePoint) return cachedRow;
          const updatedAt =
            result.success.find((success) => success.projectId === cachedRow.id)?.updatedAt ??
            cachedRow.updatedAt;
          return applyBulkUndoValue(cachedRow, beforePoint, updatedAt);
        },
        args.tableQueryKeyPrefix,
      );

      if (result.failedCount === 0) {
        setUndoStack((current) => current.filter((candidate) => candidate.id !== entry.id));
        setVisibleUndoId((current) => (current === entry.id ? null : current));
      }
    },
    [args.tableQueryKeyPrefix, findLatestRow, queryClient],
  );

  const undoLatest = useCallback(async () => {
    const entry = undoStack.at(-1);
    if (!entry) return;

    if (isBulkUndoEntry(entry)) {
      await undoBulk(entry);
      return;
    }

    const latestRow = findLatestRow(entry.rowId);
    await runSave({
      rowId: entry.rowId,
      columnId: entry.columnId,
      value: entry.before,
      rowOverride: latestRow,
      recordUndo: false,
      consumeUndoEntryId: entry.id,
    });
  }, [findLatestRow, runSave, undoBulk, undoStack]);

  const clearLatestUndo = useCallback(() => {
    setVisibleUndoId(null);
  }, []);

  const resolveConflictUseMine = useCallback(async () => {
    if (!conflict) return;
    await refetchRowsSafely();
    const latestRow = findLatestRow(conflict.rowId);
    setConflict(null);
    await runSave({
      rowId: conflict.rowId,
      columnId: conflict.columnId,
      value: conflict.attemptedValue,
      rowOverride: latestRow,
      recordUndo: true,
    });
  }, [conflict, findLatestRow, refetchRowsSafely, runSave]);

  const resolveConflictUseCurrent = useCallback(async () => {
    if (!conflict) return;
    await refetchRowsSafely();
    setCellSaveState(conflict.rowId, conflict.columnId, "idle");
    setConflict(null);
  }, [conflict, refetchRowsSafely, setCellSaveState]);

  const cancelConflict = useCallback(() => {
    if (conflict) {
      setCellSaveState(conflict.rowId, conflict.columnId, "idle");
    }
    setConflict(null);
  }, [conflict, setCellSaveState]);

  const latestUndo = visibleUndoId
    ? undoStack.find((entry) => entry.id === visibleUndoId) ?? null
    : null;
  const isSaving = useMemo(
    () => Array.from(saveStates.values()).some((state) => state === "saving"),
    [saveStates],
  );

  return {
    commitEdit,
    undoLatest,
    undoBulk,
    pushBulkUndo,
    saveStates,
    undoStack,
    latestUndo,
    clearLatestUndo,
    conflict,
    resolveConflictUseMine,
    resolveConflictUseCurrent,
    cancelConflict,
    isSaving,
  };
}
