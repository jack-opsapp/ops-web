"use client";

import { create } from "zustand";

/**
 * Shell sidebar state (WEB OVERHAUL P2).
 *
 * Desktop is a 72px HUD rail that hover-expands to a 240px overlay — both
 * transient, nothing persists. Mobile (<768px) uses a slide-in drawer.
 * The legacy isCollapsed/toggle/setCollapsed fields (pre-HUD pin/collapse
 * era) had no consumers left outside the old sidebar and are gone.
 */
interface SidebarState {
  /** Desktop rail is hover-expanded (transient). */
  isHoverExpanded: boolean;
  /** Mobile drawer is open. */
  isMobileOpen: boolean;
  setHoverExpanded: (expanded: boolean) => void;
  openMobile: () => void;
  closeMobile: () => void;
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  isHoverExpanded: false,
  isMobileOpen: false,
  setHoverExpanded: (isHoverExpanded) => set({ isHoverExpanded }),
  openMobile: () => set({ isMobileOpen: true }),
  closeMobile: () => set({ isMobileOpen: false }),
}));
