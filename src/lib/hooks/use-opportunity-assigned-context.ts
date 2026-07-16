import { useQuery } from "@tanstack/react-query";

import { OpportunityAssignedContextService } from "@/lib/api/services/opportunity-assigned-context-service";

export const opportunityAssignedContextKey = (opportunityId: string) =>
  ["opportunities", "assigned-context", opportunityId] as const;

export function useOpportunityAssignedContext(
  opportunityId: string | undefined
) {
  return useQuery({
    queryKey: opportunityAssignedContextKey(opportunityId ?? ""),
    queryFn: () => OpportunityAssignedContextService.fetch(opportunityId!),
    enabled: Boolean(opportunityId),
    retry: false,
    staleTime: 30_000,
  });
}
