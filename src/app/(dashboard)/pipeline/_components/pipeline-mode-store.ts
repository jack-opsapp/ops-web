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
  openDetailPanel: (
    opportunityId: string,
    options?: { assignIntent?: boolean }
  ) => void;
  closeDetailPanel: () => void;
  setDetailPanelActiveTab: (tab: DetailTabId) => void;
  setSortBy: (sortBy: SortOption) => void;
  setStageSortBy: (stage: OpportunityStage, sortBy: SortOption) => void;
  /** Clear the one-shot assign-intent flag once AssigneeField has consumed it. */
  consumeAssignIntent: () => void;
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

/**
 * Persist migration for {@link usePipelineModeStore}.
 *
 * Runs against the already-rehydrated state — the storage reviver
 * ({@link mapReviver}) has reconstructed `stageSortOverrides` into a `Map` by
 * the time Zustand hands the state to `migrate`. Coerces the retired
 * `"spatial"` mode to `"focused"` and passes every other persisted field
 * through untouched (including the `Map`, which is never stringified here).
 *
 * Defensive against missing or malformed payloads: never throws, and falls
 * back to a minimal `{ mode: "focused" }` so the store's own defaults fill in
 * the rest of the state.
 *
 * @param persistedState The rehydrated, partialized state read from storage.
 * @param _version The persisted schema version. Unused — coercion keys off the
 *   value of `mode`, not the version number, so any prior version is handled.
 */
export function migratePipelineModeState(
  persistedState: unknown,
  _version: number
): Partial<PipelineModeState> {
  if (persistedState === null || typeof persistedState !== "object") {
    return { mode: "focused" };
  }

  const state = persistedState as Partial<PipelineModeState>;

  if (state.mode === ("spatial" as PipelineMode)) {
    return { ...state, mode: "focused" };
  }

  return state;
}

export const usePipelineModeStore = create<Store>()(
  persist(
    (set) => ({
      mode: "focused",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "overview",
      sortBy: "value",
      stageSortOverrides: new Map(),
      assignIntentOpportunityId: null,
      setMode: (mode) =>
        set((state) => {
          dispatchModeWillChange(state.mode, mode);
          return { mode };
        }),
      toggleMode: () =>
        set((state) => ({
          mode: (() => {
            const nextMode: PipelineMode =
              state.mode === "focused" ? "table" : "focused";
            dispatchModeWillChange(state.mode, nextMode);
            return nextMode;
          })(),
        })),
      setFocusedStage: (focusedStage) => set({ focusedStage }),
      openDetailPanel: (opportunityId, options) =>
        set({
          detailPanelOpportunityId: opportunityId,
          // Arm the one-shot only for the "Assign to" entry point; a plain open
          // clears any stale intent so the picker never auto-opens unexpectedly.
          assignIntentOpportunityId: options?.assignIntent
            ? opportunityId
            : null,
        }),
      closeDetailPanel: () =>
        set({
          detailPanelOpportunityId: null,
          assignIntentOpportunityId: null,
        }),
      consumeAssignIntent: () =>
        set((state) =>
          state.assignIntentOpportunityId === null
            ? state
            : { assignIntentOpportunityId: null }
        ),
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
      name: "opsPipeline:v4",
      version: 4,
      storage: createJSONStorage(() => localStorage, {
        replacer: mapReplacer,
        reviver: mapReviver,
      }),
      migrate: migratePipelineModeState,
      partialize: (state) => ({
        mode: state.mode,
        focusedStage: state.focusedStage,
        sortBy: state.sortBy,
        stageSortOverrides: state.stageSortOverrides,
      }),
    }
  )
);
