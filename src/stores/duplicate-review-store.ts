"use client";

import { create } from "zustand";

interface DuplicateReviewState {
  open: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useDuplicateReviewStore = create<DuplicateReviewState>()(
  (set) => ({
    open: false,
    openSheet: () => set({ open: true }),
    closeSheet: () => set({ open: false }),
  })
);
