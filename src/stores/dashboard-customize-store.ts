"use client";

import { create } from "zustand";

interface DashboardCustomizeState {
  /** Whether the widget tray (catalog) is currently open */
  trayOpen: boolean;
  setTrayOpen: (v: boolean) => void;
}

export const useDashboardCustomizeStore = create<DashboardCustomizeState>((set) => ({
  trayOpen: false,
  setTrayOpen: (v) => set({ trayOpen: v }),
}));
