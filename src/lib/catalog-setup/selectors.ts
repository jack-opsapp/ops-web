// Pure derived data for the live-building canvas. Kept OUT of the reducer so
// these stay cheap, memoizable, and unit-pure — the canvas re-derives them on
// every render from `StagingState`. Spec §7 (running totals), §16 (the
// "// N ROWS NEED A PRICE" build-it blocker).

import type { StagingState } from "./staging-reducer";
import {
  COMMITTABLE_STATES,
  type StagingCard,
  type RunningTotals,
} from "./staging-card";

const isCommittable = (c: StagingCard): boolean =>
  (COMMITTABLE_STATES as readonly string[]).includes(c.state);

/**
 * Header counters (spec §7 "N proposed · M added"). `added` rolls up every
 * committable state (accepted + edited + merge); rejected is counted separately
 * (it never reaches the commit and drops out of the visible canvas).
 */
export function selectRunningTotals(state: StagingState): RunningTotals {
  let proposed = 0;
  let added = 0;
  let rejected = 0;
  for (const c of state.cards) {
    if (c.state === "proposed") proposed++;
    else if (c.state === "rejected") rejected++;
    else added++; // accepted | edited | merge
  }
  return { proposed, added, rejected };
}

/**
 * Non-rejected cards grouped by module for the canvas columns (SELL / STOCK /
 * TYPES). Rejected cards drop out of the visible canvas; they stay in state only
 * so a re-fed source (idempotent ADD_CARDS) doesn't re-surface a dismissed row.
 */
export function selectByModule(
  state: StagingState,
): Record<"sell" | "stock" | "types", StagingCard[]> {
  const out = {
    sell: [] as StagingCard[],
    stock: [] as StagingCard[],
    types: [] as StagingCard[],
  };
  for (const c of state.cards) {
    if (c.state === "rejected") continue;
    out[c.module].push(c);
  }
  return out;
}

export type Blocker =
  | { kind: "missing_price"; count: number }
  | { kind: "missing_name"; count: number };

/**
 * Build-it blockers (spec §16). Only COMMITTABLE cards can block — a card the
 * owner hasn't accepted yet must never gate the commit. A merge card draws its
 * price/name from the matched live row, so a null price there is fine.
 */
export function selectBlockers(state: StagingState): Blocker[] {
  const blockers: Blocker[] = [];
  const committable = state.cards.filter(isCommittable);

  const missingPrice = committable.filter(
    (c) =>
      c.state !== "merge" &&
      c.module === "sell" &&
      (c.fields.defaultPrice === null || c.fields.defaultPrice === undefined),
  ).length;
  if (missingPrice > 0) blockers.push({ kind: "missing_price", count: missingPrice });

  const missingName = committable.filter((c) => {
    // SELL/STOCK identify by `name`; TYPES by `display`. Narrow on the
    // discriminant so each module reads its own label field (the union has no
    // shared `name` — TypeFields carries `display` instead).
    const label = c.module === "types" ? c.fields.display : c.fields.name;
    return !label || label.trim() === "";
  }).length;
  if (missingName > 0) blockers.push({ kind: "missing_name", count: missingName });

  return blockers;
}
