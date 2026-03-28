"use client";

import { create } from "zustand";

interface SelectionState {
  selectedIds: Set<string>;
  isSelecting: boolean;
  lastSelectedId: string | null;

  // Actions
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setSelecting: (selecting: boolean) => void;
  isSelected: (id: string) => boolean;
  selectRange: (ids: string[], fromId: string, toId: string) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: new Set(),
  isSelecting: false,
  lastSelectedId: null,

  toggleSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return {
        selectedIds: next,
        isSelecting: next.size > 0,
        lastSelectedId: id,
      };
    }),

  selectAll: (ids) =>
    set({
      selectedIds: new Set(ids),
      isSelecting: ids.length > 0,
      lastSelectedId: ids.length > 0 ? ids[ids.length - 1] : null,
    }),

  clearSelection: () =>
    set({
      selectedIds: new Set(),
      isSelecting: false,
      lastSelectedId: null,
    }),

  setSelecting: (selecting) => set({ isSelecting: selecting }),

  isSelected: (id) => get().selectedIds.has(id),

  selectRange: (ids, fromId, toId) =>
    set((state) => {
      const fromIndex = ids.indexOf(fromId);
      const toIndex = ids.indexOf(toId);
      if (fromIndex === -1 || toIndex === -1) return state;

      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      const rangeIds = ids.slice(start, end + 1);

      const next = new Set(state.selectedIds);
      for (const id of rangeIds) {
        next.add(id);
      }
      return {
        selectedIds: next,
        isSelecting: next.size > 0,
        lastSelectedId: toId,
      };
    }),
}));
