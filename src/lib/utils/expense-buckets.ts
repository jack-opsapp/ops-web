/**
 * OPS Web - Expense Batch Lifecycle Buckets
 *
 * Pure derivation for the Books expense console. Every batch lands in exactly
 * one bucket, mirroring what the operator owes attention to:
 *
 *   review — submitted envelopes waiting on the office (pending_review + legacy submitted)
 *   pay    — approved money not yet settled up (approved / partially / auto, paid_at IS NULL)
 *   paid   — payout recorded (paid_at set), terminal reference
 *   crew   — on the crew's side: filling envelopes + returned (rejected) batches
 *            that still hold lines to fix; a drained returned batch disappears
 *
 * All functions are pure and side-effect free so they unit-test cold.
 */

import {
  ExpenseBatchStatus,
  isBatchNeedsReview,
  isBatchAwaitingPayout,
  isBatchPaid,
  isBatchFilling,
  batchOwedAmount,
  getBatchDisplayName,
  type ExpenseBatch,
  type ExpenseLineItem,
} from "@/lib/types/expense-approval";

export type ExpenseBucket = "review" | "pay" | "paid" | "crew";

// ─── Line stats ───────────────────────────────────────────────────────────────

export interface BatchLineStats {
  count: number;
  flagged: number;
}

/**
 * Per-batch line counts + flag counts from the company-wide line list.
 * Unbatched lines (drafts not yet placed) carry no batch and are skipped.
 */
export function batchLineStats(
  expenses: ExpenseLineItem[]
): Map<string, BatchLineStats> {
  const stats = new Map<string, BatchLineStats>();
  for (const line of expenses) {
    if (!line.batchId) continue;
    const entry = stats.get(line.batchId) ?? { count: 0, flagged: 0 };
    entry.count += 1;
    if (line.flagComment) entry.flagged += 1;
    stats.set(line.batchId, entry);
  }
  return stats;
}

// ─── Bucket assignment ────────────────────────────────────────────────────────

/**
 * The one bucket a batch belongs to, or null when it should not render at all
 * (a returned batch whose lines have all been re-filed by the crew).
 *
 * `lineCount` is the batch's live line count when known; omit it while stats
 * are still loading and the batch stays visible.
 */
export function bucketForBatch(
  batch: ExpenseBatch,
  lineCount?: number
): ExpenseBucket | null {
  if (isBatchPaid(batch)) return "paid";
  if (isBatchNeedsReview(batch.status)) return "review";
  if (isBatchAwaitingPayout(batch)) return "pay";
  if (isBatchFilling(batch.status)) return "crew";
  if (batch.status === ExpenseBatchStatus.Rejected) {
    return lineCount === 0 ? null : "crew";
  }
  // Unknown/new server status — keep it discoverable rather than vanish it.
  return "crew";
}

/** Deep-link resolution: which bucket a `?batch=` target renders under. */
export function bucketOfBatch(
  batch: ExpenseBatch,
  lineCount?: number
): ExpenseBucket | null {
  return bucketForBatch(batch, lineCount);
}

// ─── Person grouping ──────────────────────────────────────────────────────────

export interface PersonGroup {
  /** users.id, or "unknown" for orphaned submitter references. */
  userId: string;
  /** Display-ready name resolved from the batch's merged submitter. */
  name: string;
  submitter: ExpenseBatch["submitter"];
  batches: ExpenseBatch[];
  total: number;
}

function groupBySubmitter(
  batches: ExpenseBatch[],
  amountOf: (batch: ExpenseBatch) => number
): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const batch of batches) {
    const key = batch.submittedBy ?? "unknown";
    const group =
      groups.get(key) ??
      ({
        userId: key,
        name: getBatchDisplayName(batch),
        submitter: batch.submitter ?? null,
        batches: [],
        total: 0,
      } satisfies PersonGroup);
    group.batches.push(batch);
    group.total += amountOf(batch);
    if (!group.submitter && batch.submitter) {
      group.submitter = batch.submitter;
      group.name = getBatchDisplayName(batch);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

function periodStartValue(batch: ExpenseBatch): number {
  return batch.periodStart ? Date.parse(batch.periodStart) : Number.MAX_SAFE_INTEGER;
}

/**
 * TO REVIEW — grouped by person. People sort by their oldest outstanding
 * period (longest-waiting crew member leads the queue); a person's batches run
 * oldest first so review order matches submission order.
 */
export function groupForReview(batches: ExpenseBatch[]): PersonGroup[] {
  const groups = groupBySubmitter(batches, (b) => b.totalAmount ?? 0);
  for (const group of groups) {
    group.batches.sort((a, b) => periodStartValue(a) - periodStartValue(b));
  }
  groups.sort(
    (a, b) =>
      periodStartValue(a.batches[0]) - periodStartValue(b.batches[0]) ||
      a.name.localeCompare(b.name)
  );
  return groups;
}

/**
 * TO PAY — grouped by person, largest owed first (settle the big liabilities
 * first); a person's batches run oldest approval first.
 */
export function groupForPay(batches: ExpenseBatch[]): PersonGroup[] {
  const groups = groupBySubmitter(batches, batchOwedAmount);
  for (const group of groups) {
    group.batches.sort(
      (a, b) =>
        (a.reviewedAt ? Date.parse(a.reviewedAt) : 0) -
        (b.reviewedAt ? Date.parse(b.reviewedAt) : 0)
    );
  }
  groups.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return groups;
}

// ─── Paid month grouping ──────────────────────────────────────────────────────

export interface MonthGroup {
  /** Local-time month key, e.g. "2026-07". */
  key: string;
  batches: ExpenseBatch[];
  total: number;
}

/** Local-time "YYYY-MM" for a timestamp. */
export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** PAID — newest month first; within a month, newest payout first. */
export function groupPaidByMonth(batches: ExpenseBatch[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  const sorted = [...batches].sort(
    (a, b) =>
      (b.paidAt ? Date.parse(b.paidAt) : 0) - (a.paidAt ? Date.parse(a.paidAt) : 0)
  );
  for (const batch of sorted) {
    if (!batch.paidAt) continue;
    const key = monthKey(batch.paidAt);
    const group = groups.get(key) ?? { key, batches: [], total: 0 };
    group.batches.push(batch);
    group.total += batchOwedAmount(batch);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// ─── Crew ordering ────────────────────────────────────────────────────────────

/**
 * WITH CREW — filling envelopes first (current period leading), then returned
 * batches newest first.
 */
export function sortCrewBatches(batches: ExpenseBatch[]): ExpenseBatch[] {
  const filling = batches
    .filter((b) => isBatchFilling(b.status))
    .sort((a, b) => periodStartValue(b) - periodStartValue(a));
  const returned = batches
    .filter((b) => !isBatchFilling(b.status))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return [...filling, ...returned];
}
