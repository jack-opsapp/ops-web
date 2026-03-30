"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  type Project,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_SORT_ORDER,
} from "@/lib/types/models";
import { useUpdateProject, useUpdateProjectStatus, useDeleteProject } from "@/lib/hooks/use-projects";
import { useProjectDetailPopoverStore } from "./project-detail-popover-store";
import { toast } from "@/components/ui/toast";
import {
  type SpreadsheetSortDirection,
  loadColumnVisibility,
  saveColumnVisibility,
} from "./spreadsheet/spreadsheet-columns";
import { SpreadsheetHeader } from "./spreadsheet/spreadsheet-header";
import { SpreadsheetRow } from "./spreadsheet/spreadsheet-row";
import { SpreadsheetBulkBar } from "./spreadsheet/spreadsheet-bulk-bar";

interface ProjectSpreadsheetProps {
  projects: Project[];
  archivedProjects: Project[];
  showArchived: boolean;
  clientNameMap: Map<string, string>;
  clientEmailMap: Map<string, string>;
  clientPhoneMap: Map<string, string>;
  teamMemberMap: Map<string, { id: string; name: string; avatarUrl?: string }>;
  projectValueMap: Map<string, number>;
  estimateTotalMap: Map<string, number>;
  projectTaskCountMap: { total: Map<string, number>; completed: Map<string, number> };
  canManage: boolean;
  canViewAccounting: boolean;
  canCreateTasks: boolean;
  canRecordPayment: boolean;
  canDelete: boolean;
}

