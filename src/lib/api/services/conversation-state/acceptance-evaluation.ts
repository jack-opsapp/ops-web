import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ConvertOpportunityParams,
  ProjectConversionError,
  ProjectConversionService,
} from "@/lib/api/services/project-conversion-service";
import { createEmailOpportunityNotification } from "@/lib/email/email-opportunity-notification";
import { resolveGuardedOpportunityClientId } from "@/lib/email/opportunity-client-identity";
import { findUniqueExistingProjectForEmailConversion } from "@/lib/email/opportunity-relationship-matching";
import {
  detectCommercialOutcome,
  hasUnresolvedCommercialConflict,
} from "@/lib/email/terminal-stage-decision";
import type { EmailConnection } from "@/lib/types/email-connection";

import { decideAcceptStage } from "./accept-stage";
import { buildConversationState } from "./conversation-state";
import { cleanMessageBody } from "./message-cleaner";
import { persistRoutingDecision } from "./persist-routing";

const COMMERCIAL_EVIDENCE_PAGE_SIZE = 500;

interface CommercialEvidenceEvent {
  id: string;
  activity_id: string | null;
  connection_id: string;
  provider_thread_id: string;
  provider_message_id: string;
  direction: "inbound" | "outbound";
  party_role: string;
  from_email: string | null;
  occurred_at: string;
}

interface CommercialEvidenceActivity {
  id: string;
  email_connection_id: string | null;
  email_thread_id: string | null;
  email_message_id: string | null;
  direction: "inbound" | "outbound" | null;
  subject: string | null;
  body_text: string | null;
  body_text_clean: string | null;
}

interface CommercialEvidenceMessage {
  evidenceKey: string;
  providerMessageId: string;
  occurredAt: string;
  direction: "inbound" | "outbound";
  authorRole: "customer" | "operator";
  subject: string;
  body: string;
}

function mailboxMessageKey(connectionId: string, providerMessageId: string) {
  return `${connectionId}:${providerMessageId}`;
}

function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return email && email.includes("@") ? email : null;
}

async function loadOpportunityCustomerEmails(input: {
  supabase: SupabaseClient;
  companyId: string;
  clientId: string | null;
  opportunityContactEmail: string | null;
}): Promise<Set<string>> {
  const emails = new Set<string>();
  const opportunityEmail = normalizedEmail(input.opportunityContactEmail);
  if (opportunityEmail) emails.add(opportunityEmail);
  if (!input.clientId) return emails;

  const { data: client, error: clientError } = await input.supabase
    .from("clients")
    .select("email")
    .eq("id", input.clientId)
    .eq("company_id", input.companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (clientError) {
    throw new Error(
      `commercial customer identity lookup failed: ${clientError.message}`
    );
  }
  const clientEmail = normalizedEmail(client?.email as string | null);
  if (clientEmail) emails.add(clientEmail);

  for (let from = 0; ; from += COMMERCIAL_EVIDENCE_PAGE_SIZE) {
    const { data, error } = await input.supabase
      .from("sub_clients")
      .select("email")
      .eq("client_id", input.clientId)
      .eq("company_id", input.companyId)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, from + COMMERCIAL_EVIDENCE_PAGE_SIZE - 1);
    if (error) {
      throw new Error(
        `commercial alternate-contact identity lookup failed: ${error.message}`
      );
    }
    const page = (data ?? []) as Array<{ email: string | null }>;
    for (const row of page) {
      const email = normalizedEmail(row.email);
      if (email) emails.add(email);
    }
    if (page.length < COMMERCIAL_EVIDENCE_PAGE_SIZE) break;
  }

  return emails;
}

function compareEvidenceEvents(
  left: CommercialEvidenceEvent,
  right: CommercialEvidenceEvent
): number {
  const timeDelta =
    Date.parse(left.occurred_at) - Date.parse(right.occurred_at);
  return timeDelta !== 0 ? timeDelta : left.id.localeCompare(right.id);
}

