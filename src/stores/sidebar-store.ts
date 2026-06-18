"use client";

import { create } from "zustand";

/**
 * Shell sidebar state (WEB OVERHAUL P2 — variant B instrument rail).
 *
 * Desktop is a fixed 72px icon rail. It never expands — labels surface as
 * hover/focus tooltips with zero layout shift, so there is no transient
 * "expanded" state to track. Mobile (<768px) uses a slide-in drawer with
 * the full labelled anatomy; that open/closed flag is the only state left.
 */
interface SidebarState {
  /** Mobile drawer is open. */
  isMobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  isMobileOpen: false,
  openMobile: () => set({ isMobileOpen: true }),
  closeMobile: () => set({ isMobileOpen: false }),
}));
