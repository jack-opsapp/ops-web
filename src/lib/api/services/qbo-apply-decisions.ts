/**
 * OPS Web - QuickBooks import apply decisions (pure; client + server safe).
 *
 * The one rule for "is this customer decision finished?", shared by the review
 * table (row treatment), the Apply panel (button lock), the apply route (422),
 * and the apply engine (abort before any write).
 *
 * An unfinished decision is never applied: the engine resolves a customer with
 * no OPS client to "skipped", and a skipped customer's estimates, invoices,
 * line items, and payments are dropped with it. A Link with no client chosen,
 * or a needs_review the operator never resolved, would silently lose that
 * customer's money — so both block the whole apply instead.
 */

import type { MatchAction } from "@/lib/types/qbo-import";

export type UnresolvedReason = "link_without_client" | "needs_review";

export interface UnresolvedDecision {
  customer_qb_id: string;
  reason: UnresolvedReason;
}

interface DecisionLike {
  action: MatchAction;
  client_id?: string | null;
}

/** Why a single decision is unfinished, or null when it is safe to apply. */
export function unresolvedReason(decision: DecisionLike): UnresolvedReason | null {
  if (decision.action === "needs_review") return "needs_review";
  if (decision.action === "link") {
    const clientId = typeof decision.client_id === "string" ? decision.client_id.trim() : "";
    if (clientId.length === 0) return "link_without_client";
  }
  return null;
}

export function isUnresolvedDecision(decision: DecisionLike): boolean {
  return unresolvedReason(decision) !== null;
}

/** Every unfinished decision in an apply payload, in payload order. */
export function findUnresolvedDecisions(
  decisions: ReadonlyArray<DecisionLike & { customer_qb_id: string }>
): UnresolvedDecision[] {
  const out: UnresolvedDecision[] = [];
  for (const d of decisions) {
    const reason = unresolvedReason(d);
    if (reason) out.push({ customer_qb_id: d.customer_qb_id, reason });
  }
  return out;
}

/** Operator-facing counts for the Apply panel lock. */
export function countUnresolvedDecisions(
  decisions: ReadonlyArray<DecisionLike>
): { needsReview: number; linkWithoutClient: number } {
  let needsReview = 0;
  let linkWithoutClient = 0;
  for (const d of decisions) {
    const reason = unresolvedReason(d);
    if (reason === "needs_review") needsReview += 1;
    else if (reason === "link_without_client") linkWithoutClient += 1;
  }
  return { needsReview, linkWithoutClient };
}

/** Error message the engine raises (and records on the run) for an unfinished payload. */
export function unresolvedDecisionsMessage(unresolved: UnresolvedDecision[]): string {
  const links = unresolved.filter((u) => u.reason === "link_without_client").map((u) => u.customer_qb_id);
  const reviews = unresolved.filter((u) => u.reason === "needs_review").map((u) => u.customer_qb_id);
  const parts: string[] = [];
  if (links.length) parts.push(`link with no OPS client: ${links.join(", ")}`);
  if (reviews.length) parts.push(`needs review: ${reviews.join(", ")}`);
  return `Apply refused — ${unresolved.length} customer decision(s) unfinished (${parts.join("; ")}). Nothing was written.`;
}
