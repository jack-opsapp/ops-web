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
   * Mark this provider event as waiting for the exactly-once opportunity
   * counter projection. Provider ingestion paths set this true; only legacy
   * backfills that already own aggregate counts leave it false.
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

async function findProviderMessageEvent(
  input: RecordCorrespondenceEventInput,
  providerMessageId: string | null
): Promise<{ id: string | null } | null> {
  if (!providerMessageId) return null;

  const query = input.supabase
    .from("opportunity_correspondence_events")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("provider_message_id", providerMessageId)
    .limit(1);

  if (input.connectionId) {
    query.eq("connection_id", input.connectionId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Correspondence event dedupe lookup failed: ${error.message ?? "unknown error"}`
    );
  }
  const row = (data ?? [])[0] as { id?: string | null } | undefined;
  return row ? { id: row.id ?? null } : null;
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

    const duplicate = await findProviderMessageEvent(
      input,
      providerIds.providerMessageId
    );
    if (duplicate) {
      const classification = classifyOpportunityCorrespondence({
        ...input,
        providerThreadId: providerIds.providerThreadId,
        providerMessageId: providerIds.providerMessageId,
        existingProviderMessageIds: providerIds.providerMessageId
          ? [providerIds.providerMessageId]
          : [],
      });
      // A prior attempt may have inserted the immutable event and then failed
      // its lifecycle-state side effect. Re-run that idempotent side effect so
      // cursor retry repairs the partial write before reporting a duplicate.
      await updateLifecycleStateAfterMeaningfulEvent(
        input,
        classification,
        duplicate.id
      );
      return {
        created: false,
        reason: "duplicate_provider_message_id",
        classification,
      };
    }

    const classification = classifyOpportunityCorrespondence({
      ...input,
      providerThreadId: providerIds.providerThreadId,
      providerMessageId: providerIds.providerMessageId,
      existingProviderMessageIds: [],
    });

    const { data: insertedEvent, error } = await input.supabase
      .from("opportunity_correspondence_events")
      .insert({
        company_id: input.companyId,
        opportunity_id: input.opportunityId,
        activity_id: input.activityId ?? null,
        connection_id: input.connectionId ?? null,
        provider_thread_id: providerIds.providerThreadId,
        provider_message_id: providerIds.providerMessageId,
        direction: input.direction,
        party_role: classification.partyRole,
        is_meaningful: classification.isMeaningful,
        noise_reason: classification.noiseReason,
        occurred_at: iso(input.occurredAt),
        linked_contact_kind: input.linkedContactKind ?? null,
        linked_contact_id: input.linkedContactId ?? null,
        source: input.source,
        opportunity_projection_applied: !input.applyOpportunityProjection,
        subject: input.subject ?? null,
        from_email: input.fromEmail ?? null,
        to_emails: asStringArray(input.toEmails),
        cc_emails: asStringArray(input.ccEmails),
      })
      .select("id")
      .single();

    if (error) {
      console.error("[lead-lifecycle] correspondence event insert failed", {
        companyId: input.companyId,
        opportunityId: input.opportunityId,
        providerThreadId: providerIds.providerThreadId,
        providerMessageId: providerIds.providerMessageId,
        error,
      });
      throw new Error(
        `Correspondence event insert failed: ${error.message ?? "unknown error"}`
      );
    }

    await updateLifecycleStateAfterMeaningfulEvent(
      input,
      classification,
      ((insertedEvent as Record<string, unknown> | null)?.id as
        | string
        | null) ?? null
    );
    return { created: true, classification };
  },
};
