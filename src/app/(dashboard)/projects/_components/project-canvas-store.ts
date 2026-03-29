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
