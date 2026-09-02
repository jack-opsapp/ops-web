import "server-only";

import { z } from "zod-v4";

import { PostgresUuidSchema } from "@/lib/agent-control-plane/contracts/postgres-uuid";

import { CustomerIdentityStoreError } from "./errors";
import {
  callSystemRpc,
  scalar,
  singleRow,
  type CustomerIdentityRpcClient,
} from "./rpc";

/**
 * Typed access to the P2 guest-booking system RPCs
 * (design: specs/2026-09-02-public-api-availability-and-guest-booking-design.md §5).
 *
 * The schemas below are the binding statement of the contract the P2-1
 * migration must satisfy. Every row is validated exactly: a database result
 * the contract does not allow is an internal failure, never a partially
 * trusted value — the same rule `rpc.ts` holds for the identity RPCs.
 *
 * Two additions to design §5, both forced by the route contract in §6 and
 * flagged to the PM rather than assumed silently:
 *
 *  1. `read_public_booking_policy_as_system` — §6 answers `timezone` and
 *     `durationMinutes` alongside the slots, and an empty availability set
 *     still has to carry them, so the header cannot ride on the slot rows.
 *  2. `hold_booking_slot_as_system.reason` — §5 fixes the refusal shape as
 *     "success minus the intent", which cannot tell a homeowner whose slot was
 *     taken (pick another) from one who is being rate limited (wait). The
 *     reason names neither a person nor a booking, so it costs no privacy.
 */

export type { CustomerIdentityRpcClient } from "./rpc";

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const EmailDigestSchema = z.string().regex(/^[1-9][0-9]{0,4}:[0-9a-f]{64}$/);
const IsoDateSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
const NonNegativeIntSchema = z.number().int().min(0);
const TimestampSchema = z
  .string()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)));

/** Design §4.1: the visit length and slot spacing the policy CHECK allows. */
const DurationMinutesSchema = z.number().int().min(15).max(480);

