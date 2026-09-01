import "server-only";

import { createHash } from "node:crypto";

import type { PhaseCEmailActorContext } from "@/lib/email/phase-c-email-actor";
import type { AllowedEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";
import { getSubscriptionInfo } from "@/lib/subscription";
import { requireSupabase } from "@/lib/supabase/helpers";
import type { EmailThreadCategory } from "@/lib/types/email-thread";
import type {
  Company,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/lib/types/models";
import { markdownToEmailHtml } from "@/lib/utils/markdown-to-email-html";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { AIDraftService } from "./ai-draft-service";
import { CronDatabaseOperationError } from "./cron-workload-control-service";
import { runWithEmailConnectionSyncLock } from "./email-connection-sync-lock";
import { EmailSendDeliveryService } from "./email-send-delivery-service";
import { EmailSendIntentService } from "./email-send-intent-service";
import { reconcileEmailSend } from "./email-send-reconciliation-service";
import { EmailService } from "./email-service";
import { renderEmailBodyWithSignature } from "./email-signature-service";
import { PhaseCCategoryAutonomy } from "./phase-c-category-autonomy-service";
import type { OperationalAutonomousRoutingAuthority } from "./conversation-state/operational-autonomous-routing";

export interface AutoSendSettings {
  enabled: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  timezone: string;
  delayMinMinutes: number;
  delayMaxMinutes: number;
  enabledAt?: string;
}

export const DEFAULT_AUTO_SEND_SETTINGS: AutoSendSettings = {
  enabled: false,
  businessHoursStart: "08:00",
  businessHoursEnd: "18:00",
  timezone: "America/New_York",
  delayMinMinutes: 30,
  delayMaxMinutes: 60,
};

export type PendingAutoSendStatus =
  "pending" | "leased" | "sent" | "cancelled" | "failed";

export interface PendingAutoSend {
  id: string;
  pendingAutoSendId: string;
  companyId: string;
  actorUserId: string | null;
  assignmentVersion: number | null;
  assignmentEventId: string | null;
  connectionId: string;
  opportunityId: string | null;
  sourceEmailThreadId: string | null;
  providerThreadId: string;
  replyProviderThreadId: string;
  threadId: string;
  inReplyTo: string | null;
  senderSwitched: false;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  draftText: string;
  authoredBody: string;
  renderedBody: string;
  contentType: "text" | "html";
  draftHistoryId: string | null;
  followUpDraftId: null;
  profileTypeSnapshot: string;
  categorySnapshot: string | null;
  autonomyLevelSnapshot: "auto_send" | "auto_follow_up" | null;
  learningAuthority: "autonomous";
  actorNameSnapshot: string;
  actorEmailSnapshot: string;
  clientFromAddressSnapshot: string;
  signatureId: string | null;
  signatureContentHash: string | null;
  renderedBodyHash: string;
  idempotencyKey: string;
  initiatedBy: "phase_c_auto_send";
  sendIntentId: string | null;
  scheduledSendAt: Date;
  status: PendingAutoSendStatus;
  leaseToken: string | null;
  claimedAt: Date | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  cancelledAt: Date | null;
  error: string | null;
  retryCount: number;
}

export interface ClaimedAutoSendSource extends PendingAutoSend {
  actorUserId: string;
  assignmentVersion: number;
  assignmentEventId: string;
  opportunityId: string;
  sourceEmailThreadId: string;
  autonomyLevelSnapshot: "auto_send" | "auto_follow_up";
  status: "leased";
  leaseToken: string;
  claimedAt: Date;
  leaseExpiresAt: Date;
}

export interface PhaseCAutoSendIdempotencyInput {
  companyId: string;
  actorUserId: string;
  assignmentVersion: number;
  assignmentEventId: string;
  connectionId: string;
  opportunityId: string;
  sourceEmailThreadId: string;
  providerThreadId: string;
  inReplyTo: string | null;
  generationKind?:
    "conversation_reply" | "auto_follow_up" | "operational_outbound";
  sourceActivityId?: string | null;
  followUpSequence?: number | null;
  draftHistoryId?: string;
}

export interface ScheduleAutoSendInput {
  category: EmailThreadCategory;
  companyId: string;
  /** Legacy value is ignored. The canonical actor context is mandatory. */
  userId?: string;
  actorContext?: PhaseCEmailActorContext;
  connectionId: string;
  opportunityId?: string;
  threadId: string;
  inReplyTo?: string;
  toEmails: string[];
  ccEmails?: string[];
  subject: string;
  settings: AutoSendSettings;
  /** Source-bound authorization and message purpose for the draft call. */
  generation:
    | {
        kind: "conversation_reply";
        emailAccess: AllowedEmailOpportunityAccess;
        sourceActivityId: string;
        sourceMessageId: string;
      }
    | {
        kind: "auto_follow_up";
        autonomousRoutingAuthority: OperationalAutonomousRoutingAuthority;
        emailAccess: AllowedEmailOpportunityAccess;
        sourceActivityId: string;
        sourceMessageId: string;
        followUpSequence: number;
        instruction: string;
      }
    | {
        kind: "operational_outbound";
        autonomousRoutingAuthority: OperationalAutonomousRoutingAuthority;
        emailAccess: AllowedEmailOpportunityAccess;
        instruction: string;
        verifiedSchedule?: boolean;
      };
}

export type ScheduleAutoSendResult =
  | { outcome: "scheduled"; pending: PendingAutoSend }
  | { outcome: "no_reply_warranted"; reason?: string }
  | { outcome: "held_for_review"; reason?: string }
  /**
   * The draft exists and is good, but its response mode is permanently outside
   * auto-send. Today that is exactly one case: a SCHEDULE reply. Callers fall
   * back to auto-draft behavior — the draft is placed for the operator, and no
   * `pending_auto_sends` row is ever created.
   */
  | { outcome: "draft_only"; reason?: string }
  | { outcome: "unavailable"; reason?: string };

export interface CompleteAutoSendClaimInput {
  id: string;
  companyId: string;
  leaseToken: string;
  sendIntentId: string;
}

export interface RetryAutoSendClaimInput {
  id: string;
  companyId: string;
  leaseToken: string;
  error: string;
  retryAt?: Date | string;
}

export interface CancelAutoSendOptions {
  leaseToken?: string | null;
  reason?: string;
  /** Canonical OPS actor for browser cancellation; null for leased workers. */
  actorUserId?: string | null;
}

export interface AutoSendClaimBatch {
  sent: number;
  failed: number;
  errors: string[];
  claimed: ClaimedAutoSendSource[];
}

type SchedulablePhaseCEmailActorContext = PhaseCEmailActorContext & {
  assignmentEventId: string;
};

type PhaseCAutoSendGeneration = ScheduleAutoSendInput["generation"];

interface PhaseCAutoSendSourceFence {
  generationKind: PhaseCAutoSendGeneration["kind"];
  sourceActivityId: string | null;
  sourceMessageId: string | null;
  followUpSequence: number | null;
}

interface PhaseCAutoSendDeliveryFence extends PhaseCAutoSendSourceFence {
  current: boolean;
  providerThreadId: string;
  reason: string | null;
}

interface PhaseCAutoSendGenerationReservation {
  disposition:
    | "acquired"
    | "in_progress"
    | "scheduled"
    | "no_reply_warranted"
    | "held_for_review";
  generationToken: string | null;
  toEmails: string[];
  ccEmails: string[];
  reason: string | null;
  pending: PendingAutoSend | null;
}

class PhaseCAutoSendSourceCancelledError extends Error {
  constructor() {
    super("PHASE_C_AUTO_SEND_SOURCE_STALE");
    this.name = "PhaseCAutoSendSourceCancelledError";
  }
}

type CompanySubscriptionFields = Pick<
  Company,
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "trialEndDate"
  | "seatedEmployeeIds"
  | "adminIds"
  | "maxSeats"
>;

async function isCompanySubscriptionActive(
  companyId: string
): Promise<boolean> {
  const { data, error } = await requireSupabase()
    .from("companies")
    .select(
      "subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
    )
    .eq("id", companyId)
    .single();

  if (error || !data) {
    console.error(
      `[auto-send] Subscription lookup failed for company ${companyId}:`,
      error
    );
    return false;
  }

  const fields: CompanySubscriptionFields = {
    subscriptionPlan: (data.subscription_plan as SubscriptionPlan) ?? null,
    subscriptionStatus:
      (data.subscription_status as SubscriptionStatus) ?? null,
    trialEndDate: data.trial_end_date
      ? new Date(data.trial_end_date as string)
      : null,
    seatedEmployeeIds: (data.seated_employee_ids as string[]) ?? [],
    adminIds: (data.admin_ids as string[]) ?? [],
    maxSeats: (data.max_seats as number) ?? 10,
  };
  return getSubscriptionInfo(fields).isActive;
}

function randomDelay(minMinutes: number, maxMinutes: number): number {
  const range = Math.max(0, maxMinutes - minMinutes);
  return Math.floor(minMinutes + Math.random() * range);
}

function adjustToBusinessHours(
  baseTime: Date,
  delayMinutes: number,
  settings: AutoSendSettings
): Date {
  const scheduled = new Date(baseTime.getTime() + delayMinutes * 60 * 1000);
  const [startH, startM] = settings.businessHoursStart.split(":").map(Number);
  const [endH, endM] = settings.businessHoursEnd.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: settings.timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(scheduled);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0
  );
  const scheduledMinutes = hour * 60 + minute;

  if (scheduledMinutes >= startMinutes && scheduledMinutes < endMinutes) {
    return scheduled;
  }
  const minutesUntilStart =
    scheduledMinutes >= endMinutes
      ? 24 * 60 - scheduledMinutes + startMinutes
      : startMinutes - scheduledMinutes;
  return new Date(scheduled.getTime() + minutesUntilStart * 60 * 1000);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  const normalized = text(value).trim();
  return normalized || null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function date(value: unknown): Date {
  return new Date(text(value));
}

function nullableDate(value: unknown): Date | null {
  return value ? date(value) : null;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeAddresses(addresses: string[] | undefined): string[] {
  return (addresses ?? [])
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);
}

function buildPhaseCAutoSendArgumentsHash(
  params: ScheduleAutoSendInput
): string {
  const generation = params.generation;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "phase_c_auto_send_arguments:v1",
        params.category,
        params.subject.trim(),
        params.settings.businessHoursStart,
        params.settings.businessHoursEnd,
        params.settings.timezone,
        params.settings.delayMinMinutes,
        params.settings.delayMaxMinutes,
        generation.kind,
        generation.kind === "operational_outbound"
          ? generation.verifiedSchedule === true
          : null,
        generation.kind === "conversation_reply"
          ? null
          : generation.autonomousRoutingAuthority,
        generation.kind === "conversation_reply"
          ? null
          : generation.instruction.trim(),
        generation.kind === "auto_follow_up"
          ? generation.followUpSequence
          : null,
      ])
    )
    .digest("hex");
}

