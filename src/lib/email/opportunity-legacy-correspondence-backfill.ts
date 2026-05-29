import {
  classifyOpportunityCorrespondence,
  type OpportunityCorrespondenceDirection,
  type OpportunityCorrespondenceNoiseReason,
  type OpportunityCorrespondencePartyRole,
} from "@/lib/email/opportunity-correspondence-classifier";
import { matchPlatform } from "@/lib/api/services/known-platforms";
import {
  extractContactFormSubmission,
  extractEmailAddress,
} from "@/lib/utils/email-parsing";

export interface LegacyBackfillOpportunityRow {
  id: string;
  company_id: string;
  title: string | null;
  stage: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  project_id: string | null;
  project_ref: string | null;
  created_at: string | null;
  stage_entered_at: string | null;
  contact_email: string | null;
  contact_name: string | null;
  source?: string | null;
}

export interface LegacyBackfillActivityRow {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  type: string;
  email_thread_id: string | null;
  email_message_id: string | null;
  subject: string | null;
  content: string | null;
  body_text: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  direction: string | null;
  created_at: string | null;
  outcome?: string | null;
}

export interface LegacyBackfillEmailThreadRow {
  company_id: string;
  opportunity_id: string | null;
  connection_id: string | null;
  provider_thread_id: string;
  labels: string[] | null;
  primary_category: string | null;
  subject?: string | null;
  participants?: string[] | null;
  first_message_at?: string | null;
  last_message_at?: string | null;
  message_count?: number | null;
  latest_direction?: string | null;
  latest_sender_email?: string | null;
  latest_sender_name?: string | null;
  latest_snippet?: string | null;
}

export interface LegacyBackfillOpportunityThreadLinkRow {
  opportunity_id: string;
  thread_id: string;
  connection_id: string | null;
}

export interface LegacyBackfillEmailConnectionRow {
  id: string;
  company_id: string;
  email: string | null;
  sync_filters: Record<string, unknown> | null;
}

export interface LegacyBackfillExistingEventRow {
  id: string;
  company_id: string;
  opportunity_id: string;
  activity_id: string | null;
  connection_id: string | null;
  provider_thread_id: string | null;
  provider_message_id: string | null;
  direction: OpportunityCorrespondenceDirection;
  party_role: string | null;
  is_meaningful: boolean;
  noise_reason: string | null;
  occurred_at: string;
  linked_contact_kind: string | null;
  linked_contact_id: string | null;
  source: string;
  subject: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
}

export type LegacyBackfillConfidence = "high" | "medium";

export interface LegacyBackfillPlannedEventRow
  extends LegacyBackfillExistingEventRow {
  id: string;
  source_key: string;
  source_boundary: string;
  confidence: LegacyBackfillConfidence;
  reason: string;
  projected_event_id: string;
}

export interface LegacyBackfillLifecycleStateRow {
  opportunity_id: string;
  company_id: string;
  last_meaningful_event_id: string;
  last_meaningful_at: string;
  last_meaningful_direction: OpportunityCorrespondenceDirection;
  unanswered_follow_up_count: 0;
  second_follow_up_sent_at: null;
  operator_follow_up_miss_at: null;
  stale_status: null;
  stale_status_at: null;
  updated_at: string;
  source_boundary: string;
  reason: string;
}

export type LegacyBackfillSkipReason =
  | "missing_opportunity"
  | "missing_created_at"
  | "missing_provider_id"
  | "duplicate_activity_id"
  | "duplicate_planned_provider_message_id"
  | "duplicate_existing_provider_message_id"
  | "duplicate_planned_provider_thread_id"
  | "duplicate_existing_provider_thread_id"
  | "duplicate_existing_activity_id"
  | "relationship_mismatch"
  | "provider_noise"
  | "internal_system"
  | "bounce"
  | "marketing_noise"
  | "ambiguous_legacy_evidence";

export interface LegacyBackfillSkippedEvidence {
  sourceId: string;
  opportunityId: string | null;
  sourceBoundary: string;
  reason: LegacyBackfillSkipReason;
  detail: string;
}

export interface LegacyBackfillPlanInput {
  opportunities: LegacyBackfillOpportunityRow[];
  activities: LegacyBackfillActivityRow[];
  threads: LegacyBackfillEmailThreadRow[];
  opportunityThreadLinks: LegacyBackfillOpportunityThreadLinkRow[];
  connections: LegacyBackfillEmailConnectionRow[];
  existingEvents: LegacyBackfillExistingEventRow[];
  now: Date;
}

export interface LegacyBackfillPlan {
  plannedEvents: LegacyBackfillPlannedEventRow[];
  lifecycleStateRows: LegacyBackfillLifecycleStateRow[];
  skippedEvidence: LegacyBackfillSkippedEvidence[];
  opportunityMutationCount: 0;
}

const ZERO_CONNECTION_ID = "00000000-0000-0000-0000-000000000000";
const RFQ_RE = /\b(?:rfq|request for quote|quote request|estimate request)\b/i;
const FORM_RE = /\b(?:form inquiry|website form|web form|contact form|wix|submitted|submission)\b/i;
const FOLLOW_UP_RE = /\b(?:quote|estimate|proposal|follow(?: |-)?up|following up)\b/i;
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

