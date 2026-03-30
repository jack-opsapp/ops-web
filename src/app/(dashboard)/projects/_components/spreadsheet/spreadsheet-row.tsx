"use client";

import { memo, useCallback } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  type Project,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";
import { getProjectStatusDisplayName } from "../project-stage-stack";
import { SPREADSHEET_COLUMNS } from "./spreadsheet-columns";
import { SpreadsheetCellText } from "./spreadsheet-cell-text";
import { SpreadsheetCellStatus } from "./spreadsheet-cell-status";
import { SpreadsheetCellDate } from "./spreadsheet-cell-date";
import { SpreadsheetCellNumber } from "./spreadsheet-cell-number";
import { SpreadsheetCellTextarea } from "./spreadsheet-cell-textarea";

interface SpreadsheetRowProps {
  project: Project;
  isSelected: boolean;
  isArchived: boolean;
  canEdit: boolean;
  canViewAccounting: boolean;
  columnVisibility: Record<string, boolean>;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  estimateTotal: number;
  invoiceTotal: number;
  completedTasks: number;
  totalTasks: number;
  teamMembers: { id: string; name: string; avatarUrl?: string }[];
  photoCount: number;
  daysInStatus: number;
  onSelect: (projectId: string, e: React.MouseEvent) => void;
  onUpdateField: (projectId: string, field: string, value: unknown) => void;
  onUpdateStatus: (projectId: string, status: ProjectStatus) => void;
  onOpenActionMenu: (projectId: string, e: React.MouseEvent) => void;
}

