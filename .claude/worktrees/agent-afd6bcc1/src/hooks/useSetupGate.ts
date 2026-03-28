"use client";

import { useAuthStore } from "@/lib/store/auth-store";

/**
 * useSetupGate — determines which onboarding flow (if any) the current user needs.
 *
 * Two distinct paths:
 *   - Employers (isCompanyAdmin): identity → company → starfield (/setup)
 *   - Employees (!isCompanyAdmin, has companyId): profile → phone → emergency → notifications (/employee-setup)
 *
 * Returns:
 * - `isComplete` — true when all required onboarding is done
 * - `needsWebSetup` — true when EMPLOYER should be redirected to /setup
 * - `needsEmployeeOnboarding` — true when EMPLOYEE should be redirected to /employee-setup
 * - `missingSteps` — granular steps missing (for SetupInterceptionModal on action-gated pages)
 */
export function useSetupGate() {
  const { currentUser } = useAuthStore();

  // Web onboarding completed = authoritative flag (set by both /api/setup/complete and /api/employee-setup/complete)
  const webComplete = !!currentUser?.onboardingCompleted?.web;

  // Determine user type
  const isEmployee = !!currentUser?.companyId && !currentUser?.isCompanyAdmin;

  // Employee onboarding: required if employee hasn't completed employee setup
  const needsEmployeeOnboarding =
    isEmployee &&
    !webComplete &&
    !currentUser?.setupProgress?.steps?.employee_onboarding;

  // Employer web setup: required if employer (or no-company user) hasn't completed web onboarding
  const needsWebSetup = !webComplete && !isEmployee;

  // Granular missing steps (for SetupInterceptionModal on action-gated pages)
  // Only relevant for employers — employees don't go through identity/company steps
  const missingSteps: ("identity" | "company")[] = [];
  if (!isEmployee) {
    const progress = currentUser?.setupProgress;

    const hasIdentity =
      progress?.steps?.identity ||
      (currentUser?.firstName && currentUser?.lastName);
    if (!hasIdentity) missingSteps.push("identity");

    const hasCompany =
      progress?.steps?.company ||
      !!currentUser?.companyId;
    if (!hasCompany) missingSteps.push("company");
  }

  return {
    isComplete: webComplete,
    needsWebSetup,
    missingSteps,
    needsEmployeeOnboarding,
  };
}
