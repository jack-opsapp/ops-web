/**
 * useSetupGate — onboarding routing decision.
 *
 * Guards the regression where a fresh, company-less user was routed straight
 * into company setup (/setup), skipping the documented /account-type decision
 * screen ("Run a Crew" vs "Join a Crew"). The intended flow is:
 *   register → /account-type → (Run a Crew → /setup) | (Join a Crew → /employee-setup)
 *
 * `onboardingRoute` is the single source of truth consumed by both the
 * (auth) AuthRouteGate and the DashboardLayout gate, so the destination can
 * never drift between the two redirect sites.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSetupGate } from "@/hooks/useSetupGate";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-1",
    firstName: "Jordan",
    lastName: "Reyes",
    email: "jordan@test.co",
    phone: null,
    profileImageURL: null,
    role: UserRole.Unassigned,
    companyId: null,
    userType: null,
    latitude: null,
    longitude: null,
    locationName: null,
    homeAddress: null,
    clientId: null,
    isActive: true,
    userColor: null,
    devPermission: false,
    onboardingCompleted: {},
    hasCompletedAppTutorial: false,
    isCompanyAdmin: false,
    specialPermissions: [],
    setupProgress: null,
    stripeCustomerId: null,
    deviceToken: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
    ...overrides,
  } as User;
}

beforeEach(() => {
  useAuthStore.setState({
    currentUser: null,
    company: null,
    isAuthenticated: false,
    isLoading: false,
    role: UserRole.Unassigned,
  });
});

describe("useSetupGate — onboardingRoute", () => {
  it("routes a fresh company-less user to /account-type (NOT /setup)", () => {
    // The bug: this user was being sent straight to /setup, skipping the
    // account-type decision screen.
    useAuthStore.setState({
      currentUser: makeUser({ companyId: null, onboardingCompleted: {} }),
    });

    const { result } = renderHook(() => useSetupGate());

    expect(result.current.needsWebSetup).toBe(true);
    expect(result.current.onboardingRoute).toBe("/account-type");
    expect(result.current.onboardingRoute).not.toBe("/setup");
  });

  it("routes an employee (has company, not admin, employee onboarding pending) to /employee-setup", () => {
    useAuthStore.setState({
      currentUser: makeUser({
        companyId: "co-1",
        isCompanyAdmin: false,
        onboardingCompleted: {},
        setupProgress: { steps: {} } as User["setupProgress"],
      }),
    });

    const { result } = renderHook(() => useSetupGate());

    expect(result.current.needsEmployeeOnboarding).toBe(true);
    expect(result.current.onboardingRoute).toBe("/employee-setup");
  });

  it("routes a resuming account holder (has company, web setup incomplete) to /setup", () => {
    // Once a company exists (created on the 'company' step), the admin should
    // resume the employer wizard rather than re-pick an account type.
    useAuthStore.setState({
      currentUser: makeUser({
        companyId: "co-1",
        isCompanyAdmin: true,
        onboardingCompleted: {},
      }),
    });

    const { result } = renderHook(() => useSetupGate());

    expect(result.current.needsWebSetup).toBe(true);
    expect(result.current.onboardingRoute).toBe("/setup");
  });

  it("returns null onboardingRoute when web onboarding is complete", () => {
    useAuthStore.setState({
      currentUser: makeUser({
        companyId: "co-1",
        isCompanyAdmin: true,
        onboardingCompleted: { web: true },
      }),
    });

    const { result } = renderHook(() => useSetupGate());

    expect(result.current.isComplete).toBe(true);
    expect(result.current.onboardingRoute).toBeNull();
  });

  it("does not require onboarding for a completed employee", () => {
    useAuthStore.setState({
      currentUser: makeUser({
        companyId: "co-1",
        isCompanyAdmin: false,
        onboardingCompleted: { web: true },
        setupProgress: { steps: { employee_onboarding: true } } as User["setupProgress"],
      }),
    });

    const { result } = renderHook(() => useSetupGate());

    expect(result.current.needsEmployeeOnboarding).toBe(false);
    expect(result.current.onboardingRoute).toBeNull();
  });
});
