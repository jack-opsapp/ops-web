import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { OperatorIdentity } from "@/lib/api/services/conversation-state/types";
import { matchPlatform } from "@/lib/api/services/known-platforms";
import {
  extractContactFormSubmission,
  extractEmailAddress,
  resolveEffectiveSenderEmail,
  type ContactFormSubmissionIdentity,
  type EffectiveSenderIdentity,
} from "@/lib/utils/email-parsing";

export interface IngestionOperatorIdentity {
  connectionEmail: string;
  userEmailAddresses?: string[];
  companyDomains?: string[];
  teamForwarders?: string[];
  knownPlatformSenders?: string[];
  staffMembers?: IngestionStaffMemberIdentity[];
}

export interface IngestionStaffMemberIdentity {
  userId: string;
  registeredEmail: string;
  fullName: string;
  phone: string | null;
  verifiedAliases: string[];
  pendingAliases: string[];
  rejectedAliases: string[];
}

export interface StaffAliasCandidate {
  userId: string;
  email: string;
  evidence: {
    fullName: string;
    phone: string;
    registeredEmailRecipient: boolean;
  };
}

/**
 * Quarantine a newly persisted candidate inside the current ingestion snapshot.
 * The database row becomes authoritative on the next refresh; this cycle-local
 * mirror prevents later messages in the same batch from racing ahead of it.
 */
export function quarantinePendingStaffAlias(
  operator: IngestionOperatorIdentity,
  candidate: StaffAliasCandidate
): void {
  const member = operator.staffMembers?.find(
    (staffMember) => staffMember.userId === candidate.userId
  );
  if (!member) return;
  const alias = normalizedEmail(candidate.email);
  if (
    alias &&
    !member.pendingAliases.some(
      (pendingAlias) => normalizedEmail(pendingAlias) === alias
    )
  ) {
    member.pendingAliases.push(alias);
  }
}

export interface PersistedEmailAuthorship {
  direction: "inbound" | "outbound";
  staffAliasCandidate: StaffAliasCandidate | null;
}

export function ingestionOperatorIdentityFromAuthoritative(input: {
  connectionEmail: string;
  operator: OperatorIdentity;
  teamForwarders?: string[];
  knownPlatformSenders?: string[];
  additionalCompanyDomains?: string[];
}): IngestionOperatorIdentity {
  return {
    connectionEmail: input.connectionEmail,
    userEmailAddresses: [...input.operator.emails],
    companyDomains: [
      ...new Set([
        ...input.operator.domains,
        ...(input.additionalCompanyDomains ?? []).map(normalizedDomain),
      ]),
    ].filter(Boolean),
    teamForwarders: input.teamForwarders ?? [],
    knownPlatformSenders: input.knownPlatformSenders ?? [],
    staffMembers: (input.operator.staffMembers ?? []).map((member) => ({
      userId: member.userId,
      registeredEmail: member.registeredEmail,
      fullName: member.fullName,
      phone: member.phone,
      verifiedAliases: [...member.verifiedAliases],
      pendingAliases: [...member.pendingAliases],
      rejectedAliases: [...member.rejectedAliases],
    })),
  };
}

export interface LeadRoutingIdentity {
  /** Stable lead-creation/dedupe key. It is not necessarily a provider thread id. */
  sourceKey: string;
  /** The canonical raw provider thread id used for Gmail/Outlook operations. */
  providerThreadId: string;
  /** The exact provider message represented by this ingestion unit. */
  providerMessageId: string;
  isContactFormSubmission: boolean;
  /** True when the transport may reuse one provider thread for unrelated customers. */
  isMessageScopedTransport: boolean;
  /** False when one provider thread can contain many unrelated customers. */
  mayInheritProviderThread: boolean;
}

export interface LeadRoutingScope {
  provider: string;
  connectionId: string;
}

export interface InboundEffectiveSenderIdentity {
  email: NormalizedEmail;
  contactFormSubmitter: ContactFormSubmissionIdentity | null;
  source: EffectiveSenderIdentity["source"];
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

/** Reject ambiguous/spoofable mailbox headers at a trust boundary. */
function strictSingleMailboxAddress(value: string | null | undefined): string {
  const candidates = new Set(
    (value ?? "")
      .match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
      ?.map((candidate) => candidate.trim().toLowerCase()) ?? []
  );
  return candidates.size === 1 ? [...candidates][0] : "";
}

function normalizedDomain(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^@/, "");
}

function normalizedPhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

