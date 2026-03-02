/**
 * OPS Web - Roles & Permissions Hooks
 *
 * TanStack Query hooks for role management, permission editing,
 * and user-role assignments.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { RolesService } from "../api/services/roles-service";
import { useAuthStore } from "../store/auth-store";
import type { PermissionScope } from "../types/permissions";

// ─── Query Hooks ─────────────────────────────────────────────────────────────

/** Fetch all roles (presets + company custom roles). */
export function useRoles() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.roles.list(companyId),
    queryFn: () => RolesService.fetchRoles(companyId),
    enabled: !!companyId,
  });
}

/** Fetch permissions for a specific role. */
export function useRolePermissions(roleId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.roles.permissions(roleId ?? ""),
    queryFn: () => RolesService.fetchRolePermissions(roleId!),
    enabled: !!roleId,
  });
}

/** Fetch user_roles for a specific role (assigned members). */
export function useRoleMembers(roleId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.roles.members(roleId ?? ""),
    queryFn: () => RolesService.fetchRoleMembers(roleId!),
    enabled: !!roleId,
  });
}

/** Fetch all user_roles for the company (for member counts). */
export function useAllUserRoles() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.roles.userRoles(companyId),
    queryFn: () => RolesService.fetchAllUserRoles(companyId),
    enabled: !!companyId,
  });
}

// ─── Mutation Hooks ──────────────────────────────────────────────────────────

/** Create a new custom role. */
export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      companyId: string;
      hierarchy: number;
    }) => RolesService.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.lists() });
    },
  });
}

/** Update a custom role's name/description. */
export function useUpdateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      roleId,
      data,
    }: {
      roleId: string;
      data: { name?: string; description?: string | null; hierarchy?: number };
    }) => RolesService.updateRole(roleId, data),
    onSuccess: (_result, { roleId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.detail(roleId) });
    },
  });
}

/** Delete a custom role. */
export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (roleId: string) => RolesService.deleteRole(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.lists() });
    },
  });
}

/** Bulk-replace all permissions for a role. */
export function useUpdateRolePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      roleId,
      permissions,
    }: {
      roleId: string;
      permissions: { permission: string; scope: PermissionScope }[];
    }) => RolesService.updateRolePermissions(roleId, permissions),
    onSuccess: (_result, { roleId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.permissions(roleId) });
      // Also invalidate user permissions since they depend on role permissions
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all });
    },
  });
}

/** Duplicate a role into a new custom role. */
export function useDuplicateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sourceRoleId,
      companyId,
      newName,
    }: {
      sourceRoleId: string;
      companyId: string;
      newName: string;
    }) => RolesService.duplicateRole(sourceRoleId, companyId, newName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.lists() });
    },
  });
}

/** Assign a user to a role. */
export function useAssignUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      roleId,
      assignedBy,
    }: {
      userId: string;
      roleId: string;
      assignedBy: string;
    }) => RolesService.assignUserRole(userId, roleId, assignedBy),
    onSuccess: (_result, { roleId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.members(roleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all });
    },
  });
}

/** Remove a user's role assignment. */
export function useRemoveUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      RolesService.removeUserRole(userId),
    onSuccess: (_result, { roleId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.members(roleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all });
    },
  });
}
