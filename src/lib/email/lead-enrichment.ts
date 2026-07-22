import { matchPlatform } from "@/lib/api/services/known-platforms";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type {
  EmailConnection,
  SyncProfile,
} from "@/lib/types/email-connection";
import {
  normalizeEmailAddress,
  type ContactFormSubmissionIdentity,
} from "@/lib/utils/email-parsing";
import {
  extractAddressFromBody,
  extractEstimatedValueFromBody,
  extractPhoneFromBody,
} from "@/lib/utils/body-fact-extractors";
import { resolveGuardedOpportunityClientId } from "@/lib/email/opportunity-client-identity";

type OpportunitySourceValue =
  | "referral"
  | "website"
  | "email"
  | "phone"
  | "walk_in"
  | "social_media"
  | "repeat_client"
  | "voice_log"
  | "other";

export interface LeadEnrichmentFacts {
  contactName: string | null;
  companyName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  estimatedValue: number | null;
  description: string | null;
  source: OpportunitySourceValue;
  sourcePlatform: string | null;
  providerThreadId: string | null;
  providerMessageId: string | null;
  extractionSource:
    | "contact_form"
    | "inbound_sender"
    | "outbound_recipient"
    | "import_payload"
    | "historical_metadata"
    | "ai_classified";
  /**
   * Model-reported confidence (0..1). Populated only for AI-classified facts
   * (extractionSource === 'ai_classified'); used as the provenance confidence
   * for source='ai'. Null/undefined for every other source.
   */
  aiConfidence?: number | null;
}

export interface ExistingOpportunityForEnrichment {
  company_id?: string | null;
  client_id?: string | null;
  client_ref?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  estimated_value?: number | string | null;
  detected_value?: number | string | null;
  description?: string | null;
  source?: string | null;
  source_email_id?: string | null;
  source_message_id?: string | null;
  source_metadata?: Record<string, unknown> | null;
}

export interface ExistingClientForEnrichment {
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  address?: string | null;
}

export interface LeadEnrichmentUpdateDecision {
  opportunity: Record<string, unknown>;
  client: Record<string, unknown>;
}

interface LeadEnrichmentFieldProtection {
  opportunity: ReadonlySet<string>;
  client: ReadonlySet<string>;
  opportunityEvidence: ReadonlyMap<string, LeadEnrichmentFieldEvidence>;
  clientEvidence: ReadonlyMap<string, LeadEnrichmentFieldEvidence>;
}

interface LeadEnrichmentFieldEvidence {
  valueSnapshot: string | null;
  confidence: number | null;
}

interface LeadEnrichmentFromEmailInput {
  email: NormalizedEmail;
  direction: "inbound" | "outbound";
  connection: EmailConnection;
  profile?: Partial<SyncProfile> | null;
  submitter?: ContactFormSubmissionIdentity | null;
}

interface LeadEnrichmentFromImportInput {
  contactName?: string | null;
  companyName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  estimatedValue?: number | null;
  description?: string | null;
  providerThreadId?: string | null;
  providerMessageId?: string | null;
  extractionSource: "import_payload" | "historical_metadata" | "ai_classified";
  sourcePlatform?: string | null;
  /** Model confidence for AI-classified facts; ignored otherwise. */
  aiConfidence?: number | null;
}

interface ApplyCanonicalLeadEnrichmentInput {
  supabase: {
    from: (table: string) => unknown;
  };
  opportunityId: string | null | undefined;
  clientId?: string | null;
  facts: LeadEnrichmentFacts;
  /**
   * When provided, one field_provenance row is upserted per filled field. The
   * provenance table is company-scoped, so it cannot be written without it.
   * Omit to skip provenance (e.g. in unit fixtures that don't exercise it).
   */
  companyId?: string | null;
  /**
   * Operator-edit metadata. When source resolves to 'operator', the row records
   * actor_user_id and is treated as ground truth (confidence 1.0).
   */
  actorUserId?: string | null;
}

export type LeadFieldProvenanceSource =
  | "operator"
  | "ai"
  | "contact_form"
  | "inbound"
  | "outbound"
  | "import"
  | "merge";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_NAME_RE =
  /^(?:unknown|new lead|n\/a|na|null|undefined|none|-|\u2014)$/i;
const GENERIC_DESCRIPTION_RE =
  /^(?:email inquiry|imported from email pipeline|pipeline import:?|new lead)$/i;
