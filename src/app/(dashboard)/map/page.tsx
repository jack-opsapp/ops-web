"use client";

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  MapPin,
  Navigation,
  Search,
  Filter,
  ExternalLink,
  ChevronRight,
  Loader2,
  Layers,
  List,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useProjects } from "@/lib/hooks/use-projects";
import {
  ProjectStatus,
  PROJECT_STATUS_COLORS,
  isActiveProjectStatus,
} from "@/lib/types/models";
import type { Project } from "@/lib/types/models";

// Dynamically import the map component (Leaflet needs window)
const ProjectMap = dynamic(
  () => import("@/components/ops/project-map").then((m) => ({ default: m.ProjectMap })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-background-card">
        <div className="flex flex-col items-center gap-1">
          <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
          <span className="font-mono text-[11px] text-text-disabled tracking-wider">
            LOADING MAP ENGINE...
          </span>
        </div>
      </div>
    ),
  }
);

const STATUS_FILTERS: { value: "all" | "active" | ProjectStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: ProjectStatus.RFQ, label: "RFQ" },
  { value: ProjectStatus.Estimated, label: "Estimated" },
  { value: ProjectStatus.Accepted, label: "Accepted" },
  { value: ProjectStatus.InProgress, label: "In Progress" },
  { value: ProjectStatus.Completed, label: "Completed" },
];

