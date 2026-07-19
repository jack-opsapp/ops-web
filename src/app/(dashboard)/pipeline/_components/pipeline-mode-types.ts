import type { OpportunityStage } from "@/lib/types/pipeline";

export type PipelineMode = "focused" | "table";
export type SortOption = "value" | "name" | "date" | "days_in_stage";
export type DetailTabId = "overview" | "correspondence" | "timeline" | "photos";

export type PipelineModeState = {
  mode: PipelineMode;
  focusedStage: OpportunityStage;
  detailPanelOpportunityId: string | null;
  detailPanelActiveTab: DetailTabId;
  sortBy: SortOption;
  stageSortOverrides: Map<OpportunityStage, SortOption>;
  /**
   * One-shot flag: the opportunity whose detail window should auto-open its
   * assignee picker once, set when the operator picks "Assign to". Transient
   * (never persisted); AssigneeField consumes and clears it on mount.
   */
  assignIntentOpportunityId: string | null;
};
