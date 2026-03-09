"use client";

import { useAuthStore } from "@/lib/store/auth-store";

/**
 * useSetupGate — checks whether the current user has completed
 * the required setup steps (identity, company, and employee onboarding).
 *
 * Returns `isComplete` (true when identity + company steps are done),
 * the list of `missingSteps` (for the setup interception modal),
 * and `needsEmployeeOnboarding` (true if user joined via invite
 * and hasn't completed employee setup — handled separately).
 */
export function useSetupGate() {
  const { currentUser } = useAuthStore();

  const missingSteps: ("identity" | "company")[] = [];
  const progress = currentUser?.setupProgress;

  // Identity: skip if user already has first+last name (e.g. Bubble import)
  const hasIdentity =
    progress?.steps?.identity ||
    (currentUser?.firstName && currentUser?.lastName);
  if (!hasIdentity) missingSteps.push("identity");

  // Company: skip if user already belongs to a company (e.g. joined via invite)
  const hasCompany =
    progress?.steps?.company ||
    !!currentUser?.companyId;
  if (!hasCompany) missingSteps.push("company");

  // Employee onboarding: required if user joined via invite
  // (has a company but didn't go through the company creation step)
  const joinedViaInvite =
    !!currentUser?.companyId && !progress?.steps?.company;
  const needsEmployeeOnboarding =
    joinedViaInvite && !progress?.steps?.employee_onboarding;

  return {
    isComplete: missingSteps.length === 0 && !needsEmployeeOnboarding,
    missingSteps,
    needsEmployeeOnboarding,
  };
}
