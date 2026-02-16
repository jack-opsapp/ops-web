"use client";

import { create } from "zustand";

interface PageAction {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}

interface PageActionsState {
  actions: PageAction[];
  setActions: (actions: PageAction[]) => void;
  clearActions: () => void;
}

export const usePageActionsStore = create<PageActionsState>()((set) => ({
  actions: [],
  setActions: (actions) => set({ actions }),
  clearActions: () => set({ actions: [] }),
}));
