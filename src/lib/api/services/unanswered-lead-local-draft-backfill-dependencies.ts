import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AIDraftRequest,
  AIDraftResult,
} from "@/lib/api/services/ai-draft-service";
import type {
  LocalSystemHandoffPersistenceInput,
  UnansweredLeadCorrespondenceSnapshot,
  UnansweredLeadDraftAuthorization,
  UnansweredLeadDraftBackfillDependencies,
  UnansweredLeadOpportunitySnapshot,
  UnansweredLeadPartyRole,
  UnansweredLeadResponseDisposition,
  UnansweredLeadWorkstream,
  UntrustedConversationSnapshot,
  VancouverCalendarWindow,
} from "@/lib/api/services/unanswered-lead-local-draft-backfill-service";
import {
  resolveEmailOpportunityAccess,
  type AllowedEmailOpportunityAccess,
  type EmailOpportunityAccessDecision,
  type EmailOpportunityAccessInput,
} from "@/lib/email/email-opportunity-access";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface DatabaseErrorLike {
  message?: string;
}

interface DatabaseResultLike {
  data: unknown;
  error: DatabaseErrorLike | null;
}

interface QueryLike extends PromiseLike<DatabaseResultLike> {
  select(columns: string): QueryLike;
  eq(column: string, value: unknown): QueryLike;
  in(column: string, values: unknown[]): QueryLike;
  gte(column: string, value: unknown): QueryLike;
  lte(column: string, value: unknown): QueryLike;
  order(column: string, options?: Record<string, unknown>): QueryLike;
  limit(value: number): QueryLike;
  maybeSingle(): Promise<DatabaseResultLike>;
}

export interface UnansweredLeadLocalDraftSupabase {
  from(table: string): QueryLike;
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<DatabaseResultLike>;
}

type ResolveAccess = (
  input: EmailOpportunityAccessInput
) => Promise<EmailOpportunityAccessDecision>;
type GenerateDraft = (input: AIDraftRequest) => Promise<AIDraftResult>;

const defaultGenerateDraft: GenerateDraft = async (request) => {
  const { AIDraftService } =
    await import("@/lib/api/services/ai-draft-service");
  return AIDraftService.generateDraft(request);
};

export interface UnansweredLeadLocalDraftDependencyFactoryInput {
  supabase?: UnansweredLeadLocalDraftSupabase;
  resolveAccess?: ResolveAccess;
  generateDraft?: GenerateDraft;
}

export interface ApprovedUnansweredLeadRecoveryProjectionInput {
  actorUserId: string;
  companyId: string;
  opportunityId: string;
  connectionId: string;
  sourceEventId: string;
  sourceActivityId: string;
  sourceProviderThreadId: string;
  sourceProviderMessageId: string;
  workstream: "sales" | "warranty" | "service" | "current_project";
  responseDisposition: "reply_required" | "no_reply_required";
  conversationScope: "message" | "thread";
  approvedManifestSha256: string;
  entrySha256: string;
}

interface OpportunityRow {
  id: string;
  title: string;
  company_id: string;
  stage: string;
  stage_manually_set: boolean;
  assignment_version: number;
  assigned_to: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  merged_into_opportunity_id: string | null;
  project_id: string | null;
  project_ref: string | null;
  contact_name: string | null;
  contact_email: string | null;
  tags: string[] | null;
  source_metadata: unknown;
}

interface CorrespondenceRow {
  id: string;
  company_id: string;
  activity_id: string | null;
  opportunity_id: string;
  connection_id: string | null;
  provider_thread_id: string | null;
  provider_message_id: string | null;
  direction: string;
  party_role: string;
  is_meaningful: boolean;
  noise_reason: string | null;
  occurred_at: string;
  source: string;
  subject: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
}

interface MessageProjectionRow {
  company_id: string;
  opportunity_id: string;
  source_event_id: string;
  source_activity_id: string;
  connection_id: string;
  provider_thread_id: string;
  provider_message_id: string;
  workstream: string;
  response_disposition: string;
  conversation_scope: string;
  manifest_sha256: string;
  entry_sha256: string;
}

interface EmailThreadRow {
  company_id: string;
  connection_id: string;
  provider_thread_id: string;
  primary_category: string;
  labels: string[] | null;
  routing: string | null;
  participants: string[] | null;
  latest_sender_email: string | null;
}

