import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-client";
import {
  LeadAssignmentAccessLostError,
  LeadAssignmentConflictError,
  LeadAssignmentService,
  type ChangeLeadAssignmentInput,
  type LeadAssignmentResult,
} from "@/lib/api/services/lead-assignment-service";
import { reconcileLeadAssignmentDelivery } from "@/lib/hooks/use-lead-assignment-realtime";
import { effectivePipelineScope } from "@/lib/permissions/lead-access-policy";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { Opportunity } from "@/lib/types/pipeline";

export function useLeadAssignmentCandidates(
  opportunityId: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.opportunities.assignmentCandidates(opportunityId),
    queryFn: () => LeadAssignmentService.listCandidates(opportunityId),
    enabled: enabled && opportunityId.length > 0,
    staleTime: 30_000,
  });
}

interface AssignmentSnapshot {
  assignedTo: string | null;
  assignmentVersion: number;
}

function writeAssignmentSnapshot(
  queryClient: ReturnType<typeof useQueryClient>,
  opportunityId: string,
  snapshot: AssignmentSnapshot
) {
  queryClient.setQueriesData<Opportunity>(
    { queryKey: queryKeys.opportunities.detail(opportunityId) },
    (old) => (old ? { ...old, ...snapshot } : old)
  );
  queryClient.setQueriesData<Opportunity[]>(
    { queryKey: queryKeys.opportunities.lists() },
    (old) =>
      old?.map((opportunity) =>
        opportunity.id === opportunityId
          ? { ...opportunity, ...snapshot }
          : opportunity
      )
  );
}

/**
 * Guarded lead assignment mutation. There is deliberately no optimistic assignee
 * patch: only the row-locked server snapshot is authoritative. Successes and
 * conflicts are both reconciled before dependent views refetch.
 */
export function useLeadAssignment() {
  const queryClient = useQueryClient();
  const actorUserId = useAuthStore((state) => state.currentUser?.id ?? null);
  const permissionState = usePermissionStore();
  const viewScope = effectivePipelineScope(permissionState, "pipeline.view");

  const reconcileAuthoritativeSnapshot = (
    opportunityId: string,
    snapshot: AssignmentSnapshot
  ) => {
    const accessAfter =
      viewScope === "all" ||
      (viewScope === "assigned" &&
        actorUserId !== null &&
        snapshot.assignedTo === actorUserId);

    if (!accessAfter) {
      reconcileLeadAssignmentDelivery(queryClient, {
        opportunityId,
        accessAfter: false,
      });
      return;
    }
    writeAssignmentSnapshot(queryClient, opportunityId, snapshot);
  };

  return useMutation<LeadAssignmentResult, Error, ChangeLeadAssignmentInput>({
    mutationFn: (input) => LeadAssignmentService.changeAssignment(input),
    onSuccess: (result, input) => {
      reconcileAuthoritativeSnapshot(input.opportunityId, result);
    },
    onError: (error, input) => {
      if (error instanceof LeadAssignmentAccessLostError) {
        reconcileLeadAssignmentDelivery(queryClient, {
          opportunityId: input.opportunityId,
          accessAfter: false,
        });
        return;
      }
      if (error instanceof LeadAssignmentConflictError) {
        reconcileAuthoritativeSnapshot(input.opportunityId, error);
      }
    },
    onSettled: (_result, _error, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.opportunities.detail(input.opportunityId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.opportunities.lists(),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.metrics.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.opportunities.assignmentCandidates(
          input.opportunityId
        ),
      });
    },
  });
}
