"use client";

/**
 * OPS Web - Member Access Hooks
 *
 * Data layer for the Team member access editor: one query for a member's
 * full access picture (role + role grants + exceptions) and one mutation
 * applying an exception batch through the guarded override route.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { RolesService } from "@/lib/api/services/roles-service";
import {
  PermissionOverridesService,
  type SaveOverridesInput,
  type SaveOverridesResult,
} from "@/lib/api/services/permission-overrides-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

/** A member's role, role grants, and permission exceptions. */
export function useMemberAccess(userId: string | null) {
  return useQuery({
    queryKey: queryKeys.roles.memberAccess(userId ?? ""),
    queryFn: () => RolesService.fetchMemberAccess(userId!),
    enabled: !!userId,
  });
}

/** Apply an exception batch for a member, then refresh everything derived. */
export function useSaveMemberAccess() {
  const qc = useQueryClient();
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);

  return useMutation({
    mutationFn: async ({
      userId,
      input,
    }: {
      userId: string;
      input: SaveOverridesInput;
    }): Promise<SaveOverridesResult> =>
      PermissionOverridesService.saveMemberOverrides(userId, input),
    onSuccess: async (_result, { userId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.roles.memberAccess(userId) });
      qc.invalidateQueries({
        queryKey: queryKeys.roles.userPermissions(userId),
      });
      if (company?.id) {
        qc.invalidateQueries({
          queryKey: queryKeys.roles.userRoles(company.id),
        });
      }
      // Editing your own exceptions (possible for non-bypass managers via
      // team.assign_roles) must refresh the live permission set.
      if (currentUser?.id === userId) {
        await usePermissionStore.getState().fetchPermissions(userId);
      }
    },
  });
}