function mapGenerationReservation(
  data: unknown
): PhaseCAutoSendGenerationReservation | null {
  const row = firstRow(data);
  if (!row) return null;
  const disposition = text(row.disposition);
  if (
    disposition !== "acquired" &&
    disposition !== "in_progress" &&
    disposition !== "scheduled" &&
    disposition !== "no_reply_warranted" &&
    disposition !== "held_for_review"
  ) {
    return null;
  }
  const pendingRow = row.pending_auto_send;
  return {
    disposition,
    generationToken: nullableText(row.generation_token),
    toEmails: normalizeAddresses(stringArray(row.to_emails)),
    ccEmails: normalizeAddresses(stringArray(row.cc_emails)),
    reason: nullableText(row.reason),
    pending:
      pendingRow && typeof pendingRow === "object"
        ? mapPendingFromDb(pendingRow as Record<string, unknown>)
        : null,
  };
}

async function resolveGenerationReservation(input: {
  idempotencyKey: string | null;
  generationToken: string | null;
  argumentsHash: string | null;
  disposition: "no_reply_warranted" | "held_for_review" | "failed";
  reason?: string | null;
}): Promise<void> {
  if (!input.idempotencyKey || !input.generationToken || !input.argumentsHash) {
    return;
  }
  const { error } = await requireSupabase().rpc(
    "resolve_phase_c_auto_send_generation_as_system",
    {
      p_idempotency_key: input.idempotencyKey,
      p_generation_token: input.generationToken,
      p_arguments_hash: input.argumentsHash,
      p_disposition: input.disposition,
      p_reason: input.reason ?? null,
    }
  );
  if (error) {
    console.error(
      "[auto-send] generation reservation resolution failed",
      error
    );
  }
}

