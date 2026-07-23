import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_FOLLOW_UP_TEMPLATE_BODY,
  DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
} from "@/lib/email/opportunity-lifecycle-evaluator";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import type { EmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { getSubscriptionInfo } from "@/lib/subscription";
import {
  SubscriptionPlan,
  SubscriptionStatus,
  type Company,
} from "@/lib/types/models";
import type { EmailConnection } from "@/lib/types/email-connection";
import { extractEmailAddress } from "@/lib/utils/email-parsing";

import { runWithEmailConnectionSyncLock } from "./email-connection-sync-lock";
import { EmailSendDeliveryService } from "./email-send-delivery-service";
import { EmailService } from "./email-service";
import type { EmailProviderInterface, NormalizedEmail } from "./email-provider";
import {
  EmailSendIntentService,
  type EmailSendIntent,
  type PrepareEmailSendIntentInput,
} from "./email-send-intent-service";
import { reconcileEmailSend } from "./email-send-reconciliation-service";
import { renderEmailBodyWithSignature } from "./email-signature-service";
import { resolveEmailSignatureForMessage } from "@/lib/email/email-signature-runtime";
import { EmailThreadService } from "./email-thread-service";
import { OpportunityLifecycleService } from "./opportunity-lifecycle-service";

const STOCK_FOLLOW_UP_STAGES = new Set(["quoted", "follow_up", "negotiation"]);
const RATE_LIMIT_PER_HOUR = 100;

type CompanySubscriptionFields = Pick<
  Company,
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "trialEndDate"
  | "seatedEmployeeIds"
  | "adminIds"
  | "maxSeats"
>;

export interface CanonicalLeadFollowUpThread {
  id: string;
  connectionId: string;
  providerThreadId: string;
  subject: string;
  lastMessageAt: string;
}

export interface LeadFollowUpThreadLink {
  providerThreadId: string;
  connectionId: string | null;
}

export interface ProviderFollowUpMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  date: Date;
}

export interface ProviderFollowUpContext {
  inReplyTo: string;
  providerThreadId: string;
  subject: string;
  recipientEmail: string;
  latestMessage: ProviderFollowUpMessage;
}

export interface ProviderFollowUpThreadSnapshot {
  providerThreadId: string;
  messages: ProviderFollowUpMessage[];
}

export interface LeadFollowUpRouteResult {
  status: number;
  body: Record<string, unknown>;
}

interface LeadFollowUpErrorBody extends Record<string, unknown> {
  error?: never;
}

export class LeadFollowUpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: LeadFollowUpErrorBody = {}
  ) {
    super(code);
    this.name = "LeadFollowUpError";
  }
}

function normalizedText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedEmail(value: string): string {
  return extractEmailAddress(value).trim().toLowerCase();
}

function dateMillis(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function isStockFollowUpStage(value: unknown): boolean {
  const stage = normalizedText(value)?.toLowerCase();
  return Boolean(stage && STOCK_FOLLOW_UP_STAGES.has(stage));
}

export function selectCanonicalLeadFollowUpThread(
  rows: CanonicalLeadFollowUpThread[]
): CanonicalLeadFollowUpThread {
  if (rows.length === 0) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_REQUIRED", 409);
  }
  const sorted = [...rows].sort(
    (a, b) => dateMillis(b.lastMessageAt) - dateMillis(a.lastMessageAt)
  );
  const latest = sorted[0];
  const latestAt = dateMillis(latest.lastMessageAt);
  const equallyCurrent = sorted.filter(
    (row) =>
      dateMillis(row.lastMessageAt) === latestAt &&
      (row.providerThreadId !== latest.providerThreadId ||
        row.connectionId !== latest.connectionId)
  );
  if (equallyCurrent.length > 0) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_AMBIGUOUS", 409);
  }
  return latest;
}

export function resolveLeadFollowUpThreadBindings(input: {
  links: LeadFollowUpThreadLink[];
  threads: CanonicalLeadFollowUpThread[];
  expectedConnectionId?: string;
}): CanonicalLeadFollowUpThread[] {
  if (input.links.length === 0) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_REQUIRED", 409);
  }

  const resolved = new Map<string, CanonicalLeadFollowUpThread>();
  for (const link of input.links) {
    const providerThreadId = normalizedText(link.providerThreadId);
    if (!providerThreadId) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_INVALID", 409);
    }
    const matches = input.threads.filter(
      (thread) =>
        thread.providerThreadId === providerThreadId &&
        (!link.connectionId || thread.connectionId === link.connectionId)
    );
    if (matches.length !== 1) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_AMBIGUOUS", 409);
    }
    const match = matches[0];
    resolved.set(`${match.connectionId}:${match.providerThreadId}`, match);
  }

  const bindings = Array.from(resolved.values());
  if (bindings.length === 0) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_REQUIRED", 409);
  }
  if (input.expectedConnectionId) {
    const connectionIds = new Set(
      bindings.map((binding) => binding.connectionId)
    );
    if (
      connectionIds.size !== 1 ||
      !connectionIds.has(input.expectedConnectionId)
    ) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_MAILBOX_AMBIGUOUS", 409);
    }
  }
  return bindings;
}

export function resolveProviderFollowUpContext(input: {
  connectionEmail: string;
  senderEmails?: string[];
  recipientEmail: string;
  messages: ProviderFollowUpMessage[];
}): ProviderFollowUpContext {
  if (input.messages.length === 0) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_EMPTY", 409);
  }
  const senderEmails = new Set(
    [input.connectionEmail, ...(input.senderEmails ?? [])]
      .map(normalizedEmail)
      .filter(Boolean)
  );
  const recipientEmail = normalizedEmail(input.recipientEmail);
  const messages = [...input.messages].sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  );
  const latestMessage = messages[0];
  const latestSender = normalizedEmail(latestMessage.from);
  if (!senderEmails.has(latestSender)) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_RESPONSE_REQUIRED", 409);
  }

  const participants = new Set<string>();
  for (const message of messages) {
    participants.add(normalizedEmail(message.from));
    for (const address of [...message.to, ...message.cc]) {
      participants.add(normalizedEmail(address));
    }
  }
  if (!recipientEmail || !participants.has(recipientEmail)) {
    throw new LeadFollowUpError(
      "LEAD_FOLLOW_UP_RECIPIENT_THREAD_MISMATCH",
      409
    );
  }
  const providerThreadId = normalizedText(latestMessage.threadId);
  if (!providerThreadId) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_INVALID", 409);
  }
  return {
    inReplyTo: latestMessage.id,
    providerThreadId,
    subject:
      normalizedText(latestMessage.subject) ??
      DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
    recipientEmail,
    latestMessage,
  };
}

