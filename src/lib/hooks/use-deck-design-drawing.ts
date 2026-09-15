/**
 * Deck drawing reads, addressed by what the caller has in hand.
 *
 * The viewer only ever knows a design id, and the project workspace only ever
 * knows a project id — so each gets its own entry point rather than a shared
 * "deck data" hook that both would have to over-fetch through.
 */

export {
  useDeckDesignDrawing,
  useProjectDeckDesigns,
} from "./use-opportunity-deck-designs";
