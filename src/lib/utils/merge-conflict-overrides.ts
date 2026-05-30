/**
 * Pure helpers for the merge RESOLVE step (Surface 1).
 *
 * Translate the operator's per-loser, per-field selections into the
 * `confirmedOverrides` payload the merge route forwards to the guarded merge
 * RPC. Only fields where the operator chose USE ABSORBED (the loser value) are
 * emitted — KEEP WINNER fields are omitted because the winner already holds
 * them. The RPC applies fill-blank server-side regardless.
 */

import type {
  ConflictSelections,
  ConfirmedOverrides,
  MergeConflictsResult,
} from "@/lib/hooks/use-duplicate-reviews";

/**
 * Build the `confirmedOverrides` payload from operator selections.
 *
 * Shape rules (mirror the merge route + service):
 *  - single loser  → flat `{ field: loserValue }` (the `mergeEntities` path)
 *  - multiple losers → keyed `{ [loserId]: { field: loserValue } }`
 *    (the `mergeCluster` path)
 *
 * @param perLoser     the conflicts as returned by /api/duplicates/conflicts
 * @param selections   operator choice per loser per field ('winner' | 'loser')
 */
export function buildConfirmedOverrides(
  perLoser: MergeConflictsResult["perLoser"],
  selections: ConflictSelections
): ConfirmedOverrides {
  const multiLoser = perLoser.length > 1;

  if (!multiLoser) {
    const only = perLoser[0];
    if (!only) return {};
    return overridesForLoser(only, selections[only.loserId] ?? {});
  }

  const keyed: Record<string, Record<string, unknown>> = {};
  for (const entry of perLoser) {
    const forLoser = overridesForLoser(entry, selections[entry.loserId] ?? {});
    if (Object.keys(forLoser).length > 0) {
      keyed[entry.loserId] = forLoser;
    }
  }
  return keyed;
}

function overridesForLoser(
  entry: MergeConflictsResult["perLoser"][number],
  fieldChoices: Record<string, "winner" | "loser">
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const conflict of entry.reconciliation.conflicts) {
    if (fieldChoices[conflict.field] === "loser") {
      out[conflict.field] = conflict.loserValue;
    }
  }
  return out;
}

/** Total number of conflict fields across every loser. */
export function countConflicts(perLoser: MergeConflictsResult["perLoser"]): number {
  return perLoser.reduce((acc, l) => acc + l.reconciliation.conflicts.length, 0);
}

/**
 * True once every conflict across every loser has an explicit operator choice.
 * Architect decision: force explicit per-field resolution — the CONFIRM CTA
 * stays disabled until this returns true (no safe default).
 */
export function allConflictsResolved(
  perLoser: MergeConflictsResult["perLoser"],
  selections: ConflictSelections
): boolean {
  for (const entry of perLoser) {
    const fieldChoices = selections[entry.loserId];
    for (const conflict of entry.reconciliation.conflicts) {
      const choice = fieldChoices?.[conflict.field];
      if (choice !== "winner" && choice !== "loser") return false;
    }
  }
  return true;
}

/** Count of conflicts the operator has resolved (for the success notification). */
export function countResolved(
  perLoser: MergeConflictsResult["perLoser"],
  selections: ConflictSelections
): number {
  let n = 0;
  for (const entry of perLoser) {
    const fieldChoices = selections[entry.loserId];
    for (const conflict of entry.reconciliation.conflicts) {
      const choice = fieldChoices?.[conflict.field];
      if (choice === "winner" || choice === "loser") n += 1;
    }
  }
  return n;
}
