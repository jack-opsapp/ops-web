import type {
  LeadLifecycleSettings,
  OpportunityLifecycleDecision,
  OpportunityLifecycleDecisionAction,
  OpportunityLifecycleStateInput,
} from "@/lib/email/opportunity-lifecycle-evaluator";
import { DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT } from "@/lib/email/opportunity-lifecycle-evaluator";

interface ActionSupabaseLike {
  from: (table: string) => any;
  rpc?: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
}

export type OpportunityLifecycleExecutionMode = "dry-run" | "apply";

export interface OpportunityLifecycleActionEvent {
  id: string | null;
  direction: "inbound" | "outbound";
  isMeaningful: boolean;
  occurredAt: string | Date;
  connectionId?: string | null;
  providerThreadId?: string | null;
  linkedContactKind?: string | null;
}

export interface OpportunityLifecycleActionState
  extends OpportunityLifecycleStateInput {
  lastMeaningfulEventId?: string | null;
  lastMeaningfulDirection?: "inbound" | "outbound" | string | null;
  staleStatus?: string | null;
  staleStatusAt?: string | Date | null;
}

export interface OpportunityLifecycleActionOpportunity {
  id: string;
  companyId: string;
  stage: string | null;
  archivedAt?: string | Date | null;
  deletedAt?: string | Date | null;
  projectId?: string | null;
  projectRef?: string | null;
  lostReason?: string | null;
  lostNotes?: string | null;
  actualCloseDate?: string | Date | null;
}

export interface OpportunityLifecycleActionInput {
  supabase: ActionSupabaseLike;
  mode?: OpportunityLifecycleExecutionMode;
  companyId: string;
  opportunityId: string;
  opportunityTitle?: string | null;
  decision: OpportunityLifecycleDecision;
  lifecycleState: OpportunityLifecycleActionState | null;
  settings: LeadLifecycleSettings;
  latestMeaningfulEvent?: OpportunityLifecycleActionEvent | null;
  operatorUserId?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  opportunity?: OpportunityLifecycleActionOpportunity | null;
  approvedActionKey?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | Date | null;
  runId?: string | null;
  now?: Date;
}

export interface MeaningfulInboundResetInput {
  supabase: ActionSupabaseLike;
  mode?: OpportunityLifecycleExecutionMode;
  companyId: string;
  opportunityId: string;
  eventId: string | null;
  occurredAt: string | Date;
  now?: Date;
}

export type DraftOperation =
  | "not_applicable"
  | "would_create"
  | "created"
  | "skipped_existing_open_template"
  | "skipped_missing_source_event"
  | "skipped_lifecycle_state_failed"
  | "skipped_insert_failed";

export type NotificationOperation =
  | "not_applicable"
  | "would_create"
  | "created"
  | "skipped_existing_unread"
  | "skipped_missing_operator"
  | "skipped_insert_failed";

export type LifecycleStateOperation =
  | "not_applicable"
  | "would_update"
  | "updated"
  | "skipped_existing_state"
  | "skipped_update_failed";

export type OpportunityMutationOperation =
  | "not_applicable"
  | "would_archive"
  | "archived"
  | "would_move_to_lost"
  | "moved_to_lost"
  | "would_reactivate"
  | "reactivated"
  | "skipped_missing_opportunity"
  | "skipped_missing_approval"
  | "skipped_already_archived"
  | "skipped_not_archived"
  | "skipped_terminal_or_protected_stage"
  | "skipped_deleted"
  | "skipped_converted_or_project_linked"
  | "skipped_lost_stage_not_allowed"
  | "skipped_missing_related_inbound"
  | "skipped_duplicate_applied_action"
  | "skipped_update_failed";

export type AuditOperation =
  | "not_applicable"
  | "would_record"
  | "recorded"
  | "skipped_insert_failed";

export type OpportunityLifecycleActionAuditStatus =
  | "skipped"
  | "applied"
  | "failed";