function ProjectListItem({
  project,
  isSelected,
  onSelect,
}: {
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const statusColor = PROJECT_STATUS_COLORS[project.status] || "#417394";
  const hasLocation = project.latitude != null && project.longitude != null;

  const openInMaps = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (project.latitude && project.longitude) {
        window.open(
          `https://www.google.com/maps?q=${project.latitude},${project.longitude}`,
          "_blank"
        );
      } else if (project.address) {
        window.open(
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`,
          "_blank"
        );
      }
    },
    [project]
  );

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-1.5 py-1 rounded-lg transition-all duration-150",
        "border border-transparent",
        "hover:bg-background-elevated",
        isSelected && "bg-background-elevated border-ops-accent/30 shadow-[inset_2px_0_0_0_#417394]"
      )}
    >
      <div className="flex items-start gap-1">
        <div
          className="mt-[3px] w-[8px] h-[8px] rounded-full shrink-0"
          style={{ backgroundColor: statusColor }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <h3 className="font-mohave text-body-sm text-text-primary truncate">
              {project.title}
            </h3>
            {(hasLocation || project.address) && (
              <button
                onClick={openInMaps}
                className="text-text-disabled hover:text-ops-accent transition-colors shrink-0"
                title="Open in Google Maps"
              >
                <ExternalLink className="w-[12px] h-[12px]" />
              </button>
            )}
          </div>
          <p className="font-kosugi text-[10px] text-text-tertiary truncate">
            {project.address || "No address"}
          </p>
          <div className="flex items-center gap-1 mt-[2px]">
            <span
              className="font-mono text-[9px] px-[4px] py-[1px] rounded"
              style={{
                color: statusColor,
                backgroundColor: `${statusColor}15`,
              }}
            >
              {project.status}
            </span>
            {!hasLocation && (
              <span className="font-mono text-[9px] text-text-disabled">NO GPS</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function MapPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | ProjectStatus>("active");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  const { data, isLoading } = useProjects();
  const projects = data?.projects ?? [];

  // Filter projects
  const filteredProjects = useMemo(() => {
    let filtered = projects.filter((p) => !p.deletedAt);

    // Status filter
    if (statusFilter === "active") {
      filtered = filtered.filter((p) => isActiveProjectStatus(p.status));
    } else if (statusFilter !== "all") {
      filtered = filtered.filter((p) => p.status === statusFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.address?.toLowerCase().includes(q) ||
          p.notes?.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [projects, statusFilter, searchQuery]);

  const mappableCount = filteredProjects.filter(
    (p) => p.latitude != null && p.longitude != null
  ).length;

  const handleProjectSelect = useCallback((project: Project) => {
    setSelectedProjectId(project.id);
  }, []);

  return (
    <div className="flex h-[calc(100vh-56px)] -m-3 relative">
      {/* Sidebar */}
      <div
        className={cn(
          "flex flex-col border-r border-border bg-background transition-all duration-200",
          showSidebar ? "w-[320px]" : "w-0 overflow-hidden"
        )}
      >
        {/* Header */}
        <div className="p-1.5 border-b border-border space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-[6px]">
              <MapPin className="w-[16px] h-[16px] text-ops-accent" />
              <h2 className="font-mohave text-heading text-text-primary">MAP</h2>
            </div>
            <div className="flex items-center gap-[6px]">
              <span className="font-mono text-[10px] text-text-disabled">
                {mappableCount}/{filteredProjects.length} pinned
              </span>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-[8px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-disabled" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className={cn(
                "w-full pl-[28px] pr-[28px] py-[6px] rounded-lg",
                "bg-background-input border border-border",
                "font-mohave text-body-sm text-text-primary",
                "placeholder:text-text-disabled",
                "focus:border-border-medium focus:outline-none"
              )}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-[8px] top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-tertiary"
              >
                <X className="w-[12px] h-[12px]" />
              </button>
            )}
          </div>

          {/* Status filters */}
          <div className="flex flex-wrap gap-[4px]">
            {STATUS_FILTERS.map((filter) => {
              const isActive = statusFilter === filter.value;
              const dotColor =
                filter.value !== "all" && filter.value !== "active"
                  ? PROJECT_STATUS_COLORS[filter.value as ProjectStatus]
                  : undefined;

              return (
                <button
                  key={filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                  className={cn(
                    "flex items-center gap-[3px] px-[6px] py-[2px] rounded text-[10px] font-mono transition-colors",
                    isActive
                      ? "bg-ops-accent/20 text-ops-accent border border-ops-accent/30"
                      : "bg-background-elevated text-text-disabled border border-transparent hover:text-text-tertiary"
                  )}
                >
                  {dotColor && (
                    <span
                      className="w-[5px] h-[5px] rounded-full"
                      style={{ backgroundColor: dotColor }}
                    />
                  )}
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto p-1 space-y-[4px]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-6">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
              <span className="font-mono text-[10px] text-text-disabled mt-1">
                LOADING PROJECTS...
              </span>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <MapPin className="w-[24px] h-[24px] text-text-disabled mb-1" />
              <span className="font-mohave text-body-sm text-text-tertiary">
                No projects found
              </span>
              <span className="font-kosugi text-[10px] text-text-disabled">
                {searchQuery ? "Try a different search" : "Create a project to see it here"}
              </span>
            </div>
          ) : (
            filteredProjects.map((project) => (
              <ProjectListItem
                key={project.id}
                project={project}
                isSelected={selectedProjectId === project.id}
                onSelect={() => handleProjectSelect(project)}
              />
            ))
          )}
        </div>

        {/* Stats footer */}
        <div className="px-1.5 py-1 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-[3px]">
              <span className="w-[4px] h-[4px] rounded-full bg-[#6B8F71]" />
              <span className="font-mono text-[9px] text-text-disabled">Live</span>
            </div>
          </div>
          <span className="font-mono text-[9px] text-text-disabled">
            {projects.length} total projects
          </span>
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 relative">
        <ProjectMap
          projects={filteredProjects}
          selectedProjectId={selectedProjectId}
          onProjectSelect={handleProjectSelect}
        />

        {/* Toggle sidebar button */}
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className={cn(
            "absolute top-2 left-2 z-[1000]",
            "w-[36px] h-[36px] rounded-lg",
            "bg-background-panel/90 backdrop-blur border border-border",
            "flex items-center justify-center",
            "text-text-tertiary hover:text-text-primary transition-colors",
            "shadow-floating"
          )}
          title={showSidebar ? "Hide sidebar" : "Show sidebar"}
        >
          {showSidebar ? (
            <ChevronRight className="w-[16px] h-[16px] rotate-180" />
          ) : (
            <List className="w-[16px] h-[16px]" />
          )}
        </button>

        {/* Map legend */}
        <div
          className={cn(
            "absolute bottom-10 left-2 z-[1000]",
            "bg-background-panel/90 backdrop-blur border border-border rounded-lg",
            "p-1 shadow-floating"
          )}
        >
          <div className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest mb-[4px]">
            Status
          </div>
          <div className="space-y-[3px]">
            {[
              ProjectStatus.RFQ,
              ProjectStatus.Estimated,
              ProjectStatus.Accepted,
              ProjectStatus.InProgress,
              ProjectStatus.Completed,
            ].map((status) => (
              <div key={status} className="flex items-center gap-[6px]">
                <span
                  className="w-[6px] h-[6px] rounded-full"
                  style={{ backgroundColor: PROJECT_STATUS_COLORS[status] }}
                />
                <span className="font-mono text-[9px] text-text-tertiary">{status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
