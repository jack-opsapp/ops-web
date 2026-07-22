import {
  classifyOpportunityCorrespondence,
  type OpportunityCorrespondenceClassification,
  type OpportunityCorrespondenceDirection,
} from "@/lib/email/opportunity-correspondence-classifier";
import {
  logInvalidProviderEmailIds,
  validateProviderEmailIds,
} from "@/lib/email/provider-email-ids";
import { resetStaleLifecycleAfterMeaningfulInbound } from "./opportunity-lifecycle-action-service";

interface LifecycleSupabaseLike {
  // New P4 tables are not present in generated Supabase types until the schema
  // is regenerated, but the service needs to target them immediately.
  from: (table: string) => any;
  // record_opportunity_correspondence_event is invoked positionally with its
  // p_* args; typed loosely for the same not-yet-regenerated reason as `from`.
  rpc(
    fn: string,
    args?: Record<string, unknown>
  ): PromiseLike<{
    data?: unknown;
    // `message` stays non-null so this stays assignable to ActionSupabaseLike;
    // `code` carries the RPC's SQLSTATE for the missing-opportunity mapping.
    error?: { code?: string; message?: string } | null;
  }>;
}

export interface RecordCorrespondenceEventInput {
  supabase: LifecycleSupabaseLike;
  companyId: string;
  opportunityId: string | null | undefined;
  activityId?: string | null;
  connectionId?: string | null;
  providerThreadId: string | null | undefined;
  providerMessageId?: string | null | undefined;
  requireProviderMessageId: boolean;
  direction: OpportunityCorrespondenceDirection;
  occurredAt: Date | string;
  source: string;
  /**
   * Project this event into opportunity counters inside the same transaction
   * that inserts it. Provider ingestion paths set this true; only imports that
   * have already seeded aggregate counts leave it false.
   */
  applyOpportunityProjection?: boolean;
  fromEmail?: string | null;
  fromName?: string | null;
  toEmails?: string[] | null;
  ccEmails?: string[] | null;
  subject?: string | null;
  bodyText?: string | null;
  labels?: string[] | null;
  threadCategory?: string | null;
  connectionEmail?: string | null;
  companyDomains?: string[] | null;
  userEmailAddresses?: string[] | null;
  knownPlatformSenders?: string[] | null;
  contactEmail?: string | null;
  submitterEmail?: string | null;
  linkedContactKind?: string | null;
  linkedContactId?: string | null;
}

export type RecordCorrespondenceEventResult =
  | {
      created: true;
      classification: OpportunityCorrespondenceClassification;
    }
  | {
      created: false;
      reason:
        | "invalid_provider_ids"
        | "missing_opportunity"
        | "duplicate_provider_message_id";
      classification?: OpportunityCorrespondenceClassification;
    };

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function normalizedText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function updateLifecycleStateAfterMeaningfulEvent(
  input: RecordCorrespondenceEventInput,
  classification: OpportunityCorrespondenceClassification,
  eventId: string | null
): Promise<void> {
  if (!input.opportunityId || !classification.isMeaningful) return;

  const occurredAt = iso(input.occurredAt);
  const { data: current, error: currentError } = await input.supabase
    .from("opportunity_lifecycle_state")
    .select("last_meaningful_at")
    .eq("opportunity_id", input.opportunityId)
    .maybeSingle();
  if (currentError) {
    throw new Error(
      `Lifecycle state read failed: ${currentError.message ?? "unknown error"}`
    );
  }

  const currentAt = normalizedText(
    (current as Record<string, unknown> | null)?.last_meaningful_at as
      | string
      | null
  );
  if (currentAt && new Date(currentAt) > new Date(occurredAt)) return;

  if (input.direction === "inbound") {
    const reset = await resetStaleLifecycleAfterMeaningfulInbound({
      supabase: input.supabase,
      companyId: input.companyId,
      opportunityId: input.opportunityId,
      eventId,
      occurredAt,
      mode: "apply",
    });
    if (!reset.applied) {
      throw new Error(
        "Lifecycle state reset failed for meaningful inbound email"
      );
    }
    return;
  }

  const row: Record<string, unknown> = {
    opportunity_id: input.opportunityId,
    company_id: input.companyId,
    last_meaningful_event_id: eventId,
    last_meaningful_at: occurredAt,
    last_meaningful_direction: input.direction,
    stale_status: null,
    stale_status_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error: lifecycleStateError } = await input.supabase
    .from("opportunity_lifecycle_state")
    .upsert(row, { onConflict: "opportunity_id" });
  if (lifecycleStateError) {
    throw new Error(
      `Lifecycle state upsert failed: ${lifecycleStateError.message ?? "unknown error"}`
    );
  }
}

