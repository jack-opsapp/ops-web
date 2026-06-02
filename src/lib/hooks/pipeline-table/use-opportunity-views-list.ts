/**
 * OPS Web — Pipeline saved-views list hook.
 *
 * Mirrors `projects-table/use-project-views-list.ts`: company- + user-scoped
 * fetch of the `opportunity_views` rows the pipeline table's view switcher
 * renders. Gated on `pipeline.view` (pipeline money is visible to anyone with
 * that permission, so there is no separate view-read permission). Views change
 * rarely, so the cache is held fresh for 30 seconds.
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { OpportunityViewsService } from "@/lib/api/services/opportunity-views-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

export function useOpportunityViewsList() {
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  const userId = useAuthStore((s) => s.currentUser?.id ?? "");
  const canView = usePermissionStore((s) => s.can("pipeline.view"));

  const query = useQuery({
    queryKey: queryKeys.opportunities.tableViews(companyId, userId),
    queryFn: () => OpportunityViewsService.fetchViews(companyId),
    enabled: Boolean(companyId && userId && canView),
    staleTime: 30_000,
  });

  return {
    ...query,
    companyId,
    userId,
  };
}
