"use client";

import { useState, useCallback, useMemo, useEffect, useRef, memo } from "react";
import { Loader2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { trackScreenView } from "@/lib/analytics/analytics";
import { toast } from "@/components/ui/toast";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useWindowStore } from "@/stores/window-store";
import {
  useScopedProjects,
  useUpdateProjectStatus,
  useDeleteProject,
} from "@/lib/hooks/use-projects";
import { useClients } from "@/lib/hooks/use-clients";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useInvoices, useProjectMetrics, useTasks, useEstimates } from "@/lib/hooks";
import { MetricsHeader } from "@/components/metrics";
import {
  type Project,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

import {
  useProjectCanvasStore,
  CARD_WIDTH,
  CARD_HEIGHT,
  BIRD_EYE_THRESHOLD,
} from "./_components/project-canvas-store";
import { calculateProjectCanvasLayout } from "./_components/project-layout-engine";
import { calculateBatchProjectStaleness } from "./_components/project-staleness";
import { ProjectCanvas } from "./_components/project-canvas";
import { ProjectStageStack, getProjectStatusDisplayName } from "./_components/project-stage-stack";
import { ProjectTerminalRegion } from "./_components/project-terminal-region";
import { ProjectCard } from "./_components/project-card";
import { ProjectCardExpanded } from "./_components/project-card-expanded";
import { ProjectDragOverlay } from "./_components/project-drag-overlay";
import { ProjectMarqueeSelect, isCardInMarquee } from "./_components/project-marquee-select";
import { ProjectContextMenu } from "./_components/project-context-menu";
import { ProjectArchiveTray } from "./_components/project-archive-tray";
import { ProjectFloatingToolbar } from "./_components/project-floating-toolbar";
import { ProjectDragConfirmation } from "./_components/project-drag-confirmation";
import { ProjectSpreadsheet } from "./_components/project-spreadsheet";
import { ProjectsTableShell } from "./_components/table-v2/projects-table-shell";
import { useProjectsTableV2Flag } from "@/lib/hooks/projects-table/use-projects-table-v2-flag";
import { useSetupGate } from "@/hooks/useSetupGate";
import { SetupInterceptionModal } from "@/components/setup/SetupInterceptionModal";

// ── Per-card wrapper — prevents parent re-renders on store changes ──
const ProjectCardWrapper = memo(function ProjectCardWrapper({
  project,
  clientName,
  statusColor,
  stalenessOpacity,
  canManage,
  canViewAccounting,
  canCreateTasks,
  canRecordPayment,
  projectValue,
  completedTasks,
  totalTasks,
  teamMembers,
  isBirdEye,
  onOpenDetail,
  onAddTask,
  onRecordPayment,
  onArchive,
}: {
  project: Project;
  clientName: string;
  statusColor: string;
  stalenessOpacity: number;
  canManage: boolean;
  canViewAccounting: boolean;
  canCreateTasks: boolean;
  canRecordPayment: boolean;
  projectValue: number;
  completedTasks: number;
  totalTasks: number;
  teamMembers: { id: string; name: string; avatarUrl?: string }[];
  isBirdEye: boolean;
  onOpenDetail: (projectId: string) => void;
  onAddTask: (projectId: string) => void;
  onRecordPayment: (projectId: string) => void;
  onArchive: (projectId: string) => void;
}) {
  const isSelected = useProjectCanvasStore((s) => s.selectedCardIds.has(project.id));
  const isExpanded = useProjectCanvasStore((s) => s.expandedCardIds.has(project.id));
  const isHovered = useProjectCanvasStore((s) => s.hoveredCardId === project.id);
  const toggleCardExpanded = useProjectCanvasStore((s) => s.toggleCardExpanded);
  const setHoveredCard = useProjectCanvasStore((s) => s.setHoveredCard);
  const toggleCardSelected = useProjectCanvasStore((s) => s.toggleCardSelected);
  const showContextMenu = useProjectCanvasStore((s) => s.showContextMenu);

  const daysInStatus = useMemo(() => {
    const ref = project.createdAt ?? project.startDate;
    if (!ref) return 0;
    return Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24));
  }, [project.createdAt, project.startDate]);

  return (
    <ProjectCard
      project={project}
      clientName={clientName}
      statusColor={statusColor}
      stalenessOpacity={stalenessOpacity}
      isSelected={isSelected}
      isExpanded={isExpanded}
      isHovered={isHovered}
      isBirdEye={isBirdEye}
      canManage={canManage}
      canViewAccounting={canViewAccounting}
      projectValue={projectValue}
      completedTasks={completedTasks}
      totalTasks={totalTasks}
      onToggleExpand={() => toggleCardExpanded(project.id)}
      onHover={() => setHoveredCard(project.id)}
      onHoverEnd={() => setHoveredCard(null)}
      onSelect={() => toggleCardSelected(project.id)}
      onContextMenu={(e) => {
        showContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          type: "card",
          targetCardId: project.id,
          status: project.status,
        });
      }}
      expandedContent={
        <ProjectCardExpanded
          project={project}
          canManage={canManage}
          canCreateTasks={canCreateTasks}
          canRecordPayment={canRecordPayment}
          completedTasks={completedTasks}
          totalTasks={totalTasks}
          teamMembers={teamMembers}
          statusDisplayName={getProjectStatusDisplayName(project.status)}
          daysInStatus={daysInStatus}
          onOpenDetail={() => onOpenDetail(project.id)}
          onAddTask={() => onAddTask(project.id)}
          onRecordPayment={() => onRecordPayment(project.id)}
          onArchive={() => onArchive(project.id)}
        />
      }
    />
  );
});