function mapPendingFromDb(row: Record<string, unknown>): PendingAutoSend {
  const id = text(row.id);
  const providerThreadId = text(row.thread_id);
  const contentType = row.content_type === "html" ? "html" : "text";
  return {
    id,
    pendingAutoSendId: id,
    companyId: text(row.company_id),
    actorUserId: nullableText(row.actor_user_id),
    assignmentVersion:
      row.assignment_version === null || row.assignment_version === undefined
        ? null
        : Number(row.assignment_version),
    assignmentEventId: nullableText(row.assignment_event_id),
    connectionId: text(row.connection_id),
    opportunityId: nullableText(row.opportunity_id),
    sourceEmailThreadId: nullableText(row.source_email_thread_id),
    providerThreadId,
    replyProviderThreadId: providerThreadId,
    threadId: providerThreadId,
    inReplyTo: nullableText(row.in_reply_to),
    senderSwitched: false,
    toEmails: stringArray(row.to_emails),
    ccEmails: stringArray(row.cc_emails),
    subject: text(row.subject),
    draftText: text(row.draft_text),
    authoredBody: text(row.authored_body) || text(row.draft_text),
    renderedBody: text(row.rendered_body) || text(row.draft_text),
    contentType,
    draftHistoryId: nullableText(row.draft_history_id),
    followUpDraftId: null,
    profileTypeSnapshot: text(row.profile_type_snapshot) || "general",
    categorySnapshot: nullableText(row.category_snapshot),
    autonomyLevelSnapshot:
      row.autonomy_level_snapshot === "auto_send" ||
      row.autonomy_level_snapshot === "auto_follow_up"
        ? row.autonomy_level_snapshot
        : null,
    learningAuthority: "autonomous",
    actorNameSnapshot: text(row.actor_name_snapshot),
    actorEmailSnapshot: text(row.actor_email_snapshot),
    clientFromAddressSnapshot: text(row.client_from_address_snapshot),
    signatureId: nullableText(row.signature_id),
    signatureContentHash: nullableText(row.signature_content_hash),
    renderedBodyHash: text(row.rendered_body_hash),
    idempotencyKey: text(row.idempotency_key),
    initiatedBy: "phase_c_auto_send",
    sendIntentId: nullableText(row.send_intent_id),
    scheduledSendAt: date(row.scheduled_send_at),
    status: text(row.status) as PendingAutoSendStatus,
    leaseToken: nullableText(row.lease_token),
    claimedAt: nullableDate(row.claimed_at),
    leaseExpiresAt: nullableDate(row.lease_expires_at),
    createdAt: date(row.created_at),
    updatedAt: row.updated_at ? date(row.updated_at) : date(row.created_at),
    sentAt: nullableDate(row.sent_at),
    cancelledAt: nullableDate(row.cancelled_at),
    error: nullableText(row.error),
    retryCount: Number(row.retry_count ?? 0),
  };
}

