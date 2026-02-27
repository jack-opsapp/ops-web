"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Widget-compatible types (kept for widget-defaults.ts) ──────────────────

export type WorkType = "recurring" | "emergency" | "project-based" | "single-visit";
export type TrackingPriority = "revenue" | "efficiency" | "customers" | "pipeline";
export type TeamSize = "solo" | "2-5" | "6-10" | "11+";
export type CurrentTool = "quickbooks" | "jobber" | "spreadsheets" | "pen-paper";
export type NeededFeature = "scheduling" | "invoicing" | "leads" | "expenses" | "crew";

// ─── Setup phases ───────────────────────────────────────────────────────────

export type SetupPhase =
  | "identity-1"
  | "identity-2"
  | "starfield"
  | "launching"
  | "complete";

// ─── State ──────────────────────────────────────────────────────────────────

interface SetupState {
  // Phase tracking
  phase: SetupPhase;

  // Identity data (Phase 1)
  firstName: string;
  lastName: string;
  phone: string;
  companyName: string;
  industry: string;
  companySize: string;
  companyAge: string;

  // Starfield answers (Phase 2) — placeholder questions
  starfieldAnswers: Record<string, string | string[]>;

  // Widget customization (derived from starfield answers)
  // Kept for compatibility with existing widget-defaults.ts
  workType: WorkType | null;
  trackingPriorities: TrackingPriority[];
  teamSize: TeamSize | null;
  currentTools: CurrentTool[];
  neededFeatures: NeededFeature[];

  isComplete: boolean;

  // Actions — phase
  setPhase: (phase: SetupPhase) => void;

  // Actions — identity
  setIdentity: (data: Partial<Pick<SetupState, "firstName" | "lastName" | "phone">>) => void;
  setCompanyInfo: (
    data: Partial<Pick<SetupState, "companyName" | "industry" | "companySize" | "companyAge">>
  ) => void;

  // Actions — starfield
  setStarfieldAnswer: (questionId: string, answer: string | string[]) => void;

  // Actions — widget compat (for future starfield → widget mapping)
  setWorkType: (type: WorkType) => void;
  toggleTrackingPriority: (priority: TrackingPriority) => void;
  setTeamSize: (size: TeamSize) => void;
  toggleCurrentTool: (tool: CurrentTool) => void;
  toggleNeededFeature: (feature: NeededFeature) => void;

  // Actions — lifecycle
  completeSetup: () => void;
  reset: () => void;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      // Phase
      phase: "identity-1" as SetupPhase,

      // Identity
      firstName: "",
      lastName: "",
      phone: "",
      companyName: "",
      industry: "",
      companySize: "",
      companyAge: "",

      // Starfield
      starfieldAnswers: {},

      // Widget compat
      workType: null,
      trackingPriorities: [],
      teamSize: null,
      currentTools: [],
      neededFeatures: [],

      isComplete: false,

      // Phase
      setPhase: (phase) => set({ phase }),

      // Identity
      setIdentity: (data) => set(data),
      setCompanyInfo: (data) => set(data),

      // Starfield
      setStarfieldAnswer: (questionId, answer) =>
        set((state) => ({
          starfieldAnswers: { ...state.starfieldAnswers, [questionId]: answer },
        })),

      // Widget compat
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

      // Lifecycle
      completeSetup: () => set({ isComplete: true, phase: "complete" }),
      reset: () =>
        set({
          phase: "identity-1",
          firstName: "",
          lastName: "",
          phone: "",
          companyName: "",
          industry: "",
          companySize: "",
          companyAge: "",
          starfieldAnswers: {},
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
