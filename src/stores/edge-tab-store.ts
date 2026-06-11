"use client";

import { create } from "zustand";

/**
 * Right-rail edge-tab mutex (WEB OVERHAUL P2).
 *
 * One drawer open at a time across Notifications / Quick Actions / Bug
 * Report. The hover/geometry registry that powered the old sibling-push
 * choreography is gone with the choreography itself (P2 shell design
 * spec §4.4) — tabs are fixed-height instruments now.
 */
interface EdgeTabState {
  /** Currently-active tab id, or null if all closed. */
  activeTab: string | null;

  /** Open the given tab. Atomically closes any other active tab. */
  setActive: (id: string) => void;

  /** Toggle the given tab. If already open, closes; otherwise opens. */
  toggle: (id: string) => void;

  /** Close the given tab only if it is currently active. No-op otherwise. */
  close: (id: string) => void;

  /** Close whichever tab is active. */
  closeAll: () => void;
}

export const useEdgeTabStore = create<EdgeTabState>((set) => ({
  activeTab: null,
  setActive: (id) => set({ activeTab: id }),
  toggle: (id) =>
    set((s) => ({ activeTab: s.activeTab === id ? null : id })),
  close: (id) =>
    set((s) => (s.activeTab === id ? { activeTab: null } : s)),
  closeAll: () => set({ activeTab: null }),
}));
