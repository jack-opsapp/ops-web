/**
 * OPS Web — Pipeline Table flattened-grouping model & per-stage rollups
 *
 * The pipeline table can optionally GROUP rows by stage. Grouped + virtualized
 * is the documented failure-mode zone (sticky-header drift, jumpy scroll); the
 * safe pattern is a SINGLE flattened render stream fed to ONE virtualizer — an
 * array where group-header items are interleaved with data items. This module
 * produces that flattened array plus the rollup math (count + value sums) that
 * each group header displays.
 *
 * Everything here is pure: no input is mutated, ordering is stable and
 * deterministic (stages by `OPPORTUNITY_STAGE_SORT_ORDER`, rows by their
 * incoming relative order — the caller pre-sorts within a stage). Rendering is
 * a separate concern (Task 6.2); this file ships only data.
 *
 * Money sums treat `null` value/weighted as `0` (a row with no estimate still
 * counts toward the stage's row count, just contributes nothing to its totals).
 */

import {
  OPPORTUNITY_STAGE_SORT_ORDER,
  type OpportunityStage,
} from "@/lib/types/pipeline";
import type { PipelineTableRow } from "@/lib/types/pipeline-table";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * A single item in the flattened render stream. Either a stage group header
 * (carrying that stage's rollup + collapse state) or a data row. The table's
 * lone virtualizer renders both kinds from one array.
 */
export type PipelineFlatItem =
  | {
      kind: "group-header";
      stage: OpportunityStage;
      count: number;
      sumValue: number;
      sumWeighted: number;
      collapsed: boolean;
    }
  | { kind: "data"; row: PipelineTableRow };

/** Per-stage aggregate: row count + summed estimated value + summed weighted value. */
export interface StageRollup {
  stage: OpportunityStage;
  count: number;
  sumValue: number;
  sumWeighted: number;
}

/** Aggregate across every row, irrespective of stage. */
export interface GrandTotal {
  count: number;
  sumValue: number;
  sumWeighted: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

/** Coerce a nullable monetary field to a number, mapping `null` → `0`. */
function toAmount(value: number | null): number {
  return value ?? 0;
}

/** Compare two stages by their canonical pipeline sort order (ascending). */
function byStageSortOrder(a: OpportunityStage, b: OpportunityStage): number {
  return OPPORTUNITY_STAGE_SORT_ORDER[a] - OPPORTUNITY_STAGE_SORT_ORDER[b];
}

/**
 * Bucket rows by stage into a Map keyed by stage, preserving each stage's
 * incoming relative row order. Does not mutate the input array or its rows.
 */
function bucketByStage(
  rows: readonly PipelineTableRow[],
): Map<OpportunityStage, PipelineTableRow[]> {
  const buckets = new Map<OpportunityStage, PipelineTableRow[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.stage);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(row.stage, [row]);
    }
  }
  return buckets;
}

/** Sum a bucket's rows into a {count, sumValue, sumWeighted} triple (nulls → 0). */
function sumBucket(bucketRows: readonly PipelineTableRow[]): {
  count: number;
  sumValue: number;
  sumWeighted: number;
} {
  let sumValue = 0;
  let sumWeighted = 0;
  for (const row of bucketRows) {
    sumValue += toAmount(row.estimatedValue);
    sumWeighted += toAmount(row.weightedValue);
  }
  return { count: bucketRows.length, sumValue, sumWeighted };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Group rows by stage and compute each stage's rollup (row count + summed
 * estimated value + summed weighted value, nulls counted as 0). Returns ONLY
 * stages that have at least one row, ordered by `OPPORTUNITY_STAGE_SORT_ORDER`.
 *
 * Pure: the input array and its rows are never mutated.
 */
export function stageRollups(rows: readonly PipelineTableRow[]): StageRollup[] {
  const buckets = bucketByStage(rows);

  const rollups: StageRollup[] = [];
  for (const [stage, bucketRows] of buckets) {
    rollups.push({ stage, ...sumBucket(bucketRows) });
  }

  rollups.sort((a, b) => byStageSortOrder(a.stage, b.stage));
  return rollups;
}

/**
 * Total row count + summed estimated value + summed weighted value across every
 * row, regardless of stage (nulls counted as 0). Empty input → zeroed totals.
 *
 * Pure: the input array and its rows are never mutated.
 */
export function grandTotal(rows: readonly PipelineTableRow[]): GrandTotal {
  return { ...sumBucket(rows) };
}

/**
 * Produce the flattened render stream the table's single virtualizer consumes.
 *
 * - When `!grouped`: a flat passthrough — `rows` mapped 1:1 to `data` items in
 *   their original order, with no headers. `collapsedStages` is ignored (it has
 *   no meaning without group headers to collapse).
 * - When `grouped`: for each stage present (ordered by
 *   `OPPORTUNITY_STAGE_SORT_ORDER`) emit one `group-header` item carrying that
 *   stage's count/sums and `collapsed = collapsedStages.has(stage)`, then —
 *   unless the stage is collapsed — emit each of that stage's data items in
 *   their incoming relative order. A collapsed stage emits ONLY its header.
 *
 * Empty input → `[]`. Pure: neither `rows` nor `opts.collapsedStages` is
 * mutated, and output is deterministic across repeated calls.
 */
export function buildFlattenedRows(
  rows: readonly PipelineTableRow[],
  opts: { grouped: boolean; collapsedStages: ReadonlySet<OpportunityStage> },
): PipelineFlatItem[] {
  if (!opts.grouped) {
    return rows.map((row) => ({ kind: "data", row }));
  }

  const buckets = bucketByStage(rows);
  const orderedStages = [...buckets.keys()].sort(byStageSortOrder);

  const flattened: PipelineFlatItem[] = [];
  for (const stage of orderedStages) {
    const bucketRows = buckets.get(stage)!;
    const collapsed = opts.collapsedStages.has(stage);

    flattened.push({
      kind: "group-header",
      stage,
      ...sumBucket(bucketRows),
      collapsed,
    });

    if (!collapsed) {
      for (const row of bucketRows) {
        flattened.push({ kind: "data", row });
      }
    }
  }

  return flattened;
}
