"use client";

import { useEffect, useRef, useCallback } from "react";
import { ExternalLink, Plus, Receipt, Archive, Trash2, ArrowRightLeft } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { useProjectCanvasStore } from "./project-canvas-store";
import { getProjectStatusDisplayName } from "./project-stage-stack";

// ── All statuses for the submenu ──
const ALL_STATUSES: ProjectStatus[] = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
];

interface ProjectContextMenuProps {
  canManage: boolean;
  canCreateTasks: boolean;
  canRecordPayment: boolean;
  canDelete: boolean;
  onOpenDetail: (projectId: string) => void;
  onAddTask: (projectId: string) => void;
  onRecordPayment: (projectId: string) => void;
  onArchive: (projectIds: string[]) => void;
  onDelete: (projectIds: string[]) => void;
  onChangeStatus: (projectIds: string[], status: ProjectStatus) => void;
}

export function ProjectContextMenu({
  canManage,
  canCreateTasks,
  canRecordPayment,
  canDelete,
  onOpenDetail,
  onAddTask,
  onRecordPayment,
  onArchive,
  onDelete,
  onChangeStatus,
}: ProjectContextMenuProps) {
  const { t } = useDictionary("projects-canvas");
  const contextMenu = useProjectCanvasStore((s) => s.contextMenu);
  const hideContextMenu = useProjectCanvasStore((s) => s.hideContextMenu);
  const selectedCardIds = useProjectCanvasStore((s) => s.selectedCardIds);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu();
      }
    }
    if (contextMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [contextMenu, hideContextMenu]);

  if (!contextMenu || !contextMenu.visible) return null;

  const isMulti = contextMenu.type === "selection" && selectedCardIds.size > 1;
  const targetIds = isMulti
    ? Array.from(selectedCardIds)
    : contextMenu.targetCardId
      ? [contextMenu.targetCardId]
      : [];

  if (targetIds.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[3000] min-w-[180px] py-1 rounded-chip"
      style={{
        left: contextMenu.x,
        top: contextMenu.y,
        background: "rgba(18,18,18,0.95)",
        backdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      {/* Open detail (single card only) */}
      {!isMulti && (
        <MenuItem
          icon={<ExternalLink className="w-3.5 h-3.5" />}
          label={t("actions.openDetail")}
          onClick={() => { onOpenDetail(targetIds[0]); hideContextMenu(); }}
        />
      )}

      {/* Add task (single card only) */}
      {!isMulti && canCreateTasks && (
        <MenuItem
          icon={<Plus className="w-3.5 h-3.5" />}
          label={t("actions.addTask")}
          onClick={() => { onAddTask(targetIds[0]); hideContextMenu(); }}
        />
      )}

      {/* Record payment (single card only) */}
      {!isMulti && canRecordPayment && (
        <MenuItem
          icon={<Receipt className="w-3.5 h-3.5" />}
          label={t("actions.recordPayment")}
          onClick={() => { onRecordPayment(targetIds[0]); hideContextMenu(); }}
        />
      )}

      {/* Divider */}
      <div className="my-1 h-[1px] bg-[rgba(255,255,255,0.06)]" />

      {/* Change status submenu */}
      {canManage && (
        <div className="group relative">
          <MenuItem
            icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
            label={t("actions.changeStatus")}
            hasSubmenu
          />
          <div
            className="absolute left-full top-0 min-w-[140px] py-1 rounded-chip hidden group-hover:block"
            style={{
              background: "rgba(18,18,18,0.95)",
              backdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              marginLeft: 2,
            }}
          >
            {ALL_STATUSES.map((status) => (
              <button
                key={status}
                onClick={() => { onChangeStatus(targetIds, status); hideContextMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-100"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: PROJECT_STATUS_COLORS[status] }}
                />
                <span className="font-mohave text-body-sm text-text-2">
                  {getProjectStatusDisplayName(status)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Archive */}
      {canManage && (
        <MenuItem
          icon={<Archive className="w-3.5 h-3.5" />}
          label={t("actions.archive")}
          onClick={() => { onArchive(targetIds); hideContextMenu(); }}
        />
      )}

      {/* Delete */}
      {canDelete && (
        <>
          <div className="my-1 h-[1px] bg-[rgba(255,255,255,0.06)]" />
          <MenuItem
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label={t("actions.delete")}
            destructive
            onClick={() => { onDelete(targetIds); hideContextMenu(); }}
          />
        </>
      )}
    </div>
  );
}

// ── Menu item primitive ──

function MenuItem({
  icon,
  label,
  onClick,
  destructive = false,
  hasSubmenu = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  destructive?: boolean;
  hasSubmenu?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100 ${
        destructive
          ? "text-brick hover:bg-ops-error-muted"
          : "text-text-2 hover:bg-[rgba(255,255,255,0.06)] hover:text-text"
      }`}
    >
      {icon}
      <span className="font-mohave text-body-sm flex-1">{label}</span>
      {hasSubmenu && (
        <span className="text-text-mute text-micro">▸</span>
      )}
    </button>
  );
}
