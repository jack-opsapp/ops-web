/**
 * OPS Web — Opportunity → Pipeline Table Row adapter.
 *
 * Pure, load-bearing derivation logic that flattens an {@link Opportunity} into
 * the {@link PipelineTableRow} the pipeline table renders. It owns the forecast
 * (weighted value), aging (days-in-stage + rot thresholds), and follow-up/close
 * overdue derivations.
 *
 * Design rules:
 *   - Every helper is individually exported so it is unit-testable in isolation,
 *     and {@link mapOpportunityToTableRow} composes them — no duplicated math.
 *   - Time is always injected as a `now: Date` argument. Nothing in this module
 *     calls `Date.now()` / `new Date()` with no args, so callers (and tests) get
 *     deterministic output under a fixed clock.
 *   - The adapter does NOT touch the database. Per-stage config arrives as a
 *     `Map<slug, PipelineStageConfig>`; client/assignee display names arrive as
 *     `Map<id, string>`. The query hook that assembles these is a later task.
 *   - Dates become ISO strings on the row so table rendering and column sorting
 *     stay stable and timezone-free.
 */

import {
  isActiveStage,
  OpportunityStage,
  PIPELINE_STAGES_DEFAULT,
  type Opportunity,
  type PipelineStageConfig,
} from "@/lib/types/pipeline";
import type { PipelineTableRow } from "@/lib/types/pipeline-table";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Coerce a `Date | string | null` into a `Date | null` without mutating input. */
function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/** Null-safe `.toISOString()` for row serialization. */
function toIso(value: Date | string | null): string | null {
  return toDate(value)?.toISOString() ?? null;
}

/**
 * Forecast value for a single deal: `estimatedValue × probability%`.
 *
 * - `null` when there is no estimated value (the forecast is unknown, not zero).
 * - A `null` probability is treated as `0%`, yielding `0`.
 */
export function weightedValue(
  estimatedValue: number | null,
  winProbabilityPercent: number | null
): number | null {
  if (estimatedValue === null) return null;
  return (estimatedValue * (winProbabilityPercent ?? 0)) / 100;
}

/**
 * Whole days the deal has sat in its current stage, floored.
 * `null` when there is no `stageEnteredAt`.
 */
export function ageInStageDays(
  stageEnteredAt: Date | string | null,
  now: Date
): number | null {
  const entered = toDate(stageEnteredAt);
  if (entered === null) return null;
  return Math.floor((now.getTime() - entered.getTime()) / MS_PER_DAY);
}

/**
 * Resolve the win probability to use for the weighted forecast, plus whether the
 * value came from a fallback source rather than the deal itself.
 *
 * Fallback order:
 *   1. The deal's own `winProbability` — used when it is a positive number.
 *   2. The stage's `defaultWinProbability` from `stageConfig`.
 *   3. The `PIPELINE_STAGES_DEFAULT` constant for the deal's stage slug.
 *   4. `0`.
 *
 * NUANCE: `Opportunity.winProbability` is non-nullable in the model, so there is
 * no literal `null` to key the fallback on. We treat a non-positive value
 * (`0` or unset-equivalent) as "no meaningful per-deal probability" and fall
 * back. A positive deal probability always wins and is never flagged as a
 * fallback — even when it happens to equal the stage default.
 */
export function resolveWinProbability(
  opp: Pick<Opportunity, "stage" | "winProbability">,
  stageConfig: PipelineStageConfig | undefined
): { value: number; isFallback: boolean } {
  if (typeof opp.winProbability === "number" && opp.winProbability > 0) {
    return { value: opp.winProbability, isFallback: false };
  }

  const stageDefault = stageConfig?.defaultWinProbability;
  if (typeof stageDefault === "number") {
    return { value: stageDefault, isFallback: true };
  }

  const constantDefault = PIPELINE_STAGES_DEFAULT.find(
    (s) => s.slug === opp.stage
  )?.winProbability;

  return { value: constantDefault ?? 0, isFallback: true };
}

/**
 * The deal has been in-stage at or beyond its stale threshold ("rotting").
 * `false` unless both the age and the threshold are known.
 */
export function isRotting(
  ageInStageDaysValue: number | null,
  staleThresholdDays: number | null
): boolean {
  if (ageInStageDaysValue === null || staleThresholdDays === null) return false;
  return ageInStageDaysValue >= staleThresholdDays;
}

/**
 * The deal has been in-stage at or beyond TWICE its stale threshold
 * ("severely rotting"). `false` unless both inputs are known.
 */
