import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EmailAssignmentContactFormDraftWorker,
  type ClaimedEmailAssignmentContactFormDraft,
  type ContactFormDraftFailureDisposition,
  type ContactFormDraftProviderPlacementAttempt,
  type ContactFormDraftTransport,
  type EmailAssignmentContactFormDraftDependencies,
  type EmailAssignmentContactFormDraftWorkerOptions,
  type EmailAssignmentContactFormDraftWorkerResult,
} from "./email-assignment-contact-form-draft-worker";
import { AIDraftService } from "./ai-draft-service";
import { EmailService } from "./email-service";
import { placeNewThreadDraft } from "./mailbox-draft-push";
import { PhaseCCategoryAutonomy } from "./phase-c-category-autonomy-service";
import {
  renderMailboxDraftWithSignature,
  resolveEmailSignatureForMessage,
} from "@/lib/email/email-signature-runtime";

interface ClaimRow {
  id: unknown;
  assignment_event_id: unknown;
  company_id: unknown;
  opportunity_id: unknown;
  assignment_version: unknown;
  actor_user_id: unknown;
  connection_id: unknown;
  source_activity_id: unknown;
  provider_message_id: unknown;
  source_provider_thread_id: unknown;
  customer_email: unknown;
  customer_name: unknown;
  source_subject: unknown;
  source_body_text: unknown;
  created_at: unknown;
  attempts: unknown;
  draft_history_id: unknown;
  draft_body: unknown;
  draft_subject: unknown;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Contact-form draft claim is missing ${field}`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  const parsed = stringValue(value, field);
  if (!parsed.trim()) {
    throw new Error(`Contact-form draft claim is missing ${field}`);
  }
  return parsed;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Contact-form draft claim has invalid ${field}`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Contact-form draft claim has invalid ${field}`);
  }
  return parsed;
}

function mapClaim(row: ClaimRow): ClaimedEmailAssignmentContactFormDraft {
  const assignmentVersion = nonnegativeInteger(
    row.assignment_version,
    "assignment_version"
  );
  if (assignmentVersion < 1) {
    throw new Error("Contact-form draft claim has invalid assignment_version");
  }
  const createdAt = requiredString(row.created_at, "created_at");
  if (!Number.isFinite(new Date(createdAt).getTime())) {
    throw new Error("Contact-form draft claim has invalid created_at");
  }

  return {
    id: requiredString(row.id, "id"),
    assignmentEventId: requiredString(
      row.assignment_event_id,
      "assignment_event_id"
    ),
    companyId: requiredString(row.company_id, "company_id"),
    opportunityId: requiredString(row.opportunity_id, "opportunity_id"),
    assignmentVersion,
    actorUserId: requiredString(row.actor_user_id, "actor_user_id"),
    connectionId: requiredString(row.connection_id, "connection_id"),
    sourceActivityId: requiredString(
      row.source_activity_id,
      "source_activity_id"
    ),
    providerMessageId: requiredString(
      row.provider_message_id,
      "provider_message_id"
    ),
    sourceProviderThreadId: requiredString(
      row.source_provider_thread_id,
      "source_provider_thread_id"
    ),
    customerEmail: requiredString(row.customer_email, "customer_email"),
    customerName: nullableString(row.customer_name, "customer_name"),
    sourceSubject: stringValue(row.source_subject, "source_subject"),
    sourceBodyText: requiredString(row.source_body_text, "source_body_text"),
    createdAt,
    attempts: nonnegativeInteger(row.attempts, "attempts"),
    draftHistoryId: nullableString(row.draft_history_id, "draft_history_id"),
    draftBody: nullableString(row.draft_body, "draft_body"),
    draftSubject: nullableString(row.draft_subject, "draft_subject"),
  };
}

function firstBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value[0] === true;
  return false;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function providerPlacementAttempt(
  value: unknown
): ContactFormDraftProviderPlacementAttempt | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === null || candidate === undefined) return null;
  if (typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(
      "Contact-form draft provider placement returned an invalid attempt"
    );
  }
  const row = candidate as Record<string, unknown>;
  const attemptId = row.attempt_id;
  const mode = row.mode;
  const priorDraftHistoryId = row.prior_draft_history_id ?? null;
  const mailboxDraftId = row.mailbox_draft_id ?? null;
  const providerThreadId = row.provider_thread_id ?? null;
  if (
    typeof attemptId !== "string" ||
    !UUID_PATTERN.test(attemptId) ||
    (mode !== "create" && mode !== "update")
  ) {
    throw new Error(
      "Contact-form draft provider placement returned an invalid attempt"
    );
  }
  if (
    mode === "create" &&
    (priorDraftHistoryId !== null ||
      mailboxDraftId !== null ||
      providerThreadId !== null)
  ) {
    throw new Error(
      "Contact-form draft provider placement returned invalid create identity"
    );
  }
  if (
    mode === "update" &&
    (typeof priorDraftHistoryId !== "string" ||
      !UUID_PATTERN.test(priorDraftHistoryId) ||
      typeof mailboxDraftId !== "string" ||
      !mailboxDraftId.trim() ||
      typeof providerThreadId !== "string" ||
      !providerThreadId.trim())
  ) {
    throw new Error(
      "Contact-form draft provider placement returned invalid update identity"
    );
  }
  return {
    attemptId,
    mode,
    priorDraftHistoryId:
      typeof priorDraftHistoryId === "string" ? priorDraftHistoryId : null,
    mailboxDraftId:
      typeof mailboxDraftId === "string" ? mailboxDraftId.trim() : null,
    providerThreadId:
      typeof providerThreadId === "string" ? providerThreadId.trim() : null,
  };
}

function failureDisposition(
  value: unknown
): ContactFormDraftFailureDisposition {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    candidate === "retrying" ||
    candidate === "failed" ||
    candidate === "stale" ||
    candidate === "reconciliation_required"
  ) {
    return candidate;
  }
  throw new Error("Contact-form draft failure RPC returned an invalid state");
}

function requireRpcSuccess<T>(
  error: { message?: string } | null,
  data: T,
  operation: string
): T {
  if (error) {
    throw new Error(
      `Contact-form draft ${operation} failed: ${error.message ?? "unknown error"}`
    );
  }
  return data;
}

export function createSupabaseEmailAssignmentContactFormDraftDependencies(
  supabase: SupabaseClient
): EmailAssignmentContactFormDraftDependencies {
  return {
    async claim(input) {
      const { data, error } = await supabase.rpc(
        "claim_email_assignment_contact_form_drafts",
        {
          p_holder: input.holder,
          p_limit: input.limit,
          p_lease_seconds: input.leaseSeconds,
        }
      );
      const rows = requireRpcSuccess(error, data, "claim") as ClaimRow[] | null;
      return (rows ?? []).map(mapClaim);
    },

    async reauthorize(input) {
      const { data, error } = await supabase.rpc(
        "reauthorize_email_assignment_contact_form_draft_as_system",
        {
          p_queue_id: input.queueId,
          p_holder: input.holder,
        }
      );
      return firstBoolean(requireRpcSuccess(error, data, "reauthorization"));
    },

    loadConnection(connectionId) {
      return EmailService.getConnection(connectionId);
    },

    async getCustomerAutonomy(connectionId) {
      const autonomy = await PhaseCCategoryAutonomy.get(connectionId);
      return autonomy.CUSTOMER;
    },

    generateDraft(input) {
      return AIDraftService.generateDraft(input);
    },

    async prepare(input) {
      const { data, error } = await supabase.rpc(
        "prepare_email_assignment_contact_form_draft_as_system",
        {
          p_queue_id: input.queueId,
          p_holder: input.holder,
          p_draft_history_id: input.draftHistoryId,
        }
      );
      return firstBoolean(requireRpcSuccess(error, data, "preparation"));
    },

    async beginProviderCreate(input) {
      const { data, error } = await supabase.rpc(
        "begin_email_assignment_contact_form_draft_provider_create_as_system",
        {
          p_queue_id: input.queueId,
          p_holder: input.holder,
        }
      );
      return providerPlacementAttempt(
        requireRpcSuccess(error, data, "provider placement attempt")
      );
    },

    async markReconciliationRequired(input) {
      const { data, error } = await supabase.rpc(
        "mark_email_assignment_contact_form_draft_reconciliation_required_as_system",
        {
          p_queue_id: input.queueId,
          p_holder: input.holder,
          p_provider_create_attempt_id: input.providerCreateAttemptId,
          p_mailbox_draft_id: input.mailboxDraftId,
          p_provider_thread_id: input.providerThreadId,
          p_error: input.error,
        }
      );
      return firstBoolean(
        requireRpcSuccess(error, data, "reconciliation persistence")
      );
    },

    resolveSignature(input) {
      return resolveEmailSignatureForMessage({
        supabase,
        connection: input.connection,
        userId: input.userId,
        refreshProviderIfMissing: input.refreshProviderIfMissing,
      });
    },

    renderDraft(body, signature) {
      return renderMailboxDraftWithSignature(body, signature);
    },

    getDraftTransport(connection) {
      const provider = EmailService.getProvider(connection);
      const transport: ContactFormDraftTransport = Object.freeze({
        createNewThreadDraft: (
          to: string,
          subject: string,
          body: string,
          contentType?: "text" | "html"
        ) => provider.createNewThreadDraft(to, subject, body, contentType),
        updateDraft: (
          draftId: string,
          to: string,
          subject: string,
          body: string,
          threadId?: string,
          contentType?: "text" | "html"
        ) =>
          provider.updateDraft(
            draftId,
            to,
            subject,
            body,
            threadId,
            contentType
          ),
      });
      return transport;
    },

    placeDraft(input) {
      return placeNewThreadDraft(input);
    },

    async complete(input) {
      const { data, error } = await supabase.rpc(
        "complete_email_assignment_contact_form_draft_as_system",
        {
          p_queue_id: input.queueId,
          p_holder: input.holder,
          p_mailbox_draft_id: input.mailboxDraftId,
          p_provider_thread_id: input.providerThreadId,
          p_draft_history_id: input.draftHistoryId,
          p_provider_create_attempt_id: input.providerCreateAttemptId,
          p_outcome: input.outcome,
        }
      );
      return firstBoolean(requireRpcSuccess(error, data, "completion"));
    },

    async fail(input) {
      const { data, error } = await supabase.rpc(
        "fail_email_assignment_contact_form_draft_as_system",
        {
          p_queue_id: input.queueId,
          p_holder: input.holder,
          p_error: input.error,
        }
      );
      return failureDisposition(
        requireRpcSuccess(error, data, "failure persistence")
      );
    },

    workerId: () => randomUUID(),
  };
}

export async function runSupabaseEmailAssignmentContactFormDraftWorker(
  supabase: SupabaseClient,
  options: EmailAssignmentContactFormDraftWorkerOptions = {}
): Promise<EmailAssignmentContactFormDraftWorkerResult> {
  const worker = new EmailAssignmentContactFormDraftWorker(
    createSupabaseEmailAssignmentContactFormDraftDependencies(supabase)
  );
  return worker.process(options);
}