function normalizedText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizedEmail(value: string | null | undefined): string | null {
  const email = extractEmailAddress(value ?? "").toLowerCase().trim();
  return email.includes("@") ? email : null;
}

function textIncludesEmail(values: Array<string | null | undefined>, email: string): boolean {
  return values.some((value) => normalizedEmail(value) === email);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function emailDomain(email: string | null): string {
  return email?.split("@")[1]?.toLowerCase().trim() ?? "";
}

function emailLocalPart(email: string | null): string {
  return email?.split("@")[0]?.toLowerCase().trim() ?? "";
}

function isInternalOrSystemParticipant(
  email: string,
  connection: LegacyBackfillEmailConnectionRow | undefined
): boolean {
  if (SYSTEM_LOCAL_PARTS.has(emailLocalPart(email))) return true;
  if (matchPlatform(email)) return true;
  const connectionEmail = normalizedEmail(connection?.email);
  if (connectionEmail && connectionEmail === email) return true;
  const filters = connection?.sync_filters ?? {};
  const userEmails = stringList(filters.userEmailAddresses).map((value) =>
    normalizedEmail(value)
  );
  if (userEmails.includes(email)) return true;
  const companyDomains = new Set(
    stringList(filters.companyDomains).map((value) => value.trim().toLowerCase())
  );
  const domain = emailDomain(email);
  return Boolean(domain && companyDomains.has(domain));
}

function firstExternalParticipantEmail(
  thread: LegacyBackfillEmailThreadRow,
  connection: LegacyBackfillEmailConnectionRow | undefined
): string | null {
  for (const participant of stringList(thread.participants)) {
    const email = normalizedEmail(participant);
    if (!email) continue;
    if (isInternalOrSystemParticipant(email, connection)) continue;
    return email;
  }
  return null;
}

function directionOf(value: string | null | undefined): OpportunityCorrespondenceDirection | null {
  if (value === "inbound" || value === "outbound") return value;
  return null;
}

function threadEvidenceOccurredAt(
  thread: LegacyBackfillEmailThreadRow
): string | null {
  return (
    normalizedText(thread.last_message_at) ??
    normalizedText(thread.first_message_at)
  );
}

function sourceKeyForActivity(activity: LegacyBackfillActivityRow): string {
  return `activity:${activity.id}`;
}

function sourceKeyForThreadLink(
  link: LegacyBackfillOpportunityThreadLinkRow
): string {
  return `thread:${link.opportunity_id}:${link.connection_id ?? ZERO_CONNECTION_ID}:${link.thread_id}`;
}

function sourceKeyForOpportunity(opportunity: LegacyBackfillOpportunityRow): string {
  return `opportunity:${opportunity.id}:legacy_form_or_rfq`;
}

function syntheticProviderThreadIdForActivity(activity: LegacyBackfillActivityRow): string {
  return `legacy-activity:${activity.id}`;
}

function syntheticProviderThreadIdForOpportunity(
  opportunity: LegacyBackfillOpportunityRow
): string {
  return `legacy-opportunity:${opportunity.id}`;
}

function providerMessageKey(
  companyId: string,
  connectionId: string | null | undefined,
  providerMessageId: string | null | undefined
): string | null {
  const messageId = normalizedText(providerMessageId);
  if (!messageId) return null;
  return `${companyId}:${connectionId ?? ZERO_CONNECTION_ID}:${messageId}`;
}

function providerThreadKey(
  companyId: string,
  opportunityId: string,
  connectionId: string | null | undefined,
  providerThreadId: string | null | undefined
): string | null {
  const threadId = normalizedText(providerThreadId);
  if (!threadId) return null;
  return `${companyId}:${opportunityId}:${connectionId ?? ZERO_CONNECTION_ID}:${threadId}`;
}

function threadMapKey(companyId: string, providerThreadId: string): string {
  return `${companyId}:${providerThreadId}`;
}

function linkMapKey(connectionId: string | null | undefined, threadId: string): string {
  return `${connectionId ?? ZERO_CONNECTION_ID}:${threadId}`;
}

function sourceBoundaryForProviderEvidence(
  connectionId: string | null | undefined,
  providerMessageId: string | null | undefined
): string {
  return normalizedText(connectionId) && normalizedText(providerMessageId)
    ? "provider_message_id"
    : "provider_thread_id";
}

function bodyFor(activity: LegacyBackfillActivityRow): string {
  return normalizedText(activity.body_text) ?? normalizedText(activity.content) ?? "";
}

function combinedText(
  activityOrOpportunity: LegacyBackfillActivityRow | LegacyBackfillOpportunityRow
): string {
  if ("type" in activityOrOpportunity) {
    return [
      activityOrOpportunity.subject,
      activityOrOpportunity.content,
      activityOrOpportunity.body_text,
      activityOrOpportunity.outcome,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    activityOrOpportunity.title,
    activityOrOpportunity.source,
    activityOrOpportunity.contact_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function parsedSubmitterEmail(activity: LegacyBackfillActivityRow): string | null {
  return normalizedEmail(
    extractContactFormSubmission(activity.subject ?? "", bodyFor(activity))?.email
  );
}

function addSkip(
  skippedEvidence: LegacyBackfillSkippedEvidence[],
  sourceId: string,
  opportunityId: string | null,
  sourceBoundary: string,
  reason: LegacyBackfillSkipReason,
  detail: string
) {
  skippedEvidence.push({
    sourceId,
    opportunityId,
    sourceBoundary,
    reason,
    detail,
  });
}

function relationshipMismatch(
  activity: LegacyBackfillActivityRow,
  thread: LegacyBackfillEmailThreadRow | undefined,
  links: LegacyBackfillOpportunityThreadLinkRow[]
): boolean {
  const opportunityId = normalizedText(activity.opportunity_id);
  if (!opportunityId) return true;
  if (thread?.opportunity_id && thread.opportunity_id !== opportunityId) return true;
  const providerThreadId = normalizedText(activity.email_thread_id);
  if (!providerThreadId) return false;
  const linkedRows = links.filter((link) => {
    return (
      link.thread_id === providerThreadId &&
      (!thread?.connection_id || link.connection_id === thread.connection_id)
    );
  });
  return linkedRows.some((link) => link.opportunity_id !== opportunityId);
}

function confidenceFor(
  sourceBoundary: string,
  hasProviderThread: boolean
): LegacyBackfillConfidence {
  if (hasProviderThread || sourceBoundary === "legacy_activity_contact_form") {
    return "high";
  }
  return "medium";
}

function plannedEvent(
  input: {
    opportunity: LegacyBackfillOpportunityRow;
    activityId: string | null;
    connectionId: string | null;
    providerThreadId: string;
    providerMessageId: string | null;
    direction: OpportunityCorrespondenceDirection;
    partyRole: OpportunityCorrespondencePartyRole;
    noiseReason: OpportunityCorrespondenceNoiseReason;
    occurredAt: string;
    linkedContactKind: string | null;
    source: string;
    subject: string | null;
    fromEmail: string | null;
    toEmails: string[] | null;
    ccEmails: string[] | null;
    sourceKey: string;
    sourceBoundary: string;
    confidence: LegacyBackfillConfidence;
    reason: string;
  }
): LegacyBackfillPlannedEventRow {
  return {
    id: `projected:${input.sourceKey}`,
    company_id: input.opportunity.company_id,
    opportunity_id: input.opportunity.id,
    activity_id: input.activityId,
    connection_id: input.connectionId,
    provider_thread_id: input.providerThreadId,
    provider_message_id: input.providerMessageId,
    direction: input.direction,
    party_role: input.partyRole,
    is_meaningful: true,
    noise_reason: input.noiseReason,
    occurred_at: input.occurredAt,
    linked_contact_kind: input.linkedContactKind,
    linked_contact_id: null,
    source: input.source,
    subject: input.subject,
    from_email: input.fromEmail,
    to_emails: input.toEmails ?? [],
    cc_emails: input.ccEmails ?? [],
    source_key: input.sourceKey,
    source_boundary: input.sourceBoundary,
    confidence: input.confidence,
    reason: input.reason,
    projected_event_id: `{{event_id:${input.sourceKey}}}`,
  };
}

function plannedEventForNonEmailActivity(
  activity: LegacyBackfillActivityRow,
  opportunity: LegacyBackfillOpportunityRow
): LegacyBackfillPlannedEventRow | null {
  const type = activity.type.trim().toLowerCase();
  const direction = directionOf(activity.direction);
  const occurredAt = normalizedText(activity.created_at);
  if (!occurredAt) return null;

  if (type === "call") {
    const callDirection = direction ?? "inbound";
    return plannedEvent({
      opportunity,
      activityId: activity.id,
      connectionId: null,
      providerThreadId: syntheticProviderThreadIdForActivity(activity),
      providerMessageId: null,
      direction: callDirection,
      partyRole: callDirection === "inbound" ? "customer" : "ops",
      noiseReason: null,
      occurredAt,
      linkedContactKind: callDirection === "inbound" ? "customer" : null,
      source: "legacy_activity_call",
      subject: activity.subject,
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      sourceKey: sourceKeyForActivity(activity),
      sourceBoundary: "activity_id",
      confidence: "medium",
      reason: "Legacy call activity is linked directly to the opportunity.",
    });
  }

  if (type === "site_visit" || type === "meeting") {
    return plannedEvent({
      opportunity,
      activityId: activity.id,
      connectionId: null,
      providerThreadId: syntheticProviderThreadIdForActivity(activity),
      providerMessageId: null,
      direction: "outbound",
      partyRole: "ops",
      noiseReason: null,
      occurredAt,
      linkedContactKind: null,
      source: type === "site_visit" ? "legacy_activity_site_visit" : "legacy_activity_meeting",
      subject: activity.subject,
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      sourceKey: sourceKeyForActivity(activity),
      sourceBoundary: "activity_id",
      confidence: "medium",
      reason: "Legacy site-visit or meeting activity is linked directly to the opportunity.",
    });
  }

  if (type === "note" && RFQ_RE.test(combinedText(activity))) {
    return plannedEvent({
      opportunity,
      activityId: activity.id,
      connectionId: null,
      providerThreadId: syntheticProviderThreadIdForActivity(activity),
      providerMessageId: null,
      direction: "inbound",
      partyRole: "customer",
      noiseReason: null,
      occurredAt,
      linkedContactKind: "customer",
      source: "legacy_activity_rfq",
      subject: activity.subject,
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      sourceKey: sourceKeyForActivity(activity),
      sourceBoundary: "activity_id",
      confidence: "medium",
      reason: "Legacy note contains a deterministic RFQ signal and is linked to the opportunity.",
    });
  }

  return null;
}

function plannedEventForEmailActivity(input: {
  activity: LegacyBackfillActivityRow;
  opportunity: LegacyBackfillOpportunityRow;
  thread: LegacyBackfillEmailThreadRow | undefined;
  connection: LegacyBackfillEmailConnectionRow | undefined;
  duplicateProviderMessageIds: string[];
}): LegacyBackfillPlannedEventRow | null {
  const { activity, opportunity, thread, connection } = input;
  const direction = directionOf(activity.direction);
  const occurredAt = normalizedText(activity.created_at);
  if (!direction || !occurredAt) return null;

  const providerThreadId = normalizedText(activity.email_thread_id);
  const providerMessageId = normalizedText(activity.email_message_id);
  const subject = activity.subject ?? "";
  const bodyText = bodyFor(activity);
  const submitterEmail = parsedSubmitterEmail(activity);
  const connectionFilters = connection?.sync_filters ?? {};

  if (
    providerThreadId &&
    thread &&
    !providerMessageId &&
    directionOf(thread.latest_direction) &&
    threadEvidenceOccurredAt(thread)
  ) {
    return plannedEventForThreadEvidence({
      opportunity,
      thread,
      connection,
      connectionId: thread.connection_id ?? null,
      activityId: activity.id,
      sourceKey: sourceKeyForActivity(activity),
      reason:
        "Provider-backed legacy activity reconciled to linked email thread truth.",
    });
  }

  if (providerThreadId) {
    const classification = classifyOpportunityCorrespondence({
      direction,
      providerThreadId,
      providerMessageId,
      existingProviderMessageIds: input.duplicateProviderMessageIds,
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      subject,
      bodyText,
      labels: thread?.labels,
      threadCategory: thread?.primary_category,
      connectionEmail: connection?.email,
      companyDomains: stringList(connectionFilters.companyDomains),
      userEmailAddresses: stringList(connectionFilters.userEmailAddresses),
      knownPlatformSenders: ["notifications@wix-forms.com"],
      contactEmail: opportunity.contact_email,
      submitterEmail,
    });

    if (!classification.isMeaningful) return null;

    const source =
      submitterEmail && classification.customerEmail === submitterEmail
        ? "legacy_activity_contact_form"
        : "legacy_activity_email";
    return plannedEvent({
      opportunity,
      activityId: activity.id,
      connectionId: thread?.connection_id ?? null,
      providerThreadId,
      providerMessageId,
      direction,
      partyRole: classification.partyRole,
      noiseReason: classification.noiseReason,
      occurredAt,
      linkedContactKind: classification.partyRole === "customer" ? "customer" : null,
      source,
      subject: activity.subject,
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      sourceKey: sourceKeyForActivity(activity),
      sourceBoundary: sourceBoundaryForProviderEvidence(
        thread?.connection_id,
        providerMessageId
      ),
      confidence: confidenceFor(
        sourceBoundaryForProviderEvidence(thread?.connection_id, providerMessageId),
        true
      ),
      reason: "Provider-backed legacy email activity classified as meaningful.",
    });
  }

  if (direction === "inbound" && submitterEmail) {
    return plannedEvent({
      opportunity,
      activityId: activity.id,
      connectionId: null,
      providerThreadId: syntheticProviderThreadIdForActivity(activity),
      providerMessageId: null,
      direction: "inbound",
      partyRole: "customer",
      noiseReason: null,
      occurredAt,
      linkedContactKind: "customer",
      source: "legacy_activity_contact_form",
      subject: activity.subject,
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      sourceKey: sourceKeyForActivity(activity),
      sourceBoundary: "activity_id_without_provider_thread",
      confidence: "high",
      reason:
        "Parsed contact form submitter from a legacy activity with no provider thread id.",
    });
  }

  const fromEmail = normalizedEmail(activity.from_email);
  const contactEmail = normalizedEmail(opportunity.contact_email);
  if (direction === "inbound" && fromEmail && contactEmail && fromEmail === contactEmail) {
    return plannedEvent({
      opportunity,
      activityId: activity.id,
      connectionId: null,
      providerThreadId: syntheticProviderThreadIdForActivity(activity),
      providerMessageId: null,
      direction: "inbound",
      partyRole: "customer",
      noiseReason: null,
      occurredAt,
      linkedContactKind: "customer",
      source: "legacy_activity_customer_reply",
      subject: activity.subject,
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      sourceKey: sourceKeyForActivity(activity),
      sourceBoundary: "activity_id_without_provider_thread",
      confidence: "medium",
      reason:
        "Legacy inbound email came from the opportunity contact email but has no provider thread id.",
    });
  }

  if (
    direction === "outbound" &&
    contactEmail &&
    textIncludesEmail([...(activity.to_emails ?? []), ...(activity.cc_emails ?? [])], contactEmail) &&
    FOLLOW_UP_RE.test(`${subject} ${bodyText}`)
  ) {
    return plannedEvent({
      opportunity,
      activityId: activity.id,
      connectionId: null,
      providerThreadId: syntheticProviderThreadIdForActivity(activity),
      providerMessageId: null,
      direction: "outbound",
      partyRole: "ops",
      noiseReason: null,
      occurredAt,
      linkedContactKind: null,
      source: "legacy_activity_ops_outbound",
      subject: activity.subject,
      fromEmail: activity.from_email,
      toEmails: activity.to_emails,
      ccEmails: activity.cc_emails,
      sourceKey: sourceKeyForActivity(activity),
      sourceBoundary: "activity_id_without_provider_thread",
      confidence: "medium",
      reason:
        "Legacy outbound email targets the opportunity contact and contains quote or follow-up language.",
    });
  }

  return null;
}

function plannedEventForThreadEvidence(input: {
  opportunity: LegacyBackfillOpportunityRow;
  thread: LegacyBackfillEmailThreadRow;
  connection: LegacyBackfillEmailConnectionRow | undefined;
  connectionId: string | null;
  activityId: string | null;
  sourceKey: string;
  reason: string;
}): LegacyBackfillPlannedEventRow | null {
  const { opportunity, thread, connection } = input;
  const direction = directionOf(thread.latest_direction);
  const occurredAt = threadEvidenceOccurredAt(thread);
  if (!direction || !occurredAt) return null;

  const subject = thread.subject ?? "";
  const bodyText = thread.latest_snippet ?? "";
  const externalParticipant = firstExternalParticipantEmail(thread, connection);
  const fromEmail =
    direction === "inbound"
      ? (normalizedEmail(thread.latest_sender_email) ?? externalParticipant)
      : normalizedEmail(thread.latest_sender_email);
  const toEmails =
    direction === "outbound" && externalParticipant ? [externalParticipant] : [];
  const isFormThread = FORM_RE.test(`${subject} ${bodyText}`);
  const parsedSubmissionEmail = normalizedEmail(
    extractContactFormSubmission(subject, bodyText)?.email
  );
  const submitterEmail =
    parsedSubmissionEmail ?? (isFormThread ? externalParticipant : null);

  let classification = classifyOpportunityCorrespondence({
    direction,
    providerThreadId: thread.provider_thread_id,
    providerMessageId: null,
    existingProviderMessageIds: [],
    fromEmail,
    toEmails,
    ccEmails: [],
    subject,
    bodyText,
    labels: thread.labels,
    threadCategory: thread.primary_category,
    connectionEmail: connection?.email,
    companyDomains: stringList(connection?.sync_filters?.companyDomains),
    userEmailAddresses: stringList(connection?.sync_filters?.userEmailAddresses),
    knownPlatformSenders: ["notifications@wix-forms.com"],
    contactEmail: opportunity.contact_email,
    submitterEmail,
  });

  if (
    !classification.isMeaningful &&
    direction === "inbound" &&
    isFormThread &&
    (parsedSubmissionEmail || externalParticipant)
  ) {
    classification = {
      direction: "inbound",
      partyRole: "customer",
      isMeaningful: true,
      noiseReason: null,
      customerEmail: parsedSubmissionEmail ?? externalParticipant,
    };
  }

  if (!classification.isMeaningful) return null;

  return plannedEvent({
    opportunity,
    activityId: input.activityId,
    connectionId: input.connectionId,
    providerThreadId: thread.provider_thread_id,
    providerMessageId: null,
    direction,
    partyRole: classification.partyRole,
    noiseReason: classification.noiseReason,
    occurredAt,
    linkedContactKind: classification.partyRole === "customer" ? "customer" : null,
    source: isFormThread ? "legacy_thread_contact_form" : "legacy_thread_email",
    subject: thread.subject ?? null,
    fromEmail: direction === "inbound" ? classification.customerEmail : fromEmail,
    toEmails,
    ccEmails: [],
    sourceKey: input.sourceKey,
    sourceBoundary: "provider_thread_id",
    confidence: "medium",
    reason: input.reason,
  });
}

function plannedEventForThreadLink(input: {
  link: LegacyBackfillOpportunityThreadLinkRow;
  opportunity: LegacyBackfillOpportunityRow;
  thread: LegacyBackfillEmailThreadRow;
  connection: LegacyBackfillEmailConnectionRow | undefined;
}): LegacyBackfillPlannedEventRow | null {
  const { link, opportunity, thread, connection } = input;
  return plannedEventForThreadEvidence({
    opportunity,
    thread,
    connection,
    connectionId: link.connection_id ?? thread.connection_id ?? null,
    activityId: null,
    sourceKey: sourceKeyForThreadLink(link),
    reason:
      "Linked legacy email thread has deterministic correspondence evidence without an activity row.",
  });
}

function opportunityFallbackEvent(
  opportunity: LegacyBackfillOpportunityRow,
  now: Date
): LegacyBackfillPlannedEventRow | null {
  if (!normalizedText(opportunity.created_at)) return null;
  const text = combinedText(opportunity);
  const hasSignal = FORM_RE.test(text) || RFQ_RE.test(text);
  if (!hasSignal || !normalizedEmail(opportunity.contact_email)) return null;
  const source = RFQ_RE.test(text)
    ? "legacy_opportunity_rfq"
    : "legacy_opportunity_form_inquiry";

  return plannedEvent({
    opportunity,
    activityId: null,
    connectionId: null,
    providerThreadId: syntheticProviderThreadIdForOpportunity(opportunity),
    providerMessageId: null,
    direction: "inbound",
    partyRole: "customer",
    noiseReason: null,
    occurredAt: opportunity.created_at ?? now.toISOString(),
    linkedContactKind: "customer",
    source,
    subject: opportunity.title,
    fromEmail: opportunity.contact_email,
    toEmails: [],
    ccEmails: [],
    sourceKey: sourceKeyForOpportunity(opportunity),
    sourceBoundary: "opportunity_source",
    confidence: "medium",
    reason:
      "Opportunity source/title carries deterministic legacy form or RFQ evidence.",
  });
}

function skipReasonFromNoise(
  noiseReason: OpportunityCorrespondenceNoiseReason
): LegacyBackfillSkipReason {
  switch (noiseReason) {
    case "bounce":
      return "bounce";
    case "internal_system":
      return "internal_system";
    case "marketing_noise":
      return "marketing_noise";
    case "provider_noise":
      return "provider_noise";
    case "duplicate_provider_message_id":
      return "duplicate_planned_provider_message_id";
    case "missing_provider_id":
      return "missing_provider_id";
    default:
      return "ambiguous_legacy_evidence";
  }
}

function addPlannedEvent(input: {
  event: LegacyBackfillPlannedEventRow;
  plannedEvents: LegacyBackfillPlannedEventRow[];
  skippedEvidence: LegacyBackfillSkippedEvidence[];
  existingActivityIds: Set<string>;
  plannedActivityIds: Set<string>;
  existingProviderMessageKeys: Set<string>;
  plannedProviderMessageKeys: Set<string>;
}) {
  const activityId = normalizedText(input.event.activity_id);
  if (activityId && input.existingActivityIds.has(activityId)) {
    addSkip(
      input.skippedEvidence,
      activityId,
      input.event.opportunity_id,
      input.event.source_boundary,
      "duplicate_existing_activity_id",
      "A P4 correspondence event already references this legacy activity id."
    );
    return;
  }
  if (activityId && input.plannedActivityIds.has(activityId)) {
    addSkip(
      input.skippedEvidence,
      activityId,
      input.event.opportunity_id,
      input.event.source_boundary,
      "duplicate_activity_id",
      "This dry-run already planned an event for the legacy activity id."
    );
    return;
  }

  const providerKey = providerMessageKey(
    input.event.company_id,
    input.event.connection_id,
    input.event.provider_message_id
  );
  if (providerKey && input.existingProviderMessageKeys.has(providerKey)) {
    addSkip(
      input.skippedEvidence,
      activityId ?? input.event.source_key,
      input.event.opportunity_id,
      input.event.source_boundary,
      "duplicate_existing_provider_message_id",
      "A P4 correspondence event already references this provider message id."
    );
    return;
  }
  if (providerKey && input.plannedProviderMessageKeys.has(providerKey)) {
    addSkip(
      input.skippedEvidence,
      activityId ?? input.event.source_key,
      input.event.opportunity_id,
      input.event.source_boundary,
      "duplicate_planned_provider_message_id",
      "This dry-run already planned an event for the provider message id."
    );
    return;
  }

  input.plannedEvents.push(input.event);
  if (activityId) input.plannedActivityIds.add(activityId);
  if (providerKey) input.plannedProviderMessageKeys.add(providerKey);
}

function latestMeaningfulEvent(
  events: Array<LegacyBackfillExistingEventRow | LegacyBackfillPlannedEventRow>
) {
  return [...events]
    .filter((event) => event.is_meaningful)
    .sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    )[0];
}

export function planLegacyCorrespondenceBackfill(
  input: LegacyBackfillPlanInput
): LegacyBackfillPlan {
  const opportunitiesById = new Map(
    input.opportunities.map((opportunity) => [opportunity.id, opportunity])
  );
  const threadByCompanyAndProvider = new Map(
    input.threads.map((thread) => [
      threadMapKey(thread.company_id, thread.provider_thread_id),
      thread,
    ])
  );
  const threadByConnectionAndProvider = new Map(
    input.threads.map((thread) => [
      linkMapKey(thread.connection_id, thread.provider_thread_id),
      thread,
    ])
  );
  const linksByThread = new Map<string, LegacyBackfillOpportunityThreadLinkRow[]>();
  for (const link of input.opportunityThreadLinks) {
    const rows = linksByThread.get(linkMapKey(link.connection_id, link.thread_id)) ?? [];
    rows.push(link);
    linksByThread.set(linkMapKey(link.connection_id, link.thread_id), rows);
  }
  const connectionsById = new Map(input.connections.map((connection) => [connection.id, connection]));
  const existingActivityIds = new Set(
    input.existingEvents
      .map((event) => normalizedText(event.activity_id))
      .filter((value): value is string => Boolean(value))
  );
  const existingProviderMessageKeys = new Set(
    input.existingEvents
      .map((event) =>
        providerMessageKey(event.company_id, event.connection_id, event.provider_message_id)
      )
      .filter((value): value is string => Boolean(value))
  );
  const existingProviderThreadKeys = new Set(
    input.existingEvents
      .filter((event) => !normalizedText(event.provider_message_id))
      .map((event) =>
        providerThreadKey(
          event.company_id,
          event.opportunity_id,
          event.connection_id,
          event.provider_thread_id
        )
      )
      .filter((value): value is string => Boolean(value))
  );
  const plannedActivityIds = new Set<string>();
  const plannedProviderMessageKeys = new Set<string>();
  const plannedEvents: LegacyBackfillPlannedEventRow[] = [];
  const skippedEvidence: LegacyBackfillSkippedEvidence[] = [];

  for (const activity of input.activities) {
    const opportunity = activity.opportunity_id
      ? opportunitiesById.get(activity.opportunity_id)
      : undefined;
    if (!opportunity) {
      addSkip(
        skippedEvidence,
        activity.id,
        activity.opportunity_id,
        "activity_id",
        "missing_opportunity",
        "Legacy activity is not linked to a scanned opportunity."
      );
      continue;
    }
    if (!normalizedText(activity.created_at)) {
      addSkip(
        skippedEvidence,
        activity.id,
        opportunity.id,
        "activity_id",
        "missing_created_at",
        "Legacy activity has no deterministic timestamp."
      );
      continue;
    }

    const providerThreadId = normalizedText(activity.email_thread_id);
    const thread = providerThreadId
      ? threadByCompanyAndProvider.get(threadMapKey(activity.company_id, providerThreadId))
      : undefined;
    const links = providerThreadId
      ? linksByThread.get(linkMapKey(thread?.connection_id, providerThreadId)) ?? []
      : [];
    if (providerThreadId && relationshipMismatch(activity, thread, links)) {
      addSkip(
        skippedEvidence,
        activity.id,
        opportunity.id,
        "provider_thread_id",
        "relationship_mismatch",
        "Legacy activity thread is linked to a different opportunity."
      );
      continue;
    }

    let event: LegacyBackfillPlannedEventRow | null = null;
    if (activity.type.trim().toLowerCase() === "email") {
      const connection = thread?.connection_id
        ? connectionsById.get(thread.connection_id)
        : undefined;
      const providerKey = providerMessageKey(
        activity.company_id,
        thread?.connection_id,
        activity.email_message_id
      );
      if (providerKey && existingProviderMessageKeys.has(providerKey)) {
        addSkip(
          skippedEvidence,
          activity.id,
          opportunity.id,
          "provider_message_id",
          "duplicate_existing_provider_message_id",
          "A P4 correspondence event already references this provider message id."
        );
        continue;
      }
      const duplicateProviderMessageIds =
        providerKey && plannedProviderMessageKeys.has(providerKey)
          ? [activity.email_message_id ?? ""]
          : [];
      event = plannedEventForEmailActivity({
        activity,
        opportunity,
        thread,
        connection,
        duplicateProviderMessageIds,
      });

      if (!event) {
        const classification = providerThreadId
          ? classifyOpportunityCorrespondence({
              direction: directionOf(activity.direction) ?? "inbound",
              providerThreadId,
              providerMessageId: activity.email_message_id,
              existingProviderMessageIds: duplicateProviderMessageIds,
              fromEmail: activity.from_email,
              toEmails: activity.to_emails,
              ccEmails: activity.cc_emails,
              subject: activity.subject,
              bodyText: bodyFor(activity),
              labels: thread?.labels,
              threadCategory: thread?.primary_category,
              connectionEmail: connection?.email,
              companyDomains: stringList(connection?.sync_filters?.companyDomains),
              userEmailAddresses: stringList(
                connection?.sync_filters?.userEmailAddresses
              ),
              knownPlatformSenders: ["notifications@wix-forms.com"],
              contactEmail: opportunity.contact_email,
              submitterEmail: parsedSubmitterEmail(activity),
            })
          : null;
        addSkip(
          skippedEvidence,
          activity.id,
          opportunity.id,
          providerThreadId ? "provider_thread_id" : "activity_id_without_provider_thread",
          classification
            ? skipReasonFromNoise(classification.noiseReason)
            : "ambiguous_legacy_evidence",
          "Legacy email activity did not meet deterministic meaningful-correspondence rules."
        );
        continue;
      }
    } else {
      event = plannedEventForNonEmailActivity(activity, opportunity);
      if (!event) {
        addSkip(
          skippedEvidence,
          activity.id,
          opportunity.id,
          "activity_id",
          "ambiguous_legacy_evidence",
          "Legacy non-email activity did not meet call, RFQ, meeting, or site-visit rules."
        );
        continue;
      }
    }

    addPlannedEvent({
      event,
      plannedEvents,
      skippedEvidence,
      existingActivityIds,
      plannedActivityIds,
      existingProviderMessageKeys,
      plannedProviderMessageKeys,
    });
  }

  const plannedProviderThreadKeys = new Set(
    plannedEvents
      .filter((event) => !normalizedText(event.provider_message_id))
      .map((event) =>
        providerThreadKey(
          event.company_id,
          event.opportunity_id,
          event.connection_id,
          event.provider_thread_id
        )
      )
      .filter((value): value is string => Boolean(value))
  );

  for (const link of input.opportunityThreadLinks) {
    const opportunity = opportunitiesById.get(link.opportunity_id);
    if (!opportunity) {
      addSkip(
        skippedEvidence,
        link.thread_id,
        link.opportunity_id,
        "provider_thread_id",
        "missing_opportunity",
        "Legacy thread link is not attached to a scanned opportunity."
      );
      continue;
    }

    const thread =
      threadByConnectionAndProvider.get(linkMapKey(link.connection_id, link.thread_id)) ??
      threadByCompanyAndProvider.get(threadMapKey(opportunity.company_id, link.thread_id));
    if (!thread) {
      addSkip(
        skippedEvidence,
        link.thread_id,
        opportunity.id,
        "provider_thread_id",
        "ambiguous_legacy_evidence",
        "Legacy thread link has no matching email_threads row."
      );
      continue;
    }

    if (
      thread.company_id !== opportunity.company_id ||
      (thread.opportunity_id && thread.opportunity_id !== opportunity.id) ||
      (link.connection_id && thread.connection_id && link.connection_id !== thread.connection_id)
    ) {
      addSkip(
        skippedEvidence,
        sourceKeyForThreadLink(link),
        opportunity.id,
        "provider_thread_id",
        "relationship_mismatch",
        "Linked legacy email thread belongs to a different company, opportunity, or connection."
      );
      continue;
    }

    const connectionId = link.connection_id ?? thread.connection_id ?? null;
    const threadKey = providerThreadKey(
      opportunity.company_id,
      opportunity.id,
      connectionId,
      link.thread_id
    );
    if (threadKey && existingProviderThreadKeys.has(threadKey)) {
      addSkip(
        skippedEvidence,
        sourceKeyForThreadLink(link),
        opportunity.id,
        "provider_thread_id",
        "duplicate_existing_provider_thread_id",
        "A P4 correspondence event already references this linked provider thread."
      );
      continue;
    }
    if (threadKey && plannedProviderThreadKeys.has(threadKey)) {
      addSkip(
        skippedEvidence,
        sourceKeyForThreadLink(link),
        opportunity.id,
        "provider_thread_id",
        "duplicate_planned_provider_thread_id",
        "This dry-run already planned activity evidence for this linked provider thread."
      );
      continue;
    }

    const event = plannedEventForThreadLink({
      link,
      opportunity,
      thread,
      connection: connectionId ? connectionsById.get(connectionId) : undefined,
    });
    if (!event) {
      addSkip(
        skippedEvidence,
        sourceKeyForThreadLink(link),
        opportunity.id,
        "provider_thread_id",
        "ambiguous_legacy_evidence",
        "Linked legacy email thread did not meet deterministic meaningful-correspondence rules."
      );
      continue;
    }

    const beforeCount = plannedEvents.length;
    addPlannedEvent({
      event,
      plannedEvents,
      skippedEvidence,
      existingActivityIds,
      plannedActivityIds,
      existingProviderMessageKeys,
      plannedProviderMessageKeys,
    });
    if (plannedEvents.length > beforeCount && threadKey) {
      plannedProviderThreadKeys.add(threadKey);
    }
  }

  const existingEventsByOpportunity = new Map<string, LegacyBackfillExistingEventRow[]>();
  for (const event of input.existingEvents) {
    const rows = existingEventsByOpportunity.get(event.opportunity_id) ?? [];
    rows.push(event);
    existingEventsByOpportunity.set(event.opportunity_id, rows);
  }
  const plannedEventsByOpportunity = new Map<string, LegacyBackfillPlannedEventRow[]>();
  for (const event of plannedEvents) {
    const rows = plannedEventsByOpportunity.get(event.opportunity_id) ?? [];
    rows.push(event);
    plannedEventsByOpportunity.set(event.opportunity_id, rows);
  }

  for (const opportunity of input.opportunities) {
    const hasMeaningfulEvidence = [
      ...(existingEventsByOpportunity.get(opportunity.id) ?? []),
      ...(plannedEventsByOpportunity.get(opportunity.id) ?? []),
    ].some((event) => event.is_meaningful);
    if (hasMeaningfulEvidence) continue;

    const fallback = opportunityFallbackEvent(opportunity, input.now);
    if (!fallback) continue;
    addPlannedEvent({
      event: fallback,
      plannedEvents,
      skippedEvidence,
      existingActivityIds,
      plannedActivityIds,
      existingProviderMessageKeys,
      plannedProviderMessageKeys,
    });
  }

  const allEventsByOpportunity = new Map<
    string,
    Array<LegacyBackfillExistingEventRow | LegacyBackfillPlannedEventRow>
  >();
  for (const event of [...input.existingEvents, ...plannedEvents]) {
    const rows = allEventsByOpportunity.get(event.opportunity_id) ?? [];
    rows.push(event);
    allEventsByOpportunity.set(event.opportunity_id, rows);
  }

  const lifecycleStateRows: LegacyBackfillLifecycleStateRow[] = [];
  for (const [opportunityId, events] of allEventsByOpportunity.entries()) {
    const latest = latestMeaningfulEvent(events);
    if (!latest) continue;
    const planned = "projected_event_id" in latest ? latest : null;
    lifecycleStateRows.push({
      opportunity_id: opportunityId,
      company_id: latest.company_id,
      last_meaningful_event_id: planned?.projected_event_id ?? latest.id,
      last_meaningful_at: latest.occurred_at,
      last_meaningful_direction: latest.direction,
      unanswered_follow_up_count: 0,
      second_follow_up_sent_at: null,
      operator_follow_up_miss_at: null,
      stale_status: null,
      stale_status_at: null,
      updated_at: input.now.toISOString(),
      source_boundary: planned?.source_boundary ?? "existing_p4_event",
      reason: planned?.reason ?? "Existing P4 correspondence event is already present.",
    });
  }

  return {
    plannedEvents,
    lifecycleStateRows,
    skippedEvidence,
    opportunityMutationCount: 0,
  };
}
