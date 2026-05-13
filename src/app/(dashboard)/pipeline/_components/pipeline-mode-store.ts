"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { OpportunityStage } from "@/lib/types/pipeline";
import type {
  DetailTabId,
  PipelineMode,
  PipelineModeState,
  SortOption,
} from "./pipeline-mode-types";

type PipelineModeActions = {
  setMode: (mode: PipelineMode) => void;
  toggleMode: () => void;
  setFocusedStage: (stage: OpportunityStage) => void;
  openDetailPanel: (opportunityId: string) => void;
  closeDetailPanel: () => void;
  setDetailPanelActiveTab: (tab: DetailTabId) => void;
  setSortBy: (sortBy: SortOption) => void;
  setStageSortBy: (stage: OpportunityStage, sortBy: SortOption) => void;
  resetLayout: () => void;
};

type Store = PipelineModeState & PipelineModeActions;

export const PIPELINE_MODE_WILL_CHANGE_EVENT = "pipeline:mode-will-change";

export type PipelineModeWillChangeDetail = {
  from: PipelineMode;
  to: PipelineMode;
};

function dispatchModeWillChange(from: PipelineMode, to: PipelineMode): void {
  if (from === to) return;
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<PipelineModeWillChangeDetail>(
      PIPELINE_MODE_WILL_CHANGE_EVENT,
      {
        detail: { from, to },
      }
    )
  );
}

const mapReplacer = (_key: string, value: unknown) =>
  value instanceof Map ? { __map: Array.from(value.entries()) } : value;

const mapReviver = (_key: string, value: unknown) => {
  if (value && typeof value === "object" && "__map" in value) {
    return new Map((value as { __map: [OpportunityStage, SortOption][] }).__map);
  }

  return value;
};

export const usePipelineModeStore = create<Store>()(
  persist(
    (set) => ({
      mode: "focused",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
      setMode: (mode) =>
        set((state) => {
          dispatchModeWillChange(state.mode, mode);
          return { mode };
        }),
      toggleMode: () =>
        set((state) => ({
          mode: (() => {
            const nextMode =
              state.mode === "focused" ? "spatial" : "focused";
            dispatchModeWillChange(state.mode, nextMode);
            return nextMode;
          })(),
        })),
      setFocusedStage: (focusedStage) => set({ focusedStage }),
      openDetailPanel: (opportunityId) =>
        set({ detailPanelOpportunityId: opportunityId }),
      closeDetailPanel: () => set({ detailPanelOpportunityId: null }),
      setDetailPanelActiveTab: (detailPanelActiveTab) =>
        set({ detailPanelActiveTab }),
      setSortBy: (sortBy) => set({ sortBy }),
      setStageSortBy: (stage, sortBy) =>
        set((state) => {
          const next = new Map(state.stageSortOverrides);
          next.set(stage, sortBy);
          return { stageSortOverrides: next };
        }),
      resetLayout: () =>
        set({ sortBy: "value", stageSortOverrides: new Map() }),
    }),
    {
      name: "opsPipeline:v3",
      storage: createJSONStorage(() => localStorage, {
        replacer: mapReplacer,
        reviver: mapReviver,
      }),
      partialize: (state) => ({
        mode: state.mode,
        focusedStage: state.focusedStage,
        sortBy: state.sortBy,
        stageSortOverrides: state.stageSortOverrides,
      }),
    }
  )
);
