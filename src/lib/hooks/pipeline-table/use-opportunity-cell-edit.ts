/**
 * OPS Web — Pipeline Table inline cell-edit engine.
 *
 * Adapts the proven projects-table `useCellEdit` pattern
 * (`@/lib/hooks/projects-table/use-cell-edit.ts`) to opportunities, with one
 * deliberate delta:
 *
 *   Last-writer-wins (no `updated_at`-guarded RPC for opportunities); optimistic
 *   update + undo, no conflict resolution.
 *
 * The projects table guards every edit with an `updated_at`-stamped RPC and a
 * conflict-resolution overlay. Opportunities have no such guarded write path —
 * the only mutation surface is `OpportunityService.updateOpportunity`, a plain
 * column update. So this hook drops the `"conflict"` save-state entirely and
 * accepts last-writer-wins semantics, leaning on the undo stack to recover from
 * an unintended overwrite.
 *
 * Optimistic caching is NOT re-implemented here: `useUpdateOpportunity()`
 * already cancels in-flight queries, snapshots, optimistically patches the
 * `opportunities` list + detail caches, rolls back on error, and invalidates on
 * settle. This hook composes on top of it, adding per-cell save-state tracking
 * and a visible-undo stack.
 *
 * Editable columns are SAFE fields only: `value` (estimatedValue), `client`
 * (clientId), `next_follow_up` (nextFollowUpAt), `expected_close`
 * (expectedCloseDate). Assignment uses the guarded assignment mutation. Stage is NOT edited here —
 * stage changes route through the Won/Lost dialogs (a later phase).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useUpdateOpportunity } from "@/lib/hooks/use-opportunities";
import type { UpdateOpportunity } from "@/lib/types/pipeline";
import type {
  PipelineTableEditableColumnId,
  PipelineTableEditValue,
  PipelineTableRow,
} from "@/lib/types/pipeline-table";

export type OpportunityCellSaveState = "idle" | "saving" | "saved" | "error";

export interface OpportunityCellUndoEntry {
  id: string;
  rowId: string;
  columnId: PipelineTableEditableColumnId;
  dealTitle: string;
  before: PipelineTableEditValue;
  after: PipelineTableEditValue;
}

const UNDO_STACK_LIMIT = 50;
/** How long a cell sits in the "saved" pulse before reverting to "idle" (ms). */
const SAVED_RESET_MS = 1_500;

let undoEntryCounter = 0;

function cellStateKey(
  rowId: string,
  columnId: PipelineTableEditableColumnId
): string {
  return `${rowId}:${columnId}`;
}

function createUndoEntryId(): string {
  undoEntryCounter += 1;
  return `pipeline-table-undo-${Date.now()}-${undoEntryCounter}`;
}

/**
 * Parse an ISO date string (`PipelineTableRow` dates are ISO strings) into a
 * `Date` for the `UpdateOpportunity` payload. A `null` value clears the field;
 * an unparseable string is treated as a clear so we never persist `Invalid
 * Date`.
 */
