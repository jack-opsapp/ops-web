"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/cn";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import type {
  PipelineTableActiveCell,
  PipelineTableEditingCell,
} from "@/lib/hooks/pipeline-table/use-pipeline-table-keyboard-nav";
import { OpportunityStage } from "@/lib/types/pipeline";
import {
  isCloseOverdue,
  isFollowUpOverdue,
  isRotting,
  isSevereRotting,
} from "@/lib/utils/pipeline-table-adapter";
import {
  isPipelineTableEditableColumn,
  type PipelineTableColumnConfig,
  type PipelineTableColumnId,
  type PipelineTableEditableColumnId,
  type PipelineTableEditValue,
  type PipelineTableRow as PipelineTableRowModel,
} from "@/lib/types/pipeline-table";
import { CellAge } from "./cells/cell-age";
import { CellAssignee } from "./cells/cell-assignee";
import { CellCurrency } from "./cells/cell-currency";
import { CellDate } from "./cells/cell-date";
import { CellNumber } from "./cells/cell-number";
import { CellPercent } from "./cells/cell-percent";
import { CellPriority } from "./cells/cell-priority";
import { CellRelation } from "./cells/cell-relation";
import { CellStageAction } from "./cells/cell-stage-action";
import { CellText } from "./cells/cell-text";
import { EditableCellAssignee } from "./cells/editable-cell-assignee";
import { EditableCellCurrency } from "./cells/editable-cell-currency";
import { EditableCellDate } from "./cells/editable-cell-date";
import type {
  PipelineTableColumnLayout,
  PipelineTableMetrics,
} from "./pipeline-table";

/**
 * Map a column to its presentational cell. Inline-editable columns route through
 * {@link renderEditableCell} instead. The `stage` column is special: it is not an
 * inline-edit column (stage changes carry side effects), so it renders the
 * actionable {@link CellStageAction} here — its menu calls `onRequestStageChange`,
 * which the shell threads into the shared transition hook. The `default` arm
 * renders the "—" sentinel so an unknown/added column never throws.
 */
function renderReadOnlyCell(
  row: PipelineTableRowModel,
  column: PipelineTableColumnConfig,
  onRequestStageChange: (rowId: string, next: OpportunityStage) => void,
  onRequestConvertAlreadyWon: (rowId: string) => void,
  canManage: boolean,
): ReactNode {
  switch (column.id) {
    case "deal":
      return <CellText value={row.title} />;
    case "stage":
      return (
        <CellStageAction
          stage={row.stage}
          canManage={canManage}
          wonUnconverted={
            row.stage === OpportunityStage.Won && !row.projectId
          }
          onConvert={() => onRequestConvertAlreadyWon(row.id)}
          onSelectStage={(next) => onRequestStageChange(row.id, next)}
        />
      );
    case "client":
      return <CellRelation value={row.clientName} />;
    case "value":
      return <CellCurrency value={row.estimatedValue} />;
    case "win_probability":
      return <CellPercent value={row.winProbability} />;
    case "weighted":
      return <CellCurrency value={row.weightedValue} />;
    case "age_in_stage":
      return <CellAge value={row.ageInStageDays} />;
    case "last_activity":
      return <CellDate value={row.lastActivityAt} />;
    case "next_follow_up":
      return <CellDate value={row.nextFollowUpAt} />;
    case "expected_close":
      return <CellDate value={row.expectedCloseDate} />;
    case "assignee":
      return <CellAssignee name={row.assigneeName} />;
    case "source":
      return <CellText value={row.source} className="text-text-2" />;
    case "priority":
      return <CellPriority value={row.priority} />;
    case "correspondence":
      return <CellNumber value={row.correspondenceCount} />;
    default:
      return <CellText value="—" />;
  }
}

/**
 * A keydown that bubbled up from a focusable control INSIDE the cell (an inline
 * input, a listbox option, a contenteditable) is the control's to handle — the
 * cell-level nav handler must not also act on it (e.g. swallow the input's
 * Enter/Escape). Mirrors the projects table-v2 guard.
 */
function shouldIgnoreBubbledKeyDown(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [role='option']"),
  );
}

