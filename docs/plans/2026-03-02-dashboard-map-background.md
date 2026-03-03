# Dashboard Map Background Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Leaflet map as a fixed background layer behind the dashboard widget grid, with project/task/crew/event pins and a collapsible filter icon rail.

**Architecture:** The map renders as a fixed-position layer in `dashboard-layout.tsx` behind the scrollable content. A new Zustand store manages filter state. Pin data comes from existing hooks (`useProjects`, `useTasks`, `useTeamMembers`, `useCalendarEventsForRange`). A collapsible icon rail on the right edge controls which pins are visible.

**Tech Stack:** Next.js 15, React 19, Leaflet 1.9.4, Framer Motion 12, Zustand 5, Tailwind CSS 3.4, Lucide React icons.

**Design Doc:** `docs/plans/2026-03-02-dashboard-map-background-design.md`

**Key Reference Files:**
- Layout: `src/components/layouts/dashboard-layout.tsx`
- Existing map: `src/components/ops/project-map.tsx`
- Models: `src/lib/types/models.ts` (Project has lat/lng; CalendarEvent does NOT have location — use project's lat/lng)
- Hooks: `src/lib/hooks/` (useProjects, useTasks, useTeamMembers, useCalendarEventsForRange)
- Stores pattern: `src/stores/sidebar-store.ts` (Zustand + persist)
- Permissions: `src/lib/store/permissions-store.ts` (can(permission, scope?))
- Card styling: `src/components/ui/card.tsx` (default variant: `bg-[rgba(13,13,13,0.6)] backdrop-blur-xl`)
- Widget grid: `src/components/dashboard/widget-grid.tsx` (CSS Grid 8-col, 140px rows)
- Widget shell: `src/components/dashboard/widget-shell.tsx` (motion.div wrapper)
- Content header: `src/components/layouts/content-header.tsx` (uses `usePathname()` for route detection)
- Sidebar store: `src/stores/sidebar-store.ts` (isCollapsed state, persisted)

---

## Task 1: Create Map Filter Zustand Store

**Files:**
- Create: `src/stores/map-filter-store.ts`

**Step 1: Create the store**

```typescript
// src/stores/map-filter-store.ts
"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MapViewFilter = "today" | "active" | "all";

interface MapFilterState {
  view: MapViewFilter;
  showCrew: boolean;
  showEvents: boolean;
  railExpanded: boolean;
  setView: (view: MapViewFilter) => void;
  toggleCrew: () => void;
  toggleEvents: () => void;
  toggleRail: () => void;
}

export const useMapFilterStore = create<MapFilterState>()(
  persist(
    (set) => ({
      view: "today",
      showCrew: true,
      showEvents: false,
      railExpanded: false,
      setView: (view) => set({ view }),
      toggleCrew: () => set((s) => ({ showCrew: !s.showCrew })),
      toggleEvents: () => set((s) => ({ showEvents: !s.showEvents })),
      toggleRail: () => set((s) => ({ railExpanded: !s.railExpanded })),
    }),
    { name: "ops-map-filter" }
  )
);
```

**Step 2: Commit**

```bash
git add src/stores/map-filter-store.ts
git commit -m "feat(dashboard): add map filter Zustand store"
```

---

## Task 2: Create Pin Icon Factories

Custom Leaflet DivIcon factories for each pin type. These generate the HTML/CSS for map markers.

**Files:**
- Create: `src/components/dashboard/map/pin-icons.ts`

**Step 1: Create pin icon factories**

```typescript
// src/components/dashboard/map/pin-icons.ts
import L from "leaflet";
import { PROJECT_STATUS_COLORS, type ProjectStatus } from "@/lib/types/models";

// ── Task type colors (from tailwind config tasktype tokens) ──
const TASK_TYPE_COLORS: Record<string, string> = {
  estimate: "#A5B368",
  quote: "#59779F",
  material: "#C4A868",
  installation: "#931A32",
  inspection: "#7B68A6",
  completion: "#4A4A4A",
};

// ── Project Pin: teardrop with status color + white center dot + glow ──
export function createProjectPinIcon(status: ProjectStatus): L.DivIcon {
  const color = PROJECT_STATUS_COLORS[status] || "#8195B5";
  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--project" style="
        width: 28px; height: 28px;
        background: ${color};
        border: 2px solid rgba(0,0,0,0.4);
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 0 12px ${color}4D;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      ">
        <div style="
          width: 10px; height: 10px;
          background: white;
          border-radius: 50%;
          margin: 7px auto 0;
          transform: rotate(45deg);
        "></div>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

// ── Task Pin: smaller circle with task-type color ring + label ──
export function createTaskPinIcon(
  taskTypeName: string,
  taskLabel: string,
  taskColor?: string
): L.DivIcon {
  const color = taskColor || TASK_TYPE_COLORS[taskTypeName.toLowerCase()] || "#8195B5";
  const truncLabel = taskLabel.length > 12 ? taskLabel.slice(0, 12) + "..." : taskLabel;
  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--task" style="
        display: flex; flex-direction: column; align-items: center;
      ">
        <div style="
          width: 18px; height: 18px;
          border: 2.5px solid ${color};
          border-radius: 50%;
          background: rgba(10,10,10,0.8);
          box-shadow: 0 0 8px ${color}33;
          transition: transform 0.15s ease;
        ">
          <div style="
            width: 6px; height: 6px;
            background: ${color};
            border-radius: 50%;
            margin: 3.5px auto 0;
          "></div>
        </div>
        <span style="
          font-family: 'Kosugi', sans-serif;
          font-size: 9px;
          color: #A7A7A7;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 3px;
          white-space: nowrap;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">${truncLabel}</span>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [60, 34],
    iconAnchor: [30, 9],
    popupAnchor: [0, -12],
  });
}

// ── Crew Pin: circle with status ring + initials + name label ──
export type CrewStatus = "on-site" | "en-route" | "idle";

const CREW_STATUS_COLORS: Record<CrewStatus, string> = {
  "on-site": "#A5B368",
  "en-route": "#C4A868",
  idle: "#8E8E93",
};

export function createCrewPinIcon(
  initials: string,
  firstName: string,
  status: CrewStatus = "idle"
): L.DivIcon {
  const ringColor = CREW_STATUS_COLORS[status];
  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--crew" style="
        display: flex; flex-direction: column; align-items: center;
      ">
        <div style="
          width: 32px; height: 32px;
          border: 2.5px solid ${ringColor};
          border-radius: 50%;
          background: #191919;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 8px ${ringColor}33;
          transition: border-color 0.3s ease, transform 0.15s ease;
        ">
          <span style="
            font-family: 'Kosugi', sans-serif;
            font-size: 10px;
            color: #E5E5E5;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          ">${initials}</span>
        </div>
        <span style="
          font-family: 'Kosugi', sans-serif;
          font-size: 9px;
          color: #A7A7A7;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 3px;
          white-space: nowrap;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">${firstName}</span>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [60, 48],
    iconAnchor: [30, 16],
    popupAnchor: [0, -20],
  });
}

// ── Event Pin: diamond shape, accent color, calendar icon ──
export function createEventPinIcon(eventTitle: string): L.DivIcon {
  const truncTitle = eventTitle.length > 14 ? eventTitle.slice(0, 14) + "..." : eventTitle;
  return L.divIcon({
    html: `
      <div class="ops-pin ops-pin--event" style="
        display: flex; flex-direction: column; align-items: center;
      ">
        <div style="
          width: 20px; height: 20px;
          background: rgba(89,119,148,0.85);
          border: 1.5px solid rgba(89,119,148,0.6);
          border-radius: 3px;
          transform: rotate(45deg);
          box-shadow: 0 0 8px rgba(89,119,148,0.25);
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.15s ease;
        ">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(-45deg);">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </div>
        <span style="
          font-family: 'Kosugi', sans-serif;
          font-size: 9px;
          color: #A7A7A7;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 5px;
          white-space: nowrap;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        ">${truncTitle}</span>
      </div>
    `,
    className: "ops-map-marker",
    iconSize: [60, 42],
    iconAnchor: [30, 10],
    popupAnchor: [0, -14],
  });
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/map/pin-icons.ts
git commit -m "feat(dashboard): add Leaflet pin icon factories for project/task/crew/event"
```

---

## Task 3: Create Popup Factory

Shared popup HTML generators for frosted-glass pin popups.

**Files:**
- Create: `src/components/dashboard/map/pin-popups.ts`

**Step 1: Create popup factory**

```typescript
// src/components/dashboard/map/pin-popups.ts
import type { Project, ProjectTask } from "@/lib/types/models";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";

const POPUP_OPTIONS: L.PopupOptions = {
  className: "ops-map-popup",
  closeButton: false,
  maxWidth: 220,
  minWidth: 180,
};

export { POPUP_OPTIONS };

export function projectPopupHtml(project: Project): string {
  const statusColor = PROJECT_STATUS_COLORS[project.status] || "#8195B5";
  return `<div style="
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    color: #E5E5E5; padding: 10px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 180px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">${project.title}</div>
    <div style="font-size: 11px; color: #999; margin-bottom: 6px; font-family: 'Kosugi', sans-serif;">${project.address || "No address"}</div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="
        display: inline-block; width: 8px; height: 8px;
        border-radius: 50%; background: ${statusColor};
        box-shadow: 0 0 4px ${statusColor};
      "></span>
      <span style="font-size: 11px; color: ${statusColor}; font-family: 'Kosugi', sans-serif; text-transform: uppercase;">${project.status}</span>
    </div>
  </div>`;
}

export function taskPopupHtml(task: ProjectTask): string {
  const color = task.taskColor || "#8195B5";
  const title = task.customTitle || task.taskType?.name || "Task";
  const projectTitle = task.project?.title || "";
  return `<div style="
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    color: #E5E5E5; padding: 10px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 160px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 13px; font-weight: 600; margin-bottom: 2px;">${title}</div>
    ${projectTitle ? `<div style="font-size: 11px; color: #777; font-family: 'Kosugi', sans-serif; margin-bottom: 4px;">${projectTitle}</div>` : ""}
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="
        display: inline-block; width: 8px; height: 8px;
        border-radius: 50%; background: ${color};
      "></span>
      <span style="font-size: 10px; color: #A7A7A7; font-family: 'Kosugi', sans-serif; text-transform: uppercase;">${task.status}</span>
    </div>
  </div>`;
}

export function crewPopupHtml(name: string, role?: string): string {
  return `<div style="
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    color: #E5E5E5; padding: 8px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 120px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 13px; font-weight: 600;">${name}</div>
    ${role ? `<div style="font-size: 10px; color: #777; font-family: 'Kosugi', sans-serif; text-transform: uppercase; margin-top: 2px;">${role}</div>` : ""}
  </div>`;
}

export function eventPopupHtml(title: string, date?: string): string {
  return `<div style="
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    color: #E5E5E5; padding: 8px 12px;
    border-radius: 4px; font-family: 'Mohave', sans-serif;
    min-width: 120px; border: 1px solid rgba(255,255,255,0.08);
  ">
    <div style="font-size: 13px; font-weight: 600;">${title}</div>
    ${date ? `<div style="font-size: 10px; color: #597794; font-family: 'Kosugi', sans-serif; margin-top: 2px;">${date}</div>` : ""}
  </div>`;
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/map/pin-popups.ts
git commit -m "feat(dashboard): add frosted-glass popup HTML factories for map pins"
```

---

## Task 4: Create DashboardMapBackground Component

The core map component — Leaflet map with all pin layers, filter-reactive.

**Files:**
- Create: `src/components/dashboard/map/dashboard-map-background.tsx`

**Dependencies:** Task 1 (store), Task 2 (pin icons), Task 3 (popups)

**Step 1: Create the component**

This is a large component. Key responsibilities:
- Initialize Leaflet map (CartoDB dark tiles, no attribution clutter)
- Separate layer groups for each pin type (projects, tasks, crew, events)
- React to `useMapFilterStore` to show/hide layers and filter data
- Use `useProjects`, `useTasks`, `useTeamMembers`, `useCalendarEventsForRange` for data
- Permission-gate each layer with `usePermissionStore`
- Fit bounds on data change
- Vignette gradient overlay
- Pin stagger animation on load/filter change (CSS animation classes injected into DivIcon HTML)

```typescript
// src/components/dashboard/map/dashboard-map-background.tsx
"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useMapFilterStore } from "@/stores/map-filter-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import {
  useProjects,
  useTasks,
  useTeamMembers,
  useCalendarEventsForRange,
} from "@/lib/hooks";
import {
  type Project,
  type ProjectTask,
  type CalendarEvent,
  TaskStatus,
  isActiveProjectStatus,
} from "@/lib/types/models";
import { isSameDay } from "@/lib/utils/date";
import {
  createProjectPinIcon,
  createTaskPinIcon,
  createCrewPinIcon,
  createEventPinIcon,
} from "./pin-icons";
import {
  projectPopupHtml,
  taskPopupHtml,
  crewPopupHtml,
  eventPopupHtml,
  POPUP_OPTIONS,
} from "./pin-popups";

// Fix Leaflet default marker icon path issue
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;

export function DashboardMapBackground() {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";
  const { isCollapsed } = useSidebarStore();
  const { view, showCrew, showEvents } = useMapFilterStore();
  const can = usePermissionStore((s) => s.can);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const projectLayerRef = useRef<L.LayerGroup | null>(null);
  const taskLayerRef = useRef<L.LayerGroup | null>(null);
  const crewLayerRef = useRef<L.LayerGroup | null>(null);
  const eventLayerRef = useRef<L.LayerGroup | null>(null);

  // Data hooks
  const { data: projectsData } = useProjects();
  const { data: tasksData } = useTasks();
  const { data: teamData } = useTeamMembers();
  const today = useMemo(() => new Date(), []);
  const todayEnd = useMemo(() => {
    const d = new Date(today);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [today]);
  const { data: calendarEvents } = useCalendarEventsForRange(today, todayEnd);

  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);
  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData]);
  const teamMembers = useMemo(() => teamData?.users ?? [], [teamData]);
  const events = useMemo(() => calendarEvents ?? [], [calendarEvents]);

  // ── Filtered data based on view ──
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (!p.latitude || !p.longitude || p.deletedAt) return false;
      if (view === "active") return isActiveProjectStatus(p.status);
      if (view === "all") return true;
      // "today" — handled by tasks, not projects directly
      return false;
    });
  }, [projects, view]);

  const filteredTasks = useMemo(() => {
    if (view !== "today") return [];
    return tasks.filter((t) => {
      if (t.deletedAt) return false;
      if (t.status === TaskStatus.Completed || t.status === TaskStatus.Cancelled) return false;
      if (!t.calendarEvent?.startDate) return false;
      return isSameDay(new Date(t.calendarEvent.startDate), today);
    });
  }, [tasks, view, today]);

  // Tasks need project lat/lng — build lookup
  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      if (p.latitude && p.longitude) map.set(p.id, p);
    }
    return map;
  }, [projects]);

  const mappableTasks = useMemo(() => {
    return filteredTasks.filter((t) => projectMap.has(t.projectId));
  }, [filteredTasks, projectMap]);

  // Events use project lat/lng
  const mappableEvents = useMemo(() => {
    if (!showEvents) return [];
    return events.filter((e) => !e.deletedAt && e.projectId && projectMap.has(e.projectId));
  }, [events, showEvents, projectMap]);

  // ── Initialize map ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.8283, -98.5795],
      zoom: 4,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapRef.current = map;
    projectLayerRef.current = L.layerGroup().addTo(map);
    taskLayerRef.current = L.layerGroup().addTo(map);
    crewLayerRef.current = L.layerGroup().addTo(map);
    eventLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      projectLayerRef.current = null;
      taskLayerRef.current = null;
      crewLayerRef.current = null;
      eventLayerRef.current = null;
    };
  }, []);

  // ── Invalidate map size when sidebar toggles ──
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 250); // after sidebar transition
    return () => clearTimeout(timer);
  }, [isCollapsed]);

  // ── Update project pins ──
  useEffect(() => {
    const layer = projectLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();

    if (!can("projects.view")) return;

    const bounds: L.LatLngExpression[] = [];

    filteredProjects.forEach((project, i) => {
      const lat = project.latitude!;
      const lng = project.longitude!;
      bounds.push([lat, lng]);

      const icon = createProjectPinIcon(project.status);
      const marker = L.marker([lat, lng], { icon }).addTo(layer);
      marker.bindPopup(projectPopupHtml(project), POPUP_OPTIONS);

      // Stagger animation via CSS
      const el = marker.getElement();
      if (el) {
        el.style.opacity = "0";
        el.style.transform = "scale(0.5)";
        el.style.transition = `opacity 0.3s ease ${i * 0.05}s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.05}s`;
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "scale(1)";
        });
      }
    });

    if (bounds.length > 0) {
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
  }, [filteredProjects, can]);

  // ── Update task pins ──
  useEffect(() => {
    const layer = taskLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();

    if (!can("projects.view")) return;

    const bounds: L.LatLngExpression[] = [];

    mappableTasks.forEach((task, i) => {
      const project = projectMap.get(task.projectId)!;
      const lat = project.latitude!;
      const lng = project.longitude!;
      bounds.push([lat, lng]);

      const typeName = task.taskType?.name || "Task";
      const label = task.customTitle || typeName;
      const icon = createTaskPinIcon(typeName, label, task.taskColor);
      const marker = L.marker([lat, lng], { icon }).addTo(layer);
      marker.bindPopup(taskPopupHtml(task), POPUP_OPTIONS);

      const el = marker.getElement();
      if (el) {
        el.style.opacity = "0";
        el.style.transform = "scale(0.5)";
        el.style.transition = `opacity 0.3s ease ${i * 0.05}s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.05}s`;
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "scale(1)";
        });
      }
    });

    // Fit bounds to tasks if in "today" view
    if (view === "today" && bounds.length > 0) {
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
  }, [mappableTasks, projectMap, view, can]);

  // ── Update crew pins ──
  useEffect(() => {
    const layer = crewLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!showCrew || !can("team.view")) return;

    // NOTE: Team members currently don't have lat/lng in the User model.
    // This is a placeholder — when crew location tracking is added to the web,
    // this will use real coordinates. For now, we skip rendering crew pins
    // unless the User model is extended with location fields.
    // When available, iterate teamMembers and create crew pins using:
    //   createCrewPinIcon(initials, firstName, status)
    //   crewPopupHtml(fullName, role)
  }, [teamMembers, showCrew, can]);

  // ── Update event pins ──
  useEffect(() => {
    const layer = eventLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!showEvents || !can("calendar.view")) return;

    mappableEvents.forEach((event, i) => {
      const project = projectMap.get(event.projectId)!;
      const lat = project.latitude!;
      const lng = project.longitude!;

      const icon = createEventPinIcon(event.title);
      const marker = L.marker([lat, lng], { icon }).addTo(layer);

      const dateStr = event.startDate
        ? new Date(event.startDate).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : undefined;
      marker.bindPopup(eventPopupHtml(event.title, dateStr), POPUP_OPTIONS);

      const el = marker.getElement();
      if (el) {
        el.style.opacity = "0";
        el.style.transform = "scale(0.5)";
        el.style.transition = `opacity 0.3s ease ${i * 0.05}s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.05}s`;
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "scale(1)";
        });
      }
    });
  }, [mappableEvents, projectMap, showEvents, can]);

  // Don't render on non-dashboard routes
  if (!isDashboard) return null;

  return (
    <>
      {/* Map container — fixed behind content */}
      <div
        className={cn(
          "fixed top-0 bottom-0 right-0 z-0 transition-all duration-200 ease-out",
          isCollapsed ? "left-[72px]" : "left-[256px]"
        )}
      >
        <div ref={containerRef} className="w-full h-full" />

        {/* Vignette gradient overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%),
              linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 120px)
            `,
          }}
        />
      </div>

      {/* Global map CSS */}
      <style jsx global>{`
        .ops-map-marker {
          background: transparent !important;
          border: none !important;
        }
        .ops-map-marker:hover .ops-pin--project {
          transform: rotate(-45deg) scale(1.15) !important;
          box-shadow: 0 0 20px currentColor !important;
        }
        .ops-map-marker:hover .ops-pin--task > div:first-child,
        .ops-map-marker:hover .ops-pin--crew > div:first-child,
        .ops-map-marker:hover .ops-pin--event > div:first-child {
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
          background: rgba(10,10,10,0.85);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .leaflet-control-zoom a {
          background: rgba(10,10,10,0.7) !important;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: #E5E5E5 !important;
          border-color: rgba(255,255,255,0.08) !important;
        }
        .leaflet-control-zoom a:hover {
          background: rgba(26,26,26,0.9) !important;
        }
      `}</style>
    </>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/map/dashboard-map-background.tsx
