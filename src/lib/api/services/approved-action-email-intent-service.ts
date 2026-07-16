import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ApprovedActionEmailIntent,
  ApprovedActionEmailIntentStore,
  ApprovedActionEmailIntentStatus,
  PrepareApprovedActionEmailIntentInput,
} from "./approved-action-email-delivery-service";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  const valueText = text(value).trim();
  return valueText || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : null;
}

export function mapApprovedActionEmailIntent(
  row: Record<string, unknown>
): ApprovedActionEmailIntent {
  return {
    id: text(row.id),
    actionId: text(row.action_id),
    actionType: text(row.action_type),
    actionDataSnapshot:
      row.action_data_snapshot && typeof row.action_data_snapshot === "object"
        ? (row.action_data_snapshot as Record<string, unknown>)
        : {},
    companyId: text(row.company_id),
    actorUserId: text(row.actor_user_id),
    executionMode: text(
      row.execution_mode
    ) as ApprovedActionEmailIntent["executionMode"],
    idempotencyKey: text(row.idempotency_key),
    connectionId: text(row.connection_id),
    opportunityId: nullableText(row.opportunity_id),
    assignmentVersion: nullableNumber(row.assignment_version),
    assignmentEventId: nullableText(row.assignment_event_id),
    clientId: nullableText(row.client_id),
    projectId: nullableText(row.project_id),
    invoiceId: nullableText(row.invoice_id),
    sourceEmailThreadId: nullableText(row.source_email_thread_id),
    replyProviderThreadId: nullableText(row.reply_provider_thread_id),
    inReplyTo: nullableText(row.in_reply_to),
    toEmails: stringArray(row.to_emails),
    ccEmails: stringArray(row.cc_emails),
    subject: text(row.subject),
    authoredBody: text(row.authored_body),
    renderedBody: text(row.rendered_body),
    contentType: text(row.content_type) === "html" ? "html" : "text",
    sourceDraftHistoryId: nullableText(row.source_draft_history_id),
    draftHistoryId: nullableText(row.draft_history_id),
    profileTypeSnapshot: text(row.profile_type_snapshot) || "general",
    learningAuthority: text(
      row.learning_authority
    ) as ApprovedActionEmailIntent["learningAuthority"],
    actorNameSnapshot: text(row.actor_name_snapshot),
    actorEmailSnapshot: text(row.actor_email_snapshot),
    clientFromAddressSnapshot: text(row.client_from_address_snapshot),
    signatureId: nullableText(row.signature_id),
    signatureContentHash: nullableText(row.signature_content_hash),
    renderedBodyHash: nullableText(row.rendered_body_hash),
    status: text(row.status) as ApprovedActionEmailIntentStatus,
    providerMessageId: nullableText(row.provider_message_id),
    acceptedProviderThreadId: nullableText(row.accepted_provider_thread_id),
    providerAcceptedAt: nullableText(row.provider_accepted_at),
    reconciliationLeaseToken: nullableText(row.reconciliation_lease_token),
    reconciledActivityId: nullableText(row.reconciled_activity_id),
    lastError: nullableText(row.last_error),
  };
}

export class ApprovedActionEmailIntentService implements ApprovedActionEmailIntentStore {
  constructor(private readonly supabase: SupabaseClient) {}