function normalizedWords(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function authorControlledSignatureText(email: NormalizedEmail): string {
  const body = (email.bodyText || email.snippet || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const quotedIndex = body.search(
    /(?:^|\n)\s*(?:on .{0,240}\bwrote:|from:\s+.+@|[-_]{5,}\s*forwarded message)/i
  );
  const authorText = quotedIndex >= 0 ? body.slice(0, quotedIndex) : body;
  return authorText.slice(-2_000);
}

function signaturePhoneSet(value: string): Set<string> {
  const phones = new Set<string>();
  for (const match of value.matchAll(
    /(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10}/g
  )) {
    const phone = normalizedPhone(match[0]);
    if (phone) phones.add(phone);
  }
  return phones;
}

function corroboratedStaffAliasCandidate(
  email: NormalizedEmail,
  operator: IngestionOperatorIdentity
): StaffAliasCandidate | null {
  const sender = normalizedEmail(email.from);
  if (!sender) return null;
  const members = operator.staffMembers ?? [];
  if (
    members.some((member) =>
      member.rejectedAliases.map(normalizedEmail).includes(sender)
    )
  ) {
    return null;
  }

  const signature = authorControlledSignatureText(email);
  const signatureWords = ` ${normalizedWords(signature)} `;
  const signaturePhones = signaturePhoneSet(signature);
  const recipients = new Set(
    [...(email.to ?? []), ...(email.cc ?? [])]
      .map(normalizedEmail)
      .filter(Boolean)
  );
  const matches = members.filter((member) => {
    const fullName = normalizedWords(member.fullName);
    const phone = normalizedPhone(member.phone);
    if (!member.userId || fullName.split(" ").length < 2 || !phone) {
      return false;
    }
    return (
      signatureWords.includes(` ${fullName} `) && signaturePhones.has(phone)
    );
  });
  if (matches.length !== 1) return null;

  const member = matches[0];
  const registeredEmail = normalizedEmail(member.registeredEmail);
  return {
    userId: member.userId,
    email: sender,
    evidence: {
      fullName: member.fullName.trim(),
      phone: normalizedPhone(member.phone),
      registeredEmailRecipient: Boolean(
        registeredEmail && recipients.has(registeredEmail)
      ),
    },
  };
}

function operatorIdentitySets(operator: IngestionOperatorIdentity): {
  emails: Set<string>;
  domains: Set<string>;
} {
  return {
    emails: new Set(
      [operator.connectionEmail, ...(operator.userEmailAddresses ?? [])]
        .map(normalizedEmail)
        .filter(Boolean)
    ),
    domains: new Set(
      (operator.companyDomains ?? []).map(normalizedDomain).filter(Boolean)
    ),
  };
}

function isOperatorIdentity(
  email: string,
  identities: ReturnType<typeof operatorIdentitySets>
): boolean {
  const normalized = normalizedEmail(email);
  const domain = normalizedDomain(normalized.split("@")[1]);
  return Boolean(
    normalized &&
    (identities.emails.has(normalized) ||
      (domain && identities.domains.has(domain)))
  );
}

function trustedSenderSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizedEmail).filter(Boolean));
}

function isPendingStaffAlias(
  sender: string,
  operator: IngestionOperatorIdentity
): boolean {
  if (!sender) return false;
  const members = operator.staffMembers ?? [];
  if (
    members.some((member) =>
      member.rejectedAliases.map(normalizedEmail).includes(sender)
    )
  ) {
    return false;
  }
  return members.some((member) =>
    member.pendingAliases.map(normalizedEmail).includes(sender)
  );
}

function isTrustedForwardingWrapper(
  email: Pick<NormalizedEmail, "from" | "authenticatedFromDomains">,
  operator: IngestionOperatorIdentity
): boolean {
  const identities = operatorIdentitySets(operator);
  const wrapper = strictSingleMailboxAddress(email.from);
  const wrapperDomain = normalizedDomain(wrapper.split("@")[1]);
  const authenticatedDomains = new Set(
    (email.authenticatedFromDomains ?? []).map(normalizedDomain).filter(Boolean)
  );
  return Boolean(
    wrapper &&
    wrapperDomain &&
    authenticatedDomains.has(wrapperDomain) &&
    (isOperatorIdentity(wrapper, identities) ||
      trustedSenderSet(operator.teamForwarders).has(wrapper))
  );
}

function isTrustedContactFormWrapper(
  email: Pick<NormalizedEmail, "from" | "authenticatedFromDomains">,
  operator: IngestionOperatorIdentity
): boolean {
  const wrapper = strictSingleMailboxAddress(email.from);
  const wrapperDomain = normalizedDomain(wrapper.split("@")[1]);
  const authenticatedDomains = new Set(
    (email.authenticatedFromDomains ?? []).map(normalizedDomain).filter(Boolean)
  );
  return Boolean(
    isTrustedForwardingWrapper(email, operator) ||
    (wrapper &&
      wrapperDomain &&
      authenticatedDomains.has(wrapperDomain) &&
      (trustedSenderSet(operator.knownPlatformSenders).has(wrapper) ||
        matchPlatform(wrapper)?.category === "website_form"))
  );
}

