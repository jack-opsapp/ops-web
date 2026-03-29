# Projects Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/projects` list view and `/job-board` kanban with a unified `/projects` spatial canvas view matching the pipeline tab design.

**Architecture:** Mirror the pipeline's spatial canvas architecture — Zustand store for viewport/selection state, a layout engine that calculates card positions across status columns, dnd-kit for drag-and-drop between statuses, and a detail popover for project inspection. All existing data hooks (`useScopedProjects`, `useClients`, `useTeamMembers`, `useInvoices`) are reused unchanged.

**Tech Stack:** Next.js 14 App Router, TypeScript, Zustand, dnd-kit, Framer Motion, TanStack Query, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-29-projects-canvas-design.md`

**Reference implementation:** `src/app/(dashboard)/pipeline/_components/spatial-*.tsx`

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/app/(dashboard)/projects/_components/project-canvas-store.ts` | Zustand store — viewport, selection, drag, sort, filter, firstDragConfirmed |
| `src/app/(dashboard)/projects/_components/project-layout-engine.ts` | Calculates card positions across status columns + terminal region |
| `src/app/(dashboard)/projects/_components/project-staleness.ts` | Staleness opacity calculator for project cards |
| `src/app/(dashboard)/projects/_components/project-canvas.tsx` | Viewport container — pan, zoom, marquee, dot grid |
| `src/app/(dashboard)/projects/_components/project-stage-stack.tsx` | Column rendering + droppable region |
| `src/app/(dashboard)/projects/_components/project-card.tsx` | Card rendering — collapsed + bird's-eye |
| `src/app/(dashboard)/projects/_components/project-card-expanded.tsx` | Expanded card info rows + action buttons |
| `src/app/(dashboard)/projects/_components/project-terminal-region.tsx` | Closed region (grid layout) |
| `src/app/(dashboard)/projects/_components/project-drag-overlay.tsx` | Ghost card during drag |
| `src/app/(dashboard)/projects/_components/project-marquee-select.tsx` | Selection rectangle + AABB intersection |
| `src/app/(dashboard)/projects/_components/project-drag-confirmation.tsx` | First-time drag confirmation dialog |
| `src/app/(dashboard)/projects/_components/project-archive-tray.tsx` | Bottom drawer for archived projects |
| `src/app/(dashboard)/projects/_components/project-floating-toolbar.tsx` | Toolbar — search, filters, sort, view toggle |
| `src/app/(dashboard)/projects/_components/project-context-menu.tsx` | Right-click context menu |
| `src/app/(dashboard)/projects/_components/project-detail-popover-store.ts` | Popover state (open/close/minimize/focus) |
| `src/app/(dashboard)/projects/_components/project-detail-popover.tsx` | Detail popover with tabs |
| `src/app/(dashboard)/projects/page.tsx` | Page orchestrator — data fetching, DndContext, card rendering |
| `src/i18n/dictionaries/en/projects-canvas.json` | English strings for canvas UI |
| `src/i18n/dictionaries/es/projects-canvas.json` | Spanish strings for canvas UI |

**Modified files:**
| File | Change |
|------|--------|
| `src/components/layouts/sidebar.tsx:74` | Remove job-board nav item |
| `src/i18n/dictionaries/en/sidebar.json` | Remove `nav.jobBoard` key |
| `src/i18n/dictionaries/es/sidebar.json` | Remove `nav.jobBoard` key |

**Deleted files:**
| File | Reason |
|------|--------|
| `src/app/(dashboard)/job-board/page.tsx` | Replaced by projects canvas |

---

### Task 1: Zustand Store

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-canvas-store.ts`

- [ ] **Step 1: Create the store file**

```typescript
"use client";

import { create } from "zustand";

// ── Constants ──
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 1.5;
export const DEFAULT_ZOOM = 0.8;
export const ZOOM_STEP = 0.1;
export const BIRD_EYE_THRESHOLD = 0.5;

// ── Layout constants ──
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 60; // Taller than pipeline (44) — two lines + progress bar
export const CARD_PILL_HEIGHT = 8;
export const STACK_GAP = 10;
export const STACK_HORIZONTAL_GAP = 80;
export const STACK_HEADER_HEIGHT = 52;
export const CANVAS_PADDING = 200;
export const TERMINAL_COLS = 3;
export const TERMINAL_GAP = 80;

// ── Types ──
export type ProjectSortOption = "title" | "client" | "date" | "value" | "progress";

export interface CardPosition {
  x: number;
  y: number;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  type: "canvas" | "card" | "selection";
  targetCardId: string | null;
  status: string | null;
}

interface ProjectCanvasState {
  // Viewport
  viewportX: number;
  viewportY: number;
  zoom: number;

  // Canvas dimensions
  canvasWidth: number;
  canvasHeight: number;

  // Sort — global default + per-status overrides
  sortBy: ProjectSortOption;
  statusSortOverrides: Map<string, ProjectSortOption>;

  // Selection
  selectedCardIds: Set<string>;
  expandedCardIds: Set<string>;
  hoveredCardId: string | null;

  // Drag state
  isDragging: boolean;
  dragCardIds: string[];
  dragOrigin: CardPosition | null;

  // Marquee
  isMarqueeActive: boolean;
  marqueeStart: CardPosition | null;
  marqueeEnd: CardPosition | null;

  // Context menu
  contextMenu: ContextMenuState | null;

  // Custom positions (Finder-style free positioning)
  customPositions: Map<string, CardPosition>;

  // Trays
  isArchiveTrayOpen: boolean;

  // First-time drag confirmation
  firstDragConfirmed: boolean;

  // Actions
  setViewport: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (delta: number, centerX: number, centerY: number) => void;
  setCanvasDimensions: (width: number, height: number) => void;
  setSortBy: (sort: ProjectSortOption) => void;
  setStatusSortBy: (status: string, sort: ProjectSortOption) => void;
  clearStatusSortBy: (status: string) => void;
  getSortForStatus: (status: string) => ProjectSortOption;
  toggleCardExpanded: (id: string) => void;
  setHoveredCard: (id: string | null) => void;
  selectCard: (id: string) => void;
  deselectCard: (id: string) => void;
  clearSelection: () => void;
  selectCards: (ids: string[]) => void;
  toggleCardSelected: (id: string) => void;
  startDrag: (cardIds: string[], origin: CardPosition) => void;
  endDrag: () => void;
  startMarquee: (start: CardPosition) => void;
  updateMarquee: (end: CardPosition) => void;
  endMarquee: () => void;
  showContextMenu: (menu: ContextMenuState) => void;
  hideContextMenu: () => void;
  setCustomPosition: (id: string, pos: CardPosition) => void;
  clearCustomPositions: () => void;
  toggleArchiveTray: () => void;
  setFirstDragConfirmed: () => void;
  fitAll: (viewportWidth: number, viewportHeight: number) => void;
  resetLayout: () => void;
}

