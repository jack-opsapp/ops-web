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

  // Attachments the customer sent — acknowledge receipt, and (Phase 2) describe
  // what each one actually IS using the cached vision summary so the drafter can
  // reference the content, not just the filename. A failed/empty inspection
  // degrades gracefully to just the filename.
  const attachmentBlock =
    state.attachmentsRequiringInspection.length > 0
      ? `THE CUSTOMER ATTACHED THE FOLLOWING — acknowledge receipt naturally and reference what each one shows; never claim you cannot see attachments:\n${state.attachmentsRequiringInspection
          .map((a) => {
            const summary = a.inspection?.summary?.trim();
            return summary
              ? `- ${a.filename} (${a.kind}): ${summary}`
              : `- ${a.filename} (${a.kind})`;
          })
          .join("\n")}`
      : "";

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