export function assertProviderLeadFollowUpThreadsFresh(input: {
  connectionEmail: string;
  senderEmails?: string[];
  recipientEmail: string;
  selectedProviderThreadId: string;
  selectedInReplyTo: string;
  selectedSubject: string;
  snapshots: ProviderFollowUpThreadSnapshot[];
}): ProviderFollowUpContext {
  const snapshots = new Map<string, ProviderFollowUpThreadSnapshot>();
  for (const snapshot of input.snapshots) {
    const providerThreadId = normalizedText(snapshot.providerThreadId);
    if (!providerThreadId || snapshots.has(providerThreadId)) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_AMBIGUOUS", 409);
    }
    if (
      snapshot.messages.length === 0 ||
      snapshot.messages.some(
        (message) => normalizedText(message.threadId) !== providerThreadId
      )
    ) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_INVALID", 409);
    }
    snapshots.set(providerThreadId, snapshot);
  }

  const selected = snapshots.get(input.selectedProviderThreadId);
  if (!selected) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_INVALID", 409);
  }
  const current = resolveProviderFollowUpContext({
    connectionEmail: input.connectionEmail,
    senderEmails: input.senderEmails,
    recipientEmail: input.recipientEmail,
    messages: selected.messages,
  });
  if (
    current.providerThreadId !== input.selectedProviderThreadId ||
    current.inReplyTo !== input.selectedInReplyTo ||
    current.recipientEmail !== normalizedEmail(input.recipientEmail) ||
    current.subject !== input.selectedSubject
  ) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_CONVERSATION_CHANGED", 409);
  }

  const selectedAt = current.latestMessage.date.getTime();
  if (!Number.isFinite(selectedAt)) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_INVALID", 409);
  }
  for (const [providerThreadId, snapshot] of snapshots) {
    if (providerThreadId === input.selectedProviderThreadId) continue;
    const latestAt = Math.max(
      ...snapshot.messages.map((message) => message.date.getTime())
    );
    if (!Number.isFinite(latestAt)) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_INVALID", 409);
    }
    if (latestAt >= selectedAt) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_CONVERSATION_CHANGED", 409);
    }
  }
  return current;
}

function firstName(value: string | null): string {
  return value?.trim().split(/\s+/)[0] || "there";
}

