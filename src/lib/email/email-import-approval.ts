import { createHash } from "node:crypto";

import type {
  AnalysisResult,
  AnalyzedEmailMessage,
  AnalyzedLead,
  ImportPayload,
} from "@/lib/types/email-import";

const IMPORT_STAGES = new Set([
  "new_lead",
  "qualifying",
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
  "won",
  "lost",
  "discarded",
]);

const IMPORT_ACTIONS = new Set([
  "create_new",
  "link",
  "create_subclient",
  "merge",
  "discard",
  "discard_existing",
]);

type SourceResult = NonNullable<AnalysisResult["result"]>;
type ImportLead = ImportPayload["leads"][number];

export class EmailImportApprovalError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_request"
      | "identity_mismatch"
      | "source_inconsistent"
      | "unknown_lead"
      | "duplicate_lead"
      | "unapproved_profile"
  ) {
    super(message);
    this.name = "EmailImportApprovalError";
  }
}

function invalid(
  message: string,
  code: EmailImportApprovalError["code"] = "invalid_request"
): never {
  throw new EmailImportApprovalError(message, code);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Import approval is invalid");
  }
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  field: string,
  maxLength: number,
  allowEmpty = false
): string {
  if (typeof value !== "string") invalid(`${field} is invalid`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((!normalized && !allowEmpty) || normalized.length > maxLength) {
    invalid(`${field} is invalid`);
  }
  return normalized;
}

function nullableText(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value == null || value === "") return null;
  return boundedText(value, field, maxLength);
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(`Reanalyze the mailbox: ${field} is missing`, "source_inconsistent");
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    invalid(`Reanalyze the mailbox: ${field} is invalid`, "source_inconsistent");
  }
  return new Date(timestamp).toISOString();
}

function normalizeEmail(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(`${field} is invalid`);
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    invalid(`${field} is invalid`);
  }
  return normalized;
}

function canonicalMessage(
  value: unknown,
  index: number
): AnalyzedEmailMessage {
  const message = record(value);
  const direction = message.direction;
  if (direction !== "inbound" && direction !== "outbound") {
    invalid(
      `Reanalyze the mailbox: message ${index + 1} has no direction`,
      "source_inconsistent"
    );
  }
  return {
    id: boundedText(message.id, `message ${index + 1} ID`, 512),
    providerThreadId: boundedText(
      message.providerThreadId,
      `message ${index + 1} thread`,
      512
    ),
    from: boundedText(message.from, `message ${index + 1} sender`, 1_000),
    subject: boundedText(
      message.subject ?? "",
      `message ${index + 1} subject`,
      2_000,
      true
    ),
    date: canonicalTimestamp(message.date, `message ${index + 1} date`),
    direction,
  };
}

function comparableMessages(messages: readonly AnalyzedEmailMessage[]) {
  return [...messages]
    .map((message) => ({
      id: message.id,
      providerThreadId: message.providerThreadId,
      from: message.from,
      subject: message.subject,
      date: canonicalTimestamp(message.date, "message date"),
      direction: message.direction,
    }))
    .sort((left, right) =>
      `${left.providerThreadId}\u0000${left.id}`.localeCompare(
        `${right.providerThreadId}\u0000${right.id}`
      )
    );
}

function requireExactIdentity(
  submitted: Record<string, unknown>,
  source: AnalyzedLead,
  sourceMessages: AnalyzedEmailMessage[],
  providerThreadId: string
) {
  if (submitted.threadId !== source.threadId) {
    invalid("Lead thread does not match the approved scan", "identity_mismatch");
  }
  const submittedProviderThread =
    typeof submitted.providerThreadId === "string" &&
    submitted.providerThreadId.trim()
      ? submitted.providerThreadId.trim()
      : source.threadId;
  if (submittedProviderThread !== providerThreadId) {
    invalid(
      "Lead provider thread does not match the approved scan",
      "identity_mismatch"
    );
  }
  if (!Array.isArray(submitted.emails)) {
    invalid("Lead email history does not match the approved scan", "identity_mismatch");
  }
  const submittedMessages = submitted.emails.map(canonicalMessage);
  if (
    stableStringify(comparableMessages(submittedMessages)) !==
    stableStringify(comparableMessages(sourceMessages))
  ) {
    invalid("Lead email history does not match the approved scan", "identity_mismatch");
  }
  if (
    normalizeEmail(submitted.clientEmail, "Customer email") !==
    normalizeEmail(source.client.email, "Approved customer email")
  ) {
    invalid("Lead customer does not match the approved scan", "identity_mismatch");
  }
}