const UNSAFE_LOCAL_PARTS = new Set([
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

const SCHEMA_GAPS = [
  "No clients.company_name or opportunities.company_name column exists; company name can only fill weak clients.name values.",
];

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function cleanMultilineText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return cleaned || null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = normalizeEmailAddress(value);
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

function emailDomain(email: string | null | undefined): string {
  return email?.split("@")[1]?.toLowerCase().trim() ?? "";
}

function localPart(email: string | null | undefined): string {
  return email?.split("@")[0]?.toLowerCase().trim() ?? "";
}

function displayNameFromMailbox(
  mailbox: string | null | undefined,
  explicitName?: string | null
): string | null {
  const email = normalizeEmail(mailbox);
  const rawLocalPart = localPart(email);
  const isLocalPartDisplay = (value: string | null): boolean =>
    Boolean(
      value && rawLocalPart && value.trim().toLowerCase() === rawLocalPart
    );
  const explicit = cleanText(explicitName);
  if (explicit && !EMAIL_RE.test(explicit) && !isLocalPartDisplay(explicit)) {
    return explicit;
  }

  const match = mailbox?.match(/^\s*"?([^"<]+?)"?\s*<[^>]+@[^>]+>/);
  const candidate = cleanText(match?.[1] ?? null);
  if (!candidate || EMAIL_RE.test(candidate)) return null;
  if (isLocalPartDisplay(candidate)) return null;
  return candidate;
}

function localPartToName(email: string | null): string | null {
  const local = localPart(email);
  if (!local || UNSAFE_LOCAL_PARTS.has(local)) return null;
  const name = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return cleanText(name);
}

function unsafeEmailsFor(
  connection: EmailConnection,
  profile?: Partial<SyncProfile> | null
): Set<string> {
  return new Set(
    [
      connection.email,
      ...(profile?.userEmailAddresses ?? []),
      ...(profile?.knownPlatformSenders ?? []),
    ]
      .map(normalizeEmail)
      .filter(Boolean) as string[]
  );
}

function isInternalEmail(
  email: string | null,
  connection: EmailConnection,
  profile?: Partial<SyncProfile> | null
): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (unsafeEmailsFor(connection, profile).has(normalized)) return true;
  const domain = emailDomain(normalized);
  return Boolean(
    domain && profile?.companyDomains?.some((d) => d.toLowerCase() === domain)
  );
}

function isPlatformOrSystemEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (matchPlatform(normalized)) return true;
  return UNSAFE_LOCAL_PARTS.has(localPart(normalized));
}

function safeCustomerEmail(
  email: string | null,
  connection: EmailConnection,
  profile?: Partial<SyncProfile> | null
): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  if (isInternalEmail(normalized, connection, profile)) return null;
  if (isPlatformOrSystemEmail(normalized)) return null;
  return normalized;
}

function externalRecipient(
  email: NormalizedEmail,
  connection: EmailConnection,
  profile?: Partial<SyncProfile> | null
): { email: string; name: string | null } | null {
  for (const mailbox of [...email.to, ...email.cc]) {
    const candidateEmail = safeCustomerEmail(
      normalizeEmail(mailbox),
      connection,
      profile
    );
    if (!candidateEmail) continue;
    return {
      email: candidateEmail,
      name: displayNameFromMailbox(mailbox),
    };
  }
  return null;
}

function isWeakName(value: string | null | undefined): boolean {
  const cleaned = cleanText(value);
  if (!cleaned) return true;
  if (GENERIC_NAME_RE.test(cleaned)) return true;
  if (EMAIL_RE.test(cleaned)) return true;
  return false;
}

function normalizedNameKey(value: string | null | undefined): string {
  return (cleanText(value) ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isLocalPartDerivedName(
  name: string | null | undefined,
  email: string | null | undefined
): boolean {
  const derived = localPartToName(normalizeEmail(email));
  return Boolean(
    derived && normalizedNameKey(name) === normalizedNameKey(derived)
  );
}

function hasVerifiedContactNameEvidence(facts: LeadEnrichmentFacts): boolean {
  return (
    facts.extractionSource === "contact_form" ||
    facts.extractionSource === "inbound_sender" ||
    facts.extractionSource === "outbound_recipient"
  );
}

function canReplaceContactName(
  name: string | null | undefined,
  email: string | null | undefined,
  facts: LeadEnrichmentFacts
): boolean {
  if (isWeakName(name)) return true;
  return (
    hasVerifiedContactNameEvidence(facts) &&
    normalizeEmail(email) === normalizeEmail(facts.contactEmail) &&
    isLocalPartDerivedName(name, email)
  );
}

function isWeakEmail(value: string | null | undefined): boolean {
  const email = normalizeEmail(value);
  if (!email) return true;
  return isPlatformOrSystemEmail(email);
}

function isWeakText(value: string | null | undefined): boolean {
  const cleaned = cleanText(value);
  if (!cleaned) return true;
  return GENERIC_DESCRIPTION_RE.test(cleaned);
}

function isWeakNumber(value: number | string | null | undefined): boolean {
  if (value == null) return true;
  const number = Number(value);
  return !Number.isFinite(number) || number <= 0;
}

function isBlankJson(
  value: Record<string, unknown> | null | undefined
): boolean {
  if (value == null) return true;
  return Object.keys(value).length === 0;
}

function hasStrictlyBetterMatchingEvidence(
  currentValue: unknown,
  fieldName: string,
  incomingConfidence: number | null,
  evidence: ReadonlyMap<string, LeadEnrichmentFieldEvidence> | undefined
): boolean {
  if (incomingConfidence == null) return false;
  const currentEvidence = evidence?.get(fieldName);
  if (currentEvidence?.confidence == null) return false;
  if (incomingConfidence <= currentEvidence.confidence) return false;

  // Provenance may only authorize replacement while it still describes the
  // canonical value. If a human or another path changed the field without
  // updating provenance, fail closed instead of overwriting that newer value.
  return snapshotValue(currentValue) === currentEvidence.valueSnapshot;
}

function databaseFailure(operation: string, cause: unknown): Error {
  const detail =
    cause && typeof cause === "object" && "message" in cause
      ? String((cause as { message?: unknown }).message ?? "unknown error")
      : cause instanceof Error
        ? cause.message
        : "unknown error";
  const failure = new Error(`${operation} failed: ${detail}`);
  (failure as Error & { cause?: unknown }).cause = cause;
  return failure;
}

function isUndefinedColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "42703") return true;
  return (
    typeof candidate.message === "string" &&
    /column\s+.+\s+does not exist/i.test(candidate.message)
  );
}