async function loadCompleteCommercialEvidence(input: {
  supabase: SupabaseClient;
  companyId: string;
  opportunityId: string;
  customerEmails: ReadonlySet<string>;
}) {
  const events: CommercialEvidenceEvent[] = [];
  const activities: CommercialEvidenceActivity[] = [];

  for (let from = 0; ; from += COMMERCIAL_EVIDENCE_PAGE_SIZE) {
    const { data, error } = await input.supabase
      .from("opportunity_correspondence_events")
      .select(
        "id, activity_id, connection_id, provider_thread_id, provider_message_id, direction, party_role, from_email, occurred_at"
      )
      .eq("company_id", input.companyId)
      .eq("opportunity_id", input.opportunityId)
      .eq("is_meaningful", true)
      .eq("opportunity_projection_applied", true)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + COMMERCIAL_EVIDENCE_PAGE_SIZE - 1);
    if (error) {
      throw new Error(
        `commercial correspondence evidence lookup failed: ${error.message}`
      );
    }
    const page = (data ?? []) as CommercialEvidenceEvent[];
    events.push(...page);
    if (page.length < COMMERCIAL_EVIDENCE_PAGE_SIZE) break;
  }

  for (let from = 0; ; from += COMMERCIAL_EVIDENCE_PAGE_SIZE) {
    const { data, error } = await input.supabase
      .from("activities")
      .select(
        "id, email_connection_id, email_thread_id, email_message_id, direction, subject, body_text, body_text_clean"
      )
      .eq("company_id", input.companyId)
      .eq("opportunity_id", input.opportunityId)
      .eq("type", "email")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + COMMERCIAL_EVIDENCE_PAGE_SIZE - 1);
    if (error) {
      throw new Error(
        `commercial activity evidence lookup failed: ${error.message}`
      );
    }
    const page = (data ?? []) as CommercialEvidenceActivity[];
    activities.push(...page);
    if (page.length < COMMERCIAL_EVIDENCE_PAGE_SIZE) break;
  }

  const activityById = new Map(
    activities.map((activity) => [activity.id, activity])
  );
  const activityByMessage = new Map<string, CommercialEvidenceActivity>();
  for (const activity of activities) {
    if (!activity.email_connection_id || !activity.email_message_id) continue;
    activityByMessage.set(
      mailboxMessageKey(
        activity.email_connection_id,
        activity.email_message_id
      ),
      activity
    );
  }
  const activityByEventId = new Map<string, CommercialEvidenceActivity>();
  const messages: CommercialEvidenceMessage[] = [];
  for (const event of events) {
    if (!event.connection_id || !event.provider_message_id) continue;
    const authorRole =
      event.direction === "inbound" &&
      event.party_role === "customer" &&
      Boolean(
        normalizedEmail(event.from_email) &&
        input.customerEmails.has(normalizedEmail(event.from_email)!)
      )
        ? ("customer" as const)
        : event.direction === "outbound" && event.party_role === "ops"
          ? ("operator" as const)
          : ("untrusted" as const);
    if (authorRole === "untrusted") continue;
    const activity = event.activity_id
      ? activityById.get(event.activity_id)
      : activityByMessage.get(
          mailboxMessageKey(event.connection_id, event.provider_message_id)
        );
    // Never claim an opportunity-wide high-water mark if a trusted message at
    // or below it was not actually evaluated. Holding the sync cursor is safer
    // than converting from stale partial content, and the retry remains
    // idempotent once the durable activity is present.
    if (!activity) {
      throw new Error(
        `commercial evidence activity missing for event ${event.id}`
      );
    }
    if (
      activity.email_message_id !== event.provider_message_id ||
      activity.email_thread_id !== event.provider_thread_id ||
      activity.direction !== event.direction ||
      (activity.email_connection_id !== null &&
        activity.email_connection_id !== event.connection_id)
    ) {
      throw new Error(
        `commercial evidence activity identity conflict for event ${event.id}`
      );
    }
    let provenActivity = activity;
    if (activity.email_connection_id === null) {
      const { data: claimed, error: claimError } = await input.supabase.rpc(
        "claim_legacy_email_activity_connection_as_system" as never,
        {
          p_company_id: input.companyId,
          p_connection_id: event.connection_id,
          p_activity_id: activity.id,
          p_provider_thread_id: event.provider_thread_id,
          p_provider_message_id: event.provider_message_id,
        } as never
      );
      if (claimError) {
        throw new Error(
          `email acceptance legacy activity connection claim failed for event ${event.id}: ${claimError.message}`
        );
      }
      if (claimed !== true) {
        throw new Error(
          `email acceptance legacy activity connection claim was not proven for event ${event.id}`
        );
      }
      provenActivity = {
        ...activity,
        email_connection_id: event.connection_id,
      };
      activityById.set(activity.id, provenActivity);
      activityByMessage.set(
        mailboxMessageKey(event.connection_id, event.provider_message_id),
        provenActivity
      );
    }
    activityByEventId.set(event.id, provenActivity);
    messages.push({
      evidenceKey: event.id,
      providerMessageId: event.provider_message_id,
      occurredAt: event.occurred_at,
      direction: event.direction,
      authorRole,
      subject: provenActivity.subject ?? "",
      body:
        provenActivity.body_text_clean ??
        cleanMessageBody(provenActivity.body_text ?? "", {
          subject: provenActivity.subject ?? "",
          providerCleanBody: null,
        }),
    });
  }

  return {
    events,
    messages,
    activityByEventId,
    latestEventId: events.at(-1)?.id ?? null,
  };
}

