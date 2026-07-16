import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { OpportunityAssignedContextService } from "@/lib/api/services/opportunity-assigned-context-service";
import {
  effectiveInboxViewAccess,
  effectivePipelineScope,
} from "@/lib/permissions/lead-access-policy";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

interface AssignedContextAccessFingerprint {
  companyId: string;
  actorUserId: string;
  pipelineViewScope: "all" | "assigned" | null;
  inboxViewScope: "all" | "assigned" | "own" | null;
  inboxSource: "granular" | "compat" | "denied";
}

export const opportunityAssignedContextKey = (
  opportunityId: string,
  access: AssignedContextAccessFingerprint
) => ["opportunities", "assigned-context", opportunityId, access] as const;

export function useOpportunityAssignedContext(
  opportunityId: string | undefined
) {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  const actorUserId = useAuthStore((state) => state.currentUser?.id ?? "");
  const permissionState = usePermissionStore();
  const pipelineViewScope = effectivePipelineScope(
    permissionState,
    "pipeline.view"
  );
  const inboxViewAccess = effectiveInboxViewAccess(permissionState);
  const contextKey = opportunityAssignedContextKey(opportunityId ?? "", {
    companyId,
    actorUserId,
    pipelineViewScope,
    inboxViewScope: inboxViewAccess.scope,
    inboxSource: inboxViewAccess.source,
  });

  useEffect(() => {
    queryClient.removeQueries({
      queryKey: ["opportunities", "assigned-context", opportunityId ?? ""],
      type: "inactive",
    });
    return () => {
      queryClient.removeQueries({ queryKey: contextKey, exact: true });
    };
    // The primitive authorization fingerprint intentionally controls the
    // lifetime of cached lead correspondence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    actorUserId,
    companyId,
    inboxViewAccess.scope,
    inboxViewAccess.source,
    opportunityId,
    pipelineViewScope,
    queryClient,
  ]);

  return useQuery({
    queryKey: contextKey,
    queryFn: () => OpportunityAssignedContextService.fetch(opportunityId!),
    enabled: Boolean(
      opportunityId && companyId && actorUserId && pipelineViewScope
    ),
    placeholderData: undefined,
    retry: false,
    staleTime: 30_000,
  });
}
