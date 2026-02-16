/**
 * OPS Web - Setup Store
 *
 * Zustand store for the onboarding setup flow.
 * Tracks survey answers, dashboard configuration, and feature activation.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SetupStep =
  | "welcome"
  | "company-info"
  | "industry"
  | "team-size"
  | "features"
  | "dashboard-config"
  | "invite-team"
  | "complete";

export interface SurveyAnswers {
  /** Company industry/trade */
  industry: string | null;
  /** Company size bracket */
  companySize: string | null;
  /** How old is the company */
  companyAge: string | null;
  /** How they heard about OPS */
  referralMethod: string | null;
  /** Custom referral text */
  referralOther: string | null;
  /** What features they want to try first */
  priorityFeatures: string[];
  /** Whether they have an existing website */
  hasWebsite: boolean | null;
}

export interface DashboardConfig {
  /** Which widgets to show on the dashboard */
  enabledWidgets: string[];
  /** Widget layout positions */
  widgetLayout: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Default project view mode */
  defaultProjectView: "board" | "list" | "calendar";
  /** Whether to show the calendar widget */
  showCalendar: boolean;
  /** Whether to show the team activity widget */
  showTeamActivity: boolean;
  /** Whether to show project statistics */
  showStats: boolean;
}

export interface FeatureActivation {
  /** Enable task scheduling */
  scheduling: boolean;
  /** Enable team management */
  teamManagement: boolean;
  /** Enable client management */
  clientManagement: boolean;
  /** Enable project photos */
  projectPhotos: boolean;
  /** Enable reporting/analytics */
  reporting: boolean;
  /** Enable calendar integration */
  calendarIntegration: boolean;
}

export interface SetupState {
  // State
  currentStep: SetupStep;
  completedSteps: SetupStep[];
  surveyAnswers: SurveyAnswers;
  dashboardConfig: DashboardConfig;
  featureActivation: FeatureActivation;
  isSetupComplete: boolean;
  invitedEmails: string[];

  // Actions
  setCurrentStep: (step: SetupStep) => void;
  markStepComplete: (step: SetupStep) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;

  // Survey
  setSurveyAnswer: <K extends keyof SurveyAnswers>(
    key: K,
    value: SurveyAnswers[K]
  ) => void;
  setSurveyAnswers: (answers: Partial<SurveyAnswers>) => void;

  // Dashboard config
  setDashboardConfig: (config: Partial<DashboardConfig>) => void;
  toggleWidget: (widgetId: string) => void;

  // Feature activation
  setFeatureActivation: (features: Partial<FeatureActivation>) => void;
  toggleFeature: (feature: keyof FeatureActivation) => void;

  // Team invites
  addInvitedEmail: (email: string) => void;
  removeInvitedEmail: (email: string) => void;

  // Complete setup
  completeSetup: () => void;
  resetSetup: () => void;
}

// ─── Step Order ───────────────────────────────────────────────────────────────

const STEP_ORDER: SetupStep[] = [
  "welcome",
  "company-info",
  "industry",
  "team-size",
  "features",
  "dashboard-config",
  "invite-team",
  "complete",
];

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SURVEY_ANSWERS: SurveyAnswers = {
  industry: null,
  companySize: null,
  companyAge: null,
  referralMethod: null,
  referralOther: null,
  priorityFeatures: [],
  hasWebsite: null,
};

const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  enabledWidgets: [
    "project-overview",
    "today-schedule",
    "team-status",
    "recent-activity",
  ],
  widgetLayout: {},
  defaultProjectView: "board",
  showCalendar: true,
  showTeamActivity: true,
  showStats: true,
};