export function ProjectSpreadsheet({
  projects,
  archivedProjects,
  showArchived,
  clientNameMap,
  clientEmailMap,
  clientPhoneMap,
  teamMemberMap,
  projectValueMap,
  estimateTotalMap,
  projectTaskCountMap,
  canManage,
  canViewAccounting,
  canDelete,
}: ProjectSpreadsheetProps) {
  const { t } = useDictionary("projects-canvas");
  const updateProjectMutation = useUpdateProject();
  const updateStatusMutation = useUpdateProjectStatus();
  const deleteProjectMutation = useDeleteProject();
  const openPopover = useProjectDetailPopoverStore((s) => s.openPopover);

  // ── Sort state ──
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SpreadsheetSortDirection>(null);

  // ── Selection state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);

  // ── Column visibility ──
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(loadColumnVisibility);

  const handleColumnVisibilityChange = useCallback((vis: Record<string, boolean>) => {
    setColumnVisibility(vis);
    saveColumnVisibility(vis);
  }, []);

  // ── Action menu state ──
  const [actionMenu, setActionMenu] = useState<{ projectId: string; x: number; y: number } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionMenu) return;
    function handleClick(e: MouseEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [actionMenu]);

  // ── Sort handler ──
  const handleSort = useCallback((columnId: string) => {
    if (sortColumn !== columnId) {
      setSortColumn(columnId);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else {
      setSortColumn(null);
      setSortDirection(null);
    }
  }, [sortColumn, sortDirection]);

  // ── Sorted projects ──
  const displayProjects = useMemo(() => {
    const combined = showArchived ? [...projects, ...archivedProjects] : projects;

    if (!sortColumn || !sortDirection) return combined;

    const dir = sortDirection === "asc" ? 1 : -1;

    return [...combined].sort((a, b) => {
      switch (sortColumn) {
        case "title":
          return dir * (a.title ?? "").localeCompare(b.title ?? "");
        case "client": {
          const ca = clientNameMap.get(a.clientId ?? "") ?? "";
          const cb = clientNameMap.get(b.clientId ?? "") ?? "";
          return dir * ca.localeCompare(cb);
        }
        case "address":
          return dir * (a.address ?? "").localeCompare(b.address ?? "");
        case "startDate": {
          const da = a.startDate ? new Date(a.startDate).getTime() : (dir > 0 ? Infinity : -Infinity);
          const db = b.startDate ? new Date(b.startDate).getTime() : (dir > 0 ? Infinity : -Infinity);
          return dir * (da - db);
        }
        case "endDate": {
          const da = a.endDate ? new Date(a.endDate).getTime() : (dir > 0 ? Infinity : -Infinity);
          const db = b.endDate ? new Date(b.endDate).getTime() : (dir > 0 ? Infinity : -Infinity);
          return dir * (da - db);
        }
        case "status":
          return dir * ((PROJECT_STATUS_SORT_ORDER[a.status] ?? 0) - (PROJECT_STATUS_SORT_ORDER[b.status] ?? 0));
        case "progress": {
          const pa = (projectTaskCountMap.total.get(a.id) ?? 0) > 0
            ? (projectTaskCountMap.completed.get(a.id) ?? 0) / (projectTaskCountMap.total.get(a.id) ?? 1)
            : 0;
          const pb = (projectTaskCountMap.total.get(b.id) ?? 0) > 0
            ? (projectTaskCountMap.completed.get(b.id) ?? 0) / (projectTaskCountMap.total.get(b.id) ?? 1)
            : 0;
          return dir * (pa - pb);
        }
        case "estimateTotal":
          return dir * ((estimateTotalMap.get(a.id) ?? 0) - (estimateTotalMap.get(b.id) ?? 0));
        case "invoiceTotal":
          return dir * ((projectValueMap.get(a.id) ?? 0) - (projectValueMap.get(b.id) ?? 0));
        case "duration":
          return dir * ((a.duration ?? 0) - (b.duration ?? 0));
        case "photos":
          return dir * ((a.projectImages?.length ?? 0) - (b.projectImages?.length ?? 0));
        case "daysInStatus": {
          const daysA = a.createdAt ? Math.floor((Date.now() - new Date(a.createdAt).getTime()) / 86400000) : 0;
          const daysB = b.createdAt ? Math.floor((Date.now() - new Date(b.createdAt).getTime()) / 86400000) : 0;
          return dir * (daysA - daysB);
        }
        case "created": {
          const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dir * (ca - cb);
        }
        default:
          return 0;
      }
    });
  }, [projects, archivedProjects, showArchived, sortColumn, sortDirection, clientNameMap, projectValueMap, estimateTotalMap, projectTaskCountMap]);

  // ── Selection handlers ──
  const handleSelect = useCallback((projectId: string, e: React.MouseEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (e.shiftKey && lastSelectedRef.current) {
        const allIds = displayProjects.map((p) => p.id);
        const startIdx = allIds.indexOf(lastSelectedRef.current);
        const endIdx = allIds.indexOf(projectId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = from; i <= to; i++) {
            next.add(allIds[i]);
          }
        }
      } else if (e.metaKey || e.ctrlKey) {
        if (next.has(projectId)) next.delete(projectId);
        else next.add(projectId);
      } else {
        if (next.size === 1 && next.has(projectId)) {
          next.clear();
        } else {
          next.clear();
          next.add(projectId);
        }
      }

      lastSelectedRef.current = projectId;
      return next;
    });
  }, [displayProjects]);

  // ── Field update (uses existing useUpdateProject: { id, data }) ──
  const handleUpdateField = useCallback((projectId: string, field: string, value: unknown) => {
    updateProjectMutation.mutate({ id: projectId, data: { [field]: value } as Partial<Project> });
  }, [updateProjectMutation]);

  // ── Status update ──
  const handleUpdateStatus = useCallback((projectId: string, status: ProjectStatus) => {
    updateStatusMutation.mutate({ id: projectId, status }, {
      onSuccess: () => toast.success(t("status.updated")),
      onError: () => toast.error(t("status.failed")),
    });
  }, [updateStatusMutation, t]);

  // ── Bulk actions ──
  const handleBulkChangeStatus = useCallback((status: ProjectStatus) => {
    for (const id of selectedIds) {
      updateStatusMutation.mutate({ id, status });
    }
    setSelectedIds(new Set());
  }, [selectedIds, updateStatusMutation]);

  const handleBulkArchive = useCallback(() => {
    for (const id of selectedIds) {
      updateStatusMutation.mutate({ id, status: ProjectStatus.Archived });
    }
    setSelectedIds(new Set());
  }, [selectedIds, updateStatusMutation]);

  const handleBulkDelete = useCallback(() => {
    for (const id of selectedIds) {
      deleteProjectMutation.mutate(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, deleteProjectMutation]);

  // ── Action menu handlers ──
  const handleOpenActionMenu = useCallback((projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionMenu({ projectId, x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenDetail = useCallback((projectId: string) => {
    const project = displayProjects.find((p) => p.id === projectId);
    if (!project) return;
    const label = project.title || project.address?.split(",")[0] || "Untitled Project";
    const color = PROJECT_STATUS_COLORS[project.status];
    openPopover(projectId, { x: window.innerWidth * 0.6, y: 200 }, label, color);
    setActionMenu(null);
  }, [displayProjects, openPopover]);

  // ── Keyboard ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        setActionMenu(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Counts ──
  const totalCount = projects.length + archivedProjects.length;

  // ── Empty state ──
  if (displayProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <span className="font-mohave text-body-sm text-text-tertiary">
          {totalCount > 0 ? t("spreadsheet.empty.filtered") : t("spreadsheet.empty.none")}
        </span>
        {totalCount === 0 && (
          <span className="font-mohave text-body-sm text-text-disabled">
            {t("spreadsheet.empty.noneDesc")}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 h-full">
      {/* Bulk action bar */}
      <SpreadsheetBulkBar
        selectedCount={selectedIds.size}
        canManage={canManage}
        canDelete={canDelete}
        onChangeStatus={handleBulkChangeStatus}
        onArchive={handleBulkArchive}
        onDelete={handleBulkDelete}
        onClear={() => setSelectedIds(new Set())}
      />

      {/* Table with bottom fade */}
      <div className="relative flex-1 min-h-0">
        <div className="h-full overflow-auto rounded border border-border">
          <table className="w-full border-collapse">
            <SpreadsheetHeader
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={handleColumnVisibilityChange}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              canViewAccounting={canViewAccounting}
            />
          <tbody>
            {displayProjects.map((project) => {
              const members = (project.teamMemberIds ?? [])
                .map((id) => teamMemberMap.get(id))
                .filter(Boolean) as { id: string; name: string; avatarUrl?: string }[];

              const daysInStatus = project.createdAt
                ? Math.floor((Date.now() - new Date(project.createdAt).getTime()) / 86400000)
                : 0;

              return (
                <SpreadsheetRow
                  key={project.id}
                  project={project}
                  isSelected={selectedIds.has(project.id)}
                  isArchived={project.status === ProjectStatus.Archived}
                  canEdit={canManage}
                  canViewAccounting={canViewAccounting}
                  columnVisibility={columnVisibility}
                  clientName={clientNameMap.get(project.clientId ?? "") ?? ""}
                  clientEmail={clientEmailMap.get(project.clientId ?? "") ?? ""}
                  clientPhone={clientPhoneMap.get(project.clientId ?? "") ?? ""}
                  estimateTotal={estimateTotalMap.get(project.id) ?? 0}
                  invoiceTotal={projectValueMap.get(project.id) ?? 0}
                  completedTasks={projectTaskCountMap.completed.get(project.id) ?? 0}
                  totalTasks={projectTaskCountMap.total.get(project.id) ?? 0}
                  teamMembers={members}
                  photoCount={project.projectImages?.length ?? 0}
                  daysInStatus={daysInStatus}
                  onSelect={handleSelect}
                  onUpdateField={handleUpdateField}
                  onUpdateStatus={handleUpdateStatus}
                  onOpenActionMenu={handleOpenActionMenu}
                />
              );
            })}
            </tbody>
          </table>
        </div>
        {/* Bottom fade gradient */}
        <div
          className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: "linear-gradient(to bottom, transparent, #0A0A0A)" }}
        />
      </div>

      {/* Footer */}
      <div className="px-2 py-1 flex justify-end">
        <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider">
          {t("spreadsheet.footer.showing")
            .replace("{count}", String(displayProjects.length))
            .replace("{total}", String(totalCount))}
          {displayProjects.length < totalCount && ` ${t("spreadsheet.footer.filtered")}`}
        </span>
      </div>

      {/* Action menu */}
      {actionMenu && (
        <div
          ref={actionMenuRef}
          className="fixed z-[1000] min-w-[180px] p-1 rounded-[4px]"
          style={{
            left: actionMenu.x,
            top: actionMenu.y,
            background: "rgba(10,10,10,0.95)",
            backdropFilter: "blur(20px) saturate(1.2)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <ActionMenuItem label={t("actions.openDetail")} onClick={() => handleOpenDetail(actionMenu.projectId)} />
          <ActionMenuItem label="View Full Page" onClick={() => { window.location.href = `/projects/${actionMenu.projectId}`; setActionMenu(null); }} />
          {canManage && (
            <>
              <div className="h-px bg-border-subtle my-0.5" />
              <ActionMenuItem label={t("actions.archive")} onClick={() => { handleUpdateStatus(actionMenu.projectId, ProjectStatus.Archived); setActionMenu(null); }} />
            </>
          )}
          {canDelete && (
            <ActionMenuItem
              label={t("actions.delete")}
              danger
              onClick={() => { deleteProjectMutation.mutate(actionMenu.projectId); setActionMenu(null); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActionMenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center w-full px-2 py-1.5 rounded-[2px] transition-colors font-mohave text-body-sm",
        danger
          ? "text-[#93321A] hover:bg-[rgba(147,50,26,0.1)]"
          : "text-text-secondary hover:bg-[rgba(255,255,255,0.06)]"
      )}
    >
      {label}
    </button>
  );
}
