/**
 * Pure state machine for the composer's draft state.
 *
 *   empty              → no drafts
 *   drafts-available   → drafts have been received, none loaded yet
 *   ai-loaded          → Claude draft is in the textarea, untouched
 *   edited-from-claude → Claude draft loaded, then the user typed in it
 *   user-typed         → user-authored content (or a non-Claude draft loaded)
 *
 * Events:
 *   RECEIVE_DRAFTS(n)               — drafts arrived from the API
 *   LOAD_DRAFT(source, confirmDiscard?) — user picked a draft from the switcher.
 *                                       If switching FROM edited-from-claude TO
 *                                       any other source, requires
 *                                       confirmDiscard:true to proceed.
 *   EDIT_BODY                       — user typed in the textarea
 *   REVERT                          — restore the original Claude draft
 *   SEND                            — message went out
 *   CLEAR                           — reset (e.g. thread switched)
 */

import type { DraftSource } from "@/components/ops/inbox/composer/draft-switcher";

export type DraftState =
  | "empty"
  | "drafts-available"
  | "ai-loaded"
  | "edited-from-claude"
  | "user-typed";

export type DraftEvent =
  | { type: "RECEIVE_DRAFTS"; count: number }
  | { type: "LOAD_DRAFT"; source: DraftSource; confirmDiscard?: boolean }
  | { type: "EDIT_BODY" }
  | { type: "REVERT" }
  | { type: "SEND" }
  | { type: "CLEAR" };

function loadDraft(prev: DraftState, source: DraftSource): DraftState {
  return source === "claude" ? "ai-loaded" : "user-typed";
}

export function nextDraftState(prev: DraftState, event: DraftEvent): DraftState {
  if (event.type === "SEND" || event.type === "CLEAR") return "empty";

  switch (prev) {
    case "empty":
      if (event.type === "RECEIVE_DRAFTS") {
        return event.count > 0 ? "drafts-available" : "empty";
      }
      return prev;

    case "drafts-available":
      if (event.type === "LOAD_DRAFT") return loadDraft(prev, event.source);
      if (event.type === "RECEIVE_DRAFTS") {
        return event.count > 0 ? "drafts-available" : "empty";
      }
      return prev;

    case "ai-loaded":
      if (event.type === "EDIT_BODY") return "edited-from-claude";
      if (event.type === "LOAD_DRAFT") return loadDraft(prev, event.source);
      return prev;

    case "edited-from-claude":
      if (event.type === "REVERT") return "ai-loaded";
      if (event.type === "EDIT_BODY") return "edited-from-claude";
      if (event.type === "LOAD_DRAFT") {
        if (event.source === "claude") return "ai-loaded";
        return event.confirmDiscard ? loadDraft(prev, event.source) : prev;
      }
      return prev;

    case "user-typed":
      if (event.type === "LOAD_DRAFT") return loadDraft(prev, event.source);
      if (event.type === "EDIT_BODY") return "user-typed";
      return prev;
  }
}
