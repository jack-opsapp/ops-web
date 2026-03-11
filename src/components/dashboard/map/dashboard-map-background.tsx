"use client";

import { useEffect, useRef, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useMapFilterStore, useMapInstanceStore } from "@/stores/map-filter-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import {
  useProjects,
  useTasks,
  useCrewLocations,
} from "@/lib/hooks";
import {
  type Project,
  type ProjectTask,
  TaskStatus,
  isActiveProjectStatus,
} from "@/lib/types/models";
import { isSameDay } from "@/lib/utils/date";
import { resolveCrewStatus } from "@/lib/api/services/crew-location-service";
import type { CrewLocation } from "@/lib/api/services/crew-location-service";
import {
  createProjectPinWithLabel,
  createTaskPinIcon,
  createCrewPinIcon,
} from "./pin-icons";
import {
  projectPopupHtml,
  taskPopupHtml,
  crewPopupHtml,
  POPUP_OPTIONS,
} from "./pin-popups";

// Fix Leaflet default marker icon path issue
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)
  ._getIconUrl;

export function DashboardMapBackground() {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";
  const { isCollapsed } = useSidebarStore();
  const { view, showCrew } = useMapFilterStore();
  const setMapInstance = useMapInstanceStore((s) => s.setMap);
  const can = usePermissionStore((s) => s.can);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinLayerRef = useRef<L.LayerGroup | null>(null);
  const crewLayerRef = useRef<L.LayerGroup | null>(null);

  // Data hooks
  const { data: projectsData } = useProjects();
  const { data: tasksData } = useTasks();
  const { data: crewLocations } = useCrewLocations();
  const today = useMemo(() => new Date(), []);

  const projects = useMemo(
    () => projectsData?.projects ?? [],
    [projectsData]
  );
  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData]);

  // ── Build project coordinate lookup ──
  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      if (p.latitude && p.longitude && !p.deletedAt) map.set(p.id, p);
    }
    return map;
  }, [projects]);

  // ── Project coordinates for crew on-site detection ──
  const projectCoords = useMemo(() => {
    return Array.from(projectMap.values()).map((p) => ({
      lat: p.latitude!,
      lng: p.longitude!,
    }));
  }, [projectMap]);

  // ── TODAY mode: group tasks by project location ──
  const todayTasksByProject = useMemo(() => {
    if (view !== "today") return new Map<string, ProjectTask[]>();
    const grouped = new Map<string, ProjectTask[]>();
    for (const t of tasks) {
      if (t.deletedAt) continue;
      if (t.status === TaskStatus.Completed || t.status === TaskStatus.Cancelled)
        continue;
      if (!t.startDate) continue;
      if (!isSameDay(new Date(t.startDate), today)) continue;
      if (!projectMap.has(t.projectId)) continue;

      const existing = grouped.get(t.projectId) ?? [];
      existing.push(t);
      grouped.set(t.projectId, existing);
    }
    return grouped;
  }, [tasks, view, today, projectMap]);

  // ── ACTIVE/ALL mode: filter projects ──
  // Also used as fallback when "today" has no tasks
  const filteredProjects = useMemo(() => {
    if (view === "today" && todayTasksByProject.size > 0) return [];
    return Array.from(projectMap.values()).filter((p) => {
      if (view === "active" || view === "today") return isActiveProjectStatus(p.status);
      return true; // "all"
    });
  }, [projectMap, view, todayTasksByProject.size]);

  // Dimmed statuses for ALL mode (completed/closed/archived)
  const isDimmedStatus = (status: string) =>
    ["completed", "closed", "archived"].includes(status);

  // ── Initialize map ──
  // Depends on isDashboard so it re-creates when navigating back to dashboard
  useEffect(() => {
    if (!isDashboard || !containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.8283, -98.5795], // Center of US
      zoom: 4,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, subdomains: "abcd" }
    ).addTo(map);

    mapRef.current = map;
    setMapInstance(map);
    pinLayerRef.current = L.layerGroup().addTo(map);
    crewLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
      pinLayerRef.current = null;
      crewLayerRef.current = null;
    };
  }, [isDashboard, setMapInstance]);

  // ── Invalidate map size when sidebar toggles ──
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 250);
    return () => clearTimeout(timer);
  }, [isCollapsed]);

  // ── Helper: stagger-animate a marker element ──
  // Animate the first child instead of the marker container itself,
  // because Leaflet positions markers via transform: translate3d() on the container.
  // Overwriting that transform would reset all markers to position 0,0 (top-left).
  function animateMarker(el: HTMLElement | undefined, index: number) {
    if (!el) return;
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner) return;
    inner.style.opacity = "0";
    inner.style.transform = "scale(0.5)";
    inner.style.transition = `opacity 0.3s ease ${index * 0.05}s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 0.05}s`;
    requestAnimationFrame(() => {
      inner.style.opacity = "1";
      inner.style.transform = "scale(1)";
    });
  }

  // ── Helper: fit map to bounds ──
  function fitToBounds(map: L.Map, bounds: L.LatLngExpression[]) {
    if (bounds.length === 0) return;
    if (bounds.length === 1) {
      map.setView(bounds[0], 14, { animate: true, duration: 0.8 });
    } else {
      map.fitBounds(bounds as L.LatLngBoundsExpression, {
        padding: [80, 80],
        animate: true,
        duration: 0.8,
      });
    }
  }

  // ── Update pins based on view mode ──
  useEffect(() => {
    const layer = pinLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();

    if (!can("projects.view")) return;

    const bounds: L.LatLngExpression[] = [];
    const showTodayTasks = view === "today" && todayTasksByProject.size > 0;

    if (showTodayTasks) {
      // ── TODAY: Task-based pins grouped by project ──
      let idx = 0;
      for (const [projectId, projectTasks] of todayTasksByProject) {
        const project = projectMap.get(projectId)!;
        const lat = project.latitude!;
        const lng = project.longitude!;
        bounds.push([lat, lng]);

        const firstTask = projectTasks[0];
        const taskLabel =
          firstTask.customTitle || firstTask.taskType?.display || "Task";
        const extraCount = projectTasks.length - 1;

        const icon = createTaskPinIcon(
          taskLabel,
          project.title,
          firstTask.taskColor,
          extraCount
        );
        const marker = L.marker([lat, lng], { icon }).addTo(layer);
        marker.bindPopup(
          taskPopupHtml(projectTasks, project),
          POPUP_OPTIONS
        );
        animateMarker(marker.getElement(), idx++);
      }
    } else {
      // ── ACTIVE / ALL / TODAY-fallback: Project pins ──
      filteredProjects.forEach((project, i) => {
        const lat = project.latitude!;
        const lng = project.longitude!;
        bounds.push([lat, lng]);

        const dimmed = view === "all" && isDimmedStatus(project.status);
        const icon = createProjectPinWithLabel(
          project.status,
          project.title,
          dimmed
        );
        const marker = L.marker([lat, lng], { icon }).addTo(layer);
        marker.bindPopup(projectPopupHtml(project), POPUP_OPTIONS);
        animateMarker(marker.getElement(), i);
      });
    }

    fitToBounds(map, bounds);
  }, [view, todayTasksByProject, filteredProjects, projectMap, can]);

  // ── Update crew pins ──
  useEffect(() => {
    const layer = crewLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showCrew || !can("team.view")) return;
    if (!crewLocations || crewLocations.length === 0) return;

    crewLocations.forEach((loc: CrewLocation, i: number) => {
      const status = resolveCrewStatus(loc, projectCoords);
      const initials = (loc.firstName[0] || "") + (loc.lastName?.[0] || "");
      const icon = createCrewPinIcon(initials, loc.firstName, status);
      const marker = L.marker([loc.lat, loc.lng], { icon }).addTo(layer);
      marker.bindPopup(crewPopupHtml(loc, status), POPUP_OPTIONS);
      animateMarker(marker.getElement(), i);
    });
  }, [crewLocations, showCrew, projectCoords, can]);

  // Don't render on non-dashboard routes
  if (!isDashboard) return null;

  return (
    <>
      <div
        className={cn(
          "fixed top-0 bottom-0 right-0 z-0 transition-all duration-200 ease-out",
          isCollapsed ? "left-[72px]" : "left-[256px]"
        )}
      >
        <div ref={containerRef} className="w-full h-full" />

        {/* Vertical fade — map visible in middle ~50%, fades to black at top 25% and bottom 25% */}
        <div
          className="absolute inset-0 pointer-events-none z-[800]"
          style={{
            background: `linear-gradient(to bottom,
              rgba(13,13,13,1) 0%,
              rgba(13,13,13,0.95) 15%,
              rgba(13,13,13,0.6) 25%,
              transparent 35%,
              transparent 65%,
              rgba(13,13,13,0.6) 75%,
              rgba(13,13,13,0.95) 85%,
              rgba(13,13,13,1) 100%
            )`,
          }}
        />

        {/* Side vignette — subtle darkening at edges */}
        <div
          className="absolute inset-0 pointer-events-none z-[800]"
          style={{
            background: "radial-gradient(ellipse at center, transparent 50%, rgba(13,13,13,0.5) 100%)",
          }}
        />
      </div>

      {/* Global map CSS */}
      <style jsx global>{`
        .ops-map-marker {
          background: transparent !important;
          border: none !important;
        }
        .ops-map-marker:hover .ops-pin--project,
        .ops-map-marker:hover .ops-pin--project-labeled > div:first-child {
          transform: rotate(-45deg) scale(1.15) !important;
          box-shadow: 0 0 20px currentColor !important;
        }
        .ops-map-marker:hover .ops-pin--task > div:first-child,
        .ops-map-marker:hover .ops-pin--crew > div:first-child {
          transform: scale(1.15);
        }
        .ops-map-popup .leaflet-popup-content-wrapper {
          background: transparent;
          box-shadow: none;
          padding: 0;
          border-radius: 4px;
        }
        .ops-map-popup .leaflet-popup-content {
          margin: 0;
        }
        .ops-map-popup .leaflet-popup-tip {
          background: rgba(10, 10, 10, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .leaflet-control-zoom {
          display: none !important;
        }
      `}</style>
    </>
  );
}