export const BOOKING_MODES = ["off", "request", "instant"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const HOLD_REASONS = ["ok", "slot_unavailable", "rate_limited"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export const CONFIRM_OUTCOMES = [
  "confirmed",
  "submitted",
  "slot_no_longer_available",
  "not_confirmable",
] as const;
export type ConfirmOutcome = (typeof CONFIRM_OUTCOMES)[number];

export const RESCHEDULE_OUTCOMES = [
  "rescheduled",
  "slot_no_longer_available",
  "not_manageable",
] as const;
export type RescheduleOutcome = (typeof RESCHEDULE_OUTCOMES)[number];

export const CANCEL_OUTCOMES = ["cancelled", "not_manageable"] as const;
export type CancelOutcome = (typeof CANCEL_OUTCOMES)[number];

/** The outcomes that name a real window; every other outcome carries none. */
const BOOKED_OUTCOMES = new Set(["confirmed", "submitted", "rescheduled"]);

// ─── Row schemas ────────────────────────────────────────────────────────────

const BookingPolicyRowSchema = z.object({
  mode: z.enum(BOOKING_MODES),
  timezone: z.string().min(1).max(64),
  visit_duration_minutes: DurationMinutesSchema,
  horizon_days: z.number().int().min(1).max(120),
  min_notice_hours: z.number().int().min(0).max(720),
  slot_granularity_minutes: z.union([
    z.literal(15),
    z.literal(30),
    z.literal(60),
    z.literal(120),
  ]),
});

const AvailabilitySlotRowSchema = z.object({ slot_start_at: TimestampSchema });

const HoldBookingSlotRowSchema = z
  .object({
    intent_id: PostgresUuidSchema.nullable(),
    hold_expires_at: TimestampSchema.nullable(),
    allowed: z.boolean(),
    reason: z.enum(HOLD_REASONS),
    retry_after_seconds: NonNegativeIntSchema,
  })
  .refine((row) => row.allowed === (row.reason === "ok"))
  .refine((row) => !row.allowed || (row.intent_id !== null && row.hold_expires_at !== null));

/**
 * One shape for both challenge-issuing RPCs. `accepted` is about the intent,
 * `allowed` about the I8 send limits; a refused intent can never carry an
 * allowed challenge, and neither refusal ever reaches the customer as itself
 * — the routes answer identically either way (I5).
 */
const BookingChallengeRowSchema = z
  .object({
    accepted: z.boolean(),
    challenge_id: PostgresUuidSchema.nullable(),
    allowed: z.boolean(),
    retry_after_seconds: NonNegativeIntSchema,
  })
  .refine((row) => row.accepted || !row.allowed)
  .refine((row) => !row.allowed || row.challenge_id !== null);

function bookingOutcomeRowSchema<T extends readonly [string, ...string[]]>(
  outcomes: T
): z.ZodType<{
  outcome: T[number];
  scheduled_at: string | null;
  duration_minutes: number | null;
}> {
  return z
    .object({
      outcome: z.enum(outcomes),
      scheduled_at: TimestampSchema.nullable(),
      duration_minutes: DurationMinutesSchema.nullable(),
    })
    .refine(
      (row) =>
        BOOKED_OUTCOMES.has(row.outcome) ===
        (row.scheduled_at !== null && row.duration_minutes !== null)
    ) as z.ZodType<{
    outcome: T[number];
    scheduled_at: string | null;
    duration_minutes: number | null;
  }>;
}

const ConfirmGuestBookingRowSchema = bookingOutcomeRowSchema(CONFIRM_OUTCOMES);
const RescheduleGuestBookingRowSchema = bookingOutcomeRowSchema(RESCHEDULE_OUTCOMES);
const CancelGuestBookingRowSchema = z.object({ outcome: z.enum(CANCEL_OUTCOMES) });

export type BookingPolicyRow = z.infer<typeof BookingPolicyRowSchema>;
export type HoldBookingSlotRow = z.infer<typeof HoldBookingSlotRowSchema>;
export type BookingChallengeRow = z.infer<typeof BookingChallengeRowSchema>;
export type ConfirmGuestBookingRow = z.infer<typeof ConfirmGuestBookingRowSchema>;
export type RescheduleGuestBookingRow = z.infer<typeof RescheduleGuestBookingRowSchema>;
export type CancelGuestBookingRow = z.infer<typeof CancelGuestBookingRowSchema>;

// ─── Policy and availability (design §5, D10) ───────────────────────────────

/**
 * The public-safe header of a company's booking policy. Always exactly one
 * row: a company with no policy row reads as `mode = 'off'` (design §4.1), so
 * the caller never has to tell "absent" from "off".
 */
export async function readBookingPolicy(
  client: CustomerIdentityRpcClient,
  input: { companyId: string }
): Promise<BookingPolicyRow> {
  const operation = "read_public_booking_policy";
  scalar(input.companyId, PostgresUuidSchema, operation);
  const data = await callSystemRpc(
    client,
    "read_public_booking_policy_as_system",
    { p_company_id: input.companyId },
    operation
  );
  return singleRow(data, BookingPolicyRowSchema, operation);
}

/**
 * Slot starts the company is currently offering, already net of notice,
 * horizon, existing bookings, live holds and the per-day cap. Empty is an
 * answer, never a failure — a fully booked week and a closed one look the
 * same from outside, which is the point.
 */
export async function readPublicAvailability(
  client: CustomerIdentityRpcClient,
  input: { companyId: string; from: string; to: string }
): Promise<readonly Date[]> {
  const operation = "read_public_availability";
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.from, IsoDateSchema, operation);
  scalar(input.to, IsoDateSchema, operation);
  const data = await callSystemRpc(
    client,
    "read_public_availability_as_system",
    { p_company_id: input.companyId, p_from: input.from, p_to: input.to },
    operation
  );
  if (data == null) return Object.freeze([]);
  if (!Array.isArray(data)) throw new CustomerIdentityStoreError(operation);
  return Object.freeze(
    data.map((row) => {
      const parsed = AvailabilitySlotRowSchema.safeParse(row);
      if (!parsed.success) throw new CustomerIdentityStoreError(operation);
      return new Date(parsed.data.slot_start_at);
    })
  );
}

// ─── Holds (design I13) ─────────────────────────────────────────────────────

export async function holdBookingSlot(
  client: CustomerIdentityRpcClient,
  input: { companyId: string; slotStartAt: Date; networkFingerprint: string }
): Promise<HoldBookingSlotRow> {
  const operation = "hold_booking_slot";
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "hold_booking_slot_as_system",
    {
      p_company_id: input.companyId,
      p_slot_start_at: isoInstant(input.slotStartAt, operation),
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  return singleRow(data, HoldBookingSlotRowSchema, operation);
}

// ─── Contact + verification (design §5.2, §6) ───────────────────────────────

export async function beginBookingContact(
  client: CustomerIdentityRpcClient,
  input: {
    intentId: string;
    companyId: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    answers: Readonly<Record<string, unknown>>;
    emailDigest: string;
    networkFingerprint: string;
  }
): Promise<BookingChallengeRow> {
  const operation = "begin_guest_booking_contact";
  scalar(input.intentId, PostgresUuidSchema, operation);
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.emailDigest, EmailDigestSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "begin_guest_booking_contact_as_system",
    {
      p_intent_id: input.intentId,
      p_company_id: input.companyId,
      p_contact_name: input.contactName,
      p_contact_email: input.contactEmail,
      p_contact_phone: input.contactPhone,
      p_answers: input.answers,
      p_email_digest: input.emailDigest,
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  return singleRow(data, BookingChallengeRowSchema, operation);
}

/**
 * The atomic core (design §5). Under the company lock it re-validates the
 * slot against live policy and bookings (I12), resolves the client, creates
 * the lead, then branches on mode: `instant` books the visit, `request` stops
 * at a pending request and touches no calendar (I14).
 */
export async function confirmGuestBooking(
  client: CustomerIdentityRpcClient,
  input: {
    intentId: string;
    companyId: string;
    challengeId: string;
    verifiedChannel: "email" | "phone";
    networkFingerprint: string;
  }
): Promise<ConfirmGuestBookingRow> {
  const operation = "confirm_guest_booking";
  scalar(input.intentId, PostgresUuidSchema, operation);
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.challengeId, PostgresUuidSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "confirm_guest_booking_as_system",
    {
      p_intent_id: input.intentId,
      p_company_id: input.companyId,
      p_challenge_id: input.challengeId,
      p_verified_channel: input.verifiedChannel,
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  return singleRow(data, ConfirmGuestBookingRowSchema, operation);
}

// ─── Management after a fresh code (design I15) ─────────────────────────────

export async function beginBookingManage(
  client: CustomerIdentityRpcClient,
  input: {
    intentId: string;
    companyId: string;
    emailDigest: string;
    networkFingerprint: string;
  }
): Promise<BookingChallengeRow> {
  const operation = "begin_guest_booking_manage";
  scalar(input.intentId, PostgresUuidSchema, operation);
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.emailDigest, EmailDigestSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "begin_guest_booking_manage_as_system",
    {
      p_intent_id: input.intentId,
      p_company_id: input.companyId,
      p_email_digest: input.emailDigest,
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  return singleRow(data, BookingChallengeRowSchema, operation);
}

export async function rescheduleGuestBooking(
  client: CustomerIdentityRpcClient,
  input: {
    intentId: string;
    companyId: string;
    challengeId: string;
    slotStartAt: Date;
    networkFingerprint: string;
  }
): Promise<RescheduleGuestBookingRow> {
  const operation = "reschedule_guest_booking";
  scalar(input.intentId, PostgresUuidSchema, operation);
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.challengeId, PostgresUuidSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "reschedule_guest_booking_as_system",
    {
      p_intent_id: input.intentId,
      p_company_id: input.companyId,
      p_challenge_id: input.challengeId,
      p_slot_start_at: isoInstant(input.slotStartAt, operation),
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  return singleRow(data, RescheduleGuestBookingRowSchema, operation);
}

export async function cancelGuestBooking(
  client: CustomerIdentityRpcClient,
  input: {
    intentId: string;
    companyId: string;
    challengeId: string;
    networkFingerprint: string;
  }
): Promise<CancelGuestBookingRow> {
  const operation = "cancel_guest_booking";
  scalar(input.intentId, PostgresUuidSchema, operation);
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.challengeId, PostgresUuidSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const data = await callSystemRpc(
    client,
    "cancel_guest_booking_as_system",
    {
      p_intent_id: input.intentId,
      p_company_id: input.companyId,
      p_challenge_id: input.challengeId,
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  return singleRow(data, CancelGuestBookingRowSchema, operation);
}

function isoInstant(value: Date, operation: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new CustomerIdentityStoreError(operation);
  }
  return value.toISOString();
}
