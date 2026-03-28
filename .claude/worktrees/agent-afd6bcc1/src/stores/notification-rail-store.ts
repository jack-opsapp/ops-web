"use client";

import { create } from "zustand";

interface NotificationRailState {
  railState: "collapsed" | "expanded";
  modalOpen: boolean;
  expand: () => void;
  collapse: () => void;
  toggleRail: () => void;
  openModal: () => void;
  closeModal: () => void;
}

export const useNotificationRailStore = create<NotificationRailState>()(
  (set) => ({
    railState: "collapsed",
    modalOpen: false,
    expand: () => set({ railState: "expanded" }),
    collapse: () => set({ railState: "collapsed" }),
    toggleRail: () =>
      set((s) => ({
        railState: s.railState === "collapsed" ? "expanded" : "collapsed",
      })),
    openModal: () => set({ modalOpen: true }),
    closeModal: () => set({ modalOpen: false }),
  })
);
