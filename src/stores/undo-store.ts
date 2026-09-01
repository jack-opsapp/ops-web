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

  /** Push an undo entry. Returns the entry id so a caller can later undo
   * exactly that action via {@link UndoState.undoEntry} (see below). */
  pushUndo: (entry: {
    label: string;
    inverseFn: () => Promise<void>;
  }) => string;
  undo: () => Promise<void>;
  /**
   * Undo one SPECIFIC entry by id, wherever it sits in the stack.
   *
   * The stack is also driven by the top bar's Cmd+Z / undo button, which pop
   * the TOP entry. A visible per-action undo affordance (the pipeline's undo
   * toast) must not pop the top blindly — by the time the operator clicks it,
   * a newer action may sit above. Targeting by id keeps the two affordances
   * coherent: whichever fires first removes the entry, and the other becomes
   * a silent no-op instead of undoing a second, unrelated action.
   */
  undoEntry: (id: string) => Promise<void>;
  clear: () => void;
}

// ── Store ──

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  isUndoing: false,

  pushUndo: ({ label, inverseFn }) => {
    const id = crypto.randomUUID();
    set((state) => ({
      stack: [
        { id, label, inverseFn, timestamp: Date.now() },
        ...state.stack,
      ].slice(0, MAX_STACK_SIZE),
    }));
    return id;
  },

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

  undoEntry: async (id) => {
    const { stack, isUndoing } = get();
    if (isUndoing) return;

    const entry = stack.find((candidate) => candidate.id === id);
    // Already undone (or evicted past MAX_STACK_SIZE) — nothing owed.
    if (!entry) return;

    set({
      isUndoing: true,
      stack: stack.filter((candidate) => candidate.id !== id),
    });

    try {
      await entry.inverseFn();
    } finally {
      set({ isUndoing: false });
    }
  },

  clear: () => set({ stack: [], isUndoing: false }),
}));