git commit -m "feat(dashboard): add DashboardMapBackground component with all pin layers"
```

---

## Task 5: Create MapFilterRail Component

The collapsible icon rail on the right edge.

**Files:**
- Create: `src/components/dashboard/map/map-filter-rail.tsx`

**Dependencies:** Task 1 (store)

**Step 1: Create the component**

```typescript
// src/components/dashboard/map/map-filter-rail.tsx
"use client";

import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarClock,
  FolderKanban,
  Layers,
  Users,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useMapFilterStore, type MapViewFilter } from "@/stores/map-filter-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

interface FilterItem {
  id: string;
  icon: React.ElementType;
  label: string;
  permission?: string;
}

const VIEW_FILTERS: (FilterItem & { value: MapViewFilter })[] = [
  { id: "today", value: "today", icon: CalendarClock, label: "TODAY" },
  { id: "active", value: "active", icon: FolderKanban, label: "ACTIVE" },
  { id: "all", value: "all", icon: Layers, label: "ALL" },
];

const LAYER_TOGGLES: (FilterItem & { storeKey: "showCrew" | "showEvents" })[] = [
  { id: "crew", storeKey: "showCrew", icon: Users, label: "CREW", permission: "team.view" },
  { id: "events", storeKey: "showEvents", icon: CalendarDays, label: "EVENTS", permission: "calendar.view" },
];

