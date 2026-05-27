import { matchPlatform } from "@/lib/api/services/known-platforms";
import { extractEmailAddress } from "@/lib/utils/email-parsing";

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
  | "duplicate_provider_message_id"
  | "marketing_noise"
  | "missing_provider_id"
  | null;

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
}

export interface OpportunityCorrespondenceClassification {
  direction: OpportunityCorrespondenceDirection;
  partyRole: OpportunityCorrespondencePartyRole;
  isMeaningful: boolean;
  noiseReason: OpportunityCorrespondenceNoiseReason;
  customerEmail: string | null;
}

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

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = extractEmailAddress(value ?? "").toLowerCase().trim();
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

function normalizedSet(values: Array<string | null | undefined> | null | undefined): Set<string> {
  return new Set(values?.map(normalizeEmail).filter(Boolean) as string[]);
}

function companyDomainSet(input: OpportunityCorrespondenceClassifierInput): Set<string> {
  return new Set(
    (input.companyDomains ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function knownInternalEmails(input: OpportunityCorrespondenceClassifierInput): Set<string> {
  return normalizedSet([
    input.connectionEmail,
    ...(input.userEmailAddresses ?? []),
  ]);
}

function knownPlatformEmails(input: OpportunityCorrespondenceClassifierInput): Set<string> {
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

function isSystemAddress(email: string | null): boolean {
  if (!email) return false;
  return SYSTEM_LOCAL_PARTS.has(localPart(email));
}

function isProviderAddress(
  email: string | null,
  input: OpportunityCorrespondenceClassifierInput
): boolean {
  if (!email) return false;
  return Boolean(matchPlatform(email)) || knownPlatformEmails(input).has(email);
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
  if (input.labels?.some((label) => label.toUpperCase() === "CATEGORY_PROMOTIONS")) {
    return true;
  }
  return MARKETING_SUBJECT_RE.test(subject);
}

function externalRecipient(input: OpportunityCorrespondenceClassifierInput): string | null {
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

export function classifyOpportunityCorrespondence(
  input: OpportunityCorrespondenceClassifierInput
): OpportunityCorrespondenceClassification {
  const providerThreadId = normalizeId(input.providerThreadId);
  const providerMessageId = normalizeId(input.providerMessageId);
  const fromEmail = normalizeEmail(input.fromEmail);
  const subject = input.subject ?? "";
  const bodyText = input.bodyText ?? "";
  const submitterEmail = normalizeEmail(input.submitterEmail);
  const contactEmail = normalizeEmail(input.contactEmail);

  if (!providerThreadId) {
    return {
      direction: input.direction,
      partyRole: "unknown",
      isMeaningful: false,
      noiseReason: "missing_provider_id",
      customerEmail: null,
    };
  }

  if (duplicateProviderMessage(providerMessageId, input.existingProviderMessageIds)) {
    return {
      direction: input.direction,
      partyRole: "unknown",
      isMeaningful: false,
      noiseReason: "duplicate_provider_message_id",
      customerEmail: null,
    };
  }

  if (isBounce(fromEmail, subject, bodyText)) {
    return {
      direction: input.direction,
      partyRole: "system",
      isMeaningful: false,
      noiseReason: "bounce",
      customerEmail: null,
    };
  }

  if (isMarketingNoise(input, subject)) {
    return {
      direction: input.direction,
      partyRole: "marketing",
      isMeaningful: false,
      noiseReason: "marketing_noise",
      customerEmail: null,
    };
  }

  if (input.direction === "inbound") {
    const customerEmail = submitterEmail ?? contactEmail ?? fromEmail;
    if (customerEmail && !isInternalEmail(customerEmail, input) && !isProviderAddress(customerEmail, input)) {
      return {
        direction: "inbound",
        partyRole: "customer",
        isMeaningful: true,
        noiseReason: null,
        customerEmail,
      };
    }

    if (isProviderAddress(fromEmail, input)) {
      return {
        direction: "inbound",
        partyRole: "provider",
        isMeaningful: false,
        noiseReason: "provider_noise",
        customerEmail: null,
      };
    }

    if (isInternalEmail(fromEmail, input) || isSystemAddress(fromEmail)) {
      return {
        direction: "inbound",
        partyRole: "internal",
        isMeaningful: false,
        noiseReason: "internal_system",
        customerEmail: null,
      };
    }
  }

  if (input.direction === "outbound") {
    const recipient = externalRecipient(input);
    if (recipient && (isInternalEmail(fromEmail, input) || fromEmail === normalizeEmail(input.connectionEmail))) {
      return {
        direction: "outbound",
        partyRole: "ops",
        isMeaningful: true,
        noiseReason: null,
        customerEmail: recipient,
      };
    }

    if (!recipient) {
      return {
        direction: "outbound",
        partyRole: "internal",
        isMeaningful: false,
        noiseReason: "internal_system",
        customerEmail: null,
      };
    }
  }

  return {
    direction: input.direction,
    partyRole: "unknown",
    isMeaningful: false,
    noiseReason: "provider_noise",
    customerEmail: null,
  };
}
