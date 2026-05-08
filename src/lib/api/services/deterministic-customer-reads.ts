/**
 * OPS Web — DB reads for the deterministic-customer-rule.
 *
 * Split from the rule itself so the pure rule stays testable without loading
 * Supabase. Mirrors the pattern used by `deterministic-internal-reads.ts`.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

export interface OpportunityForCustomerRule {
  stage: string | null;
  archivedAt: string | null;
}

/**
 * Look up the linked opportunity's stage and archive state for a thread. Used
 * by EmailThreadService.classifyAndUpdate to decide whether the deterministic
 * CUSTOMER rule should fire. Returns null when the opportunity is missing
 * (deleted, soft-deleted via deleted_at, or simply not yet hydrated).
 */
export async function loadOpportunityForCustomerRule(
  opportunityId: string
): Promise<OpportunityForCustomerRule | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("opportunities")
    .select("stage, archived_at, deleted_at")
    .eq("id", opportunityId)
    .maybeSingle();

  if (error) {
    console.error(
      "[deterministic-customer-reads] loadOpportunityForCustomerRule failed:",
      error.message
    );
    return null;
  }
  if (!data) return null;
  if (data.deleted_at) return null;

  return {
    stage: (data.stage as string | null) ?? null,
    archivedAt: (data.archived_at as string | null) ?? null,
  };
}
