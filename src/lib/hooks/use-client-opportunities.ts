"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { OpportunityService } from "../api/services/opportunity-service";
import type { Opportunity } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

/**
 * Fetch all open opportunities scoped to a single client. Returns an empty
 * array when `clientId` is null/undefined (query disabled).
 *
 * Used by the inbox right rail's Pipeline tab to surface the open pipeline
 * for the thread's client.
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
    }),
    queryFn: async () => {
      if (!clientId) return [] as Opportunity[];
      return OpportunityService.fetchOpportunities(companyId, { clientId });
    },
    enabled: !!clientId && !!companyId,
    ...queryOptions,
  });
}
