/**
 * OPS Web - Roles & Permissions Service
 *
 * Reads go straight to Supabase as the Firebase-bridged anon role (company
 * -scoped SELECT policies, migration 20260703120000). WRITES to the RBAC
 * tables (user_roles, role_permissions) go through guarded service-role API
 * routes — anon has no write grant on either table by design.
 */

import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";
import { getIdToken } from "@/lib/firebase/auth";
import {
  PERMISSION_EDITOR_REGISTRY,
  type Role,
  type RolePermission,
  type UserRole,
  type PermissionScope,
} from "@/lib/types/permissions";
import type { OverrideInput } from "@/lib/permissions/resolve";
import type { User } from "@/lib/types/models";
import { getUserFullName } from "@/lib/types/models";
import type {
  EligibleRoleAssignmentTarget,
  RoleAssignmentResolution,
  StrandedRoleAssignment,
} from "./guarded-permission-types";
export type {
  EligibleRoleAssignmentTarget,
  RoleAssignmentResolution,
  StrandedRoleAssignment,
} from "./guarded-permission-types";

export interface RolePermissionSnapshotEntry {
  permission: string;
  scope: PermissionScope;
}

export interface RolePermissionReplacementEntry {
  permission: string;
  scope: PermissionScope | null;
}

export interface ReplaceRolePermissionsInput {
  expectedPermissions: RolePermissionSnapshotEntry[];
  newPermissions: RolePermissionReplacementEntry[];
  assignmentResolutions: RoleAssignmentResolution[];
}

export interface ReplaceRolePermissionsResult {
  ok: true;
  roleId: string;
  permissions: RolePermissionSnapshotEntry[];
  resolvedAssignments: number;
}

export interface RolePermissionFailurePayload {
  code: string;
  currentPermissions?: RolePermissionSnapshotEntry[];
  currentRoleId?: string | null;
  strandedCount?: number;
  stranded?: StrandedRoleAssignment[];
  eligibleAssignees?: EligibleRoleAssignmentTarget[];
  opportunity_id?: string;
  assigned_to?: string | null;
  assignment_version?: number | null;
}

export interface ReplaceUserRoleInput {
  expectedRoleId: string | null;
  newRoleId: string | null;
  assignmentResolutions: RoleAssignmentResolution[];
}

export interface ReplaceUserRoleResult {
  ok: true;
  userId: string;
  roleId: string | null;
  legacyRole: string;
  resolvedAssignments: number;
}

export class UserRoleUpdateError extends Error {
  readonly payload: RolePermissionFailurePayload;
  readonly status: number;

  constructor(status: number, payload: RolePermissionFailurePayload) {
    super(payload.code || `HTTP ${status}`);
    this.name = "UserRoleUpdateError";
    this.status = status;
    this.payload = payload;
  }
}

export class RolePermissionUpdateError extends Error {
  readonly payload: RolePermissionFailurePayload;
  readonly status: number;

  constructor(status: number, payload: RolePermissionFailurePayload) {
    super(payload.code || `HTTP ${status}`);
    this.name = "RolePermissionUpdateError";
    this.status = status;
    this.payload = payload;
  }
}

async function replaceRolePermissionsRoute(
  roleId: string,
  input: ReplaceRolePermissionsInput
): Promise<ReplaceRolePermissionsResult> {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("Not authenticated");

  const response = await fetch(
    `/api/roles/${encodeURIComponent(roleId)}/permissions`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    }
  );
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new RolePermissionUpdateError(response.status, {
      ...(payload as unknown as RolePermissionFailurePayload),
      code:
        typeof payload.code === "string"
          ? payload.code
          : "permission_update_failed",
    });
  }

  if (
    payload.ok !== true ||
    payload.roleId !== roleId ||
    !Array.isArray(payload.permissions) ||
    typeof payload.resolvedAssignments !== "number"
  ) {
    throw new RolePermissionUpdateError(500, {
      code: "permission_update_failed",
    });
  }
  return payload as unknown as ReplaceRolePermissionsResult;
}

async function replaceUserRoleRoute(
  userId: string,
  input: ReplaceUserRoleInput
): Promise<ReplaceUserRoleResult> {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("Not authenticated");

  const response = await fetch(
    `/api/users/${encodeURIComponent(userId)}/role`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    }
  );
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new UserRoleUpdateError(response.status, {
      ...(payload as unknown as RolePermissionFailurePayload),
      code:
        typeof payload.code === "string" ? payload.code : "role_update_failed",
    });
  }
  if (
    payload.ok !== true ||
    payload.userId !== userId ||
    !(payload.roleId === null || typeof payload.roleId === "string") ||
    typeof payload.legacyRole !== "string" ||
    typeof payload.resolvedAssignments !== "number"
  ) {
    throw new UserRoleUpdateError(500, { code: "role_update_failed" });
  }
  return payload as unknown as ReplaceUserRoleResult;
}

