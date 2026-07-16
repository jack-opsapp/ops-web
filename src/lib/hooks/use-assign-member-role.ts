"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-client";
import {
  RolesService,
  type ReplaceUserRoleInput,
  type ReplaceUserRoleResult,
} from "@/lib/api/services/roles-service";

interface AssignRoleParams {
  userId: string;
  input: ReplaceUserRoleInput;
}

/**
 * Atomically replace a member's role and any lead responsibilities that the
 * new access would otherwise strand. The route also clears related role-needed
 * notifications after the guarded transaction commits.
 */
export function useAssignMemberRole() {
  const queryClient = useQueryClient();

  return useMutation<ReplaceUserRoleResult, Error, AssignRoleParams>({
    mutationFn: ({ userId, input }) =>
      RolesService.replaceUserRole(userId, input),
    onSuccess: (_result, { userId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.roles.memberAccess(userId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all });
    },
  });
}
