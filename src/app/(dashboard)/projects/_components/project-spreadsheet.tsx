"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  type Project,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_SORT_ORDER,
} from "@/lib/types/models";
import { useUpdateProject, useUpdateProjectStatus, useDeleteProject } from "@/lib/hooks/use-projects";
import { useWindowStore } from "@/stores/window-store";
import { toast } from "@/components/ui/toast";
import {
  type SpreadsheetSortDirection,
  loadColumnVisibility,
  saveColumnVisibility,
} from "./spreadsheet/spreadsheet-columns";
import { SpreadsheetHeader } from "./spreadsheet/spreadsheet-header";
import { SpreadsheetRow } from "./spreadsheet/spreadsheet-row";
import { getProjectStatusDisplayName } from "./project-stage-stack";

export type SpreadsheetStatusFilter = "active" | "archived" | "closed";

interface ProjectSpreadsheetProps {
  /** All non-deleted, non-archived, non-closed projects (filtered by search/member/client) */
  projects: Project[];
  /** All filtered projects regardless of status — used when statusFilter !== "active" */
  allFilteredProjects: Project[];
  statusFilter: SpreadsheetStatusFilter;
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
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  onAddTask: (projectId: string) => void;
}

export function ProjectSpreadsheet({
  projects,
  allFilteredProjects,
  statusFilter,
  clientNameMap,
  clientEmailMap,
  clientPhoneMap,
  teamMemberMap,
  projectValueMap,
  estimateTotalMap,
  projectTaskCountMap,
  canManage,
  canViewAccounting,
  canCreateTasks,
  canDelete,
  selectedIds,
  onSelectedIdsChange,
  onAddTask,
}: ProjectSpreadsheetProps) {
  const { t } = useDictionary("projects-canvas");
  const updateProjectMutation = useUpdateProject();
  const updateStatusMutation = useUpdateProjectStatus();
  const deleteProjectMutation = useDeleteProject();
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);

  // ── Sort state ──
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SpreadsheetSortDirection>(null);

  // ── Selection ──
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
    let combined: Project[];
    if (statusFilter === "archived") {
      combined = allFilteredProjects.filter((p) => p.status === ProjectStatus.Archived);
    } else if (statusFilter === "closed") {
      combined = allFilteredProjects.filter((p) => p.status === ProjectStatus.Closed);
    } else {
      combined = projects; // active = non-archived, non-closed
    }

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
  }, [projects, allFilteredProjects, statusFilter, sortColumn, sortDirection, clientNameMap, projectValueMap, estimateTotalMap, projectTaskCountMap]);

  // ── Selection handlers ──
  const handleSelect = useCallback((projectId: string, e: React.MouseEvent) => {
    const next = new Set(selectedIds);

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
    onSelectedIdsChange(next);
  }, [selectedIds, displayProjects, onSelectedIdsChange]);

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

  // ── Action menu handlers ──
  const handleOpenActionMenu = useCallback((projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionMenu({ projectId, x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenDetail = useCallback((projectId: string) => {
    const project = displayProjects.find((p) => p.id === projectId);
    if (!project) return;
    openProjectWindow({ projectId, mode: "viewing" });
    setActionMenu(null);
  }, [displayProjects, openProjectWindow]);

  // ── Keyboard ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onSelectedIdsChange(new Set());
        setActionMenu(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onSelectedIdsChange]);

  // ── Counts ──
  const totalCount = allFilteredProjects.length;

  const formatShortAddress = useCallback((address: string | null): string => {
    if (!address) return "—";
    const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
    return parts[0] || "—";
  }, []);

  const formatCurrency = useCallback((value: number): string => {
    if (!value) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }, []);

  // ── Empty state ──
  if (displayProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <span className="font-mohave text-body-sm text-text-3">
          {totalCount > 0 ? t("spreadsheet.empty.filtered") : t("spreadsheet.empty.none")}
        </span>
        {totalCount === 0 && (
          <span className="font-mohave text-body-sm text-text-mute">
            {t("spreadsheet.empty.noneDesc")}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 h-full">
      {/* Mobile list — the spreadsheet data model without the desktop table width. */}
      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto md:hidden">
        {displayProjects.map((project) => {
          const completedTasks = projectTaskCountMap.completed.get(project.id) ?? 0;
          const totalTasks = projectTaskCountMap.total.get(project.id) ?? 0;
          const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : null;
          const statusColor = PROJECT_STATUS_COLORS[project.status];
          const title = project.title || t("card.untitledProject");
          const clientName = clientNameMap.get(project.clientId ?? "") || "—";
          const estimateTotal = estimateTotalMap.get(project.id) ?? 0;
          const invoiceTotal = projectValueMap.get(project.id) ?? 0;

          return (
            <article
              key={project.id}
              className={cn(
                "glass-surface rounded-panel border border-border p-3",
                selectedIds.has(project.id) && "border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.08)]",
                project.status === ProjectStatus.Archived && "opacity-50",
              )}
              style={{ borderLeft: `3px solid ${statusColor}` }}
            >
              <button
                type="button"
                onClick={() => handleOpenDetail(project.id)}
                className="block w-full min-w-0 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mohave text-body text-text">
                    {title}
                  </span>
                  <span className="shrink-0 font-mono text-micro uppercase tracking-wider text-text-3">
                    {getProjectStatusDisplayName(project.status)}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-1 gap-0.5">
                  <span className="truncate font-mohave text-body-sm text-text-2">
                    {clientName}
                  </span>
                  <span className="truncate font-mono text-micro text-text-3">
                    {formatShortAddress(project.address)}
                  </span>
                </div>
              </button>

              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border-subtle pt-2">
                <div>
                  <span className="block font-mono text-micro uppercase tracking-wider text-text-mute">
                    Progress
                  </span>
                  <span className="font-mono text-data-sm text-text-2">
                    {progress == null ? "—" : `${progress}%`}
                  </span>
                </div>
                <div>
                  <span className="block font-mono text-micro uppercase tracking-wider text-text-mute">
                    Tasks
                  </span>
                  <span className="font-mono text-data-sm text-text-2">
                    {totalTasks > 0 ? `${completedTasks}/${totalTasks}` : "—"}
                  </span>
                </div>
                {canViewAccounting ? (
                  <div>
                    <span className="block font-mono text-micro uppercase tracking-wider text-text-mute">
                      Value
                    </span>
                    <span className="font-mono text-data-sm text-text-2">
                      {formatCurrency(invoiceTotal || estimateTotal)}
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="block font-mono text-micro uppercase tracking-wider text-text-mute">
                      ID
                    </span>
                    <span className="font-mono text-data-sm text-text-2">
                      {project.id.slice(0, 4).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center justify-end gap-1">
                {canCreateTasks && (
                  <button
                    type="button"
                    onClick={() => onAddTask(project.id)}
                    className="flex items-center gap-1 rounded-sm border border-border-subtle px-2 py-1 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-text"
                  >
                    <Plus className="h-3 w-3" />
                    Add task
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => handleSelect(project.id, e)}
                  className="rounded-sm border border-border-subtle px-2 py-1 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-text"
                >
                  {selectedIds.has(project.id) ? "Selected" : "Select"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Table with bottom fade */}
      <div className="relative hidden flex-1 min-h-0 md:block">
        <div className="h-full overflow-auto rounded border-y border-r border-border">
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
                  canCreateTasks={canCreateTasks}
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
                  daysInStatus={daysInStatus}
                  onSelect={handleSelect}
                  onUpdateField={handleUpdateField}
                  onUpdateStatus={handleUpdateStatus}
                  onOpenActionMenu={handleOpenActionMenu}
                  onAddTask={onAddTask}
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
        <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
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
          className="fixed z-[1000] min-w-[180px] p-1 rounded-chip"
          style={{
            left: actionMenu.x,
            top: actionMenu.y,
            background: "var(--surface-glass-dense)",
            backdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <ActionMenuItem label={t("actions.openDetail")} onClick={() => handleOpenDetail(actionMenu.projectId)} />
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
        "flex items-center w-full px-2 py-1.5 rounded-bar transition-colors font-mohave text-body-sm",
        danger
          ? "text-brick hover:bg-[rgba(147,50,26,0.1)]"
          : "text-text-2 hover:bg-[rgba(255,255,255,0.06)]"
      )}
    >
      {label}
    </button>
  );
}
