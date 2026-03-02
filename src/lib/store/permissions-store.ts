/**
 * OPS Web - Permissions Store
 *
 * Zustand store for the current user's resolved permissions.
 * Provides a `can(permission, scope?)` function for fast permission checks.
 *
 * Initialized by AuthProvider after login/session restore.
 * Cleared on logout.
 */

import { create } from "zustand";
import { RolesService } from "@/lib/api/services/roles-service";
import type { PermissionScope } from "@/lib/types/permissions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PermissionState {
  /** Map of permission string → granted scope */
  permissions: Map<string, PermissionScope>;
  /** Current role ID (if assigned) */
  roleId: string | null;
  /** Current role name (for display) */
  roleName: string | null;
  /** Whether permissions are still loading */
  loading: boolean;
  /** Whether permissions have been fetched at least once */
  initialized: boolean;

  /**
   * Check if the current user has a permission.
   *
   * - `can('projects.view')` → true if permission exists (any scope)
   * - `can('projects.view', 'all')` → true only if scope is 'all'
   * - `can('projects.view', 'assigned')` → true if scope is 'all' or 'assigned'
   * - `can('projects.view', 'own')` → true if scope is 'all', 'assigned', or 'own'
   */
  can: (permission: string, requiredScope?: PermissionScope) => boolean;

  /** Fetch and cache the current user's permissions. */
  fetchPermissions: (userId: string) => Promise<void>;

  /** Clear all permissions (on logout). */
  clear: () => void;
}

// ─── Scope Hierarchy ──────────────────────────────────────────────────────────

/** Scope hierarchy: all > assigned > own */
function scopeSatisfies(granted: PermissionScope, required: PermissionScope): boolean {
  if (granted === "all") return true;
  if (granted === "assigned") return required === "assigned" || required === "own";
  if (granted === "own") return required === "own";
  return false;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePermissionStore = create<PermissionState>()((set, get) => ({
  permissions: new Map(),
  roleId: null,
  roleName: null,
  loading: false,
  initialized: false,

  can: (permission: string, requiredScope?: PermissionScope): boolean => {
    const { permissions } = get();
    const granted = permissions.get(permission);
    if (!granted) return false;
    if (!requiredScope) return true;
    return scopeSatisfies(granted, requiredScope);
  },

  fetchPermissions: async (userId: string) => {
    set({ loading: true });

    try {
      const result = await RolesService.fetchUserPermissions(userId);
      set({
        permissions: result.permissions,
        roleId: result.roleId,
        roleName: result.roleName,
        loading: false,
        initialized: true,
      });
    } catch (error) {
      console.error("[PermissionStore] Failed to fetch permissions:", error);
      set({
        permissions: new Map(),
        roleId: null,
        roleName: null,
        loading: false,
        initialized: true,
      });
    }
  },

  clear: () => {
    set({
      permissions: new Map(),
      roleId: null,
      roleName: null,
      loading: false,
      initialized: false,
    });
  },
}));

// ─── Selectors ────────────────────────────────────────────────────────────────

/** Convenience selector: get the `can` function */
export const selectCan = (state: PermissionState) => state.can;

/** Check if permissions are ready */
export const selectPermissionsReady = (state: PermissionState) =>
  state.initialized && !state.loading;

export default usePermissionStore;
