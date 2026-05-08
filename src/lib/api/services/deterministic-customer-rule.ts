/**
 * OPS Web — Deterministic CUSTOMER Thread Classification
 *
 * When an email thread is already linked to an opportunity in a non-terminal
 * stage, the thread is — by definition — a customer conversation. We classify
 * it as CUSTOMER without consulting the LLM. This sidesteps the recurring bug
 * where the legacy LLM prompt emits LEAD/CLIENT (collapsed away by migration
 * 20260428061836_collapse_lead_client_to_customer), the values pass TypeScript
 * validation, and then the DB CHECK constraint rejects the UPDATE — leaving
 * the thread frozen at primary_category='OTHER'.
 *
 * The pure rule lives here. DB reads (the opportunity stage lookup) live in
 * `deterministic-customer-reads.ts` so the rule stays independently testable.
 *
 * The rule bails (returns null) when:
 *   1. The user has manually set the category — respect their choice.
 *   2. There is no linked opportunity.
 *   3. The opportunity is archived.
 *   4. The opportunity stage is terminal (lost / discarded) — those threads
 *      should be re-evaluated by the LLM and the closed-opp-assessment
 *      pipeline, not auto-pinned to CUSTOMER.
 *
 * When the rule fires, the thread is written with:
 *   - primary_category            = "CUSTOMER"
 *   - category_confidence         = 1
 *   - category_classifier_version = "customer-deterministic-v1"
 *   - ai_summary                  = "Linked to <stage> opportunity about <subject>."
 * and the classifier call is skipped entirely.
 *
 * The deterministic INTERNAL rule runs first in classifyAndUpdate; if every
 * participant is a company user, INTERNAL wins. This rule only fires for
 * external-participant threads with a live opportunity link.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CustomerOpportunityStage =
  | "new_lead"
  | "qualifying"
  | "quoting"
  | "quoted"
  | "negotiation"
  | "follow_up"
  | "won";

/**
 * Stages that mark an opportunity as still in flight (or recently won — won
 * threads still belong in the customer rail because the user typically has
 * scheduling, deposit, and warranty correspondence right after the win).
 *
 * Excludes terminal-negative stages (`lost`, `discarded`) so dead deals don't
 * keep masquerading as customer threads.
 */
export const LIVE_CUSTOMER_OPPORTUNITY_STAGES: readonly CustomerOpportunityStage[] = [
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "negotiation",
  "follow_up",
  "won",
] as const;

const LIVE_STAGE_SET = new Set<string>(LIVE_CUSTOMER_OPPORTUNITY_STAGES);

export interface DeterministicCustomerInput {
  subject: string;
  /** Null when the thread has no linked opportunity. */
  opportunityId: string | null;
  /** Stage of the linked opportunity. Null when opportunityId is null. */
  opportunityStage: string | null;
  /** Set when the opportunity has been archived (soft-deleted). */
  opportunityArchivedAt: string | null;
  categoryManuallySet: boolean;
}

export interface DeterministicCustomerResult {
  category: "CUSTOMER";
  summary: string;
  classifierVersion: "customer-deterministic-v1";
  confidence: 1;
}

// ─── Rule ────────────────────────────────────────────────────────────────────

export function tryDeterministicCustomer(
  input: DeterministicCustomerInput
): DeterministicCustomerResult | null {
  if (input.categoryManuallySet) return null;
  if (!input.opportunityId) return null;
  if (input.opportunityArchivedAt) return null;

  const stage = (input.opportunityStage ?? "").trim().toLowerCase();
  if (!LIVE_STAGE_SET.has(stage)) return null;

  return {
    category: "CUSTOMER",
    summary: buildSummary(stage, input.subject),
    classifierVersion: "customer-deterministic-v1",
    confidence: 1,
  };
}

// ─── Summary template ────────────────────────────────────────────────────────

function buildSummary(stage: string, subject: string): string {
  const topic = subject.trim() || "(no subject)";
  const stageLabel = stage.replace(/_/g, " ");
  return `Linked to a ${stageLabel} opportunity — ${topic}.`;
}
