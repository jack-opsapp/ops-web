"use client";

import { create } from "zustand";

interface BreadcrumbCrumb {
  label: string;
  href?: string;
}

interface BreadcrumbState {
  entityName: string | null;
  parentCrumbs: BreadcrumbCrumb[] | null;
  setEntityName: (name: string | null) => void;
  clearEntityName: () => void;
  setParentCrumbs: (crumbs: BreadcrumbCrumb[] | null) => void;
  clearParentCrumbs: () => void;
}

export const useBreadcrumbStore = create<BreadcrumbState>()((set) => ({
  entityName: null,
  parentCrumbs: null,
  setEntityName: (entityName) => set({ entityName }),
  clearEntityName: () => set({ entityName: null }),
  setParentCrumbs: (parentCrumbs) => set({ parentCrumbs }),
  clearParentCrumbs: () => set({ parentCrumbs: null }),
}));
