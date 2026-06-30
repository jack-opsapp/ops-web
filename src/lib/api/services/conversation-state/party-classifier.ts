// src/lib/api/services/conversation-state/party-classifier.ts
//
// Deterministic per-message direction + partyRole assignment for the inbox
// clean-state layer. Replaces TWO fragile heuristics:
//   1. The ownerEmail substring check (e.g. `from.includes(ownerEmail)`), which
//      mislabels a customer gmail as the operator whenever the operator also
//      uses a public-domain mailbox.
//   2. The LLM classifier's blind operator/customer guess — it was never told
//      who the operator actually is (thread-classifier-service.ts:238-266).
//
// This module decides identity from the authoritative `OperatorIdentity` set
// (emails ∪ domains) instead. The LLM is no longer the source of truth for the
// hard "who sent this" rule.
//
// PURE-CORE: `classifyParty` takes already-fetched plain data (a single message
// header set + the operator identity) and returns a verdict. No DB, no network.
// ConversationState fetching lives elsewhere; this file imports nothing async.
//
// DRY: the bounce / marketing / platform-noise detection and the `isMeaningful`
// gate are REUSED from `classifyOpportunityCorrespondence`
// (opportunity-correspondence-classifier.ts) by wrapping it — we do not
// re-implement those regexes here. That classifier's role vocabulary
// (`ops` / `provider` / `marketing`) is mapped onto the clean-state `PartyRole`
// (`operator` / `system`).
//
// NOTE on the all-participants-internal helper: `tryDeterministicInternal`
// (deterministic-internal-rule.ts) is NOT reused for the per-message internal
// decision because it operates on a thread-level `Map<email, CompanyUser>` and
// bails on forwards/manual-category — semantics that don't apply to a single
// message keyed off an identity set. The wrapped correspondence classifier
// already resolves an all-operator message to `internal` via its own
// `isInternalEmail` check, so the internal verdict comes for free from the same
// reused code path rather than a second re-implementation.

import {
  classifyOpportunityCorrespondence,
  type OpportunityCorrespondencePartyRole,
} from "@/lib/email/opportunity-correspondence-classifier";
import { extractEmailAddress } from "@/lib/utils/email-parsing";
import type { OperatorIdentity, PartyRole } from "./types";

export interface PartyClassifierMessage {
  fromEmail: string;
  toEmails: string[];
  ccEmails?: string[];
  subject?: string;
  body?: string;
}

export interface PartyClassification {
  direction: "inbound" | "outbound";
  partyRole: PartyRole;
  isMeaningful: boolean;
}

// A non-empty sentinel so the reused classifier never short-circuits to
// `missing_provider_id`. The clean-state layer classifies already-ingested
// messages; provider-id de-duplication is handled upstream, so we deliberately
// give it a stable placeholder and never pass `existingProviderMessageIds`.
const SYNTHETIC_THREAD_ID = "conversation-state";

function normalizeEmail(value: string | null | undefined): string {
  return extractEmailAddress(value ?? "").toLowerCase().trim();
}

function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase().trim() ?? "";
}

/**
 * True when an address belongs to the operator: its normalized form is in
 * `operator.emails`, OR its domain is in `operator.domains`. Public domains are
 * allowed in `operator.domains` (unlike the wizard's `identifyCompanyDomains`),
 * so a gmail-based operator still matches its own teammates — but only when the
 * operator's gmail address is enumerated in `emails`, never via a blanket
 * "gmail.com is internal" rule.
 */
function isOperatorAddress(email: string, operator: OperatorIdentity): boolean {
  if (!email.includes("@")) return false;
  if (operator.emails.has(email)) return true;
  const domain = emailDomain(email);
  return domain.length > 0 && operator.domains.has(domain);
}

/**
 * Map the reused correspondence classifier's richer role vocabulary onto the
 * clean-state `PartyRole`. `ops` → `operator`; provider/marketing/system noise
 * → `system`; everything else passes through.
 */
function toPartyRole(role: OpportunityCorrespondencePartyRole): PartyRole {
  switch (role) {
    case "ops":
      return "operator";
    case "provider":
    case "marketing":
    case "system":
      return "system";
    case "customer":
    case "internal":
    case "unknown":
      return role;
    default:
      return "unknown";
  }
}

/**
 * Assign a single message a deterministic `direction` + `partyRole` + meaningful
 * flag using the operator's authoritative identity set.
 *
 * Direction is derived from the sender: an operator-owned sender is `outbound`,
 * anyone else is `inbound`. The reused `classifyOpportunityCorrespondence` then
 * resolves the role (customer vs internal vs platform/system) and the
 * bounce/auto-reply/marketing `isMeaningful` gate, fed the operator identity so
 * its internal/operator detection matches ours exactly.
 */
export function classifyParty(
  msg: PartyClassifierMessage,
  operator: OperatorIdentity
): PartyClassification {
  const fromEmail = normalizeEmail(msg.fromEmail);

  // Degenerate: no resolvable sender → unknown, not meaningful. Default inbound
  // (an unattributable message is treated as incoming, never as our own send).
  if (!fromEmail) {
    return { direction: "inbound", partyRole: "unknown", isMeaningful: false };
  }

  const direction: "inbound" | "outbound" = isOperatorAddress(fromEmail, operator)
    ? "outbound"
    : "inbound";

  const classification = classifyOpportunityCorrespondence({
    direction,
    providerThreadId: SYNTHETIC_THREAD_ID,
    providerMessageId: SYNTHETIC_THREAD_ID,
    fromEmail: msg.fromEmail,
    toEmails: msg.toEmails ?? [],
    ccEmails: msg.ccEmails ?? [],
    subject: msg.subject ?? "",
    bodyText: msg.body ?? "",
    // Feed the operator identity so the reused classifier's internal/operator
    // resolution matches `isOperatorAddress`. connectionEmail is required for
    // its outbound `ops` branch; company domains drive its internal check.
    connectionEmail: firstEmail(operator),
    companyDomains: Array.from(operator.domains),
    userEmailAddresses: Array.from(operator.emails),
  });

  return {
    direction,
    partyRole: toPartyRole(classification.partyRole),
    isMeaningful: classification.isMeaningful,
  };
}

/** First enumerated operator email (used as the reused classifier's connectionEmail). */
function firstEmail(operator: OperatorIdentity): string | undefined {
  for (const email of operator.emails) return email;
  return undefined;
}
