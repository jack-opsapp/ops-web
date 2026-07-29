/**
 * OPS Web — Client-name self-repair decision.
 *
 * When a lead is auto-created from an email whose From header has no display
 * name, the client row is left with a placeholder name ("New Lead", or
 * historically the raw handle "canprojack"). A later message in the same
 * conversation usually carries the customer's real display name. This decides
 * whether that later name may replace the stored one.
 *
 * Pure and side-effect free so every branch is unit-testable; the caller does
 * the reads and the write.
 *
 * Four guards, all required:
 *   1. the stored name must still be a placeholder (isPlaceholderClientName)
 *   2. the replacement must NOT be a placeholder — this is what stops the
 *      directory tier writing a client's own broken name back onto itself
 *   3. only inbound messages from someone other than the operator may repair
 *   4. operator-set or operator-confirmed names are never overwritten
 */

import { isPlaceholderClientName } from "./placeholder-name";

export interface ClientNameRepairProvenance {
  source: string | null;
  confirmedAt: string | null;
}

export interface ClientNameRepairInput {
  /** clients.name as currently stored. */
  currentName: string | null;
  /** clients.email, used to detect a local-part-derived stored name. */
  clientEmail: string | null;
  /** The sender of the message that triggered this repair. */
  senderEmail: string | null;
  /**
   * The replacement, taken from THIS message's display name — never from the
   * directory, which resolves to clients.name and would be a no-op write.
   */
  candidateName: string | null;
  direction: "inbound" | "outbound";
  /** True when the resolved sender is the operator's own mailbox. */
  senderIsSelf: boolean;
  /** contact_name provenance row for this client, when one exists. */
  provenance: ClientNameRepairProvenance | null;
}

export type ClientNameRepairDecision =
  | { repair: true; name: string }
  | {
      repair: false;
      reason:
        | "not_inbound_customer_message"
        | "name_is_real"
        | "candidate_unusable"
        | "operator_owned";
    };

export function decideClientNameRepair(
  input: ClientNameRepairInput
): ClientNameRepairDecision {
  if (input.direction !== "inbound" || input.senderIsSelf) {
    return { repair: false, reason: "not_inbound_customer_message" };
  }

  const identityEmail = input.clientEmail ?? input.senderEmail;
  if (!isPlaceholderClientName(input.currentName, identityEmail)) {
    return { repair: false, reason: "name_is_real" };
  }

  const candidate = (input.candidateName ?? "").trim();
  if (!candidate || isPlaceholderClientName(candidate, identityEmail)) {
    return { repair: false, reason: "candidate_unusable" };
  }
  if (candidate.toLowerCase() === (input.currentName ?? "").trim().toLowerCase()) {
    return { repair: false, reason: "candidate_unusable" };
  }

  if (
    input.provenance &&
    (input.provenance.source === "operator" ||
      input.provenance.confirmedAt != null)
  ) {
    return { repair: false, reason: "operator_owned" };
  }

  return { repair: true, name: candidate };
}