interface ActivityRow {
  id: string;
  direction: string | null;
  created_at: string;
  subject: string | null;
  body_text: string | null;
}

const OPPORTUNITY_COLUMNS = [
  "id",
  "title",
  "company_id",
  "stage",
  "stage_manually_set",
  "assignment_version",
  "assigned_to",
  "archived_at",
  "deleted_at",
  "merged_into_opportunity_id",
  "project_id",
  "project_ref",
  "contact_name",
  "contact_email",
  "tags",
  "source_metadata",
].join(", ");

const CORRESPONDENCE_COLUMNS = [
  "id",
  "company_id",
  "activity_id",
  "opportunity_id",
  "connection_id",
  "provider_thread_id",
  "provider_message_id",
  "direction",
  "party_role",
  "is_meaningful",
  "noise_reason",
  "occurred_at",
  "source",
  "subject",
  "from_email",
  "to_emails",
  "cc_emails",
].join(", ");

const MESSAGE_PROJECTION_COLUMNS = [
  "company_id",
  "opportunity_id",
  "source_event_id",
  "source_activity_id",
  "connection_id",
  "provider_thread_id",
  "provider_message_id",
  "workstream",
  "response_disposition",
  "conversation_scope",
  "manifest_sha256",
  "entry_sha256",
].join(", ");

const THREAD_COLUMNS = [
  "company_id",
  "connection_id",
  "provider_thread_id",
  "primary_category",
  "labels",
  "routing",
  "participants",
  "latest_sender_email",
].join(", ");

