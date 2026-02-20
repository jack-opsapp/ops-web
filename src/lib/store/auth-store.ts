/**
 * OPS Web - Auth Store
 *
 * Zustand store for authentication state.
 * Persists auth state to localStorage for session survival.
 *
 * Role detection: company.adminIds FIRST, then employeeType, then default fieldCrew.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { User, Company } from "../types/models";
import { UserRole } from "../types/models";
import { getBubbleClient } from "../api/bubble-client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthState {
  // State
  currentUser: User | null;
  company: Company | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: UserRole;

  // Actions
  login: (user: User, token: string) => void;
  logout: () => void;
  setUser: (user: User) => void;
  setCompany: (company: Company) => void;
  setToken: (token: string) => void;
  setLoading: (loading: boolean) => void;
  setFirebaseAuth: (authenticated: boolean) => void;
  updateRole: () => void;
  hydrate: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state — isLoading starts true to prevent redirect flash
      // before Zustand hydration and AuthProvider resolve auth state
      currentUser: null,
      company: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      role: UserRole.FieldCrew,

      // Login: set user, token, and update auth state
      login: (user: User, token: string) => {
        // Update the API client with the new token
        getBubbleClient().setAuthToken(token);

        // Set auth cookie so Next.js middleware knows we're authenticated
        if (typeof document !== "undefined") {
          document.cookie = "ops-auth-token=1; path=/; max-age=2592000; SameSite=Lax";
        }

        set({
          currentUser: user,
          token,
          isAuthenticated: true,
          role: user.role,
          isLoading: false,
        });
      },

      // Logout: clear all auth state
      logout: () => {
        getBubbleClient().clearAuthToken();

        set({
          currentUser: null,
          company: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          role: UserRole.FieldCrew,
        });
      },

      // Update user data (e.g., after profile update or sync)
      setUser: (user: User) => {
        set({ currentUser: user, role: user.role });
      },

      // Set company data (fetched separately from user)
      setCompany: (company: Company) => {
        set({ company });
        // Re-evaluate role with company admin IDs
        get().updateRole();
      },

      // Set auth token (e.g., after token refresh)
      setToken: (token: string) => {
        getBubbleClient().setAuthToken(token);
        set({ token });
      },

      // Set loading state
      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      // Handle Firebase auth state changes (from AuthProvider)
      setFirebaseAuth: (authenticated: boolean) => {
        if (authenticated) {
          set({ isAuthenticated: true, isLoading: false });
        } else {
          // Only clear auth if there's no Bubble token keeping us logged in.
          // Email/password login uses Bubble tokens as primary auth —
          // Firebase auth is optional for that flow.
          const { token } = get();
          if (token) {
            // Bubble token exists — keep the session alive
            set({ isLoading: false });
          } else {
            // No Bubble token either — fully signed out
            getBubbleClient().clearAuthToken();
            set({
              currentUser: null,
              company: null,
              token: null,
              isAuthenticated: false,
              isLoading: false,
              role: UserRole.FieldCrew,
            });
          }
        }
      },

      // Re-evaluate role using iOS priority logic:
      // 1. user.id IN company.adminIds[] -> Admin
      // 2. user.employeeType -> mapped role
      // 3. default -> FieldCrew
      updateRole: () => {
        const { currentUser, company } = get();
        if (!currentUser) return;

        let role = UserRole.FieldCrew;

        // Priority 1: Check company admin IDs
        if (company?.adminIds?.includes(currentUser.id)) {
          role = UserRole.Admin;
        }
        // Priority 2: Use user's existing role (from employeeType)
        else if (currentUser.role) {
          role = currentUser.role;
        }

        set({
          role,
          currentUser: { ...currentUser, role, isCompanyAdmin: role === UserRole.Admin },
        });
      },

      // Hydrate auth state from persisted storage
      hydrate: () => {
        const { token } = get();
        if (token) {
          getBubbleClient().setAuthToken(token);
        }
      },
    }),
    {
      name: "ops-auth-storage",
      storage: createJSONStorage(() => {
        // Use localStorage in browser, no-op in SSR
        if (typeof window !== "undefined") {
          return localStorage;
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      partialize: (state) => ({
        currentUser: state.currentUser,
        company: state.company,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        role: state.role,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          // Re-set the API client token after rehydration
          if (state?.token) {
            getBubbleClient().setAuthToken(state.token);
          }
        };
      },
    }
  )
);

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Check if user has admin role */
export const selectIsAdmin = (state: AuthState) =>
  state.role === UserRole.Admin;

/** Check if user has office crew or admin role */
export const selectIsOfficeOrAdmin = (state: AuthState) =>
  state.role === UserRole.Admin || state.role === UserRole.OfficeCrew;

/** Check if user is field crew */
export const selectIsFieldCrew = (state: AuthState) =>
  state.role === UserRole.FieldCrew;

/** Get the company ID */
export const selectCompanyId = (state: AuthState) =>
  state.company?.id ?? null;

/** Get the user ID */
export const selectUserId = (state: AuthState) =>
  state.currentUser?.id ?? null;

export default useAuthStore;
