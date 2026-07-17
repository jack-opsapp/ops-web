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
import type { PermissionScope } from "@/lib/types/permissions";

/**
 * How a permission refresh treats the in-flight grants:
 * - `"revoke-first"` drops every grant synchronously before the canonical
 *   refresh runs — the fail-closed posture for confirmed revocations, sign-in,
 *   and user-switch, so a stale admin session cannot act during the gap.
 * - `"hold"` keeps the current grants until the refresh settles — for the boot
 *   rehydrate and realtime reconnect paths, where an unverified but still-valid
 *   session must not be transiently stripped. A failed refresh still fails
 *   closed (grants cleared), exactly as `revoke-first` does.
 */
export type PermissionRefreshMode = "revoke-first" | "hold";
import { ALL_PERMISSIONS, PRESET_ROLE_IDS } from "@/lib/types/permissions";
import {
  isAdminBypass,
  resolveEffectivePermissions,
} from "@/lib/permissions/resolve";
import { useAuthStore } from "@/lib/store/auth-store";
import { effectivePipelineScope } from "@/lib/permissions/lead-access-policy";

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

  /**
   * Fetch and cache the current user's permissions.
   *
   * `options.mode` (default `"revoke-first"`) controls whether the in-flight
   * grants are dropped synchronously before the refresh (`"revoke-first"`) or
   * held until it settles (`"hold"`). See {@link PermissionRefreshMode}. Either
   * way, a failed refresh fails closed.
   */
  fetchPermissions: (
    userId: string,
    options?: { mode?: PermissionRefreshMode }
  ) => Promise<void>;

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

const PIPELINE_SCOPED_COMPAT_PERMISSIONS = new Set([
  "pipeline.create",
  "pipeline.view",
  "pipeline.edit",
  "pipeline.assign",
  "pipeline.convert",
]);

let permissionRefreshGeneration = 0;

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePermissionStore = create<PermissionState>()((set, get) => ({
  permissions: new Map(),
  configuredPermissions: new Set(),
  roleId: null,
  roleName: null,
  loading: false,
  initialized: false,

  can: (permission: string, requiredScope?: PermissionScope): boolean => {
    const { permissions, configuredPermissions } = get();
    let granted = permissions.get(permission);

    // Transitional pipeline compatibility is centralized here so navigation,
    // queries, and action gates cannot drift. Any explicit granular decision
    // (including a revoke or inert scope) wins. Only a genuinely absent key may
    // inherit legacy pipeline.manage:all.
    if (PIPELINE_SCOPED_COMPAT_PERMISSIONS.has(permission)) {
      if (configuredPermissions.has(permission)) {
        if (granted !== "all" && granted !== "assigned") return false;
        if (permission === "pipeline.create" && granted !== "all") return false;
      } else {
        granted =
          permissions.get("pipeline.manage") === "all" ? "all" : undefined;
      }
    }

    if (!granted) return false;
    if (!requiredScope) return true;
    return scopeSatisfies(granted, requiredScope);
  },

  fetchPermissions: async (
    userId: string,
    options?: { mode?: PermissionRefreshMode }
  ) => {
    const mode = options?.mode ?? "revoke-first";
    const refreshGeneration = ++permissionRefreshGeneration;
    if (mode === "revoke-first") {
      // Confirmed-revocation / sign-in / user-switch posture: drop every prior
      // grant synchronously so a stale admin session cannot act while canonical
      // authority is still in flight.
      set({
        permissions: new Map(),
        configuredPermissions: new Set(),
        roleId: null,
        roleName: null,
        loading: true,
      });
    } else {
      // hold: keep the current grants visible while the refresh runs (boot
      // rehydrate / realtime reconnect). The catch below still fails closed on
      // any refresh error, identically to revoke-first.
      set({ loading: true });
    }

    try {
      const [{ RolesService }, { UserService }, { CompanyService }] =
        await Promise.all([
          import("@/lib/api/services/roles-service"),
          import("@/lib/api/services/user-service"),
          import("@/lib/api/services/company-service"),
        ]);

      const authState = useAuthStore.getState();
      if (authState.currentUser?.id !== userId) {
        throw new Error(
          "Permission refresh user does not match active session"
        );
      }

      // Never decide the master bypass from persisted AuthStore authority.
      // Re-read the canonical self row first, then the company referenced by
      // that row. A failure at either boundary is handled by the fail-closed
      // catch below before role grants are considered.
      const canonicalUser = await UserService.fetchUser(userId);
      if (canonicalUser.id !== userId) {
        throw new Error("Canonical permission user mismatch");
      }

      const canonicalCompany = canonicalUser.companyId
        ? await CompanyService.fetchCompany(canonicalUser.companyId)
        : null;
      if (canonicalCompany && canonicalCompany.id !== canonicalUser.companyId) {
        throw new Error("Canonical permission company mismatch");
      }

      // The user may have signed out or switched sessions while the authority
      // reads were pending. Never write the old actor into the new session.
      if (useAuthStore.getState().currentUser?.id !== userId) {
        throw new Error("Active session changed during permission refresh");
      }

      if (refreshGeneration !== permissionRefreshGeneration) return;

      useAuthStore.setState({
        currentUser: canonicalUser,
        company: canonicalCompany,
        role: canonicalUser.role,
      });

      // Master bypass — account holder ∪ admin_ids ∪ is_company_admin flag.
      // Single definition shared with the DB functions and the Team access
      // editor (isAdminBypass). Only the just-refreshed canonical rows may
      // reach this decision.
      const bypass = isAdminBypass(
        {
          id: userId,
          isCompanyAdmin: canonicalUser.isCompanyAdmin,
        },
        canonicalCompany
          ? {
              accountHolderId: canonicalCompany.accountHolderId,
              adminIds: canonicalCompany.adminIds,
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
      if (refreshGeneration !== permissionRefreshGeneration) return;

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
      if (refreshGeneration !== permissionRefreshGeneration) return;

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
    permissionRefreshGeneration += 1;
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

export const selectCanViewOpportunity = (state: PermissionState): boolean =>
  effectivePipelineScope(state, "pipeline.view") !== null;

export const selectCanCreateOpportunity = (state: PermissionState): boolean =>
  effectivePipelineScope(state, "pipeline.create") === "all";

export const selectCanAssignOpportunity = (state: PermissionState): boolean =>
  effectivePipelineScope(state, "pipeline.assign") !== null;

export const selectCanEditOpportunity = (state: PermissionState): boolean =>
  effectivePipelineScope(state, "pipeline.edit") !== null;

export const selectCanConvertOpportunity = (state: PermissionState): boolean =>
  effectivePipelineScope(state, "pipeline.convert") !== null;

export default usePermissionStore;
