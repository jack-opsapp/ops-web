"use client";

import { Pencil } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableSaveState } from "@/lib/hooks/projects-table/use-cell-edit";
import type {
  ProjectTableActiveCell,
  ProjectTableEditingCell,
} from "@/lib/hooks/projects-table/use-table-keyboard-nav";
import {
  isProjectTableEditableColumn,
  type ProjectTableColumnConfig,
  type ProjectTableColumnId,
  type ProjectTableEditableColumnId,
  type ProjectTableEditValue,
  type ProjectTableRow,
} from "@/lib/types/project-table";
import { CellCurrency } from "./cells/cell-currency";
import { CellDate } from "./cells/cell-date";
import { CellNumber } from "./cells/cell-number";
import { CellPercent } from "./cells/cell-percent";
import { CellPhotos } from "./cells/cell-photos";
import { CellProgress } from "./cells/cell-progress";
import { CellRelation } from "./cells/cell-relation";
import { CellStatus } from "./cells/cell-status";
import { CellTeam } from "./cells/cell-team";
import { CellText } from "./cells/cell-text";
import { EditableCellClient } from "./cells/editable-cell-client";
import { EditableCellDate } from "./cells/editable-cell-date";
import { EditableCellStatus } from "./cells/editable-cell-status";
import { EditableCellText } from "./cells/editable-cell-text";
import type { ProjectTableColumnLayout, ProjectsTableMetrics } from "./projects-table";

function renderReadOnlyCell(
  row: ProjectTableRow,
  column: ProjectTableColumnConfig,
  metrics: ProjectsTableMetrics,
): ReactNode {
  switch (column.id) {
    case "name":
      return <CellText value={row.title} />;
    case "status":
      return <CellStatus status={row.status} />;
    case "client":
      return <CellRelation value={row.clientName} />;
    case "client_email":
      return <CellText value={row.clientEmail} className="font-mono text-text-2" />;
    case "client_phone":
      return <CellText value={row.clientPhone} className="font-mono text-text-2" />;
    case "address":
      return <CellText value={row.address} className="text-text-2" />;
    case "team":
      return <CellTeam row={row} avatarSize={metrics.avatarSize} />;
    case "start_date":
      return <CellDate value={row.startDate} />;
    case "end_date":
      return <CellDate value={row.endDate} />;
    case "duration":
      return <CellNumber value={row.duration} />;
    case "progress":
      return <CellProgress value={row.progress} />;
    case "next_task":
      return <CellText value={row.nextTask} className="text-text-2" />;
    case "task_count":
      return <CellNumber value={row.taskCount} />;
    case "days_in_status":
      return <CellNumber value={row.daysInStatus} />;
    case "estimate_total":
      return <CellCurrency value={row.estimateTotal} />;
    case "invoice_total":
      return <CellCurrency value={row.invoiceTotal} />;
    case "paid_total":
      return <CellCurrency value={row.paidTotal} />;
    case "value":
      return <CellCurrency value={row.value} />;
    case "project_cost":
      return <CellCurrency value={row.projectCost} />;
    case "margin":
      return <CellPercent value={row.margin} />;
    case "photos":
      return <CellPhotos row={row} />;
    case "updated_at":
      return <CellDate value={row.updatedAt} />;
    default:
      return <CellText value="—" />;
  }
}

function shouldIgnoreBubbledKeyDown(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='option']"));
}

