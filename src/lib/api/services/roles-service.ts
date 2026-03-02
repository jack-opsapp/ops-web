/**
 * OPS Web - Roles & Permissions Service
 *
 * CRUD operations for roles, role permissions, and user-role assignments.
 * Uses Supabase as the data layer.
 */

import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";
import type { Role, RolePermission, UserRole, PermissionScope } from "@/lib/types/permissions";
import type { User } from "@/lib/types/models";
import { getUserFullName } from "@/lib/types/models";

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
    assignedAt: (row.assigned_at as string) ?? new Date().toISOString(),
    assignedBy: (row.assigned_by as string) ?? null,
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

    if (error) throw new Error(`Failed to fetch role permissions: ${error.message}`);
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

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
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
   * Bulk-replace all permissions for a role.
   * Deletes existing permissions and inserts the new set.
   */
  async updateRolePermissions(
    roleId: string,
    permissions: { permission: string; scope: PermissionScope }[]
  ): Promise<void> {
    const supabase = requireSupabase();

    // Snapshot existing permissions so we can restore on failure
    const { data: existing } = await supabase
      .from("role_permissions")
      .select("role_id, permission, scope")
      .eq("role_id", roleId);

    // Delete existing permissions
    const { error: deleteError } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId);

    if (deleteError) throw new Error(`Failed to clear role permissions: ${deleteError.message}`);

    // Insert new permissions
    if (permissions.length > 0) {
      const rows = permissions.map((p) => ({
        role_id: roleId,
        permission: p.permission,
        scope: p.scope,
      }));

      const { error: insertError } = await supabase
        .from("role_permissions")
        .insert(rows);

      if (insertError) {
        // Attempt to restore previous permissions
        if (existing && existing.length > 0) {
          await supabase.from("role_permissions").insert(existing);
        }
        throw new Error(`Failed to set role permissions: ${insertError.message}`);
      }
    }
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
    const sourcePermissions = await RolesService.fetchRolePermissions(sourceRoleId);

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
      await RolesService.updateRolePermissions(
        newRole.id,
        sourcePermissions.map((p) => ({ permission: p.permission, scope: p.scope }))
      );
    }

    return newRole;
  },

  /**
   * Assign a user to a role (upsert — replaces any existing role).
   */
  async assignUserRole(
    userId: string,
    roleId: string,
    assignedBy: string
  ): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("user_roles")
      .upsert(
        {
          user_id: userId,
          role_id: roleId,
          assigned_at: new Date().toISOString(),
          assigned_by: assignedBy,
        },
        { onConflict: "user_id" }
      );

    if (error) throw new Error(`Failed to assign user role: ${error.message}`);
  },

  /**
   * Remove a user's role assignment.
   */
  async removeUserRole(userId: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId);

    if (error) throw new Error(`Failed to remove user role: ${error.message}`);
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

    if (error) throw new Error(`Failed to fetch role members: ${error.message}`);
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

    if (usersError) throw new Error(`Failed to fetch company users: ${usersError.message}`);

    const userIds = (companyUsers ?? []).map((u) => u.id);
    if (userIds.length === 0) return [];

    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role_id, assigned_at, assigned_by")
      .in("user_id", userIds);

    if (error) throw new Error(`Failed to fetch user roles: ${error.message}`);
    return (data ?? []).map(mapUserRoleFromDb);
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
      .select(`
        role_id,
        roles:role_id (
          id,
          name,
          role_permissions (
            permission,
            scope
          )
        )
      `)
      .eq("user_id", userId)
      .single();

    if (error) {
      // No role assigned — return empty permissions
      if (error.code === "PGRST116") {
        return { permissions: new Map(), roleId: null, roleName: null };
      }
      throw new Error(`Failed to fetch user permissions: ${error.message}`);
    }

    const permissions = new Map<string, PermissionScope>();
    const role = (data?.roles ?? null) as unknown as Record<string, unknown> | null;
    let roleId: string | null = null;
    let roleName: string | null = null;

    if (role) {
      roleId = (role.id as string) ?? null;
      roleName = (role.name as string) ?? null;
      const rolePerms = (role.role_permissions as Array<{ permission: string; scope: PermissionScope }>) ?? [];
      for (const rp of rolePerms) {
        permissions.set(rp.permission, rp.scope);
      }
    }

    return { permissions, roleId, roleName };
  },
};