export const OpportunityLifecycleService = {
  async recordCorrespondenceEvent(
    input: RecordCorrespondenceEventInput
  ): Promise<RecordCorrespondenceEventResult> {
    if (!input.opportunityId) {
      return { created: false, reason: "missing_opportunity" };
    }

    const providerIds = validateProviderEmailIds({
      boundary: input.source,
      providerThreadId: input.providerThreadId,
      providerMessageId: input.providerMessageId,
      requireMessageId: input.requireProviderMessageId,
    });

    if (!providerIds.ok) {
      logInvalidProviderEmailIds(providerIds, {
        companyId: input.companyId,
        connectionId: input.connectionId ?? null,
        opportunityId: input.opportunityId,
        source: input.source,
      });
      return { created: false, reason: "invalid_provider_ids" };
    }

    // Classify once in TS (the RPC has no view of the sender directory) and
    // hand the verdict to the atomic RPC. record_opportunity_correspondence_event
    // inserts the event AND projects its opportunity counters in one transaction
    // under the opportunity row lock, so a durable event is by construction a
    // projected event — closing the two-step insert/projection gap that
    // stranded a pending row and froze mailbox ingestion in the 2026-07-22
    // outage.
    const classification = classifyOpportunityCorrespondence({
      ...input,
      providerThreadId: providerIds.providerThreadId,
      providerMessageId: providerIds.providerMessageId,
      existingProviderMessageIds: [],
    });

    const { data, error } = await input.supabase.rpc(
      "record_opportunity_correspondence_event",
      {
        p_company_id: input.companyId,
        p_opportunity_id: input.opportunityId,
        p_activity_id: input.activityId ?? null,
        p_connection_id: input.connectionId ?? null,
        p_provider_thread_id: providerIds.providerThreadId,
        p_provider_message_id: providerIds.providerMessageId,
        p_direction: input.direction,
        p_party_role: classification.partyRole,
        p_is_meaningful: classification.isMeaningful,
        p_noise_reason: classification.noiseReason,
        p_occurred_at: iso(input.occurredAt),
        p_linked_contact_kind: input.linkedContactKind ?? null,
        p_linked_contact_id: input.linkedContactId ?? null,
        p_source: input.source,
        p_subject: input.subject ?? null,
        p_from_email: input.fromEmail ?? null,
        p_to_emails: asStringArray(input.toEmails),
        p_cc_emails: asStringArray(input.ccEmails),
        p_apply_opportunity_projection: input.applyOpportunityProjection ?? false,
      }
    );

    if (error) {
      const rpcError = error as {
        code?: string | null;
        message?: string | null;
      };
      const code = rpcError.code ?? "";
      const message = rpcError.message ?? "";
      // The opportunity vanished (soft-deleted or never existed). Treat it
      // exactly like the pre-flight missing-opportunity short-circuit.
      if (code === "P0002" || message.includes("opportunity_not_found")) {
        return { created: false, reason: "missing_opportunity" };
      }
      console.error("[lead-lifecycle] correspondence event insert failed", {
        companyId: input.companyId,
        opportunityId: input.opportunityId,
        providerThreadId: providerIds.providerThreadId,
        providerMessageId: providerIds.providerMessageId,
        error,
      });
      throw new Error(
        `Correspondence event insert failed: ${message || "unknown error"}`
      );
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { created?: boolean | null; event_id?: string | null }
      | null
      | undefined;
    if (!row || typeof row.created !== "boolean") {
      console.error("[lead-lifecycle] correspondence event insert failed", {
        companyId: input.companyId,
        opportunityId: input.opportunityId,
        providerThreadId: providerIds.providerThreadId,
        providerMessageId: providerIds.providerMessageId,
        error: "record RPC returned no row",
      });
      throw new Error(
        "Correspondence event insert failed: RPC returned no row"
      );
    }

    const eventId = (row.event_id as string | null) ?? null;
    // Idempotent lifecycle-state advance runs on both a fresh insert and a
    // duplicate replay: a prior cycle may have committed the event and then
    // failed its lifecycle side effect, so the duplicate path repairs it.
    await updateLifecycleStateAfterMeaningfulEvent(
      input,
      classification,
      eventId
    );

    if (!row.created) {
      return {
        created: false,
        reason: "duplicate_provider_message_id",
        classification,
      };
    }
    return { created: true, classification };
  },
};
