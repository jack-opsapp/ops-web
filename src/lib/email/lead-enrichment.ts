import { matchPlatform } from "@/lib/api/services/known-platforms";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type {
  EmailConnection,
  SyncProfile,
} from "@/lib/types/email-connection";
import {
  extractEmailAddress,
  type ContactFormSubmissionIdentity,
} from "@/lib/utils/email-parsing";
import {
  extractAddressFromBody,
  extractEstimatedValueFromBody,
  extractPhoneFromBody,
} from "@/lib/utils/body-fact-extractors";

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
    | "historical_metadata";
}

export interface ExistingOpportunityForEnrichment {
  client_id?: string | null;
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
  extractionSource: "import_payload" | "historical_metadata";
  sourcePlatform?: string | null;
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
  const email = extractEmailAddress(value).toLowerCase().trim();
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
  const explicit = cleanText(explicitName);
  if (explicit && !EMAIL_RE.test(explicit)) return explicit;

  const match = mailbox?.match(/^\s*"?([^"<]+?)"?\s*<[^>]+@[^>]+>/);
  const candidate = cleanText(match?.[1] ?? null);
  if (!candidate || EMAIL_RE.test(candidate)) return null;
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
      name: displayNameFromMailbox(mailbox) ?? localPartToName(candidateEmail),
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

function isBlankJson(value: Record<string, unknown> | null | undefined): boolean {
  if (value == null) return true;
  return Object.keys(value).length === 0;
}

function validEstimatedValue(value: number | null | undefined): number | null {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number);
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
  address: "address",
  estimated_value: "estimated_value",
  detected_value: "detected_value",
  description: "description",
};

const CLIENT_PROVENANCE_FIELDS: Record<string, string> = {
  name: "name",
  email: "email",
  phone_number: "phone_number",
  address: "address",
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
      estimatedValue: extractEstimatedValueFromBody(outboundBody),
      description: null,
      source: "email",
      sourcePlatform: null,
      providerThreadId: cleanText(email.threadId),
      providerMessageId: cleanText(email.id),
      extractionSource: "outbound_recipient",
    };
  }

  const customerEmail = safeCustomerEmail(senderEmail, connection, profile);
  const customerName = customerEmail
    ? displayNameFromMailbox(email.from, email.fromName) ??
      localPartToName(customerEmail)
    : null;

  // Conservative body-text scan for non-identity facts. These never set
  // identity (name/email); they only fill address/value/phone holes. The body
  // is the message content, not the header sender — from_email is never used.
  const inboundBody = email.bodyTextClean || email.bodyText || email.snippet;

  return {
    contactName: customerName,
    companyName: null,
    contactEmail: customerEmail,
    contactPhone: extractPhoneFromBody(inboundBody),
    address: extractAddressFromBody(inboundBody),
    estimatedValue: extractEstimatedValueFromBody(inboundBody),
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
  };
}