export interface OpportunityCommercialOutcomeEvaluationInput {
  supabase: SupabaseClient;
  opportunityId: string;
  connection: EmailConnection;
  now?: Date;
}

interface AcceptanceEvaluationInput
  extends OpportunityCommercialOutcomeEvaluationInput {
  providerThreadId: string;
}

interface CommercialOutcomeOpportunity {
  stage: string;
  stage_manually_set: boolean | null;
  client_id: string | null;
  client_ref: string | null;
  contact_email: string | null;
  assignment_version: number | null;
  address: string | null;
}

interface ThreadAcceptanceContext {
  state: NonNullable<Awaited<ReturnType<typeof buildConversationState>>>;
  durableProviderThreadId: string;
}

export function shouldEvaluateOpportunityCommercialOutcome(
  stage: string,
  stageManuallySet: boolean
): boolean {
  // Lost can be an engine-owned budget deferral, not a permanent operator
  // decision. Its guarded disposition record decides whether a later Won write
  // is allowed; Won/discarded and every manual override remain inert here.
  return !stageManuallySet && !["won", "discarded"].includes(stage);
}

async function loadCommercialOutcomeOpportunity({
  supabase,
  opportunityId,
  connection,
}: Pick<
  OpportunityCommercialOutcomeEvaluationInput,
  "supabase" | "opportunityId" | "connection"
>): Promise<CommercialOutcomeOpportunity | null> {
  const { data, error } = await supabase
    .from("opportunities")
    .select(
      "stage, stage_manually_set, client_id, client_ref, contact_email, assignment_version, address"
    )
    .eq("id", opportunityId)
    .eq("company_id", connection.companyId)
    .maybeSingle();
  if (error) {
    throw new Error(`accept opportunity lookup failed: ${error.message}`);
  }
  return (data as CommercialOutcomeOpportunity | null) ?? null;
}

