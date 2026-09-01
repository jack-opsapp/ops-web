import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ingestionOperatorIdentityFromAuthoritative } from "@/lib/email/email-ingestion-routing";
import { resolveGuardedOpportunityClientId } from "@/lib/email/opportunity-client-identity";
import {
  evaluatePhaseCBilateralEvent,
  persistPhaseCBilateralEventHandoff,
  type PhaseCEventMessage,
} from "@/lib/email/phase-c-bilateral-event-handoff";
import {
  loadPhaseCStageDecisionEvidence,
  recordAndApplyPhaseCStageDecision,
  recordPhaseCLifecycleDecision,
} from "@/lib/email/phase-c-lifecycle-decision";
import { AISyncReviewer } from "./ai-sync-reviewer";
import { evaluateOpportunityCommercialOutcome } from "./conversation-state/acceptance-evaluation";
import { fetchOperatorIdentity } from "./conversation-state/operator-identity";
import { EmailService } from "./email-service";
import type { NormalizedEmail } from "./email-provider";
import { refreshLeadSummariesForOpportunities } from "./lead-summary-service";
import {
  PhaseCLeadIntelligenceWorkService,
  type ClaimedPhaseCLeadIntelligenceWork,
  type PhaseCLeadIntelligenceComponent,
  type PhaseCLeadIntelligenceComponentResult,
  type PhaseCLeadIntelligenceWorkDependencies,
} from "./phase-c-lead-intelligence-work-service";
import { isAllowedAutomatedEmailStageTransition } from "./stage-evaluator";
import type { EmailConnection } from "@/lib/types/email-connection";

interface PhaseCRuntimeSupabase {
  from(table: string): any;
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{
    data?: unknown;
    error?: { message?: string | null } | null;
  }>;
}

interface OpportunityRow {
  id: string;
  company_id: string;
  title: string;
  address: string | null;
  contact_email: string | null;
  client_id: string | null;
  client_ref: string | null;
  stage: string;
  assignment_version: number;
  assigned_to: string | null;
}

interface CorrespondenceEventRow {
  id: string;
  activity_id: string | null;
  connection_id: string | null;
  provider_thread_id: string;
  provider_message_id: string | null;
  direction: "inbound" | "outbound";
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  subject: string | null;
  occurred_at: string;
}

interface ActivityRow {
  id: string;
  email_connection_id: string | null;
  email_thread_id: string | null;
  email_message_id: string | null;
  direction: "inbound" | "outbound" | null;
  subject: string | null;
  body_text: string | null;
  body_text_clean: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
}

interface DurableContext {
  opportunity: OpportunityRow;
  company: { name: string; timezone: string };
  connection: EmailConnection;
  messages: NormalizedEmail[];
  eventMessages: PhaseCEventMessage[];
  operatorEmails: string[];
  customerEmails: string[];
  relationshipConflict: boolean;
}

interface ExistingStageDecisionRow {
  proposed_stage: string | null;
  confidence: number;
  evidence_event_ids: string[];
  evidence_message_ids: string[];
  reason: string;
  status: string;
}

const EVIDENCE_PAGE_SIZE = 250;
function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return email.includes("@") ? email : null;
}

function normalizedEmails(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .map(normalizedEmail)
        .filter((value): value is string => value !== null)
    ),
  ].sort();
}

function sameEmailSet(
  left: Array<string | null | undefined>,
  right: Array<string | null | undefined>
): boolean {
  const leftSet = normalizedEmails(left);
  const rightSet = normalizedEmails(right);
  return (
    leftSet.length === rightSet.length &&
    leftSet.every((value, index) => value === rightSet[index])
  );
}

function rowString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function allPages<T>(
  load: (
    from: number,
    to: number
  ) => PromiseLike<{
    data?: unknown;
    error?: { message?: string | null } | null;
  }>,
  label: string
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += EVIDENCE_PAGE_SIZE) {
    const response = await load(from, from + EVIDENCE_PAGE_SIZE - 1);
    if (response.error) {
      throw new Error(
        `${label} failed: ${response.error.message ?? "unknown error"}`
      );
    }
    const page = (response.data ?? []) as T[];
    rows.push(...page);
    if (page.length < EVIDENCE_PAGE_SIZE) return rows;
  }
}

function activityMessageKey(
  connectionId: string | null,
  messageId: string | null
): string | null {
  return connectionId && messageId ? `${connectionId}\u0000${messageId}` : null;
}