// opportunities.estimated_value is numeric(12) — total of 12 digits, no scale,
// so the largest storable whole-dollar amount is 999,999,999,999. A figure above
// that (spam/marketing "$5,000,000,000", concatenated digits, a runaway k/m
// suffix) is not a real trades quote and must be rejected rather than risk a
// Postgres "numeric field overflow".
const ESTIMATED_VALUE_MAX = 999_999_999_999;
// opportunities.detected_value is a 4-byte integer; its ceiling is below the
// numeric(12) ceiling, so a value that is valid for estimated_value can still
// overflow the detected_value mirror. The mirror is skipped above this bound.
const DETECTED_VALUE_MAX = 2_147_483_647;

function validEstimatedValue(value: number | null | undefined): number | null {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const rounded = Math.round(number);
  // Reject out-of-range figures outright so a junk amount cannot fill a blank
  // estimated_value and then block a later legitimate extraction.
  if (rounded > ESTIMATED_VALUE_MAX) return null;
  return rounded;
}

export function getLeadEnrichmentSchemaGaps(): string[] {
  return [...SCHEMA_GAPS];
}

/**
 * Map a fact's extractionSource onto a provenance source. Operator edits pass
 * an explicit actorUserId and resolve to 'operator' regardless of extraction
 * source.
 */
export function provenanceSourceForFacts(
  facts: Pick<LeadEnrichmentFacts, "extractionSource">,
  actorUserId?: string | null
): LeadFieldProvenanceSource {
  if (actorUserId) return "operator";
  switch (facts.extractionSource) {
    case "contact_form":
      return "contact_form";
    case "inbound_sender":
      return "inbound";
    case "outbound_recipient":
      return "outbound";
    case "ai_classified":
      return "ai";
    case "import_payload":
    case "historical_metadata":
      return "import";
    default:
      return "import";
  }
}

/**
 * Confidence convention (application-layer, not enforced by DDL). Operator and
 * contact-form facts are ground truth (1.0); body-extracted inbound/outbound
 * carry lower confidence so a later operator edit cleanly supersedes them.
 */
export function provenanceConfidenceForSource(
  source: LeadFieldProvenanceSource
): number | null {
  switch (source) {
    case "operator":
    case "contact_form":
      return 1.0;
    case "import":
      return 0.8;
    case "inbound":
      return 0.6;
    case "outbound":
      return 0.5;
    case "ai":
      return null; // populated from the model's own confidence by AI callers
    case "merge":
      return null;
    default:
      return null;
  }
}

// Maps a written canonical column onto its provenance field_name. Columns not
// listed (e.g. source/source_email_id/source_message_id/source_metadata) are
// plumbing, not customer facts, so they are not provenance-tracked.
const OPPORTUNITY_PROVENANCE_FIELDS: Record<string, string> = {
  contact_name: "contact_name",
  contact_email: "contact_email",
  contact_phone: "contact_phone",
  address: "contact_address",
  estimated_value: "estimated_value",
  detected_value: "detected_value",
  description: "description",
};

const CLIENT_PROVENANCE_FIELDS: Record<string, string> = {
  name: "contact_name",
  email: "contact_email",
  phone_number: "contact_phone",
  address: "contact_address",
};

interface ProvenanceUpsertRow {
  company_id: string;
  entity_type: "opportunity" | "client";
  entity_id: string;
  field_name: string;
  value_snapshot: string | null;
  source: LeadFieldProvenanceSource;
  confidence: number | null;
  provider_thread_id: string | null;
  provider_message_id: string | null;
  actor_user_id: string | null;
  extracted_at: string;
}