/**
 * Follow a bounded chain of canonical forwarded `From:` headers until the
 * first non-operator, non-platform sender. Office-to-office forwards commonly
 * add several internal wrappers before the original customer; stopping at the
 * first header would misidentify the office as the lead. The outer wrapper
 * must already be trusted before this parser is ever consulted.
 */
function forwardedExternalSender(
  email: Pick<
    NormalizedEmail,
    "from" | "subject" | "bodyText" | "snippet" | "authenticatedFromDomains"
  >,
  operator: IngestionOperatorIdentity
): string {
  if (!isTrustedForwardingWrapper(email, operator)) return "";

  const body = (email.bodyText || email.snippet || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!body) return "";
  const markerIndex = body.search(
    /(?:^|\n)\s*(?:Begin forwarded message:|-{2,}\s*Forwarded message\s*-{2,}|_{5,}\s*Forwarded message\s*_{5,})/i
  );
  const subjectIsForward = /^\s*(?:fwd?|fw)\s*:/i.test(email.subject ?? "");
  if (markerIndex < 0 && !subjectIsForward) return "";

  const identities = operatorIdentitySets(operator);
  const teamForwarders = trustedSenderSet(operator.teamForwarders);
  const platformSenders = trustedSenderSet(operator.knownPlatformSenders);
  const window = body.slice(
    Math.max(markerIndex, 0),
    Math.max(markerIndex, 0) + 12_000
  );
  const fromHeaders = [...window.matchAll(/^>?\s*From:\s*(.+)$/gim)].slice(
    0,
    16
  );
  for (const match of fromHeaders) {
    const candidate = strictSingleMailboxAddress(match[1]);
    if (!candidate || isOperatorIdentity(candidate, identities)) continue;
    if (teamForwarders.has(candidate) || platformSenders.has(candidate))
      continue;
    if (matchPlatform(candidate)) continue;
    return candidate;
  }
  return "";
}

