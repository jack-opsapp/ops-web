"use client";

// Persisted client store for the catalog-setup live-building canvas.
//
// A THIN wrapper over the pure `stagingReducer` (src/lib/catalog-setup/
// staging-reducer.ts) — all the staging logic lives in the reducer; this store
// only owns persistence, the current rail step, and the hydration gate. Mirrors
// the proven `useSetupStore` pattern (src/stores/setup-store.ts): `persist`
// middleware, a distinct storage key, a `_hydrated` flag set on rehydrate, and
// `reset()`.
//
// Persistence holds the in-progress canvas across a refresh so the owner can
// "pick up where you left off" — nothing is committed to the catalog until
// build-it, so an abandoned session leaves zero half-built rows (spec §11).

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  stagingReducer,
  initialStagingState,
  type StagingAction,
} from "@/lib/catalog-setup/staging-reducer";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";
import type { WizardStep } from "@/lib/catalog-setup/step-machine";

/** First step the rail lands on (spec §5 — SELL is always present and first). */
const INITIAL_STEP: WizardStep = "sell";

interface CatalogSetupState {
  cards: StagingCard[];
  currentStep: WizardStep;
  /** false until the persist middleware finishes rehydrating from storage. */
  _hydrated: boolean;
  /** Apply a pure staging action through the reducer. */
  dispatch: (action: StagingAction) => void;
  /** Move the rail to an explicit step. */
  setStep: (step: WizardStep) => void;
  /** Clear the canvas and return the rail to the first step. */
  reset: () => void;
}

export const useCatalogSetupStore = create<CatalogSetupState>()(
  persist(
    (set, get) => ({
      cards: initialStagingState.cards,
      currentStep: INITIAL_STEP,
      _hydrated: false,
      dispatch: (action) => {
        const next = stagingReducer({ cards: get().cards }, action);
        set({ cards: next.cards });
      },
      setStep: (currentStep) => set({ currentStep }),
      reset: () =>
        set({ cards: initialStagingState.cards, currentStep: INITIAL_STEP }),
    }),
    {
      name: "ops-catalog-setup-state",
      // Persist only the resumable canvas + rail position — never the
      // action methods or the transient hydration flag.
      partialize: (s) => ({ cards: s.cards, currentStep: s.currentStep }),
      onRehydrateStorage: () => () => {
        useCatalogSetupStore.setState({ _hydrated: true });
      },
    },
  ),
);
