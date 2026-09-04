import { matchPlatform } from "@/lib/api/services/known-platforms";
import {
  extractContactFormSubmission,
  extractEmailAddress,
} from "@/lib/utils/email-parsing";

export type OpportunityCorrespondenceDirection = "inbound" | "outbound";

export type OpportunityCorrespondencePartyRole =
  | "customer"
  | "ops"
  | "internal"
  | "provider"
  | "system"
  | "marketing"
  | "unknown";

export type OpportunityCorrespondenceNoiseReason =
  | "provider_noise"
  | "bounce"
  | "internal_system"
  | "administrative_non_customer"
  | "duplicate_provider_message_id"
  | "marketing_noise"
  | "missing_provider_id"
  | null;

export type OpportunityResponseKind =
  | "not_applicable"
  | "human"
  | "configured_automation"
  | "automated_acknowledgement"
  | "delivery_receipt"
  | "internal_note"
  | "unknown";

export interface OpportunityCorrespondenceClassifierInput {
  direction: OpportunityCorrespondenceDirection;
  providerThreadId?: string | null;
  providerMessageId?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  toEmails?: Array<string | null | undefined> | null;
  ccEmails?: Array<string | null | undefined> | null;
  subject?: string | null;
  bodyText?: string | null;
  labels?: string[] | null;
  threadCategory?: string | null;
  connectionEmail?: string | null;
  companyDomains?: string[] | null;
  userEmailAddresses?: string[] | null;
  knownPlatformSenders?: string[] | null;
  contactEmail?: string | null;
  submitterEmail?: string | null;
  existingProviderMessageIds?: Iterable<string> | null;
  /**
   * Authoritative send-path evidence. Historical provider sync intentionally
   * omits this hint so response coverage remains unknown instead of inferred.
   */
  responseKindHint?: Exclude<
    OpportunityResponseKind,
    "not_applicable" | "delivery_receipt" | "internal_note"
  > | null;
}

export interface OpportunityCorrespondenceClassification {
  direction: OpportunityCorrespondenceDirection;
  partyRole: OpportunityCorrespondencePartyRole;
  isMeaningful: boolean;
  noiseReason: OpportunityCorrespondenceNoiseReason;
  customerEmail: string | null;
  responseDefinitionVersion: 1;
  responseKind: OpportunityResponseKind;
  countsAsFirstResponse: boolean;
}

type BaseOpportunityCorrespondenceClassification = Omit<
  OpportunityCorrespondenceClassification,
  "responseDefinitionVersion" | "responseKind" | "countsAsFirstResponse"
>;

const SYSTEM_LOCAL_PARTS = new Set([
  "admin",
  "contact",
  "hello",
  "info",
  "mail",
  "mailer-daemon",
  "no-reply",
  "noreply",
  "notifications",
  "office",
  "postmaster",
  "sales",
  "support",
  "team",
]);

const BOUNCE_SUBJECT_RE =
  /\b(?:bounce|delivery status notification|delivery failure|undeliverable|message not delivered|returned mail|mail delivery subsystem)\b/i;
const MARKETING_SUBJECT_RE =
  /\b(?:newsletter|promotion|promotions|sale|discount|unsubscribe|webinar|limited time|special offer)\b/i;
const RECRUITING_RELAY_DOMAINS = new Set([
  "indeed.com",
  "indeedemail.com",
  "indeedmail.com",
]);
const RECRUITING_TRAFFIC_RE =
  /\b(?:new (?:job )?application|new candidate|candidate (?:application|update)|job application|application updates?|applied to (?:your|the) job|manage (?:your )?application e-?mails?|employer dashboard|job post(?:ing)?|view (?:the )?(?:candidate|application)|resume|résumé)\b/i;
const PROPERTY_ADMIN_RELATIONSHIP_RE =
  /\b(?:landlord|property\s+manager|property\s+management|rental\s+manager|tenancy|tenant\s+ledger|lease\s+administrator|strata\s+management)\b/i;
const PROPERTY_ADMIN_ACTION_RE =
  /\b(?:rent|lease(?:\s+renewal)?|tenancy\s+agreement|security\s+deposit|notice\s+to\s+enter|rental\s+statement|owner\s+statement|management\s+fee|move[- ](?:in|out)\s+inspection)\b/i;
