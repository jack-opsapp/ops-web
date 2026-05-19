"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_RAIL_FILTER,
  type InboxPrimaryRail,
} from "@/lib/inbox/rail-predicates";

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
  /** Primary inbox rail to open by default. */
  defaultRailFilter: InboxPrimaryRail;
  setLayout: (layout: { leftPct: number; rightPct: number }) => void;
  toggleRightRail: () => void;
  setRightRailOpen: (open: boolean) => void;
  setDefaultRailFilter: (filter: InboxPrimaryRail) => void;
  resetLayout: () => void;
}

type InboxLayoutSnapshot = Pick<
  InboxLayoutState,
  "leftPct" | "rightPct" | "rightRailOpen" | "defaultRailFilter"
>;

export const DEFAULT_INBOX_LAYOUT: InboxLayoutSnapshot = {
  leftPct: 22,
  rightPct: 22,
  rightRailOpen: true,
  defaultRailFilter: DEFAULT_RAIL_FILTER,
};

function clamp(n: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, n));
}

function isInboxPrimaryRail(value: unknown): value is InboxPrimaryRail {
  return value === "CLIENTS" || value === "EVERYTHING_ELSE" || value === "ALL";
}

export function migrateInboxLayoutState(
  persistedState: unknown,
): InboxLayoutSnapshot {
  const state =
    persistedState && typeof persistedState === "object"
      ? (persistedState as Record<string, unknown>)
      : {};

  return {
    leftPct:
      typeof state.leftPct === "number"
        ? clamp(state.leftPct, LEFT_PCT_BOUNDS)
        : DEFAULT_INBOX_LAYOUT.leftPct,
    rightPct:
      typeof state.rightPct === "number"
        ? clamp(state.rightPct, RIGHT_PCT_BOUNDS)
        : DEFAULT_INBOX_LAYOUT.rightPct,
    rightRailOpen:
      typeof state.rightRailOpen === "boolean"
        ? state.rightRailOpen
        : DEFAULT_INBOX_LAYOUT.rightRailOpen,
    defaultRailFilter: isInboxPrimaryRail(state.defaultRailFilter)
      ? state.defaultRailFilter
      : DEFAULT_INBOX_LAYOUT.defaultRailFilter,
  };
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
      setDefaultRailFilter: (filter) => set({ defaultRailFilter: filter }),
      resetLayout: () => set(DEFAULT_INBOX_LAYOUT),
    }),
    {
      name: "ops-inbox-layout",
      version: 2,
      migrate: (persistedState) => migrateInboxLayoutState(persistedState),
    },
  ),
);
