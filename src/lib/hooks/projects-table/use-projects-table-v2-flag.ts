import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";

export const PROJECTS_TABLE_V2_FLAG = "projects_table_v2";

export function useProjectsTableV2Flag(): boolean {
  const initialized = useFeatureFlagsStore((s) => s.initialized);
  const flag = useFeatureFlagsStore((s) => s.flags.get(PROJECTS_TABLE_V2_FLAG));

  if (!initialized) return false;
  return Boolean(flag?.enabled || flag?.hasOverride);
}
