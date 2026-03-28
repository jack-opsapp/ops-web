/**
 * OPS Web - UI Store
 *
 * Zustand store for UI state management.
 * Handles sidebar, command palette, active view, theme, and bulk operations.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActiveView =
  | "dashboard"
  | "projects"
  | "calendar"
  | "team"
  | "clients"
  | "settings"
  | "reports";

export type ProjectViewMode = "board" | "list" | "calendar";

export type ThemeMode = "dark" | "light" | "system";

export interface UIState {
  // Sidebar
  sidebarCollapsed: boolean;
  sidebarHovered: boolean;

  // Command Palette
  commandPaletteOpen: boolean;

  // Navigation
  activeView: ActiveView;
  projectViewMode: ProjectViewMode;

  // Selection (for bulk operations)
  selectedProjectIds: Set<string>;
  selectedTaskIds: Set<string>;
  selectedClientIds: Set<string>;

  // Theme
  themeMode: ThemeMode;

  // Notifications
  notificationCount: number;

  // Modals
  activeModal: string | null;
  modalData: Record<string, unknown> | null;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarHovered: (hovered: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
  setProjectViewMode: (mode: ProjectViewMode) => void;

  // Selection actions
  toggleProjectSelection: (id: string) => void;
  toggleTaskSelection: (id: string) => void;
  toggleClientSelection: (id: string) => void;
  selectAllProjects: (ids: string[]) => void;
  selectAllTasks: (ids: string[]) => void;
  selectAllClients: (ids: string[]) => void;
  clearProjectSelection: () => void;
  clearTaskSelection: () => void;
  clearClientSelection: () => void;
  clearAllSelections: () => void;

  // Theme actions
  setThemeMode: (mode: ThemeMode) => void;

  // Notification actions
  setNotificationCount: (count: number) => void;
  incrementNotifications: () => void;
  clearNotifications: () => void;

  // Modal actions
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Initial state
      sidebarCollapsed: false,
      sidebarHovered: false,
      commandPaletteOpen: false,
      activeView: "dashboard" as ActiveView,
      projectViewMode: "board" as ProjectViewMode,
      selectedProjectIds: new Set<string>(),
      selectedTaskIds: new Set<string>(),
      selectedClientIds: new Set<string>(),
      themeMode: "dark" as ThemeMode,
      notificationCount: 0,
      activeModal: null,
      modalData: null,

      // Sidebar
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setSidebarHovered: (hovered) => set({ sidebarHovered: hovered }),

      // Command Palette
      toggleCommandPalette: () =>
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      // Navigation
      setActiveView: (view) => {
        set({ activeView: view });
        // Clear selections when navigating
        get().clearAllSelections();
      },
      setProjectViewMode: (mode) => set({ projectViewMode: mode }),

      // Project selection
      toggleProjectSelection: (id) =>
        set((state) => {
          const newSet = new Set(state.selectedProjectIds);
          if (newSet.has(id)) {
            newSet.delete(id);
          } else {
            newSet.add(id);
          }
          return { selectedProjectIds: newSet };
        }),
      selectAllProjects: (ids) =>
        set({ selectedProjectIds: new Set(ids) }),
      clearProjectSelection: () =>
        set({ selectedProjectIds: new Set() }),

      // Task selection
      toggleTaskSelection: (id) =>
        set((state) => {
          const newSet = new Set(state.selectedTaskIds);
          if (newSet.has(id)) {
            newSet.delete(id);
          } else {
            newSet.add(id);
          }
          return { selectedTaskIds: newSet };
        }),
      selectAllTasks: (ids) =>
        set({ selectedTaskIds: new Set(ids) }),
      clearTaskSelection: () =>
        set({ selectedTaskIds: new Set() }),

      // Client selection
      toggleClientSelection: (id) =>
        set((state) => {
          const newSet = new Set(state.selectedClientIds);
          if (newSet.has(id)) {
            newSet.delete(id);
          } else {
            newSet.add(id);
          }
          return { selectedClientIds: newSet };
        }),
      selectAllClients: (ids) =>
        set({ selectedClientIds: new Set(ids) }),
      clearClientSelection: () =>
        set({ selectedClientIds: new Set() }),

      // Clear all selections
      clearAllSelections: () =>
        set({
          selectedProjectIds: new Set(),
          selectedTaskIds: new Set(),
          selectedClientIds: new Set(),
        }),

      // Theme
      setThemeMode: (mode) => set({ themeMode: mode }),

      // Notifications
      setNotificationCount: (count) => set({ notificationCount: count }),
      incrementNotifications: () =>
        set((state) => ({ notificationCount: state.notificationCount + 1 })),
      clearNotifications: () => set({ notificationCount: 0 }),

      // Modals
      openModal: (modalId, data) =>
        set({ activeModal: modalId, modalData: data ?? null }),
      closeModal: () => set({ activeModal: null, modalData: null }),
    }),
    {
      name: "ops-ui-storage",
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") {
          return localStorage;
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      // Only persist user preferences, not transient UI state
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        activeView: state.activeView,
        projectViewMode: state.projectViewMode,
        themeMode: state.themeMode,
      }),
    }
  )
);

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Check if any items are selected */
export const selectHasSelection = (state: UIState) =>
  state.selectedProjectIds.size > 0 ||
  state.selectedTaskIds.size > 0 ||
  state.selectedClientIds.size > 0;

/** Get total selection count */
export const selectTotalSelectionCount = (state: UIState) =>
  state.selectedProjectIds.size +
  state.selectedTaskIds.size +
  state.selectedClientIds.size;

export default useUIStore;