function mapClaimedFromDb(row: Record<string, unknown>): ClaimedAutoSendSource {
  const pending = mapPendingFromDb(row);
  if (
    pending.status !== "leased" ||
    !pending.actorUserId ||
    pending.assignmentVersion === null ||
    !pending.assignmentEventId ||
    !pending.opportunityId ||
    !pending.sourceEmailThreadId ||
    !pending.categorySnapshot ||
    !pending.autonomyLevelSnapshot ||
    !pending.leaseToken ||
    !pending.claimedAt ||
    !pending.leaseExpiresAt ||
    !pending.idempotencyKey ||
    !pending.renderedBodyHash
  ) {
    throw new Error("PHASE_C_AUTO_SEND_INVALID_CLAIM");
  }
  return pending as ClaimedAutoSendSource;
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildPhaseCAutoSendIdempotencyKey(
  input: PhaseCAutoSendIdempotencyInput
): string {
  const generationKind = input.generationKind ?? "operational_outbound";
  const sourceBound =
    generationKind === "conversation_reply" ||
    generationKind === "auto_follow_up";
  const sourceActivityId = input.sourceActivityId?.trim() || null;
  const followUpSequence = input.followUpSequence ?? null;
  if (!sourceBound && !input.draftHistoryId?.trim()) {
    throw new Error("Operational auto-send requires a draft history id");
  }
  if (sourceBound && !sourceActivityId) {
    throw new Error("Source-bound auto-send requires a source activity id");
  }
  if (
    generationKind === "auto_follow_up" &&
    (!Number.isInteger(followUpSequence) ||
      followUpSequence === null ||
      followUpSequence < 1)
  ) {
    throw new Error("Automatic follow-up requires a positive sequence");
  }

  return createHash("sha256")
    .update(
      JSON.stringify([
        "phase_c_auto_send:v2",
        input.companyId,
        input.actorUserId,
        input.assignmentVersion,
        input.assignmentEventId,
        input.connectionId,
        input.opportunityId,
        input.sourceEmailThreadId,
        input.providerThreadId,
        input.inReplyTo,
        generationKind,
        sourceBound ? sourceActivityId : input.draftHistoryId,
        generationKind === "auto_follow_up" ? followUpSequence : null,
      ])
    )
    .digest("hex");
}

function sourceFenceForGeneration(
  generation: PhaseCAutoSendGeneration
): PhaseCAutoSendSourceFence {
  if (generation.kind === "conversation_reply") {
    return {
      generationKind: generation.kind,
      sourceActivityId: generation.sourceActivityId.trim(),
      sourceMessageId: generation.sourceMessageId.trim(),
      followUpSequence: null,
    };
  }
  if (generation.kind === "auto_follow_up") {
    return {
      generationKind: generation.kind,
      sourceActivityId: generation.sourceActivityId.trim(),
      sourceMessageId: generation.sourceMessageId.trim(),
      followUpSequence: generation.followUpSequence,
    };
  }
  return {
    generationKind: generation.kind,
    sourceActivityId: null,
    sourceMessageId: null,
    followUpSequence: null,
  };
}

function mapDeliveryFence(data: unknown): PhaseCAutoSendDeliveryFence | null {
  const row = firstRow(data);
  if (!row || typeof row.current !== "boolean") return null;
  const generationKind = text(row.generation_kind);
  if (
    generationKind !== "conversation_reply" &&
    generationKind !== "auto_follow_up" &&
    generationKind !== "operational_outbound"
  ) {
    return null;
  }
  return {
    current: row.current,
    reason: nullableText(row.reason),
    generationKind,
    sourceActivityId: nullableText(row.source_activity_id),
    sourceMessageId: nullableText(row.source_message_id),
    providerThreadId: text(row.provider_thread_id),
    followUpSequence:
      row.follow_up_sequence === null || row.follow_up_sequence === undefined
        ? null
        : Number(row.follow_up_sequence),
  };
}

function latestProviderMessageId(
  messages: Array<{ id: string; date: Date }>
): string | null {
  let latestId: string | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  let latestTimestampIsAmbiguous = false;
  for (const message of messages) {
    const id = message.id.trim();
    const timestamp = message.date.getTime();
    if (!id || !Number.isFinite(timestamp)) return null;
    if (timestamp > latestTimestamp) {
      latestId = id;
      latestTimestamp = timestamp;
      latestTimestampIsAmbiguous = false;
    } else if (timestamp === latestTimestamp && id !== latestId) {
      latestTimestampIsAmbiguous = true;
    }
  }
  return latestTimestampIsAmbiguous ? null : latestId;
}

function actorMatchesSchedule(
  params: ScheduleAutoSendInput,
  actor: PhaseCEmailActorContext
): actor is SchedulablePhaseCEmailActorContext {
  return (
    Boolean(params.opportunityId) &&
    Boolean(actor.actorUserId) &&
    Number.isInteger(actor.assignmentVersion) &&
    actor.assignmentVersion >= 0 &&
    Boolean(actor.assignmentEventId) &&
    Boolean(actor.internalThreadId) &&
    actor.companyId === params.companyId &&
    actor.connectionId === params.connectionId &&
    actor.opportunityId === params.opportunityId &&
    actor.providerThreadId === params.threadId
  );
}

function generationMatchesSchedule(
  params: ScheduleAutoSendInput,
  actor: SchedulablePhaseCEmailActorContext
): boolean {
  const generation = params.generation;
  const access = generation.emailAccess;
  const sourceBound =
    generation.kind === "conversation_reply" ||
    generation.kind === "auto_follow_up";
  return (
    access.allowed === true &&
    access.operation === "send" &&
    access.actor.userId === actor.actorUserId &&
    access.actor.companyId === actor.companyId &&
    access.threadId === actor.internalThreadId &&
    access.connectionId === actor.connectionId &&
    access.opportunityId === actor.opportunityId &&
    access.providerThreadId === actor.providerThreadId &&
    access.pipelineScope === "assigned" &&
    access.inboxScope === "assigned" &&
    access.usedLegacyPipelineManage === false &&
    access.usedLegacyInboxViewCompany === false &&
    (!sourceBound ||
      (generation.sourceActivityId.trim().length > 0 &&
        generation.sourceMessageId.trim().length > 0 &&
        params.inReplyTo?.trim() === generation.sourceMessageId.trim())) &&
    (generation.kind !== "auto_follow_up" ||
      (Number.isInteger(generation.followUpSequence) &&
        generation.followUpSequence >= 1 &&
        generation.followUpSequence <= 100)) &&
    (generation.kind === "conversation_reply" ||
      generation.autonomousRoutingAuthority === "phase_c_stale_lead_follow_up")
  );
}

async function rpcRow(
  name: string,
  args: Record<string, unknown>
): Promise<PendingAutoSend | null> {
  const { data, error } = await requireSupabase().rpc(name, args);
  if (error) throw new Error(error.message || `${name} failed`);
  const row = firstRow(data);
  return row ? mapPendingFromDb(row) : null;
}

export const AutoSendService = {
  async isEnabled(
    companyId: string,
    connectionId: string
  ): Promise<{ enabled: boolean; settings: AutoSendSettings | null }> {
    const featureEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "ai_auto_send"
    );
    if (!featureEnabled) return { enabled: false, settings: null };

    const { data } = await requireSupabase()
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .single();
    if (!data?.auto_send_settings) {
      return { enabled: false, settings: null };
    }

    const row = data.auto_send_settings as Record<string, unknown>;
    const settings: AutoSendSettings = {
      enabled: row.enabled === true,
      businessHoursStart:
        text(row.business_hours_start) ||
        DEFAULT_AUTO_SEND_SETTINGS.businessHoursStart,
      businessHoursEnd:
        text(row.business_hours_end) ||
        DEFAULT_AUTO_SEND_SETTINGS.businessHoursEnd,
      timezone: text(row.timezone) || DEFAULT_AUTO_SEND_SETTINGS.timezone,
      delayMinMinutes:
        Number(row.delay_min_minutes) ||
        DEFAULT_AUTO_SEND_SETTINGS.delayMinMinutes,
      delayMaxMinutes:
        Number(row.delay_max_minutes) ||
        DEFAULT_AUTO_SEND_SETTINGS.delayMaxMinutes,
      enabledAt: nullableText(row.enabled_at) ?? undefined,
    };
    return { enabled: settings.enabled, settings };
  },

  async updateSettings(
    companyId: string,
    connectionId: string,
    actorUserId: string,
    settings: Partial<AutoSendSettings>
  ): Promise<void> {
    const supabase = requireSupabase();
    const extended = settings as Record<string, unknown>;
    const patch = {
      ...(settings.enabled !== undefined && { enabled: settings.enabled }),
      ...(settings.businessHoursStart && {
        business_hours_start: settings.businessHoursStart,
      }),
      ...(settings.businessHoursEnd && {
        business_hours_end: settings.businessHoursEnd,
      }),
      ...(settings.timezone && { timezone: settings.timezone }),
      ...(settings.delayMinMinutes !== undefined && {
        delay_min_minutes: settings.delayMinMinutes,
      }),
      ...(settings.delayMaxMinutes !== undefined && {
        delay_max_minutes: settings.delayMaxMinutes,
      }),
      ...(extended.auto_draft_enabled !== undefined && {
        auto_draft_enabled: extended.auto_draft_enabled,
      }),
      ...(extended.category_autonomy !== undefined && {
        category_autonomy: extended.category_autonomy,
      }),
    };

    const { data, error } = await supabase.rpc(
      "update_phase_c_auto_send_settings_as_system",
      {
        p_company_id: companyId,
        p_connection_id: connectionId,
        p_actor_user_id: actorUserId,
        p_settings_patch: patch,
      }
    );
    if (error) throw new Error(error.message);
    if (!data || typeof data !== "object") {
      throw new Error("Auto-send settings update returned invalid data");
    }
  },

  async scheduleAutoSend(
    params: ScheduleAutoSendInput
  ): Promise<ScheduleAutoSendResult> {
    const actor = params.actorContext;
    if (
      !actor ||
      !actorMatchesSchedule(params, actor) ||
      !generationMatchesSchedule(params, actor)
    ) {
      console.warn(
        "[auto-send] canonical actor or generation context missing or mismatched; schedule suppressed"
      );
      return {
        outcome: "unavailable",
        reason: "canonical generation context missing or mismatched",
      };
    }

    const authorizedProfileTypes = PhaseCCategoryAutonomy.profileTypesFor(
      params.category
    );
    if (authorizedProfileTypes.length === 0) {
      console.warn(
        "[auto-send] category has no authorized draft profile; schedule suppressed"
      );
      return {
        outcome: "unavailable",
        reason: "category has no authorized draft profile",
      };
    }

    const generation = params.generation;
    const profileTypeOverride =
      generation.kind === "conversation_reply"
        ? authorizedProfileTypes[0]
        : "client_followup";
    if (!authorizedProfileTypes.includes(profileTypeOverride)) {
      return {
        outcome: "unavailable",
        reason: "message purpose is outside the category calibration",
      };
    }

    const sourceFence = sourceFenceForGeneration(generation);
    const sourceBound = sourceFence.sourceActivityId !== null;
    let toEmails = normalizeAddresses(params.toEmails);
    let ccEmails = normalizeAddresses(params.ccEmails);
    if (!sourceBound && toEmails.length === 0) {
      return { outcome: "unavailable", reason: "recipient missing" };
    }
    const sourceIdempotencyKey = sourceBound
      ? buildPhaseCAutoSendIdempotencyKey({
          companyId: actor.companyId,
          actorUserId: actor.actorUserId,
          assignmentVersion: actor.assignmentVersion,
          assignmentEventId: actor.assignmentEventId,
          connectionId: actor.connectionId,
          opportunityId: actor.opportunityId,
          sourceEmailThreadId: actor.internalThreadId,
          providerThreadId: actor.providerThreadId,
          inReplyTo: params.inReplyTo ?? null,
          generationKind: sourceFence.generationKind,
          sourceActivityId: sourceFence.sourceActivityId,
          followUpSequence: sourceFence.followUpSequence,
        })
      : null;
    const argumentsHash = sourceBound
      ? buildPhaseCAutoSendArgumentsHash(params)
      : null;
    let generationToken: string | null = null;
    const supabase = requireSupabase();
    if (sourceIdempotencyKey) {
      const { data: reservationData, error: reservationError } =
        await supabase.rpc("reserve_phase_c_auto_send_generation_as_system", {
          p_idempotency_key: sourceIdempotencyKey,
          p_arguments_hash: argumentsHash,
          p_company_id: actor.companyId,
          p_actor_user_id: actor.actorUserId,
          p_assignment_version: actor.assignmentVersion,
          p_assignment_event_id: actor.assignmentEventId,
          p_connection_id: actor.connectionId,
          p_opportunity_id: actor.opportunityId,
          p_source_email_thread_id: actor.internalThreadId,
          p_reply_provider_thread_id: actor.providerThreadId,
          p_generation_kind: sourceFence.generationKind,
          p_source_activity_id: sourceFence.sourceActivityId,
          p_source_message_id: sourceFence.sourceMessageId,
          p_follow_up_sequence: sourceFence.followUpSequence,
        });
      if (reservationError) {
        console.error(
          "[auto-send] source generation reservation failed; schedule suppressed",
          reservationError
        );
        return {
          outcome: "unavailable",
          reason:
            reservationError.message || "source generation reservation failed",
        };
      }
      const reservation = mapGenerationReservation(reservationData);
      if (!reservation) {
        return {
          outcome: "unavailable",
          reason: "source generation reservation returned invalid data",
        };
      }
      if (reservation.disposition === "scheduled") {
        return reservation.pending
          ? { outcome: "scheduled", pending: reservation.pending }
          : {
              outcome: "unavailable",
              reason: "scheduled reservation is missing its queue row",
            };
      }
      if (reservation.disposition === "in_progress") {
        return {
          outcome: "unavailable",
          reason: "source generation already in progress",
        };
      }
      if (reservation.disposition === "no_reply_warranted") {
        return {
          outcome: "no_reply_warranted",
          reason: reservation.reason ?? undefined,
        };
      }
      if (reservation.disposition === "held_for_review") {
        return {
          outcome: "held_for_review",
          reason: reservation.reason ?? undefined,
        };
      }
      if (!reservation.generationToken || reservation.toEmails.length === 0) {
        return {
          outcome: "unavailable",
          reason: "source generation reservation is incomplete",
        };
      }
      generationToken = reservation.generationToken;
      toEmails = reservation.toEmails;
      ccEmails = reservation.ccEmails;
    }

    const draftPurpose =
      generation.kind === "conversation_reply"
        ? ({ kind: "conversation_reply" } as const)
        : ({
            kind: "operational_outbound",
            ...(generation.kind === "operational_outbound" &&
            generation.verifiedSchedule
              ? { verifiedContext: { schedule: true } }
              : {}),
          } as const);
    let draftResult: Awaited<ReturnType<typeof AIDraftService.generateDraft>>;
    try {
      draftResult = await AIDraftService.generateDraft({
        companyId: actor.companyId,
        userId: actor.actorUserId,
        connectionId: actor.connectionId,
        opportunityId: actor.opportunityId,
        threadId: actor.providerThreadId,
        profileTypeOverride,
        autonomous: true,
        origin: "phase_c",
        phaseCActorContext: actor,
        emailAccess: generation.emailAccess,
        ...(generation.kind !== "conversation_reply"
          ? {
              autonomousRoutingAuthority: generation.autonomousRoutingAuthority,
            }
          : {}),
        ...(generation.kind === "conversation_reply"
          ? { sourceActivityId: generation.sourceActivityId }
          : { userInstruction: generation.instruction }),
        draftPurpose,
        signatureWillBeAppended: true,
      });
    } catch (error) {
      await resolveGenerationReservation({
        idempotencyKey: sourceIdempotencyKey,
        generationToken,
        argumentsHash,
        disposition: "failed",
        reason: errorMessage(error),
      });
      return { outcome: "unavailable", reason: errorMessage(error) };
    }
    if (!draftResult.available || !draftResult.draft) {
      if (draftResult.noReplyWarranted) {
        await resolveGenerationReservation({
          idempotencyKey: sourceIdempotencyKey,
          generationToken,
          argumentsHash,
          disposition: "no_reply_warranted",
          reason: draftResult.reason,
        });
        return {
          outcome: "no_reply_warranted",
          reason: draftResult.reason,
        };
      }
      if (draftResult.heldForReview) {
        await resolveGenerationReservation({
          idempotencyKey: sourceIdempotencyKey,
          generationToken,
          argumentsHash,
          disposition: "held_for_review",
          reason: draftResult.reason,
        });
        return { outcome: "held_for_review", reason: draftResult.reason };
      }
      await resolveGenerationReservation({
        idempotencyKey: sourceIdempotencyKey,
        generationToken,
        argumentsHash,
        disposition: "failed",
        reason: draftResult.reason,
      });
      const log = draftResult.heldForReview ? console.warn : console.error;
      log(
        "[auto-send] draft unavailable; schedule suppressed",
        draftResult.reason
      );
      return { outcome: "unavailable", reason: draftResult.reason };
    }
    if (!draftResult.draftHistoryId) {
      await resolveGenerationReservation({
        idempotencyKey: sourceIdempotencyKey,
        generationToken,
        argumentsHash,
        disposition: "failed",
        reason: "draft history fence missing",
      });
      console.error(
        "[auto-send] draft history fence missing; schedule suppressed"
      );
      return {
        outcome: "unavailable",
        reason: "draft history fence missing",
      };
    }

    // A scheduling reply is NEVER auto-sent. Verified schedule context lets the
    // agent DRAFT one, but any proposed window still needs a human to stand
    // behind it — a booking the operator never agreed to is worse than a slow
    // reply. The reservation resolves terminally so this source is not retried
    // into the send queue; the draft itself is placed by the auto-draft path.
    if (draftResult.responseMode === "schedule") {
      await resolveGenerationReservation({
        idempotencyKey: sourceIdempotencyKey,
        generationToken,
        argumentsHash,
        disposition: "held_for_review",
        reason: "schedule replies are never auto-sent",
      });
      return {
        outcome: "draft_only",
        reason: "schedule replies are never auto-sent",
      };
    }

    const profileType = draftResult.profileType?.trim() || "general";
    if (!authorizedProfileTypes.includes(profileType)) {
      await resolveGenerationReservation({
        idempotencyKey: sourceIdempotencyKey,
        generationToken,
        argumentsHash,
        disposition: "failed",
        reason: "generated profile is outside category calibration",
      });
      console.warn(
        "[auto-send] generated profile is outside the category calibration; schedule suppressed"
      );
      return {
        outcome: "unavailable",
        reason: "generated profile is outside category calibration",
      };
    }
    const authoredBody = markdownToEmailHtml(draftResult.draft);
    const connection = await EmailService.getConnection(actor.connectionId);
    if (
      !connection ||
      connection.id !== actor.connectionId ||
      connection.companyId !== actor.companyId ||
      connection.status !== "active"
    ) {
      await resolveGenerationReservation({
        idempotencyKey: sourceIdempotencyKey,
        generationToken,
        argumentsHash,
        disposition: "failed",
        reason: "canonical mailbox unavailable",
      });
      console.error(
        "[auto-send] canonical mailbox unavailable; schedule suppressed"
      );
      return {
        outcome: "unavailable",
        reason: "canonical mailbox unavailable",
      };
    }
    const signature = await resolveEmailSignatureForMessage({
      supabase,
      connection,
      userId: actor.actorUserId,
      refreshProviderIfMissing: true,
    });
    if (!signature) {
      await resolveGenerationReservation({
        idempotencyKey: sourceIdempotencyKey,
        generationToken,
        argumentsHash,
        disposition: "failed",
        reason: "signature unavailable",
      });
      return { outcome: "unavailable", reason: "signature unavailable" };
    }
    const renderedBody = renderEmailBodyWithSignature({
      body: authoredBody,
      contentType: "html",
      signature,
    });
    const renderedBodyHash = createHash("sha256")
      .update(renderedBody)
      .digest("hex");
    const delay = randomDelay(
      params.settings.delayMinMinutes,
      params.settings.delayMaxMinutes
    );
    const scheduledAt = adjustToBusinessHours(
      new Date(),
      delay,
      params.settings
    );
    const idempotencyKey =
      sourceIdempotencyKey ??
      buildPhaseCAutoSendIdempotencyKey({
        companyId: actor.companyId,
        actorUserId: actor.actorUserId,
        assignmentVersion: actor.assignmentVersion,
        assignmentEventId: actor.assignmentEventId,
        connectionId: actor.connectionId,
        opportunityId: actor.opportunityId,
        sourceEmailThreadId: actor.internalThreadId,
        providerThreadId: actor.providerThreadId,
        inReplyTo: params.inReplyTo ?? null,
        generationKind: sourceFence.generationKind,
        sourceActivityId: sourceFence.sourceActivityId,
        followUpSequence: sourceFence.followUpSequence,
        draftHistoryId: draftResult.draftHistoryId,
      });

    const { data, error } = await supabase.rpc(
      "schedule_phase_c_auto_send_fenced",
      {
        p_idempotency_key: idempotencyKey,
        p_company_id: actor.companyId,
        p_actor_user_id: actor.actorUserId,
        p_assignment_version: actor.assignmentVersion,
        p_assignment_event_id: actor.assignmentEventId,
        p_connection_id: actor.connectionId,
        p_opportunity_id: actor.opportunityId,
        p_source_email_thread_id: actor.internalThreadId,
        p_reply_provider_thread_id: actor.providerThreadId,
        p_in_reply_to: params.inReplyTo ?? null,
        p_to_emails: toEmails,
        p_cc_emails: ccEmails,
        p_subject: params.subject,
        p_draft_text: draftResult.draft,
        p_authored_body: authoredBody,
        p_rendered_body: renderedBody,
        p_content_type: "html",
        p_draft_history_id: draftResult.draftHistoryId,
        p_profile_type_snapshot: profileType,
        p_learning_authority: "autonomous",
        p_signature_id: signature.recordId,
        p_signature_content_hash: signature.hash,
        p_rendered_body_hash: renderedBodyHash,
        p_scheduled_send_at: scheduledAt.toISOString(),
        p_generation_kind: sourceFence.generationKind,
        p_source_activity_id: sourceFence.sourceActivityId,
        p_source_message_id: sourceFence.sourceMessageId,
        p_follow_up_sequence: sourceFence.followUpSequence,
        p_generation_token: generationToken,
        p_arguments_hash: argumentsHash,
      }
    );
    if (error) {
      await resolveGenerationReservation({
        idempotencyKey: sourceIdempotencyKey,
        generationToken,
        argumentsHash,
        disposition: "failed",
        reason: error.message || "schedule RPC rejected source record",
      });
      console.error("[auto-send] schedule RPC rejected source record", error);
      return {
        outcome: "unavailable",
        reason: error.message || "schedule RPC rejected source record",
      };
    }
    const row = firstRow(data);
    if (row) return { outcome: "scheduled", pending: mapPendingFromDb(row) };
    await resolveGenerationReservation({
      idempotencyKey: sourceIdempotencyKey,
      generationToken,
      argumentsHash,
      disposition: "failed",
      reason: "schedule RPC returned no row",
    });
    return { outcome: "unavailable", reason: "schedule RPC returned no row" };
  },

  async cancelAutoSend(
    id: string,
    companyId: string,
    options: CancelAutoSendOptions = {}
  ): Promise<boolean> {
    const row = await rpcRow("cancel_phase_c_auto_send", {
      p_id: id,
      p_company_id: companyId,
      p_lease_token: options.leaseToken ?? null,
      p_reason: options.reason ?? "operator cancelled",
      p_actor_user_id: options.actorUserId ?? null,
    });
    return row?.status === "cancelled";
  },

  async getPendingSends(companyId: string): Promise<PendingAutoSend[]> {
    const { data, error } = await requireSupabase()
      .from("pending_auto_sends")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("scheduled_send_at", { ascending: true });
    if (error)
      throw new Error(error.message || "pending auto-send lookup failed");
    return (data ?? []).map((row) =>
      mapPendingFromDb(row as Record<string, unknown>)
    );
  },

  async claimPendingSends(
    options: {
      limit?: number;
      leaseSeconds?: number;
    } = {}
  ): Promise<ClaimedAutoSendSource[]> {
    const { data, error } = await requireSupabase().rpc(
      "claim_phase_c_auto_sends",
      {
        p_limit: options.limit ?? 10,
        p_lease_seconds: options.leaseSeconds ?? 300,
      }
    );
    if (error) {
      throw new CronDatabaseOperationError(
        error.message || "claim_phase_c_auto_sends failed",
        { cause: error }
      );
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.map((row) => mapClaimedFromDb(row as Record<string, unknown>));
  },

  async completeClaim(
    input: CompleteAutoSendClaimInput
  ): Promise<PendingAutoSend | null> {
    return rpcRow("complete_phase_c_auto_send", {
      p_id: input.id,
      p_company_id: input.companyId,
      p_lease_token: input.leaseToken,
      p_send_intent_id: input.sendIntentId,
    });
  },

  async retryClaim(
    input: RetryAutoSendClaimInput
  ): Promise<PendingAutoSend | null> {
    return rpcRow("retry_phase_c_auto_send", {
      p_id: input.id,
      p_company_id: input.companyId,
      p_lease_token: input.leaseToken,
      p_error: input.error,
      p_retry_at: iso(input.retryAt ?? new Date(Date.now() + 5 * 60 * 1000)),
    });
  },

  async processPendingSends(): Promise<AutoSendClaimBatch> {
    const claimed = await this.claimPendingSends();
    const supabase = requireSupabase();
    const intentStore = new EmailSendIntentService(supabase);
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const source of claimed) {
      try {
        if (!(await isCompanySubscriptionActive(source.companyId))) {
          throw new Error("PHASE_C_AUTO_SEND_SUBSCRIPTION_INACTIVE");
        }
        const connection = await EmailService.getConnection(
          source.connectionId
        );
        if (
          !connection ||
          connection.id !== source.connectionId ||
          connection.companyId !== source.companyId ||
          connection.status !== "active" ||
          connection.syncEnabled === false
        ) {
          throw new Error("PHASE_C_AUTO_SEND_CONNECTION_INVALID");
        }

        const provider = EmailService.getProvider(connection);
        const cancelForStaleSource = async (): Promise<never> => {
          const cancelled = await this.cancelAutoSend(
            source.id,
            source.companyId,
            {
              leaseToken: source.leaseToken,
              reason: "PHASE_C_AUTO_SEND_SOURCE_STALE",
            }
          );
          if (!cancelled) {
            throw new Error("PHASE_C_AUTO_SEND_SOURCE_CANCEL_LEASE_INVALID");
          }
          throw new PhaseCAutoSendSourceCancelledError();
        };
        const delivery = new EmailSendDeliveryService({
          intentStore,
          provider,
          reconcile: (intent, providerLockCheckpoint) =>
            reconcileEmailSend({
              supabase,
              intent,
              connection,
              provider,
              providerLockCheckpoint,
            }),
          runWithMailboxLease: ({ connectionId, run }) =>
            runWithEmailConnectionSyncLock({
              connectionId,
              context: "phase-c-auto-send-delivery",
              client: supabase,
              run: async (checkpoint) => {
                await checkpoint();
                const { data: fenceData, error: fenceError } =
                  await supabase.rpc(
                    "validate_phase_c_auto_send_source_for_delivery",
                    {
                      p_id: source.id,
                      p_company_id: source.companyId,
                      p_lease_token: source.leaseToken,
                    }
                  );
                if (fenceError) {
                  throw new Error(
                    fenceError.message ||
                      "PHASE_C_AUTO_SEND_SOURCE_VALIDATION_FAILED"
                  );
                }
                const fence = mapDeliveryFence(fenceData);
                if (!fence) {
                  throw new Error("PHASE_C_AUTO_SEND_SOURCE_FENCE_INVALID");
                }
                if (!fence.current) {
                  return cancelForStaleSource();
                }

                if (
                  fence.generationKind === "conversation_reply" ||
                  fence.generationKind === "auto_follow_up"
                ) {
                  if (
                    !fence.sourceMessageId ||
                    fence.providerThreadId !== source.replyProviderThreadId
                  ) {
                    return cancelForStaleSource();
                  }
                  await checkpoint();
                  const providerMessages = await provider.fetchThread(
                    fence.providerThreadId
                  );
                  await checkpoint();
                  if (
                    latestProviderMessageId(providerMessages) !==
                    fence.sourceMessageId
                  ) {
                    return cancelForStaleSource();
                  }
                }

                return run(checkpoint);
              },
            }),
        });
        const outcome = await delivery.execute({
          idempotencyKey: source.idempotencyKey,
          companyId: source.companyId,
          actorUserId: source.actorUserId,
          initiatedBy: "phase_c_auto_send",
          connectionId: source.connectionId,
          opportunityId: source.opportunityId,
          sourceEmailThreadId: source.sourceEmailThreadId,
          replyProviderThreadId: source.replyProviderThreadId,
          inReplyTo: source.inReplyTo,
          senderSwitched: false,
          toEmails: source.toEmails,
          ccEmails: source.ccEmails,
          subject: source.subject,
          authoredBody: source.authoredBody,
          renderedBody: source.renderedBody,
          contentType: source.contentType,
          draftHistoryId: source.draftHistoryId,
          followUpDraftId: null,
          learningAuthority: "autonomous",
          signatureId: source.signatureId,
          signatureContentHash: source.signatureContentHash,
          renderedBodyHash: source.renderedBodyHash,
          pendingAutoSendId: source.id,
          pendingAutoSendLeaseToken: source.leaseToken,
        });

        if (outcome.state === "reconciled") {
          const completed = await this.completeClaim({
            id: source.id,
            companyId: source.companyId,
            leaseToken: source.leaseToken,
            sendIntentId: outcome.intentId,
          });
          if (!completed || completed.status !== "sent") {
            failed += 1;
            errors.push(
              `${source.id}: PHASE_C_AUTO_SEND_COMPLETION_LEASE_INVALID`
            );
            continue;
          }
          sent += 1;
          continue;
        }

        const deliveryError =
          outcome.error ??
          (outcome.state === "rejected"
            ? "EMAIL_SEND_PROVIDER_REJECTED"
            : outcome.state === "delivery_unknown"
              ? "EMAIL_SEND_DELIVERY_UNKNOWN"
              : "EMAIL_SEND_RECONCILIATION_PENDING");
        const retried = await this.retryClaim({
          id: source.id,
          companyId: source.companyId,
          leaseToken: source.leaseToken,
          error: deliveryError,
        });
        failed += 1;
        errors.push(
          retried
            ? `${source.id}: ${deliveryError}`
            : `${source.id}: PHASE_C_AUTO_SEND_RETRY_LEASE_INVALID`
        );
      } catch (error) {
        if (error instanceof PhaseCAutoSendSourceCancelledError) {
          continue;
        }
        const deliveryError = errorMessage(error);
        try {
          const retried = await this.retryClaim({
            id: source.id,
            companyId: source.companyId,
            leaseToken: source.leaseToken,
            error: deliveryError,
          });
          errors.push(
            retried
              ? `${source.id}: ${deliveryError}`
              : `${source.id}: PHASE_C_AUTO_SEND_RETRY_LEASE_INVALID`
          );
        } catch (retryError) {
          errors.push(
            `${source.id}: ${deliveryError}; queue retry failed: ${errorMessage(retryError)}`
          );
        }
        failed += 1;
      }
    }

    return { sent, failed, errors, claimed };
  },
};
