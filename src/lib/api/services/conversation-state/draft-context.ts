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

import { stripQuotedContentStrict } from "@/lib/utils/email-parsing";

import type { CleanMessage, ConversationState, ResponseMode } from "./types";

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
  responseMode: ResponseMode;
  isFirstOperatorReply: boolean;
  operatorMessageCount: number;
  customerMessageCount: number;
}

function cmpIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

/**
 * The words that end an email rather than name its author. Mirrors the sign-off
 * family in draft-reconciliation; kept local so neither file can silently
 * change the other's meaning.
 */
const CLOSING_LINE =
  /^(thanks|thank you|thanks so much|many thanks|all the best|best|best regards|kind regards|warm regards|regards|cheers|talk soon|sincerely|yours truly|respectfully|cordially|appreciate it|much appreciated)$/i;

/** One or two capitalized name words — "Mark", "Anne-Marie O'Brien". */
const NAME_LINE = /^[A-Z][A-Za-z'’-]{0,23}(?: [A-Z][A-Za-z'’-]{0,23})?$/;

const MAX_SIGN_OFF_NAME_LENGTH = 24;

/**
 * The name the customer signed off with.
 *
 * `activities` does not persist a sender display name, so on most real threads
 * the provider identity yields no name at all and the drafter opens with a bare
 * "Hi," — to a customer who typed their own name at the bottom of the message.
 * Read from the RAW body: the clean body has the signature block removed, which
 * is precisely where the name lives. Quoted history is cut first so the name of
 * whoever wrote earlier in the chain can never be mistaken for this sender's.
 *
 * Returns null on anything short of certainty. A wrong name is worse than none.
 */
function signOffName(rawBody: string): string | null {
  const authored = stripQuotedContentStrict(rawBody ?? "", "");
  if (!authored.trim()) return null;

  const lines = authored
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const candidate = lines[lines.length - 1].replace(/[.,;:!?]+$/, "").trim();
  if (
    !candidate ||
    candidate.length > MAX_SIGN_OFF_NAME_LENGTH ||
    candidate.includes("@") ||
    /\d/.test(candidate) ||
    CLOSING_LINE.test(candidate) ||
    !NAME_LINE.test(candidate)
  ) {
    return null;
  }

  return candidate;
}

/** Build the Phase-1 drafting fragments from a resolved ConversationState. */
export function buildDraftStateContext(
  state: ConversationState
): DraftStateContext {
  const recipientName = state.recipient.name ?? null;
  const recipientEmail = state.recipient.email ?? null;

  // Clean thread — meaningful clean bodies only, oldest first.
  const cleanThread = state.messages
    .filter((m) => m.cleanBody.trim().length > 0)
    .map(
      (m) =>
        `[${m.direction === "outbound" ? "YOU" : "THEM"}]\n${m.cleanBody.trim()}`
    )
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
  const latestCustomerMessage =
    latestCustomer.length > 0
      ? latestCustomer[latestCustomer.length - 1]
      : null;
  const attachments = state.attachmentsRequiringInspection.filter(
    (attachment) =>
      attachment.isNewToConversation !== false &&
      attachment.isDecorativeInline !== true &&
      (attachment.sourceMessageId
        ? attachment.sourceMessageId ===
          latestCustomerMessage?.providerMessageId
        : latestCustomerMessage?.attachments.includes(attachment) === true)
  );
  const hasSignedEstimate = attachments.some(
    (a) => a.inspection?.isSignedEstimate === true
  );
  const attachmentAck = hasSignedEstimate
    ? "thanks for the signed estimate — I'll confirm the next step"
    : "thanks for sending those over";
  const attachmentBlock =
    attachments.length === 0
      ? ""
      : `THE CUSTOMER SENT ${attachments.length} ATTACHMENT${
          attachments.length > 1 ? "S" : ""
        }${
          hasSignedEstimate ? " (one is a signed estimate)" : ""
        }. Acknowledge receipt in ONE short, natural phrase (e.g. "${attachmentAck}"). Do NOT describe or itemize what the attachments show — no play-by-play of the images. Never claim you cannot see them.`;

  const operatorMessageCount = state.messages.filter(
    (message) => message.direction === "outbound"
  ).length;
  const customerMessageCount = state.customerMessages.length;

  // The provider display name when there is one; otherwise the name the
  // customer signed. Never the linked client record — that is how a reply ends
  // up greeting the account holder instead of the person who wrote.
  const greetingFirstName =
    firstName(recipientName) ??
    (latestCustomerMessage ? signOffName(latestCustomerMessage.rawBody) : null);

  return {
    recipientName,
    recipientEmail,
    greetingFirstName,
    cleanThread,
    latestCustomerText,
    sentLedgerBlock,
    attachmentBlock,
    responseMode: state.responseMode,
    isFirstOperatorReply: operatorMessageCount === 0,
    operatorMessageCount,
    customerMessageCount,
  };
}