function sourceAction(source: AnalyzedLead): ImportLead["action"] {
  const action = source.matchResult?.action;
  if (action === "review") {
    return source.matchResult.existingClientId ? "link" : "create_new";
  }
  if (!IMPORT_ACTIONS.has(action)) {
    invalid("Reanalyze the mailbox: lead action is invalid", "source_inconsistent");
  }
  return action as ImportLead["action"];
}

function selectedReviewActionMatches(
  submittedAction: unknown,
  source: AnalyzedLead,
  canonicalAction: ImportLead["action"]
): boolean {
  return (
    submittedAction === canonicalAction ||
    (source.matchResult.action === "review" && submittedAction === "review")
  );
}

function canonicalSubContacts(source: AnalyzedLead): ImportLead["subContacts"] {
  if (!Array.isArray(source.subContacts)) {
    invalid("Reanalyze the mailbox: lead contacts are invalid", "source_inconsistent");
  }
  const seen = new Set<string>();
  return source.subContacts.map((contact, index) => {
    const email = normalizeEmail(contact.email, `Contact ${index + 1} email`);
    if (seen.has(email)) {
      invalid("Reanalyze the mailbox: duplicate lead contact", "source_inconsistent");
    }
    seen.add(email);
    return {
      name: boundedText(contact.name, `Contact ${index + 1} name`, 200),
      email,
      phone: nullableText(contact.phone, `Contact ${index + 1} phone`, 100),
    };
  });
}

