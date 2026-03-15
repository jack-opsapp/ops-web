/**
 * OPS Web - Team Invitation Hooks
 *
 * TanStack Query hooks for fetching, updating, and revoking
 * pending team invitations.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { InvitationService } from "../api/services/invitation-service";
import { useAuthStore } from "../store/auth-store";

/** Fetch all pending invitations for the current company. */
export function usePendingInvitations() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.invitations.list(companyId),
    queryFn: () => InvitationService.fetchPendingInvitations(companyId),
    enabled: !!companyId,
  });
}

/** Update the role on a pending invitation. */
export function useUpdateInvitationRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ invitationId, roleId }: { invitationId: string; roleId: string | null }) =>
      InvitationService.updateInvitationRole(invitationId, roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all });
    },
  });
}

/** Revoke (delete) a pending invitation. */
export function useRevokeInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitationId: string) =>
      InvitationService.revokeInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all });
    },
  });
}
