"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MapViewFilter = "today" | "active" | "all";

interface MapFilterState {
  view: MapViewFilter;
  showCrew: boolean;
  showEvents: boolean;
  railExpanded: boolean;
  setView: (view: MapViewFilter) => void;
  toggleCrew: () => void;
  toggleEvents: () => void;
  toggleRail: () => void;
}

export const useMapFilterStore = create<MapFilterState>()(
  persist(
    (set) => ({
      view: "today",
      showCrew: true,
      showEvents: false,
      railExpanded: false,
      setView: (view) => set({ view }),
      toggleCrew: () => set((s) => ({ showCrew: !s.showCrew })),
      toggleEvents: () => set((s) => ({ showEvents: !s.showEvents })),
      toggleRail: () => set((s) => ({ railExpanded: !s.railExpanded })),
    }),
    { name: "ops-map-filter" }
  )
);
