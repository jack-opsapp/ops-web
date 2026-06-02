/**
 * OPS Web — Pipeline Table bulk-actions engine.
 *
 * The batch counterpart to the per-cell {@link useOpportunityCellEdit} engine,
 * mirroring the projects table's `useProjectsBulkActions` but adapted to the
 * pipeline's realities:
 *
 *   - Opportunities have NO bulk RPC (unlike projects' `bulkUpdateProjects`),
 *     so each action fans out to the proven per-row mutations
 *     (`useUpdateOpportunity` / `useArchiveOpportunity`) and awaits them with
 *     `Promise.allSettled` so a single failure never aborts the rest.
 *   - Each per-row mutation is already optimistic (cache patch + rollback inside
 *     the hook), so the table reflects the batch instantly with no extra cache
 *     bookkeeping here.
 *   - Undo rides the SAME global `useUndoStore` the stage-transition hook uses,
 *     so the bulk change lands in the top-bar Undo affordance (and ⌘Z) exactly
 *     like a single stage move. We capture each row's PRIOR value before
 *     mutating, so the single pushed `inverseFn` restores every row's original
 *     owner / follow-up date / priority (archive inverts via unarchive).
 *
 * Stage changes are NOT handled here. Won/Lost route through the per-row
 * `StageTransitionDialog` (which captures actualValue / lostReason per deal);
 * faking a batch capture would either be a silent write or apply one reason to
 * all, both incorrect. The single-row stage cell owns that flow. See
 * `pipeline-bulk-bar.tsx` for the documented omission.
 */

import { useCallback, useMemo, useState } from "react";
import { toast } from "@/components/ui/toast";
import {
  useArchiveOpportunity,
  useUnarchiveOpportunity,
  useUpdateOpportunity,
} from "@/lib/hooks/use-opportunities";
import { OpportunityPriority } from "@/lib/types/pipeline";
import type { PipelineTableRow } from "@/lib/types/pipeline-table";
import { useUndoStore } from "@/stores/undo-store";

/** A single bulk operation's outcome. */
interface BulkRunResult {
  successCount: number;
  failedCount: number;
}

/**
 * Parse a `PipelineTableRow`'s ISO follow-up string into a `Date` for the
 * `UpdateOpportunity` payload (the service accepts `Date | string | null`). A
 * `null`/unparseable value clears the field rather than persisting `Invalid
 * Date`. Mirrors `isoToDate` in the cell-edit engine.
 */
