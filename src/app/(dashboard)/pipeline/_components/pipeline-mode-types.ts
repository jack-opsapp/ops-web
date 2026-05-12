import type { OpportunityStage } from "@/lib/types/pipeline";

export type PipelineMode = "focused" | "spatial";
export type SortOption = "value" | "name" | "date" | "days_in_stage";
export type DetailTabId = "correspondence" | "timeline" | "photos";

export type PipelineModeState = {
  mode: PipelineMode;
  focusedStage: OpportunityStage;
  detailPanelOpportunityId: string | null;
  detailPanelActiveTab: DetailTabId;
  sortBy: SortOption;
  stageSortOverrides: Map<OpportunityStage, SortOption>;
};
