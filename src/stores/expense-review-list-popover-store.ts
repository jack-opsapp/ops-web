"use client";

import { create } from "zustand";

// ── Constants ──
export const POPOVER_DEFAULT_WIDTH = 560;
export const POPOVER_DEFAULT_HEIGHT = 600;
export const POPOVER_MIN_WIDTH = 440;
export const POPOVER_MIN_HEIGHT = 400;
export const POPOVER_Z_BASE = 2000;

export type ExpenseReviewListTab = "needs-review" | "history";

interface ExpenseReviewListPopoverState {
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  isMinimized: boolean;
  activeTab: ExpenseReviewListTab;

  open: (screenPosition?: { x: number; y: number }) => void;
  close: () => void;
  focus: () => void;
  minimize: () => void;
  restore: () => void;
  updatePosition: (position: { x: number; y: number }) => void;
  updateSize: (size: { width: number; height: number }) => void;
  setActiveTab: (tab: ExpenseReviewListTab) => void;
}

function clampPosition(
  x: number,
  y: number,
  width: number = POPOVER_DEFAULT_WIDTH,
  height: number = POPOVER_DEFAULT_HEIGHT,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, globalThis.innerWidth - width)),
    y: Math.max(0, Math.min(y, globalThis.innerHeight - height)),
  };
}

export const useExpenseReviewListPopoverStore = create<ExpenseReviewListPopoverState>()(
  (set, get) => ({
    isOpen: false,
    position: { x: 100, y: 60 },
    size: { width: POPOVER_DEFAULT_WIDTH, height: POPOVER_DEFAULT_HEIGHT },
    zIndex: POPOVER_Z_BASE,
    isMinimized: false,
    activeTab: "needs-review",

    open: (screenPosition) => {
      const pos = screenPosition
        ? clampPosition(screenPosition.x, screenPosition.y)
        : clampPosition(
            Math.round(globalThis.innerWidth / 2 - POPOVER_DEFAULT_WIDTH / 2),
            Math.round(globalThis.innerHeight / 2 - POPOVER_DEFAULT_HEIGHT / 2),
          );
      set({
        isOpen: true,
        isMinimized: false,
        position: pos,
        size: { width: POPOVER_DEFAULT_WIDTH, height: POPOVER_DEFAULT_HEIGHT },
        zIndex: get().zIndex + 1,
      });
    },

    close: () => set({ isOpen: false }),

    focus: () => set({ zIndex: get().zIndex + 1 }),

    minimize: () => set({ isMinimized: true }),

    restore: () => set({ isMinimized: false, zIndex: get().zIndex + 1 }),

    updatePosition: (position) => set({ position }),

    updateSize: (size) => {
      const { position } = get();
      set({
        size: {
          width: Math.max(POPOVER_MIN_WIDTH, Math.min(size.width, globalThis.innerWidth - position.x)),
          height: Math.max(POPOVER_MIN_HEIGHT, Math.min(size.height, globalThis.innerHeight - position.y)),
        },
      });
    },

    setActiveTab: (tab) => set({ activeTab: tab }),
  })
);