function isoToDate(value: string | null): Date | null {
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Normalize a date-input value (`yyyy-mm-dd`, local) into a `Date` at local
 * midnight, or `null` when cleared. Empty string clears the field.
 */
function dateInputToDate(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface PipelineBulkActionsApi {
  /** The selected rows actually present in `selectedRows` (the bulk targets). */
  targetRows: PipelineTableRow[];
  /** True while any bulk operation is mid-flight (disables the bar's controls). */
  isRunning: boolean;
  /** Reassign every target's owner (`assignedTo`). Empty string clears it. */
  reassignOwner: (userId: string) => Promise<BulkRunResult>;
  /** Set every target's next follow-up date (`yyyy-mm-dd`, empty clears). */
  setFollowUpDate: (value: string) => Promise<BulkRunResult>;
  /** Set every target's priority. */
  changePriority: (priority: OpportunityPriority) => Promise<BulkRunResult>;
  /** Archive every target (optimistically removed from the active list). */
  archive: () => Promise<BulkRunResult>;
}

export function usePipelineBulkActions({
  selectedRows,
  selectedIds,
  onClearSelection,
  /** Build the human-readable undo label, e.g. `// 3 OWNERS RESTORED`. */
  undoLabels,
}: {
  selectedRows: PipelineTableRow[];
  selectedIds: Set<string>;
  onClearSelection: () => void;
  undoLabels: {
    reassign: (count: number) => string;
    followUp: (count: number) => string;
    priority: (count: number) => string;
    archive: (count: number) => string;
  };
}): PipelineBulkActionsApi {
  const updateOpportunity = useUpdateOpportunity();
  const archiveOpportunity = useArchiveOpportunity();
  const unarchiveOpportunity = useUnarchiveOpportunity();
  const pushUndo = useUndoStore((s) => s.pushUndo);

  const { mutateAsync: updateAsync } = updateOpportunity;
  const { mutateAsync: archiveAsync } = archiveOpportunity;
  const { mutateAsync: unarchiveAsync } = unarchiveOpportunity;

  const [isRunning, setIsRunning] = useState(false);

  const targetRows = useMemo(
    () => selectedRows.filter((row) => selectedIds.has(row.id)),
    [selectedIds, selectedRows],
  );

  /**
   * Run one update per target with `Promise.allSettled` (one failure never
   * aborts the rest), record a SINGLE undo entry that restores the captured
   * prior values of the rows that actually succeeded, clear selection, and
   * settle `isRunning`. The undo's `inverseFn` re-issues the per-row updates
   * with the prior payloads — again best-effort across rows.
   */
  const runUpdate = useCallback(
    async ({
      rows,
      buildData,
      buildUndoData,
      undoLabel,
    }: {
      rows: PipelineTableRow[];
      buildData: (row: PipelineTableRow) => Parameters<typeof updateAsync>[0]["data"];
      buildUndoData: (row: PipelineTableRow) => Parameters<typeof updateAsync>[0]["data"];
      undoLabel: (count: number) => string;
    }): Promise<BulkRunResult> => {
      if (rows.length === 0) return { successCount: 0, failedCount: 0 };

      setIsRunning(true);
      try {
        const settled = await Promise.allSettled(
          rows.map((row) => updateAsync({ id: row.id, data: buildData(row) })),
        );

        const succeededRows = rows.filter(
          (_row, index) => settled[index]?.status === "fulfilled",
        );
        const failedCount = settled.length - succeededRows.length;

        if (succeededRows.length > 0) {
          pushUndo({
            label: undoLabel(succeededRows.length),
            inverseFn: async () => {
              await Promise.allSettled(
                succeededRows.map((row) =>
                  updateAsync({ id: row.id, data: buildUndoData(row) }),
                ),
              );
            },
          });
        }

        return { successCount: succeededRows.length, failedCount };
      } finally {
        setIsRunning(false);
        onClearSelection();
      }
    },
    [onClearSelection, pushUndo, updateAsync],
  );

  const reassignOwner = useCallback(
    (userId: string) => {
      const assignedTo = userId.trim().length === 0 ? null : userId;
      return runUpdate({
        rows: targetRows,
        buildData: () => ({ assignedTo }),
        buildUndoData: (row) => ({ assignedTo: row.assignedTo }),
        undoLabel: undoLabels.reassign,
      });
    },
    [runUpdate, targetRows, undoLabels.reassign],
  );

  const setFollowUpDate = useCallback(
    (value: string) => {
      const nextFollowUpAt = dateInputToDate(value);
      return runUpdate({
        rows: targetRows,
        buildData: () => ({ nextFollowUpAt }),
        buildUndoData: (row) => ({ nextFollowUpAt: isoToDate(row.nextFollowUpAt) }),
        undoLabel: undoLabels.followUp,
      });
    },
    [runUpdate, targetRows, undoLabels.followUp],
  );

  const changePriority = useCallback(
    (priority: OpportunityPriority) =>
      runUpdate({
        rows: targetRows,
        buildData: () => ({ priority }),
        buildUndoData: (row) => ({
          priority: (row.priority as OpportunityPriority | null) ?? null,
        }),
        undoLabel: undoLabels.priority,
      }),
    [runUpdate, targetRows, undoLabels.priority],
  );

  const archive = useCallback(async (): Promise<BulkRunResult> => {
    const rows = targetRows;
    if (rows.length === 0) return { successCount: 0, failedCount: 0 };

    setIsRunning(true);
    try {
      const settled = await Promise.allSettled(rows.map((row) => archiveAsync(row.id)));
      const succeededRows = rows.filter(
        (_row, index) => settled[index]?.status === "fulfilled",
      );
      const failedCount = settled.length - succeededRows.length;

      if (succeededRows.length > 0) {
        pushUndo({
          label: undoLabels.archive(succeededRows.length),
          inverseFn: async () => {
            await Promise.allSettled(
              succeededRows.map((row) => unarchiveAsync(row.id)),
            );
          },
        });
      }

      return { successCount: succeededRows.length, failedCount };
    } finally {
      setIsRunning(false);
      onClearSelection();
    }
    // `undoLabels` is memoized by the caller (keyed on the dictionary `t`), so
    // it's stable; depend on the whole object per exhaustive-deps.
  }, [archiveAsync, onClearSelection, pushUndo, targetRows, unarchiveAsync, undoLabels]);

  return {
    targetRows,
    isRunning,
    reassignOwner,
    setFollowUpDate,
    changePriority,
    archive,
  };
}

/** Re-export so the bar can build its priority `<select>` options. */
export { OpportunityPriority };

/** A partial-failure toast helper shared by the bar (keeps copy in one place). */
export function bulkResultToast(args: {
  result: BulkRunResult;
  successMessage: (count: number) => string;
  partialMessage: (success: number, total: number) => string;
  failureMessage: string;
}) {
  const { result, successMessage, partialMessage, failureMessage } = args;
  const total = result.successCount + result.failedCount;
  if (result.failedCount === 0 && result.successCount > 0) {
    toast.success(successMessage(result.successCount));
    return;
  }
  if (result.successCount > 0 && result.failedCount > 0) {
    toast.error(partialMessage(result.successCount, total));
    return;
  }
  if (result.failedCount > 0) {
    toast.error(failureMessage);
  }
}
