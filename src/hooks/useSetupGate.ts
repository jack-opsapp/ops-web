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

  if (!progress?.steps?.identity) missingSteps.push("identity");
  if (!progress?.steps?.company) missingSteps.push("company");

  return {
    isComplete: missingSteps.length === 0,
    missingSteps,
  };
}