const NON_ACTIONABLE_CATEGORIES = new Set([
  "INTERNAL",
  "MARKETING",
  "RECEIPT",
  "PLATFORM_BID",
  "JOB_SEEKER",
  "PERSONAL",
]);
const SALES_CATEGORIES = new Set(["CUSTOMER", "LEAD", "CLIENT"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const WORKSTREAM_VALUES = new Set<UnansweredLeadWorkstream>([
  "sales",
  "warranty",
  "service",
  "current_project",
  "internal",
  "automated",
  "unknown",
]);

function databaseError(
  context: string,
  error: DatabaseErrorLike | null
): Error {
  return new Error(`${context}: ${error?.message ?? "unknown database error"}`);
}

async function queryRows<T>(
  query: PromiseLike<DatabaseResultLike>,
  context: string
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw databaseError(context, error);
  return Array.isArray(data) ? (data as T[]) : [];
}

async function queryMaybeSingle<T>(
  query: Promise<DatabaseResultLike>,
  context: string
): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw databaseError(context, error);
  return data && typeof data === "object" ? (data as T) : null;
}

function normalizedText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedEmail(value: unknown): string | null {
  return normalizedText(value)?.toLowerCase() ?? null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function canonicalIsoTimestamp(value: string): string {
  const fractionalSeconds = value.match(
    /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i
  )?.[1];
  if (
    fractionalSeconds &&
    /[1-9]/.test(fractionalSeconds.slice(3))
  ) {
    throw new Error(
      "unanswered lead correspondence timestamp precision is unsupported"
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("unanswered lead correspondence timestamp is invalid");
  }
  return parsed.toISOString();
}

function threadKey(
  connectionId: string | null,
  providerThreadId: string | null
): string | null {
  return connectionId && providerThreadId
    ? `${connectionId}\u0000${providerThreadId}`
    : null;
}

function structuredWorkstream(
  opportunity: OpportunityRow,
  threads: EmailThreadRow[],
  projections: MessageProjectionRow[]
): UnansweredLeadWorkstream {
  if (opportunity.project_id || opportunity.project_ref) {
    return "current_project";
  }

  const metadata =
    opportunity.source_metadata &&
    typeof opportunity.source_metadata === "object" &&
    !Array.isArray(opportunity.source_metadata)
      ? (opportunity.source_metadata as Record<string, unknown>)
      : null;
  const metadataWorkstream = normalizedText(
    metadata?.email_workstream ?? metadata?.workstream
  )?.toLowerCase() as UnansweredLeadWorkstream | undefined;
  if (metadataWorkstream && WORKSTREAM_VALUES.has(metadataWorkstream)) {
    return metadataWorkstream;
  }

  const tags = new Set(
    stringArray(opportunity.tags).map((tag) => tag.trim().toLowerCase())
  );
  if (tags.has("warranty")) return "warranty";
  if (tags.has("service")) return "service";
  if (tags.has("current_project") || tags.has("current-project")) {
    return "current_project";
  }

  const projectedWorkstreams = new Set(
    projections
      .map((projection) => projection.workstream as UnansweredLeadWorkstream)
      .filter((workstream) => WORKSTREAM_VALUES.has(workstream))
  );
  if (projectedWorkstreams.size === 1) {
    return [...projectedWorkstreams][0];
  }
  if (projectedWorkstreams.size > 1) return "unknown";

  const categories = new Set(
    threads
      .map((thread) => normalizedText(thread.primary_category)?.toUpperCase())
      .filter((value): value is string => value !== undefined && value !== null)
  );
  if (categories.has("INTERNAL")) return "internal";
  if ([...categories].some((category) => SALES_CATEGORIES.has(category))) {
    return "sales";
  }
  if (
    categories.size > 0 &&
    [...categories].every((category) => NON_ACTIONABLE_CATEGORIES.has(category))
  ) {
    return "automated";
  }
  return "unknown";
}

function structuredResponseDisposition(
  event: CorrespondenceRow,
  thread: EmailThreadRow | null,
  projection: MessageProjectionRow | null
): UnansweredLeadResponseDisposition {
  if (
    event.direction !== "inbound" ||
    event.party_role !== "customer" ||
    event.is_meaningful !== true ||
    event.noise_reason !== null
  ) {
    return "no_reply_required";
  }
  if (projection?.response_disposition === "reply_required") {
    return "reply_required";
  }
  if (projection?.response_disposition === "no_reply_required") {
    return "no_reply_required";
  }
  if (!thread) return "unknown";
  const labels = new Set(
    stringArray(thread.labels).map((label) => label.trim().toUpperCase())
  );
  if (labels.has("AWAITING_REPLY")) return "reply_required";
  const category = normalizedText(thread.primary_category)?.toUpperCase() ?? "";
  if (
    thread.routing === "update_lead_only" ||
    NON_ACTIONABLE_CATEGORIES.has(category)
  ) {
    return "no_reply_required";
  }
  return "unknown";
}

function structuredConversationScope(
  event: CorrespondenceRow,
  thread: EmailThreadRow | null,
  projection: MessageProjectionRow | null
): "message" | "thread" {
  if (projection?.conversation_scope === "message") return "message";
  if (projection?.conversation_scope === "thread") return "thread";
  if (!thread) return "message";

  const effectiveSender = normalizedEmail(event.from_email);
  if (event.direction === "inbound" && effectiveSender) {
    const headerParticipants = new Set([
      ...stringArray(thread.participants).map(normalizedEmail),
      normalizedEmail(thread.latest_sender_email),
    ]);
    if (!headerParticipants.has(effectiveSender)) return "message";
  }
  return "thread";
}

function projectionForEvent(
  event: CorrespondenceRow,
  projection: MessageProjectionRow | undefined
): MessageProjectionRow | null {
  if (
    !projection ||
    projection.company_id !== event.company_id ||
    projection.opportunity_id !== event.opportunity_id ||
    projection.source_event_id !== event.id ||
    projection.source_activity_id !== event.activity_id ||
    projection.connection_id !== event.connection_id ||
    projection.provider_thread_id !== event.provider_thread_id ||
    projection.provider_message_id !== event.provider_message_id ||
    !WORKSTREAM_VALUES.has(projection.workstream as UnansweredLeadWorkstream) ||
    (projection.response_disposition !== "reply_required" &&
      projection.response_disposition !== "no_reply_required") ||
    (projection.conversation_scope !== "message" &&
      projection.conversation_scope !== "thread") ||
    !SHA256_PATTERN.test(projection.manifest_sha256) ||
    !SHA256_PATTERN.test(projection.entry_sha256)
  ) {
    return null;
  }
  return projection;
}

function partyRole(value: string): UnansweredLeadPartyRole {
  switch (value) {
    case "customer":
    case "ops":
    case "internal":
    case "provider":
    case "system":
    case "marketing":
      return value;
    default:
      return "unknown";
  }
}

function mapSnapshots(
  opportunities: OpportunityRow[],
  events: CorrespondenceRow[],
  threads: EmailThreadRow[],
  projections: MessageProjectionRow[]
): UnansweredLeadOpportunitySnapshot[] {
  const threadsByKey = new Map<string, EmailThreadRow>();
  for (const thread of threads) {
    const key = threadKey(thread.connection_id, thread.provider_thread_id);
    if (key) threadsByKey.set(key, thread);
  }
  const projectionsByEventId = new Map(
    projections.map((projection) => [projection.source_event_id, projection])
  );

  return opportunities.map((opportunity) => {
    const opportunityEvents = events.filter(
      (event) => event.opportunity_id === opportunity.id
    );
    const opportunityThreads = opportunityEvents
      .map((event) => {
        const key = threadKey(event.connection_id, event.provider_thread_id);
        return key ? (threadsByKey.get(key) ?? null) : null;
      })
      .filter((thread): thread is EmailThreadRow => thread !== null);
    const opportunityProjections = opportunityEvents
      .map((event) =>
        projectionForEvent(event, projectionsByEventId.get(event.id))
      )
      .filter(
        (projection): projection is MessageProjectionRow => projection !== null
      );
    const workstream = structuredWorkstream(
      opportunity,
      opportunityThreads,
      opportunityProjections
    );
    const mappedEvents: UnansweredLeadCorrespondenceSnapshot[] =
      opportunityEvents.map((event) => {
        const key = threadKey(event.connection_id, event.provider_thread_id);
        const thread = key ? (threadsByKey.get(key) ?? null) : null;
        const projection = projectionForEvent(
          event,
          projectionsByEventId.get(event.id)
        );
        return {
          id: event.id,
          activityId: event.activity_id,
          opportunityId: event.opportunity_id,
          connectionId: event.connection_id,
          providerThreadId: event.provider_thread_id,
          providerMessageId: event.provider_message_id,
          direction: event.direction === "outbound" ? "outbound" : "inbound",
          partyRole: partyRole(event.party_role),
          fromEmail: normalizedEmail(event.from_email),
          toEmails: stringArray(event.to_emails),
          ccEmails: stringArray(event.cc_emails),
          isMeaningful: event.is_meaningful === true,
          noiseReason: normalizedText(event.noise_reason),
          responseDisposition: structuredResponseDisposition(
            event,
            thread,
            projection
          ),
          conversationScope: structuredConversationScope(
            event,
            thread,
            projection
          ),
          occurredAt: canonicalIsoTimestamp(event.occurred_at),
          untrustedSubject: event.subject,
          untrustedBodyText: null,
        };
      });

    return {
      id: opportunity.id,
      label: opportunity.title,
      companyId: opportunity.company_id,
      stage: opportunity.stage,
      stageManuallySet: opportunity.stage_manually_set === true,
      assignmentVersion: Number(opportunity.assignment_version),
      assignedTo: opportunity.assigned_to,
      archivedAt: opportunity.archived_at,
      deletedAt: opportunity.deleted_at,
      mergedIntoOpportunityId: opportunity.merged_into_opportunity_id,
      projectId: opportunity.project_id,
      projectRef: opportunity.project_ref,
      workstream,
      contactName: opportunity.contact_name,
      contactEmail: opportunity.contact_email,
      events: mappedEvents,
    };
  });
}

async function loadThreads(
  supabase: UnansweredLeadLocalDraftSupabase,
  companyId: string,
  events: CorrespondenceRow[]
): Promise<EmailThreadRow[]> {
  const providerThreadIds = Array.from(
    new Set(
      events
        .map((event) => normalizedText(event.provider_thread_id))
        .filter((value): value is string => value !== null)
    )
  );
  if (providerThreadIds.length === 0) return [];
  return queryRows<EmailThreadRow>(
    supabase
      .from("email_threads")
      .select(THREAD_COLUMNS)
      .eq("company_id", companyId)
      .in("provider_thread_id", providerThreadIds),
    "Unanswered-lead thread metadata read failed"
  );
}

async function loadMessageProjections(
  supabase: UnansweredLeadLocalDraftSupabase,
  companyId: string,
  events: CorrespondenceRow[]
): Promise<MessageProjectionRow[]> {
  const sourceEventIds = Array.from(
    new Set(events.map((event) => event.id).filter(Boolean))
  );
  if (sourceEventIds.length === 0) return [];
  return queryRows<MessageProjectionRow>(
    supabase
      .from("unanswered_lead_message_projections")
      .select(MESSAGE_PROJECTION_COLUMNS)
      .eq("company_id", companyId)
      .in("source_event_id", sourceEventIds),
    "Unanswered-lead message projection read failed"
  );
}

async function loadWindowSnapshots(
  supabase: UnansweredLeadLocalDraftSupabase,
  companyId: string,
  window: VancouverCalendarWindow
): Promise<UnansweredLeadOpportunitySnapshot[]> {
  const events = await queryRows<CorrespondenceRow>(
    supabase
      .from("opportunity_correspondence_events")
      .select(CORRESPONDENCE_COLUMNS)
      .eq("company_id", companyId)
      .gte("occurred_at", window.startInclusive.toISOString())
      .lte("occurred_at", window.endInclusive.toISOString())
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true }),
    "Unanswered-lead correspondence read failed"
  );
  const opportunityIds = Array.from(
    new Set(events.map((event) => event.opportunity_id).filter(Boolean))
  );
  if (opportunityIds.length === 0) return [];
  const [opportunities, threads, projections] = await Promise.all([
    queryRows<OpportunityRow>(
      supabase
        .from("opportunities")
        .select(OPPORTUNITY_COLUMNS)
        .eq("company_id", companyId)
        .in("id", opportunityIds),
      "Unanswered-lead opportunity read failed"
    ),
    loadThreads(supabase, companyId, events),
    loadMessageProjections(supabase, companyId, events),
  ]);
  return mapSnapshots(opportunities, events, threads, projections);
}

async function loadOneSnapshot(
  supabase: UnansweredLeadLocalDraftSupabase,
  companyId: string,
  opportunityId: string
): Promise<UnansweredLeadOpportunitySnapshot | null> {
  const opportunity = await queryMaybeSingle<OpportunityRow>(
    supabase
      .from("opportunities")
      .select(OPPORTUNITY_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", opportunityId)
      .limit(1)
      .maybeSingle(),
    "Current unanswered-lead opportunity read failed"
  );
  if (!opportunity) return null;
  const events = await queryRows<CorrespondenceRow>(
    supabase
      .from("opportunity_correspondence_events")
      .select(CORRESPONDENCE_COLUMNS)
      .eq("company_id", companyId)
      .eq("opportunity_id", opportunityId)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true }),
    "Current unanswered-lead correspondence read failed"
  );
  const [threads, projections] = await Promise.all([
    loadThreads(supabase, companyId, events),
    loadMessageProjections(supabase, companyId, events),
  ]);
  return mapSnapshots([opportunity], events, threads, projections)[0] ?? null;
}