function exactActivityForEvent(input: {
  event: CorrespondenceEventRow;
  activitiesById: Map<string, ActivityRow>;
  activitiesByMessage: Map<string, ActivityRow[]>;
}): ActivityRow {
  const { event } = input;
  const fallbackKey = activityMessageKey(
    event.connection_id,
    event.provider_message_id
  );
  const fallbacks = fallbackKey
    ? (input.activitiesByMessage.get(fallbackKey) ?? [])
    : [];
  const activity = event.activity_id
    ? input.activitiesById.get(event.activity_id)
    : fallbacks.length === 1
      ? fallbacks[0]
      : null;
  if (!activity) {
    throw new Error(`Phase C activity evidence missing for event ${event.id}`);
  }
  if (
    !event.connection_id ||
    !event.provider_message_id ||
    activity.email_message_id !== event.provider_message_id ||
    activity.email_thread_id !== event.provider_thread_id ||
    activity.direction !== event.direction ||
    (activity.email_connection_id !== null &&
      activity.email_connection_id !== event.connection_id) ||
    !sameEmailSet(activity.to_emails ?? [], event.to_emails ?? []) ||
    !sameEmailSet(activity.cc_emails ?? [], event.cc_emails ?? [])
  ) {
    throw new Error(
      `Phase C activity evidence identity conflict for event ${event.id}`
    );
  }
  return activity;
}

function normalizedMessage(input: {
  event: CorrespondenceEventRow;
  activity: ActivityRow;
}): NormalizedEmail {
  const body = input.activity.body_text_clean ?? input.activity.body_text ?? "";
  return {
    id: input.event.provider_message_id!,
    threadId: input.event.provider_thread_id,
    from: input.event.from_email ?? "",
    fromName: "",
    to: input.event.to_emails ?? [],
    cc: input.event.cc_emails ?? [],
    subject: input.activity.subject ?? input.event.subject ?? "",
    snippet: body.slice(0, 240),
    bodyText: body,
    bodyTextClean: body,
    date: new Date(input.event.occurred_at),
    labelIds: [],
    isRead: true,
    hasAttachments: false,
    sizeEstimate: body.length,
  };
}

async function loadCustomerEmails(input: {
  supabase: PhaseCRuntimeSupabase;
  opportunity: OpportunityRow;
}): Promise<{ emails: string[]; relationshipConflict: boolean }> {
  const directContact = normalizedEmails([input.opportunity.contact_email]);
  let clientId: string | null;
  try {
    clientId = resolveGuardedOpportunityClientId({
      clientId: input.opportunity.client_id,
      clientRef: input.opportunity.client_ref,
    });
  } catch {
    return { emails: directContact, relationshipConflict: true };
  }
  if (!clientId) return { emails: directContact, relationshipConflict: false };

  const [clientResponse, subClients] = await Promise.all([
    input.supabase
      .from("clients")
      .select("id, email")
      .eq("company_id", input.opportunity.company_id)
      .eq("id", clientId)
      .is("deleted_at", null)
      .maybeSingle(),
    allPages<{ email: string | null }>(
      (from, to) =>
        input.supabase
          .from("sub_clients")
          .select("email")
          .eq("company_id", input.opportunity.company_id)
          .eq("client_id", clientId)
          .is("deleted_at", null)
          .order("id", { ascending: true })
          .range(from, to),
      "Phase C subcontact lookup"
    ),
  ]);
  if (clientResponse.error) {
    throw new Error(
      `Phase C primary customer lookup failed: ${clientResponse.error.message ?? "unknown error"}`
    );
  }
  return {
    emails: normalizedEmails([
      ...directContact,
      rowString(clientResponse.data?.email),
      ...subClients.map((row) => row.email),
    ]),
    relationshipConflict: false,
  };
}

class PhaseCLeadIntelligenceRuntimeProcessor {
  private readonly contextByWork = new Map<string, Promise<DurableContext>>();
  private readonly connectionByWork = new Map<
    string,
    Promise<EmailConnection>
  >();

  constructor(private readonly supabase: PhaseCRuntimeSupabase) {}

  async processComponent(input: {
    work: ClaimedPhaseCLeadIntelligenceWork;
    component: PhaseCLeadIntelligenceComponent;
  }): Promise<PhaseCLeadIntelligenceComponentResult> {
    switch (input.component) {
      case "summary":
        return this.refreshSummary(input.work);
      case "lifecycle":
        return this.evaluateLifecycle(input.work);
      case "commercial":
        return this.evaluateCommercialOutcome(input.work);
      case "event_handoff":
        return this.evaluateEventHandoff(input.work);
    }
  }