function buildProvenanceRows(params: {
  companyId: string;
  opportunityId: string | null;
  clientId: string | null;
  opportunityUpdates: Record<string, unknown>;
  clientUpdates: Record<string, unknown>;
  facts: LeadEnrichmentFacts;
  source: LeadFieldProvenanceSource;
  confidence: number | null;
  actorUserId: string | null;
  now: string;
}): ProvenanceUpsertRow[] {
  const rows: ProvenanceUpsertRow[] = [];
  const base = {
    company_id: params.companyId,
    source: params.source,
    confidence: params.confidence,
    provider_thread_id: params.facts.providerThreadId,
    provider_message_id: params.facts.providerMessageId,
    actor_user_id: params.actorUserId,
    extracted_at: params.now,
  };

  if (params.opportunityId) {
    for (const [column, fieldName] of Object.entries(
      OPPORTUNITY_PROVENANCE_FIELDS
    )) {
      if (!(column in params.opportunityUpdates)) continue;
      rows.push({
        ...base,
        entity_type: "opportunity",
        entity_id: params.opportunityId,
        field_name: fieldName,
        value_snapshot: snapshotValue(params.opportunityUpdates[column]),
      });
    }
  }

  if (params.clientId) {
    for (const [column, fieldName] of Object.entries(
      CLIENT_PROVENANCE_FIELDS
    )) {
      if (!(column in params.clientUpdates)) continue;
      rows.push({
        ...base,
        entity_type: "client",
        entity_id: params.clientId,
        field_name: fieldName,
        value_snapshot: snapshotValue(params.clientUpdates[column]),
      });
    }
  }

  return rows;
}

function snapshotValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function leadEnrichmentFactsFromEmail(
  input: LeadEnrichmentFromEmailInput
): LeadEnrichmentFacts {
  const { email, direction, connection, profile, submitter } = input;
  const senderEmail = normalizeEmail(email.from);
  const platform = senderEmail ? matchPlatform(senderEmail) : null;

  if (submitter) {
    return {
      contactName: cleanText(submitter.name),
      companyName: cleanText(submitter.company ?? null),
      contactEmail: safeCustomerEmail(submitter.email, connection, profile),
      contactPhone: cleanText(submitter.phone),
      address: cleanText(submitter.address ?? null),
      estimatedValue: validEstimatedValue(submitter.estimatedValue ?? null),
      description: cleanMultilineText(submitter.message),
      source: "email",
      sourcePlatform: platform?.platformName ?? null,
      providerThreadId: cleanText(email.threadId),
      providerMessageId: cleanText(email.id),
      extractionSource: "contact_form",
    };
  }

  if (direction === "outbound") {
    const recipient = externalRecipient(email, connection, profile);
    // Outbound quote bodies frequently carry a dollar figure and the job-site
    // address. Scan the body for those non-identity facts only. We deliberately
    // do NOT scan for phone here — a phone in an outbound body is almost always
    // the operator's own number, never the customer's.
    const outboundBody = email.bodyTextClean || email.bodyText || email.snippet;
    return {
      contactName: recipient?.name ?? null,
      companyName: null,
      contactEmail: recipient?.email ?? null,
      contactPhone: null,
      address: extractAddressFromBody(outboundBody),
      estimatedValue: validEstimatedValue(
        extractEstimatedValueFromBody(outboundBody)
      ),
      description: null,
      source: "email",
      sourcePlatform: null,
      providerThreadId: cleanText(email.threadId),
      providerMessageId: cleanText(email.id),
      extractionSource: "outbound_recipient",
    };
  }

  const customerEmail = safeCustomerEmail(senderEmail, connection, profile);
  // P0-C: use a real display name only — never fabricate a name from the email
  // local-part (the "Canprojack" failure). The conversation-state contact
  // resolver records an unverified local-part guess in provenance instead.
  const customerName = customerEmail
    ? displayNameFromMailbox(email.from, email.fromName)
    : null;

  // Conservative body-text scan for non-identity facts. These never set
  // identity (name/email); they only fill address/value/phone holes. The body
  // is the message content, not the header sender — from_email is never used.
  const inboundBody = email.bodyTextClean || email.bodyText || email.snippet;

  return {
    contactName: customerName,
    companyName: null,
    contactEmail: customerEmail,
    contactPhone: extractPhoneFromBody(inboundBody, {
      excludedPhones: profile?.internalPhones,
    }),
    address: extractAddressFromBody(inboundBody),
    estimatedValue: validEstimatedValue(
      extractEstimatedValueFromBody(inboundBody)
    ),
    description: cleanMultilineText(email.bodyText || email.snippet),
    source: "email",
    sourcePlatform: platform?.platformName ?? null,
    providerThreadId: cleanText(email.threadId),
    providerMessageId: cleanText(email.id),
    extractionSource: "inbound_sender",
  };
}

export function leadEnrichmentFactsFromImport(
  input: LeadEnrichmentFromImportInput
): LeadEnrichmentFacts {
  return {
    contactName: cleanText(input.contactName),
    companyName: cleanText(input.companyName),
    contactEmail: isPlatformOrSystemEmail(input.contactEmail)
      ? null
      : normalizeEmail(input.contactEmail),
    contactPhone: cleanText(input.contactPhone),
    address: cleanText(input.address),
    estimatedValue: validEstimatedValue(input.estimatedValue),
    description: cleanMultilineText(input.description),
    source: "email",
    sourcePlatform: cleanText(input.sourcePlatform),
    providerThreadId: cleanText(input.providerThreadId),
    providerMessageId: cleanText(input.providerMessageId),
    extractionSource: input.extractionSource,
    aiConfidence: input.aiConfidence ?? null,
  };
}