const TRADES_PROJECT_INTENT_RE =
  /\b(?:quote|estimate|proposal|bid|site\s+visit|measure(?:ment)?|deck|railing|fence|repair|replace(?:ment)?|install(?:ation)?|build|construction|renovation|scope\s+of\s+work|project|job)\b/i;

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = extractEmailAddress(value ?? "")
    .toLowerCase()
    .trim();
  return normalized.includes("@") ? normalized : null;
}

function normalizeId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function localPart(email: string | null): string {
  return email?.split("@")[0]?.toLowerCase().trim() ?? "";
}

function domain(email: string | null): string {
  return email?.split("@")[1]?.toLowerCase().trim() ?? "";
}

function isRecruitingRelayEmail(email: string | null): boolean {
  const value = domain(email);
  return [...RECRUITING_RELAY_DOMAINS].some(
    (relayDomain) => value === relayDomain || value.endsWith(`.${relayDomain}`)
  );
}

function isExclusiveRecruitingRelayEmail(email: string | null): boolean {
  const value = domain(email);
  return ["indeedemail.com", "indeedmail.com"].some(
    (relayDomain) => value === relayDomain || value.endsWith(`.${relayDomain}`)
  );
}

function normalizedSet(
  values: Array<string | null | undefined> | null | undefined
): Set<string> {
  return new Set(values?.map(normalizeEmail).filter(Boolean) as string[]);
}