  private context(
    work: ClaimedPhaseCLeadIntelligenceWork,
    scope: "source_thread" | "opportunity"
  ) {
    const key = `${work.opportunityId}\u0000${work.requiredEventId}\u0000${scope}`;
    const existing = this.contextByWork.get(key);
    if (existing) return existing;
    const loading = this.loadContext(work, scope);
    this.contextByWork.set(key, loading);
    return loading;
  }

  private connection(work: ClaimedPhaseCLeadIntelligenceWork) {
    const existing = this.connectionByWork.get(work.opportunityId);
    if (existing) return existing;
    const loading = (async () => {
      if (!work.requiredConnectionId) {
        throw new Error("Phase C work has no exact email connection");
      }
      const connection = await EmailService.getConnection(
        work.requiredConnectionId
      );
      if (!connection || connection.companyId !== work.companyId) {
        throw new Error(
          "Phase C work email connection is missing or mismatched"
        );
      }
      return connection;
    })();
    this.connectionByWork.set(work.opportunityId, loading);
    return loading;
  }

  private async refreshSummary(
    work: ClaimedPhaseCLeadIntelligenceWork
  ): Promise<PhaseCLeadIntelligenceComponentResult> {
    const result = await refreshLeadSummariesForOpportunities({
      supabase: this.supabase,
      companyId: work.companyId,
      opportunityIds: [work.opportunityId],
    });
    if (result.skippedFeatureDisabled) {
      return {
        outcome: "skipped",
        detail: { reason: "phase_c_disabled" },
        skipRemainingReason: "phase_c_disabled",
      };
    }
    if (
      result.failed.length > 0 ||
      result.deferred.length > 0 ||
      result.remainingOpportunityIds.includes(work.opportunityId) ||
      result.written !== 1
    ) {
      const explanation = [
        ...result.failed.map((failure) => failure.error),
        ...result.deferred.map((failure) => failure.error),
      ].join("; ");
      throw new Error(
        `Phase C summary did not converge for ${work.opportunityId}${explanation ? `: ${explanation}` : ""}`
      );
    }
    return { outcome: "applied", detail: { written: result.written } };
  }