  private async requiredRpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<ApprovedActionEmailIntent> {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) throw new Error(error.message || `${name} failed`);
    const row = firstRow(data);
    if (!row) throw new Error(`${name} returned no intent`);
    return mapApprovedActionEmailIntent(row);
  }

  private async optionalRpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<ApprovedActionEmailIntent | null> {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) throw new Error(error.message || `${name} failed`);
    const row = firstRow(data);
    return row ? mapApprovedActionEmailIntent(row) : null;
  }

  prepare(
    input: PrepareApprovedActionEmailIntentInput
  ): Promise<ApprovedActionEmailIntent> {
    return this.requiredRpc("prepare_approved_action_email_intent", {
      p_action_id: input.actionId,
      p_execution_mode: input.executionMode,
      p_signature_id: input.signatureId,
      p_signature_content_hash: input.signatureContentHash,
      p_expected_authored_body_hash: input.authoredBodyHash,
      p_rendered_body: input.renderedBody,
      p_rendered_body_hash: input.renderedBodyHash,
    });
  }

  prepareAwaitingSignature(input: {
    actionId: string;
    executionMode: ApprovedActionEmailIntent["executionMode"];
  }): Promise<ApprovedActionEmailIntent> {
    return this.requiredRpc("prepare_approved_action_email_intent", {
      p_action_id: input.actionId,
      p_execution_mode: input.executionMode,
      p_signature_id: null,
      p_signature_content_hash: null,
      p_expected_authored_body_hash: null,
      p_rendered_body: null,
      p_rendered_body_hash: null,
    });
  }

  claimProviderDelivery(
    intentId: string
  ): Promise<ApprovedActionEmailIntent | null> {
    return this.optionalRpc("claim_approved_action_email_delivery", {
      p_intent_id: intentId,
    });
  }

  persistProviderAcceptance(input: {
    intentId: string;
    providerMessageId: string;
    providerThreadId: string;
    acceptedAt: Date | string;
  }): Promise<ApprovedActionEmailIntent> {
    return this.requiredRpc("mark_approved_action_email_provider_accepted", {
      p_intent_id: input.intentId,
      p_provider_message_id: input.providerMessageId,
      p_provider_thread_id: input.providerThreadId,
      p_accepted_at:
        input.acceptedAt instanceof Date
          ? input.acceptedAt.toISOString()
          : new Date(input.acceptedAt).toISOString(),
    });
  }

  markProviderRejected(input: {
    intentId: string;
    error: string;
  }): Promise<ApprovedActionEmailIntent> {
    return this.requiredRpc("mark_approved_action_email_provider_rejected", {
      p_intent_id: input.intentId,
      p_error: input.error,
    });
  }

  markDeliveryUnknown(input: {
    intentId: string;
    error: string;
    providerMessageId?: string | null;
    providerThreadId?: string | null;
  }): Promise<ApprovedActionEmailIntent> {
    return this.requiredRpc("mark_approved_action_email_delivery_unknown", {
      p_intent_id: input.intentId,
      p_error: input.error,
      p_provider_message_id: input.providerMessageId ?? null,
      p_provider_thread_id: input.providerThreadId ?? null,
    });
  }

  claimReconciliation(
    intentId: string
  ): Promise<ApprovedActionEmailIntent | null> {
    return this.optionalRpc("claim_approved_action_email_reconciliation", {
      p_intent_id: intentId,
      p_lease_seconds: 300,
    });
  }

  completeReconciliation(input: {
    intentId: string;
    leaseToken: string;
    activityId: string;
  }): Promise<ApprovedActionEmailIntent> {
    return this.requiredRpc("complete_approved_action_email_reconciliation", {
      p_intent_id: input.intentId,
      p_lease_token: input.leaseToken,
      p_activity_id: input.activityId,
    });
  }

  failReconciliation(input: {
    intentId: string;
    leaseToken: string;
    error: string;
  }): Promise<ApprovedActionEmailIntent> {
    return this.requiredRpc("fail_approved_action_email_reconciliation", {
      p_intent_id: input.intentId,
      p_lease_token: input.leaseToken,
      p_error: input.error,
    });
  }

  async getByActionId(
    actionId: string
  ): Promise<ApprovedActionEmailIntent | null> {
    const { data, error } = await this.supabase
      .from("approved_action_email_intents")
      .select("*")
      .eq("action_id", actionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data
      ? mapApprovedActionEmailIntent(data as Record<string, unknown>)
      : null;
  }

  async listRecoverable(limit = 50): Promise<ApprovedActionEmailIntent[]> {
    const { data, error } = await this.supabase
      .from("approved_action_email_intents")
      .select("*")
      .in("status", [
        "awaiting_signature",
        "prepared",
        "provider_accepted",
        "reconciling",
        "reconciliation_failed",
      ])
      .order("updated_at", { ascending: true })
      .limit(Math.max(1, Math.min(limit, 100)));
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) =>
      mapApprovedActionEmailIntent(row as Record<string, unknown>)
    );
  }

  async quarantineStaleDeliveries(): Promise<number> {
    const { data, error } = await this.supabase.rpc(
      "quarantine_stale_approved_action_email_deliveries",
      {}
    );
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }
}