// ── Main Page ──

export default function ProjectsPage() {
  usePageTitle("Projects");
  const { t } = useDictionary("projects-canvas");
  const { can } = usePermissionStore();
  const { missingSteps } = useSetupGate();
  const [showSetupModal, setShowSetupModal] = useState(false);

  // ── Permissions ──
  const canManage = can("projects.edit");
  const canViewAccounting = can("accounting.view");
  const canCreateTasks = can("tasks.create");
  const canRecordPayment = can("accounting.edit");
  const canDelete = can("projects.delete");
  const projectsTableV2Enabled = useProjectsTableV2Flag();

  // ── Data fetching ──
  const { data: projectsData, isLoading } = useScopedProjects();
  const { data: clientsData } = useClients();
  const { data: teamData } = useTeamMembers();
  const { data: invoicesData } = useInvoices();
  const { data: estimatesData } = useEstimates();
  const { data: tasksData } = useTasks();
  const { data: projectMetrics } = useProjectMetrics();
  const updateStatusMutation = useUpdateProjectStatus();
  const deleteProjectMutation = useDeleteProject();

  // ── Store state ──
  const zoom = useProjectCanvasStore((s) => s.zoom);
  const sortBy = useProjectCanvasStore((s) => s.sortBy);
  const statusSortOverrides = useProjectCanvasStore((s) => s.statusSortOverrides);
  const firstDragConfirmed = useProjectCanvasStore((s) => s.firstDragConfirmed);
  const setFirstDragConfirmed = useProjectCanvasStore((s) => s.setFirstDragConfirmed);
  const fitAll = useProjectCanvasStore((s) => s.fitAll);
  const selectCards = useProjectCanvasStore((s) => s.selectCards);
  const startDrag = useProjectCanvasStore((s) => s.startDrag);
  const endDrag = useProjectCanvasStore((s) => s.endDrag);

  // ── View mode ──
  const storedViewModeRef = useRef<"canvas" | "spreadsheet" | null>(null);
  const [viewMode, setViewModeState] = useState<"canvas" | "spreadsheet">(() => {
    if (typeof window === "undefined") return "canvas";
    const stored = localStorage.getItem("ops_projects_view_mode");
    if (stored === "canvas" || stored === "spreadsheet") {
      storedViewModeRef.current = stored;
      return stored;
    }
    return "canvas";
  });
  const [spreadsheetStatusFilter, setSpreadsheetStatusFilter] = useState<"active" | "archived" | "closed">("active");
  const [spreadsheetSelectedIds, setSpreadsheetSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!projectsTableV2Enabled || typeof window === "undefined") return;
    if (storedViewModeRef.current) return;
    storedViewModeRef.current = "spreadsheet";
    localStorage.setItem("ops_projects_view_mode", "spreadsheet");
    setViewModeState("spreadsheet");
  }, [projectsTableV2Enabled]);

  const setViewMode = useCallback((nextViewMode: "canvas" | "spreadsheet") => {
    storedViewModeRef.current = nextViewMode;
    if (typeof window !== "undefined") {
      localStorage.setItem("ops_projects_view_mode", nextViewMode);
    }
    setViewModeState(nextViewMode);
  }, []);

  // Clear spreadsheet selection when switching to canvas
  useEffect(() => {
    if (viewMode === "canvas") setSpreadsheetSelectedIds(new Set());
  }, [viewMode]);

  // ── Local state ──
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [pendingDrag, setPendingDrag] = useState<{
    projectId: string;
    targetStatus: ProjectStatus;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasFittedRef = useRef(false);

  // ── DnD sensor ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // ── Track screen view ──
  useEffect(() => {
    trackScreenView("projects_canvas");
  }, []);

  // ── Lookup maps ──
  const clientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const clients = clientsData?.clients ?? [];
    if (clients) {
      for (const client of clients) {
        map.set(client.id, client.name ?? "");
      }
    }
    return map;
  }, [clientsData]);

  const teamMemberMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; avatarUrl?: string }>();
    const members = teamData?.users ?? [];
    if (members) {
      for (const member of members) {
        map.set(member.id, {
          id: member.id,
          name: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || member.email || "Unknown",
          avatarUrl: member.profileImageURL ?? undefined,
        });
      }
    }
    return map;
  }, [teamData]);

  const teamMemberList = useMemo(() => {
    return Array.from(teamMemberMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [teamMemberMap]);

  const clientList = useMemo(() => {
    return Array.from(clientNameMap.entries())
      .map(([id, name]) => ({ id, name }))
      .filter((c) => c.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clientNameMap]);

  const clientEmailMap = useMemo(() => {
    const map = new Map<string, string>();
    const clients = clientsData?.clients ?? [];
    for (const client of clients) {
      map.set(client.id, client.email ?? "");
    }
    return map;
  }, [clientsData]);

  const clientPhoneMap = useMemo(() => {
    const map = new Map<string, string>();
    const clients = clientsData?.clients ?? [];
    for (const client of clients) {
      map.set(client.id, client.phoneNumber ?? "");
    }
    return map;
  }, [clientsData]);

  const projectValueMap = useMemo(() => {
    const map = new Map<string, number>();
    if (invoicesData) {
      for (const invoice of invoicesData) {
        if (invoice.projectId) {
          map.set(invoice.projectId, (map.get(invoice.projectId) ?? 0) + (invoice.total ?? 0));
        }
      }
    }
    return map;
  }, [invoicesData]);

  const estimateTotalMap = useMemo(() => {
    const map = new Map<string, number>();
    if (estimatesData) {
      for (const estimate of estimatesData) {
        if (estimate.projectId) {
          map.set(estimate.projectId, (map.get(estimate.projectId) ?? 0) + (estimate.total ?? 0));
        }
      }
    }
    return map;
  }, [estimatesData]);

  // ── All projects (non-deleted) ──
  const allProjects = useMemo(() => {
    return (projectsData?.projects ?? []).filter((p) => !p.deletedAt);
  }, [projectsData]);

  // ── Task progress maps (from useTasks — all company tasks, grouped by project) ──
  const projectTaskCountMap = useMemo(() => {
    const total = new Map<string, number>();
    const completed = new Map<string, number>();
    const allTasks = tasksData?.tasks ?? [];
    for (const task of allTasks) {
      if (task.deletedAt) continue;
      const pid = task.projectId;
      total.set(pid, (total.get(pid) ?? 0) + 1);
      if (task.status === "Completed") {
        completed.set(pid, (completed.get(pid) ?? 0) + 1);
      }
    }
    return { total, completed };
  }, [tasksData]);

  const projectProgressMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of allProjects) {
      const totalCount = projectTaskCountMap.total.get(project.id) ?? 0;
      const completedCount = projectTaskCountMap.completed.get(project.id) ?? 0;
      map.set(project.id, totalCount > 0 ? completedCount / totalCount : 0);
    }
    return map;
  }, [allProjects, projectTaskCountMap]);

  // ── Filter ──
  const filteredProjects = useMemo(() => {
    let result = allProjects;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) => {
        const title = (p.title ?? "").toLowerCase();
        const address = (p.address ?? "").toLowerCase();
        const client = (clientNameMap.get(p.clientId ?? "") ?? "").toLowerCase();
        return title.includes(q) || address.includes(q) || client.includes(q);
      });
    }

    if (selectedMemberId) {
      result = result.filter((p) => p.teamMemberIds.includes(selectedMemberId));
    }

    if (selectedClientId) {
      result = result.filter((p) => p.clientId === selectedClientId);
    }

    return result;
  }, [allProjects, searchQuery, selectedMemberId, selectedClientId, clientNameMap]);

  // ── Archived projects ──
  const archivedProjects = useMemo(() => {
    return filteredProjects.filter((p) => p.status === ProjectStatus.Archived);
  }, [filteredProjects]);

  // ── Non-archived projects (for the canvas) ──
  const canvasProjects = useMemo(() => {
    return filteredProjects.filter((p) => p.status !== ProjectStatus.Archived);
  }, [filteredProjects]);

  // ── Layout ──
  const layout = useMemo(() => {
    return calculateProjectCanvasLayout(
      canvasProjects,
      sortBy,
      clientNameMap,
      projectValueMap,
      projectProgressMap,
      statusSortOverrides
    );
  }, [canvasProjects, sortBy, clientNameMap, projectValueMap, projectProgressMap, statusSortOverrides]);

  // ── Staleness ──
  const stalenessMap = useMemo(() => {
    return calculateBatchProjectStaleness(canvasProjects);
  }, [canvasProjects]);

  // ── Project lookup map ──
  const projectMap = useMemo(() => {
    return new Map(allProjects.map((p) => [p.id, p]));
  }, [allProjects]);

  const isBirdEye = zoom < BIRD_EYE_THRESHOLD;

  // ── Auto-fit on first load ──
  useEffect(() => {
    if (!hasFittedRef.current && !isLoading && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        fitAll(rect.width, rect.height);
        hasFittedRef.current = true;
      }
    }
  }, [isLoading, fitAll]);

  // ── Marquee select ──
  const handleMarqueeEnd = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const matchedIds: string[] = [];
      for (const stack of layout.stacks) {
        for (const pos of stack.cardPositions) {
          if (isCardInMarquee(pos.x, pos.y, CARD_WIDTH, CARD_HEIGHT, start, end)) {
            matchedIds.push(pos.projectId);
          }
        }
      }
      for (const region of layout.terminalRegions) {
        for (const pos of region.cardPositions) {
          if (isCardInMarquee(pos.x, pos.y, CARD_WIDTH, CARD_HEIGHT, start, end)) {
            matchedIds.push(pos.projectId);
          }
        }
      }
      if (matchedIds.length > 0) {
        selectCards(matchedIds);
      }
    },
    [layout, selectCards]
  );

  // ── DnD handlers ──
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setActiveCardId(id);
      const selectedCardIds = useProjectCanvasStore.getState().selectedCardIds;
      const cardIds = selectedCardIds.has(id) ? Array.from(selectedCardIds) : [id];
      startDrag(cardIds, { x: 0, y: 0 });
    },
    [startDrag]
  );

  const executeDrag = useCallback(
    (projectId: string, targetStatus: ProjectStatus) => {
      updateStatusMutation.mutate(
        { id: projectId, status: targetStatus },
        {
          onSuccess: () => {
            toast.success(t("status.updated"), {
              description: `${t("status.moved")} ${getProjectStatusDisplayName(targetStatus)}`,
            });
          },
          onError: (error) => {
            toast.error(t("status.failed"), {
              description: error instanceof Error ? error.message : t("status.tryAgain"),
            });
          },
        }
      );
    },
    [updateStatusMutation, t]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { over } = event;
      const projectId = String(event.active.id);
      setActiveCardId(null);
      endDrag();

      if (!over) return;
      const overId = String(over.id);

      // Archive drop
      if (overId === "archive-drop") {
        executeDrag(projectId, ProjectStatus.Archived);
        return;
      }

      // Status column drop
      if (overId.startsWith("status-")) {
        const targetStatus = overId.replace("status-", "") as ProjectStatus;
        const project = projectMap.get(projectId);
        if (!project || project.status === targetStatus) return;

        if (!firstDragConfirmed) {
          setPendingDrag({ projectId, targetStatus });
        } else {
          executeDrag(projectId, targetStatus);
        }
      }
    },
    [endDrag, executeDrag, firstDragConfirmed, projectMap]
  );

  // ── Drag confirmation handlers ──
  const handleDragConfirm = useCallback(() => {
    if (pendingDrag) {
      setFirstDragConfirmed();
      executeDrag(pendingDrag.projectId, pendingDrag.targetStatus);
      setPendingDrag(null);
    }
  }, [pendingDrag, setFirstDragConfirmed, executeDrag]);

  const handleDragCancel = useCallback(() => {
    setPendingDrag(null);
  }, []);

  // ── Card action callbacks ──
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);
  const handleOpenDetail = useCallback(
    (projectId: string) => {
      const project = projectMap.get(projectId);
      if (!project) return;
      openProjectWindow({ projectId, mode: "viewing" });
    },
    [projectMap, openProjectWindow]
  );

  const openWindow = useWindowStore((s) => s.openWindow);
  const handleAddTask = useCallback(
    (projectId: string) => {
      const project = projectMap.get(projectId);
      const projectLabel = project?.title || project?.address?.split(",")[0] || "Project";
      openWindow({
        id: `create-task-${projectId}`,
        title: `// NEW TASK :: ${projectLabel.toUpperCase()}`,
        type: "create-task",
        metadata: { projectId },
      });
    },
    [openWindow, projectMap]
  );

  const handleRecordPayment = useCallback((_projectId: string) => {
    // TODO: Open payment recording form
    toast.info("Payment recording coming soon");
  }, []);

  const handleArchive = useCallback(
    (projectId: string) => {
      executeDrag(projectId, ProjectStatus.Archived);
    },
    [executeDrag]
  );

  const handleArchiveBatch = useCallback(
    (projectIds: string[]) => {
      for (const id of projectIds) {
        executeDrag(id, ProjectStatus.Archived);
      }
    },
    [executeDrag]
  );

  const handleRestoreFromArchive = useCallback(
    (projectId: string) => {
      executeDrag(projectId, ProjectStatus.InProgress);
    },
    [executeDrag]
  );

  const handleDeletePermanently = useCallback(
    (projectId: string) => {
      deleteProjectMutation.mutate(projectId);
    },
    [deleteProjectMutation]
  );

  const handleDeleteBatch = useCallback(
    (projectIds: string[]) => {
      for (const id of projectIds) {
        deleteProjectMutation.mutate(id);
      }
    },
    [deleteProjectMutation]
  );

  const handleChangeStatusBatch = useCallback(
    (projectIds: string[], status: ProjectStatus) => {
      for (const id of projectIds) {
        executeDrag(id, status);
      }
    },
    [executeDrag]
  );

  // ── Spreadsheet bulk actions ──
  const handleSpreadsheetBulkChangeStatus = useCallback(
    (status: ProjectStatus) => {
      for (const id of spreadsheetSelectedIds) {
        executeDrag(id, status);
      }
      setSpreadsheetSelectedIds(new Set());
    },
    [spreadsheetSelectedIds, executeDrag]
  );

  const handleSpreadsheetBulkArchive = useCallback(() => {
    for (const id of spreadsheetSelectedIds) {
      executeDrag(id, ProjectStatus.Archived);
    }
    setSpreadsheetSelectedIds(new Set());
  }, [spreadsheetSelectedIds, executeDrag]);

  const handleSpreadsheetBulkDelete = useCallback(() => {
    for (const id of spreadsheetSelectedIds) {
      deleteProjectMutation.mutate(id);
    }
    setSpreadsheetSelectedIds(new Set());
  }, [spreadsheetSelectedIds, deleteProjectMutation]);

  // ── Render card callback for stacks ──
  const renderCard = useCallback(
    (project: Project) => {
      const clientName = clientNameMap.get(project.clientId ?? "") ?? "";
      const statusColor = PROJECT_STATUS_COLORS[project.status];
      const staleness = stalenessMap.get(project.id) ?? 1.0;
      const value = projectValueMap.get(project.id) ?? 0;
      const totalCount = projectTaskCountMap.total.get(project.id) ?? 0;
      const completedCount = projectTaskCountMap.completed.get(project.id) ?? 0;
      const members = project.teamMemberIds
        .map((id) => teamMemberMap.get(id))
        .filter(Boolean) as { id: string; name: string; avatarUrl?: string }[];

      return (
        <ProjectCardWrapper
          key={project.id}
          project={project}
          clientName={clientName}
          statusColor={statusColor}
          stalenessOpacity={staleness}
          canManage={canManage}
          canViewAccounting={canViewAccounting}
          canCreateTasks={canCreateTasks}
          canRecordPayment={canRecordPayment}
          projectValue={value}
          completedTasks={completedCount}
          totalTasks={totalCount}
          teamMembers={members}
          isBirdEye={isBirdEye}
          onOpenDetail={handleOpenDetail}
          onAddTask={handleAddTask}
          onRecordPayment={handleRecordPayment}
          onArchive={handleArchive}
        />
      );
    },
    [clientNameMap, stalenessMap, projectValueMap, projectTaskCountMap, teamMemberMap, canManage, canViewAccounting, canCreateTasks, canRecordPayment, isBirdEye, handleOpenDetail, handleAddTask, handleRecordPayment, handleArchive]
  );

  // ── Active project for drag overlay ──
  const activeProject = activeCardId ? projectMap.get(activeCardId) ?? null : null;
  const activeClientName = activeProject
    ? clientNameMap.get(activeProject.clientId ?? "") ?? ""
    : "";
  const selectedCount = useProjectCanvasStore.getState().selectedCardIds.size;
  const batchCount = activeCardId && useProjectCanvasStore.getState().selectedCardIds.has(activeCardId)
    ? selectedCount
    : 1;

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 text-text-2 animate-spin" />
        <span className="font-mohave text-body text-text-3">{t("loading")}</span>
      </div>
    );
  }

  // ── Render ──
  return (
    <div ref={containerRef} className="relative h-full min-w-0 overflow-hidden">
      {/* Setup gate */}
      {showSetupModal && (
        <SetupInterceptionModal
          isOpen={showSetupModal}
          onComplete={() => setShowSetupModal(false)}
          onDismiss={() => setShowSetupModal(false)}
          missingSteps={missingSteps}
          triggerAction="create_project"
        />
      )}

      {/* ── Canvas — fills entire viewport, renders behind HUD ── */}
      {viewMode === "canvas" && <div className="absolute inset-0">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <ProjectCanvas
            canvasWidth={layout.canvasWidth}
            canvasHeight={layout.canvasHeight}
            onMarqueeEnd={handleMarqueeEnd}
            onCanvasContextMenu={(e) => {
              useProjectCanvasStore.getState().showContextMenu({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                type: "canvas",
                targetCardId: null,
                status: null,
              });
            }}
          >
            {/* Active status stacks */}
            {layout.stacks.map((stackLayout) => {
              const status = stackLayout.status;
              const stackProjects = canvasProjects.filter((p) => p.status === status);
              return (
                <ProjectStageStack
                  key={status}
                  status={status}
                  projects={stackProjects}
                  layout={stackLayout}
                  isBirdEye={isBirdEye}
                  activeId={activeCardId}
                  projectValues={projectValueMap}
                  canViewAccounting={canViewAccounting}
                  renderCard={(project) => renderCard(project)}
                />
              );
            })}

            {/* Terminal region (Closed) */}
            {layout.terminalRegions.map((regionLayout) => {
              const closedProjects = canvasProjects.filter((p) => p.status === regionLayout.status);
              return (
                <ProjectTerminalRegion
                  key={regionLayout.status}
                  status={regionLayout.status}
                  projects={closedProjects}
                  layout={regionLayout}
                  projectValues={projectValueMap}
                  canViewAccounting={canViewAccounting}
                  isBirdEye={isBirdEye}
                  renderCard={(project) => renderCard(project)}
                />
              );
            })}

            {/* Marquee select overlay */}
            <ProjectMarqueeSelect />
          </ProjectCanvas>

          {/* Drag overlay */}
          <ProjectDragOverlay
            activeProject={activeProject}
            clientName={activeClientName}
            batchCount={batchCount}
          />
        </DndContext>

        {/* Context menu */}
        <ProjectContextMenu
          canManage={canManage}
          canCreateTasks={canCreateTasks}
          canRecordPayment={canRecordPayment}
          canDelete={canDelete}
          onOpenDetail={handleOpenDetail}
          onAddTask={handleAddTask}
          onRecordPayment={handleRecordPayment}
          onArchive={handleArchiveBatch}
          onDelete={handleDeleteBatch}
          onChangeStatus={handleChangeStatusBatch}
        />

        {/* Archive tray */}
        <ProjectArchiveTray
          archivedProjects={archivedProjects}
          clientNames={clientNameMap}
          projectValues={projectValueMap}
          canViewAccounting={canViewAccounting}
          onRestore={handleRestoreFromArchive}
          onDeletePermanently={handleDeletePermanently}
        />
      </div>}

      {/* ── Spreadsheet — alternative view ── */}
      {viewMode === "spreadsheet" && projectsTableV2Enabled && (
        <div className="absolute inset-0 top-[156px] bottom-0 px-3 overflow-hidden flex flex-col">
          <ProjectsTableShell />
        </div>
      )}

      {viewMode === "spreadsheet" && !projectsTableV2Enabled && (
        <div className="absolute inset-0 top-[156px] bottom-0 px-3 overflow-hidden flex flex-col">
          <ProjectSpreadsheet
            projects={filteredProjects.filter((p) => p.status !== ProjectStatus.Archived && p.status !== ProjectStatus.Closed)}
            allFilteredProjects={filteredProjects}
            statusFilter={spreadsheetStatusFilter}
            clientNameMap={clientNameMap}
            clientEmailMap={clientEmailMap}
            clientPhoneMap={clientPhoneMap}
            teamMemberMap={teamMemberMap}
            projectValueMap={projectValueMap}
            estimateTotalMap={estimateTotalMap}
            projectTaskCountMap={projectTaskCountMap}
            canManage={canManage}
            canViewAccounting={canViewAccounting}
            canCreateTasks={canCreateTasks}
            canRecordPayment={canRecordPayment}
            canDelete={canDelete}
            selectedIds={spreadsheetSelectedIds}
            onSelectedIdsChange={setSpreadsheetSelectedIds}
            onAddTask={handleAddTask}
          />
        </div>
      )}

      {/* ── Page HUD — metrics + toolbar float on top of canvas ── */}
      <div className="absolute top-[62px] left-0 right-0 z-[2] pointer-events-none">
        <div className="pointer-events-auto">
          <MetricsHeader variant="compact" tabId="projects" title="Projects" metrics={projectMetrics ?? []} />
        </div>
        <div className="pointer-events-auto px-3 py-1.5">
          <div className="inline-flex max-w-full overflow-x-auto overscroll-x-contain py-[2px] rounded-[4px] border border-[rgba(255,255,255,0.08)]"
            style={{
              background: "rgba(10, 10, 10, 0.50)",
              backdropFilter: "blur(12px) saturate(1.1)",
              WebkitBackdropFilter: "blur(12px) saturate(1.1)",
            }}
          >
            <ProjectFloatingToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              teamMembers={teamMemberList}
              clients={clientList}
              selectedMemberId={selectedMemberId}
              onMemberFilterChange={setSelectedMemberId}
              selectedClientId={selectedClientId}
              onClientFilterChange={setSelectedClientId}
              canViewAccounting={canViewAccounting}
              canManage={canManage}
              canDelete={canDelete}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onArchivedToggle={viewMode === "canvas"
                ? () => useProjectCanvasStore.getState().toggleArchiveTray()
                : () => setSpreadsheetStatusFilter((prev) => prev === "archived" ? "active" : "archived")
              }
              isArchivedActive={viewMode === "canvas"
                ? useProjectCanvasStore.getState().isArchiveTrayOpen
                : spreadsheetStatusFilter === "archived"
              }
              onClosedToggle={() => setSpreadsheetStatusFilter((prev) => prev === "closed" ? "active" : "closed")}
              isClosedActive={spreadsheetStatusFilter === "closed"}
              selectedCount={spreadsheetSelectedIds.size}
              onBulkChangeStatus={handleSpreadsheetBulkChangeStatus}
              onBulkArchive={handleSpreadsheetBulkArchive}
              onBulkDelete={handleSpreadsheetBulkDelete}
              onBulkClear={() => setSpreadsheetSelectedIds(new Set())}
            />
          </div>
        </div>
      </div>

      {/* Drag confirmation dialog */}
      <ProjectDragConfirmation
        open={pendingDrag !== null}
        onConfirm={handleDragConfirm}
        onCancel={handleDragCancel}
      />

    </div>
  );
}
