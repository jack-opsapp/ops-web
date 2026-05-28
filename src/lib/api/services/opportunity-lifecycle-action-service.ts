import type {
  LeadLifecycleSettings,
  OpportunityLifecycleDecision,
  OpportunityLifecycleDecisionAction,
  OpportunityLifecycleStateInput,
} from "@/lib/email/opportunity-lifecycle-evaluator";

interface ActionSupabaseLike {
  from: (table: string) => any;
}

export type OpportunityLifecycleExecutionMode = "dry-run" | "apply";

export interface OpportunityLifecycleActionEvent {
  id: string | null;
  direction: "inbound" | "outbound";
  isMeaningful: boolean;
  occurredAt: string | Date;
  connectionId?: string | null;
  providerThreadId?: string | null;
}

export interface OpportunityLifecycleActionState
  extends OpportunityLifecycleStateInput {
  lastMeaningfulEventId?: string | null;
  lastMeaningfulDirection?: "inbound" | "outbound" | string | null;
  staleStatus?: string | null;
  staleStatusAt?: string | Date | null;
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
  | "skipped_update_failed";

export interface OpportunityLifecycleActionResult {
  mode: OpportunityLifecycleExecutionMode;
  action: OpportunityLifecycleDecisionAction;
  opportunityId: string;
  applied: boolean;
  skippedReason?:
    | "no_action"
    | "ignored_decision"
    | "destructive_action_not_allowed"
    | "missing_source_event"
    | "missing_operator";
  operations: {
    draft: DraftOperation;
    notification: NotificationOperation;
    lifecycleState: LifecycleStateOperation;
    supersededDrafts: number;
  };
}

const DESTRUCTIVE_ACTIONS = new Set<OpportunityLifecycleDecisionAction>([
  "archive_after_two_unanswered_followups",
  "archive_no_meaningful_correspondence",
  "move_to_lost_operator_no_response",
  "reactivate_on_related_inbound",
]);

const TEMPLATE_STALE_STATUS = "template_follow_up_drafted";
const OPERATOR_MISS_STALE_STATUS = "operator_follow_up_miss";
const NOTIFICATION_TYPE = "leads_waiting";

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

function actionUrlFor(input: OpportunityLifecycleActionInput): string {
  const threadId = normalizedText(input.latestMeaningfulEvent?.providerThreadId ?? null);
  return threadId ? `/inbox/${encodeURIComponent(threadId)}` : "/pipeline";
}

function actionLabelFor(input: OpportunityLifecycleActionInput): string {
  return normalizedText(input.latestMeaningfulEvent?.providerThreadId ?? null)
    ? "Open thread"
    : "Open pipeline";
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
  staleStatus: string
): Promise<LifecycleStateOperation> {
  const mode = modeOf(input.mode);
  if (mode === "dry-run") return "would_update";

  const now = (input.now ?? new Date()).toISOString();
  const event = input.latestMeaningfulEvent ?? null;
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

  const lastMeaningfulEventId =
    normalizedText(input.lifecycleState?.lastMeaningfulEventId ?? null) ??
    normalizedText(event?.id ?? null);
  if (lastMeaningfulEventId) row.last_meaningful_event_id = lastMeaningfulEventId;

  const lastMeaningfulAt =
    input.lifecycleState?.lastMeaningfulAt ?? event?.occurredAt ?? null;
  if (lastMeaningfulAt) row.last_meaningful_at = iso(lastMeaningfulAt);

  const lastMeaningfulDirection =
    normalizedText(input.lifecycleState?.lastMeaningfulDirection ?? null) ??
    normalizedText(event?.direction ?? null);
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
): Promise<Pick<OpportunityLifecycleActionResult, "operations" | "applied" | "skippedReason">> {
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
        supersededDrafts: 0,
      },
    };
  }

  const body = renderFollowUpBody(input);
  const sequence = await nextTemplateSequence(input);
  const { error } = await input.supabase.from("opportunity_follow_up_drafts").insert({
    company_id: input.companyId,
    opportunity_id: input.opportunityId,
    connection_id: input.latestMeaningfulEvent?.connectionId ?? null,
    provider_thread_id: input.latestMeaningfulEvent?.providerThreadId ?? null,
    source_event_id: sourceEventId,
    origin: "template_follow_up",
    sequence_number: sequence,
    subject: input.settings.followUpTemplateSubject ?? "",
    original_body: body,
    current_body: body,
    status: "drafted",
    provider_draft_id: null,
    ai_draft_history_id: null,
    created_by: null,
    edited_by: null,
  });
  const lifecycleState = error
    ? "not_applicable"
    : await upsertLifecycleState(input, TEMPLATE_STALE_STATUS);

  return {
    applied: !error && lifecycleState !== "skipped_update_failed",
    operations: {
      draft: error ? "skipped_insert_failed" : "created",
      notification: "not_applicable",
      lifecycleState,
      supersededDrafts: 0,
    },
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
      .eq("title", notificationTitle(input))
      .eq("is_read", false)
      .limit(1)
  );
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function createOperatorFollowUpMissNotification(
  input: OpportunityLifecycleActionInput
): Promise<Pick<OpportunityLifecycleActionResult, "operations" | "applied" | "skippedReason">> {
  const mode = modeOf(input.mode);
  if (!input.operatorUserId) {
    return {
      applied: false,
      skippedReason: "missing_operator",
      operations: {
        draft: "not_applicable",
        notification: "skipped_missing_operator",
        lifecycleState: "not_applicable",
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
        supersededDrafts: 0,
      },
    };
  }

  const { error } = await input.supabase.from("notifications").insert({
    user_id: input.operatorUserId,
    company_id: input.companyId,
    type: NOTIFICATION_TYPE,
    title: notificationTitle(input),
    body: notificationBody(input),
    is_read: false,
    persistent: true,
    action_url: actionUrlFor(input),
    action_label: actionLabelFor(input),
    project_id: null,
    note_id: null,
  });
  const lifecycleState = error
    ? "not_applicable"
    : await upsertLifecycleState(input, OPERATOR_MISS_STALE_STATUS);

  return {
    applied: !error && lifecycleState !== "skipped_update_failed",
    operations: {
      draft: "not_applicable",
      notification: error ? "skipped_insert_failed" : "created",
      lifecycleState,
      supersededDrafts: 0,
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
        supersededDrafts: 0,
      },
    };
  }

  if (DESTRUCTIVE_ACTIONS.has(input.decision.action)) {
    return {
      ...base,
      applied: false,
      skippedReason: "destructive_action_not_allowed",
      operations: {
        draft: "not_applicable",
        notification: "not_applicable",
        lifecycleState: "not_applicable",
        supersededDrafts: 0,
      },
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

  if (mode === "dry-run") {
    return {
      mode,
      applied: false,
      operations: {
        lifecycleState: "would_update",
        supersededDrafts: openTemplateDrafts.length,
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
    },
  };
}