export const SpreadsheetRow = memo(function SpreadsheetRow({
  project,
  isSelected,
  isArchived,
  canEdit,
  canViewAccounting,
  columnVisibility,
  clientName,
  clientEmail,
  clientPhone,
  estimateTotal,
  invoiceTotal,
  completedTasks,
  totalTasks,
  teamMembers,
  photoCount,
  daysInStatus,
  onSelect,
  onUpdateField,
  onUpdateStatus,
  onOpenActionMenu,
}: SpreadsheetRowProps) {
  const statusColor = PROJECT_STATUS_COLORS[project.status];
  const editable = canEdit && !isArchived;

  const visibleColumns = SPREADSHEET_COLUMNS.filter((col) => {
    if (col.permission && !canViewAccounting) return false;
    return columnVisibility[col.id] !== false;
  });

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, button, [data-no-select]")) return;
    onSelect(project.id, e);
  }, [project.id, onSelect]);

  const formatCurrency = (val: number): string => {
    if (!val) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
  };

  const renderCell = (colId: string) => {
    switch (colId) {
      case "actions":
        return (
          <button
            data-no-select
            onClick={(e) => { e.stopPropagation(); onOpenActionMenu(project.id, e); }}
            className="flex items-center justify-center w-6 h-6 rounded-sm text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <MoreHorizontal className="w-[14px] h-[14px]" />
          </button>
        );

      case "status":
        return (
          <SpreadsheetCellStatus
            status={project.status}
            canEdit={editable}
            onCommit={(status) => onUpdateStatus(project.id, status)}
          />
        );

      case "title":
        return (
          <SpreadsheetCellText
            value={project.title}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "title", val)}
          />
        );

      case "client":
        return <span className="truncate">{clientName || "—"}</span>;

      case "address":
        return (
          <SpreadsheetCellText
            value={project.address?.split(",")[0]?.trim() ?? ""}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "address", val)}
          />
        );

      case "startDate":
        return (
          <SpreadsheetCellDate
            value={project.startDate}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "startDate", val)}
          />
        );

      case "endDate":
        return (
          <SpreadsheetCellDate
            value={project.endDate}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "endDate", val)}
          />
        );

      case "progress": {
        if (totalTasks === 0) return <span className="font-mono text-data-sm text-text-tertiary">—</span>;
        const pct = (completedTasks / totalTasks) * 100;
        return (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-[2px] bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: statusColor }}
              />
            </div>
            <span className="font-mono text-data-sm text-text-secondary whitespace-nowrap">
              {completedTasks}/{totalTasks}
            </span>
          </div>
        );
      }

      case "estimateTotal":
        return <span className="font-mono text-data-sm">{formatCurrency(estimateTotal)}</span>;

      case "invoiceTotal":
        return <span className="font-mono text-data-sm">{formatCurrency(invoiceTotal)}</span>;

      case "duration":
        return (
          <SpreadsheetCellNumber
            value={project.duration}
            suffix="d"
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "duration", val)}
          />
        );

      case "team": {
        if (teamMembers.length === 0) return <span className="text-text-tertiary">—</span>;
        const visible = teamMembers.slice(0, 3);
        const overflow = teamMembers.length - 3;
        return (
          <div className="flex items-center -space-x-1.5">
            {visible.map((m) => (
              <div
                key={m.id}
                className="w-6 h-6 rounded-full bg-background-elevated border border-border-subtle flex items-center justify-center overflow-hidden"
                title={m.name}
              >
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-kosugi text-[9px] text-text-tertiary uppercase">
                    {m.name.charAt(0)}
                  </span>
                )}
              </div>
            ))}
            {overflow > 0 && (
              <span className="ml-1 font-mono text-data-sm text-text-tertiary">+{overflow}</span>
            )}
          </div>
        );
      }

      case "clientEmail":
        return <span className="truncate text-text-secondary">{clientEmail || "—"}</span>;

      case "clientPhone":
        return <span className="font-mono text-data-sm text-text-secondary">{clientPhone || "—"}</span>;

      case "photos":
        return <span className="font-mono text-data-sm">{photoCount || "—"}</span>;

      case "notes":
        return (
          <SpreadsheetCellTextarea
            value={project.notes}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "notes", val)}
          />
        );

      case "description":
        return (
          <SpreadsheetCellTextarea
            value={project.projectDescription}
            canEdit={editable}
            onCommit={(val) => onUpdateField(project.id, "projectDescription", val)}
          />
        );

      case "pipeline":
        return project.opportunityId ? (
          <span className="inline-flex px-1.5 py-0.5 rounded-sm bg-[rgba(255,255,255,0.06)] border border-border-subtle font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
            Linked
          </span>
        ) : (
          <span className="text-text-tertiary">—</span>
        );

      case "daysInStatus":
        return (
          <span className={cn(
            "font-mono text-data-sm",
            daysInStatus > 60 && "text-[#93321A]",
            daysInStatus > 30 && daysInStatus <= 60 && "text-[#C4A868]",
          )}>
            {daysInStatus}d
          </span>
        );

      case "created": {
        if (!project.createdAt) return <span className="font-mono text-data-sm text-text-tertiary">—</span>;
        const d = new Date(project.createdAt);
        const now = new Date();
        const month = d.toLocaleString("en-US", { month: "short" });
        const day = d.getDate();
        const display = d.getFullYear() !== now.getFullYear()
          ? `${month} ${day} '${String(d.getFullYear()).slice(2)}`
          : `${month} ${day}`;
        return <span className="font-mono text-data-sm">{display}</span>;
      }

      default:
        return null;
    }
  };

  return (
    <tr
      className={cn(
        "border-b border-border-subtle transition-colors duration-100",
        "hover:bg-background-elevated/50",
        isSelected && "bg-ops-accent-muted",
        isArchived && "opacity-50",
      )}
      style={{ borderLeft: `3px solid ${statusColor}` }}
      onClick={handleRowClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenActionMenu(project.id, e);
      }}
    >
      {visibleColumns.map((col) => (
        <td
          key={col.id}
          className={cn(
            "px-1.5 py-1.5",
            col.id === "actions" && "w-[40px] px-1",
            col.mono && "font-mono text-data-sm",
            !col.mono && col.id !== "actions" && "font-mohave text-body-sm text-text-primary",
          )}
        >
          {renderCell(col.id)}
        </td>
      ))}
    </tr>
  );
});
