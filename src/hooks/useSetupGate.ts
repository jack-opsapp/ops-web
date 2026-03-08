"use client";

import { useAuthStore } from "@/lib/store/auth-store";

/**
 * useSetupGate — checks whether the current user has completed
 * the required identity and company setup steps.
 *
 * Returns `isComplete` (true when both steps are done) and the
 * list of `missingSteps` that the interception modal should collect.
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

  // Company: skip if user already belongs to a company (e.g. Bubble import)
  const hasCompany =
    progress?.steps?.company ||
    !!currentUser?.companyId;
  if (!hasCompany) missingSteps.push("company");

  return {
    isComplete: missingSteps.length === 0,
    missingSteps,
  };
}
