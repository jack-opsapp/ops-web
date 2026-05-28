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
}

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
  "No field-level provenance table or JSON column exists for canonical client/opportunity facts.",
  "No source platform column exists for HomeStars/Wix/website form provider names.",
  "No provider message id column exists on opportunities; activities carry email_message_id and opportunities.source_email_id can only hold the provider thread id.",
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

function validEstimatedValue(value: number | null | undefined): number | null {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number);
}

export function getLeadEnrichmentSchemaGaps(): string[] {
  return [...SCHEMA_GAPS];
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
    return {
      contactName: recipient?.name ?? null,
      companyName: null,
      contactEmail: recipient?.email ?? null,
      contactPhone: null,
      address: null,
      estimatedValue: null,
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

  return {
    contactName: customerName,
    companyName: null,
    contactEmail: customerEmail,
    contactPhone: null,
    address: null,
    estimatedValue: null,
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

  return updates;
}
