"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WorkType = "recurring" | "emergency" | "project-based" | "single-visit";
export type TrackingPriority = "revenue" | "efficiency" | "customers" | "pipeline";
export type TeamSize = "solo" | "2-5" | "6-10" | "11+";
export type CurrentTool = "quickbooks" | "jobber" | "spreadsheets" | "pen-paper";
export type NeededFeature = "scheduling" | "invoicing" | "leads" | "expenses" | "crew";

interface SetupState {
  currentStep: number;
  workType: WorkType | null;
  trackingPriorities: TrackingPriority[];
  teamSize: TeamSize | null;
  currentTools: CurrentTool[];
  neededFeatures: NeededFeature[];
  isComplete: boolean;
  setCurrentStep: (step: number) => void;
  setWorkType: (type: WorkType) => void;
  toggleTrackingPriority: (priority: TrackingPriority) => void;
  setTeamSize: (size: TeamSize) => void;
  toggleCurrentTool: (tool: CurrentTool) => void;
  toggleNeededFeature: (feature: NeededFeature) => void;
  completeSetup: () => void;
  reset: () => void;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      currentStep: 1,
      workType: null,
      trackingPriorities: [],
      teamSize: null,
      currentTools: [],
      neededFeatures: [],
      isComplete: false,
      setCurrentStep: (currentStep) => set({ currentStep }),
      setWorkType: (workType) => set({ workType }),
      toggleTrackingPriority: (priority) =>
        set((state) => ({
          trackingPriorities: state.trackingPriorities.includes(priority)
            ? state.trackingPriorities.filter((p) => p !== priority)
            : [...state.trackingPriorities, priority],
        })),
      setTeamSize: (teamSize) => set({ teamSize }),
      toggleCurrentTool: (tool) =>
        set((state) => ({
          currentTools: state.currentTools.includes(tool)
            ? state.currentTools.filter((t) => t !== tool)
            : [...state.currentTools, tool],
        })),
      toggleNeededFeature: (feature) =>
        set((state) => ({
          neededFeatures: state.neededFeatures.includes(feature)
            ? state.neededFeatures.filter((f) => f !== feature)
            : [...state.neededFeatures, feature],
        })),
      completeSetup: () => set({ isComplete: true }),
      reset: () =>
        set({
          currentStep: 1,
          workType: null,
          trackingPriorities: [],
          teamSize: null,
          currentTools: [],
          neededFeatures: [],
          isComplete: false,
        }),
    }),
    {
      name: "ops-setup-state",
    }
  )
);
