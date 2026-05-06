"use client";

import { create } from "zustand";

/**
 * Per-tab geometry registered at mount time so siblings can compute
 * push-out direction without prop-drilling each other's offsets.
 */
interface EdgeTabGeometry {
  /** Vertical offset from rail midpoint (negative = above, positive = below). */
  stackOffset: number;
  /** Magnitude the tab grows when hovered (expandedHeight - restHeight). */
  expansionDelta: number;
}

interface EdgeTabState {
  /** Currently-active tab id, or null if all closed. */
  activeTab: string | null;

  /**
   * Tab currently under the cursor (closed-state hover). null when no tab
   * is being hovered. Used by sibling tabs to translate out of the way so
   * they don't visually overlap the expanding tab. (Bug 85da1e52.)
   */
  hoveredTab: string | null;

  /**
   * Geometry registry, keyed by tab id. Populated by each EdgeTab on mount
   * and torn down on unmount. Sibling tabs read this to compute push-out
   * direction (up if sibling is BELOW, down if sibling is ABOVE).
   */
  geometry: Record<string, EdgeTabGeometry>;

  /** Open the given tab. Atomically closes any other active tab. */
  setActive: (id: string) => void;

  /** Toggle the given tab. If already open, closes; otherwise opens. */
  toggle: (id: string) => void;

  /** Close the given tab only if it is currently active. No-op otherwise. */
  close: (id: string) => void;

  /** Close whichever tab is active. */
  closeAll: () => void;

  /** Record which tab the cursor is over, or null on leave. */
  setHovered: (id: string | null) => void;

  /** Register this tab's geometry so siblings can compute push-out. */
  registerGeometry: (id: string, geom: EdgeTabGeometry) => void;

  /** Clean up on unmount. */
  unregisterGeometry: (id: string) => void;
}

export const useEdgeTabStore = create<EdgeTabState>((set) => ({
  activeTab: null,
  hoveredTab: null,
  geometry: {},
  setActive: (id) => set({ activeTab: id }),
  toggle: (id) =>
    set((s) => ({ activeTab: s.activeTab === id ? null : id })),
  close: (id) =>
    set((s) => (s.activeTab === id ? { activeTab: null } : s)),
  closeAll: () => set({ activeTab: null }),
  setHovered: (id) =>
    set((s) => (s.hoveredTab === id ? s : { hoveredTab: id })),
  registerGeometry: (id, geom) =>
    set((s) => {
      const prev = s.geometry[id];
      if (
        prev &&
        prev.stackOffset === geom.stackOffset &&
        prev.expansionDelta === geom.expansionDelta
      ) {
        return s;
      }
      return { geometry: { ...s.geometry, [id]: geom } };
    }),
  unregisterGeometry: (id) =>
    set((s) => {
      if (!(id in s.geometry)) return s;
      const next = { ...s.geometry };
      delete next[id];
      return { geometry: next };
    }),
}));
