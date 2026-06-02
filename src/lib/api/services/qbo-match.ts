/**
 * OPS Web - QuickBooks customer match resolver (pure).
 *
 * Decision order (spec §7):
 *   1. email exact (case-insensitive, trimmed)      → link, high
 *   2. normalized-name exact (single)               → link, medium
 *      normalized-name exact (>1)                   → needs_review, medium
 *   3. pg_trgm fuzzy candidate (≥0.6, supplied by RPC) → link, low
 *   4. else                                          → create, none
 *
 * Nothing is written to clients here — this only proposes.
 */

import { normalizeCompanyName } from "@/lib/utils/name-normalization";
import type { MatchAction } from "@/lib/types/qbo-import";

export interface ExistingClient {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
}

/** A fuzzy candidate row as returned by qbo_match_customer_candidates. */
export interface FuzzyCandidate {
  client_id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  similarity: number;
}

/** Staged-customer subset the resolver needs. */
export interface CustomerMatchInput {
  qb_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface CandidateView {
  client_id: string;
  name: string;
  email: string | null;
  basis: "email" | "name_exact" | "name_fuzzy";
  similarity: number | null;
}

export interface CustomerMatchResult {
  customer_qb_id: string;
  proposed_action: MatchAction;
  matched_client_id: string | null;
  match_basis: "email" | "name_exact" | "name_fuzzy" | "none";
  confidence: "high" | "medium" | "low" | null;
  candidates: CandidateView[];
}

function normEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

export function resolveCustomerMatch(
  staged: CustomerMatchInput,
  existing: ExistingClient[],
  fuzzy: FuzzyCandidate[]
): CustomerMatchResult {
  const qbId = staged.qb_id;

  // 1. Email exact ─────────────────────────────────────────────────────────
  const stagedEmail = normEmail(staged.email);
  if (stagedEmail) {
    const emailHits = existing.filter((c) => normEmail(c.email) === stagedEmail);
    if (emailHits.length >= 1) {
      const hit = emailHits[0];
      return {
        customer_qb_id: qbId,
        proposed_action: "link",
        matched_client_id: hit.id,
        match_basis: "email",
        confidence: "high",
        candidates: emailHits.map((c) => ({
          client_id: c.id, name: c.name, email: c.email, basis: "email", similarity: null,
        })),
      };
    }
  }

  // 2. Normalized-name exact ─────────────────────────────────────────────────
  const stagedName = staged.display_name ? normalizeCompanyName(staged.display_name) : "";
  if (stagedName.length > 0) {
    const nameHits = existing.filter((c) => normalizeCompanyName(c.name) === stagedName);
    if (nameHits.length === 1) {
      return {
        customer_qb_id: qbId,
        proposed_action: "link",
        matched_client_id: nameHits[0].id,
        match_basis: "name_exact",
        confidence: "medium",
        candidates: nameHits.map((c) => ({
          client_id: c.id, name: c.name, email: c.email, basis: "name_exact", similarity: null,
        })),
      };
    }
    if (nameHits.length > 1) {
      return {
        customer_qb_id: qbId,
        proposed_action: "needs_review",
        matched_client_id: null,
        match_basis: "name_exact",
        confidence: "medium",
        candidates: nameHits.map((c) => ({
          client_id: c.id, name: c.name, email: c.email, basis: "name_exact", similarity: null,
        })),
      };
    }
  }

  // 3. Fuzzy (pg_trgm ≥ 0.6, supplied by RPC) ───────────────────────────────
  if (fuzzy.length > 0) {
    const best = [...fuzzy].sort((a, b) => b.similarity - a.similarity)[0];
    return {
      customer_qb_id: qbId,
      proposed_action: "link",
      matched_client_id: best.client_id,
      match_basis: "name_fuzzy",
      confidence: "low",
      candidates: fuzzy.map((c) => ({
        client_id: c.client_id, name: c.name, email: c.email, basis: "name_fuzzy", similarity: c.similarity,
      })),
    };
  }

  // 4. No match → create ─────────────────────────────────────────────────────
  return {
    customer_qb_id: qbId,
    proposed_action: "create",
    matched_client_id: null,
    match_basis: "none",
    confidence: null,
    candidates: [],
  };
}