export function MapFilterRail() {
  const pathname = usePathname();
  if (pathname !== "/dashboard") return null;

  const { view, showCrew, showEvents, railExpanded, setView, toggleCrew, toggleEvents, toggleRail } =
    useMapFilterStore();
  const can = usePermissionStore((s) => s.can);

  const visibleLayers = LAYER_TOGGLES.filter((l) => !l.permission || can(l.permission));

  return (
    <motion.div
      layout
      className={cn(
        "fixed right-3 top-1/2 -translate-y-1/2 z-[5] flex flex-col gap-1 py-2 px-1",
        "rounded-md border border-[rgba(255,255,255,0.08)]",
        "bg-[rgba(10,10,10,0.7)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)]"
      )}
      style={{ width: railExpanded ? 160 : 44 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Expand/collapse toggle */}
      <button
        onClick={toggleRail}
        className="flex items-center justify-center w-full h-7 text-text-tertiary hover:text-text-primary transition-colors duration-150"
        title={railExpanded ? "Collapse" : "Expand"}
      >
        {railExpanded ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      {/* Divider */}
      <div className="h-px bg-[rgba(255,255,255,0.06)] mx-1" />

      {/* View filters (radio) */}
      {VIEW_FILTERS.map((f) => {
        const isActive = view === f.value;
        const Icon = f.icon;
        return (
          <button
            key={f.id}
            onClick={() => setView(f.value)}
            className={cn(
              "relative flex items-center gap-2 rounded px-2 py-1.5 transition-all duration-150",
              "text-text-tertiary hover:text-text-primary",
              isActive && "text-text-primary"
            )}
            title={f.label}
          >
            {isActive && (
              <motion.div
                layoutId="map-filter-active"
                className="absolute inset-0 rounded bg-ops-accent/20"
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              />
            )}
            <Icon className="w-[18px] h-[18px] shrink-0 relative z-[1]" />
            <AnimatePresence>
              {railExpanded && (
                <motion.span
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="font-kosugi text-[10px] tracking-wider whitespace-nowrap relative z-[1]"
                >
                  {f.label}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        );
      })}

      {/* Divider before layers */}
      {visibleLayers.length > 0 && (
        <div className="h-px bg-[rgba(255,255,255,0.06)] mx-1" />
      )}

      {/* Layer toggles */}
      {visibleLayers.map((l) => {
        const isActive = l.storeKey === "showCrew" ? showCrew : showEvents;
        const toggle = l.storeKey === "showCrew" ? toggleCrew : toggleEvents;
        const Icon = l.icon;
        return (
          <button
            key={l.id}
            onClick={toggle}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1.5 transition-all duration-150",
              isActive ? "text-text-primary" : "text-text-disabled hover:text-text-tertiary"
            )}
            title={l.label}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            <AnimatePresence>
              {railExpanded && (
                <motion.span
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="font-kosugi text-[10px] tracking-wider whitespace-nowrap"
                >
                  {l.label}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        );
      })}
    </motion.div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/map/map-filter-rail.tsx
git commit -m "feat(dashboard): add MapFilterRail collapsible icon sidebar"
```

---

## Task 6: Create Barrel Export

**Files:**
- Create: `src/components/dashboard/map/index.ts`

**Step 1: Create barrel**

```typescript
// src/components/dashboard/map/index.ts
export { DashboardMapBackground } from "./dashboard-map-background";
export { MapFilterRail } from "./map-filter-rail";
```

**Step 2: Commit**

```bash
git add src/components/dashboard/map/index.ts
git commit -m "chore: add barrel export for dashboard map components"
```

---

## Task 7: Integrate Map into Dashboard Layout

Wire the map background and filter rail into the existing layout. Make widget content area transparent.

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx:74-101`

**Step 1: Add imports and render map components**

At the top of `dashboard-layout.tsx`, add imports:
```typescript
import dynamic from "next/dynamic";

// Lazy-load map to avoid SSR issues with Leaflet
const DashboardMapBackground = dynamic(
  () => import("@/components/dashboard/map/dashboard-map-background").then((m) => m.DashboardMapBackground),
  { ssr: false }
);
const MapFilterRail = dynamic(
  () => import("@/components/dashboard/map/map-filter-rail").then((m) => m.MapFilterRail),
  { ssr: false }
);
```

In the JSX, modify the return block. The `<main>` content div changes from `p-3` to `p-3 bg-transparent relative z-[1]`. Add `DashboardMapBackground` and `MapFilterRail` inside `<main>` before TopBar:

```typescript
return (
  <div className="flex h-screen overflow-hidden bg-background">
    <Sidebar />
    <main
      className={cn(
        "flex-1 flex flex-col min-h-screen transition-all duration-200 ease-out",
        isCollapsed ? "ml-[72px]" : "ml-[256px]"
      )}
    >
      {/* Map background — fixed layer behind content */}
      <DashboardMapBackground />
      <MapFilterRail />

      <TopBar />
      <ContentHeader />
      <div className="flex-1 overflow-y-auto overflow-x-auto p-3 relative z-[1]">
        {children}
      </div>
    </main>

    {/* Global features */}
    <PreferencesApplier />
    <ActionPromptsInitializer />
    <ActionPromptRenderer />
    <CommandPalette />
    <KeyboardShortcuts />
    <FloatingWindows />
    <FloatingActionButton />
    <WindowDock />
  </div>
);
```

**Step 2: Make dashboard page background transparent**

In `src/app/(dashboard)/dashboard/page.tsx`, the outer wrapper div (line ~658) has `space-y-3 max-w-[1400px]`. This doesn't set a background, which is correct — it inherits transparent. No change needed here.

**Step 3: Disable map interaction during widget customize mode**

In `dashboard-map-background.tsx`, add a prop or detect customize mode. The simplest approach: the map component doesn't need to know about customize mode because widgets already have `pointer-events: auto` and sit in front. However, to prevent accidental scrolling/panning during drag, we can add a CSS class.

In the `DashboardMapBackground` component, detect if a drag is happening by checking if `.dnd-overlay` exists, or simpler: expose a prop. Since the map is in the layout and customize mode is in the page, the cleanest approach is to have the map check for a CSS class on `<body>` or a data attribute. But this is an optimization — the DOM stacking already handles it.

**Step 4: Commit**

```bash
git add src/components/layouts/dashboard-layout.tsx
git commit -m "feat(dashboard): integrate map background and filter rail into layout"
```

---

## Task 8: Verify Widget Card Transparency

Ensure widgets look correct floating over the map. The existing card default variant already uses `bg-[rgba(13,13,13,0.6)] backdrop-blur-xl` which is frosted glass — this should work well over the map. Verify and adjust if needed.

**Files:**
- Check: `src/components/ui/card.tsx` — default variant already has frosted glass
- Check: `src/components/dashboard/widgets/stat-card.tsx` — xs size uses custom gradient, may need backdrop-blur added
- Check: `src/app/(dashboard)/dashboard/page.tsx` — greeting text may need text-shadow

**Step 1: Add text shadow to greeting for readability**

In `dashboard/page.tsx` around line 667-679, add a subtle text-shadow to the greeting text:

```typescript
// Change the greeting <p> tag className:
<p className="font-mohave text-body-lg text-text-secondary tracking-wide [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
```

And the subtitle:
```typescript
<p className="font-kosugi text-caption-sm text-text-tertiary mt-0.5 uppercase [text-shadow:0_1px_6px_rgba(0,0,0,0.6)]">
```

**Step 2: Add backdrop-blur to xs stat cards if missing**

In `stat-card.tsx`, for the xs variant, add backdrop-blur to the inline style:
```typescript
style={{
  background: accent
    ? `linear-gradient(135deg, ${accent}18, ${accent}08)`
    : "rgba(255, 255, 255, 0.03)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  borderLeft: accent ? `3px solid ${accent}` : "3px solid rgba(255, 255, 255, 0.08)",
}}
```

**Step 3: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/page.tsx src/components/dashboard/widgets/stat-card.tsx
git commit -m "feat(dashboard): add text-shadow and backdrop-blur for map readability"
```

---

## Task 9: Test and Polish

**Step 1: Run the dev server**

```bash
cd /Users/jacksonsweet/Desktop/OPS\ LTD./OPS-Web && npm run dev
```

**Step 2: Visual verification checklist**

Navigate to `localhost:3000/dashboard` and verify:
- [ ] Map renders behind widgets with CartoDB dark tiles
- [ ] Vignette gradient fades map edges to black
- [ ] Greeting text readable over map (text-shadow)
- [ ] Widget cards have frosted-glass effect over map
- [ ] Filter rail visible on right edge (5 icons)
- [ ] Clicking filter icons switches between Today/Active/All
- [ ] Pins appear with stagger animation
- [ ] Clicking a pin shows frosted-glass popup
- [ ] Map is interactive (pan/zoom) in gaps between widgets
- [ ] Sidebar collapse/expand resizes map correctly
- [ ] Filter rail expand/collapse animates smoothly
- [ ] Map does NOT render on other routes (e.g., /projects)
- [ ] No console errors

**Step 3: Fix any issues found during testing**

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(dashboard): polish map background styling and interactions"
```

---

## Dependency Graph

```
Task 1 (store) ─────┐
                     ├─→ Task 4 (map component) ──┐
Task 2 (pin icons) ──┤                             ├─→ Task 7 (layout integration) → Task 8 (polish) → Task 9 (test)
Task 3 (popups) ─────┘                             │
                                                    │
Task 1 (store) → Task 5 (filter rail) → Task 6 (barrel) ─┘
```

**Parallelizable:** Tasks 1-3 can all be done in parallel. Tasks 4 and 5 can be done in parallel (both depend on Task 1). Task 7 depends on 4, 5, 6.
