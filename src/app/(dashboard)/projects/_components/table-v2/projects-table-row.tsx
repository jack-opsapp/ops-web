"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableColumnConfig, ProjectTableRow } from "@/lib/types/project-table";
import { CellCurrency } from "./cells/cell-currency";
import { CellDate } from "./cells/cell-date";
import { CellNumber } from "./cells/cell-number";
import { CellPercent } from "./cells/cell-percent";
import { CellProgress } from "./cells/cell-progress";
import { CellRelation } from "./cells/cell-relation";
import { CellStatus } from "./cells/cell-status";
import { CellText } from "./cells/cell-text";
import type { ProjectTableColumnLayout, ProjectsTableMetrics } from "./projects-table";

function renderReadOnlyCell(row: ProjectTableRow, column: ProjectTableColumnConfig): ReactNode {
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
      return <CellNumber value={row.teamMemberIds.length > 0 ? row.teamMemberIds.length : null} />;
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
      return <CellNumber value={row.photoCount} />;
    case "updated_at":
      return <CellDate value={row.updatedAt} />;
    default:
      return <CellText value="—" />;
  }
}

export function ProjectsTableRow({
  row,
  columns,
  metrics,
  selected,
  virtualStart,
  totalWidth,
  onToggleRow,
  onOpenProject,
}: {
  row: ProjectTableRow;
  columns: ProjectTableColumnLayout[];
  metrics: ProjectsTableMetrics;
  selected: boolean;
  virtualStart: number;
  totalWidth: number;
  onToggleRow: (rowId: string, mode: "single" | "toggle" | "range") => void;
  onOpenProject: (rowId: string) => void;
}) {
  const handleOpen = () => onOpenProject(row.id);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleOpen();
  };

  const handleSelect = (event: MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
    onToggleRow(row.id, event.shiftKey ? "range" : "toggle");
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      className={cn("absolute left-0 top-0 flex outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent", selected && "bg-surface-active")}
      style={{
        height: metrics.rowHeight,
        width: totalWidth,
        transform: `translateY(${virtualStart}px)`,
        fontSize: metrics.fontSize,
      }}
    >
      {columns.map(({ column, width, stickyLeft }) => (
        <div
          key={column.id}
          className={cn(
            "flex min-w-0 shrink-0 items-center border-b border-r border-border-subtle px-2",
            column.align === "right" && "justify-end",
            stickyLeft != null && "sticky z-10 bg-background",
            selected && stickyLeft != null && "bg-surface-active",
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
            <input
              type="checkbox"
              checked={selected}
              readOnly
              onClick={handleSelect}
              className="h-3.5 w-3.5 rounded-[3px] border border-border bg-surface-input accent-ops-accent"
            />
          ) : (
            renderReadOnlyCell(row, column)
          )}
        </div>
      ))}
    </div>
  );
}
