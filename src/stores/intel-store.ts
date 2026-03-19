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

  // Focus hierarchy
  focusLevel: 1 | 2 | 3;
  focusedClientId: string | null;
  focusedProjectId: string | null;

  // Camera animation target (set when focusing, consumed by GalaxyCamera)
  cameraTarget: { x: number; y: number; z: number } | null;
  cameraDistance: number;

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
  focusClient: (clientId: string, position: { x: number; y: number; z: number }) => void;
  focusProject: (projectId: string, position: { x: number; y: number; z: number }) => void;
  focusBack: () => void;
  clearCameraTarget: () => void;
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

// ---------------------------------------------------------------------------
// Mutable per-frame node positions — shared between GalaxyNodes and GalaxyEdges.
// This is NOT React state. It is mutated every frame by the nodes component
// and read by the edges component. Using a module-level Map avoids Zustand
// re-renders on every frame (60 updates/sec would destroy performance).
// ---------------------------------------------------------------------------
export const liveNodePositions = new Map<string, { x: number; y: number; z: number }>();

export const useIntelStore = create<IntelState>()((set) => ({
  hoveredNodeId: null,
  selectedNodeId: null,
  expandedNodeId: null,
  visibleClusters: new Set(ALL_CLUSTERS),
  searchQuery: "",
  searchResults: [],
  is3DUnlocked: false,
  showGatePrompt: false,
  focusLevel: 1,
  focusedClientId: null,
  focusedProjectId: null,
  cameraTarget: null,
  cameraDistance: 20,
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

  focusClient: (clientId, position) =>
    set({
      focusLevel: 2,
      focusedClientId: clientId,
      focusedProjectId: null,
      // Do NOT set selectedNodeId — focusing IS the click result.
      // Setting selectedNodeId would trigger the info panel, which
      // overlaps the camera fly-to and obscures the projects.
      selectedNodeId: null,
      expandedNodeId: null,
      cameraTarget: position,
      cameraDistance: 8,
    }),

  focusProject: (projectId, position) =>
    set({
      focusLevel: 3,
      focusedProjectId: projectId,
      selectedNodeId: null,
      expandedNodeId: null,
      cameraTarget: position,
      cameraDistance: 4,
    }),

  focusBack: () =>
    set((state) => {
      if (state.focusLevel === 3 && state.focusedClientId) {
        // Back to client level — read client's live position for camera target
        const clientPos = liveNodePositions.get(state.focusedClientId);
        return {
          focusLevel: 2,
          focusedProjectId: null,
          selectedNodeId: state.focusedClientId,
          expandedNodeId: null,
          cameraTarget: clientPos
            ? { x: clientPos.x, y: clientPos.y, z: clientPos.z }
            : { x: 0, y: 0, z: 0 },
          cameraDistance: 8,
        };
      }
      if (state.focusLevel === 2) {
        // Back to overview
        return {
          focusLevel: 1,
          focusedClientId: null,
          focusedProjectId: null,
          selectedNodeId: null,
          expandedNodeId: null,
          cameraTarget: { x: 0, y: 0, z: 0 },
          cameraDistance: 20,
        };
      }
      return {};
    }),

  clearCameraTarget: () => set({ cameraTarget: null }),
}));
