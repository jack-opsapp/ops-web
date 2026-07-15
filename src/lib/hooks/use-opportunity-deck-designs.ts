/**
 * OPS Web — Opportunity Deck Design Hook
 *
 * Read-only query for `deck_designs` rows attached to a lead
 * (`deck_designs.opportunity_id`). Decks are authored on iOS; the pipeline
 * detail renders them view-only. Realtime isn't wired for this table — the
 * detail window refetches on mount/focus, which matches how often a deck
 * changes mid-review.
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { DeckDesignService } from "../api/services/deck-design-service";

export function useOpportunityDeckDesigns(opportunityId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.opportunities.deckDesigns(opportunityId ?? ""),
    queryFn: () => DeckDesignService.fetchForOpportunity(opportunityId!),
    enabled: !!opportunityId,
  });
}
