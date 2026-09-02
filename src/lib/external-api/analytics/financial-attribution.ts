export type FinancialAttributionCandidate = Readonly<{
  directOpportunityId: string | null;
  projectOpportunityId: string | null;
}>;

export type FinancialAttribution =
  | Readonly<{ outcome: "attributed"; opportunityId: string }>
  | Readonly<{ outcome: "unattributed" | "ambiguous"; opportunityId: null }>;

export function resolveFinancialAttribution(
  candidate: FinancialAttributionCandidate
): FinancialAttribution {
  if (candidate.directOpportunityId) {
    return {
      outcome: "attributed",
      opportunityId: candidate.directOpportunityId,
    };
  }
  if (candidate.projectOpportunityId) {
    return {
      outcome: "attributed",
      opportunityId: candidate.projectOpportunityId,
    };
  }
  return { outcome: "unattributed", opportunityId: null };
}

export function resolveFinancialAttributionCandidates(
  candidates: readonly FinancialAttributionCandidate[]
): FinancialAttribution {
  const attributed = new Set(
    candidates
      .map(resolveFinancialAttribution)
      .filter(
        (
          result
        ): result is Extract<FinancialAttribution, { outcome: "attributed" }> =>
          result.outcome === "attributed"
      )
      .map((result) => result.opportunityId)
  );
  if (attributed.size === 0) {
    return { outcome: "unattributed", opportunityId: null };
  }
  if (attributed.size > 1) {
    return { outcome: "ambiguous", opportunityId: null };
  }
  return { outcome: "attributed", opportunityId: [...attributed][0] };
}
