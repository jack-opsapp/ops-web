"use client";

import { create } from "zustand";

interface BreadcrumbState {
  entityName: string | null;
  setEntityName: (name: string | null) => void;
  clearEntityName: () => void;
}

export const useBreadcrumbStore = create<BreadcrumbState>()((set) => ({
  entityName: null,
  setEntityName: (entityName) => set({ entityName }),
  clearEntityName: () => set({ entityName: null }),
}));