  private async evaluateLifecycle(
    work: ClaimedPhaseCLeadIntelligenceWork
  ): Promise<PhaseCLeadIntelligenceComponentResult> {
    const context = await this.context(work, "source_thread");
    const { opportunity, connection } = context;
    if (["won", "lost", "discarded"].includes(opportunity.stage)) {
      return { outcome: "skipped", detail: { reason: "terminal_stage" } };
    }
    const evidence = await loadPhaseCStageDecisionEvidence({
      supabase: this.supabase,
      companyId: work.companyId,
      opportunityId: work.opportunityId,
      connectionId: connection.id,
      providerThreadIds: [work.requiredProviderThreadId],
    });
    const { data: existing, error: existingError } = await this.supabase
      .from("opportunity_lifecycle_decisions")
      .select(
        "proposed_stage, confidence, evidence_event_ids, evidence_message_ids, reason, status"
      )
      .eq("company_id", work.companyId)
      .eq("opportunity_id", work.opportunityId)
      .eq("source_event_id", evidence.sourceEventId)
      .eq("decision_kind", "stage")
      .eq("decision_key", "durable_active_stage")
      .maybeSingle();
    if (existingError) {
      throw new Error(
        `Phase C durable stage decision lookup failed: ${existingError.message ?? "unknown error"}`
      );
    }
    const existingDecision = existing as ExistingStageDecisionRow | null;
    if (existingDecision?.status === "applied") {
      return {
        outcome: "unchanged",
        detail: { reason: "stage_decision_already_applied" },
      };
    }
    if (existingDecision?.status === "skipped") {
      return {
        outcome: "skipped",
        detail: { reason: "stage_decision_already_guarded" },
      };
    }
    if (existingDecision?.status === "failed") {
      throw new Error("Phase C durable stage decision is marked failed");
    }
    if (existingDecision?.status === "review") {
      return {
        outcome: "review",
        detail: { reason: "stage_decision_requires_review" },
      };
    }

    let proposedStage = existingDecision?.proposed_stage ?? null;
    const confidence = existingDecision?.confidence ?? 0.8;
    const decisionEvidence = existingDecision
      ? {
          sourceEventId: evidence.sourceEventId,
          evidenceEventIds: existingDecision.evidence_event_ids,
          evidenceMessageIds: existingDecision.evidence_message_ids,
        }
      : evidence;
    let terminalFlag: "likely_won" | "likely_lost" | null = null;
    if (!existingDecision) {
      const sourceMessages = context.messages.filter(
        (message) =>
          message.threadId === work.requiredProviderThreadId &&
          evidence.evidenceMessageIds.includes(message.id)
      );
      if (sourceMessages.length === 0) {
        throw new Error(
          "Phase C stage evaluation has no exact source messages"
        );
      }
      const stageResults = await AISyncReviewer.evaluateStagesWithSummary(
        [
          {
            threadId: `phase-c-durable:${work.opportunityId}`,
            messages: sourceMessages,
          },
        ],
        connection,
        { name: context.company.name },
        { supabase: this.supabase as SupabaseClient },
        ingestionOperatorIdentityFromAuthoritative({
          connectionEmail: connection.email,
          operator: await fetchOperatorIdentity(work.companyId, connection),
        })
      );
      if (stageResults.length !== 1) {
        throw new Error(
          `Phase C stage evaluation returned ${stageResults.length} results`
        );
      }
      proposedStage = stageResults[0].newStage;
      terminalFlag = stageResults[0].terminalFlag;
    }

    if (terminalFlag) {
      await recordPhaseCLifecycleDecision({
        supabase: this.supabase,
        companyId: work.companyId,
        opportunityId: work.opportunityId,
        sourceEventId: decisionEvidence.sourceEventId,
        decisionKind: "commercial_outcome",
        decisionKey: "model_terminal_review",
        proposedOutcome: terminalFlag,
        confidence: 0.5,
        evidenceEventIds: decisionEvidence.evidenceEventIds,
        evidenceMessageIds: decisionEvidence.evidenceMessageIds,
        reason: "model_terminal_flag_requires_deterministic_evidence",
        status: "review",
        reviewReason: terminalFlag,
      });
    }
    if (!proposedStage || proposedStage === opportunity.stage) {
      return {
        outcome: terminalFlag ? "review" : "unchanged",
        detail: {
          currentStage: opportunity.stage,
          terminalFlag,
        },
      };
    }
    if (
      !isAllowedAutomatedEmailStageTransition(opportunity.stage, proposedStage)
    ) {
      return {
        outcome: "skipped",
        detail: {
          reason: "automated_transition_not_allowed",
          proposedStage,
        },
      };
    }

    const applied = await recordAndApplyPhaseCStageDecision({
      supabase: this.supabase,
      companyId: work.companyId,
      opportunityId: work.opportunityId,
      sourceEventId: decisionEvidence.sourceEventId,
      evidenceEventIds: decisionEvidence.evidenceEventIds,
      evidenceMessageIds: decisionEvidence.evidenceMessageIds,
      proposedStage,
      expectedStage: opportunity.stage,
      expectedAssignmentVersion: opportunity.assignment_version,
      confidence,
      reason: existingDecision?.reason ?? "durable_model_stage_classification",
      decisionKey: "durable_active_stage",
    });
    return {
      outcome: applied.changed ? "applied" : "skipped",
      detail: {
        proposedStage,
        resultingStage: applied.stage,
        guardReason: applied.guardReason,
      },
    };
  }

  private async evaluateCommercialOutcome(
    work: ClaimedPhaseCLeadIntelligenceWork
  ): Promise<PhaseCLeadIntelligenceComponentResult> {
    const connection = await this.connection(work);
    const outcome = await evaluateOpportunityCommercialOutcome({
      supabase: this.supabase as SupabaseClient,
      opportunityId: work.opportunityId,
      connection,
    });
    return {
      outcome: outcome.stageChanged ? "applied" : "unchanged",
      detail: { stageChanged: outcome.stageChanged },
    };
  }

