"use client";

import { memo, useCallback, useState, useRef, useEffect } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
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
  canCreateTasks: boolean;
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
  daysInStatus: number;
  onSelect: (projectId: string, e: React.MouseEvent) => void;
  onUpdateField: (projectId: string, field: string, value: unknown) => void;
  onUpdateStatus: (projectId: string, status: ProjectStatus) => void;
  onOpenActionMenu: (projectId: string, e: React.MouseEvent) => void;
  onAddTask: (projectId: string) => void;
}

/** Extract street number + street name + city from full address */
function formatShortAddress(address: string | null): string {
  if (!address) return "—";
  const parts = address.split(",").map((s) => s.trim());
  // parts[0] = street, parts[1] = city (typically)
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
  return parts[0] || "—";
}

function formatCurrency(val: number): string {
  if (!val) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

export const SpreadsheetRow = memo(function SpreadsheetRow({
  project,
  isSelected,
  isArchived,
  canEdit,
  canCreateTasks,
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
  daysInStatus,
  onSelect,
  onUpdateField,
  onUpdateStatus,
  onOpenActionMenu,
  onAddTask,
}: SpreadsheetRowProps) {
  const statusColor = PROJECT_STATUS_COLORS[project.status];
  const editable = canEdit && !isArchived;

  // ── Image gallery popover ──
  const [showGallery, setShowGallery] = useState(false);
  const galleryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showGallery) return;
    function handleClick(e: MouseEvent) {
      if (galleryRef.current && !galleryRef.current.contains(e.target as Node)) {
        setShowGallery(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showGallery]);

  const visibleColumns = SPREADSHEET_COLUMNS.filter((col) => {
    if (col.permission && !canViewAccounting) return false;
    return columnVisibility[col.id] !== false;
  });

  const handleRowClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, button, [data-no-select]")) return;
    onSelect(project.id, e);
  }, [project.id, onSelect]);

  const images = project.projectImages ?? [];

  const renderCell = (colId: string) => {
    switch (colId) {
      case "actions":
        return (
          <button
            data-no-select
            onClick={(e) => { e.stopPropagation(); onOpenActionMenu(project.id, e); }}
            className="flex items-center justify-center w-6 h-6 rounded-sm text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
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
            value={formatShortAddress(project.address)}
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
        if (totalTasks === 0) return <span className="font-mono text-data-sm text-text-3">—</span>;
        const pct = (completedTasks / totalTasks) * 100;
        return (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-[2px] bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: statusColor }}
              />
            </div>
            <span className="font-mono text-data-sm text-text-2 whitespace-nowrap">
              {completedTasks}/{totalTasks}
            </span>
          </div>
        );
      }

      case "tasks": {
        if (totalTasks === 0) {
          return canCreateTasks ? (
            <button
              data-no-select
              onClick={(e) => { e.stopPropagation(); onAddTask(project.id); }}
              className="flex items-center gap-1 text-text-3 hover:text-text transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span className="font-mohave text-[11px]">Add task</span>
            </button>
          ) : (
            <span className="font-mono text-data-sm text-text-3">—</span>
          );
        }
        return (
          <button
            data-no-select
            onClick={(e) => { e.stopPropagation(); onAddTask(project.id); }}
            className="flex items-center gap-1 text-text-2 hover:text-text transition-colors"
          >
            <span className="font-mono text-data-sm">{totalTasks}</span>
            {canCreateTasks && <Plus className="w-2.5 h-2.5 text-text-mute" />}
          </button>
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
        if (teamMembers.length === 0) return <span className="text-text-3 text-[11px]">—</span>;
        const visible = teamMembers.slice(0, 4);
        const overflow = teamMembers.length - 4;
        return (
          <div className="flex items-center -space-x-1">
            {visible.map((m) => (
              <div
                key={m.id}
                className="w-[18px] h-[18px] rounded-full bg-fill-neutral-dim border border-border-subtle flex items-center justify-center overflow-hidden group relative"
                title={m.name}
              >
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-mono text-[7px] text-text-3 uppercase">
                    {m.name.charAt(0)}
                  </span>
                )}
              </div>
            ))}
            {overflow > 0 && (
              <span className="ml-0.5 font-mono text-micro text-text-3">+{overflow}</span>
            )}
          </div>
        );
      }

      case "images": {
        if (images.length === 0) return <span className="text-text-3 text-[11px]">—</span>;
        const visibleImgs = images.slice(0, 3);
        const overflow = images.length - 3;
        return (
          <div className="relative" ref={galleryRef}>
            <button
              data-no-select
              onClick={(e) => { e.stopPropagation(); setShowGallery(!showGallery); }}
              className="flex items-center -space-x-1 cursor-pointer"
            >
              {visibleImgs.map((url, i) => (
                <div
                  key={i}
                  className="w-[18px] h-[18px] rounded-[2px] bg-fill-neutral-dim border border-border-subtle overflow-hidden"
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
              {overflow > 0 && (
                <span className="ml-0.5 font-mono text-micro text-text-3">+{overflow}</span>
              )}
            </button>

            {showGallery && (
              <div
                className="absolute top-full left-0 mt-1 z-[1000] p-2 rounded-[4px] grid grid-cols-3 gap-1.5 max-w-[240px]"
                style={{
                  background: "var(--surface-glass-dense)",
                  backdropFilter: "blur(28px) saturate(1.3)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                {images.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-[68px] h-[68px] rounded-[2px] overflow-hidden border border-border-subtle hover:border-[rgba(255,255,255,0.18)] transition-colors"
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      }

      case "clientEmail":
        return <span className="truncate text-text-2">{clientEmail || "—"}</span>;

      case "clientPhone":
        return <span className="font-mono text-data-sm text-text-2">{clientPhone || "—"}</span>;

      case "notes": {
        const text = project.notes;
        if (!text) return <span className="text-text-3 text-[11px]">—</span>;
        return (
          <span
            className="font-mohave text-[11px] leading-[14px] text-text-2 line-clamp-2 block"
            title={text}
          >
            {text}
          </span>
        );
      }

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
          <span className="inline-flex px-1.5 py-0.5 rounded-sm bg-[rgba(255,255,255,0.06)] border border-border-subtle font-mono text-micro text-text-3 uppercase tracking-wider">
            Linked
          </span>
        ) : (
          <span className="text-text-3">—</span>
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
        if (!project.createdAt) return <span className="font-mono text-data-sm text-text-3">—</span>;
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
        "hover:bg-fill-neutral-dim/50",
        isSelected && "bg-[rgba(255,255,255,0.08)]",
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
            !col.mono && col.id !== "actions" && "font-mohave text-body-sm text-text",
          )}
        >
          {renderCell(col.id)}
        </td>
      ))}
    </tr>
  );
});