// Read persisted drag confirmation from localStorage
function getPersistedDragConfirmed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("ops_projects_drag_confirmed") === "true";
}

export const useProjectCanvasStore = create<ProjectCanvasState>()((set, get) => ({
  viewportX: 0,
  viewportY: 0,
  zoom: DEFAULT_ZOOM,
  canvasWidth: 1600,
  canvasHeight: 900,
  sortBy: "title",
  statusSortOverrides: new Map(),
  selectedCardIds: new Set(),
  expandedCardIds: new Set(),
  hoveredCardId: null,
  isDragging: false,
  dragCardIds: [],
  dragOrigin: null,
  isMarqueeActive: false,
  marqueeStart: null,
  marqueeEnd: null,
  contextMenu: null,
  customPositions: new Map(),
  isArchiveTrayOpen: false,
  firstDragConfirmed: getPersistedDragConfirmed(),

  setViewport: (x, y) => set({ viewportX: x, viewportY: y }),

  setZoom: (zoom) =>
    set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }),

  zoomBy: (delta, centerX, centerY) => {
    const state = get();
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom + delta));
    if (newZoom === state.zoom) return;
    const scale = newZoom / state.zoom;
    const newViewportX = centerX - (centerX - state.viewportX) * scale;
    const newViewportY = centerY - (centerY - state.viewportY) * scale;
    set({ zoom: newZoom, viewportX: newViewportX, viewportY: newViewportY });
  },

  setCanvasDimensions: (width, height) =>
    set({ canvasWidth: width, canvasHeight: height }),

  setSortBy: (sortBy) => set({ sortBy }),

  setStatusSortBy: (status, sort) =>
    set((state) => {
      const next = new Map(state.statusSortOverrides);
      next.set(status, sort);
      return { statusSortOverrides: next };
    }),

  clearStatusSortBy: (status) =>
    set((state) => {
      const next = new Map(state.statusSortOverrides);
      next.delete(status);
      return { statusSortOverrides: next };
    }),

  getSortForStatus: (status) => {
    const state = get();
    return state.statusSortOverrides.get(status) ?? state.sortBy;
  },

  toggleCardExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedCardIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedCardIds: next };
    }),

  setHoveredCard: (id) => set({ hoveredCardId: id }),

  selectCard: (id) =>
    set({ selectedCardIds: new Set([id]) }),

  deselectCard: (id) =>
    set((state) => {
      const next = new Set(state.selectedCardIds);
      next.delete(id);
      return { selectedCardIds: next };
    }),

  clearSelection: () => set({ selectedCardIds: new Set() }),

  selectCards: (ids) => set({ selectedCardIds: new Set(ids) }),

  toggleCardSelected: (id) =>
    set((state) => {
      const next = new Set(state.selectedCardIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedCardIds: next };
    }),

  startDrag: (cardIds, origin) =>
    set({ isDragging: true, dragCardIds: cardIds, dragOrigin: origin }),

  endDrag: () =>
    set({ isDragging: false, dragCardIds: [], dragOrigin: null }),

  startMarquee: (start) =>
    set({ isMarqueeActive: true, marqueeStart: start, marqueeEnd: start }),

  updateMarquee: (end) => set({ marqueeEnd: end }),

  endMarquee: () =>
    set({ isMarqueeActive: false, marqueeStart: null, marqueeEnd: null }),

  showContextMenu: (menu) => set({ contextMenu: menu }),

  hideContextMenu: () => set({ contextMenu: null }),

  setCustomPosition: (id, pos) =>
    set((state) => {
      const next = new Map(state.customPositions);
      next.set(id, pos);
      return { customPositions: next };
    }),

  clearCustomPositions: () => set({ customPositions: new Map() }),

  toggleArchiveTray: () =>
    set((state) => ({ isArchiveTrayOpen: !state.isArchiveTrayOpen })),

  setFirstDragConfirmed: () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ops_projects_drag_confirmed", "true");
    }
    set({ firstDragConfirmed: true });
  },

  fitAll: (viewportWidth, viewportHeight) => {
    const state = get();
    const scaleX = viewportWidth / state.canvasWidth;
    const scaleY = viewportHeight / state.canvasHeight;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(scaleX, scaleY) * 0.9));
    const scaledWidth = state.canvasWidth * zoom;
    const scaledHeight = state.canvasHeight * zoom;
    const viewportX = (viewportWidth - scaledWidth) / 2;
    const viewportY = (viewportHeight - scaledHeight) / 2;
    set({ zoom, viewportX, viewportY });
  },

  resetLayout: () => set({ sortBy: "title", statusSortOverrides: new Map(), customPositions: new Map() }),
}));
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add src/app/\(dashboard\)/projects/_components/project-canvas-store.ts
git commit -m "feat(projects): add spatial canvas Zustand store"
```

---

### Task 2: Layout Engine

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-layout-engine.ts`

- [ ] **Step 1: Create the layout engine**