  private async evaluateEventHandoff(
    work: ClaimedPhaseCLeadIntelligenceWork
  ): Promise<PhaseCLeadIntelligenceComponentResult> {
    const context = await this.context(work, "opportunity");
    const evaluation = evaluatePhaseCBilateralEvent({
      messages: context.eventMessages,
      defaultTimeZone: context.company.timezone,
      requestedOwnerUserId:
        context.opportunity.assigned_to ?? context.connection.userId,
      leadTitle: context.opportunity.title,
      leadAddress: context.opportunity.address,
      operatorEmails: context.operatorEmails,
      customerEmails: context.relationshipConflict
        ? []
        : context.customerEmails,
    });
    if (evaluation.status === "none") {
      return { outcome: "skipped", detail: { reason: "no_event_intent" } };
    }
    const handoff = await persistPhaseCBilateralEventHandoff({
      supabase: this.supabase,
      companyId: work.companyId,
      opportunityId: work.opportunityId,
      evaluation,
    });
    return {
      outcome: evaluation.status === "ready" ? "applied" : "review",
      detail: {
        handoffId: handoff.id,
        handoffStatus: handoff.status,
        reviewReason: evaluation.reviewReason,
      },
    };
  }

  private async loadContext(
    work: ClaimedPhaseCLeadIntelligenceWork,
    scope: "source_thread" | "opportunity"
  ): Promise<DurableContext> {
    const [
      opportunityResponse,
      companyResponse,
      connection,
      events,
      activities,
    ] = await Promise.all([
      this.supabase
        .from("opportunities")
        .select(
          "id, company_id, title, address, contact_email, client_id, client_ref, stage, assignment_version, assigned_to"
        )
        .eq("company_id", work.companyId)
        .eq("id", work.opportunityId)
        .is("deleted_at", null)
        .maybeSingle(),
      this.supabase
        .from("companies")
        .select("id, name, timezone")
        .eq("id", work.companyId)
        .maybeSingle(),
      this.connection(work),
      allPages<CorrespondenceEventRow>(
        (from, to) => {
          let query = this.supabase
            .from("opportunity_correspondence_events")
            .select(
              "id, activity_id, connection_id, provider_thread_id, provider_message_id, direction, from_email, to_emails, cc_emails, subject, occurred_at"
            )
            .eq("company_id", work.companyId)
            .eq("opportunity_id", work.opportunityId)
            .eq("is_meaningful", true)
            .eq("opportunity_projection_applied", true);
          if (scope === "source_thread") {
            query = query
              .eq("connection_id", work.requiredConnectionId)
              .eq("provider_thread_id", work.requiredProviderThreadId);
          }
          return query
            .order("occurred_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to);
        },
        "Phase C correspondence evidence lookup"
      ),
      allPages<ActivityRow>(
        (from, to) =>
          this.supabase
            .from("activities")
            .select(
              "id, email_connection_id, email_thread_id, email_message_id, direction, subject, body_text, body_text_clean, to_emails, cc_emails"
            )
            .eq("company_id", work.companyId)
            .eq("opportunity_id", work.opportunityId)
            .eq("type", "email")
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        "Phase C activity evidence lookup"
      ),
    ]);
    if (opportunityResponse.error || !opportunityResponse.data) {
      throw new Error(
        `Phase C opportunity lookup failed: ${opportunityResponse.error?.message ?? "not found"}`
      );
    }
    if (companyResponse.error || !companyResponse.data) {
      throw new Error(
        `Phase C company lookup failed: ${companyResponse.error?.message ?? "not found"}`
      );
    }
    if (!connection || connection.companyId !== work.companyId) {
      throw new Error("Phase C work email connection is missing or mismatched");
    }
    if (!events.some((event) => event.id === work.requiredEventId)) {
      throw new Error("Phase C required evidence event is not projected");
    }

    const activitiesById = new Map(activities.map((row) => [row.id, row]));
    const activitiesByMessage = new Map<string, ActivityRow[]>();
    for (const activity of activities) {
      const key = activityMessageKey(
        activity.email_connection_id,
        activity.email_message_id
      );
      if (!key) continue;
      const matches = activitiesByMessage.get(key) ?? [];
      matches.push(activity);
      activitiesByMessage.set(key, matches);
    }
    const resolved = events.map((event) => ({
      event,
      activity: exactActivityForEvent({
        event,
        activitiesById,
        activitiesByMessage,
      }),
    }));
    const messages = resolved.map(normalizedMessage);
    const eventMessages = resolved.map<PhaseCEventMessage>(
      ({ event, activity }) => ({
        eventId: event.id,
        providerMessageId: event.provider_message_id!,
        direction: event.direction,
        occurredAt: event.occurred_at,
        fromEmail: event.from_email,
        toEmails: event.to_emails ?? [],
        ccEmails: event.cc_emails ?? [],
        subject: activity.subject ?? event.subject,
        body: activity.body_text_clean ?? activity.body_text ?? "",
      })
    );
    const opportunity = opportunityResponse.data as OpportunityRow;
    const operator = await fetchOperatorIdentity(work.companyId, connection);
    const customer = await loadCustomerEmails({
      supabase: this.supabase,
      opportunity,
    });

    return {
      opportunity,
      company: {
        name: rowString(companyResponse.data.name) ?? "Unknown company",
        timezone:
          rowString(companyResponse.data.timezone) ?? "America/Vancouver",
      },
      connection,
      messages,
      eventMessages,
      operatorEmails: normalizedEmails([...operator.emails]),
      customerEmails: customer.emails,
      relationshipConflict: customer.relationshipConflict,
    };
  }
}

export function createPhaseCLeadIntelligenceWorkService(input: {
  supabase: PhaseCRuntimeSupabase;
}): PhaseCLeadIntelligenceWorkService {
  const processor = new PhaseCLeadIntelligenceRuntimeProcessor(input.supabase);
  const dependencies: PhaseCLeadIntelligenceWorkDependencies = {
    workerId: () => `phase-c-lead-intelligence:${randomUUID()}`,
    async claim({ workerId, limit, leaseSeconds }) {
      const response = await input.supabase.rpc(
        "claim_opportunity_phase_c_work",
        {
          p_worker_id: workerId,
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        }
      );
      if (response.error) {
        throw new Error(
          `Phase C work claim failed: ${response.error.message ?? "unknown error"}`
        );
      }
      return ((response.data ?? []) as Array<Record<string, unknown>>).map(
        (row) => ({
          companyId: row.company_id as string,
          opportunityId: row.opportunity_id as string,
          requiredEventId: row.required_event_id as string,
          requiredEventAt: row.required_event_at as string,
          requiredActivityId:
            (row.required_activity_id as string | null) ?? null,
          requiredConnectionId:
            (row.required_connection_id as string | null) ?? null,
          requiredProviderThreadId: row.required_provider_thread_id as string,
          attemptCount: Number(row.attempt_count ?? 1),
          componentOutcomes:
            (row.component_outcomes as Record<string, unknown> | null) ?? {},
          componentErrors:
            (row.component_errors as Record<string, unknown> | null) ?? {},
        })
      );
    },
    isComponentComplete(work, component) {
      const outcome = work.componentOutcomes[component] as
        | { event_id?: unknown }
        | undefined;
      return outcome?.event_id === work.requiredEventId;
    },
    processComponent: (componentInput) =>
      processor.processComponent(componentInput),
    async acknowledge(acknowledgement) {
      const response = await input.supabase.rpc(
        "acknowledge_opportunity_phase_c_component",
        {
          p_company_id: acknowledgement.companyId,
          p_opportunity_id: acknowledgement.opportunityId,
          p_expected_required_event_id: acknowledgement.expectedRequiredEventId,
          p_worker_id: acknowledgement.workerId,
          p_component: acknowledgement.component,
          p_outcome: acknowledgement.outcome,
          p_detail: acknowledgement.detail,
        }
      );
      if (response.error) {
        throw new Error(
          `Phase C work acknowledgement failed: ${response.error.message ?? "unknown error"}`
        );
      }
      const disposition = rowString(response.data);
      if (
        disposition !== "acknowledged" &&
        disposition !== "completed" &&
        disposition !== "superseded" &&
        disposition !== "lease_lost"
      ) {
        throw new Error("Phase C work acknowledgement returned no disposition");
      }
      return disposition;
    },
    async fail(failure) {
      const response = await input.supabase.rpc(
        "fail_opportunity_phase_c_work",
        {
          p_company_id: failure.companyId,
          p_opportunity_id: failure.opportunityId,
          p_expected_required_event_id: failure.expectedRequiredEventId,
          p_worker_id: failure.workerId,
          p_error_code: failure.errorCode,
          p_error_message: failure.errorMessage,
          p_retry_seconds: failure.retrySeconds,
          p_component_errors: failure.componentErrors,
        }
      );
      if (response.error) {
        throw new Error(
          `Phase C work failure persistence failed: ${response.error.message ?? "unknown error"}`
        );
      }
      const disposition = rowString(response.data);
      if (
        disposition !== "retry_scheduled" &&
        disposition !== "superseded" &&
        disposition !== "lease_lost"
      ) {
        throw new Error("Phase C work failure returned no disposition");
      }
      return disposition;
    },
  };
  return new PhaseCLeadIntelligenceWorkService(dependencies);
}
