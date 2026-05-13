"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { OpportunityService } from "../api/services/opportunity-service";
import { getActiveStages, type Opportunity } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

/**
 * Fetch open opportunities scoped to a single client. Terminal stages
 * (Won / Lost / Discarded) are excluded so the inbox rail's WORK tab only
 * surfaces leads still in flight. Returns an empty array when `clientId`
 * is null/undefined (query disabled).
 */
export function useClientOpportunities(
  clientId: string | null | undefined,
  queryOptions?: Partial<UseQueryOptions<Opportunity[]>>,
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.opportunities.list(companyId, {
      clientId: clientId ?? null,
      openOnly: true,
    }),
    queryFn: async () => {
      if (!clientId) return [] as Opportunity[];
      return OpportunityService.fetchOpportunities(companyId, {
        clientId,
        stages: getActiveStages(),
      });
    },
    enabled: !!clientId && !!companyId,
    ...queryOptions,
  });
}