export function ProjectsTableRow({
  row,
  columns,
  metrics,
  selected,
  virtualStart,
  totalWidth,
  activeCell,
  editingCell,
  saveStates,
  onToggleRow,
  onOpenProject,
  setActiveCell,
  onBeginEdit,
  onCancelEdit,
  onCellKeyDown,
  onCommitCell,
}: {
  row: ProjectTableRow;
  columns: ProjectTableColumnLayout[];
  metrics: ProjectsTableMetrics;
  selected: boolean;
  virtualStart: number;
  totalWidth: number;
  activeCell: ProjectTableActiveCell | null;
  editingCell: ProjectTableEditingCell | null;
  saveStates: Map<string, ProjectTableSaveState>;
  onToggleRow: (rowId: string, mode: "single" | "toggle" | "range") => void;
  onOpenProject: (rowId: string) => void;
  setActiveCell: (cell: ProjectTableActiveCell) => void;
  onBeginEdit: (rowId: string, columnId: ProjectTableEditableColumnId) => void;
  onCancelEdit: () => void;
  onCellKeyDown: (
    rowId: string,
    columnId: ProjectTableColumnId,
    event: KeyboardEvent<HTMLElement>,
  ) => void;
  onCommitCell: (
    row: ProjectTableRow,
    columnId: ProjectTableEditableColumnId,
    value: ProjectTableEditValue,
  ) => Promise<void>;
}) {
  const { t } = useDictionary("projects");

  const handleSelect = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleRow(row.id, event.shiftKey ? "range" : "toggle");
  };

  const isEditingRow = editingCell?.rowId === row.id;

  const renderCell = (column: ProjectTableColumnConfig): ReactNode => {
    if (!isProjectTableEditableColumn(column.id)) return renderReadOnlyCell(row, column, metrics);

    const editableColumnId = column.id;
    const saveState = saveStates.get(`${row.id}:${editableColumnId}`) ?? "idle";
    const isEditing = editingCell?.rowId === row.id && editingCell.columnId === editableColumnId;
    const beginEdit = () => onBeginEdit(row.id, editableColumnId);
    const commit = (value: ProjectTableEditValue) => onCommitCell(row, editableColumnId, value);

    switch (editableColumnId) {
      case "name":
        if (!isEditing) {
          return (
            <div className="group/name relative flex h-full w-full min-w-0 items-center pr-7">
              <CellText value={row.title} className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" />
              <button
                type="button"
                aria-label={t("table.cell.name.edit").replace("{name}", row.title)}
                onClick={(event) => {
                  event.stopPropagation();
                  beginEdit();
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="absolute right-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-text-3 opacity-0 outline-none transition-colors hover:bg-surface-hover hover:text-text-2 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ops-accent group-hover/name:opacity-100"
              >
                <Pencil className="h-[12px] w-[12px]" strokeWidth={1.5} />
              </button>
            </div>
          );
        }
        return (
          <EditableCellText
            value={row.title}
            columnId={editableColumnId}
            required
            saveState={saveState}
            editing={isEditing}
            onBeginEdit={beginEdit}
            onCancelEdit={onCancelEdit}
            onCommit={commit}
          />
        );
      case "address":
        return (
          <EditableCellText
            value={row.address}
            columnId={editableColumnId}
            saveState={saveState}
            editing={isEditing}
            onBeginEdit={beginEdit}
            onCancelEdit={onCancelEdit}
            onCommit={commit}
          />
        );
      case "start_date":
      case "end_date":
        return (
          <EditableCellDate
            value={editableColumnId === "start_date" ? row.startDate : row.endDate}
            columnId={editableColumnId}
            saveState={saveState}
            editing={isEditing}
            onBeginEdit={beginEdit}
            onCancelEdit={onCancelEdit}
            onCommit={commit}
          />
        );
      case "status":
        return (
          <EditableCellStatus
            status={row.status}
            saveState={saveState}
            editing={isEditing}
            onBeginEdit={beginEdit}
            onCancelEdit={onCancelEdit}
            onCommit={(status) => commit(status)}
          />
        );
      case "client":
        return (
          <EditableCellClient
            clientId={row.clientId}
            clientName={row.clientName}
            saveState={saveState}
            editing={isEditing}
            onBeginEdit={beginEdit}
            onCancelEdit={onCancelEdit}
            onCommit={commit}
          />
        );
    }
  };

  return (
    <div
      role="row"
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
        const isEditingCell = editingCell?.rowId === row.id && editingCell.columnId === column.id;

        return (
          <div
            key={column.id}
            role={column.id === "select" ? undefined : "gridcell"}
            tabIndex={isActiveCell ? 0 : -1}
            data-project-table-row-id={row.id}
            data-project-table-column-id={column.id}
            onFocus={() => setActiveCell({ rowId: row.id, columnId: column.id })}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget && shouldIgnoreBubbledKeyDown(event.target)) {
                return;
              }
              onCellKeyDown(row.id, column.id, event);
            }}
            onClick={() => {
              if (column.id === "select") return;
              setActiveCell({ rowId: row.id, columnId: column.id });
              if (isEditingCell) return;
              if (column.id === "name") {
                onOpenProject(row.id);
                return;
              }
              if (isProjectTableEditableColumn(column.id)) {
                onBeginEdit(row.id, column.id);
              }
            }}
            className={cn(
              "relative flex min-w-0 shrink-0 items-center border-b border-r border-border px-[8px] outline-none",
              column.align === "right" && "justify-end",
              stickyLeft != null && "sticky z-10 bg-background",
              selected && stickyLeft != null && "bg-surface-active",
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
              <Checkbox
                aria-label={t("table.column.select")}
                checked={selected}
                onClick={handleSelect}
                className="rounded-[3px]"
              />
            ) : (
              <>
                <div className="min-w-0 flex-1">{renderCell(column)}</div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
