import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import {
  extractContactFormSubmission,
  extractEmailAddress,
} from "@/lib/utils/email-parsing";

export interface IngestionOperatorIdentity {
  connectionEmail: string;
  userEmailAddresses?: string[];
  companyDomains?: string[];
}

export interface LeadRoutingIdentity {
  /** Stable lead-creation/dedupe key. It is not necessarily a provider thread id. */
  sourceKey: string;
  /** The canonical raw provider thread id used for Gmail/Outlook operations. */
  providerThreadId: string;
  /** The exact provider message represented by this ingestion unit. */
  providerMessageId: string;
  isContactFormSubmission: boolean;
  /** False for form notifications because one provider thread can contain many customers. */
  mayInheritProviderThread: boolean;
}

export interface LeadRoutingScope {
  provider: string;
  connectionId: string;
}

function normalizedRoutingScope(scope: LeadRoutingScope): LeadRoutingScope {
  const provider = scope.provider.trim().toLowerCase();
  const connectionId = scope.connectionId.trim();
  if (!provider || !connectionId) {
    throw new Error(
      "Email lead routing scope requires provider and connectionId"
    );
  }
  return { provider, connectionId };
}

/**
 * Reduce a provider thread identifier to the raw mailbox value at the ingest
 * boundary. Older retries may carry a previously-scoped CRM routing key; this
 * operation is intentionally idempotent so those keys cannot be nested again.
 */
export function canonicalizeProviderThreadId(
  providerThreadId: string,
  scope: LeadRoutingScope
): string {
  const { provider, connectionId } = normalizedRoutingScope(scope);
  const prefix = `email:${provider}:${connectionId}:thread:`;
  let canonical = providerThreadId.trim();

  while (canonical.startsWith(prefix)) {
    canonical = canonical.slice(prefix.length).trim();
  }

  if (!canonical) {
    throw new Error("Email lead routing requires a raw provider thread id");
  }

  return canonical;
}

function normalizedEmail(value: string | null | undefined): string {
  return extractEmailAddress(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizedDomain(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^@/, "");
}

/**
 * Resolve the direction that is persisted to activities/correspondence. Provider
 * search buckets are only discovery hints: aliases, forwarding, and overlapping
 * Gmail labels can place an operator-authored message in an INBOX result.
 *
 * A parsed contact-form notification is deliberately inbound even when a team
 * member forwarded it. The effective party is the external submitter, not the
 * forwarding wrapper.
 */
export function resolvePersistedEmailDirection(
  email: NormalizedEmail,
  operator: IngestionOperatorIdentity
): "inbound" | "outbound" {
  // SENT is the provider's strongest authorship proof. Check it before body
  // parsing so an operator reply that quotes an earlier form is not inverted.
  if ((email.labelIds ?? []).some((label) => label.toUpperCase() === "SENT")) {
    return "outbound";
  }

  const form = extractContactFormSubmission(
    email.subject,
    email.bodyText || email.snippet || ""
  );
  if (form?.email) return "inbound";

  const from = normalizedEmail(email.from);
  const operatorEmails = new Set(
    [operator.connectionEmail, ...(operator.userEmailAddresses ?? [])]
      .map(normalizedEmail)
      .filter(Boolean)
  );
  if (from && operatorEmails.has(from)) return "outbound";

  const fromDomain = normalizedDomain(from.split("@")[1]);
  const companyDomains = new Set(
    (operator.companyDomains ?? []).map(normalizedDomain).filter(Boolean)
  );
  if (fromDomain && companyDomains.has(fromDomain)) return "outbound";

  return "inbound";
}

/**
 * Separate the CRM's lead identity from the provider's mailbox thread identity.
 * Ordinary conversations inherit by provider thread. Contact-form notifications
 * are message-scoped because Gmail/platforms may reuse one thread for unrelated
 * submitters; identity matching can still join repeated submissions by the same
 * customer after this guard has prevented a false raw-thread inheritance.
 */
export function buildLeadRoutingIdentity(
  email: Pick<
    NormalizedEmail,
    "id" | "threadId" | "subject" | "bodyText" | "snippet" | "labelIds"
  >,
  scope?: LeadRoutingScope
): LeadRoutingIdentity {
  const form = extractContactFormSubmission(
    email.subject,
    email.bodyText || email.snippet || ""
  );
  const isSent = (email.labelIds ?? []).some(
    (label) => label.toUpperCase() === "SENT"
  );
  const isContactFormSubmission = !isSent && Boolean(form?.email);
  const normalizedScope = scope ? normalizedRoutingScope(scope) : null;
  const providerThreadId = normalizedScope
    ? canonicalizeProviderThreadId(email.threadId, normalizedScope)
    : email.threadId;
  const rawSourceKey = isContactFormSubmission
    ? `contact-form-message:${email.id}`
    : providerThreadId;
  const scopedSourceKey = normalizedScope
    ? `email:${normalizedScope.provider}:${normalizedScope.connectionId}:${isContactFormSubmission ? "message" : "thread"}:${isContactFormSubmission ? email.id : providerThreadId}`
    : rawSourceKey;

  return {
    sourceKey: scopedSourceKey,
    providerThreadId,
    providerMessageId: email.id,
    isContactFormSubmission,
    mayInheritProviderThread: !isContactFormSubmission,
  };
}