function isoToDate(value: PipelineTableEditValue): Date | null {
  if (value == null) return null;
  const parsed = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Coerce an edit value into the numeric `estimatedValue`. `null`/empty clears
 * the field; a non-numeric string is treated as a clear rather than persisting
 * `NaN`.
 */
function toEstimatedValue(value: PipelineTableEditValue): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Coerce an edit value into a nullable entity id. Empty string clears. */
function toNullableId(value: PipelineTableEditValue): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

/**
 * Pure: map an editable column id + raw edit value to the
 * `UpdateOpportunity` partial the service expects.
 *
 *   value          → estimatedValue (number | null)
 *   client         → clientId (string | null)
 *   next_follow_up → nextFollowUpAt (Date | null, parsed from ISO)
 *   expected_close → expectedCloseDate (Date | null, parsed from ISO)
 */
export function mapEditToUpdate(
  columnId: PipelineTableEditableColumnId,
  value: PipelineTableEditValue
): Partial<UpdateOpportunity> {
  switch (columnId) {
    case "value":
      return { estimatedValue: toEstimatedValue(value) };
    case "client":
      return { clientId: toNullableId(value) };
    case "next_follow_up":
      return { nextFollowUpAt: isoToDate(value) };
    case "expected_close":
      return { expectedCloseDate: isoToDate(value) };
  }
}

/**
 * Pure: read the current edit value off a row for diffing + undo capture.
 * Dates come back as the row's ISO string (or null) so they round-trip with
 * `mapEditToUpdate`.
 */
export function getRowEditValue(
  row: PipelineTableRow,
  columnId: PipelineTableEditableColumnId
): PipelineTableEditValue {
  switch (columnId) {
    case "value":
      return row.estimatedValue;
    case "client":
      return row.clientId;
    case "next_follow_up":
      return row.nextFollowUpAt;
    case "expected_close":
      return row.expectedCloseDate;
  }
}

/** Diff two edit values. Dates compare as ISO strings, the rest by identity. */
function valuesEqual(
  left: PipelineTableEditValue,
  right: PipelineTableEditValue
): boolean {
  return left === right;
}

function pushUndoEntry(
  entries: OpportunityCellUndoEntry[],
  entry: OpportunityCellUndoEntry
): OpportunityCellUndoEntry[] {
  return [...entries, entry].slice(-UNDO_STACK_LIMIT);
}

export function useOpportunityCellEdit({ rows }: { rows: PipelineTableRow[] }) {
  const updateOpportunity = useUpdateOpportunity();
  const { mutateAsync } = updateOpportunity;

  const [saveStates, setSaveStates] = useState<
    Map<string, OpportunityCellSaveState>
  >(() => new Map());
  const [undoStack, setUndoStack] = useState<OpportunityCellUndoEntry[]>([]);
  const [visibleUndoId, setVisibleUndoId] = useState<string | null>(null);

  // Keep the latest rows in a ref so callbacks stay stable yet always read the
  // freshest row snapshot (used to compute the prior value for undo/diff).
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Per-cell "saved → idle" reset timers, cleared on unmount.
  const savedTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  useEffect(() => {
    const timers = savedTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const setCellSaveState = useCallback(
    (
      rowId: string,
      columnId: PipelineTableEditableColumnId,
      state: OpportunityCellSaveState
    ) => {
      const key = cellStateKey(rowId, columnId);

      // Any new state supersedes a pending "saved → idle" timer.
      const existingTimer = savedTimersRef.current.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
        savedTimersRef.current.delete(key);
      }

      setSaveStates((current) => {
        const next = new Map(current);
        if (state === "idle") {
          next.delete(key);
        } else {
          next.set(key, state);
        }
        return next;
      });

      if (state === "saved") {
        const timer = setTimeout(() => {
          savedTimersRef.current.delete(key);
          setSaveStates((current) => {
            if (current.get(key) !== "saved") return current;
            const next = new Map(current);
            next.delete(key);
            return next;
          });
        }, SAVED_RESET_MS);
        savedTimersRef.current.set(key, timer);
      }
    },
    []
  );

  const findRow = useCallback(
    (rowId: string): PipelineTableRow | null =>
      rowsRef.current.find((row) => row.id === rowId) ?? null,
    []
  );

  const runSave = useCallback(
    async ({
      rowId,
      columnId,
      value,
      recordUndo,
      consumeUndoEntryId,
    }: {
      rowId: string;
      columnId: PipelineTableEditableColumnId;
      value: PipelineTableEditValue;
      recordUndo: boolean;
      consumeUndoEntryId?: string;
    }): Promise<void> => {
      const row = findRow(rowId);
      if (!row) {
        setCellSaveState(rowId, columnId, "error");
        return;
      }

      const previousValue = getRowEditValue(row, columnId);

      // No-op when the value is unchanged — settle to idle and drop any undo
      // entry we were asked to consume (e.g. an undo that lands on equal state).
      if (valuesEqual(previousValue, value)) {
        setCellSaveState(rowId, columnId, "idle");
        if (consumeUndoEntryId) {
          setUndoStack((current) =>
            current.filter((entry) => entry.id !== consumeUndoEntryId)
          );
        }
        return;
      }

      setCellSaveState(rowId, columnId, "saving");

      try {
        // useUpdateOpportunity owns the optimistic cache patch + rollback.
        await mutateAsync({
          id: rowId,
          data: mapEditToUpdate(columnId, value),
        });

        setCellSaveState(rowId, columnId, "saved");

        if (recordUndo) {
          const undoEntry: OpportunityCellUndoEntry = {
            id: createUndoEntryId(),
            rowId,
            columnId,
            dealTitle: row.title,
            before: previousValue,
            after: value,
          };
          setUndoStack((current) => pushUndoEntry(current, undoEntry));
          setVisibleUndoId(undoEntry.id);
        }

        if (consumeUndoEntryId) {
          setUndoStack((current) =>
            current.filter((entry) => entry.id !== consumeUndoEntryId)
          );
        }
      } catch {
        // Cache rollback already happened inside useUpdateOpportunity's onError.
        setCellSaveState(rowId, columnId, "error");
      }
    },
    [findRow, mutateAsync, setCellSaveState]
  );

  const commitEdit = useCallback(
    (
      rowId: string,
      columnId: PipelineTableEditableColumnId,
      value: PipelineTableEditValue
    ): Promise<void> => runSave({ rowId, columnId, value, recordUndo: true }),
    [runSave]
  );

  const undoLatest = useCallback(async (): Promise<void> => {
    const entry = undoStack.at(-1);
    if (!entry) return;
    // Re-commit the prior value. recordUndo:false so undo never spawns its own
    // undo entry; consumeUndoEntryId pops this entry once the revert lands.
    await runSave({
      rowId: entry.rowId,
      columnId: entry.columnId,
      value: entry.before,
      recordUndo: false,
      consumeUndoEntryId: entry.id,
    });
  }, [runSave, undoStack]);

  const clearLatestUndo = useCallback(() => {
    setVisibleUndoId(null);
  }, []);

  const latestUndo = visibleUndoId
    ? (undoStack.find((entry) => entry.id === visibleUndoId) ?? null)
    : null;

  return {
    saveStates,
    commitEdit,
    undoStack,
    latestUndo,
    undoLatest,
    clearLatestUndo,
  };
}
