"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MapViewFilter = "today" | "active" | "all";

interface MapFilterState {
  view: MapViewFilter;
  showCrew: boolean;
  railExpanded: boolean;
  setView: (view: MapViewFilter) => void;
  toggleCrew: () => void;
  toggleRail: () => void;
}

export const useMapFilterStore = create<MapFilterState>()(
  persist(
    (set) => ({
      view: "today",
      showCrew: true,
      railExpanded: false,
      setView: (view) => set({ view }),
      toggleCrew: () => set((s) => ({ showCrew: !s.showCrew })),
      toggleRail: () => set((s) => ({ railExpanded: !s.railExpanded })),
    }),
    { name: "ops-map-filter" }
  )
);
