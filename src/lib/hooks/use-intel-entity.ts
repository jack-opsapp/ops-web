/**
 * OPS Web - Intel Entity Drill-Down Hook
 *
 * TanStack Query hook for fetching full detail on a single Intel entity.
 * Used by the Tier 3 drill-down panel in the galaxy visualization.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import type { IntelEntityDetail } from "@/types/intel";

// Re-export types from the shared module so existing imports continue to work
export type { IntelFact, IntelKnowledgeEdge, IntelEntityDetail } from "@/types/intel";

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetch full detail for a single entity in the Intel galaxy.
 *
 * @param entityId  - UUID of the entity (or profile_type for voice_profile)
 * @param type      - Entity type: person | company | service | material | project |
 *                    invoice | estimate | voice_profile
 * @param companyId - Company UUID for security scoping
 *
 * staleTime: 60 seconds — detail data is queried on demand, can afford a short cache
 */
export function useIntelEntity(
  entityId: string | undefined,
  type: string | undefined,
  companyId: string | undefined,
  queryOptions?: Partial<UseQueryOptions<IntelEntityDetail>>
) {
  return useQuery<IntelEntityDetail>({
    queryKey: [...queryKeys.intel.entity(entityId ?? ""), companyId ?? ""],
    queryFn: async (): Promise<IntelEntityDetail> => {
      const params = new URLSearchParams({
        type: type ?? "",
        companyId: companyId ?? "",
      });
      const res = await fetch(`/api/intel/entity/${entityId}?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(
          new Error(
            (body as { error?: string }).error ?? "Failed to fetch entity detail"
          ),
          { status: res.status }
        );
      }
      return res.json() as Promise<IntelEntityDetail>;
    },
    enabled: !!entityId,
    staleTime: 60 * 1000,
    ...queryOptions,
  });
}
