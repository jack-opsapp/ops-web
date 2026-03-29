"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarState {
  /** Whether the sidebar is hover-expanded (transient, not persisted) */
  isHoverExpanded: boolean;
  /** Whether the mobile drawer is open */
  isMobileOpen: boolean;
  setHoverExpanded: (expanded: boolean) => void;
  openMobile: () => void;
  closeMobile: () => void;

  // Legacy — kept for backward compatibility during migration.
  // Components that read isCollapsed now always get true (sidebar is always collapsed at rest).
  isCollapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isHoverExpanded: false,
      isMobileOpen: false,
      setHoverExpanded: (isHoverExpanded) => set({ isHoverExpanded }),
      openMobile: () => set({ isMobileOpen: true }),
      closeMobile: () => set({ isMobileOpen: false }),

      // Legacy — always collapsed in HUD mode
      isCollapsed: true,
      toggle: () => {},
      setCollapsed: () => {},
    }),
    {
      name: "ops-sidebar-state",
      partialize: () => ({}), // Nothing to persist — sidebar is always collapsed at rest
    }
  )
);
