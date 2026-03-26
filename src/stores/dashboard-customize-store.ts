"use client";

import { create } from "zustand";

interface DashboardCustomizeState {
  /** Whether the user is actively in dashboard customize/edit mode */
  isCustomizing: boolean;
  setIsCustomizing: (v: boolean) => void;
  /** Whether the widget tray (catalog) is currently open */
  trayOpen: boolean;
  setTrayOpen: (v: boolean) => void;
  /** Whether a full-screen wizard is open (hides FAB, suppresses global shortcuts) */
  wizardOpen: boolean;
  setWizardOpen: (v: boolean) => void;
}

export const useDashboardCustomizeStore = create<DashboardCustomizeState>((set) => ({
  isCustomizing: false,
  setIsCustomizing: (v) => set({ isCustomizing: v }),
  trayOpen: false,
  setTrayOpen: (v) => set({ trayOpen: v }),
  wizardOpen: false,
  setWizardOpen: (v) => set({ wizardOpen: v }),
}));
