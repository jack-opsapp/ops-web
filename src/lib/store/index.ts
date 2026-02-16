/**
 * OPS Web - Stores Barrel Export
 */

export { useAuthStore, selectIsAdmin, selectIsOfficeOrAdmin, selectIsFieldCrew, selectCompanyId, selectUserId } from "./auth-store";
export type { AuthState } from "./auth-store";

export { useUIStore, selectHasSelection, selectTotalSelectionCount } from "./ui-store";
export type { UIState, ActiveView, ProjectViewMode, ThemeMode } from "./ui-store";

export { useSetupStore, selectSetupProgress, selectIsStepComplete, selectCanProceed } from "./setup-store";
export type { SetupState, SetupStep, SurveyAnswers, DashboardConfig, FeatureActivation } from "./setup-store";
