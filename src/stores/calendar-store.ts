"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  SchedulerView,
  SidePanelMode,
  GhostPreview,
  InlineEditState,
} from "@/lib/types/scheduling";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuickCreateAnchor {
  x: number;
  y: number;
  date: Date;
  endDate?: Date;
}

// ─── Store Interface ─────────────────────────────────────────────────────────

// ─── Unscheduled tray types ─────────────────────────────────────────────────

export type UnscheduledTrayGroupBy = "project" | "client" | "type" | "none";
export type UnscheduledTraySort = "created" | "title" | "project";

interface CalendarStoreState {
  // View
  currentDate: Date;
  view: SchedulerView;

  // Side Panel
  sidePanelMode: SidePanelMode;
  selectedTaskId: string | null;
  sidePanelProjectId: string | null;

  // Filter sidebar
  isFilterSidebarOpen: boolean;

  // Unscheduled tray (T15)
  unscheduledTrayCollapsed: boolean;
  unscheduledTrayGroupBy: UnscheduledTrayGroupBy;
  unscheduledTraySort: UnscheduledTraySort;
  unscheduledTraySearch: string;

  // Quick create
  quickCreateAnchor: QuickCreateAnchor | null;

  // Filters (persisted)
  filterTeamMemberIds: string[];
  filterTaskTypes: string[];
  filterProjectIds: string[];
  filterStatuses: string[];

  // DnD
  draggedEventId: string | null;
  dragPreview: { date: Date; duration: number } | null;

  // Legend hover-to-highlight: when set, event renderers dim non-matching
  // events and brighten matching ones. UI-ephemeral, never persisted.
  highlightedTaskType: string | null;

  // Team-member hover-to-highlight (parallel to highlightedTaskType, for
  // the team-member dropdown). When set, event renderers dim cards whose
  // crew does not include this user id.
  highlightedTeamMemberId: string | null;

  // Cascade / Ghost previews
  ghostPreviews: GhostPreview[];
  isConfirmBarVisible: boolean;
  confirmBarMessage: string;
  pendingCascadeAction: (() => Promise<void>) | null;

  // Multi-select
  selectedTaskIds: string[];

  // Inline edit
  inlineEdit: InlineEditState | null;

  // Actions — View
  setView: (view: SchedulerView) => void;
  setCurrentDate: (date: Date) => void;
  goToToday: () => void;

  // Actions — Side Panel
  setSidePanelTask: (taskId: string) => void;
  setSidePanelProject: (projectId: string) => void;
  closeSidePanel: () => void;

  // Actions — Quick Create
  setQuickCreateAnchor: (anchor: QuickCreateAnchor | null) => void;

  // Actions — Filters
  toggleFilterSidebar: () => void;
  updateFilters: (
    filters: Partial<
      Pick<
        CalendarStoreState,
        | "filterTeamMemberIds"
        | "filterTaskTypes"
        | "filterProjectIds"
        | "filterStatuses"
      >
    >
  ) => void;
  clearFilters: () => void;

  // Actions — DnD
  setDragState: (
    eventId: string | null,
    preview?: { date: Date; duration: number } | null
  ) => void;

  // Actions — Legend highlight
  setHighlightedTaskType: (type: string | null) => void;
  setHighlightedTeamMemberId: (id: string | null) => void;

  // Actions — Multi-select
  toggleTaskSelection: (taskId: string) => void;
  selectTaskRange: (taskIds: string[]) => void;
  clearSelection: () => void;

  // Actions — Cascade / Ghost
  setGhostPreviews: (previews: GhostPreview[]) => void;
  clearGhostPreviews: () => void;
  showConfirmBar: (message: string, action: () => Promise<void>) => void;
  hideConfirmBar: () => void;

  // Actions — Inline edit
  setInlineEdit: (state: InlineEditState | null) => void;

