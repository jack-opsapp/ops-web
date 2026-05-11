"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ProjectService } from "../api/services";
import type { Project } from "../types/models";
import { useAuthStore } from "../store/auth-store";

/**
 * Fetch all projects scoped to a single client. Returns an empty array when
 * `clientId` is null/undefined (the query is disabled and never fires).
 *
 * Used by the inbox right rail's Projects tab to surface every project tied
 * to the currently-open thread's client.
 */
export function useClientProjects(
  clientId: string | null | undefined,
  queryOptions?: Partial<UseQueryOptions<Project[]>>,
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.projects.list(companyId, { clientId: clientId ?? null }),
    queryFn: async () => {
      if (!clientId) return [] as Project[];
      const result = await ProjectService.fetchAllProjects(companyId, {
        clientId,
      });
      return result;
    },
    enabled: !!clientId && !!companyId,
    ...queryOptions,
  });
}