async function evaluateLoadedOpportunityCommercialOutcome(input: {
  supabase: SupabaseClient;
  opportunityId: string;
  connection: EmailConnection;
  now?: Date;
  opportunity: CommercialOutcomeOpportunity;
  opportunityClientId: string | null;
  threadContext: ThreadAcceptanceContext | null;
}): Promise<{ stageChanged: boolean }> {
  const {
    supabase,
    opportunityId,
    connection,
    opportunity,
    opportunityClientId,
    threadContext,
  } = input;
  // `party_role = customer` intentionally remains broad enough for inbox
  // routing, but it is not conversion authority: any external CC/vendor can
  // receive that role. Actorless Won/deferred decisions require the exact
  // sender to belong to the opportunity's persisted customer relationship.
  const customerEmails = await loadOpportunityCustomerEmails({
    supabase,
    companyId: connection.companyId,
    clientId: opportunityClientId,
    opportunityContactEmail:
      (opportunity.contact_email as string | null) ?? null,
  });

  const completeEvidence = await loadCompleteCommercialEvidence({
    supabase,
    companyId: connection.companyId,
    opportunityId,
    customerEmails,
  });
  const commercialOutcome = detectCommercialOutcome({
    now: input.now ?? new Date(),
    messages: completeEvidence.messages,
  });

  const decisiveEvent = commercialOutcome
    ? completeEvidence.events.find(
        (event) => event.id === commercialOutcome.decisiveEvidenceKey
      )
    : null;
  if (
    commercialOutcome &&
    (!decisiveEvent || !completeEvidence.latestEventId)
  ) {
    throw new Error(
      "commercial outcome has no durable evidence high-water mark"
    );
  }

  const signedAcceptedMessage = threadContext
    ? [...threadContext.state.messages].reverse().find((message) => {
        const senderEmail = normalizedEmail(message.fromEmail);
        return (
          message.isRealCustomerInbound &&
          Boolean(senderEmail && customerEmails.has(senderEmail)) &&
          message.attachments.some(
            (attachment) => attachment.inspection?.isSignedEstimate === true
          )
        );
      })
    : null;
  const signedAcceptanceSender = normalizedEmail(
    signedAcceptedMessage?.fromEmail
  );
  const signedAcceptanceEvent = signedAcceptedMessage
    ? completeEvidence.events.find(
        (event) =>
          event.connection_id === connection.id &&
          event.provider_message_id ===
            signedAcceptedMessage.providerMessageId &&
          event.direction === "inbound" &&
          event.party_role === "customer" &&
          Boolean(
            signedAcceptanceSender &&
            normalizedEmail(event.from_email) === signedAcceptanceSender
          )
      )
    : null;
  const eventById = new Map(
    completeEvidence.events.map((event) => [event.id, event])
  );
  const newerTrustedMessages = signedAcceptanceEvent
    ? completeEvidence.messages.filter((message) => {
        const event = message.evidenceKey
          ? eventById.get(message.evidenceKey)
          : null;
        return Boolean(
          event && compareEvidenceEvents(event, signedAcceptanceEvent) > 0
        );
      })
    : [];
  const signedAcceptanceHasNewerUnresolvedConflict =
    signedAcceptanceEvent !== null &&
    hasUnresolvedCommercialConflict(newerTrustedMessages, true);
  const signedAcceptanceIsNewer = Boolean(
    signedAcceptanceEvent &&
    !signedAcceptanceHasNewerUnresolvedConflict &&
    (!decisiveEvent ||
      compareEvidenceEvents(signedAcceptanceEvent, decisiveEvent) > 0)
  );

  const assignmentVersion = opportunity.assignment_version;
  if (commercialOutcome?.outcome === "declined" && !signedAcceptanceIsNewer) {
    return { stageChanged: false };
  }
  if (commercialOutcome?.outcome === "deferred" && !signedAcceptanceIsNewer) {
    if (
      !Number.isSafeInteger(assignmentVersion) ||
      (assignmentVersion as number) < 0
    ) {
      throw new Error("email deferral decision has no assignment snapshot");
    }
    const { data: rows, error } = await supabase.rpc(
      "apply_email_opportunity_deferred_disposition" as never,
      {
        p_company_id: connection.companyId,
        p_opportunity_id: opportunityId,
        p_connection_id: decisiveEvent!.connection_id,
        p_provider_message_id: commercialOutcome.decisiveMessageId,
        p_expected_assignment_version: assignmentVersion as number,
        p_expected_stage: opportunity.stage as string,
        p_next_follow_up_at: commercialOutcome.followUpAt,
        p_evidence: {
          reason_code: commercialOutcome.reasonCode,
          signals: commercialOutcome.signals,
          evidence_message_ids: commercialOutcome.evidenceMessageIds,
          evaluated_through_event_id: completeEvidence.latestEventId,
        },
      } as never
    );
    if (error || !rows) {
      throw new Error(
        `email deferral disposition failed: ${error?.message ?? "RPC returned no rows"}`
      );
    }
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      | { changed?: boolean; guard_reason?: string | null }
      | undefined;
    if (!row) {
      throw new Error("email deferral disposition returned no decision row");
    }
    if (
      !row.changed &&
      ![
        "already_applied",
        "follow_up_updated",
        "manual_stage_override",
        "terminal_stage",
      ].includes(row.guard_reason ?? "")
    ) {
      throw new Error(
        `email deferral disposition was not committed: ${row.guard_reason ?? "unknown guard"}`
      );
    }
    return { stageChanged: Boolean(row.changed) };
  }

  const threadLocalAction = threadContext
    ? decideAcceptStage(
        threadContext.state.accept,
        threadContext.state.stage,
        threadContext.state.routing
      )
    : ({ kind: "none" } as const);
  const action =
    signedAcceptanceIsNewer || commercialOutcome?.outcome === "won"
      ? ({ kind: "auto_advance_won" } as const)
      : threadLocalAction.kind === "none"
        ? threadLocalAction
        : ({
            kind: "surface_mark_won",
            reason: threadLocalAction.reason,
          } as const);
  if (action.kind === "none") return { stageChanged: false };

  if (action.kind === "auto_advance_won") {
    if (
      !Number.isSafeInteger(assignmentVersion) ||
      (assignmentVersion as number) < 0
    ) {
      throw new Error("email acceptance has no assignment snapshot");
    }
    const conversionEvent =
      (signedAcceptanceIsNewer ? signedAcceptanceEvent : decisiveEvent) ??
      completeEvidence.events.find(
        (event) =>
          event.connection_id === connection.id &&
          event.provider_message_id === signedAcceptedMessage?.providerMessageId
      );
    if (!conversionEvent || !completeEvidence.latestEventId) {
      throw new Error(
        "email acceptance has no durable decisive event or high-water mark"
      );
    }
    const { data: conversionThread, error: conversionThreadError } = await supabase
      .from("email_threads")
      .select("id")
      .eq("company_id", connection.companyId)
      .eq("connection_id", conversionEvent.connection_id)
      .eq("provider_thread_id", conversionEvent.provider_thread_id)
      .eq("opportunity_id", opportunityId)
      .maybeSingle();
    if (conversionThreadError) {
      throw new Error(
        `email acceptance decisive thread lookup failed: ${conversionThreadError.message}`
      );
    }
    const decisionSignals: string[] = signedAcceptanceIsNewer
      ? ["signed_estimate"]
      : [...(commercialOutcome?.decisiveSignals ?? ["signed_estimate"])];
    type EmailAcceptEvidence = Extract<
      ConvertOpportunityParams,
      { sourcePath: "email_accept" }
    >["evidence"];
    let evidence: EmailAcceptEvidence;
    if (conversionThread?.id) {
      evidence = {
        connection_id: conversionEvent.connection_id,
        email_thread_id: conversionThread.id,
        provider_thread_id: conversionEvent.provider_thread_id,
        provider_message_id: conversionEvent.provider_message_id,
        decisive_event_id: conversionEvent.id,
        decisive_direction: conversionEvent.direction,
        evaluated_through_event_id: completeEvidence.latestEventId,
        signals: decisionSignals,
        decision: "auto_advance_won",
      };
    } else {
      const decisiveActivity = completeEvidence.activityByEventId.get(
        conversionEvent.id
      );
      if (
        !conversionEvent.activity_id ||
        !decisiveActivity?.id ||
        decisiveActivity.id !== conversionEvent.activity_id ||
        decisiveActivity.email_connection_id !== conversionEvent.connection_id
      ) {
        throw new Error(
          "email acceptance decisive event has no exact durable activity"
        );
      }
      evidence = {
        connection_id: conversionEvent.connection_id,
        conversation_scope: "message",
        source_activity_id: conversionEvent.activity_id,
        provider_thread_id: conversionEvent.provider_thread_id,
        provider_message_id: conversionEvent.provider_message_id,
        decisive_event_id: conversionEvent.id,
        decisive_direction: conversionEvent.direction,
        evaluated_through_event_id: completeEvidence.latestEventId,
        signals: decisionSignals,
        decision: "auto_advance_won",
      };
    }
    const conversionParams = {
      opportunityId,
      companyId: connection.companyId,
      decidedBy: null,
      sourcePath: "email_accept",
      expectedStage: opportunity.stage as string,
      expectedAssignmentVersion: assignmentVersion as number,
      evidence,
      actualValue: commercialOutcome?.facts.currentPrice ?? null,
    } as const;
    const existingProjectId = await findUniqueExistingProjectForEmailConversion(
      {
        supabase,
        companyId: connection.companyId,
        opportunityId,
        clientId: (opportunity.client_id as string | null) ?? null,
        clientRef: (opportunity.client_ref as string | null) ?? null,
        opportunityAddress: (opportunity.address as string | null) ?? null,
      }
    );
    let conversion;
    try {
      conversion = existingProjectId
        ? await ProjectConversionService.linkOpportunityToExistingProject({
            ...conversionParams,
            linkToProjectId: existingProjectId,
          })
        : await ProjectConversionService.convertOpportunityToProject(
            conversionParams
          );
    } catch (error) {
      if (
        error instanceof ProjectConversionError &&
        ["manual_stage_override", "terminal_stage"].includes(
          error.guardReason ?? ""
        )
      ) {
        return { stageChanged: false };
      }
      throw error;
    }
    if (!conversion.won) {
      throw new Error(
        "canonical email acceptance conversion did not win the opportunity"
      );
    }
    // The canonical conversion event transactionally enqueues its own durable,
    // retryable notification delivery. A second best-effort email notification
    // here could fail after conversion commits, and the Won/manual guard would
    // correctly make the next evaluation inert before that notification could
    // be retried.
    return { stageChanged: true };
  }

  if (
    threadContext &&
    Number.isSafeInteger(assignmentVersion) &&
    (assignmentVersion as number) >= 0
  ) {
    await createEmailOpportunityNotification({
      connectionId: connection.id,
      opportunityId,
      providerThreadId: threadContext.durableProviderThreadId,
      expectedAssignmentVersion: assignmentVersion as number,
      eventType: "accept_review_won",
      supabase,
    });
  }
  return { stageChanged: false };
}

