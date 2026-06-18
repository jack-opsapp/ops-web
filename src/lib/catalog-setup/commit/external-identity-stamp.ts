// Post-commit external-identity stamp (spec §11, §15).
//
// `catalog_setup_save` writes the catalog but does NOT touch external_source /
// external_id (verified against prod: the RPC body never references them). Those
// additive columns + their partial unique indexes
// (uniq_products_external_id_per_company) exist precisely so a re-import re-syncs
// the SAME row instead of duplicating — but only if SOMETHING stamps them. This
// is that something: after a successful commit, stamp every import-sourced SELL
// card's row with its source system + that system's stable id (the QB Item.Id),
// resolving the row id from the RPC's returned `id_map` (client_id → row id) or
// the card's matched-existing id.
//
// Why this matters: matchCards keys on external_id FIRST. With it stamped, a
// later pull re-matches a row even after its sku/name DRIFTED (a rename), so the
// merge binds and the commit UPSERTs by id — instead of an unmatched create that
// the partial unique index would hard-reject. Without stamping, the external_id
// precedence is inert and re-import degrades to sku/name only.
//
// The DB write is best-effort + idempotent (re-stamping the same value is a
// no-op): the rows are already live, so a stamp failure must never fail the
// commit — it only means the NEXT pull falls back to sku/name matching. The
// collector is PURE + unit-tested; the writer is a thin, scoped UPDATE.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StagingCard } from "../staging-card";

/** One row to stamp with its external identity. */
export interface ExternalStampTarget {
  /** The live row id (products.id) to stamp. */
  rowId: string;
  externalSource: string;
  externalId: string;
}

/**
 * Collect the SELL rows to stamp from the committed cards + the RPC id_map.
 * Pure. Only committable cards that carry BOTH an external source and id qualify
 * (manual / agent cards have neither → nothing to stamp). STOCK is out of scope
 * for the v1 QB lane (catalog_variants stamping lands with stock import).
 */
export function collectExternalStampTargets(
  cards: StagingCard[],
  idMap: Record<string, unknown>,
): ExternalStampTarget[] {
  const out: ExternalStampTarget[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (card.module !== "sell") continue;
    if (!card.externalSource || !card.externalId) continue;
    // Only cards that were actually committed (accepted / edited / merge) have a
    // resolvable row. A merge card carries its matched id; a fresh create resolves
    // via the RPC id_map keyed by the product client id (= card.id).
    const mapped = idMap[card.id];
    const rowId =
      card.matchedExistingId ?? (typeof mapped === "string" ? mapped : null);
    if (!rowId || seen.has(rowId)) continue;
    seen.add(rowId);
    out.push({
      rowId,
      externalSource: card.externalSource,
      externalId: card.externalId,
    });
  }
  return out;
}

/**
 * Stamp external_source/external_id onto the resolved product rows. Best-effort:
 * returns the count stamped + any first error, NEVER throws — the caller treats a
 * failure as a non-fatal warning (the rows are already committed). Each UPDATE is
 * company-scoped and idempotent.
 */
export async function stampExternalIdentity(
  db: SupabaseClient,
  companyId: string,
  targets: ExternalStampTarget[],
): Promise<{ stamped: number; error?: unknown }> {
  if (targets.length === 0) return { stamped: 0 };
  let stamped = 0;
  let firstError: unknown;
  const results = await Promise.allSettled(
    targets.map((tgt) =>
      db
        .from("products")
        .update({
          external_source: tgt.externalSource,
          external_id: tgt.externalId,
        })
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