export function renderLeadFollowUpTemplate(
  template: string,
  input: {
    contactName: string | null;
    opportunityTitle: string | null;
    companyName: string | null;
  }
): string {
  let source = template;
  if (!normalizedText(input.companyName)) {
    source = source.replace(/\s+for\s+{{\s*company_name\s*}}/gi, "");
  }
  const replacements: Record<string, string> = {
    first_name: firstName(input.contactName),
    opportunity_title: normalizedText(input.opportunityTitle) ?? "",
    company_name: normalizedText(input.companyName) ?? "",
  };
  return source
    .replace(
      /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
      (_match, token: string) => replacements[token.toLowerCase()] ?? ""
    )
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function resolveLeadFollowUpDraftContent(
  draft: {
    subject: string;
    originalBody: string;
    currentBody: string | null;
  },
  desired: { subject: string; body: string }
): {
  subject: string;
  body: string;
  shouldRefreshDraft: boolean;
} {
  const originalBody = normalizedText(draft.originalBody) ?? desired.body;
  const currentBody = normalizedText(draft.currentBody) ?? originalBody;
  const untouched = currentBody === originalBody;
  return {
    // A provider-backed reply must retain the conversation subject.
    subject: desired.subject,
    // Preserve deliberate operator edits; refresh untouched generated drafts
    // when the company's stock template has changed. A provider reply always
    // refreshes a stale subject even when the body was deliberately edited.
    body: untouched ? desired.body : currentBody,
    shouldRefreshDraft:
      normalizedText(draft.subject) !== desired.subject ||
      (untouched && currentBody !== desired.body),
  };
}

export function buildLeadFollowUpDraftRefreshPatch(
  draft: {
    subject: string;
    originalBody: string;
    currentBody: string | null;
  },
  desired: { subject: string; body: string },
  updatedAt: string
): Record<string, unknown> | null {
  const content = resolveLeadFollowUpDraftContent(draft, desired);
  if (!content.shouldRefreshDraft) return null;

  const originalBody = normalizedText(draft.originalBody) ?? desired.body;
  const currentBody = normalizedText(draft.currentBody) ?? originalBody;
  const patch: Record<string, unknown> = {
    subject: content.subject,
    updated_at: updatedAt,
  };
  if (currentBody === originalBody) {
    patch.original_body = content.body;
    patch.current_body = content.body;
  }
  return patch;
}

export function assertFreshLeadFollowUpIsDue(
  opportunity: Record<string, unknown>,
  timezone: string,
  now = new Date()
): void {
  const dueAt = normalizedText(opportunity.next_follow_up_at);
  const dueMillis = dueAt ? new Date(dueAt).getTime() : Number.NaN;
  if (!Number.isFinite(dueMillis)) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_NOT_DUE", 409);
  }
  const calendarDay = (value: Date): string => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(value);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((candidate) => candidate.type === type)?.value ?? "";
      const key = `${part("year")}-${part("month")}-${part("day")}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("invalid date");
      return key;
    } catch {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_TIMEZONE_INVALID", 409);
    }
  };
  if (calendarDay(new Date(dueMillis)) > calendarDay(now)) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_NOT_DUE", 409);
  }
}

export function prepareInputFromExistingLeadFollowUpIntent(
  intent: EmailSendIntent
): PrepareEmailSendIntentInput {
  if (
    intent.initiatedBy !== "operator" ||
    !intent.sourceEmailThreadId ||
    !intent.replyProviderThreadId ||
    !intent.inReplyTo ||
    !intent.followUpDraftId
  ) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_IDEMPOTENCY_CONFLICT", 409);
  }
  return {
    idempotencyKey: intent.idempotencyKey,
    companyId: intent.companyId,
    actorUserId: intent.actorUserId,
    initiatedBy: intent.initiatedBy,
    connectionId: intent.connectionId,
    opportunityId: intent.opportunityId,
    sourceEmailThreadId: intent.sourceEmailThreadId,
    replyProviderThreadId: intent.replyProviderThreadId,
    inReplyTo: intent.inReplyTo,
    senderSwitched: intent.senderSwitched,
    toEmails: intent.toEmails,
    ccEmails: intent.ccEmails,
    subject: intent.subject,
    authoredBody: intent.authoredBody,
    renderedBody: intent.renderedBody,
    contentType: intent.contentType,
    draftHistoryId: intent.draftHistoryId,
    followUpDraftId: intent.followUpDraftId,
    learningAuthority: intent.learningAuthority,
    signatureId: intent.signatureId,
    signatureContentHash: intent.signatureContentHash,
    renderedBodyHash: intent.renderedBodyHash,
    pendingAutoSendId: intent.pendingAutoSendId,
    pendingAutoSendLeaseToken: intent.pendingAutoSendLeaseToken,
  };
}

export function normalizeLeadFollowUpDeliveryError(
  error: unknown
): LeadFollowUpError | null {
  const reason = error instanceof Error ? error.message : String(error ?? "");
  if (
    reason.includes("EMAIL_SEND_TEMPLATE_FOLLOW_UP_AUTHORIZATION_STALE") ||
    reason.includes("EMAIL_SEND_FOLLOW_UP_DRAFT_INVALID") ||
    reason.includes("EMAIL_SEND_FOLLOW_UP_DRAFT_SOURCE_INVALID") ||
    reason.includes("EMAIL_SEND_FOLLOW_UP_DRAFT_SOURCE_EVENT_INVALID") ||
    reason.includes("EMAIL_SEND_FOLLOW_UP_DRAFT_REPLY_MESSAGE_CONFLICT") ||
    reason.includes("EMAIL_SEND_REPLY_MESSAGE_INVALID") ||
    reason.includes("EMAIL_SEND_REPLY_MAILBOX_CONFLICT") ||
    reason.includes("EMAIL_SEND_SOURCE_THREAD_INVALID") ||
    reason.includes("EMAIL_SEND_SOURCE_THREAD_LEAD_CONFLICT") ||
    reason.includes("EMAIL_SEND_OPPORTUNITY_INVALID") ||
    reason.includes("EMAIL_SEND_CONNECTION_INVALID") ||
    reason.includes("EMAIL_SEND_AUTHORIZATION_STALE")
  ) {
    return new LeadFollowUpError("LEAD_FOLLOW_UP_UNAVAILABLE", 409, {
      reason,
      delivered: false,
      definitiveNoDelivery: true,
    });
  }
  if (
    reason.includes("EMAIL_SEND_FORBIDDEN") ||
    reason.includes("EMAIL_SEND_PERSONAL_MAILBOX_FORBIDDEN") ||
    reason.includes("EMAIL_SEND_ACCESS_DENIED") ||
    reason.includes("EMAIL_SEND_ACTOR_INVALID")
  ) {
    return new LeadFollowUpError("LEAD_FOLLOW_UP_FORBIDDEN", 403, {
      reason,
      delivered: false,
      definitiveNoDelivery: true,
    });
  }
  if (reason.includes("EMAIL_SEND_SIGNATURE_INVALID")) {
    return new LeadFollowUpError("EMAIL_SIGNATURE_REQUIRED", 409);
  }
  if (reason.includes("EMAIL_SEND_IDEMPOTENCY_CONFLICT")) {
    return new LeadFollowUpError("LEAD_FOLLOW_UP_IDEMPOTENCY_CONFLICT", 409);
  }
  return null;
}

function mapSubscriptionRow(
  row: Record<string, unknown>
): CompanySubscriptionFields {
  return {
    subscriptionPlan: (row.subscription_plan as SubscriptionPlan) ?? null,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    trialEndDate: row.trial_end_date
      ? new Date(row.trial_end_date as string)
      : null,
    seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? [],
    adminIds: (row.admin_ids as string[]) ?? [],
    maxSeats: (row.max_seats as number) ?? 10,
  };
}

async function assertLeadFollowUpPipelineAccess(
  supabase: SupabaseClient,
  actor: EmailRouteActor,
  opportunityId: string
): Promise<void> {
  const { data, error } = await supabase.rpc(
    "authorize_opportunity_action_as_system",
    {
      p_actor_user_id: actor.userId,
      p_opportunity_id: opportunityId,
      p_action: "edit",
    }
  );
  if (error) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_AUTHORIZATION_FAILED", 500);
  }
  if (data !== true) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_FORBIDDEN", 403);
  }
}

async function fetchCanonicalOpportunity(
  supabase: SupabaseClient,
  companyId: string,
  opportunityId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_LOOKUP_FAILED", 500);
  }
  if (!data) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_OPPORTUNITY_NOT_FOUND", 404);
  }
  return data as Record<string, unknown>;
}

export function resultFromSettledLeadFollowUpIntent(
  intent: EmailSendIntent
): LeadFollowUpRouteResult | null {
  if (intent.status === "reconciled") {
    if (
      !intent.providerMessageId ||
      !intent.acceptedProviderThreadId ||
      !intent.providerAcceptedAt ||
      !intent.followUpOutcomeAppliedAt ||
      !intent.followUpNotificationId
    ) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_RECEIPT_INVALID", 500);
    }
    return {
      status: 200,
      body: {
        ok: true,
        delivered: true,
        reconciliationPending: false,
        deliveryUnknown: false,
        intentId: intent.id,
        messageId: intent.providerMessageId,
        threadId: intent.acceptedProviderThreadId,
        sentAt: intent.providerAcceptedAt,
        comebackAt: intent.followUpComebackAt,
        outcomeAppliedAt: intent.followUpOutcomeAppliedAt,
        notificationId: intent.followUpNotificationId,
        opportunityId: intent.opportunityId,
      },
    };
  }
  if (intent.status === "provider_rejected") {
    const rejectionCode = normalizedText(intent.lastError);
    if (rejectionCode?.startsWith("LEAD_FOLLOW_UP_")) {
      return {
        status: 409,
        body: {
          error: rejectionCode,
          delivered: false,
          definitiveNoDelivery: true,
          intentId: intent.id,
        },
      };
    }
    return {
      status: 502,
      body: {
        error: "LEAD_FOLLOW_UP_PROVIDER_REJECTED",
        delivered: false,
        definitiveNoDelivery: true,
        intentId: intent.id,
        reason: intent.lastError,
      },
    };
  }
  if (
    intent.status === "sending" ||
    intent.status === "delivery_unknown" ||
    intent.status === "reconciling"
  ) {
    return {
      status: 202,
      body: {
        ok: Boolean(intent.providerMessageId),
        delivered: Boolean(intent.providerMessageId),
        reconciliationPending: Boolean(intent.providerMessageId),
        deliveryUnknown: intent.status === "delivery_unknown",
        intentId: intent.id,
        messageId: intent.providerMessageId,
        threadId: intent.acceptedProviderThreadId,
        reason: intent.lastError,
      },
    };
  }
  return null;
}

export async function refetchReconciledLeadFollowUpIntent(input: {
  intentStore: Pick<EmailSendIntentService, "findByIdempotencyKey">;
  companyId: string;
  idempotencyKey: string;
  intentId: string;
}): Promise<EmailSendIntent> {
  const durable = await input.intentStore.findByIdempotencyKey({
    companyId: input.companyId,
    idempotencyKey: input.idempotencyKey,
  });
  if (
    !durable ||
    durable.id !== input.intentId ||
    durable.status !== "reconciled"
  ) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_RECEIPT_INVALID", 500);
  }
  return durable;
}

async function assertNoUnresolvedTemplateFollowUp(
  supabase: SupabaseClient,
  companyId: string,
  opportunityId: string
): Promise<void> {
  const { data: intentRows, error: intentError } = await supabase
    .from("email_send_intents")
    .select("id, follow_up_draft_id, status")
    .eq("company_id", companyId)
    .eq("opportunity_id", opportunityId)
    .in("status", [
      "sending",
      "delivery_unknown",
      "provider_accepted",
      "reconciling",
      "reconciliation_failed",
    ])
    .not("follow_up_draft_id", "is", null);
  if (intentError) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_LOOKUP_FAILED", 500);
  }
  const draftIds = Array.from(
    new Set(
      (intentRows ?? [])
        .map((row) => normalizedText(row.follow_up_draft_id))
        .filter((value): value is string => Boolean(value))
    )
  );
  if (draftIds.length === 0) return;

  const { data: drafts, error: draftError } = await supabase
    .from("opportunity_follow_up_drafts")
    .select("id")
    .eq("company_id", companyId)
    .eq("opportunity_id", opportunityId)
    .eq("origin", "template_follow_up")
    .in("id", draftIds)
    .limit(1);
  if (draftError) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_LOOKUP_FAILED", 500);
  }
  if ((drafts ?? []).length > 0) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_ALREADY_IN_PROGRESS", 409);
  }
}

async function fetchLinkedCanonicalThreads(
  supabase: SupabaseClient,
  companyId: string,
  opportunityId: string
): Promise<CanonicalLeadFollowUpThread[]> {
  const { data: links, error: linkError } = await supabase
    .from("opportunity_email_threads")
    .select("thread_id, connection_id")
    .eq("opportunity_id", opportunityId);
  if (linkError) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_LOOKUP_FAILED", 500);
  }
  const linked = (
    (links ?? []) as Array<{
      thread_id: string;
      connection_id: string | null;
    }>
  ).map((link) => ({
    providerThreadId: link.thread_id,
    connectionId: link.connection_id,
  }));
  const providerThreadIds = Array.from(
    new Set(
      linked
        .map((row) => normalizedText(row.providerThreadId))
        .filter((value): value is string => Boolean(value))
    )
  );
  if (providerThreadIds.length === 0) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_REQUIRED", 409);
  }

  const { data: threadRows, error: threadError } = await supabase
    .from("email_threads")
    .select("id, connection_id, provider_thread_id, subject, last_message_at")
    .eq("company_id", companyId)
    .in("provider_thread_id", providerThreadIds);
  if (threadError) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_LOOKUP_FAILED", 500);
  }

  const candidates: CanonicalLeadFollowUpThread[] = (
    (threadRows ?? []) as Array<{
      id: string;
      connection_id: string;
      provider_thread_id: string;
      subject: string;
      last_message_at: string;
    }>
  ).map((thread) => ({
    id: thread.id,
    connectionId: thread.connection_id,
    providerThreadId: thread.provider_thread_id,
    subject: thread.subject,
    lastMessageAt: thread.last_message_at,
  }));
  return resolveLeadFollowUpThreadBindings({
    links: linked,
    threads: candidates,
  });
}

async function fetchCanonicalThread(
  supabase: SupabaseClient,
  companyId: string,
  opportunityId: string
): Promise<CanonicalLeadFollowUpThread> {
  return selectCanonicalLeadFollowUpThread(
    await fetchLinkedCanonicalThreads(supabase, companyId, opportunityId)
  );
}

async function findCanonicalActivity(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    connectionId: string;
    opportunityId: string;
    actorUserId: string;
    message: NormalizedEmail;
  }
): Promise<string | null> {
  const exact = await supabase
    .from("activities")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("email_connection_id", input.connectionId)
    .eq("email_message_id", input.message.id)
    .limit(1)
    .maybeSingle();
  if (exact.error) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_LOOKUP_FAILED", 500);
  }
  if (exact.data?.id) return String(exact.data.id);

  const { data, error } = await supabase
    .from("activities")
    .insert({
      company_id: input.companyId,
      opportunity_id: input.opportunityId,
      type: "email",
      subject:
        normalizedText(input.message.subject) ??
        DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
      content: input.message.snippet.substring(0, 500),
      body_text: input.message.bodyText,
      body_text_clean: input.message.bodyTextClean ?? null,
      email_connection_id: input.connectionId,
      email_message_id: input.message.id,
      email_thread_id: input.message.threadId,
      direction: "outbound",
      from_email: input.message.from,
      to_emails: input.message.to,
      cc_emails: input.message.cc,
      has_attachments: input.message.hasAttachments,
      attachment_count: 0,
      is_read: true,
      created_by: input.actorUserId,
      created_at: input.message.date.toISOString(),
    })
    .select("id")
    .single();
  if (!error && data?.id) return String(data.id);
  if ((error as { code?: string } | null)?.code !== "23505") {
    throw new LeadFollowUpError(
      "LEAD_FOLLOW_UP_SOURCE_PERSISTENCE_FAILED",
      500
    );
  }

  const raced = await supabase
    .from("activities")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("email_connection_id", input.connectionId)
    .eq("email_message_id", input.message.id)
    .limit(1)
    .maybeSingle();
  if (raced.error || !raced.data?.id) {
    throw new LeadFollowUpError(
      "LEAD_FOLLOW_UP_SOURCE_PERSISTENCE_FAILED",
      500
    );
  }
  return String(raced.data.id);
}

async function materializeLatestOutboundSource(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    opportunityId: string;
    actorUserId: string;
    connectionId: string;
    connectionEmail: string;
    companyDomains: string[];
    userEmailAddresses: string[];
    knownPlatformSenders: string[];
    message: NormalizedEmail;
  }
): Promise<string> {
  const existing = await supabase
    .from("opportunity_correspondence_events")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("opportunity_id", input.opportunityId)
    .eq("connection_id", input.connectionId)
    .eq("provider_thread_id", input.message.threadId)
    .eq("provider_message_id", input.message.id)
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_LOOKUP_FAILED", 500);
  }
  if (existing.data?.id) return String(existing.data.id);

  const activityId = await findCanonicalActivity(supabase, {
    companyId: input.companyId,
    connectionId: input.connectionId,
    opportunityId: input.opportunityId,
    actorUserId: input.actorUserId,
    message: input.message,
  });
  const event = await OpportunityLifecycleService.recordCorrespondenceEvent({
    supabase,
    companyId: input.companyId,
    opportunityId: input.opportunityId,
    activityId,
    connectionId: input.connectionId,
    providerThreadId: input.message.threadId,
    providerMessageId: input.message.id,
    requireProviderMessageId: true,
    direction: "outbound",
    occurredAt: input.message.date,
    source: "lead_follow_up_preflight",
    applyOpportunityProjection: true,
    fromEmail: input.message.from,
    fromName: input.message.fromName,
    toEmails: input.message.to,
    ccEmails: input.message.cc,
    subject: input.message.subject,
    bodyText: input.message.bodyText,
    connectionEmail: input.connectionEmail,
    companyDomains: input.companyDomains,
    userEmailAddresses: input.userEmailAddresses,
    knownPlatformSenders: input.knownPlatformSenders,
  });
  if (!event.created && event.reason !== "duplicate_provider_message_id") {
    throw new LeadFollowUpError(
      "LEAD_FOLLOW_UP_SOURCE_PERSISTENCE_FAILED",
      500
    );
  }

  const canonical = await supabase
    .from("opportunity_correspondence_events")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("opportunity_id", input.opportunityId)
    .eq("connection_id", input.connectionId)
    .eq("provider_thread_id", input.message.threadId)
    .eq("provider_message_id", input.message.id)
    .limit(1)
    .maybeSingle();
  if (canonical.error || !canonical.data?.id) {
    throw new LeadFollowUpError(
      "LEAD_FOLLOW_UP_SOURCE_PERSISTENCE_FAILED",
      500
    );
  }
  return String(canonical.data.id);
}

interface FollowUpDraftRow {
  id: string;
  connection_id: string | null;
  provider_thread_id: string | null;
  source_event_id: string | null;
  subject: string;
  original_body: string;
  current_body: string | null;
  recipient_email: string | null;
  updated_at: string;
}

async function ensureFollowUpDraft(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    opportunityId: string;
    actorUserId: string;
    connectionId: string;
    providerThreadId: string;
    sourceEventId: string;
    recipientEmail: string;
    recipientName: string | null;
    subject: string;
    body: string;
  }
): Promise<FollowUpDraftRow> {
  const loadOpen = () =>
    supabase
      .from("opportunity_follow_up_drafts")
      .select(
        "id, connection_id, provider_thread_id, source_event_id, subject, original_body, current_body, recipient_email, updated_at"
      )
      .eq("company_id", input.companyId)
      .eq("opportunity_id", input.opportunityId)
      .eq("origin", "template_follow_up")
      .eq("status", "drafted")
      .order("created_at", { ascending: false })
      .limit(2);

  let { data: openRows, error: openError } = await loadOpen();
  if (openError) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_LOOKUP_FAILED", 500);
  }
  if ((openRows ?? []).length > 1) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_AMBIGUOUS", 409);
  }
  let open = ((openRows ?? [])[0] ?? null) as FollowUpDraftRow | null;
  const bindingMatches =
    open?.connection_id === input.connectionId &&
    open.provider_thread_id === input.providerThreadId &&
    open.source_event_id === input.sourceEventId &&
    normalizedEmail(open.recipient_email ?? "") === input.recipientEmail;
  if (open && !bindingMatches) {
    const { error } = await supabase
      .from("opportunity_follow_up_drafts")
      .update({
        status: "superseded",
        superseded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", open.id)
      .eq("status", "drafted");
    if (error) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_SUPERSEDE_FAILED", 500);
    }
    open = null;
  }
  if (open) {
    const refreshPatch = buildLeadFollowUpDraftRefreshPatch(
      {
        subject: open.subject,
        originalBody: open.original_body,
        currentBody: open.current_body,
      },
      { subject: input.subject, body: input.body },
      new Date().toISOString()
    );
    if (!refreshPatch) return open;
    const refreshed = await supabase
      .from("opportunity_follow_up_drafts")
      .update(refreshPatch)
      .eq("id", open.id)
      .eq("status", "drafted")
      .eq("updated_at", open.updated_at)
      .select(
        "id, connection_id, provider_thread_id, source_event_id, subject, original_body, current_body, recipient_email, updated_at"
      )
      .maybeSingle();
    if (refreshed.error) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_REFRESH_FAILED", 500);
    }
    if (!refreshed.data) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_CONFLICT", 409);
    }
    return refreshed.data as FollowUpDraftRow;
  }

  const state = await supabase
    .from("opportunity_lifecycle_state")
    .select("unanswered_follow_up_count")
    .eq("opportunity_id", input.opportunityId)
    .maybeSingle();
  if (state.error) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_LOOKUP_FAILED", 500);
  }
  const sequence =
    Math.max(
      0,
      Number(
        (state.data as { unanswered_follow_up_count?: number } | null)
          ?.unanswered_follow_up_count ?? 0
      )
    ) + 1;
  const inserted = await supabase
    .from("opportunity_follow_up_drafts")
    .insert({
      company_id: input.companyId,
      opportunity_id: input.opportunityId,
      connection_id: input.connectionId,
      provider_thread_id: input.providerThreadId,
      source_event_id: input.sourceEventId,
      origin: "template_follow_up",
      sequence_number: sequence,
      subject: input.subject,
      original_body: input.body,
      current_body: input.body,
      status: "drafted",
      created_by: input.actorUserId,
      recipient_email: input.recipientEmail,
      recipient_name: input.recipientName,
    })
    .select(
      "id, connection_id, provider_thread_id, source_event_id, subject, original_body, current_body, recipient_email, updated_at"
    )
    .single();
  if (!inserted.error && inserted.data) {
    return inserted.data as FollowUpDraftRow;
  }
  if ((inserted.error as { code?: string } | null)?.code !== "23505") {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_CREATE_FAILED", 500);
  }
  ({ data: openRows, error: openError } = await loadOpen());
  if (openError || (openRows ?? []).length !== 1) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_CREATE_FAILED", 500);
  }
  open = (openRows ?? [])[0] as FollowUpDraftRow;
  if (
    open.connection_id !== input.connectionId ||
    open.provider_thread_id !== input.providerThreadId ||
    open.source_event_id !== input.sourceEventId ||
    normalizedEmail(open.recipient_email ?? "") !== input.recipientEmail
  ) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_DRAFT_CONFLICT", 409);
  }
  return open;
}

async function executeLeadFollowUpIntent(input: {
  supabase: SupabaseClient;
  intentStore: EmailSendIntentService;
  provider: EmailProviderInterface;
  connection: EmailConnection;
  prepareInput: PrepareEmailSendIntentInput;
}): Promise<LeadFollowUpRouteResult> {
  const delivery = new EmailSendDeliveryService({
    intentStore: input.intentStore,
    provider: input.provider,
    reconcile: async (intent, providerLockCheckpoint) => {
      const reconciliationResult = await reconcileEmailSend({
        supabase: input.supabase,
        intent,
        connection: input.connection,
        provider: input.provider,
        providerLockCheckpoint,
      });
      return { activityId: reconciliationResult.activityId };
    },
    validateProviderDelivery: async (intent, providerLockCheckpoint) => {
      const providerThreadId = normalizedText(intent.replyProviderThreadId);
      const inReplyTo = normalizedText(intent.inReplyTo);
      if (!providerThreadId || !inReplyTo || intent.toEmails.length !== 1) {
        throw new Error("LEAD_FOLLOW_UP_THREAD_INVALID");
      }
      const currentBindings = await fetchLinkedCanonicalThreads(
        input.supabase,
        intent.companyId,
        intent.opportunityId
      );
      const linkedThreads = resolveLeadFollowUpThreadBindings({
        links: currentBindings.map((thread) => ({
          providerThreadId: thread.providerThreadId,
          connectionId: thread.connectionId,
        })),
        threads: currentBindings,
        expectedConnectionId: intent.connectionId,
      });
      if (
        !linkedThreads.some(
          (thread) =>
            thread.id === intent.sourceEmailThreadId &&
            thread.providerThreadId === providerThreadId
        )
      ) {
        throw new Error("LEAD_FOLLOW_UP_CONVERSATION_CHANGED");
      }

      const snapshots: ProviderFollowUpThreadSnapshot[] = [];
      for (const thread of linkedThreads) {
        await providerLockCheckpoint();
        snapshots.push({
          providerThreadId: thread.providerThreadId,
          messages: await input.provider.fetchThread(thread.providerThreadId),
        });
        await providerLockCheckpoint();
      }
      assertProviderLeadFollowUpThreadsFresh({
        connectionEmail: input.connection.email,
        senderEmails: input.connection.syncFilters?.userEmailAddresses ?? [],
        recipientEmail: intent.toEmails[0],
        selectedProviderThreadId: providerThreadId,
        selectedInReplyTo: inReplyTo,
        selectedSubject: intent.subject,
        snapshots,
      });
    },
    runWithMailboxLease: ({ connectionId, run }) =>
      runWithEmailConnectionSyncLock({
        connectionId,
        context: "lead-one-tap-follow-up",
        client: input.supabase,
        run,
      }),
  });
  let result: Awaited<ReturnType<typeof delivery.execute>>;
  try {
    result = await delivery.execute(input.prepareInput);
  } catch (error) {
    throw normalizeLeadFollowUpDeliveryError(error) ?? error;
  }

  if (result.state === "rejected") {
    const rejectionCode = normalizedText(result.error);
    if (rejectionCode?.startsWith("LEAD_FOLLOW_UP_")) {
      return {
        status: 409,
        body: {
          error: rejectionCode,
          delivered: false,
          definitiveNoDelivery: true,
          intentId: result.intentId,
        },
      };
    }
    return {
      status: 502,
      body: {
        error: "LEAD_FOLLOW_UP_PROVIDER_REJECTED",
        delivered: false,
        definitiveNoDelivery: true,
        intentId: result.intentId,
        reason: result.error,
      },
    };
  }
  if (result.error === "EMAIL_SEND_MAILBOX_BUSY") {
    return {
      status: 409,
      body: {
        error: "LEAD_FOLLOW_UP_MAILBOX_BUSY",
        delivered: false,
        intentId: result.intentId,
      },
    };
  }
  if (result.state !== "reconciled") {
    return {
      status: 202,
      body: {
        ok: result.delivered,
        delivered: result.delivered,
        reconciliationPending: result.delivered,
        deliveryUnknown: result.state === "delivery_unknown",
        intentId: result.intentId,
        messageId: result.providerMessageId,
        threadId: result.providerThreadId,
        opportunity: await fetchCanonicalOpportunity(
          input.supabase,
          input.prepareInput.companyId,
          input.prepareInput.opportunityId
        ),
        reason: result.error,
      },
    };
  }

  const durableIntent = await refetchReconciledLeadFollowUpIntent({
    intentStore: input.intentStore,
    companyId: input.prepareInput.companyId,
    idempotencyKey: input.prepareInput.idempotencyKey,
    intentId: result.intentId,
  });
  const settled = resultFromSettledLeadFollowUpIntent(durableIntent);
  if (!settled || settled.status !== 200) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_RECEIPT_INVALID", 500);
  }
  const canonicalOpportunity = await fetchCanonicalOpportunity(
    input.supabase,
    input.prepareInput.companyId,
    input.prepareInput.opportunityId
  );
  return {
    status: 200,
    body: {
      ...settled.body,
      from: input.connection.email,
      opportunity: canonicalOpportunity,
    },
  };
}

export async function sendLeadFollowUp(input: {
  actor: EmailRouteActor;
  opportunityId: string;
  idempotencyKey: string;
}): Promise<LeadFollowUpRouteResult> {
  const supabase = getServiceRoleClient();
  const intentStore = new EmailSendIntentService(supabase);
  const existingIntent = await intentStore.findByIdempotencyKey({
    companyId: input.actor.companyId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existingIntent) {
    if (
      existingIntent.companyId !== input.actor.companyId ||
      existingIntent.opportunityId !== input.opportunityId ||
      existingIntent.actorUserId !== input.actor.userId
    ) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_IDEMPOTENCY_CONFLICT", 409);
    }
    const settled = resultFromSettledLeadFollowUpIntent(existingIntent);
    if (settled) return settled;

    const prepareInput =
      prepareInputFromExistingLeadFollowUpIntent(existingIntent);
    if (existingIntent.status === "prepared") {
      const access = await resolveEmailOpportunityAccess({
        actor: input.actor,
        operation: "send",
        threadId: prepareInput.sourceEmailThreadId!,
        connectionId: prepareInput.connectionId,
        opportunityId: input.opportunityId,
        supabase,
      });
      if (!access.allowed) {
        throw new LeadFollowUpError(
          access.reason.includes("conflict")
            ? "LEAD_FOLLOW_UP_THREAD_CONFLICT"
            : "LEAD_FOLLOW_UP_FORBIDDEN",
          access.reason.includes("conflict") ? 409 : 403
        );
      }
    }
    const connection = await EmailService.getConnection(
      prepareInput.connectionId
    );
    if (
      !connection ||
      connection.companyId !== input.actor.companyId ||
      (existingIntent.status === "prepared" && connection.status !== "active")
    ) {
      throw new LeadFollowUpError("LEAD_FOLLOW_UP_CONNECTION_INVALID", 409);
    }
    const provider = EmailService.getProvider(connection);
    return executeLeadFollowUpIntent({
      supabase,
      intentStore,
      provider,
      connection,
      prepareInput,
    });
  }

  await assertLeadFollowUpPipelineAccess(
    supabase,
    input.actor,
    input.opportunityId
  );
  const thread = await fetchCanonicalThread(
    supabase,
    input.actor.companyId,
    input.opportunityId
  );
  const access = await resolveEmailOpportunityAccess({
    actor: input.actor,
    operation: "send",
    threadId: thread.id,
    connectionId: thread.connectionId,
    opportunityId: input.opportunityId,
    supabase,
  });
  if (!access.allowed) {
    throw new LeadFollowUpError(
      access.reason.includes("conflict")
        ? "LEAD_FOLLOW_UP_THREAD_CONFLICT"
        : "LEAD_FOLLOW_UP_FORBIDDEN",
      access.reason.includes("conflict") ? 409 : 403
    );
  }
  const opportunity = await fetchCanonicalOpportunity(
    supabase,
    input.actor.companyId,
    input.opportunityId
  );

  if (
    !isStockFollowUpStage(opportunity.stage) ||
    opportunity.archived_at ||
    opportunity.merged_into_opportunity_id ||
    opportunity.project_id ||
    opportunity.project_ref
  ) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_OPPORTUNITY_STALE", 409);
  }

  const [settingsResult, companyResult] = await Promise.all([
    supabase
      .from("lead_lifecycle_settings")
      .select("follow_up_template_body")
      .eq("company_id", input.actor.companyId)
      .maybeSingle(),
    supabase
      .from("companies")
      .select(
        "name, timezone, subscription_plan, subscription_status, trial_end_date, seated_employee_ids, admin_ids, max_seats"
      )
      .eq("id", input.actor.companyId)
      .single(),
  ]);
  if (settingsResult.error || companyResult.error || !companyResult.data) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_LOOKUP_FAILED", 500);
  }
  const companyRow = companyResult.data as Record<string, unknown>;
  if (!getSubscriptionInfo(mapSubscriptionRow(companyRow)).isActive) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_SUBSCRIPTION_INACTIVE", 403);
  }
  const companyTimezone = normalizedText(companyRow.timezone);
  if (!companyTimezone) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_TIMEZONE_INVALID", 409);
  }
  assertFreshLeadFollowUpIsDue(opportunity, companyTimezone);

  const recipientEmail = normalizedEmail(
    normalizedText(opportunity.contact_email) ?? ""
  );
  if (!recipientEmail) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_RECIPIENT_REQUIRED", 409);
  }
  await assertNoUnresolvedTemplateFollowUp(
    supabase,
    input.actor.companyId,
    input.opportunityId
  );

  const connection = await EmailService.getConnection(access.connectionId);
  if (
    !connection ||
    connection.status !== "active" ||
    connection.companyId !== input.actor.companyId
  ) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_CONNECTION_INVALID", 409);
  }
  const provider = EmailService.getProvider(connection);
  const providerMessages = await provider.fetchThread(thread.providerThreadId);
  const providerContext = resolveProviderFollowUpContext({
    connectionEmail: connection.email,
    senderEmails: connection.syncFilters?.userEmailAddresses ?? [],
    recipientEmail,
    messages: providerMessages,
  });
  if (providerContext.providerThreadId !== thread.providerThreadId) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_CONFLICT", 409);
  }
  const latestMessage = providerMessages.find(
    (message) => message.id === providerContext.inReplyTo
  );
  if (!latestMessage) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_THREAD_INVALID", 409);
  }

  const sourceEventId = await materializeLatestOutboundSource(supabase, {
    companyId: input.actor.companyId,
    opportunityId: input.opportunityId,
    actorUserId: input.actor.userId,
    connectionId: connection.id,
    connectionEmail: connection.email,
    companyDomains: connection.syncFilters?.companyDomains ?? [],
    userEmailAddresses: connection.syncFilters?.userEmailAddresses ?? [],
    knownPlatformSenders: connection.syncFilters?.knownPlatformSenders ?? [],
    message: latestMessage,
  });
  await EmailThreadService.upsertFromEmail({
    companyId: input.actor.companyId,
    connectionId: connection.id,
    providerThreadId: thread.providerThreadId,
    email: latestMessage,
    direction: "outbound",
    opportunityId: input.opportunityId,
  });

  const settings = (settingsResult.data ?? {}) as Record<string, unknown>;
  // Replies retain the provider thread's current subject. Gmail requires a
  // matching Subject alongside threadId + RFC reply headers to keep the
  // outbound message in the existing conversation.
  const subject = providerContext.subject;
  const body = renderLeadFollowUpTemplate(
    normalizedText(settings.follow_up_template_body) ??
      DEFAULT_FOLLOW_UP_TEMPLATE_BODY,
    {
      contactName: normalizedText(opportunity.contact_name),
      opportunityTitle: normalizedText(opportunity.title),
      companyName: normalizedText(companyRow.name),
    }
  );
  const draft = await ensureFollowUpDraft(supabase, {
    companyId: input.actor.companyId,
    opportunityId: input.opportunityId,
    actorUserId: input.actor.userId,
    connectionId: connection.id,
    providerThreadId: thread.providerThreadId,
    sourceEventId,
    recipientEmail,
    recipientName: normalizedText(opportunity.contact_name),
    subject,
    body,
  });
  const authored = resolveLeadFollowUpDraftContent(
    {
      subject: draft.subject,
      originalBody: draft.original_body,
      currentBody: draft.current_body,
    },
    { subject, body }
  );
  const authoredBody = authored.body;
  const authoredSubject = authored.subject;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentSends } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.actor.companyId)
    .eq("created_by", input.actor.userId)
    .eq("type", "email")
    .eq("direction", "outbound")
    .gte("created_at", oneHourAgo);
  if ((recentSends ?? 0) >= RATE_LIMIT_PER_HOUR) {
    throw new LeadFollowUpError("LEAD_FOLLOW_UP_RATE_LIMITED", 429);
  }

  const signature = await resolveEmailSignatureForMessage({
    supabase,
    connection,
    userId: input.actor.userId,
    refreshProviderIfMissing: true,
  });
  if (!signature) {
    throw new LeadFollowUpError("EMAIL_SIGNATURE_REQUIRED", 409);
  }
  const renderedBody = renderEmailBodyWithSignature({
    body: authoredBody,
    contentType: "text",
    signature,
  });
  const renderedBodyHash = createHash("sha256")
    .update(renderedBody)
    .digest("hex");
  return executeLeadFollowUpIntent({
    supabase,
    intentStore,
    provider,
    connection,
    prepareInput: {
      idempotencyKey: input.idempotencyKey,
      companyId: input.actor.companyId,
      actorUserId: input.actor.userId,
      initiatedBy: "operator",
      connectionId: connection.id,
      opportunityId: input.opportunityId,
      sourceEmailThreadId: thread.id,
      replyProviderThreadId: thread.providerThreadId,
      inReplyTo: providerContext.inReplyTo,
      senderSwitched: false,
      toEmails: [recipientEmail],
      ccEmails: [],
      subject: authoredSubject,
      authoredBody,
      renderedBody,
      contentType: "text",
      draftHistoryId: null,
      followUpDraftId: draft.id,
      learningAuthority: "operator_authored",
      signatureId: signature.recordId ?? null,
      signatureContentHash: signature.hash ?? null,
      renderedBodyHash,
      pendingAutoSendId: null,
    },
  });
}
