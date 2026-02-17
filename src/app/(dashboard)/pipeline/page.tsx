"use client";

import { useState, useCallback, useMemo, useRef, useEffect, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Clock,
  X,
  ListFilter,
  Phone,
  Users,
  TrendingUp,
  Calendar,
  MessageSquare,
  Target,
  ArrowRight,
  Loader2,
  FolderOpen,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { CreateProjectModal } from "@/components/ops/create-project-modal";
import { ProjectDetailModal } from "@/components/ops/project-detail-modal";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { useProjects, useClients, useUpdateProjectStatus } from "@/lib/hooks";
import {
  type Project,
  type Client,
  ProjectStatus,
  PROJECT_STATUS_COLORS,
} from "@/lib/types/models";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PipelineStageId =
  | "new-lead"
  | "quoted"
  | "negotiating"
  | "won"
  | "lost";

interface PipelineStageConfig {
  id: PipelineStageId;
  label: string;
  color: string;
  borderColor: string;
  bgAccent: string;
  textColor: string;
  /** Which ProjectStatus values map to this pipeline stage */
  statuses: ProjectStatus[];
}

interface PipelineCard {
  id: string;
  project: Project;
  client: Client | null;
}

interface PipelineColumn extends PipelineStageConfig {
  cards: PipelineCard[];
}

// ---------------------------------------------------------------------------
// Pipeline Stage Configuration
// ---------------------------------------------------------------------------
const PIPELINE_STAGES: PipelineStageConfig[] = [
  {
    id: "new-lead",
    label: "New Lead",
    color: "text-[#BCBCBC]",
    borderColor: "border-t-[#BCBCBC]",
    bgAccent: "bg-[#BCBCBC]",
    textColor: "#BCBCBC",
    statuses: [ProjectStatus.RFQ],
  },
  {
    id: "quoted",
    label: "Quoted",
    color: "text-ops-accent",
    borderColor: "border-t-ops-accent",
    bgAccent: "bg-ops-accent",
    textColor: "#417394",
    statuses: [ProjectStatus.Estimated],
  },
  {
    id: "negotiating",
    label: "Negotiating",
    color: "text-ops-amber",
    borderColor: "border-t-ops-amber",
    bgAccent: "bg-ops-amber",
    textColor: "#C4A868",
    statuses: [ProjectStatus.Accepted],
  },
  {
    id: "won",
    label: "Converted",
    color: "text-status-success",
    borderColor: "border-t-status-success",
    bgAccent: "bg-status-success",
    textColor: "#4ADE80",
    statuses: [ProjectStatus.InProgress, ProjectStatus.Completed, ProjectStatus.Closed],
  },
  {
    id: "lost",
    label: "Lost",
    color: "text-ops-error",
    borderColor: "border-t-ops-error",
    bgAccent: "bg-ops-error",
    textColor: "#93321A",
    statuses: [ProjectStatus.Archived],
  },
];

/**
 * Given a pipeline stage ID, return the first ProjectStatus in that stage.
 * Used when dropping a card into a new column.
 */
function getTargetStatusForStage(stageId: PipelineStageId): ProjectStatus {
  const stage = PIPELINE_STAGES.find((s) => s.id === stageId);
  return stage?.statuses[0] ?? ProjectStatus.RFQ;
}

/**
 * Find which pipeline stage a project status belongs to.
 */
function getStageForStatus(status: ProjectStatus): PipelineStageId {
  for (const stage of PIPELINE_STAGES) {
    if (stage.statuses.includes(status)) {
      return stage.id;
    }
  }
  return "new-lead";
}

/**
 * Compute days since a date (for "days in stage" approximation using startDate).
 */
function daysSince(date: Date | string | null): number {
  if (!date) return 0;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Format a date for display.
 */
function formatShortDate(date: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Draggable Pipeline Card
// ---------------------------------------------------------------------------
function PipelineCardComponent({
  card,
  columnColor: _columnColor,
  isDragOverlay,
  onCall,
  onNote,
  onAdvance,
  onViewDetail,
}: {
  card: PipelineCard;
  columnColor: string;
  isDragOverlay?: boolean;
  onCall?: (phone: string) => void;
  onNote?: (projectId: string) => void;
  onAdvance?: (projectId: string) => void;
  onViewDetail?: (project: Project) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { project, client } = card;
  const clientName = client?.name || "No Client";
  const clientEmail = client?.email || undefined;
  const clientPhone = client?.phoneNumber || undefined;
  const daysInStage = daysSince(project.startDate);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", project.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "bg-[rgba(13,13,13,0.6)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded-[5px] p-1.5",
        "cursor-grab active:cursor-grabbing transition-all duration-150",
        "group",
        isDragOverlay && "shadow-elevated border-ops-accent scale-[1.02] rotate-[1deg]",
        !isDragOverlay && "hover:border-[rgba(255,255,255,0.3)]"
      )}
    >
      {/* Top row: client name + status badge */}
      <div className="flex items-start gap-[6px]">
        <div className="flex-1 min-w-0">
          <h4 className="font-mohave text-body-sm text-text-primary truncate uppercase">
            {clientName}
          </h4>
          <p className="font-kosugi text-[10px] text-text-tertiary truncate">
            {project.title}
          </p>
        </div>
        <span
          className="shrink-0 font-mono text-[9px] px-[5px] py-[1px] rounded-sm border uppercase"
          style={{
            color: PROJECT_STATUS_COLORS[project.status],
            borderColor: PROJECT_STATUS_COLORS[project.status] + "40",
            backgroundColor: PROJECT_STATUS_COLORS[project.status] + "15",
          }}
        >
          {project.status}
        </span>
      </div>

      {/* Address row */}
      {project.address && (
        <p className="font-kosugi text-[9px] text-text-disabled truncate mt-0.5">
          {project.address}
        </p>
      )}

      {/* Days in stage + date row */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-[6px]">
          {daysInStage > 0 && (
            <div
              className="flex items-center gap-[2px]"
              title={`${daysInStage} days since start`}
            >
              <Clock className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-mono text-[9px] text-text-disabled">
                {daysInStage}d
              </span>
            </div>
          )}
          {project.teamMemberIds.length > 0 && (
            <div className="flex items-center gap-[2px]">
              <Users className="w-[10px] h-[10px] text-text-disabled" />
              <span className="font-mono text-[9px] text-text-disabled">
                {project.teamMemberIds.length}
              </span>
            </div>
          )}
        </div>
        {project.startDate && (
          <div className="flex items-center gap-[3px] text-text-disabled">
            <Calendar className="w-[10px] h-[10px]" />
            <span className="font-mono text-[9px]">
              {formatShortDate(project.startDate)}
            </span>
          </div>
        )}
      </div>

      {/* Show Details toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        className="flex items-center gap-[4px] mt-1 text-text-disabled hover:text-text-tertiary transition-colors w-full"
      >
        <ChevronDown
          className={cn(
            "w-[12px] h-[12px] transition-transform duration-150",
            isExpanded && "rotate-180"
          )}
        />
        <span className="font-kosugi text-[9px] uppercase tracking-wider">
          {isExpanded ? "Hide Details" : "Show Details"}
        </span>
      </button>

      {/* Expandable detail section */}
      {isExpanded && (
        <div className="mt-1 pt-1 border-t border-[rgba(255,255,255,0.1)] space-y-1 animate-slide-up">
          {clientEmail && (
            <div className="flex items-center gap-[6px]">
              <span className="font-kosugi text-[9px] text-text-disabled w-[40px] uppercase">
                Email
              </span>
              <span className="font-mono text-[10px] text-ops-accent truncate">
                {clientEmail}
              </span>
            </div>
          )}
          {clientPhone && (
            <div className="flex items-center gap-[6px]">
              <span className="font-kosugi text-[9px] text-text-disabled w-[40px] uppercase">
                Phone
              </span>
              <span className="font-mono text-[10px] text-text-secondary">
                {clientPhone}
              </span>
            </div>
          )}
          {project.projectDescription && (
            <div className="mt-0.5">
              <span className="font-kosugi text-[9px] text-text-disabled block mb-[2px] uppercase">
                Description
              </span>
              <p className="font-mohave text-[11px] text-text-secondary leading-tight truncate-2">
                {project.projectDescription}
              </p>
            </div>
          )}
          {project.notes && (
            <div className="mt-0.5">
              <span className="font-kosugi text-[9px] text-text-disabled block mb-[2px] uppercase">
                Notes
              </span>
              <p className="font-mohave text-[11px] text-text-secondary leading-tight truncate-2">
                {project.notes}
              </p>
            </div>
          )}
          <div className="flex items-center gap-1 mt-1">
            {clientPhone && (
              <Button
                variant="secondary"
                size="sm"
                className="text-[10px] h-[28px] px-1"
                onClick={() => onCall?.(clientPhone!)}
              >
                <Phone className="w-[10px] h-[10px]" />
                Call
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="text-[10px] h-[28px] px-1"
              onClick={() => onNote?.(project.id)}
            >
              <MessageSquare className="w-[10px] h-[10px]" />
              Note
            </Button>
            <Button
              variant="default"
              size="sm"
              className="text-[10px] h-[28px] px-1"
              onClick={() => onAdvance?.(project.id)}
            >
              <ArrowRight className="w-[10px] h-[10px]" />
              Advance
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="text-[10px] h-[28px] px-1"
              onClick={() => onViewDetail?.(project)}
            >
              <FolderOpen className="w-[10px] h-[10px]" />
              View Project
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable Column
// ---------------------------------------------------------------------------
function PipelineColumnComponent({
  column,
  onCall,
  onNote,
  onAdvance,
  onAddProject,
  onViewDetail,
}: {
  column: PipelineColumn;
  onCall?: (phone: string) => void;
  onNote?: (projectId: string) => void;
  onAdvance?: (projectId: string) => void;
  onAddProject?: () => void;
  onViewDetail?: (project: Project) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  return (
    <div
      className={cn("flex flex-col min-w-[260px] max-w-[300px] w-full")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        // Drop is handled at the parent level via the onDrop prop
      }}
      data-column-id={column.id}
    >
      {/* Column header */}
      <div
        className={cn(
          "border-t-2 rounded-t-sm px-1.5 py-1 bg-background-panel border border-border border-b-0",
          column.borderColor
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <h3
              className={cn(
                "font-mohave text-body font-medium uppercase tracking-wider",
                column.color
              )}
            >
              {column.label}
            </h3>
            <span className="font-mono text-[11px] text-text-disabled bg-background-elevated px-[6px] py-[2px] rounded-sm">
              {column.cards.length}
            </span>
          </div>
          <button
            onClick={onAddProject}
            className="p-[4px] rounded text-text-disabled hover:text-text-tertiary hover:bg-background-elevated transition-colors"
          >
            <Plus className="w-[14px] h-[14px]" />
          </button>
        </div>

        {/* Column stats */}
        <div className="flex items-center gap-2 mt-[4px]">
          <div className="flex items-center gap-[3px]">
            <FolderOpen className="w-[10px] h-[10px] text-text-disabled" />
            <span className="font-mono text-[10px] text-text-disabled">
              {column.cards.length} project{column.cards.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Cards area */}
      <div
        className={cn(
          "flex-1 border border-border border-t-0 rounded-b p-1 space-y-1 min-h-[200px] transition-colors duration-150",
          isDragOver
            ? "bg-ops-accent-muted border-ops-accent"
            : "bg-[rgba(10,10,10,0.5)]"
        )}
      >
        {column.cards.map((card) => (
          <PipelineCardComponent
            key={card.id}
            card={card}
            columnColor={column.color}
            onCall={onCall}
            onNote={onNote}
            onAdvance={onAdvance}
            onViewDetail={onViewDetail}
          />
        ))}

        {column.cards.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[120px] border border-dashed border-border-subtle rounded gap-1">
            <div className="w-[32px] h-[32px] rounded-full bg-background-elevated flex items-center justify-center">
              <Target className="w-[14px] h-[14px] text-text-disabled" />
            </div>
            <span className="font-kosugi text-[11px] text-text-disabled">
              No projects in this stage
            </span>
            <span className="font-kosugi text-[9px] text-text-disabled">
              Drop here to move
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------
function PipelineSkeleton() {
  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Header skeleton */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-kosugi text-caption-sm text-text-tertiary">
              Loading projects...
            </p>
          </div>
        </div>

        {/* Metrics skeleton */}
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="flex-1 p-1 flex items-center gap-1.5">
              <div className="w-[32px] h-[32px] rounded bg-background-elevated animate-pulse" />
              <div className="space-y-1">
                <div className="h-[10px] w-[60px] bg-background-elevated rounded animate-pulse" />
                <div className="h-[14px] w-[40px] bg-background-elevated rounded animate-pulse" />
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Board skeleton */}
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex gap-2 min-w-min">
          {PIPELINE_STAGES.map((stage) => (
            <div
              key={stage.id}
              className="flex flex-col min-w-[260px] max-w-[300px] w-full"
            >
              <div
                className={cn(
                  "border-t-2 rounded-t-sm px-1.5 py-1 bg-background-panel border border-border border-b-0",
                  stage.borderColor
                )}
              >
                <div className="flex items-center gap-1">
                  <h3
                    className={cn(
                      "font-mohave text-body font-medium uppercase tracking-wider",
                      stage.color
                    )}
                  >
                    {stage.label}
                  </h3>
                  <span className="font-mono text-[11px] text-text-disabled bg-background-elevated px-[6px] py-[2px] rounded-sm">
                    --
                  </span>
                </div>
              </div>
              <div className="flex-1 border border-border border-t-0 rounded-b p-1 space-y-1 min-h-[200px] bg-background-panel/50">
                {[1, 2].map((j) => (
                  <div
                    key={j}
                    className="bg-background-card-dark border border-border rounded p-1.5 space-y-1.5 animate-pulse"
                  >
                    <div className="h-[14px] w-3/4 bg-background-elevated rounded" />
                    <div className="h-[10px] w-1/2 bg-background-elevated rounded" />
                    <div className="h-[10px] w-1/3 bg-background-elevated rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Page
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Set page actions in top bar
  const setActions = usePageActionsStore((s) => s.setActions);
  const clearActions = usePageActionsStore((s) => s.clearActions);
  useEffect(() => {
    setActions([
      { label: "New Lead", icon: Plus, onClick: () => setCreateModalOpen(true) },
    ]);
    return () => clearActions();
  }, [setActions, clearActions]);

  // Fetch real data
  const { data: projectsData, isLoading: projectsLoading } = useProjects();
  const { data: clientsData, isLoading: clientsLoading } = useClients();
  const updateStatusMutation = useUpdateProjectStatus();
  const router = useRouter();

  const isLoading = projectsLoading || clientsLoading;

  // Build client lookup map
  const clientMap = useMemo(() => {
    const map = new Map<string, Client>();
    if (clientsData?.clients) {
      for (const client of clientsData.clients) {
        map.set(client.id, client);
      }
    }
    return map;
  }, [clientsData]);

  // Filter out deleted projects and build pipeline columns
  const activeProjects = useMemo(() => {
    if (!projectsData?.projects) return [];
    return projectsData.projects.filter((p) => !p.deletedAt);
  }, [projectsData]);

  // Build pipeline columns from real data
  const columns: PipelineColumn[] = useMemo(() => {
    return PIPELINE_STAGES.map((stage) => {
      const stageProjects = activeProjects.filter((p) =>
        stage.statuses.includes(p.status)
      );

      const cards: PipelineCard[] = stageProjects.map((project) => ({
        id: project.id,
        project,
        client: project.clientId ? clientMap.get(project.clientId) ?? null : null,
      }));

      return {
        ...stage,
        cards,
      };
    });
  }, [activeProjects, clientMap]);

  // Filter cards by search and status filter
  const filteredColumns = useMemo(() => {
    return columns.map((col) => ({
      ...col,
      cards: col.cards.filter((card) => {
        const clientName = card.client?.name || "";
        const projectTitle = card.project.title || "";
        const address = card.project.address || "";

        const matchesSearch =
          !searchQuery.trim() ||
          clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          projectTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
          address.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus =
          !statusFilter || card.project.status === statusFilter;

        return matchesSearch && matchesStatus;
      }),
    }));
  }, [columns, searchQuery, statusFilter]);

  // Compute statistics from real data
  const totalProjects = activeProjects.length;

  const wonProjects = columns
    .find((c) => c.id === "won")
    ?.cards.length ?? 0;

  const lostProjects = columns
    .find((c) => c.id === "lost")
    ?.cards.length ?? 0;

  const activeInPipeline = totalProjects - wonProjects - lostProjects;

  const conversionRate =
    wonProjects + lostProjects > 0
      ? Math.round((wonProjects / (wonProjects + lostProjects)) * 100)
      : 0;

  // Collect unique statuses for filter dropdown
  const allStatuses = useMemo(() => {
    const statuses = new Set<ProjectStatus>();
    activeProjects.forEach((p) => statuses.add(p.status));
    return Array.from(statuses).sort();
  }, [activeProjects]);

  // Card action handlers
  const handleCall = useCallback((phone: string) => {
    window.open(`tel:${phone}`);
  }, []);

  const handleNote = useCallback((projectId: string) => {
    router.push(`/projects/${projectId}`);
  }, [router]);

  const handleAdvance = useCallback((projectId: string) => {
    const project = activeProjects.find((p) => p.id === projectId);
    if (!project) return;
    const currentStageId = getStageForStatus(project.status);
    const currentIndex = PIPELINE_STAGES.findIndex((s) => s.id === currentStageId);
    if (currentIndex < 0 || currentIndex >= PIPELINE_STAGES.length - 1) return;
    const nextStage = PIPELINE_STAGES[currentIndex + 1];
    const newStatus = nextStage.statuses[0];
    updateStatusMutation.mutate(
      { id: projectId, status: newStatus },
      {
        onSuccess: () => {
          toast.success(`Project advanced to ${nextStage.label}`);
        },
        onError: (error) => {
          toast.error("Failed to advance project", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        },
      }
    );
  }, [activeProjects, updateStatusMutation]);

  // Handle drop on a column
  const handleBoardDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const projectId = e.dataTransfer.getData("text/plain");
      if (!projectId) return;

      // Find the target column from the drop point
      const target = (e.target as HTMLElement).closest("[data-column-id]");
      if (!target) return;
      const destStageId = target.getAttribute("data-column-id") as PipelineStageId;
      if (!destStageId) return;

      // Find the project's current stage
      const project = activeProjects.find((p) => p.id === projectId);
      if (!project) return;

      const currentStageId = getStageForStatus(project.status);
      if (currentStageId === destStageId) return;

      // Get the target status for the destination stage
      const newStatus = getTargetStatusForStage(destStageId);

      // Perform the mutation
      updateStatusMutation.mutate(
        { id: projectId, status: newStatus },
        {
          onSuccess: () => {
            const stageName =
              PIPELINE_STAGES.find((s) => s.id === destStageId)?.label ?? destStageId;
            toast.success(`Project moved to ${stageName}`, {
              description: `Status updated to ${newStatus}`,
            });
          },
          onError: (error) => {
            toast.error("Failed to update project status", {
              description:
                error instanceof Error
                  ? error.message
                  : "An unexpected error occurred",
            });
          },
        }
      );
    },
    [activeProjects, updateStatusMutation]
  );

  // Show loading skeleton
  if (isLoading) {
    return <PipelineSkeleton />;
  }

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Header */}
      <div className="shrink-0 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-kosugi text-caption-sm text-text-tertiary">
                Drag projects between stages to update status
              </p>
              <span className="font-mono text-[11px] text-text-disabled">
                {totalProjects} project{totalProjects !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="max-w-[250px]">
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                prefixIcon={<Search className="w-[16px] h-[16px]" />}
                suffixIcon={
                  searchQuery ? (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="text-text-disabled hover:text-text-tertiary cursor-pointer"
                    >
                      <X className="w-[14px] h-[14px]" />
                    </button>
                  ) : undefined
                }
              />
            </div>
            <Button
              variant={showFilters ? "default" : "secondary"}
              size="sm"
              className="gap-[6px]"
              onClick={() => setShowFilters(!showFilters)}
            >
              <ListFilter className="w-[14px] h-[14px]" />
              Filter
            </Button>
            <Button variant="default" size="sm" className="gap-[6px]" onClick={() => setCreateModalOpen(true)}>
              <Plus className="w-[14px] h-[14px]" />
              New Lead
            </Button>
          </div>
        </div>

        {/* Metrics bar */}
        <div className="flex items-center gap-2">
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-accent-muted flex items-center justify-center shrink-0">
              <FolderOpen className="w-[16px] h-[16px] text-ops-accent" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Active Pipeline
              </span>
              <span className="font-mono text-data text-ops-amber">
                {activeInPipeline}
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-status-success/15 flex items-center justify-center shrink-0">
              <TrendingUp className="w-[16px] h-[16px] text-status-success" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Converted
              </span>
              <span className="font-mono text-data text-status-success">
                {wonProjects}
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-error-muted flex items-center justify-center shrink-0">
              <X className="w-[16px] h-[16px] text-ops-error" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Lost
              </span>
              <span className="font-mono text-data text-ops-error">
                {lostProjects}
              </span>
            </div>
          </Card>
          <Card className="flex-1 p-1 flex items-center gap-1.5">
            <div className="w-[32px] h-[32px] rounded bg-ops-amber-muted flex items-center justify-center shrink-0">
              <Target className="w-[16px] h-[16px] text-ops-amber" />
            </div>
            <div>
              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest block">
                Conversion
              </span>
              <span className="font-mono text-data text-text-primary">
                {conversionRate}%
              </span>
            </div>
          </Card>
        </div>

        {/* Expanded filter panel */}
        {showFilters && (
          <Card className="p-1.5 animate-slide-up">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                  Status
                </span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={cn(
                    "bg-background-input text-text-primary font-mohave text-body-sm",
                    "px-1.5 py-[6px] rounded border border-border",
                    "focus:border-ops-accent focus:outline-none",
                    "cursor-pointer"
                  )}
                >
                  <option value="">All Statuses</option>
                  {allStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              {(statusFilter || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-[4px] text-ops-error"
                  onClick={() => {
                    setStatusFilter("");
                    setSearchQuery("");
                  }}
                >
                  <X className="w-[12px] h-[12px]" />
                  Clear Filters
                </Button>
              )}

              {/* Active filter badges */}
              {statusFilter && (
                <Badge variant="info" className="gap-[4px]">
                  Status: {statusFilter}
                  <button
                    onClick={() => setStatusFilter("")}
                    className="hover:text-white cursor-pointer"
                  >
                    <X className="w-[10px] h-[10px]" />
                  </button>
                </Badge>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Mutation loading indicator */}
      {updateStatusMutation.isPending && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded bg-ops-accent-muted border border-ops-accent/30">
          <Loader2 className="w-[14px] h-[14px] text-ops-accent animate-spin" />
          <span className="font-kosugi text-[11px] text-ops-accent">
            Updating project status...
          </span>
        </div>
      )}

      {/* Pipeline Board */}
      <div
        ref={boardRef}
        className="flex-1 overflow-x-auto pb-2"
        onDrop={handleBoardDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="flex gap-2 min-w-min">
          {filteredColumns.map((column) => (
            <PipelineColumnComponent
              key={column.id}
              column={column}
              onCall={handleCall}
              onNote={handleNote}
              onAdvance={handleAdvance}
              onAddProject={() => setCreateModalOpen(true)}
              onViewDetail={setDetailProject}
            />
          ))}
        </div>
      </div>

      {/* Bottom summary bar */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1 rounded bg-background-panel border border-border">
        <div className="flex items-center gap-3">
          {filteredColumns.map((col) => (
            <div key={col.id} className="flex items-center gap-[6px]">
              <span
                className="w-[6px] h-[6px] rounded-full"
                style={{ backgroundColor: col.textColor }}
              />
              <span className="font-mono text-[10px] text-text-disabled">
                {col.label}: {col.cards.length}
              </span>
            </div>
          ))}
        </div>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase">
          Drag cards between columns to update stage
        </span>
      </div>

      <CreateProjectModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        defaultStatus={ProjectStatus.RFQ}
      />

      <ProjectDetailModal
        project={detailProject}
        open={detailProject !== null}
        onOpenChange={(open) => { if (!open) setDetailProject(null); }}
      />
    </div>
  );
}
