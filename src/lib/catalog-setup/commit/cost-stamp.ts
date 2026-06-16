// Post-commit unit_cost stamp (spec §9 SELL — products.unit_cost).
//
// `catalog_setup_save` writes the catalog but does NOT touch products.unit_cost
// (verified against prod: the 6386-line RPC body never references it — absent
// from the products INSERT column list AND both ON CONFLICT DO UPDATE clauses).
// So a freshly CREATED product lands with a NULL cost even when the wizard
// captured one, and the card's COST / MARGIN evaporate at commit. This is that
// stamp: after a successful commit, write each created SELL card's cost onto its
// row, resolving the row id from the RPC's returned `id_map` (client_id → row id).
//
// MERGE cards are DELIBERATELY excluded: the RPC leaves a matched row's unit_cost
// untouched on UPSERT, so the on-file cost already survives — and cost is not a
// per-field show-diff verdict (CanvasPane.buildDiff excludes it), so a re-import
// must never overwrite the live cost with the incoming one. Only pure creates
// (no matchedExistingId) get stamped.
//
// Mirrors external-identity-stamp.ts: the DB write is best-effort + idempotent
// (re-stamping the same value is a no-op). The rows are already live, so a stamp
// failure must never fail the commit — it only means a created product keeps the
// pre-existing NULL cost (no regression over today). The collector is PURE +
// unit-tested; the writer is a thin, company-scoped UPDATE.

import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMITTABLE_STATES, type StagingCard } from "../staging-card";

/** One row to stamp with its unit cost. */
export interface CostStampTarget {
  /** The live row id (products.id) to stamp. */
  rowId: string;
  unitCost: number;
}

/**
 * Collect the created SELL rows whose cost the RPC dropped, from the committed
 * cards + the RPC id_map. Pure. Only committable CREATE cards (no
 * matchedExistingId — a merge preserves its on-file cost) that carry a unit cost
 * qualify, and only when the id_map resolved them to a real row.
 */
export function collectCostStampTargets(
  cards: StagingCard[],
  idMap: Record<string, unknown>,
): CostStampTarget[] {
  const out: CostStampTarget[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (card.module !== "sell") continue;
    if (!(COMMITTABLE_STATES as readonly string[]).includes(card.state)) continue;
    // A merge keeps its on-file cost (the RPC never overwrites unit_cost); only a
    // fresh create needs its captured cost written back.
    if (card.matchedExistingId) continue;
    const cost = card.fields.unitCost;
    if (cost == null) continue;
    const mapped = idMap[card.id];
    if (typeof mapped !== "string" || seen.has(mapped)) continue;
    seen.add(mapped);
    out.push({ rowId: mapped, unitCost: cost });
  }
  return out;
}

/**
 * Stamp unit_cost onto the resolved created-product rows. Best-effort: returns
 * the count stamped + any first error, NEVER throws — the caller treats a failure
 * as a non-fatal warning (the rows are already committed; a miss just leaves the
 * pre-existing NULL cost). Each UPDATE is company-scoped and idempotent.
 */
export async function stampUnitCost(
  db: SupabaseClient,
  companyId: string,
  targets: CostStampTarget[],
): Promise<{ stamped: number; error?: unknown }> {
  if (targets.length === 0) return { stamped: 0 };
  let stamped = 0;
  let firstError: unknown;
  const results = await Promise.allSettled(
    targets.map((tgt) =>
      db
        .from("products")
        .update({ unit_cost: tgt.unitCost })
        .eq("id", tgt.rowId)
        .eq("company_id", companyId),
    ),
  );
  for (const r of results) {
    if (r.status === "fulfilled" && !r.value?.error) stamped += 1;
    else if (r.status === "fulfilled") firstError ??= r.value.error;
    else firstError ??= r.reason;
  }
  return firstError ? { stamped, error: firstError } : { stamped };
}
