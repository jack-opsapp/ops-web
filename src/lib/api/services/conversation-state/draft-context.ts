// src/lib/api/services/conversation-state/draft-context.ts
//
// Phase 1 — drafting contract. Turns a deterministic ConversationState into the
// prompt fragments the drafter needs, so a reply:
//   1. greets the ACTUAL latest inbound sender (state.recipient), never the
//      linked clients record,
//   2. never restates a price/commitment already sent (state.sentLedger), and
//   3. acknowledges attachments the customer sent (attachmentsRequiringInspection),
// reading from CLEAN (quote/signature-stripped) message bodies only.
//
// PURE: no DB, no network, no model. Unit-tested with inline fixtures. The
// drafter (ai-draft-service) builds the ConversationState and weaves these
// fragments into its system/user prompts, falling back to its legacy raw-data
// path when no state is available.

import type { CleanMessage, ConversationState } from "./types";

export interface DraftStateContext {
  /** Full name of the actual latest inbound sender (who we are replying to). */
  recipientName: string | null;
  /** Email of the actual latest inbound sender. */
  recipientEmail: string | null;
  /** Recipient's first name for the greeting, or null when unknown. */
  greetingFirstName: string | null;
  /** Thread rendered from CLEAN bodies, oldest→newest, with YOU/THEM markers. */
  cleanThread: string;
  /** The latest real customer inbound's clean body — what we are replying to. */
  latestCustomerText: string;
  /** "Already sent — do NOT restate" block, or "" when the ledger is empty. */
  sentLedgerBlock: string;
  /** "Customer attached — acknowledge" block, or "" when there are none. */
  attachmentBlock: string;
}

function cmpIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

/** Build the Phase-1 drafting fragments from a resolved ConversationState. */
export function buildDraftStateContext(state: ConversationState): DraftStateContext {
  const recipientName = state.recipient.name ?? null;
  const recipientEmail = state.recipient.email ?? null;

  // Clean thread — meaningful clean bodies only, oldest first.
  const cleanThread = state.messages
    .filter((m) => m.cleanBody.trim().length > 0)
    .map((m) => `[${m.direction === "outbound" ? "YOU" : "THEM"}]\n${m.cleanBody.trim()}`)
    .join("\n---\n");

  // Latest real customer inbound (the message we are replying to).
  const latestCustomer = [...state.customerMessages].sort((a, b) =>
    cmpIso(a.sentAt, b.sentAt)
  ) as CleanMessage[];
  const latestCustomerText =
    latestCustomer.length > 0
      ? latestCustomer[latestCustomer.length - 1].cleanBody.trim()
      : "";

  // Sent ledger — the drafter must reference, never repeat, these.
  const sentLedgerBlock =
    state.sentLedger.length > 0
      ? `ALREADY SENT TO THIS CUSTOMER — do NOT restate, re-quote, or repeat any of these; reference them only as already provided:\n${state.sentLedger
          .map((e) => `- ${e.text.trim()}`)
          .join("\n")}`
      : "";

  // Attachments the customer sent — tell the drafter they exist (and whether one
  // is a signed estimate, which shapes the reply's intent) so it can acknowledge
  // them naturally. It must NOT recite the vision summary back: narrating an
  // image's contents ("your photo of the back deck with wood boards and a
  // hand-drawn sketch") reads as robotic "look, I can see it" filler and adds
  // nothing to the conversation. The vision verdict stays INTERNAL — it still
  // drives the signed-estimate→Won path and the held-for-review-if-unreadable
  // gate; it just no longer leaks descriptions into customer-facing text.
  const attachments = state.attachmentsRequiringInspection;
  const hasSignedEstimate = attachments.some(
    (a) => a.inspection?.isSignedEstimate === true
  );
  const attachmentAck = hasSignedEstimate
    ? "thanks for the signed estimate — I'll get you on the schedule"
    : "thanks for sending those over";
  const attachmentBlock =
    attachments.length === 0
      ? ""
      : `THE CUSTOMER SENT ${attachments.length} ATTACHMENT${
          attachments.length > 1 ? "S" : ""
        }${
          hasSignedEstimate ? " (one is a signed estimate)" : ""
        }. Acknowledge receipt in ONE short, natural phrase (e.g. "${attachmentAck}"). Do NOT describe or itemize what the attachments show — no play-by-play of the images. Never claim you cannot see them.`;

  return {
    recipientName,
    recipientEmail,
    greetingFirstName: firstName(recipientName),
    cleanThread,
    latestCustomerText,
    sentLedgerBlock,
    attachmentBlock,
  };
}
