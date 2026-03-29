"use client";

import { create } from "zustand";

// ── Types ──

export interface UndoEntry {
  id: string;
  label: string;
  inverseFn: () => Promise<void>;
  timestamp: number;
}

const MAX_STACK_SIZE = 20;

interface UndoState {
  stack: UndoEntry[];
  isUndoing: boolean;

  pushUndo: (entry: { label: string; inverseFn: () => Promise<void> }) => void;
  undo: () => Promise<void>;
  clear: () => void;
}

// ── Store ──

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  isUndoing: false,

  pushUndo: ({ label, inverseFn }) =>
    set((state) => ({
      stack: [
        { id: crypto.randomUUID(), label, inverseFn, timestamp: Date.now() },
        ...state.stack,
      ].slice(0, MAX_STACK_SIZE),
    })),

  undo: async () => {
    const { stack, isUndoing } = get();
    if (isUndoing || stack.length === 0) return;

    const [entry, ...rest] = stack;
    set({ isUndoing: true, stack: rest });

    try {
      await entry.inverseFn();
    } finally {
      set({ isUndoing: false });
    }
  },

  clear: () => set({ stack: [], isUndoing: false }),
}));