```typescript
import {
  ProjectStatus,
  PROJECT_STATUS_SORT_ORDER,
  PROJECT_STATUS_COLORS,
  type Project,
} from "@/lib/types/models";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  STACK_GAP,
  STACK_HORIZONTAL_GAP,
  STACK_HEADER_HEIGHT,
  CANVAS_PADDING,
  TERMINAL_COLS,
  TERMINAL_GAP,
  type ProjectSortOption,
} from "./project-canvas-store";

// ── Types ──

export interface StackLayout {
  status: ProjectStatus;
  headerPosition: { x: number; y: number };
  cardPositions: { projectId: string; x: number; y: number }[];
  regionBounds: { x: number; y: number; width: number; height: number };
}

export interface TerminalRegionLayout {
  status: ProjectStatus;
  position: { x: number; y: number };
  cardPositions: { projectId: string; x: number; y: number }[];
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ProjectCanvasLayout {
  stacks: StackLayout[];
  terminalRegions: TerminalRegionLayout[];
  canvasWidth: number;
  canvasHeight: number;
}

// ── Active statuses (columns) — everything except Closed and Archived ──
const ACTIVE_STATUSES: ProjectStatus[] = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
];

// ── Sort helpers ──

export function sortProjects(
  projects: Project[],
  sortBy: ProjectSortOption,
  clientNames: Map<string, string>,
  projectValues: Map<string, number>,
  projectProgress: Map<string, number>
): Project[] {
  const sorted = [...projects];
  switch (sortBy) {
    case "title":
      sorted.sort((a, b) => {
        const nameA = a.title ?? a.address ?? "";
        const nameB = b.title ?? b.address ?? "";
        return nameA.localeCompare(nameB);
      });
      break;
    case "client":
      sorted.sort((a, b) => {
        const clientA = clientNames.get(a.clientId ?? "") ?? "";
        const clientB = clientNames.get(b.clientId ?? "") ?? "";
        return clientA.localeCompare(clientB);
      });
      break;
    case "date":
      sorted.sort((a, b) => {
        const dateA = a.startDate ? new Date(a.startDate).getTime() : 0;
        const dateB = b.startDate ? new Date(b.startDate).getTime() : 0;
        return dateB - dateA;
      });
      break;
    case "value":
      sorted.sort((a, b) => {
        const valA = projectValues.get(a.id) ?? 0;
        const valB = projectValues.get(b.id) ?? 0;
        return valB - valA;
      });
      break;
    case "progress":
      sorted.sort((a, b) => {
        const progA = projectProgress.get(a.id) ?? 0;
        const progB = projectProgress.get(b.id) ?? 0;
        return progB - progA;
      });
      break;
  }
  return sorted;
}

// ── Main layout calculator ──

export function calculateProjectCanvasLayout(
  projects: Project[],
  sortBy: ProjectSortOption,
  clientNames: Map<string, string>,
  projectValues: Map<string, number>,
  projectProgress: Map<string, number>,
  statusSortOverrides?: Map<string, ProjectSortOption>
): ProjectCanvasLayout {
  // Group projects by status
  const byStatus = new Map<ProjectStatus, Project[]>();
  for (const status of ACTIVE_STATUSES) {
    byStatus.set(status, []);
  }
  const closedProjects: Project[] = [];

  for (const project of projects) {
    if (project.deletedAt) continue;
    if (project.status === ProjectStatus.Closed) {
      closedProjects.push(project);
    } else if (project.status === ProjectStatus.Archived) {
      // Archived handled by tray, not layout engine
      continue;
    } else {
      const arr = byStatus.get(project.status);
      if (arr) arr.push(project);
    }
  }

  // Sort each status group
  for (const [status, statusProjects] of byStatus) {
    const statusSort = statusSortOverrides?.get(status) ?? sortBy;
    byStatus.set(status, sortProjects(statusProjects, statusSort, clientNames, projectValues, projectProgress));
  }

  // Build active status stacks (left to right)
  const stacks: StackLayout[] = [];
  let xCursor = CANVAS_PADDING;
  let maxStackHeight = 0;

  for (const status of ACTIVE_STATUSES) {
    const statusProjects = byStatus.get(status) ?? [];
    const headerPos = { x: xCursor, y: CANVAS_PADDING };

    const cardPositions = statusProjects.map((project, idx) => ({
      projectId: project.id,
      x: xCursor,
      y: CANVAS_PADDING + STACK_HEADER_HEIGHT + idx * (CARD_HEIGHT + STACK_GAP),
    }));

    const stackContentHeight =
      STACK_HEADER_HEIGHT +
      Math.max(statusProjects.length, 1) * (CARD_HEIGHT + STACK_GAP);

    stacks.push({
      status,
      headerPosition: headerPos,
      cardPositions,
      regionBounds: {
        x: xCursor - 20,
        y: CANVAS_PADDING - 20,
        width: CARD_WIDTH + 40,
        height: stackContentHeight + 40,
      },
    });

    if (stackContentHeight > maxStackHeight) {
      maxStackHeight = stackContentHeight;
    }

    xCursor += CARD_WIDTH + STACK_HORIZONTAL_GAP;
  }

  // Build terminal region (Closed) to the right of active stacks
  const terminalStartX = xCursor + TERMINAL_GAP;
  const terminalRegions: TerminalRegionLayout[] = [];

  const terminalSort = statusSortOverrides?.get(ProjectStatus.Closed) ?? sortBy;
  const sortedClosed = sortProjects(closedProjects, terminalSort, clientNames, projectValues, projectProgress);

  const cardPositions = sortedClosed.map((project, i) => {
    const col = i % TERMINAL_COLS;
    const row = Math.floor(i / TERMINAL_COLS);
    return {
      projectId: project.id,
      x: terminalStartX + col * (CARD_WIDTH + STACK_GAP),
      y: CANVAS_PADDING + STACK_HEADER_HEIGHT + row * (CARD_HEIGHT + STACK_GAP),
    };
  });

  const cols = Math.min(sortedClosed.length, TERMINAL_COLS);
  const rows = Math.max(1, Math.ceil(sortedClosed.length / TERMINAL_COLS));
  const regionWidth = cols * (CARD_WIDTH + STACK_GAP);
  const regionHeight = STACK_HEADER_HEIGHT + rows * (CARD_HEIGHT + STACK_GAP);

  terminalRegions.push({
    status: ProjectStatus.Closed,
    position: { x: terminalStartX, y: CANVAS_PADDING },
    cardPositions,
    bounds: {
      x: terminalStartX - 20,
      y: CANVAS_PADDING - 20,
      width: Math.max(regionWidth, CARD_WIDTH) + 40,
      height: regionHeight + 40,
    },
  });

  const totalTerminalHeight = regionHeight;
  if (totalTerminalHeight > maxStackHeight) {
    maxStackHeight = totalTerminalHeight;
  }

  // Calculate total canvas dimensions
  const lastTerminal = terminalRegions[terminalRegions.length - 1];
  const canvasWidth = lastTerminal
    ? lastTerminal.bounds.x + lastTerminal.bounds.width + CANVAS_PADDING
    : xCursor + CANVAS_PADDING;
  const canvasHeight = maxStackHeight + CANVAS_PADDING * 2;

  return {
    stacks,
    terminalRegions,
    canvasWidth: Math.max(canvasWidth, 1200),
    canvasHeight: Math.max(canvasHeight, 600),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-layout-engine.ts
git commit -m "feat(projects): add spatial layout engine for project status columns"
```

---

### Task 3: Staleness Calculator

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-staleness.ts`

- [ ] **Step 1: Create staleness calculator**

Projects use `lastSyncedAt` or `createdAt` as staleness reference — how long a project has sat in its current status without updates.

```typescript
import { ProjectStatus, type Project } from "@/lib/types/models";

