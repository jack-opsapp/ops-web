import {
  ProjectStatus,
  PROJECT_STATUS_SORT_ORDER,
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
  cols: number;
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
      continue; // Archived handled by tray, not layout engine
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

  // Dynamic column count: target a square region shape
  // Card cell dimensions: 210px wide (200+10gap), 70px tall (60+10gap) → aspect ratio 3:1
  // For a square region: cols * cellW ≈ rows * cellH → cols * 3 ≈ rows
  // With rows = ceil(n/cols): cols * 3 ≈ ceil(n/cols) → cols² ≈ n/3 → cols ≈ sqrt(n/3)
  const cellW = CARD_WIDTH + STACK_GAP;
  const cellH = CARD_HEIGHT + STACK_GAP;
  const aspectRatio = cellW / cellH; // ~3
  const terminalCols = Math.max(1, Math.round(Math.sqrt(sortedClosed.length / aspectRatio)));

  const cardPositions = sortedClosed.map((project, i) => {
    const col = i % terminalCols;
    const row = Math.floor(i / terminalCols);
    return {
      projectId: project.id,
      x: terminalStartX + col * (CARD_WIDTH + STACK_GAP),
      y: CANVAS_PADDING + STACK_HEADER_HEIGHT + row * (CARD_HEIGHT + STACK_GAP),
    };
  });

  const cols = Math.min(sortedClosed.length, terminalCols);
  const rows = Math.max(1, Math.ceil(sortedClosed.length / terminalCols));
  const regionWidth = cols * (CARD_WIDTH + STACK_GAP);
  // Internal spacing: 12px header margin-top + STACK_HEADER_HEIGHT + 8px gap + rows * cells + 20px bottom padding
  const regionContentHeight = 12 + STACK_HEADER_HEIGHT + 8 + rows * (CARD_HEIGHT + STACK_GAP) + 20;

  terminalRegions.push({
    status: ProjectStatus.Closed,
    position: { x: terminalStartX, y: CANVAS_PADDING },
    cols: Math.max(1, cols),
    cardPositions,
    bounds: {
      x: terminalStartX - 20,
      y: CANVAS_PADDING - 20,
      width: Math.max(regionWidth, CARD_WIDTH) + 40,
      height: regionContentHeight + 40,
    },
  });

  const totalTerminalHeight = regionContentHeight;
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