export interface ProjectOpportunityLifecycleActionAuditRowInput {
  companyId: string;
  opportunityId: string;
  action: OpportunityLifecycleDecisionAction;
  approvedActionKey?: string | null;
  executionMode: OpportunityLifecycleExecutionMode;
  status: OpportunityLifecycleActionAuditStatus;
  guardReason?: string | null;
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
  decisionReason?: string | null;
  decisionEvidence?: Record<string, unknown> | null;
  approvedBy?: string | null;
  approvedAt?: string | Date | null;
  runId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface ProjectedOpportunityLifecycleActionAuditRow {
  company_id: string;
  opportunity_id: string;
  action: OpportunityLifecycleDecisionAction;
  approved_action_key: string | null;
  execution_mode: OpportunityLifecycleExecutionMode;
  status: OpportunityLifecycleActionAuditStatus;
  guard_reason: string | null;
  before_values: Record<string, unknown>;
  after_values: Record<string, unknown>;
  decision_reason: string | null;
  decision_evidence: Record<string, unknown>;
  approved_by: string | null;
  approved_at: string | null;
  run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  runner: "ops-web";
  approval_status: "dry_run_projection_not_approved" | "reviewed_apply_input";
}

export type OpportunityLifecycleActionSkipReason =
  | "no_action"
  | "ignored_decision"
  | "destructive_action_not_allowed"
  | "missing_source_event"
  | "missing_operator"
  | "missing_opportunity_snapshot"
  | "missing_approval"
  | "terminal_or_protected_stage"
  | "deleted_opportunity"
  | "converted_or_project_linked"
  | "already_archived"
  | "not_archived"
  | "lost_stage_not_allowed"
  | "missing_related_inbound"
  | "duplicate_applied_action"
  | "snapshot_mismatch"
  | "opportunity_update_failed"
  | "audit_insert_failed";

export interface OpportunityLifecycleActionResult {
  mode: OpportunityLifecycleExecutionMode;
  action: OpportunityLifecycleDecisionAction;
  opportunityId: string;
  applied: boolean;
  skippedReason?: OpportunityLifecycleActionSkipReason;
  guardReason?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
  operations: {
    draft: DraftOperation;
    notification: NotificationOperation;
    lifecycleState: LifecycleStateOperation;
    opportunity: OpportunityMutationOperation;
    audit: AuditOperation;
    supersededDrafts: number;
  };
  insertedIds?: {
    draftId?: string;
    notificationId?: string;
  };
}

const DESTRUCTIVE_ACTIONS = new Set<OpportunityLifecycleDecisionAction>([
  "archive_after_two_unanswered_followups",
  "archive_no_meaningful_correspondence",
  "move_to_lost_operator_no_response",
  "reactivate_on_related_inbound",
]);

type OpportunityLifecycleStaleStatus =
  | "follow_up_draft_due"
  | "operator_follow_up_miss";

const TEMPLATE_STALE_STATUS: OpportunityLifecycleStaleStatus = "follow_up_draft_due";
const OPERATOR_MISS_STALE_STATUS: OpportunityLifecycleStaleStatus =
  "operator_follow_up_miss";
const NOTIFICATION_TYPE = "leads_waiting";
const TERMINAL_OR_PROTECTED_STAGES = new Set([
  "won",
  "lost",
  "discarded",
  "deleted",
  "converted",
  "merged",
  "disqualified",
]);
const OPERATOR_NO_RESPONSE_LOST_STAGES = new Set([
  "quoting",
  "quoted",
  "follow_up",
  "negotiation",
]);
const RELATED_INBOUND_KINDS = new Set([
  "related_contact",
  "high_confidence_related_contact",
]);
const LOST_OPERATOR_NO_RESPONSE_NOTES =
  "Guarded lifecycle approval: customer inbound went unanswered past the no-response window.";

function modeOf(mode: OpportunityLifecycleExecutionMode | undefined) {
  return mode ?? "dry-run";
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizedText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | null {
  return typeof value === "string" ? normalizedText(value) : null;
}

function firstName(value: string | null | undefined): string {
  return normalizedText(value)?.split(/\s+/)[0] ?? "";
}

function cleanRenderedTemplate(value: string): string {
  return value.replace(/\s+([,.!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

function renderFollowUpBody(input: OpportunityLifecycleActionInput): string {
  const template = input.settings.followUpTemplateBody;
  const replacements: Record<string, string> = {
    first_name: firstName(input.contactName),
    opportunity_title: normalizedText(input.opportunityTitle) ?? "",
    company_name: normalizedText(input.companyName) ?? "",
  };

  return cleanRenderedTemplate(
    template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, token: string) => {
      return replacements[token.toLowerCase()] ?? "";
    })
  );
}

function latestSourceEventId(input: OpportunityLifecycleActionInput): string | null {
  return (
    normalizedText(input.latestMeaningfulEvent?.id ?? null) ??
    normalizedText(input.decision.evidence.latestEventId as string | null | undefined)
  );
}

function pipelineOpportunityUrl(opportunityId: string): string {
  return `/pipeline?opportunityId=${encodeURIComponent(opportunityId)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isSyntheticThreadContext(value: string): boolean {
  return value.includes(":");
}

interface NotificationActionTarget {
  actionUrl: string;
  actionLabel: string;
}

function inboxActionTarget(threadId: string): NotificationActionTarget {
  return {
    actionUrl: `/inbox/${encodeURIComponent(threadId)}`,
    actionLabel: "Open thread",
  };
}

function pipelineActionTarget(input: OpportunityLifecycleActionInput): NotificationActionTarget {
  return {
    actionUrl: pipelineOpportunityUrl(input.opportunityId),
    actionLabel: "Open opportunity",
  };
}

async function resolveInboxThreadId(
  input: OpportunityLifecycleActionInput,
  providerOrInternalThreadId: string
): Promise<string | null> {
  const connectionId = normalizedText(input.latestMeaningfulEvent?.connectionId ?? null);

  if (isUuid(providerOrInternalThreadId)) {
    let byIdQuery = input.supabase
      .from("email_threads")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("id", providerOrInternalThreadId);
    if (connectionId) byIdQuery = byIdQuery.eq("connection_id", connectionId);
    const byIdRows = await fetchRows(byIdQuery.limit(1));
    const byId = textValue(recordValue(byIdRows[0]).id);
    if (byId) return byId;
  }

  if (isSyntheticThreadContext(providerOrInternalThreadId)) return null;

  let byProviderQuery = input.supabase
    .from("email_threads")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("provider_thread_id", providerOrInternalThreadId);
  if (connectionId) byProviderQuery = byProviderQuery.eq("connection_id", connectionId);
  const byProviderRows = await fetchRows(byProviderQuery.limit(1));
  return textValue(recordValue(byProviderRows[0]).id);
}

async function notificationActionTarget(
  input: OpportunityLifecycleActionInput
): Promise<NotificationActionTarget> {
  const threadId = normalizedText(input.latestMeaningfulEvent?.providerThreadId ?? null);
  if (!threadId) return pipelineActionTarget(input);

  const inboxThreadId = await resolveInboxThreadId(input, threadId);
  return inboxThreadId ? inboxActionTarget(inboxThreadId) : pipelineActionTarget(input);
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function notificationTitle(input: OpportunityLifecycleActionInput): string {
  return `Lead reply waiting // ${shortId(input.opportunityId)}`;
}

function notificationBody(input: OpportunityLifecycleActionInput): string {
  const title = normalizedText(input.opportunityTitle) ?? "This lead";
  return `Customer replied on ${title}. OPS has not answered.`;
}

function operatorMissDedupeKey(input: OpportunityLifecycleActionInput): string {
  return `lead_lifecycle:operator_follow_up_miss:${input.opportunityId}`;
}

async function fetchRows(
  query: PromiseLike<{ data?: unknown[] | null; error?: unknown }>
): Promise<unknown[]> {
  const { data } = await query;
  return Array.isArray(data) ? data : [];
}

async function findOpenTemplateDraft(input: OpportunityLifecycleActionInput) {
  const rows = await fetchRows(
    input.supabase
      .from("opportunity_follow_up_drafts")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("opportunity_id", input.opportunityId)
      .eq("origin", "template_follow_up")
      .eq("status", "drafted")
      .limit(1)
  );
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function nextTemplateSequence(input: OpportunityLifecycleActionInput): Promise<number> {
  const rows = await fetchRows(
    input.supabase
      .from("opportunity_follow_up_drafts")
      .select("sequence_number")
      .eq("company_id", input.companyId)
      .eq("opportunity_id", input.opportunityId)
      .eq("origin", "template_follow_up")
      .eq("status", "sent")
  );
  const priorSentMax = rows.reduce<number>((max, row) => {
    const value = Number((row as Record<string, unknown>).sequence_number ?? 0);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  const trackedNext = Number(input.lifecycleState?.unansweredFollowUpCount ?? 0) + 1;
  return Math.max(1, trackedNext, priorSentMax + 1);
}

async function upsertLifecycleState(
  input: OpportunityLifecycleActionInput,
  staleStatus: OpportunityLifecycleStaleStatus
): Promise<LifecycleStateOperation> {
  const mode = modeOf(input.mode);
  const state = input.lifecycleState;
  const event = input.latestMeaningfulEvent ?? null;
  const lastMeaningfulEventId =
    normalizedText(state?.lastMeaningfulEventId ?? null) ??
    normalizedText(event?.id ?? null);
  const lastMeaningfulDirection =
    normalizedText(state?.lastMeaningfulDirection ?? null) ??
    normalizedText(event?.direction ?? null);
  const stateAlreadyMatches =
    state?.staleStatus === staleStatus &&
    (!lastMeaningfulEventId ||
      normalizedText(state.lastMeaningfulEventId ?? null) === lastMeaningfulEventId) &&
    (!lastMeaningfulDirection ||
      normalizedText(state.lastMeaningfulDirection ?? null) === lastMeaningfulDirection);

  if (stateAlreadyMatches) return "skipped_existing_state";
  if (mode === "dry-run") return "would_update";

  const now = (input.now ?? new Date()).toISOString();
  const row: Record<string, unknown> = {
    opportunity_id: input.opportunityId,
    company_id: input.companyId,
    stale_status: staleStatus,
    stale_status_at:
      input.lifecycleState?.staleStatus === staleStatus && input.lifecycleState.staleStatusAt
        ? iso(input.lifecycleState.staleStatusAt)
        : now,
    updated_at: now,
  };

  if (lastMeaningfulEventId) row.last_meaningful_event_id = lastMeaningfulEventId;

  const lastMeaningfulAt =
    input.lifecycleState?.lastMeaningfulAt ?? event?.occurredAt ?? null;
  if (lastMeaningfulAt) row.last_meaningful_at = iso(lastMeaningfulAt);

  if (lastMeaningfulDirection) row.last_meaningful_direction = lastMeaningfulDirection;

  row.unanswered_follow_up_count = Number(
    input.lifecycleState?.unansweredFollowUpCount ?? 0
  );

  if (input.lifecycleState?.secondFollowUpSentAt) {
    row.second_follow_up_sent_at = iso(input.lifecycleState.secondFollowUpSentAt);
  }

  if (staleStatus === OPERATOR_MISS_STALE_STATUS) {
    row.operator_follow_up_miss_at = input.lifecycleState?.operatorFollowUpMissAt
      ? iso(input.lifecycleState.operatorFollowUpMissAt)
      : now;
  }

  const { error } = await input.supabase
    .from("opportunity_lifecycle_state")
    .upsert(row, { onConflict: "opportunity_id" });

  return error ? "skipped_update_failed" : "updated";
}

async function createTemplateFollowUpDraft(
  input: OpportunityLifecycleActionInput
): Promise<
  Pick<
    OpportunityLifecycleActionResult,
    "operations" | "applied" | "skippedReason" | "insertedIds"
  >
> {
  const mode = modeOf(input.mode);
  const existing = await findOpenTemplateDraft(input);
  if (existing) {
    const lifecycleState = await upsertLifecycleState(input, TEMPLATE_STALE_STATUS);
    return {
      applied: lifecycleState === "updated",
      operations: {
        draft: "skipped_existing_open_template",
        notification: "not_applicable",
        lifecycleState,
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  const sourceEventId = latestSourceEventId(input);
  if (!sourceEventId) {
    return {
      applied: false,
      skippedReason: "missing_source_event",
      operations: {
        draft: "skipped_missing_source_event",
        notification: "not_applicable",
        lifecycleState: "not_applicable",
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  if (mode === "dry-run") {
    return {
      applied: false,
      operations: {
        draft: "would_create",
        notification: "not_applicable",
        lifecycleState: "would_update",
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  const body = renderFollowUpBody(input);
  const sequence = await nextTemplateSequence(input);
  const subject =
    normalizedText(input.settings.followUpTemplateSubject) ??
    DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT;
  const lifecycleState = await upsertLifecycleState(input, TEMPLATE_STALE_STATUS);
  if (lifecycleState === "skipped_update_failed") {
    return {
      applied: false,
      operations: {
        draft: "skipped_lifecycle_state_failed",
        notification: "not_applicable",
        lifecycleState,
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  const { data, error } = await input.supabase
    .from("opportunity_follow_up_drafts")
    .insert({
      company_id: input.companyId,
      opportunity_id: input.opportunityId,
      connection_id: input.latestMeaningfulEvent?.connectionId ?? null,
      provider_thread_id: input.latestMeaningfulEvent?.providerThreadId ?? null,
      source_event_id: sourceEventId,
      origin: "template_follow_up",
      sequence_number: sequence,
      subject,
      original_body: body,
      current_body: body,
      status: "drafted",
      provider_draft_id: null,
      ai_draft_history_id: null,
      created_by: null,
      edited_by: null,
    })
    .select("id")
    .single();
  const draftId = textValue(recordValue(data).id);

  return {
    applied: !error,
    operations: {
      draft: error ? "skipped_insert_failed" : "created",
      notification: "not_applicable",
      lifecycleState,
      opportunity: "not_applicable",
      audit: "not_applicable",
      supersededDrafts: 0,
    },
    insertedIds: !error && draftId ? { draftId } : undefined,
  };
}

async function findExistingOperatorMissNotification(
  input: OpportunityLifecycleActionInput
) {
  if (!input.operatorUserId) return null;
  const rows = await fetchRows(
    input.supabase
      .from("notifications")
      .select("id")
      .eq("user_id", input.operatorUserId)
      .eq("company_id", input.companyId)
      .eq("type", NOTIFICATION_TYPE)
      .eq("dedupe_key", operatorMissDedupeKey(input))
      .eq("is_read", false)
      .is("resolved_at", null)
      .limit(1)
  );
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function createOperatorFollowUpMissNotification(
  input: OpportunityLifecycleActionInput
): Promise<
  Pick<
    OpportunityLifecycleActionResult,
    "operations" | "applied" | "skippedReason" | "insertedIds"
  >
> {
  const mode = modeOf(input.mode);
  if (!input.operatorUserId) {
    return {
      applied: false,
      skippedReason: "missing_operator",
      operations: {
        draft: "not_applicable",
        notification: "skipped_missing_operator",
        lifecycleState: "not_applicable",
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  const existing = await findExistingOperatorMissNotification(input);
  if (existing) {
    const lifecycleState = await upsertLifecycleState(input, OPERATOR_MISS_STALE_STATUS);
    return {
      applied: lifecycleState === "updated",
      operations: {
        draft: "not_applicable",
        notification: "skipped_existing_unread",
        lifecycleState,
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  if (mode === "dry-run") {
    return {
      applied: false,
      operations: {
        draft: "not_applicable",
        notification: "would_create",
        lifecycleState: "would_update",
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  const actionTarget = await notificationActionTarget(input);
  const { data, error } = await input.supabase
    .from("notifications")
    .insert({
      user_id: input.operatorUserId,
      company_id: input.companyId,
      type: NOTIFICATION_TYPE,
      title: notificationTitle(input),
      body: notificationBody(input),
      is_read: false,
      persistent: true,
      action_url: actionTarget.actionUrl,
      action_label: actionTarget.actionLabel,
      project_id: null,
      note_id: null,
      dedupe_key: operatorMissDedupeKey(input),
      resolved_at: null,
    })
    .select("id")
    .single();
  const notificationId = textValue(recordValue(data).id);
  const lifecycleState = error
    ? "not_applicable"
    : await upsertLifecycleState(input, OPERATOR_MISS_STALE_STATUS);

  return {
    applied: !error && lifecycleState !== "skipped_update_failed",
    operations: {
      draft: "not_applicable",
      notification: error ? "skipped_insert_failed" : "created",
      lifecycleState,
      opportunity: "not_applicable",
      audit: "not_applicable",
      supersededDrafts: 0,
    },
    insertedIds: !error && notificationId ? { notificationId } : undefined,
  };
}

function dateOnly(value: Date | string): string {
  return iso(value).slice(0, 10);
}

function stageOf(opportunity: OpportunityLifecycleActionOpportunity): string {
  return opportunity.stage?.trim().toLowerCase() ?? "";
}

function opportunityMutationValues(
  input: OpportunityLifecycleActionInput
): {
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
} {
  const opportunity = input.opportunity;
  if (!opportunity) {
    return { beforeValues: {}, afterValues: {} };
  }

  const now = input.now ?? new Date();
  const action = input.decision.action;
  if (
    action === "archive_after_two_unanswered_followups" ||
    action === "archive_no_meaningful_correspondence"
  ) {
    const beforeValues = {
      archived_at: opportunity.archivedAt ? iso(opportunity.archivedAt) : null,
    };
    return {
      beforeValues,
      afterValues: { archived_at: now.toISOString() },
    };
  }

  if (action === "move_to_lost_operator_no_response") {
    const beforeValues = {
      stage: opportunity.stage ?? null,
      lost_reason: opportunity.lostReason ?? null,
      lost_notes: opportunity.lostNotes ?? null,
      actual_close_date: opportunity.actualCloseDate
        ? dateOnly(opportunity.actualCloseDate)
        : null,
    };
    return {
      beforeValues,
      afterValues: {
        stage: "lost",
        lost_reason: "operator_no_response",
        lost_notes: LOST_OPERATOR_NO_RESPONSE_NOTES,
        actual_close_date: dateOnly(now),
      },
    };
  }

  if (action === "reactivate_on_related_inbound") {
    const beforeValues = {
      archived_at: opportunity.archivedAt ? iso(opportunity.archivedAt) : null,
    };
    return {
      beforeValues,
      afterValues: { archived_at: null },
    };
  }

  return { beforeValues: {}, afterValues: {} };
}

function approvedActionKey(input: OpportunityLifecycleActionInput): string | null {
  return normalizedText(input.approvedActionKey ?? null);
}

export function projectOpportunityLifecycleActionAuditRow(
  input: ProjectOpportunityLifecycleActionAuditRowInput
): ProjectedOpportunityLifecycleActionAuditRow {
  return {
    company_id: input.companyId,
    opportunity_id: input.opportunityId,
    action: input.action,
    approved_action_key: normalizedText(input.approvedActionKey ?? null),
    execution_mode: input.executionMode,
    status: input.status,
    guard_reason: normalizedText(input.guardReason ?? null),
    before_values: input.beforeValues,
    after_values: input.afterValues,
    decision_reason: normalizedText(input.decisionReason ?? null),
    decision_evidence: recordValue(input.decisionEvidence ?? {}),
    approved_by: normalizedText(input.approvedBy ?? null),
    approved_at: input.approvedAt ? iso(input.approvedAt) : null,
    run_id: normalizedText(input.runId ?? null),
    error_code: normalizedText(input.errorCode ?? null),
    error_message: normalizedText(input.errorMessage ?? null),
    runner: "ops-web",
    approval_status:
      input.executionMode === "dry-run"
        ? "dry_run_projection_not_approved"
        : "reviewed_apply_input",
  };
}

function isRelatedMeaningfulInbound(input: OpportunityLifecycleActionInput): boolean {
  const event = input.latestMeaningfulEvent;
  if (!event || event.direction !== "inbound" || !event.isMeaningful) return false;
  return RELATED_INBOUND_KINDS.has(
    event.linkedContactKind?.trim().toLowerCase() ?? ""
  );
}

function opportunityOperationForAction(
  action: OpportunityLifecycleDecisionAction,
  mode: OpportunityLifecycleExecutionMode
): OpportunityMutationOperation {
  if (
    action === "archive_after_two_unanswered_followups" ||
    action === "archive_no_meaningful_correspondence"
  ) {
    return mode === "dry-run" ? "would_archive" : "archived";
  }
  if (action === "move_to_lost_operator_no_response") {
    return mode === "dry-run" ? "would_move_to_lost" : "moved_to_lost";
  }
  if (action === "reactivate_on_related_inbound") {
    return mode === "dry-run" ? "would_reactivate" : "reactivated";
  }
  return "not_applicable";
}

function guardDestructiveOpportunityAction(
  input: OpportunityLifecycleActionInput
): {
  reason: OpportunityLifecycleActionSkipReason;
  operation: OpportunityMutationOperation;
} | null {
  const opportunity = input.opportunity;
  if (!opportunity) {
    return {
      reason: "missing_opportunity_snapshot",
      operation: "skipped_missing_opportunity",
    };
  }

  const action = input.decision.action;
  const stage = stageOf(opportunity);
  if (TERMINAL_OR_PROTECTED_STAGES.has(stage)) {
    return {
      reason: "terminal_or_protected_stage",
      operation: "skipped_terminal_or_protected_stage",
    };
  }

  if (opportunity.deletedAt) {
    return {
      reason: "deleted_opportunity",
      operation: "skipped_deleted",
    };
  }

  if (
    normalizedText(opportunity.projectId ?? null) ||
    normalizedText(opportunity.projectRef ?? null)
  ) {
    return {
      reason: "converted_or_project_linked",
      operation: "skipped_converted_or_project_linked",
    };
  }

  if (
    (action === "archive_after_two_unanswered_followups" ||
      action === "archive_no_meaningful_correspondence" ||
      action === "move_to_lost_operator_no_response") &&
    opportunity.archivedAt
  ) {
    return {
      reason: "already_archived",
      operation: "skipped_already_archived",
    };
  }

  if (action === "move_to_lost_operator_no_response") {
    if (!OPERATOR_NO_RESPONSE_LOST_STAGES.has(stage)) {
      return {
        reason: "lost_stage_not_allowed",
        operation: "skipped_lost_stage_not_allowed",
      };
    }
  }

  if (action === "reactivate_on_related_inbound") {
    if (!opportunity.archivedAt) {
      return {
        reason: "not_archived",
        operation: "skipped_not_archived",
      };
    }
    if (!isRelatedMeaningfulInbound(input)) {
      return {
        reason: "missing_related_inbound",
        operation: "skipped_missing_related_inbound",
      };
    }
  }

  return null;
}

async function findAppliedActionAudit(
  input: OpportunityLifecycleActionInput
): Promise<Record<string, unknown> | null> {
  const key = approvedActionKey(input);
  if (!key) return null;
  const rows = await fetchRows(
    input.supabase
      .from("opportunity_lifecycle_action_audit")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("opportunity_id", input.opportunityId)
      .eq("action", input.decision.action)
      .eq("approved_action_key", key)
      .eq("status", "applied")
      .limit(1)
  );
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function recordActionAudit(input: {
  actionInput: OpportunityLifecycleActionInput;
  status: "skipped" | "applied" | "failed";
  guardReason: OpportunityLifecycleActionSkipReason | null;
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<AuditOperation> {
  const mode = modeOf(input.actionInput.mode);
  if (mode === "dry-run") return "would_record";

  const { error } = await input.actionInput.supabase
    .from("opportunity_lifecycle_action_audit")
    .insert({
      company_id: input.actionInput.companyId,
      opportunity_id: input.actionInput.opportunityId,
      action: input.actionInput.decision.action,
      approved_action_key: approvedActionKey(input.actionInput),
      execution_mode: mode,
      status: input.status,
      guard_reason: input.guardReason,
      before_values: input.beforeValues,
      after_values: input.afterValues,
      decision_reason: input.actionInput.decision.reason,
      decision_evidence: input.actionInput.decision.evidence,
      approved_by: normalizedText(input.actionInput.approvedBy ?? null),
      approved_at: input.actionInput.approvedAt
        ? iso(input.actionInput.approvedAt)
        : null,
      run_id: normalizedText(input.actionInput.runId ?? null),
      error_code: normalizedText(input.errorCode ?? null),
      error_message: normalizedText(input.errorMessage ?? null),
      runner: "ops-web",
    });

  return error ? "skipped_insert_failed" : "recorded";
}

async function executeGuardedOpportunityActionRpc(
  input: OpportunityLifecycleActionInput,
  beforeValues: Record<string, unknown>,
  afterValues: Record<string, unknown>
): Promise<{
  applied: boolean;
  audit: AuditOperation;
  skippedReason?: OpportunityLifecycleActionSkipReason;
  guardReason?: string;
  opportunityOperation?: OpportunityMutationOperation;
  errorCode?: string | null;
  errorMessage?: string | null;
}> {
  const opportunity = input.opportunity;
  if (!opportunity || !input.supabase.rpc) {
    return {
      applied: false,
      audit: "skipped_insert_failed",
      skippedReason: "audit_insert_failed",
      opportunityOperation: "skipped_update_failed",
    };
  }

  const { data, error } = await input.supabase.rpc(
    "execute_opportunity_lifecycle_guarded_action",
    {
      p_company_id: input.companyId,
      p_opportunity_id: input.opportunityId,
      p_action: input.decision.action,
      p_approved_action_key: approvedActionKey(input),
      p_expected_stage: opportunity.stage ?? null,
      p_expected_archived_at: opportunity.archivedAt
        ? iso(opportunity.archivedAt)
        : null,
      p_expected_deleted_at: opportunity.deletedAt ? iso(opportunity.deletedAt) : null,
      p_expected_project_id: normalizedText(opportunity.projectId ?? null),
      p_expected_project_ref: normalizedText(opportunity.projectRef ?? null),
      p_before_values: beforeValues,
      p_after_values: afterValues,
      p_decision_reason: input.decision.reason,
      p_decision_evidence: input.decision.evidence,
      p_approved_by: normalizedText(input.approvedBy ?? null),
      p_approved_at: input.approvedAt ? iso(input.approvedAt) : null,
      p_run_id: normalizedText(input.runId ?? null),
      p_runner: "ops-web",
    }
  );

  if (error) {
    return {
      applied: false,
      audit: "skipped_insert_failed",
      skippedReason: "audit_insert_failed",
      opportunityOperation: "skipped_update_failed",
      errorMessage: normalizedText(error.message ?? null),
    };
  }

  const payload = recordValue(data);
  if (payload.applied !== true) {
    const guardReason =
      textValue(payload.guard_reason) ??
      textValue(payload.error_code) ??
      "opportunity_update_failed";

    return {
      applied: false,
      audit: "recorded",
      skippedReason: skipReasonForRpcGuardReason(guardReason),
      guardReason,
      opportunityOperation: opportunityOperationForRpcGuardReason(guardReason),
      errorCode: textValue(payload.error_code) ?? guardReason,
      errorMessage: textValue(payload.error_message),
    };
  }

  return { applied: true, audit: "recorded" };
}

function skipReasonForRpcGuardReason(
  guardReason: string
): OpportunityLifecycleActionSkipReason {
  switch (guardReason) {
    case "missing_opportunity_snapshot":
      return "missing_opportunity_snapshot";
    case "duplicate_applied_action":
      return "duplicate_applied_action";
    case "terminal_or_protected_stage":
      return "terminal_or_protected_stage";
    case "deleted_opportunity":
      return "deleted_opportunity";
    case "converted_or_project_linked":
      return "converted_or_project_linked";
    case "lost_stage_not_allowed":
      return "lost_stage_not_allowed";
    case "missing_related_inbound":
      return "missing_related_inbound";
    case "already_archived":
      return "already_archived";
    case "not_archived":
      return "not_archived";
    case "missing_approval":
      return "missing_approval";
    case "snapshot_mismatch":
    case "opportunity_snapshot_mismatch":
      return "snapshot_mismatch";
    default:
      return "opportunity_update_failed";
  }
}

function opportunityOperationForRpcGuardReason(
  guardReason: string
): OpportunityMutationOperation {
  switch (guardReason) {
    case "missing_opportunity_snapshot":
      return "skipped_missing_opportunity";
    case "duplicate_applied_action":
      return "skipped_duplicate_applied_action";
    case "terminal_or_protected_stage":
      return "skipped_terminal_or_protected_stage";
    case "deleted_opportunity":
      return "skipped_deleted";
    case "converted_or_project_linked":
      return "skipped_converted_or_project_linked";
    case "lost_stage_not_allowed":
      return "skipped_lost_stage_not_allowed";
    case "missing_related_inbound":
      return "skipped_missing_related_inbound";
    case "already_archived":
      return "skipped_already_archived";
    case "not_archived":
      return "skipped_not_archived";
    case "missing_approval":
      return "skipped_missing_approval";
    default:
      return "skipped_update_failed";
  }
}

async function executeDestructiveOpportunityAction(
  input: OpportunityLifecycleActionInput
): Promise<
  Pick<
    OpportunityLifecycleActionResult,
    | "operations"
    | "applied"
    | "skippedReason"
    | "guardReason"
    | "errorCode"
    | "errorMessage"
    | "beforeValues"
    | "afterValues"
  >
> {
  const mode = modeOf(input.mode);
  const { beforeValues, afterValues } = opportunityMutationValues(input);
  const baseOperations = {
    draft: "not_applicable" as DraftOperation,
    notification: "not_applicable" as NotificationOperation,
    lifecycleState: "not_applicable" as LifecycleStateOperation,
    supersededDrafts: 0,
  };

  const guard = guardDestructiveOpportunityAction(input);
  if (guard) {
    const audit = await recordActionAudit({
      actionInput: input,
      status: "skipped",
      guardReason: guard.reason,
      beforeValues,
      afterValues: beforeValues,
      errorCode: guard.reason,
    });
    return {
      applied: false,
      skippedReason: guard.reason,
      beforeValues,
      afterValues: beforeValues,
      operations: {
        ...baseOperations,
        opportunity: guard.operation,
        audit,
      },
    };
  }

  if (mode === "apply" && !approvedActionKey(input)) {
    const audit = await recordActionAudit({
      actionInput: input,
      status: "skipped",
      guardReason: "missing_approval",
      beforeValues,
      afterValues: beforeValues,
      errorCode: "missing_approval",
    });
    return {
      applied: false,
      skippedReason: "missing_approval",
      beforeValues,
      afterValues: beforeValues,
      operations: {
        ...baseOperations,
        opportunity: "skipped_missing_approval",
        audit,
      },
    };
  }

  if (mode === "apply" && (await findAppliedActionAudit(input))) {
    return {
      applied: false,
      skippedReason: "duplicate_applied_action",
      beforeValues,
      afterValues: beforeValues,
      operations: {
        ...baseOperations,
        opportunity: "skipped_duplicate_applied_action",
        audit: "not_applicable",
      },
    };
  }

  if (mode === "dry-run") {
    return {
      applied: false,
      beforeValues,
      afterValues,
      operations: {
        ...baseOperations,
        opportunity: opportunityOperationForAction(input.decision.action, mode),
        audit: "would_record",
      },
    };
  }

  const rpcResult = await executeGuardedOpportunityActionRpc(
    input,
    beforeValues,
    afterValues
  );
  if (!rpcResult.applied) {
    return {
      applied: false,
      skippedReason:
        rpcResult.skippedReason ??
        (rpcResult.audit === "skipped_insert_failed"
          ? "audit_insert_failed"
          : "opportunity_update_failed"),
      guardReason: rpcResult.guardReason,
      errorCode: rpcResult.errorCode,
      errorMessage: rpcResult.errorMessage,
      beforeValues,
      afterValues: beforeValues,
      operations: {
        ...baseOperations,
        opportunity: rpcResult.opportunityOperation ?? "skipped_update_failed",
        audit: rpcResult.audit,
      },
    };
  }

  return {
    applied: true,
    beforeValues,
    afterValues,
    operations: {
      ...baseOperations,
      opportunity: opportunityOperationForAction(input.decision.action, mode),
      audit: rpcResult.audit,
    },
  };
}

export async function executeOpportunityLifecycleAction(
  input: OpportunityLifecycleActionInput
): Promise<OpportunityLifecycleActionResult> {
  const mode = modeOf(input.mode);
  const base = {
    mode,
    action: input.decision.action,
    opportunityId: input.opportunityId,
  };

  if (input.decision.ignored) {
    return {
      ...base,
      applied: false,
      skippedReason: "ignored_decision",
      operations: {
        draft: "not_applicable",
        notification: "not_applicable",
        lifecycleState: "not_applicable",
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  if (input.decision.action === "no_action") {
    return {
      ...base,
      applied: false,
      skippedReason: "no_action",
      operations: {
        draft: "not_applicable",
        notification: "not_applicable",
        lifecycleState: "not_applicable",
        opportunity: "not_applicable",
        audit: "not_applicable",
        supersededDrafts: 0,
      },
    };
  }

  if (DESTRUCTIVE_ACTIONS.has(input.decision.action)) {
    const result = await executeDestructiveOpportunityAction(input);
    return {
      ...base,
      ...result,
    };
  }

  const result =
    input.decision.action === "create_follow_up_draft"
      ? await createTemplateFollowUpDraft(input)
      : await createOperatorFollowUpMissNotification(input);

  return {
    ...base,
    ...result,
  };
}

export async function resetStaleLifecycleAfterMeaningfulInbound(
  input: MeaningfulInboundResetInput
): Promise<{
  mode: OpportunityLifecycleExecutionMode;
  applied: boolean;
  operations: {
    lifecycleState: LifecycleStateOperation;
    supersededDrafts: number;
    notificationsResolved: number;
  };
}> {
  const mode = modeOf(input.mode);
  const now = (input.now ?? new Date()).toISOString();
  const openTemplateDrafts = await fetchRows(
    input.supabase
      .from("opportunity_follow_up_drafts")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("opportunity_id", input.opportunityId)
      .eq("origin", "template_follow_up")
      .eq("status", "drafted")
  );
  const openLifecycleNotifications = await fetchRows(
    input.supabase
      .from("notifications")
      .select("id")
      .eq("company_id", input.companyId)
      .eq("type", NOTIFICATION_TYPE)
      .eq("dedupe_key", `lead_lifecycle:operator_follow_up_miss:${input.opportunityId}`)
      .eq("is_read", false)
      .is("resolved_at", null)
  );

  if (mode === "dry-run") {
    return {
      mode,
      applied: false,
      operations: {
        lifecycleState: "would_update",
        supersededDrafts: openTemplateDrafts.length,
        notificationsResolved: openLifecycleNotifications.length,
      },
    };
  }

  for (const draft of openTemplateDrafts) {
    const id = (draft as Record<string, unknown>).id as string | undefined;
    if (!id) continue;
    await input.supabase
      .from("opportunity_follow_up_drafts")
      .update({
        status: "superseded",
        superseded_at: now,
        updated_at: now,
      })
      .eq("id", id);
  }

  if (openLifecycleNotifications.length > 0) {
    await input.supabase
      .from("notifications")
      .update({
        is_read: true,
        resolved_at: now,
      })
      .eq("company_id", input.companyId)
      .eq("type", NOTIFICATION_TYPE)
      .eq(
        "dedupe_key",
        `lead_lifecycle:operator_follow_up_miss:${input.opportunityId}`
      )
      .eq("is_read", false)
      .is("resolved_at", null);
  }

  const { error } = await input.supabase
    .from("opportunity_lifecycle_state")
    .upsert(
      {
        opportunity_id: input.opportunityId,
        company_id: input.companyId,
        last_meaningful_event_id: input.eventId,
        last_meaningful_at: iso(input.occurredAt),
        last_meaningful_direction: "inbound",
        unanswered_follow_up_count: 0,
        second_follow_up_sent_at: null,
        operator_follow_up_miss_at: null,
        stale_status: null,
        stale_status_at: null,
        updated_at: now,
      },
      { onConflict: "opportunity_id" }
    );

  return {
    mode,
    applied: !error,
    operations: {
      lifecycleState: error ? "skipped_update_failed" : "updated",
      supersededDrafts: openTemplateDrafts.length,
      notificationsResolved: openLifecycleNotifications.length,
    },
  };
}