export function PipelineTableRow({
  row,
  columns,
  metrics,
  selected,
  virtualStart,
  totalWidth,
  now,
  saveStates,
  activeCell,
  editingCell,
  canManage,
  setActiveCell,
  onToggleRow,
  onOpenDeal,
  onBeginEdit,
  onCancelEdit,
  onCellKeyDown,
  onCommitCell,
  onRequestStageChange,
  onRequestConvertAlreadyWon,
}: {
  row: PipelineTableRowModel;
  columns: PipelineTableColumnLayout[];
  metrics: PipelineTableMetrics;
  selected: boolean;
  virtualStart: number;
  totalWidth: number;
  /** Injected clock (stable for the table's mount) for all aging/overdue cues. */
  now: Date;
  saveStates: Map<string, OpportunityCellSaveState>;
  activeCell: PipelineTableActiveCell | null;
  editingCell: PipelineTableEditingCell | null;
  canManage: boolean;
  setActiveCell: (cell: PipelineTableActiveCell) => void;
  onToggleRow: (rowId: string, mode: "single" | "toggle" | "range") => void;
  onOpenDeal: (rowId: string) => void;
  onBeginEdit: (rowId: string, columnId: PipelineTableEditableColumnId) => void;
  onCancelEdit: () => void;
  onCellKeyDown: (
    rowId: string,
    columnId: PipelineTableColumnId,
    event: KeyboardEvent<HTMLElement>,
  ) => void;
  onCommitCell: (
    rowId: string,
    columnId: PipelineTableEditableColumnId,
    value: PipelineTableEditValue,
  ) => void;
  onRequestStageChange: (rowId: string, next: OpportunityStage) => void;
  onRequestConvertAlreadyWon: (rowId: string) => void;
}) {
  const { t } = useDictionary("pipeline");

  const handleSelect = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleRow(row.id, event.shiftKey ? "range" : "toggle");
  };

  const isEditingRow = editingCell?.rowId === row.id;

  // ── Aging / triage signal (all derivations from the adapter; terminal stages
  //    are gated inside the overdue helpers, so Won/Lost/Discarded never flag) ──
  const followUpOverdue = isFollowUpOverdue(row.nextFollowUpAt, row.stage, now);
  const closeOverdue = isCloseOverdue(row.expectedCloseDate, row.stage, now);
  const rotting = isRotting(row.ageInStageDays, row.staleThresholdDays);
  const severeRotting = isSevereRotting(row.ageInStageDays, row.staleThresholdDays);

  // Three tiers, most-severe wins:
  //   brick — long stale (≥2× threshold) AND follow-up overdue (the dying deal)
  //   rose  — severe stale OR follow-up overdue (needs attention)
  //   tan   — rotting but not yet severe (early warning)
  //   none  — fresh; a transparent border holds the 2px gutter so no width shift
  const signal: "critical" | "severe" | "rotting" | null =
    severeRotting && followUpOverdue
      ? "critical"
      : severeRotting || followUpOverdue
        ? "severe"
        : rotting
          ? "rotting"
          : null;

  const signalBorderClass =
    signal === "critical"
      ? "border-l-brick"
      : signal === "severe"
        ? "border-l-rose"
        : signal === "rotting"
          ? "border-l-tan"
          : "border-l-transparent";

  const signalAriaLabel =
    signal === "critical"
      ? t("table.signal.critical")
      : signal === "severe"
        ? t("table.signal.severe")
        : signal === "rotting"
          ? t("table.signal.rotting")
          : undefined;

  const renderEditableCell = (columnId: PipelineTableEditableColumnId): ReactNode => {
    const saveState = saveStates.get(`${row.id}:${columnId}`) ?? "idle";
    const isEditing = editingCell?.rowId === row.id && editingCell.columnId === columnId;
    const beginEdit = () => onBeginEdit(row.id, columnId);

    switch (columnId) {
      case "value":
        return (
          <EditableCellCurrency
            value={row.estimatedValue}
            saveState={saveState}
            editing={isEditing}
            onBeginEdit={beginEdit}
            onCancelEdit={onCancelEdit}
            onCommit={(value) => onCommitCell(row.id, columnId, value)}
          />
        );
      case "next_follow_up":
      case "expected_close":
        return (
          <EditableCellDate
            value={columnId === "next_follow_up" ? row.nextFollowUpAt : row.expectedCloseDate}
            columnId={columnId}
            saveState={saveState}
            editing={isEditing}
            overdue={columnId === "next_follow_up" ? followUpOverdue : closeOverdue}
            onBeginEdit={beginEdit}
            onCancelEdit={onCancelEdit}
            onCommit={(value) => onCommitCell(row.id, columnId, value)}
          />
        );
      case "assignee":
        return (
          <EditableCellAssignee
            assigneeId={row.assignedTo}
            assigneeName={row.assigneeName}
            saveState={saveState}
            editing={isEditing}
            onBeginEdit={beginEdit}
            onCancelEdit={onCancelEdit}
            onCommit={(userId) => onCommitCell(row.id, columnId, userId)}
          />
        );
    }
  };

  return (
    <div
      role="row"
      data-pipeline-signal={signal ?? undefined}
      aria-label={signalAriaLabel}
      title={signalAriaLabel}
      className={cn(
        "group absolute left-0 top-0 flex outline-none hover:bg-surface-hover",
        selected && "bg-surface-active",
        isEditingRow && "z-[120]",
      )}
      style={{
        height: metrics.rowHeight,
        width: totalWidth,
        transform: `translateY(${virtualStart}px)`,
        fontSize: metrics.fontSize,
      }}
    >
      {columns.map(({ column, width, stickyLeft }) => {
        const isActiveCell = activeCell?.rowId === row.id && activeCell.columnId === column.id;
        // Editing is a manage-only state; a view-only operator can never enter it.
        const isEditingCell =
          canManage &&
          isPipelineTableEditableColumn(column.id) &&
          editingCell?.rowId === row.id &&
          editingCell.columnId === column.id;

        return (
          <div
            key={column.id}
            role={column.id === "select" ? undefined : "gridcell"}
            tabIndex={isActiveCell ? 0 : -1}
            data-pipeline-table-row-id={row.id}
            data-pipeline-table-column-id={column.id}
            onFocus={() => setActiveCell({ rowId: row.id, columnId: column.id })}
            onKeyDown={(event) => {
              // Let inline controls (inputs, listbox options) own their own keys;
              // only the cell shell's keystrokes drive navigation.
              if (event.target !== event.currentTarget && shouldIgnoreBubbledKeyDown(event.target)) {
                return;
              }
              onCellKeyDown(row.id, column.id, event);
            }}
            onClick={() => {
              if (column.id === "select") return;
              setActiveCell({ rowId: row.id, columnId: column.id });
              if (isEditingCell) return;
              // Editable cells own their own click → begin-edit (and manage
              // their own stopPropagation for nested controls). A click that
              // bubbles up from an editable column begins editing rather than
              // opening the detail panel; everything else opens the deal. Gated
              // on canManage: a view-only operator renders the read-only cell for
              // these columns, so a click there opens the deal like any other.
              if (canManage && isPipelineTableEditableColumn(column.id)) {
                onBeginEdit(row.id, column.id);
                return;
              }
              onOpenDeal(row.id);
            }}
            className={cn(
              "relative flex min-w-0 shrink-0 items-center border-b border-r border-border px-[8px] outline-none",
              column.id !== "select" && "cursor-pointer",
              column.align === "right" && "justify-end",
              stickyLeft != null && "sticky z-10 bg-background",
              // Row-level aging signal lives on the frozen leftmost (select) cell
              // so it stays pinned at the row's left edge under horizontal scroll.
              // A transparent 2px border holds the gutter when there is no signal,
              // so rows never shift width as a signal appears/clears.
              column.id === "select" && cn("border-l-2", signalBorderClass),
              selected && "bg-surface-active",
              isActiveCell && "bg-surface-active focus-visible:ring-1 focus-visible:ring-ops-accent",
              isEditingCell && "z-[120]",
            )}
            style={{
              width,
              minWidth: width,
              maxWidth: width,
              height: metrics.rowHeight,
              left: stickyLeft ?? undefined,
            }}
          >
            {column.id === "select" ? (
              // The select checkbox only feeds bulk mutations, which a view-only
              // operator (pipeline.view, not pipeline.manage) can't perform — and
              // would silently fail at RLS. Without manage there is no checkbox at
              // all (the header's select-all is hidden in lockstep), so the row's
              // frozen rail still holds its aging-signal border but offers no
              // selection affordance.
              canManage ? (
                <Checkbox
                  aria-label={t("table.column.select")}
                  checked={selected}
                  onClick={handleSelect}
                  className="rounded-chip"
                />
              ) : null
            ) : (
              <div className="min-w-0 flex-1">
                {/* Inline editing is gated on pipeline.manage: a view-only operator
                    gets the READ-ONLY cell for the editable columns (value / dates /
                    assignee) — exactly how `CellStageAction` falls back to the static
                    `CellStage` — so no edit affordance is shown that would only fail
                    at RLS. With manage, editable columns route through their inline
                    editors. */}
                {canManage && isPipelineTableEditableColumn(column.id)
                  ? renderEditableCell(column.id)
                  : renderReadOnlyCell(
                      row,
                      column,
                      onRequestStageChange,
                      onRequestConvertAlreadyWon,
                      canManage,
                    )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