/** A member's full access picture: role + role grants + per-member overrides. */
export interface MemberAccess {
  roleId: string | null;
  roleName: string | null;
  rolePermissions: RolePermission[];
  overrides: OverrideInput[];
}

// ─── Database ↔ TypeScript Mapping ───────────────────────────────────────────

function mapRoleFromDb(row: Record<string, unknown>): Role {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    isPreset: row.is_preset as boolean,
    companyId: (row.company_id as string) ?? null,
    hierarchy: Number(row.hierarchy),
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function mapPermissionFromDb(row: Record<string, unknown>): RolePermission {
  return {
    roleId: row.role_id as string,
    permission: row.permission as string,
    scope: row.scope as PermissionScope,
  };
}

function mapUserRoleFromDb(row: Record<string, unknown>): UserRole {
  return {
    userId: row.user_id as string,
    roleId: row.role_id as string,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const RolesService = {
  /**
   * Fetch all roles visible to this company (presets + company custom roles).
   */
  async fetchRoles(companyId: string): Promise<Role[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("roles")
      .select("*")
      .or(`is_preset.eq.true,company_id.eq.${companyId}`)
      .order("hierarchy", { ascending: true });

    if (error) throw new Error(`Failed to fetch roles: ${error.message}`);
    return (data ?? []).map(mapRoleFromDb);
  },

  /**
   * Fetch a single role by ID.
   */
  async fetchRole(roleId: string): Promise<Role> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single();

    if (error) throw new Error(`Failed to fetch role: ${error.message}`);
    return mapRoleFromDb(data);
  },

  /**
   * Fetch all permissions for a role.
   */
  async fetchRolePermissions(roleId: string): Promise<RolePermission[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("role_permissions")
      .select("*")
      .eq("role_id", roleId);

    if (error)
      throw new Error(`Failed to fetch role permissions: ${error.message}`);
    return (data ?? []).map(mapPermissionFromDb);
  },

  /**
   * Create a new custom role.
   */
  async createRole(data: {
    name: string;
    description: string | null;
    companyId: string;
    hierarchy: number;
  }): Promise<Role> {
    const supabase = requireSupabase();

    const { data: created, error } = await supabase
      .from("roles")
      .insert({
        name: data.name,
        description: data.description,
        company_id: data.companyId,
        hierarchy: data.hierarchy,
        is_preset: false,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create role: ${error.message}`);
    return mapRoleFromDb(created);
  },

  /**
   * Update a custom role's name/description.
   */
  async updateRole(
    roleId: string,
    data: { name?: string; description?: string | null; hierarchy?: number }
  ): Promise<Role> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (data.name !== undefined) row.name = data.name;
    if (data.description !== undefined) row.description = data.description;
    if (data.hierarchy !== undefined) row.hierarchy = data.hierarchy;

    const { data: updated, error } = await supabase
      .from("roles")
      .update(row)
      .eq("id", roleId)
      .eq("is_preset", false)
      .select()
      .single();

    if (error) throw new Error(`Failed to update role: ${error.message}`);
    return mapRoleFromDb(updated);
  },

  /**
   * Delete a custom role. Fails if users are still assigned.
   */
  async deleteRole(roleId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("roles")
      .delete()
      .eq("id", roleId)
      .eq("is_preset", false);

    if (error) throw new Error(`Failed to delete role: ${error.message}`);
  },

  /**
   * Bulk-replace all permissions for a custom role via the guarded
   * service-role route (anon has no write grant on role_permissions).
   */
  async updateRolePermissions(
    roleId: string,
    input: ReplaceRolePermissionsInput
  ): Promise<ReplaceRolePermissionsResult> {
    return replaceRolePermissionsRoute(roleId, input);
  },

  /**
   * Duplicate a role (preset or custom) into a new custom role.
   */
  async duplicateRole(
    sourceRoleId: string,
    companyId: string,
    newName: string
  ): Promise<Role> {
    // 1. Fetch source role
    const sourceRole = await RolesService.fetchRole(sourceRoleId);

    // 2. Fetch source permissions
    const sourcePermissions =
      await RolesService.fetchRolePermissions(sourceRoleId);

    // 3. Create new role
    const newRole = await RolesService.createRole({
      name: newName,
      description: sourceRole.description
        ? `Based on ${sourceRole.name}. ${sourceRole.description}`
        : `Based on ${sourceRole.name}.`,
      companyId,
      hierarchy: sourceRole.hierarchy,
    });

    // 4. Copy permissions
    if (sourcePermissions.length > 0) {
      const sourceByPermission = new Map(
        sourcePermissions.map((permission) => [
          permission.permission,
          permission.scope,
        ])
      );
      await RolesService.updateRolePermissions(newRole.id, {
        expectedPermissions: [],
        newPermissions: PERMISSION_EDITOR_REGISTRY.map((action) => ({
          permission: action.id,
          scope: sourceByPermission.get(action.id) ?? null,
        })),
        assignmentResolutions: [],
      });
    }

    return newRole;
  },

  /** Atomically replace a member's role and resolve any stranded leads. */
  async replaceUserRole(
    userId: string,
    input: ReplaceUserRoleInput
  ): Promise<ReplaceUserRoleResult> {
    return replaceUserRoleRoute(userId, input);
  },

  /**
   * Fetch all user_roles for a specific role (to show assigned members).
   */
  async fetchRoleMembers(roleId: string): Promise<UserRole[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("user_roles")
      .select("*")
      .eq("role_id", roleId);

    if (error)
      throw new Error(`Failed to fetch role members: ${error.message}`);
    return (data ?? []).map(mapUserRoleFromDb);
  },

  /**
   * Fetch all user_roles for the company (for member counts).
   */
  async fetchAllUserRoles(companyId: string): Promise<UserRole[]> {
    const supabase = requireSupabase();

    // Get user IDs for this company, then fetch their roles
    const { data: companyUsers, error: usersError } = await supabase
      .from("users")
      .select("id")
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (usersError)
      throw new Error(`Failed to fetch company users: ${usersError.message}`);

    const userIds = (companyUsers ?? []).map((u) => u.id);
    if (userIds.length === 0) return [];

    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role_id, created_at")
      .in("user_id", userIds);

    if (error) throw new Error(`Failed to fetch user roles: ${error.message}`);
    return (data ?? []).map(mapUserRoleFromDb);
  },

  /**
   * Fetch a user's permission overrides. Readable by access managers for any
   * same-company member, and by every user for themselves (RLS).
   */
  async fetchUserOverrides(userId: string): Promise<OverrideInput[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("user_permission_overrides")
      .select("permission, scope, granted")
      .eq("user_id", userId);

    if (error)
      throw new Error(`Failed to fetch permission overrides: ${error.message}`);
    return (data ?? []).map((row) => ({
      permission: row.permission as string,
      scope: (row.scope as PermissionScope | null) ?? null,
      granted: Boolean(row.granted),
    }));
  },

  /**
   * A member's full access picture for the Team access editor:
   * assigned role (if any) + that role's grants + per-member overrides.
   */
  async fetchMemberAccess(userId: string): Promise<MemberAccess> {
    const supabase = requireSupabase();

    const { data: assignment, error: urError } = await supabase
      .from("user_roles")
      .select("role_id, roles:role_id ( id, name )")
      .eq("user_id", userId)
      .maybeSingle();

    if (urError)
      throw new Error(`Failed to fetch member role: ${urError.message}`);

    const roleId = (assignment?.role_id as string) ?? null;
    const role = (assignment?.roles ?? null) as {
      id: string;
      name: string;
    } | null;

    const [rolePermissions, overrides] = await Promise.all([
      roleId ? RolesService.fetchRolePermissions(roleId) : Promise.resolve([]),
      RolesService.fetchUserOverrides(userId),
    ]);

    return {
      roleId,
      roleName: role?.name ?? null,
      rolePermissions,
      overrides,
    };
  },

  /**
   * Fetch the current user's resolved permission set.
   * Returns permissions map + role metadata.
   */
  async fetchUserPermissions(userId: string): Promise<{
    permissions: Map<string, PermissionScope>;
    roleId: string | null;
    roleName: string | null;
  }> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("user_roles")
      .select(
        `
        role_id,
        roles:role_id (
          id,
          name,
          role_permissions (
            permission,
            scope
          )
        )
      `
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch user permissions: ${error.message}`);
    }

    // No role assigned (brand-new invited user pre-role-assignment) —
    // return empty permissions without logging a console error.
    if (!data) {
      return { permissions: new Map(), roleId: null, roleName: null };
    }

    const permissions = new Map<string, PermissionScope>();
    const role = (data?.roles ?? null) as unknown as Record<
      string,
      unknown
    > | null;
    let roleId: string | null = null;
    let roleName: string | null = null;

    if (role) {
      roleId = (role.id as string) ?? null;
      roleName = (role.name as string) ?? null;
      const rolePerms =
        (role.role_permissions as Array<{
          permission: string;
          scope: PermissionScope;
        }>) ?? [];
      for (const rp of rolePerms) {
        permissions.set(rp.permission, rp.scope);
      }
    }

    return { permissions, roleId, roleName };
  },
};