/**
 * Resolve the provenance confidence for a write. For AI-classified facts the
 * model's own confidence is authoritative (clamped to 0..1); every other source
 * uses the documented per-source convention.
 */
export function provenanceConfidenceForFacts(
  facts: Pick<LeadEnrichmentFacts, "extractionSource" | "aiConfidence">,
  source: LeadFieldProvenanceSource
): number | null {
  if (source === "ai") {
    const c = facts.aiConfidence;
    if (c == null || !Number.isFinite(c)) return null;
    return Math.min(1, Math.max(0, c));
  }
  return provenanceConfidenceForSource(source);
}

export function buildLeadEnrichmentUpdates(input: {
  existingOpportunity?: ExistingOpportunityForEnrichment | null;
  existingClient?: ExistingClientForEnrichment | null;
  facts: LeadEnrichmentFacts;
  protectedFields?: LeadEnrichmentFieldProtection;
}): LeadEnrichmentUpdateDecision {
  const { existingOpportunity, existingClient, facts, protectedFields } = input;
  const opportunity: Record<string, unknown> = {};
  const client: Record<string, unknown> = {};
  const incomingSource = provenanceSourceForFacts(facts);
  const incomingConfidence = provenanceConfidenceForFacts(
    facts,
    incomingSource
  );

  if (existingOpportunity) {
    if (
      facts.contactName &&
      !protectedFields?.opportunity.has("contact_name") &&
      (canReplaceContactName(
        existingOpportunity.contact_name,
        existingOpportunity.contact_email,
        facts
      ) ||
        hasStrictlyBetterMatchingEvidence(
          existingOpportunity.contact_name,
          "contact_name",
          incomingConfidence,
          protectedFields?.opportunityEvidence
        ))
    ) {
      opportunity.contact_name = facts.contactName;
    }
    if (
      facts.contactEmail &&
      !protectedFields?.opportunity.has("contact_email") &&
      (isWeakEmail(existingOpportunity.contact_email) ||
        hasStrictlyBetterMatchingEvidence(
          existingOpportunity.contact_email,
          "contact_email",
          incomingConfidence,
          protectedFields?.opportunityEvidence
        ))
    ) {
      opportunity.contact_email = facts.contactEmail;
    }
    if (
      facts.contactPhone &&
      !protectedFields?.opportunity.has("contact_phone") &&
      (isWeakText(existingOpportunity.contact_phone) ||
        hasStrictlyBetterMatchingEvidence(
          existingOpportunity.contact_phone,
          "contact_phone",
          incomingConfidence,
          protectedFields?.opportunityEvidence
        ))
    ) {
      opportunity.contact_phone = facts.contactPhone;
    }
    if (
      facts.address &&
      !protectedFields?.opportunity.has("contact_address") &&
      (isWeakText(existingOpportunity.address) ||
        hasStrictlyBetterMatchingEvidence(
          existingOpportunity.address,
          "contact_address",
          incomingConfidence,
          protectedFields?.opportunityEvidence
        ))
    ) {
      opportunity.address = facts.address;
    }
    if (
      facts.estimatedValue != null &&
      !protectedFields?.opportunity.has("estimated_value") &&
      (isWeakNumber(existingOpportunity.estimated_value) ||
        hasStrictlyBetterMatchingEvidence(
          existingOpportunity.estimated_value,
          "estimated_value",
          incomingConfidence,
          protectedFields?.opportunityEvidence
        ))
    ) {
      opportunity.estimated_value = facts.estimatedValue;
    }
    // detected_value is a 4-byte integer; only mirror when the value fits, so a
    // large-but-valid estimated_value never overflows the integer column (which
    // would fail the entire opportunity write).
    if (
      facts.estimatedValue != null &&
      facts.estimatedValue <= DETECTED_VALUE_MAX &&
      !protectedFields?.opportunity.has("detected_value") &&
      (isWeakNumber(existingOpportunity.detected_value) ||
        hasStrictlyBetterMatchingEvidence(
          existingOpportunity.detected_value,
          "detected_value",
          incomingConfidence,
          protectedFields?.opportunityEvidence
        ))
    ) {
      opportunity.detected_value = facts.estimatedValue;
    }
    if (
      facts.description &&
      !protectedFields?.opportunity.has("description") &&
      (isWeakText(existingOpportunity.description) ||
        hasStrictlyBetterMatchingEvidence(
          existingOpportunity.description,
          "description",
          incomingConfidence,
          protectedFields?.opportunityEvidence
        ))
    ) {
      opportunity.description = facts.description;
    }
    if (facts.source && isWeakText(existingOpportunity.source)) {
      opportunity.source = facts.source;
    }
    if (
      facts.providerThreadId &&
      isWeakText(existingOpportunity.source_email_id)
    ) {
      opportunity.source_email_id = facts.providerThreadId;
    }
    // New (additive) message-id pointer: the exact provider message a fact came
    // from. Distinct from source_email_id, which holds the thread id.
    if (
      facts.providerMessageId &&
      isWeakText(existingOpportunity.source_message_id)
    ) {
      opportunity.source_message_id = facts.providerMessageId;
    }
    // New (additive) structured platform metadata, fill-blank only.
    if (
      facts.sourcePlatform &&
      isBlankJson(existingOpportunity.source_metadata)
    ) {
      opportunity.source_metadata = {
        platform_name: facts.sourcePlatform,
        detected_via: facts.extractionSource,
        provider_thread_id: facts.providerThreadId,
      };
    }
  }

  if (existingClient) {
    const clientName = facts.companyName ?? facts.contactName;
    if (
      clientName &&
      !protectedFields?.client.has("contact_name") &&
      (canReplaceContactName(
        existingClient.name,
        existingClient.email,
        facts
      ) ||
        hasStrictlyBetterMatchingEvidence(
          existingClient.name,
          "contact_name",
          incomingConfidence,
          protectedFields?.clientEvidence
        ))
    ) {
      client.name = clientName;
    }
    if (
      facts.contactEmail &&
      !protectedFields?.client.has("contact_email") &&
      (isWeakEmail(existingClient.email) ||
        hasStrictlyBetterMatchingEvidence(
          existingClient.email,
          "contact_email",
          incomingConfidence,
          protectedFields?.clientEvidence
        ))
    ) {
      client.email = facts.contactEmail;
    }
    if (
      facts.contactPhone &&
      !protectedFields?.client.has("contact_phone") &&
      (isWeakText(existingClient.phone_number) ||
        hasStrictlyBetterMatchingEvidence(
          existingClient.phone_number,
          "contact_phone",
          incomingConfidence,
          protectedFields?.clientEvidence
        ))
    ) {
      client.phone_number = facts.contactPhone;
    }
    if (
      facts.address &&
      !protectedFields?.client.has("contact_address") &&
      (isWeakText(existingClient.address) ||
        hasStrictlyBetterMatchingEvidence(
          existingClient.address,
          "contact_address",
          incomingConfidence,
          protectedFields?.clientEvidence
        ))
    ) {
      client.address = facts.address;
    }
  }

  return { opportunity, client };
}

