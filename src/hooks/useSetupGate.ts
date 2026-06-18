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
 * - `onboardingRoute` — the single destination a not-yet-onboarded user belongs at,
 *   or null when onboarding is complete. Both the (auth) AuthRouteGate and the
 *   DashboardLayout gate consume this so the redirect target can never drift.
 *   A company-less user lands on /account-type (the "Run a Crew" vs "Join a Crew"
 *   decision screen) — NOT /setup, which would skip the choice.
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

  // Single source of truth for the onboarding destination. A company-less user
  // must choose an account type first (/account-type); only once a company
  // exists does the employer resume the wizard at /setup.
  const onboardingRoute: string | null = needsEmployeeOnboarding
    ? "/employee-setup"
    : needsWebSetup
      ? currentUser?.companyId
        ? "/setup"
        : "/account-type"
      : null;

  return {
    isComplete: webComplete,
    needsWebSetup,
    missingSteps,
    needsEmployeeOnboarding,
    onboardingRoute,
  };
}