function mailboxHeader(email: string, name: string | null | undefined): string {
  const display = (name ?? "")
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/[<>"\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return display ? `${display} <${email}>` : email;
}

/**
 * Present the same effective customer identity to matching, enrichment, thread
 * state, and activity persistence. This keeps the outer forwarding mailbox as
 * transport metadata while retaining the immutable provider ids/body.
 */
export function applyInboundEffectiveSenderIdentity(
  email: NormalizedEmail,
  operator: IngestionOperatorIdentity
): InboundEffectiveSenderIdentity {
  const extractedContactFormSubmitter = extractContactFormSubmission(
    email.subject,
    email.bodyText || email.snippet || ""
  );
  const resolved = resolveEffectiveSenderEmail({
    fromHeader: email.from,
    subject: email.subject,
    bodyText: email.bodyText || email.snippet || "",
    connectionEmail: normalizedEmail(operator.connectionEmail) || null,
  });

  const trustedContactForm =
    resolved.source === "contact_form" &&
    isTrustedContactFormWrapper(email, operator);
  const trustedForwardedSender = trustedContactForm
    ? ""
    : forwardedExternalSender(email, operator);
  const trustedForward = Boolean(trustedForwardedSender);
  const contactFormSubmitter = trustedContactForm
    ? extractedContactFormSubmitter
    : null;
  const mayReplaceWrapper = trustedContactForm || trustedForward;

  if (!mayReplaceWrapper) {
    return {
      email,
      contactFormSubmitter,
      source: "from_header",
    };
  }

  const effectiveSenderEmail = trustedContactForm
    ? resolved.email
    : trustedForwardedSender;
  const resolvedName =
    contactFormSubmitter?.name ??
    (trustedContactForm ? resolved.name : null) ??
    null;
  return {
    email: {
      ...email,
      from: mailboxHeader(effectiveSenderEmail, resolvedName),
      fromName: resolvedName ?? effectiveSenderEmail,
    },
    contactFormSubmitter,
    source: trustedContactForm ? "contact_form" : "forwarded",
  };
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
export function resolvePersistedEmailAuthorship(
  email: NormalizedEmail,
  operator: IngestionOperatorIdentity
): PersistedEmailAuthorship {
  // SENT is the provider's strongest authorship proof. Check it before body
  // parsing so an operator reply that quotes an earlier form is not inverted.
  if ((email.labelIds ?? []).some((label) => label.toUpperCase() === "SENT")) {
    return { direction: "outbound", staffAliasCandidate: null };
  }

  const form = extractContactFormSubmission(
    email.subject,
    email.bodyText || email.snippet || ""
  );
  if (form?.email && isTrustedContactFormWrapper(email, operator)) {
    return { direction: "inbound", staffAliasCandidate: null };
  }

  const { emails: operatorEmails, domains: companyDomains } =
    operatorIdentitySets(operator);

  // A strict forwarded-message header is stronger than the internal outer
  // wrapper. Only accept the recovered sender when it is external to every
  // operator identity; ordinary internal forwards remain outbound.
  const forwardedFrom = forwardedExternalSender(email, operator);
  const forwardedFromDomain = normalizedDomain(forwardedFrom.split("@")[1]);
  if (
    isTrustedForwardingWrapper(email, operator) &&
    forwardedFrom &&
    !operatorEmails.has(forwardedFrom) &&
    (!forwardedFromDomain || !companyDomains.has(forwardedFromDomain))
  ) {
    return { direction: "inbound", staffAliasCandidate: null };
  }

  const from = normalizedEmail(email.from);
  if (from && operatorEmails.has(from)) {
    return { direction: "outbound", staffAliasCandidate: null };
  }

  const fromDomain = normalizedDomain(from.split("@")[1]);
  if (fromDomain && companyDomains.has(fromDomain)) {
    return { direction: "outbound", staffAliasCandidate: null };
  }

  // A pending alias has already passed exact full-name + full-phone
  // corroboration and is awaiting an administrator's decision. Quarantine
  // every later message from that exact mailbox as outbound/review even when
  // its body no longer repeats the signature evidence. A rejected alias
  // remains eligible as an external sender.
  if (isPendingStaffAlias(from, operator)) {
    return { direction: "outbound", staffAliasCandidate: null };
  }

  const staffAliasCandidate = corroboratedStaffAliasCandidate(email, operator);
  return staffAliasCandidate
    ? { direction: "outbound", staffAliasCandidate }
    : { direction: "inbound", staffAliasCandidate: null };
}

export function resolvePersistedEmailDirection(
  email: NormalizedEmail,
  operator: IngestionOperatorIdentity
): "inbound" | "outbound" {
  return resolvePersistedEmailAuthorship(email, operator).direction;
}

/**
 * Separate the CRM's lead identity from the provider's mailbox thread identity.
 * Ordinary conversations inherit by provider thread. Contact-form notifications
 * and trusted internal forwards are message-scoped because providers/operators
 * may reuse one thread for unrelated customers; identity matching can still join
 * repeated messages by the same customer after this guard has prevented false
 * raw-thread inheritance.
 */
export function buildLeadRoutingIdentity(
  email: Pick<
    NormalizedEmail,
    | "id"
    | "threadId"
    | "from"
    | "subject"
    | "bodyText"
    | "snippet"
    | "labelIds"
    | "authenticatedFromDomains"
  >,
  scope?: LeadRoutingScope,
  operator?: IngestionOperatorIdentity
): LeadRoutingIdentity {
  const form = extractContactFormSubmission(
    email.subject,
    email.bodyText || email.snippet || ""
  );
  const isSent = (email.labelIds ?? []).some(
    (label) => label.toUpperCase() === "SENT"
  );
  const isContactFormSubmission =
    !isSent &&
    Boolean(form?.email) &&
    Boolean(operator && isTrustedContactFormWrapper(email, operator));
  const forwardedSender = operator
    ? forwardedExternalSender(email, operator)
    : "";
  const isTrustedGenericForward = Boolean(
    !isSent &&
    operator &&
    isTrustedForwardingWrapper(email, operator) &&
    forwardedSender
  );
  const isMessageScopedTransport =
    isContactFormSubmission || isTrustedGenericForward;
  const normalizedScope = scope ? normalizedRoutingScope(scope) : null;
  const providerThreadId = normalizedScope
    ? canonicalizeProviderThreadId(email.threadId, normalizedScope)
    : email.threadId;
  const rawSourceKey = isMessageScopedTransport
    ? `${isContactFormSubmission ? "contact-form" : "forwarded"}-message:${email.id}`
    : providerThreadId;
  const scopedSourceKey = normalizedScope
    ? `email:${normalizedScope.provider}:${normalizedScope.connectionId}:${isMessageScopedTransport ? "message" : "thread"}:${isMessageScopedTransport ? email.id : providerThreadId}`
    : rawSourceKey;

  return {
    sourceKey: scopedSourceKey,
    providerThreadId,
    providerMessageId: email.id,
    isContactFormSubmission,
    isMessageScopedTransport,
    mayInheritProviderThread: !isMessageScopedTransport,
  };
}
