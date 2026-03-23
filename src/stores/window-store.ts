"use client";

import { create } from "zustand";

export type FloatingWindowType = "create-project" | "create-client" | "create-task" | "create-estimate" | "create-lead";

export interface FloatingWindowState {
  id: string;
  title: string;
  type: FloatingWindowType;
  isMinimized: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

interface WindowStoreState {
  windows: FloatingWindowState[];
  nextZIndex: number;
  openWindow: (opts: {
    id: string;
    title: string;
    type: FloatingWindowType;
  }) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updatePosition: (id: string, position: { x: number; y: number }) => void;
}

const DEFAULT_SIZE = { width: 560, height: 600 };

const SIZE_BY_TYPE: Partial<Record<FloatingWindowType, { width: number; height: number }>> = {
  "create-estimate": { width: 780, height: 700 },
};

function getSizeForType(type: FloatingWindowType) {
  return SIZE_BY_TYPE[type] ?? DEFAULT_SIZE;
}

function getDefaultPosition(existingCount: number, size = DEFAULT_SIZE): { x: number; y: number } {
  const offset = existingCount * 30;
  return {
    x: Math.min(200 + offset, window.innerWidth - size.width - 40),
    y: Math.min(100 + offset, window.innerHeight - size.height - 40),
  };
}

export const useWindowStore = create<WindowStoreState>()((set, get) => ({
  windows: [],
  nextZIndex: 100,

  openWindow: ({ id, title, type }) => {
    const { windows, nextZIndex } = get();
    const existing = windows.find((w) => w.id === id);
    if (existing) {
      // Restore + focus if already exists
      set({
        windows: windows.map((w) =>
          w.id === id
            ? { ...w, isMinimized: false, zIndex: nextZIndex }
            : w
        ),
        nextZIndex: nextZIndex + 1,
      });
      return;
    }

    const size = getSizeForType(type);
    const position = getDefaultPosition(windows.filter((w) => !w.isMinimized).length, size);
    set({
      windows: [
        ...windows,
        {
          id,
          title,
          type,
          isMinimized: false,
          position,
          size,
          zIndex: nextZIndex,
        },
      ],
      nextZIndex: nextZIndex + 1,
    });
  },

  closeWindow: (id) => {
    set({ windows: get().windows.filter((w) => w.id !== id) });
  },

  minimizeWindow: (id) => {
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, isMinimized: true } : w
      ),
    });
  },

  restoreWindow: (id) => {
    const { windows, nextZIndex } = get();
    set({
      windows: windows.map((w) =>
        w.id === id
          ? { ...w, isMinimized: false, zIndex: nextZIndex }
          : w
      ),
      nextZIndex: nextZIndex + 1,
    });
  },

  focusWindow: (id) => {
    const { windows, nextZIndex } = get();
    set({
      windows: windows.map((w) =>
        w.id === id ? { ...w, zIndex: nextZIndex } : w
      ),
      nextZIndex: nextZIndex + 1,
    });
  },

  updatePosition: (id, position) => {
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, position } : w
      ),
    });
  },
}));
