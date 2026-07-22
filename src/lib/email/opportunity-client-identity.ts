export interface OpportunityClientMirrors {
  clientId: string | null | undefined;
  clientRef: string | null | undefined;
}

function normalizedMirror(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

/**
 * Resolve the canonical customer relationship carried by the opportunity's
 * UUID mirror pair. Historical rows may contain only one mirror, but a row
 * whose populated mirrors disagree is never safe for automated lifecycle
 * identity, matching, summary, or conversion work.
 */
export function resolveGuardedOpportunityClientId({
  clientId,
  clientRef,
}: OpportunityClientMirrors): string | null {
  const legacyClientId = normalizedMirror(clientId);
  const canonicalClientRef = normalizedMirror(clientRef);

  if (
    legacyClientId &&
    canonicalClientRef &&
    legacyClientId !== canonicalClientRef
  ) {
    throw new Error(
      "Opportunity client mirrors disagree; automatic email lifecycle processing is blocked"
    );
  }

  return canonicalClientRef ?? legacyClientId;
}