/**
 * Calculate card opacity based on how long a project has been in its current status.
 *
 * Fresh projects = 1.0
 * Deeply stale = 0.4
 * Closed projects = 0.8 (terminal, slightly dimmed)
 */
export function calculateProjectStaleness(project: Project): number {
  if (project.status === ProjectStatus.Closed) return 0.8;
  if (project.status === ProjectStatus.Archived) return 0.6;

  // Use lastSyncedAt as proxy for "last activity"
  const lastActivity = project.lastSyncedAt ?? project.createdAt;
  if (!lastActivity) return 1.0;

  const daysSinceActivity = Math.floor(
    (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Expected update cadence: ~14 days for active projects
  const expectedDays = 14;

  if (daysSinceActivity <= expectedDays * 0.5) return 1.0;
  if (daysSinceActivity >= expectedDays * 2.0) return 0.4;

  const progress =
    (daysSinceActivity - expectedDays * 0.5) / (expectedDays * 1.5);
  return 1.0 - progress * 0.6;
}

/**
 * Batch-calculate staleness for multiple projects.
 * Returns Map<projectId, opacity>.
 */
export function calculateBatchProjectStaleness(
  projects: Project[]
): Map<string, number> {
  const result = new Map<string, number>();
  for (const project of projects) {
    result.set(project.id, calculateProjectStaleness(project));
  }
  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-staleness.ts
git commit -m "feat(projects): add staleness opacity calculator"
```

---

### Task 4: i18n Dictionaries

**Files:**
- Create: `src/i18n/dictionaries/en/projects-canvas.json`
- Create: `src/i18n/dictionaries/es/projects-canvas.json`

- [ ] **Step 1: Create English dictionary**

```json
{
  "loading": "Loading projects...",
  "empty": {
    "noProjects": "No projects",
    "dropHere": "Drop here"
  },
  "status": {
    "updated": "Status updated",
    "moved": "Moved to",
    "failed": "Failed to update status",
    "tryAgain": "Please try again",
    "archived": "Project archived"
  },
  "card": {
    "untitledProject": "Untitled Project",
    "tasksComplete": "{completed}/{total} tasks complete",
    "noTasks": "No tasks",
    "daysInStatus": "{count}d in {status}",
    "noDatesSet": "No dates set"
  },
  "actions": {
    "openDetail": "Open details",
    "addTask": "Add task",
    "recordPayment": "Record payment",
    "archive": "Archive",
    "delete": "Delete",
    "changeStatus": "Change status"
  },
  "toolbar": {
    "search": "Search projects...",
    "allMembers": "All members",
    "allClients": "All clients",
    "sort": "Sort",
    "canvas": "Canvas",
    "spreadsheet": "Spreadsheet"
  },
  "sort": {
    "title": "Title",
    "client": "Client",
    "date": "Date",
    "value": "Value",
    "progress": "Progress"
  },
  "drag": {
    "confirmTitle": "Change project status?",
    "confirmMessage": "Project statuses are usually updated automatically (e.g., when estimates are sent or tasks are completed). Are you sure you want to manually change this project's status?",
    "confirmAction": "Change Status",
    "dontShowAgain": "Don't show this again"
  },
  "archive": {
    "title": "Archived",
    "empty": "No archived projects"
  },
  "tray": {
    "dropToArchive": "Drop to archive"
  }
}
```

- [ ] **Step 2: Create Spanish dictionary**

Create `src/i18n/dictionaries/es/projects-canvas.json` with the same keys, translated to Spanish. Follow the existing pattern in `es/` dictionaries for translation style.

```json
{
  "loading": "Cargando proyectos...",
  "empty": {
    "noProjects": "Sin proyectos",
    "dropHere": "Soltar aquí"
  },
  "status": {
    "updated": "Estado actualizado",
    "moved": "Movido a",
    "failed": "Error al actualizar estado",
    "tryAgain": "Inténtalo de nuevo",
    "archived": "Proyecto archivado"
  },
  "card": {
    "untitledProject": "Proyecto sin título",
    "tasksComplete": "{completed}/{total} tareas completadas",
    "noTasks": "Sin tareas",
    "daysInStatus": "{count}d en {status}",
    "noDatesSet": "Sin fechas"
  },
  "actions": {
    "openDetail": "Ver detalles",
    "addTask": "Agregar tarea",
    "recordPayment": "Registrar pago",
    "archive": "Archivar",
    "delete": "Eliminar",
    "changeStatus": "Cambiar estado"
  },
  "toolbar": {
    "search": "Buscar proyectos...",
    "allMembers": "Todos los miembros",
    "allClients": "Todos los clientes",
    "sort": "Ordenar",
    "canvas": "Lienzo",
    "spreadsheet": "Hoja de cálculo"
  },
  "sort": {
    "title": "Título",
    "client": "Cliente",
    "date": "Fecha",
    "value": "Valor",
    "progress": "Progreso"
  },
  "drag": {
    "confirmTitle": "¿Cambiar estado del proyecto?",
    "confirmMessage": "Los estados de los proyectos se actualizan automáticamente (ej. cuando se envían presupuestos o se completan tareas). ¿Estás seguro de cambiar el estado manualmente?",
    "confirmAction": "Cambiar Estado",
    "dontShowAgain": "No mostrar de nuevo"
  },
  "archive": {
    "title": "Archivados",
    "empty": "Sin proyectos archivados"
  },
  "tray": {
    "dropToArchive": "Soltar para archivar"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/dictionaries/en/projects-canvas.json src/i18n/dictionaries/es/projects-canvas.json
git commit -m "feat(projects): add i18n dictionaries for canvas view"
```

---

### Task 5: Canvas Viewport Component

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-canvas.tsx`

- [ ] **Step 1: Create the canvas viewport**

This is structurally identical to `pipeline/_components/spatial-canvas.tsx` but uses `useProjectCanvasStore` instead of `useSpatialCanvasStore`. Copy the pipeline implementation and swap the store reference.

Key changes from pipeline version:
- Import `useProjectCanvasStore` from `./project-canvas-store`
- All `useSpatialCanvasStore` references → `useProjectCanvasStore`
- SVG pattern id: `"project-grid"` (avoid collision with pipeline's `"spatial-grid"`)

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-canvas.tsx
git commit -m "feat(projects): add canvas viewport component with pan/zoom/marquee"
```

---

### Task 6: Marquee Select Component

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-marquee-select.tsx`

- [ ] **Step 1: Create marquee select**

Same as `pipeline/_components/spatial-marquee-select.tsx` but uses `useProjectCanvasStore`.

```typescript
"use client";

import { useProjectCanvasStore } from "./project-canvas-store";

type ProjectMarqueeSelectProps = Record<string, never>;

export function ProjectMarqueeSelect(_props: ProjectMarqueeSelectProps) {
  const isActive = useProjectCanvasStore((s) => s.isMarqueeActive);
  const start = useProjectCanvasStore((s) => s.marqueeStart);
  const end = useProjectCanvasStore((s) => s.marqueeEnd);

  if (!isActive || !start || !end) return null;

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (width < 4 && height < 4) return null;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: x,
        top: y,
        width,
        height,
        border: "1px solid rgba(89, 119, 148, 0.5)",
        background: "rgba(89, 119, 148, 0.08)",
        borderRadius: 2,
        zIndex: 100,
      }}
    />
  );
}

export function isCardInMarquee(
  cardX: number,
  cardY: number,
  cardWidth: number,
  cardHeight: number,
  marqueeStart: { x: number; y: number },
  marqueeEnd: { x: number; y: number }
): boolean {
  const mx = Math.min(marqueeStart.x, marqueeEnd.x);
  const my = Math.min(marqueeStart.y, marqueeEnd.y);
  const mw = Math.abs(marqueeEnd.x - marqueeStart.x);
  const mh = Math.abs(marqueeEnd.y - marqueeStart.y);

  return (
    cardX < mx + mw &&
    cardX + cardWidth > mx &&
    cardY < my + mh &&
    cardY + cardHeight > my
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-marquee-select.tsx
git commit -m "feat(projects): add marquee select component"
```

---

### Task 7: Project Card Component

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-card.tsx`

- [ ] **Step 1: Create the project card**

This card differs from the pipeline card — it shows title (or address fallback), client subtitle, value (permission-gated), and a task progress bar.

```typescript
"use client";

import { memo, useCallback } from "react";
import { useReducedMotion } from "framer-motion";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import type { Project } from "@/lib/types/models";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { CARD_WIDTH, CARD_HEIGHT, CARD_PILL_HEIGHT } from "./project-canvas-store";

// ── Helpers ──

/** Extract street number + name from a full address */
function formatStreetAddress(address: string | null): string | null {
  if (!address) return null;
  // Take first line / first comma-separated segment
  const firstPart = address.split(",")[0].trim();
  return firstPart || null;
}

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

// ── Types ──

export interface ProjectCardProps {
  project: Project;
  clientName: string;
  statusColor: string;
  stalenessOpacity: number;
  isSelected: boolean;
  isExpanded: boolean;
  isHovered: boolean;
  isBirdEye: boolean;
  canManage: boolean;
  canViewAccounting: boolean;
  projectValue: number;
  completedTasks: number;
  totalTasks: number;
  draggable?: boolean;
  onToggleExpand: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  expandedContent?: React.ReactNode;
}

// ── Component ──

export const ProjectCard = memo(function ProjectCard({
  project,
  clientName,
  statusColor,
  stalenessOpacity,
  isSelected,
  isExpanded,
  isHovered,
  isBirdEye,
  canManage,
  canViewAccounting,
  projectValue,
  completedTasks,
  totalTasks,
  draggable = true,
  onToggleExpand,
  onHover,
  onHoverEnd,
  onSelect,
  onContextMenu,
  expandedContent,
}: ProjectCardProps) {
  const reduced = useReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: project.id,
    data: { project },
    disabled: !draggable || !canManage,
  });

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey || e.metaKey) {
        onSelect(e);
      } else {
        onToggleExpand();
      }
    },
    [onSelect, onToggleExpand]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e);
    },
    [onContextMenu]
  );

  // Primary label: title ?? address ?? "Untitled Project"
  const primaryLabel =
    project.title || formatStreetAddress(project.address) || "Untitled Project";

  // Progress fraction
  const progressFraction = totalTasks > 0 ? completedTasks / totalTasks : 0;

  // ── Bird's eye rendering (zoom < 0.5) ──
  if (isBirdEye) {
    return (
      <div
        ref={setNodeRef}
        {...(draggable ? listeners : {})}
        {...(draggable ? attributes : {})}
        data-spatial-card
        className="relative cursor-pointer"
        style={{
          width: CARD_WIDTH,
          height: CARD_PILL_HEIGHT,
          background: statusColor,
          opacity: isDragging ? 0.2 : stalenessOpacity,
          borderRadius: 4,
          boxShadow: isSelected ? `0 0 12px ${statusColor}40` : undefined,
          border: isSelected ? `2px solid ${statusColor}` : "1px solid transparent",
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={onHover}
        onMouseLeave={onHoverEnd}
      />
    );
  }

  // ── Normal rendering ──
  const effectiveOpacity = isHovered || isDragging || isExpanded ? 1.0 : stalenessOpacity;
  const cardEdgeBorder = isSelected
    ? `2px solid ${statusColor}`
    : isHovered || isExpanded
      ? `1px solid ${statusColor}50`
      : "1px solid rgba(255,255,255,0.08)";

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      data-spatial-card
      role="button"
      tabIndex={0}
      aria-label={`${primaryLabel}, ${clientName}`}
      aria-expanded={isExpanded}
      className={cn(
        "relative cursor-pointer select-none",
        isDragging && "opacity-20"
      )}
      style={{
        width: CARD_WIDTH,
        minHeight: CARD_HEIGHT,
        opacity: isDragging ? 0.2 : effectiveOpacity,
      }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleExpand();
        }
      }}
      onContextMenu={handleContextMenu}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      onFocus={onHover}
      onBlur={onHoverEnd}
    >
      <div
        className={cn(
          "w-full rounded-[4px]",
          !reduced && "transition-[border-color,box-shadow] duration-150"
        )}
        style={{
          background: "rgba(13,13,13,0.6)",
          backdropFilter: "blur(20px) saturate(1.2)",
          WebkitBackdropFilter: "blur(20px) saturate(1.2)",
          borderTop: cardEdgeBorder,
          borderRight: cardEdgeBorder,
          borderBottom: cardEdgeBorder,
          borderLeft: `3px solid ${statusColor}`,
          boxShadow: isSelected ? `0 0 12px ${statusColor}40` : undefined,
          padding: "8px 10px 6px 10px",
        }}
      >
        {/* Line 1: Primary label + value */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mohave text-body-sm font-medium text-text-primary truncate">
            {primaryLabel}
          </span>
          {canViewAccounting && projectValue > 0 && (
            <span className="font-mohave text-body-sm text-text-secondary whitespace-nowrap">
              {formatCompactCurrency(projectValue)}
            </span>
          )}
        </div>

        {/* Line 2: Client name */}
        {clientName && (
          <div className="font-mohave text-[11px] text-text-tertiary mt-[2px] truncate">
            {clientName}
          </div>
        )}

        {/* Progress bar */}
        <div
          className="mt-[6px] rounded-[1px] overflow-hidden"
          style={{ height: 2, background: "rgba(255,255,255,0.06)" }}
        >
          <div
            style={{
              width: `${progressFraction * 100}%`,
              height: "100%",
              background: statusColor,
              borderRadius: 1,
              transition: "width 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        </div>

        {/* Expanded content */}
        {expandedContent && (
          <div
            style={{
              display: "grid",
              gridTemplateRows: isExpanded ? "1fr" : "0fr",
              opacity: isExpanded ? 1 : 0,
              transition: "grid-template-rows 0.2s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <div style={{ overflow: "hidden" }}>
              {expandedContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-card.tsx
git commit -m "feat(projects): add spatial project card with title/client/value/progress"
```

---

### Task 8: Expanded Card Content

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-card-expanded.tsx`

- [ ] **Step 1: Create expanded card content**

Shows task summary, team avatars, dates, days in status, and action buttons.

```typescript
"use client";

import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Receipt, Archive, ExternalLink } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { Project } from "@/lib/types/models";
import { UserAvatar } from "@/components/ops/user-avatar";
import {
  pipelineCardContentVariants,
  pipelineCardContentVariantsReduced,
} from "@/lib/utils/motion";

interface ProjectCardExpandedProps {
  project: Project;
  canManage: boolean;
  canCreateTasks: boolean;
  canRecordPayment: boolean;
  completedTasks: number;
  totalTasks: number;
  teamMembers: { id: string; name: string; avatarUrl?: string }[];
  statusDisplayName: string;
  daysInStatus: number;
  onOpenDetail: () => void;
  onAddTask: () => void;
  onRecordPayment: () => void;
  onArchive: () => void;
}

export const ProjectCardExpanded = memo(function ProjectCardExpanded({
  project,
  canManage,
  canCreateTasks,
  canRecordPayment,
  completedTasks,
  totalTasks,
  teamMembers,
  statusDisplayName,
  daysInStatus,
  onOpenDetail,
  onAddTask,
  onRecordPayment,
  onArchive,
}: ProjectCardExpandedProps) {
  const { t } = useDictionary("projects-canvas");
  const reduced = useReducedMotion();
  const variants = reduced
    ? pipelineCardContentVariantsReduced
    : pipelineCardContentVariants;

  const startDate = project.startDate
    ? new Date(project.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  const endDate = project.endDate
    ? new Date(project.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  const dateRange = startDate && endDate
    ? `${startDate} → ${endDate}`
    : startDate
      ? startDate
      : t("card.noDatesSet");

  return (
    <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
      {/* Info rows */}
      <motion.div
        custom={0}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        className="flex flex-col gap-[3px] mb-2"
      >
        {/* Task summary */}
        <span className="font-kosugi text-micro-sm text-text-tertiary">
          {totalTasks > 0
            ? t("card.tasksComplete")
                .replace("{completed}", String(completedTasks))
                .replace("{total}", String(totalTasks))
            : t("card.noTasks")}
        </span>

        {/* Team members */}
        {teamMembers.length > 0 && (
          <div className="flex items-center gap-1 mt-1">
            {teamMembers.slice(0, 3).map((member) => (
              <UserAvatar
                key={member.id}
                name={member.name}
                avatarUrl={member.avatarUrl}
                size="xs"
              />
            ))}
            {teamMembers.length > 3 && (
              <span className="font-kosugi text-micro-xs text-text-disabled ml-1">
                +{teamMembers.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Date range + days in status */}
        <div className="flex items-center justify-between mt-1">
          <span className="font-kosugi text-micro-sm text-text-disabled">
            {dateRange}
          </span>
          <span className="font-mono text-micro-xs text-text-disabled">
            {t("card.daysInStatus")
              .replace("{count}", String(daysInStatus))
              .replace("{status}", statusDisplayName)}
          </span>
        </div>
      </motion.div>

      {/* Actions */}
      <motion.div
        custom={1}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        className="flex items-center gap-1 flex-wrap"
      >
        <button
          onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          className="flex items-center gap-1 px-2 py-1 rounded-[3px] text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
        >
          <ExternalLink className="w-3 h-3" />
          <span className="font-kosugi text-micro-sm">{t("actions.openDetail")}</span>
        </button>

        {canCreateTasks && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddTask(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-[3px] text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            <Plus className="w-3 h-3" />
            <span className="font-kosugi text-micro-sm">{t("actions.addTask")}</span>
          </button>
        )}

        {canRecordPayment && (
          <button
            onClick={(e) => { e.stopPropagation(); onRecordPayment(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-[3px] text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            <Receipt className="w-3 h-3" />
            <span className="font-kosugi text-micro-sm">{t("actions.recordPayment")}</span>
          </button>
        )}

        {canManage && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-[3px] text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            <Archive className="w-3 h-3" />
            <span className="font-kosugi text-micro-sm">{t("actions.archive")}</span>
          </button>
        )}
      </motion.div>
    </div>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-card-expanded.tsx
git commit -m "feat(projects): add expanded card with info rows and actions"
```

---

### Task 9: Stage Stack, Terminal Region, Drag Overlay

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-stage-stack.tsx`
- Create: `src/app/(dashboard)/projects/_components/project-terminal-region.tsx`
- Create: `src/app/(dashboard)/projects/_components/project-drag-overlay.tsx`

- [ ] **Step 1: Create stage stack**

Mirror `spatial-stage-stack.tsx` with these changes:
- Import `ProjectStatus`, `PROJECT_STATUS_COLORS` from `@/lib/types/models` (not pipeline types)
- Import `useProjectCanvasStore` layout constants from `./project-canvas-store`
- Import `StackLayout` from `./project-layout-engine`
- Use `CARD_HEIGHT = 60` (from project store, not 44)
- Column header shows status display name via a local map (not `getStageDisplayName` from pipeline)
- Dictionary: `useDictionary("projects-canvas")` — empty states use `t("empty.noProjects")` and `t("empty.dropHere")`
- Calculate total value using `projectValues: Map<string, number>` prop instead of `opportunity.estimatedValue`
- Replace `getDaysInStage` with a `daysInStatus` helper that uses project creation/start date

- [ ] **Step 2: Create terminal region**

Mirror `spatial-terminal-region.tsx` with the same type swaps:
- Single terminal region for `ProjectStatus.Closed` (pipeline has two: Won + Lost)
- Uses project status colors and project layout types

- [ ] **Step 3: Create drag overlay**

Mirror `spatial-drag-overlay.tsx`:
- Shows primary label (title ?? address ?? "Untitled Project") instead of client name
- Shows client name as subtitle instead of value
- Uses `PROJECT_STATUS_COLORS` for left border

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-stage-stack.tsx \
       src/app/\(dashboard\)/projects/_components/project-terminal-region.tsx \
       src/app/\(dashboard\)/projects/_components/project-drag-overlay.tsx
git commit -m "feat(projects): add stage stack, terminal region, and drag overlay"
```

---

### Task 10: Drag Confirmation Dialog

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-drag-confirmation.tsx`

- [ ] **Step 1: Create the dialog**

```typescript
"use client";

import { useState } from "react";
import { useDictionary } from "@/i18n/client";
import { useProjectCanvasStore } from "./project-canvas-store";

interface ProjectDragConfirmationProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ProjectDragConfirmation({
  open,
  onConfirm,
  onCancel,
}: ProjectDragConfirmationProps) {
  const { t } = useDictionary("projects-canvas");
  const setFirstDragConfirmed = useProjectCanvasStore((s) => s.setFirstDragConfirmed);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-[4px] p-6 max-w-[400px] w-full mx-4"
        style={{
          background: "rgba(20,20,20,0.95)",
          backdropFilter: "blur(20px) saturate(1.2)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-mohave text-body font-medium text-text-primary mb-2">
          {t("drag.confirmTitle")}
        </h3>
        <p className="font-mohave text-body-sm text-text-secondary mb-4 leading-relaxed">
          {t("drag.confirmMessage")}
        </p>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="w-4 h-4 rounded-[2px] border border-[rgba(255,255,255,0.15)] bg-transparent accent-[#597794]"
          />
          <span className="font-mohave text-body-sm text-text-tertiary">
            {t("drag.dontShowAgain")}
          </span>
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-[3px] font-mohave text-body-sm text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (dontShowAgain) setFirstDragConfirmed();
              onConfirm();
            }}
            className="px-4 py-2 rounded-[3px] font-mohave text-body-sm text-text-primary bg-[rgba(89,119,148,0.2)] hover:bg-[rgba(89,119,148,0.3)] border border-[rgba(89,119,148,0.3)] transition-colors duration-150"
          >
            {t("drag.confirmAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-drag-confirmation.tsx
git commit -m "feat(projects): add first-time drag confirmation dialog"
```

---

### Task 11: Archive Tray

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-archive-tray.tsx`

- [ ] **Step 1: Create archive tray**

Mirror `spatial-archive-tray.tsx` — bottom drawer that:
- Opens when `isArchiveTrayOpen` is true in store
- Shows archived projects in a grid
- Accepts drops during drag (shows "Drop to archive" zone)
- Uses `useProjectCanvasStore` for tray state
- Filter: `projects.filter(p => p.status === ProjectStatus.Archived && !p.deletedAt)`

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-archive-tray.tsx
git commit -m "feat(projects): add archive tray bottom drawer"
```

---

### Task 12: Floating Toolbar

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-floating-toolbar.tsx`

- [ ] **Step 1: Create toolbar**

Toolbar sits below the metrics header. Contains:
- Search input (filters title, client, address)
- Team member dropdown filter
- Client dropdown filter
- Sort dropdown (title, client, date, value, progress)
- View toggle (canvas/spreadsheet — spreadsheet disabled)

```typescript
"use client";

import { Search } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { useProjectCanvasStore, type ProjectSortOption } from "./project-canvas-store";

interface ProjectFloatingToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  teamMembers: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  selectedMemberId: string | null;
  onMemberFilterChange: (memberId: string | null) => void;
  selectedClientId: string | null;
  onClientFilterChange: (clientId: string | null) => void;
  canViewAccounting: boolean;
}

export function ProjectFloatingToolbar({
  searchQuery,
  onSearchChange,
  teamMembers,
  clients,
  selectedMemberId,
  onMemberFilterChange,
  selectedClientId,
  onClientFilterChange,
  canViewAccounting,
}: ProjectFloatingToolbarProps) {
  const { t } = useDictionary("projects-canvas");
  const sortBy = useProjectCanvasStore((s) => s.sortBy);
  const setSortBy = useProjectCanvasStore((s) => s.setSortBy);

  const sortOptions: { value: ProjectSortOption; label: string }[] = [
    { value: "title", label: t("sort.title") },
    { value: "client", label: t("sort.client") },
    { value: "date", label: t("sort.date") },
    ...(canViewAccounting ? [{ value: "value" as const, label: t("sort.value") }] : []),
    { value: "progress", label: t("sort.progress") },
  ];

  return (
    <div
      className="flex items-center gap-2 px-4 py-2"
      style={{
        background: "rgba(10,10,10,0.7)",
        backdropFilter: "blur(20px) saturate(1.2)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Search */}
      <div className="relative flex-1 max-w-[260px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("toolbar.search")}
          className="w-full pl-7 pr-3 py-1.5 rounded-[3px] font-mohave text-body-sm text-text-primary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] placeholder:text-text-disabled focus:outline-none focus:border-[rgba(89,119,148,0.3)]"
        />
      </div>

      {/* Team member filter */}
      <select
        value={selectedMemberId ?? ""}
        onChange={(e) => onMemberFilterChange(e.target.value || null)}
        className="px-2 py-1.5 rounded-[3px] font-mohave text-body-sm text-text-secondary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] focus:outline-none"
      >
        <option value="">{t("toolbar.allMembers")}</option>
        {teamMembers.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>

      {/* Client filter */}
      <select
        value={selectedClientId ?? ""}
        onChange={(e) => onClientFilterChange(e.target.value || null)}
        className="px-2 py-1.5 rounded-[3px] font-mohave text-body-sm text-text-secondary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] focus:outline-none"
      >
        <option value="">{t("toolbar.allClients")}</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Sort */}
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value as ProjectSortOption)}
        className="px-2 py-1.5 rounded-[3px] font-mohave text-body-sm text-text-secondary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] focus:outline-none"
      >
        {sortOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-floating-toolbar.tsx
git commit -m "feat(projects): add floating toolbar with search/filter/sort"
```

---

### Task 13: Detail Popover Store

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-detail-popover-store.ts`

- [ ] **Step 1: Create the store**

Mirror `detail-popover-store.ts` from pipeline. Changes:
- Tab type: `"overview" | "tasks" | "financial" | "photos"` (not correspondence/timeline/photos)
- Default tab: `"overview"` (not correspondence)
- All other logic identical (open, close, focus, minimize, position, size)

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-detail-popover-store.ts
git commit -m "feat(projects): add detail popover store"
```

---

### Task 14: Detail Popover Component

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-detail-popover.tsx`

- [ ] **Step 1: Create the popover**

Mirror `detail-popover.tsx` from pipeline. This is the draggable, resizable popover window that shows project details in tabs. For v1, implement the Overview tab fully (project info, address, client, status, team, description). Tasks, Financial, and Photos tabs can show placeholder content with the correct tab bar structure — they will be fleshed out in a follow-up.

Key structure:
- Tab bar at top: Overview | Tasks | Financial | Photos
- Draggable header (drag to reposition)
- Minimize/close buttons
- Content area switches by active tab
- Uses `useProjectDetailPopoverStore` for state

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-detail-popover.tsx
git commit -m "feat(projects): add detail popover with tabbed layout"
```

---

### Task 15: Context Menu

**Files:**
- Create: `src/app/(dashboard)/projects/_components/project-context-menu.tsx`

- [ ] **Step 1: Create context menu**

Right-click menu for project cards. Actions:
- Open detail
- Change status → submenu with all ProjectStatus values
- Add task (permission-gated)
- Record payment (permission-gated)
- Archive
- Delete (permission-gated, with confirmation)

For multi-select context menu: batch status change, batch archive, batch delete.

Mirror the visual style of `spatial-context-menu.tsx` — absolute positioned, frosted glass surface, keyboard navigable.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/_components/project-context-menu.tsx
git commit -m "feat(projects): add right-click context menu"
```

---

### Task 16: Page Orchestrator

**Files:**
- Rewrite: `src/app/(dashboard)/projects/page.tsx`

- [ ] **Step 1: Rewrite the projects page**

This is the main orchestrator — equivalent to `pipeline/page.tsx`. It:

1. Fetches data via existing hooks: `useScopedProjects()`, `useClients()`, `useTeamMembers()`, `useInvoices()`, `useProjectMetrics()`
2. Builds lookup maps: `clientNameMap`, `teamMemberMap`, `projectValueMap` (from invoices), `projectProgressMap` (from tasks)
3. Applies filters (search, team member, client)
4. Calculates layout via `calculateProjectCanvasLayout()`
5. Calculates staleness via `calculateBatchProjectStaleness()`
6. Renders `MetricsHeader` + `ProjectFloatingToolbar` + `ProjectCanvas` (viewport)
7. Inside canvas: renders `ProjectStageStack` per active status, `ProjectTerminalRegion` for Closed
8. Wraps everything in `DndContext` with `PointerSensor`
9. Handles `onDragStart` → `startDrag`, `onDragEnd` → status change mutation (with first-time confirmation)
10. Renders overlays: `ProjectMarqueeSelect`, `ProjectDragOverlay`, `ProjectContextMenu`, `ProjectArchiveTray`, `ProjectDragConfirmation`, `ProjectDetailPopover`

Key callbacks to wire:
- `handleDragEnd`: if dropped on a status column and it's different from current, either show confirmation (first time) or apply immediately
- `handleMarqueeEnd`: AABB intersection test against card positions, select matching cards
- Card `onOpenDetail`: opens detail popover via `useProjectDetailPopoverStore`
- Card `onArchive`: calls `useUpdateProjectStatus({ id, status: ProjectStatus.Archived })`
- `onAddTask`: opens task creation form (use existing `useWindowStore` to open a floating window)
- `onRecordPayment`: opens payment recording form (use existing pattern)

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/projects/page.tsx
git commit -m "feat(projects): rewrite page as spatial canvas orchestrator"
```

---

### Task 17: Navigation Cleanup

**Files:**
- Modify: `src/components/layouts/sidebar.tsx:74`
- Modify: `src/i18n/dictionaries/en/sidebar.json`
- Modify: `src/i18n/dictionaries/es/sidebar.json`
- Delete: `src/app/(dashboard)/job-board/page.tsx`

- [ ] **Step 1: Remove job-board nav item from sidebar**

In `src/components/layouts/sidebar.tsx`, delete line 74:
```typescript
// DELETE THIS LINE:
{ label: t("nav.jobBoard"), href: "/job-board", icon: Columns3, permission: "job_board.view" },
```

Also remove the `Columns3` import from lucide-react if it's no longer used elsewhere.

- [ ] **Step 2: Remove i18n keys**

In `src/i18n/dictionaries/en/sidebar.json`, remove the `"jobBoard"` key from `nav`.
In `src/i18n/dictionaries/es/sidebar.json`, remove the `"jobBoard"` key from `nav`.

- [ ] **Step 3: Delete job-board page**

```bash
rm src/app/\(dashboard\)/job-board/page.tsx
```

If the `job-board/` directory has no other files, remove the directory too:
```bash
rmdir src/app/\(dashboard\)/job-board/ 2>/dev/null || true
```

- [ ] **Step 4: Clean up any remaining job-board references**

Search for and remove/update any remaining references to `/job-board` in:
- `src/middleware.ts` (route matchers)
- `src/components/ops/command-palette.tsx` (command palette navigation)
- `src/components/ops/keyboard-shortcuts.tsx` (shortcut targets)
- `src/components/layouts/top-bar.tsx` (breadcrumb config)
- `src/i18n/dictionaries/en/breadcrumbs.json` and `es/breadcrumbs.json`

For each file, check if there's a job-board reference and either remove it or redirect to `/projects`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove job-board route, clean up navigation references"
```

---

### Task 18: Build Verification

- [ ] **Step 1: Run TypeScript compilation**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
npx tsc --noEmit
```

Expected: No type errors. Fix any that appear.

- [ ] **Step 2: Run the dev server**

```bash
npm run dev
```

Navigate to `/projects` and verify:
- Canvas renders with status columns
- Cards display with correct data (title/address, client, value, progress)
- Pan/zoom works (wheel + middle-click)
- Cards expand on click
- Drag between columns works (with first-time confirmation)
- Marquee select works
- Toolbar search/filter/sort works
- Archive tray opens
- Detail popover opens from expanded card
- Context menu appears on right-click

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(projects): resolve build and runtime issues from canvas implementation"
```
