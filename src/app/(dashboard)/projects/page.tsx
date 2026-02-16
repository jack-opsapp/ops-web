"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  CalendarDays,
  MapPin,
  AlertCircle,
  RefreshCw,
  Trash2,
  UserPlus,
  Download,
  ArrowRight,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ops/status-badge";
import { EmptyState } from "@/components/ops/empty-state";
import { UserAvatar } from "@/components/ops/user-avatar";
import { BulkActionBar, type BulkAction } from "@/components/ops/bulk-action-bar";
import { SelectableRow } from "@/components/ops/selectable-row";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { useSelectionStore } from "@/stores/selection-store";
import { useProjects, useUpdateProjectStatus, useDeleteProject } from "@/lib/hooks/use-projects";
import { exportToCSV } from "@/lib/utils/csv-export";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  type Project,
  ProjectStatus,
  isActiveProjectStatus,
  isCompletedProjectStatus,
  getUserFullName,
  getInitials,
} from "@/lib/types/models";

type FilterStatus = "all" | "active" | "completed" | "archived";
type ViewMode = "cards" | "table";

const filterTabs: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

const ALL_PROJECT_STATUSES = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
  ProjectStatus.Archived,
];

/**
 * Map a ProjectStatus enum value to the kebab-case key used by StatusBadge.
 */
function statusToKey(status: ProjectStatus): string {
  switch (status) {
    case ProjectStatus.RFQ:
      return "rfq";
    case ProjectStatus.Estimated:
      return "estimated";
    case ProjectStatus.Accepted:
      return "accepted";
    case ProjectStatus.InProgress:
      return "in-progress";
    case ProjectStatus.Completed:
      return "completed";
    case ProjectStatus.Closed:
      return "closed";
    case ProjectStatus.Archived:
      return "archived";
    default:
      return "rfq";
  }
}

