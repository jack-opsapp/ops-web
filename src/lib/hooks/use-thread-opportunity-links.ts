/**
 * Compatibility helper for consumers that already hold the canonical
 * opportunity id returned by an authorized inbox detail response.
 */
export function authorizedThreadOpportunityIds(
  opportunityId: string | null | undefined
): string[] {
  return opportunityId ? [opportunityId] : [];
}
