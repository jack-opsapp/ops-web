import "server-only";
import { loadEditorialBrief } from "./brief";
import {
  loadCopywritingReference,
  loadOpsCopywriterBrief,
} from "./copywriting-reference";
import { createEditorialHandoffHandlers } from "./handoff";
import { createEditorialRepository } from "./repository";

// Composition root for the three authoring routes: the handlers themselves stay
// pure so their boundary can be proved without a database.
export function editorialHandoffHandlers() {
  return createEditorialHandoffHandlers({
    repository: createEditorialRepository(),
    now: () => new Date(),
    loadBrief: loadEditorialBrief,
    loadGuide: loadCopywritingReference,
    loadVoice: loadOpsCopywriterBrief,
  });
}
