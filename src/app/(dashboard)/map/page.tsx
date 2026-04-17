"use client";

import { useState, useMemo, useCallback } from "react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import dynamic from "next/dynamic";
import {
  MapPin,
  Search,
  ExternalLink,
  ChevronRight,
  Loader2,
  List,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useScopedProjects } from "@/lib/hooks/use-projects";
import { useMapMetrics } from "@/lib/hooks";
import { MetricsHeader } from "@/components/metrics";
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
      <div className="w-full h-full flex items-center justify-center bg-glass glass-surface">
        <div className="flex flex-col items-center gap-1">
          <Loader2 className="w-[24px] h-[24px] text-text-2 animate-spin" />
          <span className="font-mono text-[11px] text-text-mute tracking-wider">
            LOADING MAP ENGINE...
          </span>
        </div>
      </div>
    ),
  }
);

function ProjectListItem({
  project,
  isSelected,
  onSelect,
}: {
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { t } = useDictionary("dashboard");
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
        "hover:bg-fill-neutral-dim",
        isSelected && "bg-fill-neutral-dim border-[rgba(255,255,255,0.15)] shadow-[inset_2px_0_0_0_#417394]"
      )}
    >
      <div className="flex items-start gap-1">
        <div
          className="mt-[3px] w-[8px] h-[8px] rounded-full shrink-0"
          style={{ backgroundColor: statusColor }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <h3 className="font-mohave text-body-sm text-text truncate">
              {project.title}
            </h3>
            {(hasLocation || project.address) && (
              <button
                onClick={openInMaps}
                className="text-text-mute hover:text-text transition-colors shrink-0"
                title={t("map.openInGoogleMaps")}
              >
                <ExternalLink className="w-[12px] h-[12px]" />
              </button>
            )}
          </div>
          <p className="font-mono text-micro text-text-3 truncate">
            {project.address || t("map.noAddress")}
          </p>
          <div className="flex items-center gap-1 mt-[2px]">
            <span
              className="font-mono text-micro px-[4px] py-[1px] rounded"
              style={{
                color: statusColor,
                backgroundColor: `${statusColor}15`,
              }}
            >
              {project.status}
            </span>
            {!hasLocation && (
              <span className="font-mono text-micro text-text-mute">{t("map.noGps")}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function MapPage() {
  usePageTitle("Map");
  const { t } = useDictionary("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | ProjectStatus>("active");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  const { data: mapMetrics = [], isLoading: mapMetricsLoading } = useMapMetrics();
  const { data, isLoading } = useScopedProjects();
  const projects = useMemo(() => data?.projects ?? [], [data]);

  const STATUS_FILTERS: { value: "all" | "active" | ProjectStatus; label: string }[] = useMemo(() => [
    { value: "all", label: t("map.filterAll") },
    { value: "active", label: t("map.filterActive") },
    { value: ProjectStatus.RFQ, label: t("map.filterRfq") },
    { value: ProjectStatus.Estimated, label: t("map.filterEstimated") },
    { value: ProjectStatus.Accepted, label: t("map.filterAccepted") },
    { value: ProjectStatus.InProgress, label: t("map.filterInProgress") },
    { value: ProjectStatus.Completed, label: t("map.filterCompleted") },
  ], [t]);

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
    <div className="flex flex-col h-[calc(100vh-68px)] -m-3 relative">
      <div className="px-3 pt-3">
        <MetricsHeader variant="compact" tabId="map" title="Map" metrics={mapMetrics} isLoading={mapMetricsLoading} />
      </div>
      <div className="flex flex-1 min-h-0 relative">
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
              <MapPin className="w-[16px] h-[16px] text-text-2" />
              <span className="font-cakemono text-body font-light text-text uppercase tracking-wider">{t("map.projects")}</span>
            </div>
            <div className="flex items-center gap-[6px]">
              <span className="font-mono text-micro text-text-mute">
                {mappableCount}/{filteredProjects.length} {t("map.pinned")}
              </span>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-[8px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-mute" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("map.searchPlaceholder")}
              className={cn(
                "w-full pl-[28px] pr-[28px] py-[6px] rounded-lg",
                "bg-surface-input border border-border",
                "font-mohave text-body-sm text-text",
                "placeholder:text-text-mute",
                "focus:border-border-medium focus:outline-none"
              )}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-[8px] top-1/2 -translate-y-1/2 text-text-mute hover:text-text-3"
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
                    "flex items-center gap-[3px] px-[6px] py-[2px] rounded text-micro font-mono transition-colors",
                    isActive
                      ? "bg-[rgba(255,255,255,0.08)] text-text border border-[rgba(255,255,255,0.18)]"
                      : "bg-fill-neutral-dim text-text-mute border border-transparent hover:text-text-3"
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
              <Loader2 className="w-[20px] h-[20px] text-text-2 animate-spin" />
              <span className="font-mono text-micro text-text-mute mt-1">
                {t("map.loadingProjects")}
              </span>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <MapPin className="w-[24px] h-[24px] text-text-mute mb-1" />
              <span className="font-mohave text-body-sm text-text-3">
                {t("map.noProjectsFound")}
              </span>
              <span className="font-mono text-micro text-text-mute">
                {searchQuery ? t("map.tryDifferentSearch") : t("map.createProjectPrompt")}
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
              <span className="font-mono text-micro text-text-mute">{t("map.live")}</span>
            </div>
          </div>
          <span className="font-mono text-micro text-text-mute">
            {projects.length} {t("map.totalProjects")}
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
            "bg-glass glass-surface/90 backdrop-blur border border-border",
            "flex items-center justify-center",
            "text-text-3 hover:text-text transition-colors"
          )}
          title={showSidebar ? t("map.hideSidebar") : t("map.showSidebar")}
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
            "bg-glass glass-surface backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded-[5px]",
            "p-1"
          )}
        >
          <div className="font-mono text-micro text-text-mute uppercase tracking-widest mb-[4px]">
            {t("map.status")}
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
                <span className="font-mono text-micro text-text-3">{status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