function TeamAvatars({ project }: { project: Project }) {
  const members = project.teamMembers ?? [];
  const memberIds = members.length > 0 ? members : project.teamMemberIds;
  const display = memberIds.slice(0, 3);
  const overflow = memberIds.length - 3;

  if (display.length === 0) {
    return (
      <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
        No team
      </span>
    );
  }

  return (
    <div className="flex items-center -space-x-[6px]">
      {display.map((member, i) => {
        const name =
          typeof member === "object" && member !== null
            ? getUserFullName(member)
            : typeof member === "string"
              ? member.slice(0, 2).toUpperCase()
              : "?";
        const initial =
          typeof member === "object" && member !== null
            ? getInitials(getUserFullName(member))
            : typeof member === "string"
              ? member.charAt(0).toUpperCase()
              : "?";
        return (
          <div
            key={i}
            className="w-[24px] h-[24px] rounded-full bg-ops-accent-muted border-2 border-background-card flex items-center justify-center"
            title={name}
          >
            <span className="font-mohave text-[10px] text-ops-accent">
              {initial}
            </span>
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="w-[24px] h-[24px] rounded-full bg-background-elevated border-2 border-background-card flex items-center justify-center">
          <span className="font-mono text-[9px] text-text-tertiary">+{overflow}</span>
        </div>
      )}
    </div>
  );
}

function ProjectCardContent({ project, onClick }: { project: Project; onClick: () => void }) {
  const clientName = project.client?.name ?? "No Client";

  return (
    <Card variant="interactive" className="p-2 space-y-1.5" onClick={onClick}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-mohave text-card-title text-text-primary truncate">
            {project.title}
          </h3>
          <p className="font-kosugi text-caption-sm text-text-tertiary">{clientName}</p>
        </div>
        <StatusBadge status={statusToKey(project.status) as any} />
      </div>

      {project.address && (
        <div className="flex items-center gap-[6px] text-text-tertiary">
          <MapPin className="w-[14px] h-[14px] shrink-0" />
          <span className="font-mohave text-body-sm truncate">{project.address}</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-[4px] border-t border-border-subtle">
        <TeamAvatars project={project} />
        <div className="flex items-center gap-[6px] text-text-tertiary">
          <CalendarDays className="w-[13px] h-[13px]" />
          <span className="font-mono text-[11px]">
            {project.startDate
              ? new Date(project.startDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              : "No date"}
            {project.endDate && (
              <>
                {" - "}
                {new Date(project.endDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}

function ProjectTableRowContent({ project, onClick }: { project: Project; onClick: () => void }) {
  const clientName = project.client?.name ?? "No Client";

  return (
    <tr
      onClick={onClick}
      className="border-b border-border-subtle hover:bg-background-elevated cursor-pointer transition-colors"
    >
      <td className="px-1.5 py-1">
        <span className="font-mohave text-body text-text-primary">{project.title}</span>
      </td>
      <td className="px-1.5 py-1">
        <span className="font-mohave text-body-sm text-text-secondary">{clientName}</span>
      </td>
      <td className="px-1.5 py-1">
        <StatusBadge status={statusToKey(project.status) as any} />
      </td>
      <td className="px-1.5 py-1">
        <TeamAvatars project={project} />
      </td>
      <td className="px-1.5 py-1">
        <span className="font-mono text-data-sm text-text-tertiary">
          {project.startDate
            ? new Date(project.startDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "--"}
        </span>
      </td>
    </tr>
  );
}

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "cards") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-background-card border border-border rounded-lg p-2 space-y-1.5 animate-pulse">
            <div className="h-[18px] bg-background-elevated rounded w-3/4" />
            <div className="h-[14px] bg-background-elevated rounded w-1/2" />
            <div className="h-[14px] bg-background-elevated rounded w-full" />
            <div className="flex justify-between pt-1">
              <div className="flex -space-x-1">
                {[1, 2].map((j) => (
                  <div key={j} className="w-[24px] h-[24px] rounded-full bg-background-elevated" />
                ))}
              </div>
              <div className="h-[14px] bg-background-elevated rounded w-[80px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[48px] bg-background-card border border-border rounded" />
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-[64px] h-[64px] rounded-lg bg-ops-error-muted flex items-center justify-center mb-2">
        <AlertCircle className="w-[32px] h-[32px] text-ops-error" />
      </div>
      <h3 className="font-mohave text-heading text-text-primary">Failed to load projects</h3>
      <p className="font-kosugi text-caption text-text-tertiary mt-0.5 max-w-[300px]">
        {message}
      </p>
      <Button variant="secondary" className="mt-3 gap-[6px]" onClick={onRetry}>
        <RefreshCw className="w-[16px] h-[16px]" />
        Retry
      </Button>
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

  const {
    selectedIds,
    isSelecting,
    selectAll,
    clearSelection,
    toggleSelection,
  } = useSelectionStore();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useProjects();

  const updateStatus = useUpdateProjectStatus();
  const deleteProject = useDeleteProject();

  const projects = data?.projects ?? [];

  const filteredProjects = useMemo(() => {
    let filtered = [...projects];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(query) ||
          p.client?.name?.toLowerCase().includes(query) ||
          p.address?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter === "active") {
      filtered = filtered.filter((p) => isActiveProjectStatus(p.status));
    } else if (statusFilter === "completed") {
      filtered = filtered.filter(
        (p) =>
          p.status === ProjectStatus.Completed || p.status === ProjectStatus.Closed
      );
    } else if (statusFilter === "archived") {
      filtered = filtered.filter((p) => p.status === ProjectStatus.Archived);
    }

    return filtered;
  }, [projects, searchQuery, statusFilter]);

  const filteredIds = useMemo(
    () => filteredProjects.map((p) => p.id),
    [filteredProjects]
  );

  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  const someFilteredSelected =
    filteredIds.some((id) => selectedIds.has(id)) && !allFilteredSelected;

  // Keyboard shortcut: Escape to clear selection
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isSelecting) {
        clearSelection();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSelecting, clearSelection]);

  // Clear selection when filters change
  useEffect(() => {
    clearSelection();
  }, [searchQuery, statusFilter, clearSelection]);

  // --- Bulk Action Handlers ---

  const handleBulkStatusChange = useCallback(
    (ids: string[], newStatus: ProjectStatus) => {
      for (const id of ids) {
        updateStatus.mutate({ id, status: newStatus });
      }
      clearSelection();
      setStatusDropdownOpen(false);
    },
    [updateStatus, clearSelection]
  );

  const handleBulkDelete = useCallback(
    (ids: string[]) => {
      setPendingDeleteIds(ids);
      setDeleteConfirmOpen(true);
    },
    []
  );

  const confirmBulkDelete = useCallback(() => {
    for (const id of pendingDeleteIds) {
      deleteProject.mutate(id);
    }
    clearSelection();
    setDeleteConfirmOpen(false);
    setPendingDeleteIds([]);
  }, [pendingDeleteIds, deleteProject, clearSelection]);

  const handleBulkExport = useCallback(
    (ids: string[]) => {
      const selected = projects.filter((p) => ids.includes(p.id));
      exportToCSV(
        selected.map((p) => ({
          title: p.title,
          client: p.client?.name ?? "",
          status: p.status,
          address: p.address ?? "",
          startDate: p.startDate
            ? new Date(p.startDate).toLocaleDateString()
            : "",
          endDate: p.endDate
            ? new Date(p.endDate).toLocaleDateString()
            : "",
          teamSize: String(p.teamMemberIds.length),
          notes: p.notes ?? "",
        })),
        [
          { key: "title", header: "Project" },
          { key: "client", header: "Client" },
          { key: "status", header: "Status" },
          { key: "address", header: "Address" },
          { key: "startDate", header: "Start Date" },
          { key: "endDate", header: "End Date" },
          { key: "teamSize", header: "Team Size" },
          { key: "notes", header: "Notes" },
        ],
        `ops-projects-${new Date().toISOString().split("T")[0]}`
      );
    },
    [projects]
  );

  const handleSelectAllToggle = useCallback(() => {
    if (allFilteredSelected) {
      clearSelection();
    } else {
      selectAll(filteredIds);
    }
  }, [allFilteredSelected, clearSelection, selectAll, filteredIds]);

  // --- Bulk Actions Config ---

  const bulkActions: BulkAction[] = [
    {
      id: "status",
      label: "Status",
      icon: ArrowRight,
      onClick: () => setStatusDropdownOpen(true),
    },
    {
      id: "export",
      label: "Export",
      icon: Download,
      onClick: handleBulkExport,
    },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      variant: "destructive",
      onClick: handleBulkDelete,
    },
  ];

  const noDataAvailable = !isLoading && projects.length === 0 && !isError;

  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
            PROJECTS
          </h1>
          <p className="font-kosugi text-caption-sm text-text-tertiary">
            {isLoading
              ? "Loading projects..."
              : `${projects.length} total project${projects.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* Select mode toggle */}
          {filteredProjects.length > 0 && !isLoading && (
            <Button
              variant={isSelecting ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                if (isSelecting) {
                  clearSelection();
                } else {
                  // Enter selection mode by selecting first item
                  toggleSelection(filteredIds[0]);
                }
              }}
              className="gap-[4px]"
            >
              <CheckSquare className="w-[14px] h-[14px]" />
              {isSelecting ? "Cancel" : "Select"}
            </Button>
          )}
          <Button className="gap-[6px]" onClick={() => router.push("/projects/new")}>
            <Plus className="w-[16px] h-[16px]" />
            New Project
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 max-w-[400px]">
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            prefixIcon={<Search className="w-[16px] h-[16px]" />}
          />
        </div>

        <div className="flex items-center gap-1">
          {/* Status tabs */}
          <div className="flex items-center bg-background-card border border-border rounded overflow-hidden">
            {filterTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  "px-1.5 py-[8px] font-mohave text-body-sm transition-all",
                  statusFilter === tab.value
                    ? "bg-ops-accent-muted text-ops-accent"
                    : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div className="flex items-center border border-border rounded overflow-hidden">
            <button
              onClick={() => setViewMode("cards")}
              className={cn(
                "p-[8px] transition-all",
                viewMode === "cards"
                  ? "bg-ops-accent-muted text-ops-accent"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
              title="Card view"
            >
              <LayoutGrid className="w-[16px] h-[16px]" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "p-[8px] transition-all",
                viewMode === "table"
                  ? "bg-ops-accent-muted text-ops-accent"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
              title="Table view"
            >
              <List className="w-[16px] h-[16px]" />
            </button>
          </div>
        </div>
      </div>

      {/* Select All bar (visible when in selection mode) */}
      {isSelecting && filteredProjects.length > 0 && (
        <div className="flex items-center gap-1.5 px-1.5 py-1 bg-background-card border border-border rounded-lg animate-fade-in">
          <Checkbox
            checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
            onCheckedChange={handleSelectAllToggle}
            aria-label="Select all projects"
          />
          <span className="font-mohave text-body-sm text-text-secondary">
            {allFilteredSelected
              ? `All ${filteredIds.length} projects selected`
              : `Select all ${filteredIds.length} projects`}
          </span>
          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="ml-auto font-mohave text-body-sm text-ops-accent hover:text-ops-accent-hover transition-colors"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton viewMode={viewMode} />
      ) : isError ? (
        <ErrorState
          message={
            error instanceof Error
              ? error.message
              : "Something went wrong. Please try again."
          }
          onRetry={() => refetch()}
        />
      ) : noDataAvailable && !searchQuery && statusFilter === "all" ? (
        <EmptyState
          icon={<LayoutGrid className="w-[48px] h-[48px]" />}
          title="No projects yet"
          description="Create your first project to start tracking work, schedules, and team assignments."
          action={{
            label: "New Project",
            onClick: () => router.push("/projects/new"),
          }}
        />
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-6">
          <p className="font-mohave text-body text-text-tertiary">
            No projects match your search
          </p>
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {filteredProjects.map((project) => (
            <SelectableRow
              key={project.id}
              id={project.id}
              allIds={filteredIds}
              selectionActive={isSelecting}
              onClick={() => router.push(`/projects/${project.id}`)}
              className="rounded-lg"
            >
              <ProjectCardContent
                project={project}
                onClick={() => {
                  if (!isSelecting) {
                    router.push(`/projects/${project.id}`);
                  }
                }}
              />
            </SelectableRow>
          ))}
        </div>
      ) : (
        <div className="bg-background-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {/* Checkbox column header */}
                {isSelecting && (
                  <th className="px-1 py-1 w-[40px]">
                    <Checkbox
                      checked={
                        allFilteredSelected
                          ? true
                          : someFilteredSelected
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={handleSelectAllToggle}
                      aria-label="Select all"
                    />
                  </th>
                )}
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Project
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Client
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Status
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Team
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Start Date
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => {
                const isChecked = selectedIds.has(project.id);
                const clientName = project.client?.name ?? "No Client";

                return (
                  <tr
                    key={project.id}
                    onClick={() => {
                      if (isSelecting) {
                        toggleSelection(project.id);
                      } else {
                        router.push(`/projects/${project.id}`);
                      }
                    }}
                    className={cn(
                      "border-b border-border-subtle hover:bg-background-elevated cursor-pointer transition-colors",
                      isChecked && "bg-ops-accent/[0.06]"
                    )}
                  >
                    {/* Checkbox cell */}
                    {isSelecting && (
                      <td className="px-1 py-1 w-[40px]">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleSelection(project.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${project.title}`}
                        />
                      </td>
                    )}
                    <td className="px-1.5 py-1">
                      <span className="font-mohave text-body text-text-primary">
                        {project.title}
                      </span>
                    </td>
                    <td className="px-1.5 py-1">
                      <span className="font-mohave text-body-sm text-text-secondary">
                        {clientName}
                      </span>
                    </td>
                    <td className="px-1.5 py-1">
                      <StatusBadge status={statusToKey(project.status) as any} />
                    </td>
                    <td className="px-1.5 py-1">
                      <TeamAvatars project={project} />
                    </td>
                    <td className="px-1.5 py-1">
                      <span className="font-mono text-data-sm text-text-tertiary">
                        {project.startDate
                          ? new Date(project.startDate).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "--"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar actions={bulkActions} entityName="project" />

      {/* Status Change Dropdown (anchored to a hidden trigger) */}
      <DropdownMenu
        open={statusDropdownOpen}
        onOpenChange={setStatusDropdownOpen}
      >
        <DropdownMenuTrigger asChild>
          <button className="sr-only" aria-hidden="true" tabIndex={-1} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          side="top"
          className="min-w-[200px]"
          style={{
            position: "fixed",
            bottom: "80px",
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <DropdownMenuLabel>Change Status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ALL_PROJECT_STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              onClick={() =>
                handleBulkStatusChange(Array.from(selectedIds), status)
              }
            >
              <StatusBadge status={statusToKey(status) as any} />
              <span className="ml-1">{status}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`Delete ${pendingDeleteIds.length} project${pendingDeleteIds.length !== 1 ? "s" : ""}?`}
        description={`This will permanently remove ${pendingDeleteIds.length} project${pendingDeleteIds.length !== 1 ? "s" : ""} and all associated tasks. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmBulkDelete}
        loading={deleteProject.isPending}
      />
    </div>
  );
}
