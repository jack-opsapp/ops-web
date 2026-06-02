import type { Opportunity, PipelineStageDefault } from "@/lib/types/pipeline";
import {
  getDaysInStage,
  isTerminalStage,
  PIPELINE_STAGES_DEFAULT,
} from "@/lib/types/pipeline";

/**
 * Calculate card opacity based on staleness (how long the deal has been
 * sitting in its current stage without progressing).
 *
 * Fresh deals = 1.0 (full opacity)
 * Deeply stale deals = 0.4 (minimum opacity)
 * Terminal stages (Won, Lost, Discarded) = 0.8 (slightly dimmed, settled)
 *
 * Hover overrides this to 1.0 at the component level (not in this function).
 */
export function calculateStalenessOpacity(
  opportunity: Opportunity,
  stageConfig?: PipelineStageDefault
): number {
  // Terminal stages always return 0.8
  if (isTerminalStage(opportunity.stage)) return 0.8;

  const config =
    stageConfig ??
    PIPELINE_STAGES_DEFAULT.find((s) => s.slug === opportunity.stage);

  const daysInStage = getDaysInStage(opportunity);

  // Expected days = autoFollowUpDays × 3, fallback to 21
  // (Matches the health bar expectedDays calculation in pipeline-card.tsx)
  const expectedDays = config?.autoFollowUpDays
    ? config.autoFollowUpDays * 3
    : 21;

  if (daysInStage <= expectedDays * 0.5) return 1.0; // fresh — full opacity
  if (daysInStage >= expectedDays * 2.0) return 0.4; // deeply stale — minimum opacity

  // Linear interpolation between 1.0 and 0.4
  const progress =
    (daysInStage - expectedDays * 0.5) / (expectedDays * 1.5);
  return 1.0 - progress * 0.6; // 1.0 → 0.4
}

/**
 * Batch-calculate staleness opacity for multiple opportunities.
 * Returns a Map<opportunityId, opacity>.
 */
export function calculateBatchStaleness(
  opportunities: Opportunity[]
): Map<string, number> {
  const result = new Map<string, number>();
  for (const opp of opportunities) {
    const config = PIPELINE_STAGES_DEFAULT.find(
      (s) => s.slug === opp.stage
    );
    result.set(opp.id, calculateStalenessOpacity(opp, config));
  }
  return result;
}
