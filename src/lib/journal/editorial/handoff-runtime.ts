import "server-only";
import {
  createJournalHandoffHandlers,
  JournalSourceFetchError,
} from "./handoff";
import { createJournalRepository } from "./repository";
import { fetchJournalSource, JournalSourceError } from "./sources";
import { loadJournalBrief, loadJournalGuide, loadJournalProductFacts } from "./voice";

// Composition root for the four authoring routes: the handlers stay pure so
// their boundary can be proved without a database or a network.
export function journalHandoffHandlers() {
  return createJournalHandoffHandlers({
    repository: createJournalRepository(),
    now: () => new Date(),
    fetchSource: async (url) => {
      try {
        return await fetchJournalSource(url);
      } catch (error) {
        if (error instanceof JournalSourceError)
          throw new JournalSourceFetchError(error.code, error.status);
        throw error;
      }
    },
    loadBrief: loadJournalBrief,
    loadGuide: loadJournalGuide,
    loadFacts: loadJournalProductFacts,
  });
}
