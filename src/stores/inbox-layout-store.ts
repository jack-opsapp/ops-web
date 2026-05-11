"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const LEFT_PCT_BOUNDS: readonly [number, number] = [20, 30];
export const RIGHT_PCT_BOUNDS: readonly [number, number] = [20, 28];

interface InboxLayoutState {
  /** Left thread-list panel width as a % of the shell. */
  leftPct: number;
  /** Right context-rail width as a % of the shell. */
  rightPct: number;
  /** Whether the right rail is open. Hidden when false (Phase 6.2 also drives
   *  this via responsive breakpoints — store value is the user preference,
   *  not the computed responsive result). */
  rightRailOpen: boolean;
  setLayout: (layout: { leftPct: number; rightPct: number }) => void;
  toggleRightRail: () => void;
  setRightRailOpen: (open: boolean) => void;
  resetLayout: () => void;
}

export const DEFAULT_INBOX_LAYOUT = {
  leftPct: 22,
  rightPct: 22,
  rightRailOpen: true,
};

function clamp(n: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, n));
}

export const useInboxLayoutStore = create<InboxLayoutState>()(
  persist(
    (set) => ({
      ...DEFAULT_INBOX_LAYOUT,
      setLayout: ({ leftPct, rightPct }) =>
        set({
          leftPct: clamp(leftPct, LEFT_PCT_BOUNDS),
          rightPct: clamp(rightPct, RIGHT_PCT_BOUNDS),
        }),
      toggleRightRail: () =>
        set((s) => ({ rightRailOpen: !s.rightRailOpen })),
      setRightRailOpen: (open) => set({ rightRailOpen: open }),
      resetLayout: () => set(DEFAULT_INBOX_LAYOUT),
    }),
    {
      name: "ops-inbox-layout",
      version: 1,
    },
  ),
);
