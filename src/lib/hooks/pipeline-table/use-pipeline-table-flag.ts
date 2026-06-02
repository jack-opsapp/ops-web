import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";

export const PIPELINE_TABLE_VIEW_FLAG = "pipeline_table_view";

export function usePipelineTableViewFlag(): boolean {
  const initialized = useFeatureFlagsStore((s) => s.initialized);
  const flag = useFeatureFlagsStore((s) => s.flags.get(PIPELINE_TABLE_VIEW_FLAG));
  if (!initialized) return false;
  return Boolean(flag?.enabled || flag?.hasOverride);
}
