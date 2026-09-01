import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOneSignalPush } from "@/lib/integrations/onesignal";
import {
  PhaseCBilateralEventConsumerService,
  type PhaseCBilateralEventConsumerDependencies,
  type PhaseCBilateralEventOutcome,
} from "@/lib/email/phase-c-bilateral-event-consumer";
import {
  createTrustedNotifications,
  resolveNotificationPreferences,
} from "@/lib/notifications/server-notification-service";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredString(value: unknown, label: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`Phase C bilateral readback omitted ${label}`);
  return parsed;
}

function parseOutcome(value: unknown): PhaseCBilateralEventOutcome {
  const row = record(value);
  const status = row.status;
  if (status !== "review" && status !== "consumed" && status !== "cancelled") {
    throw new Error("Phase C bilateral readback returned an invalid status");
  }
  const eventKind = row.event_kind;
  return {
    handoffId: requiredString(row.handoff_id, "handoff identity"),
    companyId: requiredString(row.company_id, "company identity"),
    opportunityId: requiredString(row.opportunity_id, "opportunity identity"),
    requestedOwnerUserId: optionalString(row.requested_owner_user_id),
    status,
    reviewReason: optionalString(row.review_reason),
    canonicalEventKind: optionalString(row.canonical_event_kind),
    canonicalEventId: optionalString(row.canonical_event_id),
    ...(eventKind === "site_visit" ||
    eventKind === "meeting" ||
    eventKind === "call" ||
    eventKind === "work"
      ? { eventKind }
      : {}),
    ...(optionalString(row.event_title)
      ? { eventTitle: optionalString(row.event_title)! }
      : {}),
    ...(optionalString(row.starts_at)
      ? { startsAt: optionalString(row.starts_at)! }
      : {}),
    ...(optionalString(row.event_timezone)
      ? { eventTimezone: optionalString(row.event_timezone)! }
      : {}),
    ...(optionalString(row.location)
      ? { location: optionalString(row.location)! }
      : {}),
    ...(optionalString(row.lead_title)
      ? { leadTitle: optionalString(row.lead_title)! }
      : {}),
  };
}

const REVIEW_BODY: Record<string, string> = {
  calendar_create_permission_missing:
    "Calendar permission is required before booking.",
  event_owner_identity_mismatch: "Confirm the owner before booking.",
  event_attendees_unresolved: "Confirm the attendees before booking.",
  event_timezone_unresolved: "Confirm the timezone before booking.",
  event_location_unresolved: "Confirm the location before booking.",
  event_time_conflict: "Resolve the schedule conflict before booking.",
  event_time_unresolved: "Confirm the appointment time before booking.",
  event_duration_unresolved: "Confirm the appointment duration before booking.",
  event_lead_identity_mismatch: "Confirm the linked lead before booking.",
};

function kindTitle(kind: PhaseCBilateralEventOutcome["eventKind"]): string {
  switch (kind) {
    case "call":
      return "Call booked";
    case "meeting":
      return "Meeting booked";
    case "work":
      return "Work booked";
    default:
      return "Site visit booked";
  }
}

