"use client";

import { useAuthStore } from "@/lib/store/auth-store";

/**
 * useSetupGate — checks whether the current user has completed
 * web onboarding (identity, company, starfield).
 *
 * Returns:
 * - `isComplete` — true when web onboarding is done
 * - `needsWebSetup` — true when user should be redirected to /setup
 * - `missingSteps` — granular steps missing (for interception modal)
 * - `needsEmployeeOnboarding` — true for invited users who haven't
 *   completed employee setup (handled separately)
 */
export function useSetupGate() {
  const { currentUser } = useAuthStore();

  // Web onboarding completed = authoritative flag
  const webComplete = !!currentUser?.onboardingCompleted?.web;

  // Granular missing steps (for SetupInterceptionModal on action-gated pages)
  const missingSteps: ("identity" | "company")[] = [];
  const progress = currentUser?.setupProgress;

  const hasIdentity =
    progress?.steps?.identity ||
    (currentUser?.firstName && currentUser?.lastName);
  if (!hasIdentity) missingSteps.push("identity");

  const hasCompany =
    progress?.steps?.company ||
    !!currentUser?.companyId;
  if (!hasCompany) missingSteps.push("company");

  // Employee onboarding: required if user joined via invite
  const joinedViaInvite =
    !!currentUser?.companyId && !progress?.steps?.company;
  const needsEmployeeOnboarding =
    joinedViaInvite && !progress?.steps?.employee_onboarding;

  return {
    isComplete: webComplete,
    needsWebSetup: !webComplete,
    missingSteps,
    needsEmployeeOnboarding,
  };
}
