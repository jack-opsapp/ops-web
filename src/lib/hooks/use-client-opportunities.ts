"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { OpportunityService } from "../api/services/opportunity-service";
import {
  OpportunityStage,
  getActiveStages,
  type Opportunity,
} from "../types/pipeline";
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

/**
 * Fetch won opportunities scoped to a single client, ordered most-recently
 * closed first. Surfaced in the inbox rail's WORK tab under a // WON
 * sub-section so closed business stays visible without polluting the
 * active-leads list. Lost / discarded stages are intentionally NOT included.
 */
export function useClientOpportunitiesWon(
  clientId: string | null | undefined,
  queryOptions?: Partial<UseQueryOptions<Opportunity[]>>,
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.opportunities.list(companyId, {
      clientId: clientId ?? null,
      wonOnly: true,
    }),
    queryFn: async () => {
      if (!clientId) return [] as Opportunity[];
      return OpportunityService.fetchOpportunities(companyId, {
        clientId,
        stages: [OpportunityStage.Won],
        sortField: "actual_close_date",
        descending: true,
      });
    },
    enabled: !!clientId && !!companyId,
    ...queryOptions,
  });
}