async function loadProtectedLeadFields(params: {
  supabase: { from: (table: string) => unknown };
  companyId: string;
  opportunityId: string;
  clientId: string | null;
}): Promise<LeadEnrichmentFieldProtection> {
  interface ProvenanceRow {
    entity_type: string;
    entity_id: string;
    field_name: string;
    source: string;
    actor_user_id: string | null;
    confirmed_at: string | null;
    confirmed_by: string | null;
    value_snapshot: string | null;
    confidence: number | null;
  }
  interface ProvenanceQuery {
    eq: (column: string, value: string) => ProvenanceQuery;
    limit: (
      count: number
    ) => Promise<{ data: ProvenanceRow[] | null; error?: unknown }>;
  }

  const readEntity = async (
    entityType: "opportunity" | "client",
    entityId: string
  ): Promise<ProvenanceRow[]> => {
    const { data, error } = await (
      params.supabase.from("lead_field_provenance") as {
        select: (columns: string) => ProvenanceQuery;
      }
    )
      .select(
        "entity_type, entity_id, field_name, value_snapshot, source, confidence, actor_user_id, confirmed_at, confirmed_by"
      )
      .eq("company_id", params.companyId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .limit(100);
    if (error) {
      throw databaseFailure("lead field provenance read", error);
    }
    return data ?? [];
  };

  const opportunityRows = await readEntity("opportunity", params.opportunityId);
  const clientRows = params.clientId
    ? await readEntity("client", params.clientId)
    : [];
  const opportunity = new Set<string>();
  const client = new Set<string>();
  const opportunityEvidence = new Map<string, LeadEnrichmentFieldEvidence>();
  const clientEvidence = new Map<string, LeadEnrichmentFieldEvidence>();
  const canonicalFieldName = (fieldName: string): string => {
    switch (fieldName) {
      case "name":
        return "contact_name";
      case "email":
        return "contact_email";
      case "phone":
      case "phone_number":
        return "contact_phone";
      case "address":
        return "contact_address";
      default:
        return fieldName;
    }
  };
  for (const row of [...opportunityRows, ...clientRows]) {
    if (
      (row.entity_type === "opportunity" &&
        row.entity_id !== params.opportunityId) ||
      (row.entity_type === "client" && row.entity_id !== params.clientId)
    ) {
      continue;
    }
    const fieldName = canonicalFieldName(row.field_name);
    const evidence = {
      valueSnapshot: row.value_snapshot ?? null,
      confidence:
        row.confidence == null || !Number.isFinite(Number(row.confidence))
          ? null
          : Number(row.confidence),
    };
    if (row.entity_type === "opportunity") {
      opportunityEvidence.set(fieldName, evidence);
    }
    if (row.entity_type === "client") {
      clientEvidence.set(fieldName, evidence);
    }
    const isProtected =
      row.source === "operator" ||
      Boolean(row.actor_user_id || row.confirmed_at || row.confirmed_by);
    if (!isProtected) continue;
    if (row.entity_type === "opportunity") opportunity.add(fieldName);
    if (row.entity_type === "client") client.add(fieldName);
  }
  return { opportunity, client, opportunityEvidence, clientEvidence };
}

export function buildNewOpportunityEnrichmentFields(
  facts: LeadEnrichmentFacts
): Record<string, unknown> {
  return buildLeadEnrichmentUpdates({
    existingOpportunity: {
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      address: null,
      estimated_value: null,
      detected_value: null,
      description: null,
      source: null,
      source_email_id: null,
      source_message_id: null,
      source_metadata: null,
    },
    facts,
  }).opportunity;
}

export function buildNewClientEnrichmentFields(
  facts: LeadEnrichmentFacts
): Record<string, unknown> {
  return buildLeadEnrichmentUpdates({
    existingClient: {
      name: null,
      email: null,
      phone_number: null,
      address: null,
    },
    facts,
  }).client;
}

export async function applyCanonicalLeadEnrichment({
  supabase,
  opportunityId,
  clientId,
  facts,
  companyId,
  actorUserId,
}: ApplyCanonicalLeadEnrichmentInput): Promise<LeadEnrichmentUpdateDecision> {
  if (!opportunityId) return { opportunity: {}, client: {} };

  // Base columns that have always existed. The two trailing columns
  // (source_message_id, source_metadata) are additive (P2 migration); if that
  // migration has not been applied in this environment the wider select errors,
  // so we fall back to the base columns rather than failing the whole write.
  const BASE_OPPORTUNITY_COLUMNS = [
    "company_id",
    "client_id",
    "client_ref",
    "contact_name",
    "contact_email",
    "contact_phone",
    "address",
    "estimated_value",
    "detected_value",
    "description",
    "source",
    "source_email_id",
  ];
  const ADDITIVE_OPPORTUNITY_COLUMNS = ["source_message_id", "source_metadata"];

  const selectOpportunity = (columns: string[]) => {
    type OpportunityQuery = {
      eq: (column: string, value: string) => OpportunityQuery;
      maybeSingle: () => Promise<{
        data:
          | (ExistingOpportunityForEnrichment & {
              client_id?: string | null;
              client_ref?: string | null;
            })
          | null;
        error?: unknown;
      }>;
    };
    let query = (
      supabase.from("opportunities") as {
        select: (columns: string) => OpportunityQuery;
      }
    )
      .select(columns.join(", "))
      .eq("id", opportunityId);
    if (companyId != null) {
      query = query.eq("company_id", companyId);
    }
    return query.maybeSingle();
  };

  let opportunityRow:
    | (ExistingOpportunityForEnrichment & {
        client_id?: string | null;
        client_ref?: string | null;
      })
    | null = null;
  {
    const wide = await selectOpportunity([
      ...BASE_OPPORTUNITY_COLUMNS,
      ...ADDITIVE_OPPORTUNITY_COLUMNS,
    ]);
    if (wide.error) {
      if (!isUndefinedColumnError(wide.error)) {
        throw databaseFailure("opportunity enrichment read", wide.error);
      }
      // The additive columns are absent (migration not yet applied). Retry with
      // the base columns so enrichment still fills the legacy fields.
      console.warn(
        "[lead-enrichment] additive opportunity columns unavailable; falling back",
        wide.error
      );
      const base = await selectOpportunity(BASE_OPPORTUNITY_COLUMNS);
      if (base.error) {
        throw databaseFailure(
          "opportunity enrichment fallback read",
          base.error
        );
      }
      opportunityRow = base.data ?? null;
    } else {
      opportunityRow = wide.data ?? null;
    }
  }
  if (!opportunityRow) {
    throw new Error(`Opportunity ${opportunityId} was not found`);
  }
  if (companyId != null && opportunityRow.company_id !== companyId) {
    throw new Error(
      `Opportunity ${opportunityId} does not belong to company ${companyId}`
    );
  }

  const authoritativeClientId = resolveGuardedOpportunityClientId({
    clientId: opportunityRow.client_id,
    clientRef: opportunityRow.client_ref,
  });
  if (clientId != null && clientId !== authoritativeClientId) {
    throw new Error(
      `Explicit client ${clientId} does not match opportunity ${opportunityId} client ${authoritativeClientId ?? "none"}`
    );
  }

  const resolvedClientId = authoritativeClientId;
  const provenanceCompanyId = companyId ?? opportunityRow.company_id ?? null;

  let clientRow: ExistingClientForEnrichment | null = null;
  if (resolvedClientId) {
    type ClientQuery = {
      eq: (column: string, value: string) => ClientQuery;
      maybeSingle: () => Promise<{
        data: ExistingClientForEnrichment | null;
        error?: unknown;
      }>;
    };
    let clientQuery = (
      supabase.from("clients") as {
        select: (columns: string) => ClientQuery;
      }
    )
      .select("name, email, phone_number, address")
      .eq("id", resolvedClientId);
    if (provenanceCompanyId != null) {
      clientQuery = clientQuery.eq("company_id", provenanceCompanyId);
    }
    const { data, error } = await clientQuery.maybeSingle();
    if (error) {
      throw databaseFailure("client enrichment read", error);
    }
    clientRow = data ?? null;
  }

  const protectedFields = provenanceCompanyId
    ? await loadProtectedLeadFields({
        supabase,
        companyId: provenanceCompanyId,
        opportunityId,
        clientId: resolvedClientId,
      })
    : undefined;

  const updates = buildLeadEnrichmentUpdates({
    existingOpportunity: opportunityRow,
    existingClient: clientRow,
    facts,
    protectedFields,
  });

  if (Object.keys(updates.opportunity).length > 0) {
    type UpdateQuery = {
      eq: (column: string, value: string) => UpdateQuery;
      then: Promise<{ error?: unknown }>["then"];
    };
    let updateQuery = (
      supabase.from("opportunities") as {
        update: (payload: Record<string, unknown>) => {
          eq: (column: string, value: string) => UpdateQuery;
        };
      }
    )
      .update(updates.opportunity)
      .eq("id", opportunityId);
    if (provenanceCompanyId != null) {
      updateQuery = updateQuery.eq("company_id", provenanceCompanyId);
    }
    const { error } = await updateQuery;
    if (error) {
      throw databaseFailure("opportunity enrichment update", error);
    }
  }

  if (resolvedClientId && Object.keys(updates.client).length > 0) {
    type UpdateQuery = {
      eq: (column: string, value: string) => UpdateQuery;
      then: Promise<{ error?: unknown }>["then"];
    };
    let updateQuery = (
      supabase.from("clients") as {
        update: (payload: Record<string, unknown>) => {
          eq: (column: string, value: string) => UpdateQuery;
        };
      }
    )
      .update(updates.client)
      .eq("id", resolvedClientId);
    if (provenanceCompanyId != null) {
      updateQuery = updateQuery.eq("company_id", provenanceCompanyId);
    }
    const { error } = await updateQuery;
    if (error) {
      throw databaseFailure("client enrichment update", error);
    }
  }

  // Record field-level provenance for every field this enrichment filled. One
  // row per (company, entity, field), upserted so re-running enrichment on the
  // same field refreshes rather than duplicates. Skipped when companyId is
  // absent (provenance is company-scoped).
  if (provenanceCompanyId) {
    await writeFieldProvenance({
      supabase,
      companyId: provenanceCompanyId,
      opportunityId,
      clientId: resolvedClientId,
      opportunityUpdates: updates.opportunity,
      clientUpdates: updates.client,
      facts,
      actorUserId: actorUserId ?? null,
    });
  }

  return updates;
}

/**
 * Emit field-level provenance for a set of writes. One row per (company, entity,
 * field), upserted on the unique key so re-running refreshes rather than
 * duplicates. Used both by the canonical enrichment choke point (for
 * reuse/link/thread-inherit branches) and by the create-new path (so freshly
 * inserted leads also get provenance). A failed write is surfaced to the caller
 * so ingestion cannot report success while the audit trail was rejected.
 */
export async function writeFieldProvenance(params: {
  supabase: { from: (table: string) => unknown };
  companyId: string;
  opportunityId: string | null;
  clientId: string | null;
  opportunityUpdates: Record<string, unknown>;
  clientUpdates: Record<string, unknown>;
  facts: LeadEnrichmentFacts;
  actorUserId?: string | null;
}): Promise<void> {
  const source = provenanceSourceForFacts(params.facts, params.actorUserId);
  const confidence = provenanceConfidenceForFacts(params.facts, source);
  const rows = buildProvenanceRows({
    companyId: params.companyId,
    opportunityId: params.opportunityId,
    clientId: params.clientId,
    opportunityUpdates: params.opportunityUpdates,
    clientUpdates: params.clientUpdates,
    facts: params.facts,
    source,
    confidence,
    actorUserId: params.actorUserId ?? null,
    now: new Date().toISOString(),
  });

  if (rows.length === 0) return;

  const { error } = await (
    params.supabase.from("lead_field_provenance") as {
      upsert: (
        payload: Record<string, unknown>[],
        options: { onConflict: string }
      ) => Promise<{ error?: unknown }>;
    }
  ).upsert(rows as unknown as Record<string, unknown>[], {
    onConflict: "company_id,entity_type,entity_id,field_name",
  });
  if (error) {
    throw databaseFailure("lead_field_provenance upsert", error);
  }
}
