"use client";

/**
 * ProjectMapView — the MAP view mode of the Projects surface (P3.5).
 *
 * Absorbs the standalone Leaflet /map page as a third view mode (canvas /
 * table / map). Owns the map-local concerns — status filter, selected pin,
 * drawer collapse — and composes the Mapbox canvas with the SITES drawer.
 * The incoming `projects` are already search/member/client-filtered by the
 * Projects page, so the map honors the surface-wide filters; only the
 * map-specific status chips live here.
 *
 * Interaction model (master plan §4): a pin click opens the floating project
 * workspace window, never a navigation. A drawer row *locates* a pinned job
 * (the map flies to it); an un-geocoded row opens the window to add an address.
 */

import { useCallback, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { usePreferencesStore } from "@/stores/preferences-store";
import type { FilterChipOption } from "@/components/ui/filter-chip";
import {
  ProjectStatus,
  isActiveProjectStatus,
  type Project,
} from "@/lib/types/models";
import { ProjectMapCanvas } from "./project-map-canvas";
import { ProjectSitesDrawer } from "./project-sites-drawer";

export type MapStatusFilter = "all" | "active" | ProjectStatus;

interface ProjectMapViewProps {
  /** Page-level filtered projects (search/member/client applied, non-deleted). */
  projects: Project[];
  /** Opens the floating workspace window in viewing mode. */
  onOpenProject: (projectId: string) => void;
}

export function ProjectMapView({ projects, onOpenProject }: ProjectMapViewProps) {
  const { t } = useDictionary("projects-canvas");
  const reducedMotion = useReducedMotion() ?? false;
  const mapDefaultZoom = usePreferencesStore((s) => s.mapDefaultZoom);

  const [statusFilter, setStatusFilter] = useState<MapStatusFilter>("active");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);

  // Archived never appears on the map (it has its own tray). The status chips
  // then narrow within the non-archived set.
  const visibleProjects = useMemo(() => {
    let result = projects.filter((p) => p.status !== ProjectStatus.Archived);
    if (statusFilter === "active") {
      result = result.filter((p) => isActiveProjectStatus(p.status));
    } else if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    return result;
  }, [projects, statusFilter]);

  const statusOptions: FilterChipOption<MapStatusFilter>[] = useMemo(
    () => [
      { value: "all", label: t("map.filter.all") },
      { value: "active", label: t("map.filter.active") },
      { value: ProjectStatus.RFQ, label: t("map.filter.rfq") },
      { value: ProjectStatus.Estimated, label: t("map.filter.estimated") },
      { value: ProjectStatus.Accepted, label: t("map.filter.accepted") },
      { value: ProjectStatus.InProgress, label: t("map.filter.inProgress") },
      { value: ProjectStatus.Completed, label: t("map.filter.completed") },
    ],
    [t],
  );

  // Pinned row → fly to it + select (does not open the window).
  const handleLocate = useCallback((project: Project) => {
    setSelectedProjectId(project.id);
  }, []);

  // Pin click → select + open the workspace window.
  const handlePinClick = useCallback(
    (project: Project) => {
      setSelectedProjectId(project.id);
      onOpenProject(project.id);
    },
    [onOpenProject],
  );

  // Un-geocoded row → open the window (to add an address).
  const handleOpenNoGps = useCallback(
    (project: Project) => {
      onOpenProject(project.id);
    },
    [onOpenProject],
  );

  const handleOpenInMaps = useCallback((project: Project) => {
    if (project.latitude != null && project.longitude != null) {
      window.open(`https://www.google.com/maps?q=${project.latitude},${project.longitude}`, "_blank", "noopener,noreferrer");
    } else if (project.address) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`, "_blank", "noopener,noreferrer");
    }
  }, []);

  return (
    <div className="absolute inset-0">
      <ProjectMapCanvas
        projects={visibleProjects}
        selectedProjectId={selectedProjectId}
        onPinClick={handlePinClick}
        defaultZoom={mapDefaultZoom}
        reducedMotion={reducedMotion}
      />
      <ProjectSitesDrawer
        projects={visibleProjects}
        statusFilter={statusFilter}
        statusOptions={statusOptions}
        onStatusChange={setStatusFilter}
        selectedProjectId={selectedProjectId}
        onLocate={handleLocate}
        onOpen={handleOpenNoGps}
        onOpenInMaps={handleOpenInMaps}
        collapsed={drawerCollapsed}
        onToggleCollapsed={() => setDrawerCollapsed((v) => !v)}
        totalCount={visibleProjects.length}
      />
    </div>
  );
}