const DEFAULT_FEATURE_ACTIVATION: FeatureActivation = {
  scheduling: true,
  teamManagement: true,
  clientManagement: true,
  projectPhotos: true,
  reporting: false,
  calendarIntegration: true,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSetupStore = create<SetupState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentStep: "welcome",
      completedSteps: [],
      surveyAnswers: { ...DEFAULT_SURVEY_ANSWERS },
      dashboardConfig: { ...DEFAULT_DASHBOARD_CONFIG },
      featureActivation: { ...DEFAULT_FEATURE_ACTIVATION },
      isSetupComplete: false,
      invitedEmails: [],

      // Step navigation
      setCurrentStep: (step) => set({ currentStep: step }),

      markStepComplete: (step) =>
        set((state) => ({
          completedSteps: state.completedSteps.includes(step)
            ? state.completedSteps
            : [...state.completedSteps, step],
        })),

      goToNextStep: () => {
        const { currentStep } = get();
        const currentIndex = STEP_ORDER.indexOf(currentStep);
        if (currentIndex < STEP_ORDER.length - 1) {
          get().markStepComplete(currentStep);
          set({ currentStep: STEP_ORDER[currentIndex + 1] });
        }
      },

      goToPreviousStep: () => {
        const { currentStep } = get();
        const currentIndex = STEP_ORDER.indexOf(currentStep);
        if (currentIndex > 0) {
          set({ currentStep: STEP_ORDER[currentIndex - 1] });
        }
      },

      // Survey answers
      setSurveyAnswer: (key, value) =>
        set((state) => ({
          surveyAnswers: { ...state.surveyAnswers, [key]: value },
        })),

      setSurveyAnswers: (answers) =>
        set((state) => ({
          surveyAnswers: { ...state.surveyAnswers, ...answers },
        })),

      // Dashboard config
      setDashboardConfig: (config) =>
        set((state) => ({
          dashboardConfig: { ...state.dashboardConfig, ...config },
        })),

      toggleWidget: (widgetId) =>
        set((state) => {
          const current = state.dashboardConfig.enabledWidgets;
          const updated = current.includes(widgetId)
            ? current.filter((id) => id !== widgetId)
            : [...current, widgetId];
          return {
            dashboardConfig: {
              ...state.dashboardConfig,
              enabledWidgets: updated,
            },
          };
        }),

      // Feature activation
      setFeatureActivation: (features) =>
        set((state) => ({
          featureActivation: { ...state.featureActivation, ...features },
        })),

      toggleFeature: (feature) =>
        set((state) => ({
          featureActivation: {
            ...state.featureActivation,
            [feature]: !state.featureActivation[feature],
          },
        })),

      // Team invites
      addInvitedEmail: (email) =>
        set((state) => ({
          invitedEmails: state.invitedEmails.includes(email)
            ? state.invitedEmails
            : [...state.invitedEmails, email],
        })),

      removeInvitedEmail: (email) =>
        set((state) => ({
          invitedEmails: state.invitedEmails.filter((e) => e !== email),
        })),

      // Setup completion
      completeSetup: () => {
        get().markStepComplete("complete");
        set({
          currentStep: "complete",
          isSetupComplete: true,
        });
      },

      resetSetup: () =>
        set({
          currentStep: "welcome",
          completedSteps: [],
          surveyAnswers: { ...DEFAULT_SURVEY_ANSWERS },
          dashboardConfig: { ...DEFAULT_DASHBOARD_CONFIG },
          featureActivation: { ...DEFAULT_FEATURE_ACTIVATION },
          isSetupComplete: false,
          invitedEmails: [],
        }),
    }),
    {
      name: "ops-setup-storage",
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") {
          return localStorage;
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
    }
  )
);

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Get progress percentage (0-100) */
export const selectSetupProgress = (state: SetupState) => {
  const totalSteps = STEP_ORDER.length - 1; // Exclude "complete" from count
  const completed = state.completedSteps.length;
  return Math.round((completed / totalSteps) * 100);
};

/** Check if a specific step is completed */
export const selectIsStepComplete =
  (step: SetupStep) => (state: SetupState) =>
    state.completedSteps.includes(step);

/** Check if current step can proceed to next */
export const selectCanProceed = (state: SetupState) => {
  const { currentStep, surveyAnswers } = state;

  switch (currentStep) {
    case "welcome":
      return true;
    case "company-info":
      return true; // Company info is fetched from API
    case "industry":
      return !!surveyAnswers.industry;
    case "team-size":
      return !!surveyAnswers.companySize;
    case "features":
      return true; // Features have defaults
    case "dashboard-config":
      return true; // Dashboard has defaults
    case "invite-team":
      return true; // Inviting is optional
    case "complete":
      return false;
    default:
      return false;
  }
};

export default useSetupStore;
