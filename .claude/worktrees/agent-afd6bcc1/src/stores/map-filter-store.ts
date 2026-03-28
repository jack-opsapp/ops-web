"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type L from "leaflet";

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
      view: "active",
      showCrew: true,
      railExpanded: false,
      setView: (view) => set({ view }),
      toggleCrew: () => set((s) => ({ showCrew: !s.showCrew })),
      toggleRail: () => set((s) => ({ railExpanded: !s.railExpanded })),
    }),
    { name: "ops-map-filter" }
  )
);

// Non-persisted store for the Leaflet map instance + user location.
// Allows the toolbar to control zoom without prop drilling.
interface MapInstanceState {
  map: L.Map | null;
  userLocation: [number, number] | null;
  setMap: (map: L.Map | null) => void;
  setUserLocation: (loc: [number, number]) => void;
}

export const useMapInstanceStore = create<MapInstanceState>((set) => ({
  map: null,
  userLocation: null,
  setMap: (map) => set({ map }),
  setUserLocation: (loc) => set({ userLocation: loc }),
}));
