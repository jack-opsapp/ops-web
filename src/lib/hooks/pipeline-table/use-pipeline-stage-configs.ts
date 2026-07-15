/**
 * OPS Web — Pipeline Stage Configs hook.
 *
 * Fetches the per-company `pipeline_stage_configs` rows that the pipeline table
 * needs for its weighted-forecast (`defaultWinProbability`) and rotting
 * (`staleThresholdDays`) signals. Mirrors `useOpportunities`: company-scoped,
 * gated on `pipeline.view`. Configs change rarely, so the cache is held fresh
 * for 5 minutes.
 *
 * A company with no config rows resolves to `[]`; the table adapter falls back
 * to `PIPELINE_STAGES_DEFAULT` in that case.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { OpportunityService } from "@/lib/api/services/opportunity-service";
import type { PipelineStageConfig } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

/**
 * Index a list of stage configs by their slug for O(1) lookup.
 *
 * The pipeline-table adapter keys lookups on the opportunity's stage slug
 * (`stageConfigBySlug.get(opp.stage)`), so this is the shape it consumes.
 */
export function stageConfigBySlug(
  configs: PipelineStageConfig[]
): Map<string, PipelineStageConfig> {
  return new Map(configs.map((config) => [config.slug, config]));
}

/**
 * Fetch the current company's pipeline stage configurations.
 */
export function usePipelineStageConfigs(
  queryOptions?: Partial<UseQueryOptions<PipelineStageConfig[]>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const canView = usePermissionStore((s) => s.can("pipeline.view"));

  return useQuery({
    queryKey: queryKeys.opportunities.stageConfigs(companyId),
    queryFn: () => OpportunityService.fetchStageConfigs(companyId),
    enabled: !!companyId && canView,
    staleTime: 5 * 60_000,
    ...queryOptions,
  });
}