export function isSevereRotting(
  ageInStageDaysValue: number | null,
  staleThresholdDays: number | null
): boolean {
  if (ageInStageDaysValue === null || staleThresholdDays === null) return false;
  return ageInStageDaysValue >= 2 * staleThresholdDays;
}

/**
 * A scheduled follow-up is overdue: its date is strictly before `now` AND the
 * deal is still on an active stage. Won / Lost / Discarded deals are never
 * "overdue" — there is nothing left to follow up on.
 */
export function isFollowUpOverdue(
  nextFollowUpAt: Date | string | null,
  stage: OpportunityStage,
  now: Date
): boolean {
  const due = toDate(nextFollowUpAt);
  if (due === null) return false;
  if (!isActiveStage(stage)) return false;
  return due.getTime() < now.getTime();
}

/**
 * The expected close date has passed while the deal is still active. Same rule
 * as {@link isFollowUpOverdue}: terminal stages are never overdue.
 */
export function isCloseOverdue(
  expectedCloseDate: Date | string | null,
  stage: OpportunityStage,
  now: Date
): boolean {
  const close = toDate(expectedCloseDate);
  if (close === null) return false;
  if (!isActiveStage(stage)) return false;
  return close.getTime() < now.getTime();
}

/**
 * Whether a table row is eligible to be converted into a project.
 *
 * A deal converts only when it is WON and not already converted: the
 * conversion both creates a project and stamps `projectId` back onto the
 * opportunity, so a row that already carries a `projectId` has been converted
 * and must never offer the action again (it would create a duplicate project).
 *
 * Pure and row-shaped (reads only `stage` + `projectId`) so the row component
 * can gate its convert affordance without the full `Opportunity`, and so the
 * rule is unit-testable in isolation. Permission (`pipeline.manage`) is a
 * SEPARATE gate applied at the call site — this predicate is data-eligibility
 * only.
 */
export function canConvertOpportunity(
  row: Pick<PipelineTableRow, "stage" | "projectId">
): boolean {
  return row.stage === OpportunityStage.Won && row.projectId === null;
}

/** Inputs the adapter needs beyond the opportunity itself. */
export interface MapOpportunityToTableRowArgs {
  /** `clientId` → display name. */
  clientNameMap: Map<string, string>;
  /** `assignedTo` (user id) → display name. */
  assigneeNameMap: Map<string, string>;
  /** Stage slug → per-company stage config (win prob + stale threshold). */
  stageConfigBySlug: Map<string, PipelineStageConfig>;
  /** Injected clock for all aging / forecast derivations. */
  now: Date;
}

/**
 * Flatten an {@link Opportunity} (plus joined lookups) into a
 * {@link PipelineTableRow}, computing every derived field.
 */
export function mapOpportunityToTableRow(
  opp: Opportunity,
  args: MapOpportunityToTableRowArgs
): PipelineTableRow {
  const { clientNameMap, assigneeNameMap, stageConfigBySlug, now } = args;

  const stageConfig = stageConfigBySlug.get(opp.stage);
  const { value: winProbabilityResolved, isFallback } = resolveWinProbability(
    opp,
    stageConfig
  );

  return {
    id: opp.id,
    companyId: opp.companyId,
    title: opp.title,
    stage: opp.stage,
    clientId: opp.clientId,
    clientName:
      opp.clientId !== null ? (clientNameMap.get(opp.clientId) ?? null) : null,
    estimatedValue: opp.estimatedValue,
    winProbability: winProbabilityResolved,
    weightedValue: weightedValue(opp.estimatedValue, winProbabilityResolved),
    ageInStageDays: ageInStageDays(opp.stageEnteredAt, now),
    lastActivityAt: toIso(opp.lastActivityAt),
    nextFollowUpAt: toIso(opp.nextFollowUpAt),
    expectedCloseDate: toIso(opp.expectedCloseDate),
    assignedTo: opp.assignedTo,
    assignmentVersion: opp.assignmentVersion,
    assigneeName:
      opp.assignedTo !== null
        ? (assigneeNameMap.get(opp.assignedTo) ?? null)
        : null,
    source: opp.source ?? null,
    priority: opp.priority ?? null,
    correspondenceCount: opp.correspondenceCount,
    stageEnteredAt: toIso(opp.stageEnteredAt),
    projectId: opp.projectId,
    updatedAt: toIso(opp.updatedAt),
    staleThresholdDays: stageConfig?.staleThresholdDays ?? null,
    winProbabilityIsFallback: isFallback,
  };
}