/**
 * Evaluate complete durable correspondence for an opportunity. This boundary
 * intentionally does not depend on an `email_threads` row, so trusted forwarded
 * messages and form submissions can reach the same guarded deferred/Won paths
 * without fabricating a shared provider thread.
 */
export async function evaluateOpportunityCommercialOutcome(
  input: OpportunityCommercialOutcomeEvaluationInput
): Promise<{ stageChanged: boolean }> {
  const opportunity = await loadCommercialOutcomeOpportunity(input);
  if (!opportunity) return { stageChanged: false };
  if (
    !shouldEvaluateOpportunityCommercialOutcome(
      opportunity.stage,
      Boolean(opportunity.stage_manually_set)
    )
  ) {
    return { stageChanged: false };
  }
  const opportunityClientId = resolveGuardedOpportunityClientId({
    clientId: opportunity.client_id,
    clientRef: opportunity.client_ref,
  });
  return evaluateLoadedOpportunityCommercialOutcome({
    ...input,
    opportunity,
    opportunityClientId,
    threadContext: null,
  });
}

/**
 * Rebuild the exact mailbox thread after message or attachment facts change,
 * then apply the opportunity-wide deterministic outcome. The conversion and
 * notifications are idempotent, so both sync-time and the durable attachment
 * inspection worker can safely call this boundary.
 */
