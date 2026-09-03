"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-client";
import { authedFetch } from "@/lib/utils/authed-fetch";

/**
 * The public booking request one lead is waiting on (PUBLIC API P2-4,
 * design §8, invariant I14).
 *
 * In `request` mode nothing reaches a calendar until a staff member accepts,
 * so this is the lead's visit state until they do. Accepting is the call that
 * books the visit; declining books nothing.
 */

export interface BookingRequestAnswer {
  readonly label: string;
  readonly value: string;
}

export interface PendingBookingRequest {
  readonly requestId: string;
  readonly slotStartAt: string;
  readonly durationMinutes: number;
  readonly contactName: string;
  readonly requestedAt: string;
  readonly answers: readonly BookingRequestAnswer[];
}

/** What went wrong, in the terms the operator needs to hear it. */
export type BookingRequestFailure =
  | "conflict"
  | "permission"
  | "not_found"
  | "unavailable";

export class BookingRequestError extends Error {
  readonly failure: BookingRequestFailure;

  constructor(failure: BookingRequestFailure) {
    super(`booking request ${failure}`);
    this.name = "BookingRequestError";
    this.failure = failure;
  }
}

function failureFor(status: number): BookingRequestFailure {
  if (status === 409) return "conflict";
  if (status === 403 || status === 401) return "permission";
  if (status === 404) return "not_found";
  return "unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAnswers(value: unknown): BookingRequestAnswer[] {
  if (!Array.isArray(value)) return [];
  const answers: BookingRequestAnswer[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.label !== "string" || typeof entry.value !== "string") continue;
    answers.push({ label: entry.label, value: entry.value });
  }
  return answers;
}

export function parsePendingBookingRequest(value: unknown): PendingBookingRequest | null {
  if (!isRecord(value)) return null;
  if (typeof value.requestId !== "string" || typeof value.slotStartAt !== "string") {
    return null;
  }
  return {
    requestId: value.requestId,
    slotStartAt: value.slotStartAt,
    durationMinutes:
      typeof value.durationMinutes === "number" ? value.durationMinutes : 60,
    contactName: typeof value.contactName === "string" ? value.contactName : "",
    requestedAt:
      typeof value.requestedAt === "string" ? value.requestedAt : value.slotStartAt,
    answers: parseAnswers(value.answers),
  };
}

function endpoint(opportunityId: string, action?: "accept" | "decline") {
  const base = `/api/opportunities/${opportunityId}/booking-request`;
  return action ? `${base}/${action}` : base;
}

export function useBookingRequest(opportunityId: string | undefined) {
  return useQuery<PendingBookingRequest | null>({
    queryKey: queryKeys.booking.request(opportunityId ?? ""),
    queryFn: async () => {
      const response = await authedFetch(endpoint(opportunityId!));
      // A refusal and a store that cannot answer both mean "nothing pending
      // to show"; the lead surface stays quiet either way.
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return parsePendingBookingRequest(isRecord(body) ? body.request : null);
    },
    enabled: !!opportunityId,
    retry: false,
  });
}

interface DecisionInput {
  readonly requestId: string;
  /** Present only when the operator moved the time. */
  readonly scheduledAt?: string;
}

/**
 * Everything a decision changes: the request itself, the lead's visits, the
 * lead, and the calendars. Accepting creates a real `site_visits` row, so the
 * same caches the staff booking path invalidates are invalidated here.
 */
function invalidateAfterDecision(
  queryClient: ReturnType<typeof useQueryClient>,
  opportunityId: string
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.booking.request(opportunityId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
}

/** Accepting is what books the visit — nothing was on a calendar before it. */
export function useAcceptBookingRequest(opportunityId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: DecisionInput): Promise<string> => {
      const response = await authedFetch(endpoint(opportunityId, "accept"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new BookingRequestError(failureFor(response.status));
      const body: unknown = await response.json();
      const scheduledAt = isRecord(body) ? body.scheduledAt : null;
      // The server's own answer is the booked time — never the local guess,
      // which the confirm RPC is free to refuse.
      return typeof scheduledAt === "string" ? scheduledAt : "";
    },
    retry: false,
    onSettled: () => invalidateAfterDecision(queryClient, opportunityId),
  });
}

/** Declining books nothing and sends the customer nothing. */
export function useDeclineBookingRequest(opportunityId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { requestId: string }): Promise<void> => {
      const response = await authedFetch(endpoint(opportunityId, "decline"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new BookingRequestError(failureFor(response.status));
    },
    retry: false,
    onSettled: () => invalidateAfterDecision(queryClient, opportunityId),
  });
}