export function buildLeadEnrichmentUpdates(input: {
  existingOpportunity?: ExistingOpportunityForEnrichment | null;
  existingClient?: ExistingClientForEnrichment | null;
  facts: LeadEnrichmentFacts;
}): LeadEnrichmentUpdateDecision {
  const { existingOpportunity, existingClient, facts } = input;
  const opportunity: Record<string, unknown> = {};
  const client: Record<string, unknown> = {};

  if (existingOpportunity) {
    if (facts.contactName && isWeakName(existingOpportunity.contact_name)) {
      opportunity.contact_name = facts.contactName;
    }
    if (facts.contactEmail && isWeakEmail(existingOpportunity.contact_email)) {
      opportunity.contact_email = facts.contactEmail;
    }
    if (facts.contactPhone && isWeakText(existingOpportunity.contact_phone)) {
      opportunity.contact_phone = facts.contactPhone;
    }
    if (facts.address && isWeakText(existingOpportunity.address)) {
      opportunity.address = facts.address;
    }
    if (
      facts.estimatedValue != null &&
      isWeakNumber(existingOpportunity.estimated_value)
    ) {
      opportunity.estimated_value = facts.estimatedValue;
    }
    if (
      facts.estimatedValue != null &&
      isWeakNumber(existingOpportunity.detected_value)
    ) {
      opportunity.detected_value = facts.estimatedValue;
    }
    if (facts.description && isWeakText(existingOpportunity.description)) {
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
    if (clientName && isWeakName(existingClient.name)) {
      client.name = clientName;
    }
    if (facts.contactEmail && isWeakEmail(existingClient.email)) {
      client.email = facts.contactEmail;
    }
    if (facts.contactPhone && isWeakText(existingClient.phone_number)) {
      client.phone_number = facts.contactPhone;
    }
    if (facts.address && isWeakText(existingClient.address)) {
      client.address = facts.address;
    }
  }

  return { opportunity, client };
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

  const opportunityQuery = (
    supabase.from("opportunities") as {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{
            data: (ExistingOpportunityForEnrichment & { client_id?: string | null }) | null;
            error?: unknown;
          }>;
        };
      };
    }
  )
    .select(
      [
        "client_id",
        "contact_name",
        "contact_email",
        "contact_phone",
        "address",
        "estimated_value",
        "detected_value",
        "description",
        "source",
        "source_email_id",
        "source_message_id",
        "source_metadata",
      ].join(", ")
    )
    .eq("id", opportunityId);

  const { data: opportunityRow } = await opportunityQuery.maybeSingle();
  const resolvedClientId = clientId ?? opportunityRow?.client_id ?? null;

  let clientRow: ExistingClientForEnrichment | null = null;
  if (resolvedClientId) {
    const clientQuery = (
      supabase.from("clients") as {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{
              data: ExistingClientForEnrichment | null;
              error?: unknown;
            }>;
          };
        };
      }
    )
      .select("name, email, phone_number, address")
      .eq("id", resolvedClientId);
    const { data } = await clientQuery.maybeSingle();
    clientRow = data ?? null;
  }

  const updates = buildLeadEnrichmentUpdates({
    existingOpportunity: opportunityRow,
    existingClient: clientRow,
    facts,
  });

  if (Object.keys(updates.opportunity).length > 0) {
    await (
      supabase.from("opportunities") as {
        update: (payload: Record<string, unknown>) => {
          eq: (column: string, value: string) => Promise<unknown>;
        };
      }
    )
      .update(updates.opportunity)
      .eq("id", opportunityId);
  }

  if (resolvedClientId && Object.keys(updates.client).length > 0) {
    await (
      supabase.from("clients") as {
        update: (payload: Record<string, unknown>) => {
          eq: (column: string, value: string) => Promise<unknown>;
        };
      }
    )
      .update(updates.client)
      .eq("id", resolvedClientId);
  }

  // Record field-level provenance for every field this enrichment filled. One
  // row per (company, entity, field), upserted so re-running enrichment on the
  // same field refreshes rather than duplicates. Skipped when companyId is
  // absent (provenance is company-scoped).
  if (companyId) {
    const source = provenanceSourceForFacts(facts, actorUserId);
    const confidence = provenanceConfidenceForSource(source);
    const rows = buildProvenanceRows({
      companyId,
      opportunityId,
      clientId: resolvedClientId,
      opportunityUpdates: updates.opportunity,
      clientUpdates: updates.client,
      facts,
      source,
      confidence,
      actorUserId: actorUserId ?? null,
      now: new Date().toISOString(),
    });

    if (rows.length > 0) {
      await (
        supabase.from("lead_field_provenance") as {
          upsert: (
            payload: Record<string, unknown>[],
            options: { onConflict: string }
          ) => Promise<unknown>;
        }
      ).upsert(rows as unknown as Record<string, unknown>[], {
        onConflict: "company_id,entity_type,entity_id,field_name",
      });
    }
  }

  return updates;
}