function exactAllowedAccess(
  decision: EmailOpportunityAccessDecision,
  input: {
    actorUserId: string;
    companyId: string;
    opportunityId: string;
    connectionId: string;
  }
): AllowedEmailOpportunityAccess | null {
  if (!decision.allowed) return null;
  return decision.actor.userId === input.actorUserId &&
    decision.actor.companyId === input.companyId &&
    decision.operation === "edit" &&
    decision.opportunityId === input.opportunityId &&
    decision.connectionId === input.connectionId &&
    decision.pipelineScope !== null
    ? decision
    : null;
}

async function resolveExactEditAccess(
  supabase: UnansweredLeadLocalDraftSupabase,
  resolver: ResolveAccess,
  input: {
    actorUserId: string;
    companyId: string;
    opportunityId: string;
    connectionId: string;
  }
): Promise<AllowedEmailOpportunityAccess | null> {
  const decision = await resolver({
    actor: { userId: input.actorUserId, companyId: input.companyId },
    operation: "edit",
    connectionId: input.connectionId,
    opportunityId: input.opportunityId,
    supabase: supabase as unknown as SupabaseClient,
  });
  return exactAllowedAccess(decision, input);
}

function resultObject(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Records the trusted routing outcome for one already-approved recovery
 * manifest entry. It neither reads customer copy nor mutates a provider.
 */
export async function projectApprovedUnansweredLeadRecoveryMessage(
  projection: ApprovedUnansweredLeadRecoveryProjectionInput,
  input: Pick<
    UnansweredLeadLocalDraftDependencyFactoryInput,
    "supabase" | "resolveAccess"
  > = {}
): Promise<"created" | "already_exists"> {
  if (
    !SHA256_PATTERN.test(projection.approvedManifestSha256) ||
    !SHA256_PATTERN.test(projection.entrySha256)
  ) {
    throw new Error("Approved recovery projection hashes are invalid");
  }
  const supabase =
    input.supabase ??
    (getServiceRoleClient() as unknown as UnansweredLeadLocalDraftSupabase);
  const resolver = input.resolveAccess ?? resolveEmailOpportunityAccess;
  const access = await resolveExactEditAccess(supabase, resolver, {
    actorUserId: projection.actorUserId,
    companyId: projection.companyId,
    opportunityId: projection.opportunityId,
    connectionId: projection.connectionId,
  });
  if (!access) {
    throw new Error("Unanswered-lead recovery projection access denied");
  }

  const { data, error } = await supabase.rpc(
    "project_unanswered_lead_recovery_message",
    {
      p_actor_user_id: projection.actorUserId,
      p_company_id: projection.companyId,
      p_opportunity_id: projection.opportunityId,
      p_connection_id: projection.connectionId,
      p_source_event_id: projection.sourceEventId,
      p_source_activity_id: projection.sourceActivityId,
      p_source_provider_thread_id: projection.sourceProviderThreadId,
      p_source_provider_message_id: projection.sourceProviderMessageId,
      p_workstream: projection.workstream,
      p_response_disposition: projection.responseDisposition,
      p_conversation_scope: projection.conversationScope,
      p_manifest_sha256: projection.approvedManifestSha256,
      p_entry_sha256: projection.entrySha256,
    }
  );
  if (error) {
    throw databaseError("Approved recovery message projection failed", error);
  }
  const status = resultObject(data)?.status;
  if (status !== "created" && status !== "already_exists") {
    throw new Error("Recovery message projection returned an invalid result");
  }
  return status;
}

function persistenceArgs(
  input: LocalSystemHandoffPersistenceInput
): Record<string, unknown> {
  return {
    p_actor_user_id: input.actorUserId,
    p_company_id: input.companyId,
    p_opportunity_id: input.opportunityId,
    p_connection_id: input.connectionId,
    p_recipient_name: input.recipientName,
    p_recipient_email: input.recipientEmail,
    p_source_event_id: input.sourceEventId,
    p_source_activity_id: input.sourceActivityId,
    p_source_provider_message_id: input.sourceProviderMessageId,
    p_source_provider_thread_id: input.sourceProviderThreadId,
    p_source_occurred_at: input.sourceOccurredAt,
    p_provider_thread_id: input.providerThreadId,
    p_subject: input.subject,
    p_body: input.body,
    p_ai_draft_history_id: input.aiDraftHistoryId,
    p_expected_workstream: input.expectedWorkstream,
    p_expected_stage: input.expectedStage,
    p_expected_stage_manually_set: input.expectedStageManuallySet,
    p_expected_assignment_version: input.expectedAssignmentVersion,
    p_expected_assigned_to: input.expectedAssignedTo,
  };
}

/**
 * Production server-only adapter. Its database writes are restricted to the
 * three reviewed local RPCs; it has no provider transport dependency.
 */
export function createUnansweredLeadLocalDraftBackfillDependencies(
  input: UnansweredLeadLocalDraftDependencyFactoryInput = {}
): UnansweredLeadDraftBackfillDependencies {
  const supabase =
    input.supabase ??
    (getServiceRoleClient() as unknown as UnansweredLeadLocalDraftSupabase);
  const resolver = input.resolveAccess ?? resolveEmailOpportunityAccess;
  const generateDraft = input.generateDraft ?? defaultGenerateDraft;

  return {
    loadOpportunitySnapshots: ({ companyId, window }) =>
      loadWindowSnapshots(supabase, companyId, window),

    loadCurrentOpportunitySnapshot: ({ companyId, opportunityId }) =>
      loadOneSnapshot(supabase, companyId, opportunityId),

    async authorizeCurrentAccess({
      actorUserId,
      companyId,
      opportunityId,
      connectionId,
    }): Promise<UnansweredLeadDraftAuthorization> {
      const access = await resolveExactEditAccess(supabase, resolver, {
        actorUserId,
        companyId,
        opportunityId,
        connectionId,
      });
      return {
        inboxAllowed: access !== null,
        pipelineAllowed: access !== null && access.pipelineScope !== null,
      };
    },

    async claimLocalGeneration({ companyId, opportunityId, sourceEventId }) {
      const { data, error } = await supabase.rpc(
        "claim_unanswered_lead_local_draft_generation",
        {
          p_company_id: companyId,
          p_opportunity_id: opportunityId,
          p_source_event_id: sourceEventId,
          p_lease_seconds: 600,
        }
      );
      if (error) throw databaseError("Local draft claim failed", error);
      const result = resultObject(data);
      const reason = result?.reason;
      if (
        reason !== "acquired" &&
        reason !== "existing_draft" &&
        reason !== "generation_in_progress"
      ) {
        throw new Error("Local draft claim returned an invalid result");
      }
      return {
        acquired: result?.acquired === true,
        claimToken: normalizedText(result?.claim_token),
        reason,
      };
    },

    async releaseLocalGeneration({
      companyId,
      opportunityId,
      sourceEventId,
      claimToken,
    }) {
      const { error } = await supabase.rpc(
        "release_unanswered_lead_local_draft_generation",
        {
          p_company_id: companyId,
          p_opportunity_id: opportunityId,
          p_source_event_id: sourceEventId,
          p_claim_token: claimToken,
        }
      );
      if (error) {
        throw databaseError("Local draft claim release failed", error);
      }
    },

    async loadUntrustedConversation({
      companyId,
      opportunityId,
      sourceEventId,
    }): Promise<UntrustedConversationSnapshot> {
      const source = await queryMaybeSingle<Pick<CorrespondenceRow, "id">>(
        supabase
          .from("opportunity_correspondence_events")
          .select("id")
          .eq("company_id", companyId)
          .eq("opportunity_id", opportunityId)
          .eq("id", sourceEventId)
          .limit(1)
          .maybeSingle(),
        "Unanswered-lead source event read failed"
      );
      if (!source) throw new Error("Unanswered-lead source event is stale");
      const activities = await queryRows<ActivityRow>(
        supabase
          .from("activities")
          .select("id, direction, created_at, subject, body_text")
          .eq("company_id", companyId)
          .eq("opportunity_id", opportunityId)
          .eq("type", "email")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
        "Untrusted opportunity conversation read failed"
      );
      return {
        sourceEventId,
        messages: activities.map((activity) => ({
          direction: activity.direction === "outbound" ? "outbound" : "inbound",
          occurredAt: activity.created_at,
          untrustedSubject: activity.subject,
          untrustedBodyText: activity.body_text,
        })),
      };
    },

    async generateLocalCopy({ actorUserId, candidate }) {
      const emailAccess = await resolveExactEditAccess(supabase, resolver, {
        actorUserId,
        companyId: candidate.companyId,
        opportunityId: candidate.opportunityId,
        connectionId: candidate.sourceConnectionId,
      });
      if (!emailAccess) throw new Error("Unanswered-lead draft access denied");

      const generated = await generateDraft({
        companyId: candidate.companyId,
        userId: actorUserId,
        connectionId: candidate.sourceConnectionId,
        opportunityId: candidate.opportunityId,
        sourceActivityId: candidate.sourceActivityId,
        origin: "system_handoff",
        emailAccess,
      });
      const subject = normalizedText(generated.subject);
      const body = normalizedText(generated.draft);
      const aiDraftHistoryId = normalizedText(generated.draftHistoryId);
      if (!generated.available || !subject || !body || !aiDraftHistoryId) {
        throw new Error("Canonical AI draft was not available");
      }
      return { subject, body, aiDraftHistoryId };
    },

    async persistLocalSystemHandoff(persistenceInput) {
      const { data, error } = await supabase.rpc(
        "persist_unanswered_lead_local_system_handoff",
        persistenceArgs(persistenceInput)
      );
      if (error) {
        throw databaseError("Local system handoff persist failed", error);
      }
      const status = resultObject(data)?.status;
      if (
        status !== "created" &&
        status !== "already_exists" &&
        status !== "stale"
      ) {
        throw new Error(
          "Local system handoff persist returned an invalid result"
        );
      }
      return status;
    },
  };
}
