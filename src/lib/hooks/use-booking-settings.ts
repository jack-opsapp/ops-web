"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-client";
import { authedFetch } from "@/lib/utils/authed-fetch";
import {
  BOOKING_POLICY_DEFAULTS,
  isBookingMode,
  type BookingPolicy,
  type BookingWindow,
} from "@/lib/booking/policy";

/**
 * The company's public booking settings (PUBLIC API P2-4).
 *
 * One read, shared by the settings shell — which hides the whole section when
 * the company has no public website integration — and by the section body
 * itself. Both consult the same cached answer, so the gate and the screen can
 * never disagree and the shell costs no extra round-trip.
 *
 * `available: false` means the store could not answer (including before the
 * P2-1 migration lands). The section stays hidden rather than showing a
 * company a policy that is not really there.
 */

const ENDPOINT = "/api/settings/booking";

export interface BookingSettings {
  readonly available: boolean;
  readonly publicIntegration: boolean;
  readonly policy: BookingPolicy;
}

const UNAVAILABLE: BookingSettings = Object.freeze({
  available: false,
  publicIntegration: false,
  policy: BOOKING_POLICY_DEFAULTS,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWindows(value: unknown): BookingWindow[] {
  if (!Array.isArray(value)) return [];
  const windows: BookingWindow[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { weekday, start, end } = entry;
    if (typeof weekday !== "number" || typeof start !== "string" || typeof end !== "string") {
      continue;
    }
    windows.push({ weekday, start, end });
  }
  return windows;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A route answer as the screen's shape; anything unrecognised falls back. */
export function parseBookingPolicy(value: unknown): BookingPolicy {
  if (!isRecord(value)) return BOOKING_POLICY_DEFAULTS;
  const cap = value.maxBookingsPerDay;
  return {
    mode: isBookingMode(value.mode) ? value.mode : BOOKING_POLICY_DEFAULTS.mode,
    windows: parseWindows(value.windows),
    timezone:
      typeof value.timezone === "string" && value.timezone.length > 0
        ? value.timezone
        : BOOKING_POLICY_DEFAULTS.timezone,
    minNoticeHours: number(value.minNoticeHours, BOOKING_POLICY_DEFAULTS.minNoticeHours),
    horizonDays: number(value.horizonDays, BOOKING_POLICY_DEFAULTS.horizonDays),
    visitDurationMinutes: number(
      value.visitDurationMinutes,
      BOOKING_POLICY_DEFAULTS.visitDurationMinutes
    ),
    maxBookingsPerDay: typeof cap === "number" && Number.isFinite(cap) ? cap : null,
    defaultOwnerId:
      typeof value.defaultOwnerId === "string" && value.defaultOwnerId.length > 0
        ? value.defaultOwnerId
        : null,
  };
}

async function fetchBookingSettings(): Promise<BookingSettings> {
  const response = await authedFetch(ENDPOINT);
  // A refusal is an answer, not a failure: an operator who may not read the
  // policy, and a store that cannot answer yet, both mean "no section".
  if (!response.ok) return UNAVAILABLE;
  const body: unknown = await response.json();
  if (!isRecord(body)) return UNAVAILABLE;
  return {
    available: body.available === true,
    publicIntegration: body.publicIntegration === true,
    policy: parseBookingPolicy(body.policy),
  };
}

export function useBookingSettings(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.booking.settings(),
    queryFn: fetchBookingSettings,
    enabled,
    // Once-ever configuration: re-reading it on every settings visit is noise.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export class BookingSettingsWriteError extends Error {
  constructor() {
    super("booking settings write failed");
    this.name = "BookingSettingsWriteError";
  }
}

export function useSaveBookingPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (policy: BookingPolicy): Promise<BookingPolicy> => {
      const response = await authedFetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      });
      if (!response.ok) throw new BookingSettingsWriteError();
      const body: unknown = await response.json();
      return parseBookingPolicy(isRecord(body) ? body.policy : null);
    },
    retry: false,
    onSuccess: (policy) => {
      // The stored row is the truth the screen re-seeds from — never the
      // local guess about what the write did.
      queryClient.setQueryData<BookingSettings>(queryKeys.booking.settings(), (current) =>
        current ? { ...current, policy } : { available: true, publicIntegration: true, policy }
      );
    },
  });
}