function bookedBody(outcome: PhaseCBilateralEventOutcome): string {
  if (!outcome.startsAt || !outcome.eventTimezone) {
    throw new Error("Booked Phase C appointment has no authoritative time");
  }
  const at = new Intl.DateTimeFormat("en-CA", {
    timeZone: outcome.eventTimezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(outcome.startsAt));
  return `${outcome.eventTitle ?? outcome.leadTitle ?? "Appointment"} · ${at}`;
}

export async function dispatchPhaseCBilateralEventOutcomeNotification(
  outcome: PhaseCBilateralEventOutcome,
  db: SupabaseClient
): Promise<{ notified: number; pushed: number }> {
  const ownerId = outcome.requestedOwnerUserId;
  if (!ownerId) {
    throw new Error("Phase C appointment notification has no owner");
  }
  const review = outcome.status === "review";
  const title = review
    ? "Appointment needs review"
    : kindTitle(outcome.eventKind);
  const body = review
    ? (REVIEW_BODY[outcome.reviewReason ?? ""] ??
      "Confirm the appointment details before booking.")
    : bookedBody(outcome);
  const type = review
    ? "phase_c_appointment_review"
    : "phase_c_appointment_booked";
  const actionUrl = `/pipeline?opportunityId=${outcome.opportunityId}`;
  const preferences = await resolveNotificationPreferences({
    companyId: outcome.companyId,
    recipientUserIds: [ownerId],
    preferenceKey: "schedule_changes",
    db,
  });
  const rail = await createTrustedNotifications(
    {
      companyId: outcome.companyId,
      recipientUserIds: preferences.inAppRecipientIds,
      type,
      title,
      body,
      persistent: review,
      actionUrl,
      actionLabel: review ? "REVIEW" : "VIEW",
      deepLinkType: "lead",
      dedupeKey: `phase-c-bilateral:v1:${outcome.handoffId}:${outcome.status}`,
      durableDedupe: true,
    },
    db
  );
  if (rail.errors > 0) {
    throw new Error("Phase C appointment notification persistence failed");
  }

  let pushed = 0;
  if (preferences.pushRecipientIds.length > 0) {
    const push = await sendOneSignalPush({
      recipientUserIds: preferences.pushRecipientIds,
      title,
      body,
      idempotencyKey: outcome.handoffId,
      data: {
        type,
        opportunityId: outcome.opportunityId,
        ...(outcome.canonicalEventId
          ? { siteVisitId: outcome.canonicalEventId }
          : {}),
        deepLink: actionUrl,
      },
    });
    if (!push.ok) {
      throw new Error("Phase C appointment push provider unavailable");
    }
    pushed = push.recipients;
  }
  return { notified: rail.attempted, pushed };
}

export function createPhaseCBilateralEventConsumerService(input: {
  supabase: SupabaseClient;
}): PhaseCBilateralEventConsumerService {
  const dependencies: PhaseCBilateralEventConsumerDependencies = {
    workerId: () => `phase-c-bilateral-event:${randomUUID()}`,
    async claim({ workerId, limit, leaseSeconds }) {
      const response = await input.supabase.rpc(
        "claim_phase_c_bilateral_event_handoffs",
        {
          p_worker_id: workerId,
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        }
      );
      if (response.error) {
        throw new Error(
          `Phase C bilateral claim failed: ${response.error.message}`
        );
      }
      return ((response.data ?? []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: requiredString(row.id, "claimed handoff identity"),
          companyId: requiredString(row.company_id, "claimed company identity"),
          opportunityId: requiredString(
            row.opportunity_id,
            "claimed opportunity identity"
          ),
          requestedOwnerUserId: optionalString(row.requested_owner_user_id),
          status: row.status as "ready" | "review" | "consumed" | "cancelled",
          canonicalEventKind: optionalString(row.canonical_event_kind),
          canonicalEventId: optionalString(row.canonical_event_id),
          attemptCount: Number(row.attempt_count ?? 0),
        })
      );
    },
    async consume({ handoffId, workerId }) {
      const response = await input.supabase.rpc(
        "consume_phase_c_bilateral_event_handoff",
        { p_handoff_id: handoffId, p_worker_id: workerId }
      );
      if (response.error) {
        throw new Error(
          `Phase C bilateral consumption failed: ${response.error.message}`
        );
      }
      const consumed = record(response.data);
      const status = consumed.status;
      if (
        status !== "review" &&
        status !== "consumed" &&
        status !== "cancelled"
      ) {
        throw new Error(
          "Phase C bilateral consumption returned an invalid status"
        );
      }
      return {
        handoffId,
        companyId: "pending-readback",
        opportunityId: "pending-readback",
        requestedOwnerUserId: null,
        status,
        reviewReason: optionalString(consumed.review_reason),
        canonicalEventKind: optionalString(consumed.canonical_event_kind),
        canonicalEventId: optionalString(consumed.canonical_event_id),
      };
    },
    async readback({ handoffId, canonicalEventId }) {
      const response = await input.supabase.rpc(
        "read_phase_c_bilateral_event_handoff",
        {
          p_handoff_id: handoffId,
          p_canonical_event_id: canonicalEventId,
        }
      );
      if (response.error) {
        throw new Error(
          `Phase C bilateral readback failed: ${response.error.message}`
        );
      }
      const outcome = parseOutcome(response.data);
      if (outcome.handoffId !== handoffId) {
        throw new Error("Phase C bilateral readback identity mismatch");
      }
      if (
        outcome.status === "consumed" &&
        (!outcome.canonicalEventId ||
          outcome.canonicalEventKind !== "site_visit")
      ) {
        throw new Error("Phase C bilateral appointment readback is incomplete");
      }
      return outcome;
    },
    dispatchNotification: (outcome) =>
      dispatchPhaseCBilateralEventOutcomeNotification(outcome, input.supabase),
    async acknowledge({ handoffId, workerId }) {
      const response = await input.supabase.rpc(
        "acknowledge_phase_c_bilateral_event_handoff",
        { p_handoff_id: handoffId, p_worker_id: workerId }
      );
      if (response.error || response.data !== "acknowledged") {
        throw new Error(
          `Phase C bilateral acknowledgement failed: ${response.error?.message ?? "invalid disposition"}`
        );
      }
      return "acknowledged";
    },
    async fail({ handoffId, workerId, errorCode, errorMessage }) {
      const response = await input.supabase.rpc(
        "fail_phase_c_bilateral_event_handoff",
        {
          p_handoff_id: handoffId,
          p_worker_id: workerId,
          p_error_code: errorCode,
          p_error_message: errorMessage,
        }
      );
      if (
        response.error ||
        (response.data !== "retrying" && response.data !== "failed")
      ) {
        throw new Error(
          `Phase C bilateral failure persistence failed: ${response.error?.message ?? "invalid disposition"}`
        );
      }
      return response.data;
    },
  };
  return new PhaseCBilateralEventConsumerService(dependencies);
}
