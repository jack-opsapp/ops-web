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

/**
 * Every lead-attached deck in the company, for the board's and table's deck
 * glyph. One shared cache entry serves every card on the surface, so the
 * glance layer costs one request no matter how many leads are rendered.
 */
export function useLeadDeckMarkers() {
  return useQuery({
    queryKey: queryKeys.opportunities.deckMarkers(),
    queryFn: () => DeckDesignService.fetchLeadDeckMarkers(),
  });
}

/**
 * One design's complete `drawing_data` — the fullscreen viewer's read, kept
 * out of the list query so opening a deck never re-fetches every other deck,
 * and so the row list stays cheap for leads with several designs.
 */
export function useDeckDesignDrawing(designId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.opportunities.deckDrawing(designId ?? ""),
    queryFn: () => DeckDesignService.fetchDesignWithDrawing(designId!),
    enabled: !!designId,
  });
}

/**
 * Every deck design attached to a PROJECT — the workspace's `// DECK DESIGN`
 * section (report acc0d021). A deck carries `project_id` from the moment the
 * lead converts, so the sketch the crew made on the site visit follows the job
 * into the build instead of being stranded on the closed lead.
 */
export function useProjectDeckDesigns(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.deckDesigns(projectId ?? ""),
    queryFn: () => DeckDesignService.fetchForProject(projectId!),
    enabled: !!projectId,
  });
}