function companyDomainSet(
  input: OpportunityCorrespondenceClassifierInput
): Set<string> {
  return new Set(
    (input.companyDomains ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function knownInternalEmails(
  input: OpportunityCorrespondenceClassifierInput
): Set<string> {
  return normalizedSet([
    input.connectionEmail,
    ...(input.userEmailAddresses ?? []),
  ]);
}

function knownPlatformEmails(
  input: OpportunityCorrespondenceClassifierInput
): Set<string> {
  return normalizedSet(input.knownPlatformSenders ?? []);
}

function isInternalEmail(
  email: string | null,
  input: OpportunityCorrespondenceClassifierInput
): boolean {
  if (!email) return false;
  if (knownInternalEmails(input).has(email)) return true;
  const emailDomain = domain(email);
  return Boolean(emailDomain && companyDomainSet(input).has(emailDomain));
}

/**
 * A local-part that signals an automated, unattended sender — `noreply`,
 * `no-reply`, `do-not-reply`, `donotreply` in ANY position, not just the bare
 * exact local part. The legacy SYSTEM_LOCAL_PARTS set only matched `noreply` /
 * `no-reply` exactly, so every `*-noreply@` variant slipped through:
 * `businessprofile-noreply@google.com`, `ads-account-noreply@google.com`,
 * `calendar-noreply@google.com`, etc. — and an automated notification (e.g. a
 * Google Business Profile review email) could be treated as a customer and get an
 * auto-drafted reply to a robot. Separators are collapsed so prefix / suffix /
 * embedded forms all match. A real person whose local part contains "noreply" is
 * effectively impossible, so the false-positive risk is nil.
 */
function isAutomatedNoReplyLocalPart(local: string): boolean {
  const collapsed = local.replace(/[._-]/g, "");
  return collapsed.includes("noreply") || collapsed.includes("donotreply");
}

function isSystemAddress(email: string | null): boolean {
  if (!email) return false;
  const local = localPart(email);
  return SYSTEM_LOCAL_PARTS.has(local) || isAutomatedNoReplyLocalPart(local);
}

function isProviderAddress(
  email: string | null,
  input: OpportunityCorrespondenceClassifierInput
): boolean {
  if (!email) return false;
  return Boolean(matchPlatform(email)) || knownPlatformEmails(input).has(email);
}

export function isRecruitingProviderNoise(input: {
  direction?: OpportunityCorrespondenceDirection;
  fromEmail?: string | null;
  toEmails?: Array<string | null | undefined> | null;
  ccEmails?: Array<string | null | undefined> | null;
  subject?: string | null;
  bodyText?: string | null;
}): boolean {
  const participants = [
    normalizeEmail(input.fromEmail),
    ...(input.toEmails ?? []).map(normalizeEmail),
    ...(input.ccEmails ?? []).map(normalizeEmail),
  ];
  const hasRecruitingRelay = participants.some(isRecruitingRelayEmail);
  const hasExclusiveRecruitingRelay = participants.some(
    isExclusiveRecruitingRelayEmail
  );
  const hasRecruitingTraffic = RECRUITING_TRAFFIC_RE.test(
    `${input.subject ?? ""}\n${input.bodyText ?? ""}`
  );
  return (
    hasRecruitingRelay &&
    (hasRecruitingTraffic ||
      (hasExclusiveRecruitingRelay &&
        (input.direction === "outbound" ||
          isExclusiveRecruitingRelayEmail(normalizeEmail(input.fromEmail)))))
  );
}

function isBounce(
  email: string | null,
  subject: string,
  bodyText: string
): boolean {
  const local = localPart(email);
  return (
    local === "mailer-daemon" ||
    local === "postmaster" ||
    BOUNCE_SUBJECT_RE.test(subject) ||
    BOUNCE_SUBJECT_RE.test(bodyText)
  );
}

function isMarketingNoise(
  input: OpportunityCorrespondenceClassifierInput,
  subject: string
): boolean {
  const category = input.threadCategory?.trim().toUpperCase() ?? "";
  if (category === "MARKETING") return true;
  if (
    input.labels?.some((label) => label.toUpperCase() === "CATEGORY_PROMOTIONS")
  ) {
    return true;
  }
  return MARKETING_SUBJECT_RE.test(subject);
}

function isAdministrativeNonCustomer(
  input: OpportunityCorrespondenceClassifierInput,
  subject: string,
  bodyText: string
): boolean {
  if (input.direction !== "inbound") return false;
  const content = `${subject}\n${bodyText}`;
  return (
    PROPERTY_ADMIN_RELATIONSHIP_RE.test(content) &&
    PROPERTY_ADMIN_ACTION_RE.test(content) &&
    !TRADES_PROJECT_INTENT_RE.test(content)
  );
}

function externalRecipient(
  input: OpportunityCorrespondenceClassifierInput
): string | null {
  for (const value of [...(input.toEmails ?? []), ...(input.ccEmails ?? [])]) {
    const email = normalizeEmail(value);
    if (!email) continue;
    if (isInternalEmail(email, input)) continue;
    if (isProviderAddress(email, input)) continue;
    if (isSystemAddress(email)) continue;
    return email;
  }
  return null;
}

function duplicateProviderMessage(
  providerMessageId: string | null,
  existingProviderMessageIds: Iterable<string> | null | undefined
): boolean {
  if (!providerMessageId || !existingProviderMessageIds) return false;
  const normalized = providerMessageId.trim();
  for (const value of existingProviderMessageIds) {
    if (value.trim() === normalized) return true;
  }
  return false;
}

function parsedContactFormSubmitterEmail(
  input: OpportunityCorrespondenceClassifierInput,
  submitterEmail: string | null,
  subject: string,
  bodyText: string
): string | null {
  if (!submitterEmail) return null;
  const parsedSubmitter = normalizeEmail(
    extractContactFormSubmission(subject, bodyText)?.email
  );
  return parsedSubmitter === submitterEmail ? submitterEmail : null;
}

function withResponseClassification(
  input: OpportunityCorrespondenceClassifierInput,
  classification: BaseOpportunityCorrespondenceClassification
): OpportunityCorrespondenceClassification {
  let responseKind: OpportunityResponseKind = "unknown";

  if (classification.noiseReason === "bounce") {
    responseKind = "delivery_receipt";
  } else if (
    classification.partyRole === "internal" ||
    classification.noiseReason === "internal_system"
  ) {
    responseKind = "internal_note";
  } else if (classification.direction === "inbound") {
    responseKind = "not_applicable";
  } else if (
    classification.partyRole === "ops" &&
    classification.isMeaningful
  ) {
    responseKind = input.responseKindHint ?? "unknown";
  }

  return {
    ...classification,
    responseDefinitionVersion: 1,
    responseKind,
    countsAsFirstResponse:
      classification.direction === "outbound" &&
      classification.partyRole === "ops" &&
      classification.isMeaningful &&
      (responseKind === "human" || responseKind === "configured_automation"),
  };
}

export function classifyOpportunityCorrespondence(
  input: OpportunityCorrespondenceClassifierInput
): OpportunityCorrespondenceClassification {
  const providerThreadId = normalizeId(input.providerThreadId);
  const providerMessageId = normalizeId(input.providerMessageId);
  const fromEmail = normalizeEmail(input.fromEmail);
  const subject = input.subject ?? "";
  const bodyText = input.bodyText ?? "";
  const submitterEmail = normalizeEmail(input.submitterEmail);

  if (!providerThreadId) {
    return withResponseClassification(input, {
      direction: input.direction,
      partyRole: "unknown",
      isMeaningful: false,
      noiseReason: "missing_provider_id",
      customerEmail: null,
    });
  }

  if (
    duplicateProviderMessage(
      providerMessageId,
      input.existingProviderMessageIds
    )
  ) {
    return withResponseClassification(input, {
      direction: input.direction,
      partyRole: "unknown",
      isMeaningful: false,
      noiseReason: "duplicate_provider_message_id",
      customerEmail: null,
    });
  }

  if (isBounce(fromEmail, subject, bodyText)) {
    return withResponseClassification(input, {
      direction: input.direction,
      partyRole: "system",
      isMeaningful: false,
      noiseReason: "bounce",
      customerEmail: null,
    });
  }

  if (isMarketingNoise(input, subject)) {
    return withResponseClassification(input, {
      direction: input.direction,
      partyRole: "marketing",
      isMeaningful: false,
      noiseReason: "marketing_noise",
      customerEmail: null,
    });
  }

  if (
    isRecruitingProviderNoise({
      direction: input.direction,
      fromEmail,
      toEmails: input.toEmails,
      ccEmails: input.ccEmails,
      subject,
      bodyText,
    })
  ) {
    return withResponseClassification(input, {
      direction: input.direction,
      partyRole: "provider",
      isMeaningful: false,
      noiseReason: "provider_noise",
      customerEmail: null,
    });
  }

  if (input.direction === "inbound") {
    const contactFormSubmitterEmail = parsedContactFormSubmitterEmail(
      input,
      submitterEmail,
      subject,
      bodyText
    );

    if (
      contactFormSubmitterEmail &&
      !isInternalEmail(contactFormSubmitterEmail, input) &&
      !isProviderAddress(contactFormSubmitterEmail, input) &&
      !isSystemAddress(contactFormSubmitterEmail)
    ) {
      return withResponseClassification(input, {
        direction: "inbound",
        partyRole: "customer",
        isMeaningful: true,
        noiseReason: null,
        customerEmail: contactFormSubmitterEmail,
      });
    }

    if (isProviderAddress(fromEmail, input)) {
      return withResponseClassification(input, {
        direction: "inbound",
        partyRole: "provider",
        isMeaningful: false,
        noiseReason: "provider_noise",
        customerEmail: null,
      });
    }

    if (isInternalEmail(fromEmail, input) || isSystemAddress(fromEmail)) {
      return withResponseClassification(input, {
        direction: "inbound",
        partyRole: "internal",
        isMeaningful: false,
        noiseReason: "internal_system",
        customerEmail: null,
      });
    }

    if (isAdministrativeNonCustomer(input, subject, bodyText)) {
      return withResponseClassification(input, {
        direction: "inbound",
        partyRole: "unknown",
        isMeaningful: false,
        noiseReason: "administrative_non_customer",
        customerEmail: null,
      });
    }

    if (fromEmail) {
      return withResponseClassification(input, {
        direction: "inbound",
        partyRole: "customer",
        isMeaningful: true,
        noiseReason: null,
        customerEmail: fromEmail,
      });
    }
  }

  if (input.direction === "outbound") {
    const recipient = externalRecipient(input);
    if (
      recipient &&
      (isInternalEmail(fromEmail, input) ||
        fromEmail === normalizeEmail(input.connectionEmail))
    ) {
      return withResponseClassification(input, {
        direction: "outbound",
        partyRole: "ops",
        isMeaningful: true,
        noiseReason: null,
        customerEmail: recipient,
      });
    }

    if (!recipient) {
      return withResponseClassification(input, {
        direction: "outbound",
        partyRole: "internal",
        isMeaningful: false,
        noiseReason: "internal_system",
        customerEmail: null,
      });
    }
  }

  return withResponseClassification(input, {
    direction: input.direction,
    partyRole: "unknown",
    isMeaningful: false,
    noiseReason: "provider_noise",
    customerEmail: null,
  });
}
