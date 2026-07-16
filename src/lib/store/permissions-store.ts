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
import { ALL_PERMISSIONS, PRESET_ROLE_IDS } from "@/lib/types/permissions";
import {
  isAdminBypass,
  resolveEffectivePermissions,
} from "@/lib/permissions/resolve";
import { useAuthStore } from "@/lib/store/auth-store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PermissionState {
  /** Map of permission string → granted scope */
  permissions: Map<string, PermissionScope>;
  /**
   * Permission keys explicitly configured by the role or an override row.
   * Unlike `permissions`, this retains revokes and inert overrides so legacy
   * compatibility can never replace an authoritative granular decision.
   */
  configuredPermissions: Set<string>;
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
function scopeSatisfies(
  granted: PermissionScope,
  required: PermissionScope
): boolean {
  if (granted === "all") return true;
  if (granted === "assigned")
    return required === "assigned" || required === "own";
  if (granted === "own") return required === "own";
  return false;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePermissionStore = create<PermissionState>()((set, get) => ({
  permissions: new Map(),
  configuredPermissions: new Set(),
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
      // Master bypass — account holder ∪ admin_ids ∪ is_company_admin flag.
      // Single definition shared with the DB functions and the Team access
      // editor (isAdminBypass); the flag was previously missing here, which
      // desynced the client from private.current_user_is_admin().
      const authState = useAuthStore.getState();
      const bypass = isAdminBypass(
        {
          id: userId,
          isCompanyAdmin:
            authState.currentUser?.id === userId
              ? authState.currentUser?.isCompanyAdmin
              : false,
        },
        authState.company
          ? {
              accountHolderId: authState.company.accountHolderId,
              adminIds: authState.company.adminIds,
            }
          : null
      );

      if (bypass) {
        const allPerms = new Map<string, PermissionScope>();
        const configuredPermissions = new Set<string>();
        for (const perm of ALL_PERMISSIONS) {
          allPerms.set(perm, "all");
          configuredPermissions.add(perm);
        }
        set({
          permissions: allPerms,
          configuredPermissions,
          roleId: PRESET_ROLE_IDS.ADMIN,
          roleName: "Admin",
          loading: false,
          initialized: true,
        });
        return;
      }

      // Role grants + own permission exceptions (self-read RLS policy),
      // resolved with the shared iOS-parity semantics.
      const [result, overrides] = await Promise.all([
        RolesService.fetchUserPermissions(userId),
        RolesService.fetchUserOverrides(userId),
      ]);
      const rolePerms = Array.from(result.permissions.entries()).map(
        ([permission, scope]) => ({ permission, scope })
      );
      const configuredPermissions = new Set<string>([
        ...result.permissions.keys(),
        ...overrides.map((override) => override.permission),
      ]);
      set({
        permissions: resolveEffectivePermissions(rolePerms, overrides),
        configuredPermissions,
        roleId: result.roleId,
        roleName: result.roleName,
        loading: false,
        initialized: true,
      });
    } catch (error) {
      console.error("[PermissionStore] Failed to fetch permissions:", error);
      set({
        permissions: new Map(),
        configuredPermissions: new Set(),
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
      configuredPermissions: new Set(),
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

/** Get the effective scope for a permission (null if denied) */
export const selectScope =
  (state: PermissionState) =>
  (permission: string): PermissionScope | null =>
    state.permissions.get(permission) ?? null;

type MutablePipelinePermission = "pipeline.edit" | "pipeline.convert";

/**
 * Canonical client gate for a mutable lead action.
 *
 * A configured granular decision is authoritative, including an explicit
 * revoke or inert override. Legacy `pipeline.manage:all` is considered only
 * when that exact granular action is genuinely absent, matching the database
 * compatibility boundary. Row assignment remains server-enforced.
 */
function canMutateOpportunity(
  state: PermissionState,
  permission: MutablePipelinePermission
): boolean {
  if (state.configuredPermissions.has(permission)) {
    const scope = state.permissions.get(permission);
    return scope === "all" || scope === "assigned";
  }
  return state.can("pipeline.manage", "all");
}

export const selectCanEditOpportunity = (state: PermissionState): boolean =>
  canMutateOpportunity(state, "pipeline.edit");

export const selectCanConvertOpportunity = (state: PermissionState): boolean =>
  canMutateOpportunity(state, "pipeline.convert");

export default usePermissionStore;
