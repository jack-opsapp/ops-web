"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PreferencesState {
  showShortcutHints: boolean;
  setShowShortcutHints: (show: boolean) => void;
  toggleShortcutHints: () => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      showShortcutHints: false,
      setShowShortcutHints: (show) => set({ showShortcutHints: show }),
      toggleShortcutHints: () =>
        set((state) => ({ showShortcutHints: !state.showShortcutHints })),
    }),
    { name: "ops-preferences" }
  )
);
