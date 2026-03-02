"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CalendarView = "month" | "week" | "day" | "team" | "agenda";

export interface QuickCreateAnchor {
  x: number;
  y: number;
  date: Date;
  endDate?: Date;
}

// ─── Store Interface ─────────────────────────────────────────────────────────

interface CalendarStoreState {
  // View
  currentDate: Date;
  view: CalendarView;

  // Panels
  selectedEventId: string | null;
  isDetailPanelOpen: boolean;
  isFilterSidebarOpen: boolean;

  // Quick create
  quickCreateAnchor: QuickCreateAnchor | null;

  // Filters (persisted)
  filterTeamMemberIds: string[];
  filterTaskTypes: string[];
  filterProjectIds: string[];
  filterStatuses: string[];

  // DnD (Phase 2)
  draggedEventId: string | null;
  dragPreview: { date: Date; duration: number } | null;

  // Actions — View
  setView: (view: CalendarView) => void;
  setCurrentDate: (date: Date) => void;
  goToToday: () => void;

  // Actions — Selection
  selectEvent: (id: string | null) => void;
  closeDetailPanel: () => void;

  // Actions — Quick Create
  setQuickCreateAnchor: (anchor: QuickCreateAnchor | null) => void;

  // Actions — Filters
  toggleFilterSidebar: () => void;
  updateFilters: (filters: Partial<Pick<CalendarStoreState, "filterTeamMemberIds" | "filterTaskTypes" | "filterProjectIds" | "filterStatuses">>) => void;
  clearFilters: () => void;

  // Actions — DnD (Phase 2)
  setDragState: (eventId: string | null, preview?: { date: Date; duration: number } | null) => void;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useCalendarStore = create<CalendarStoreState>()(
  persist(
    (set) => ({
      // View
      currentDate: new Date(),
      view: "week",

      // Panels
      selectedEventId: null,
      isDetailPanelOpen: false,
      isFilterSidebarOpen: false,

      // Quick create
      quickCreateAnchor: null,

      // Filters
      filterTeamMemberIds: [],
      filterTaskTypes: [],
      filterProjectIds: [],
      filterStatuses: [],

      // DnD
      draggedEventId: null,
      dragPreview: null,

      // Actions — View
      setView: (view) => set({ view }),
      setCurrentDate: (currentDate) => set({ currentDate }),
      goToToday: () => set({ currentDate: new Date() }),

      // Actions — Selection
      selectEvent: (id) =>
        set({
          selectedEventId: id,
          isDetailPanelOpen: id !== null,
          quickCreateAnchor: null,
        }),
      closeDetailPanel: () =>
        set({ selectedEventId: null, isDetailPanelOpen: false }),

      // Actions — Quick Create
      setQuickCreateAnchor: (anchor) =>
        set({
          quickCreateAnchor: anchor,
          selectedEventId: null,
          isDetailPanelOpen: false,
        }),

      // Actions — Filters
      toggleFilterSidebar: () =>
        set((state) => ({ isFilterSidebarOpen: !state.isFilterSidebarOpen })),
      updateFilters: (filters) => set(filters),
      clearFilters: () =>
        set({
          filterTeamMemberIds: [],
          filterTaskTypes: [],
          filterProjectIds: [],
          filterStatuses: [],
        }),

      // Actions — DnD
      setDragState: (eventId, preview) =>
        set({
          draggedEventId: eventId,
          dragPreview: preview ?? null,
        }),
    }),
    {
      name: "ops-calendar",
      partialize: (state) => ({
        view: state.view,
        filterTeamMemberIds: state.filterTeamMemberIds,
        filterTaskTypes: state.filterTaskTypes,
        filterProjectIds: state.filterProjectIds,
        filterStatuses: state.filterStatuses,
        isFilterSidebarOpen: state.isFilterSidebarOpen,
      }),
    }
  )
);