function canonicalLead(
  submittedValue: unknown,
  source: AnalyzedLead
): ImportLead {
  const submitted = record(submittedValue);
  const sourceMessages = Array.isArray(source.emails)
    ? source.emails.map(canonicalMessage)
    : invalid(
        "Reanalyze the mailbox: lead email history is invalid",
        "source_inconsistent"
      );
  const messageIds = new Set(sourceMessages.map((message) => message.id));
  if (messageIds.size !== sourceMessages.length) {
    invalid(
      "Reanalyze the mailbox: duplicate provider message",
      "source_inconsistent"
    );
  }

  const providerThreadId = boundedText(
    source.providerThreadId ?? sourceMessages[0]?.providerThreadId ?? source.threadId,
    "Approved provider thread",
    512
  );
  const isMessageScoped = source.threadId !== providerThreadId;
  if (
    sourceMessages.length === 0 &&
    (!isMessageScoped ||
      !source.threadId.startsWith("contact-form-message:") ||
      source.correspondenceCount !== 1)
  ) {
    invalid(
      "Reanalyze the mailbox: exact email history is unavailable",
      "source_inconsistent"
    );
  }
  if (
    sourceMessages.length > 0 &&
    source.correspondenceCount !== sourceMessages.length
  ) {
    invalid(
      "Reanalyze the mailbox: email history counts changed",
      "source_inconsistent"
    );
  }

  const outboundCount = sourceMessages.filter(
    (message) => message.direction === "outbound"
  ).length;
  if (
    sourceMessages.length > 0 &&
    source.outboundCount !== outboundCount
  ) {
    invalid(
      "Reanalyze the mailbox: email direction counts changed",
      "source_inconsistent"
    );
  }

  const chronological = [...sourceMessages].sort(
    (left, right) => Date.parse(left.date) - Date.parse(right.date)
  );
  const sourceLastMessage = canonicalTimestamp(
    source.lastMessageDate,
    "last message date"
  );
  const exactLastMessage = chronological.at(-1)?.date ?? sourceLastMessage;
  if (sourceMessages.length > 0 && sourceLastMessage !== exactLastMessage) {
    invalid(
      "Reanalyze the mailbox: last message date changed",
      "source_inconsistent"
    );
  }
  const lastInboundAt =
    [...chronological]
      .reverse()
      .find((message) => message.direction === "inbound")?.date ??
    (sourceMessages.length === 0 && source.outboundCount === 0
      ? sourceLastMessage
      : null);
  const lastOutboundAt =
    [...chronological]
      .reverse()
      .find((message) => message.direction === "outbound")?.date ??
    (sourceMessages.length === 0 && source.outboundCount === 1
      ? sourceLastMessage
      : null);
  const lastMessageDirection =
    chronological.at(-1)?.direction ??
    (source.outboundCount === 1 ? "outbound" : "inbound");

  requireExactIdentity(submitted, source, sourceMessages, providerThreadId);

  const stage = boundedText(submitted.stage, "Lead stage", 50);
  if (!IMPORT_STAGES.has(stage)) invalid("Lead stage is invalid");
  const action = sourceAction(source);
  if (!selectedReviewActionMatches(submitted.action, source, action)) {
    invalid("Lead action does not match the approved scan", "identity_mismatch");
  }

  const existingClientId = source.matchResult.existingClientId ?? null;
  if ((submitted.existingClientId ?? null) !== existingClientId) {
    invalid("Selected client does not match the approved scan", "identity_mismatch");
  }

  const estimatedValue =
    source.estimatedValue == null ? null : Number(source.estimatedValue);
  if (
    estimatedValue != null &&
    (!Number.isFinite(estimatedValue) || estimatedValue < 0)
  ) {
    invalid("Reanalyze the mailbox: estimated value is invalid", "source_inconsistent");
  }

  const mergeMode =
    source.mergeMode === "overwrite" ? "overwrite" : "fill_blanks";
  const mergeWithLeadId = source.duplicateGroupId?.trim() || null;
  const title = nullableText(submitted.title, "Lead title", 200);
  const terminal = stage === "won" || stage === "lost" || stage === "discarded";

  return {
    id: boundedText(source.id, "Approved lead ID", 512),
    threadId: boundedText(source.threadId, "Approved lead thread", 512),
    providerThreadId,
    emails: sourceMessages,
    clientName: boundedText(submitted.clientName, "Customer name", 200),
    clientEmail: normalizeEmail(source.client.email, "Approved customer email"),
    clientPhone: nullableText(source.client.phone, "Approved customer phone", 100),
    clientAddress: nullableText(
      source.client.address,
      "Approved customer address",
      1_000
    ),
    description: boundedText(
      source.client.description ?? "",
      "Approved lead description",
      20_000,
      true
    ),
    stage,
    estimatedValue,
    correspondenceCount: source.correspondenceCount,
    outboundCount: source.outboundCount,
    lastMessageDate: exactLastMessage,
    lastInboundAt,
    lastOutboundAt,
    lastMessageDirection,
    existingClientId,
    action,
    mergeMode,
    mergeWithLeadId,
    subContacts: canonicalSubContacts(source),
    title,
    actualCloseDate: terminal ? exactLastMessage : null,
  };
}