export async function evaluateOpportunityAcceptance(
  input: AcceptanceEvaluationInput
): Promise<{ stageChanged: boolean }> {
  const { supabase, providerThreadId, opportunityId, connection } = input;
  const opportunity = await loadCommercialOutcomeOpportunity(input);
  if (!opportunity) return { stageChanged: false };
  if (
    !shouldEvaluateOpportunityCommercialOutcome(
      opportunity.stage,
      Boolean(opportunity.stage_manually_set)
    )
  ) {
    return { stageChanged: false };
  }

  // Resolve mirrored client identity before any thread state is read. A split
  // identity must fail closed even when the triggering thread is missing.
  const opportunityClientId = resolveGuardedOpportunityClientId({
    clientId: opportunity.client_id,
    clientRef: opportunity.client_ref,
  });
  const { data: thread, error: threadError } = await supabase
    .from("email_threads")
    .select("id, provider_thread_id")
    .eq("company_id", connection.companyId)
    .eq("connection_id", connection.id)
    .eq("provider_thread_id", providerThreadId)
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (threadError) {
    throw new Error(`accept thread lookup failed: ${threadError.message}`);
  }
  const internalThreadId = (thread?.id as string | undefined) ?? null;
  const durableProviderThreadId =
    (thread?.provider_thread_id as string | undefined) ?? null;
  if (!internalThreadId || !durableProviderThreadId) {
    return { stageChanged: false };
  }

  const state = await buildConversationState(internalThreadId);
  if (!state) return { stageChanged: false };
  await persistRoutingDecision(internalThreadId, state);

  return evaluateLoadedOpportunityCommercialOutcome({
    ...input,
    opportunity,
    opportunityClientId,
    threadContext: { state, durableProviderThreadId },
  });
}