  // Actions — Unscheduled tray
  toggleUnscheduledTray: () => void;
  setUnscheduledTrayCollapsed: (collapsed: boolean) => void;
  setUnscheduledTrayGroupBy: (groupBy: UnscheduledTrayGroupBy) => void;
  setUnscheduledTraySort: (sort: UnscheduledTraySort) => void;
  setUnscheduledTraySearch: (search: string) => void;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useCalendarStore = create<CalendarStoreState>()(
  persist(
    (set) => ({
      // View
      currentDate: new Date(),
      view: "week",

      // Side Panel
      sidePanelMode: null,
      selectedTaskId: null,
      sidePanelProjectId: null,

      // Filter sidebar
      isFilterSidebarOpen: false,

      // Unscheduled tray (T15)
      // Defaults: expanded on first visit (per spec). Tray dock side flips
      // based on view (Day → left, others → right) but that lives in the
      // component, not state.
      unscheduledTrayCollapsed: false,
      unscheduledTrayGroupBy: "project",
      unscheduledTraySort: "created",
      unscheduledTraySearch: "",

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

      // Legend highlight
      highlightedTaskType: null,
      highlightedTeamMemberId: null,

      // Cascade / Ghost
      ghostPreviews: [],
      isConfirmBarVisible: false,
      confirmBarMessage: "",
      pendingCascadeAction: null,

      // Multi-select
      selectedTaskIds: [],

      // Inline edit
      inlineEdit: null,

      // Actions — View
      setView: (view) => set({ view }),
      setCurrentDate: (currentDate) => set({ currentDate }),
      goToToday: () => set({ currentDate: new Date() }),

      // Actions — Side Panel
      setSidePanelTask: (taskId) =>
        set({
          sidePanelMode: "task-detail",
          selectedTaskId: taskId,
          sidePanelProjectId: null,
          quickCreateAnchor: null,
        }),
      setSidePanelProject: (projectId) =>
        set({
          sidePanelMode: "project-drawer",
          sidePanelProjectId: projectId,
          selectedTaskId: null,
        }),
      closeSidePanel: () =>
        set({
          sidePanelMode: null,
          selectedTaskId: null,
          sidePanelProjectId: null,
        }),

      // Actions — Quick Create
      setQuickCreateAnchor: (anchor) =>
        set({
          quickCreateAnchor: anchor,
          sidePanelMode: null,
          selectedTaskId: null,
          sidePanelProjectId: null,
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

      // Actions — Legend highlight
      setHighlightedTaskType: (type) => set({ highlightedTaskType: type }),
      setHighlightedTeamMemberId: (id) => set({ highlightedTeamMemberId: id }),

      // Actions — Multi-select
      toggleTaskSelection: (taskId) =>
        set((state) => ({
          selectedTaskIds: state.selectedTaskIds.includes(taskId)
            ? state.selectedTaskIds.filter((id) => id !== taskId)
            : [...state.selectedTaskIds, taskId],
        })),
      selectTaskRange: (taskIds) => set({ selectedTaskIds: taskIds }),
      clearSelection: () => set({ selectedTaskIds: [] }),

      // Actions — Cascade / Ghost
      setGhostPreviews: (previews) => set({ ghostPreviews: previews }),
      clearGhostPreviews: () => set({ ghostPreviews: [] }),
      showConfirmBar: (message, action) =>
        set({
          isConfirmBarVisible: true,
          confirmBarMessage: message,
          pendingCascadeAction: action,
        }),
      hideConfirmBar: () =>
        set({
          isConfirmBarVisible: false,
          confirmBarMessage: "",
          pendingCascadeAction: null,
        }),

      // Actions — Inline edit
      setInlineEdit: (inlineEdit) => set({ inlineEdit }),

      // Actions — Unscheduled tray
      toggleUnscheduledTray: () =>
        set((state) => ({
          unscheduledTrayCollapsed: !state.unscheduledTrayCollapsed,
        })),
      setUnscheduledTrayCollapsed: (unscheduledTrayCollapsed) =>
        set({ unscheduledTrayCollapsed }),
      setUnscheduledTrayGroupBy: (unscheduledTrayGroupBy) =>
        set({ unscheduledTrayGroupBy }),
      setUnscheduledTraySort: (unscheduledTraySort) =>
        set({ unscheduledTraySort }),
      setUnscheduledTraySearch: (unscheduledTraySearch) =>
        set({ unscheduledTraySearch }),
    }),
    {
      name: "ops-calendar",
      version: 2,
      migrate: (persistedState, version) => {
        const s = (persistedState ?? {}) as Record<string, unknown>;
        // v0/v1 → v2: rename 'timeline' → 'crew'
        if (version < 2 && s.view === "timeline") {
          s.view = "crew";
        }
        // Defensive: any unknown view value falls back to 'week' default
        const validViews = new Set(["day", "week", "month", "crew"]);
        if (typeof s.view !== "string" || !validViews.has(s.view as string)) {
          s.view = "week";
        }
        return s;
      },
      partialize: (state) => ({
        view: state.view,
        filterTeamMemberIds: state.filterTeamMemberIds,
        filterTaskTypes: state.filterTaskTypes,
        filterProjectIds: state.filterProjectIds,
        filterStatuses: state.filterStatuses,
        isFilterSidebarOpen: state.isFilterSidebarOpen,
        unscheduledTrayCollapsed: state.unscheduledTrayCollapsed,
        unscheduledTrayGroupBy: state.unscheduledTrayGroupBy,
        unscheduledTraySort: state.unscheduledTraySort,
      }),
    }
  )
);
