"use client";

import { create } from "zustand";

interface IntelState {
  // Selection
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  expandedNodeId: string | null;

  // Visibility
  visibleClusters: Set<string>;
  searchQuery: string;
  searchResults: string[];

  // Camera / 3D gate
  is3DUnlocked: boolean;
  showGatePrompt: boolean;

  // Activation
  newEntityIds: string[];
  activationPlaying: boolean;

  // Actions
  setHoveredNode: (id: string | null) => void;
  selectNode: (id: string | null) => void;
  expandNode: (id: string | null) => void;
  toggleCluster: (cluster: string) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (ids: string[]) => void;
  set3DUnlocked: (unlocked: boolean) => void;
  setShowGatePrompt: (show: boolean) => void;
  setNewEntityIds: (ids: string[]) => void;
  setActivationPlaying: (playing: boolean) => void;
  dismissSelection: () => void;
}

const ALL_CLUSTERS = new Set([
  "voice",
  "internal",
  "client",
  "project",
  "vendor",
  "subtrade",
  "financial",
]);

export const useIntelStore = create<IntelState>()((set) => ({
  hoveredNodeId: null,
  selectedNodeId: null,
  expandedNodeId: null,
  visibleClusters: new Set(ALL_CLUSTERS),
  searchQuery: "",
  searchResults: [],
  is3DUnlocked: false,
  showGatePrompt: false,
  newEntityIds: [],
  activationPlaying: false,

  setHoveredNode: (id) => set({ hoveredNodeId: id }),
  selectNode: (id) => set({ selectedNodeId: id, expandedNodeId: null }),
  expandNode: (id) => set({ expandedNodeId: id }),
  toggleCluster: (cluster) =>
    set((state) => {
      const next = new Set(state.visibleClusters);
      if (next.has(cluster)) next.delete(cluster);
      else next.add(cluster);
      return { visibleClusters: next };
    }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (ids) => set({ searchResults: ids }),
  set3DUnlocked: (unlocked) => set({ is3DUnlocked: unlocked }),
  setShowGatePrompt: (show) => set({ showGatePrompt: show }),
  setNewEntityIds: (ids) => set({ newEntityIds: ids }),
  setActivationPlaying: (playing) => set({ activationPlaying: playing }),
  dismissSelection: () => set({ selectedNodeId: null, expandedNodeId: null }),
}));