function uniqueCanonicalStrings(values: unknown, field: string): string[] {
  if (!Array.isArray(values)) {
    invalid(`Reanalyze the mailbox: ${field} is invalid`, "source_inconsistent");
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = boundedText(value, field, 1_000).toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function approvedPatternSubset(
  submitted: unknown,
  allowed: readonly string[],
  field: string
): string[] {
  if (!Array.isArray(submitted)) invalid(`Import sync profile is invalid`, "unapproved_profile");
  const allowedByKey = new Map(
    allowed.map((value) => [value.trim().toLowerCase(), value.trim()])
  );
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const raw of submitted) {
    if (typeof raw !== "string") {
      invalid(`Import sync profile ${field} is invalid`, "unapproved_profile");
    }
    const key = raw.trim().toLowerCase();
    const canonical = allowedByKey.get(key);
    if (!canonical) {
      invalid(`Import sync profile ${field} was not approved`, "unapproved_profile");
    }
    if (!seen.has(key)) {
      seen.add(key);
      selected.push(canonical);
    }
  }
  return selected;
}

function canonicalSyncProfile(
  submitted: ImportPayload["syncProfile"],
  source: SourceResult,
  connectionEmail?: string
): ImportPayload["syncProfile"] {
  const detected = Array.isArray(source.detectedSources)
    ? source.detectedSources
    : invalid(
        "Reanalyze the mailbox: detected sources are invalid",
        "source_inconsistent"
      );
  const estimatePatterns = Array.from(
    new Set(
      [
        source.estimatePattern,
        ...detected
          .filter((item) => item.type === "estimate_pattern")
          .map((item) => item.pattern),
      ].filter((value): value is string => Boolean(value?.trim()))
    )
  );
  const platformPatterns = detected
    .filter((item) => item.type === "platform")
    .map((item) => item.pattern)
    .filter(Boolean);

  return {
    estimateSubjectPatterns: approvedPatternSubset(
      submitted.estimateSubjectPatterns,
      estimatePatterns,
      "estimate patterns"
    ),
    companyDomains: uniqueCanonicalStrings(source.companyDomains, "company domains"),
    teamForwarders: uniqueCanonicalStrings(source.teamForwarders, "team forwarders"),
    knownPlatformSenders: approvedPatternSubset(
      submitted.knownPlatformSenders,
      platformPatterns,
      "platform senders"
    ),
    formSubjectPatterns: approvedPatternSubset(
      submitted.formSubjectPatterns,
      estimatePatterns,
      "form subject patterns"
    ),
    userEmailAddresses: uniqueCanonicalStrings(
      [connectionEmail, ...source.teamForwarders].filter(
        (value): value is string => Boolean(value)
      ),
      "user email addresses"
    ),
    aiClassificationThreshold: 0.7,
  };
}

export function approveEmailImportPayload({
  submitted,
  sourceResult,
  expectedCompanyId,
  expectedConnectionId,
  expectedConnectionEmail,
}: {
  submitted: unknown;
  sourceResult: unknown;
  expectedCompanyId: string;
  expectedConnectionId: string;
  expectedConnectionEmail?: string;
}): ImportPayload {
  const payload = record(submitted);
  if (payload.companyId !== expectedCompanyId) {
    invalid("Import company does not match the approved scan", "identity_mismatch");
  }
  if (payload.connectionId !== expectedConnectionId) {
    invalid("Import mailbox does not match the approved scan", "identity_mismatch");
  }
  if (!Array.isArray(payload.leads) || payload.leads.length === 0) {
    invalid("Select at least one lead to import");
  }
  if (payload.leads.length > 1_000) invalid("Import contains too many leads");

  const source = record(sourceResult) as unknown as SourceResult;
  if (!Array.isArray(source.leads)) {
    invalid("Reanalyze the mailbox: approved leads are unavailable", "source_inconsistent");
  }
  const sourceById = new Map<string, AnalyzedLead>();
  for (const lead of source.leads) {
    if (!lead?.id || sourceById.has(lead.id)) {
      invalid("Reanalyze the mailbox: approved lead IDs are invalid", "source_inconsistent");
    }
    sourceById.set(lead.id, lead);
  }

  const selectedIds = new Set<string>();
  const leads = payload.leads.map((submittedLead) => {
    const submittedRow = record(submittedLead);
    const id = boundedText(submittedRow.id, "Lead ID", 512);
    if (selectedIds.has(id)) invalid("Import contains a duplicate lead", "duplicate_lead");
    selectedIds.add(id);
    const approvedSource = sourceById.get(id);
    if (!approvedSource) {
      invalid("Lead is not in the approved scan", "unknown_lead");
    }
    return canonicalLead(submittedRow, approvedSource);
  });

  const syncProfile = record(payload.syncProfile) as unknown as ImportPayload["syncProfile"];
  return {
    companyId: expectedCompanyId,
    connectionId: expectedConnectionId,
    leads,
    syncProfile: canonicalSyncProfile(
      syncProfile,
      source,
      expectedConnectionEmail
    ),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function fingerprintEmailImportPayload(payload: ImportPayload): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}
