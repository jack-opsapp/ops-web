import "server-only";

import { z } from "zod-v4";

import { PostgresUuidSchema } from "@/lib/agent-control-plane/contracts/postgres-uuid";

import { CustomerIdentityStoreError } from "./errors";
import { scalar, singleRow, type CustomerIdentityRpcClient } from "./rpc";

/**
 * Typed access to the P2 guest-booking system RPCs, exactly as
 * `supabase/migrations/20260902190000_public_booking_foundation.sql` landed
 * them (design §5).
 *
 * Two properties of that migration make this layer load-bearing rather than
 * decorative:
 *
 *  1. **Refusals arrive as raised exceptions**, not as outcome columns. A slot
 *     that went, a hold that expired and an address that does not match the
 *     intent all `raise exception` with a named message. Here they become
 *     typed outcomes; anything unrecognised stays a genuine failure, so a real
 *     outage can never read as "that time is taken".
 *  2. **The confirm and management RPCs return real ids** — client,
 *     opportunity, site visit. They stop at this boundary. Nothing above it
 *     ever receives one, so no route can leak one (I4).
 */

export type { CustomerIdentityRpcClient } from "./rpc";

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const EmailDigestSchema = z.string().regex(/^[1-9][0-9]{0,4}:[0-9a-f]{64}$/);
const IsoDateSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
const TimestampSchema = z
  .string()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)));

export const BOOKING_MODES = ["off", "request", "instant"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

/** What a guest booking answer looks like: a flat object of scalars. */
export type BookingAnswerValue = string | number | boolean | null;
export type BookingAnswer = Readonly<Record<string, BookingAnswerValue>>;

// ─── Refusal classification ─────────────────────────────────────────────────

/**
 * The named exceptions the migration raises. Everything absent from these two
 * sets — `access_denied`, an input-validation raise, a transport failure — is a
 * real failure and is never softened into a customer-facing refusal.
 */
const SLOT_REFUSAL_MESSAGES = Object.freeze([
  "booking_slot_unavailable",
  "booking_not_available",
]);
const INTENT_REFUSAL_MESSAGES = Object.freeze([
  "booking_intent_not_found",
  "booking_intent_not_holdable",
  "booking_hold_expired",
  "booking_contact_mismatch",
  "booking_not_reschedulable",
  "booking_not_cancellable",
  "site_visit_not_found",
  "site_visit_not_a_booking",
  "site_visit_not_reschedulable",
]);
/** The RPC is not deployed yet — used only where failing closed is correct. */
const MISSING_FUNCTION_CODES = Object.freeze(["PGRST202", "42883"]);

export type BookingRefusal = "slot_no_longer_available" | "not_actionable";

function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const { message } = error as { message?: unknown };
  return typeof message === "string" ? message : "";
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : "";
}

function classifyRefusal(error: unknown): BookingRefusal | null {
  const message = errorMessage(error);
  if (SLOT_REFUSAL_MESSAGES.some((name) => message.includes(name))) {
    return "slot_no_longer_available";
  }
  if (INTENT_REFUSAL_MESSAGES.some((name) => message.includes(name))) {
    return "not_actionable";
  }
  return null;
}

function isMissingFunction(error: unknown): boolean {
  const code = errorCode(error);
  if (MISSING_FUNCTION_CODES.includes(code)) return true;
  const message = errorMessage(error);
  return /could not find the function|does not exist/i.test(message);
}

type RpcResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: unknown };

async function callBookingRpc(
  client: CustomerIdentityRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  operation: string
): Promise<RpcResult> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.rpc(functionName, args));
  } catch (cause) {
    throw new CustomerIdentityStoreError(operation, { cause });
  }
  if (error != null) return Object.freeze({ ok: false, error });
  return Object.freeze({ ok: true, data });
}

/** A refusal the customer may see, or a rethrow. Never a silent success. */
function refusalOrThrow(
  error: unknown,
  operation: string
): BookingRefusal {
  const refusal = classifyRefusal(error);
  if (refusal === null) throw new CustomerIdentityStoreError(operation, { cause: error });
  return refusal;
}

// ─── Policy and availability (design D10) ───────────────────────────────────

const BookingPolicyRowSchema = z.object({
  mode: z.enum(BOOKING_MODES),
  timezone: z.string().min(1).max(64),
  visit_duration_minutes: z.number().int().min(15).max(480),
  min_notice_hours: z.number().int().min(0).max(720),
  horizon_days: z.number().int().min(1).max(120),
});

const AvailabilitySlotRowSchema = z.object({ slot_start_at: TimestampSchema });

const HoldBookingSlotRowSchema = z
  .object({
    intent_id: PostgresUuidSchema.nullable(),
    hold_expires_at: TimestampSchema.nullable(),
    allowed: z.boolean(),
    retry_after_seconds: z.number().int().min(0).nullable(),
  })
  .refine((row) => !row.allowed || (row.intent_id !== null && row.hold_expires_at !== null));

const RecordContactRowSchema = z.object({
  intent_id: PostgresUuidSchema,
  hold_expires_at: TimestampSchema.nullable(),
  accepted: z.boolean(),
});

// The confirm row carries client, opportunity and site-visit ids. They are
// validated so a malformed row still fails, and then discarded (I4).
const ConfirmGuestBookingRowSchema = z
  .object({
    outcome: z.enum(["confirmed", "submitted"]),
    intent_id: PostgresUuidSchema,
    client_id: PostgresUuidSchema.nullable(),
    opportunity_id: PostgresUuidSchema.nullable(),
    site_visit_id: PostgresUuidSchema.nullable(),
    scheduled_at: TimestampSchema.nullable(),
  })
  .refine((row) => row.outcome !== "confirmed" || row.scheduled_at !== null)
  .refine((row) => row.outcome !== "submitted" || row.scheduled_at === null);

const RescheduleRowSchema = z.object({
  intent_id: PostgresUuidSchema,
  site_visit_id: PostgresUuidSchema.nullable(),
  scheduled_at: TimestampSchema,
});

const CancelRowSchema = z.object({
  intent_id: PostgresUuidSchema,
  site_visit_id: PostgresUuidSchema.nullable(),
});

export type BookingPolicyRow = z.infer<typeof BookingPolicyRowSchema>;
export type HoldBookingSlotRow = z.infer<typeof HoldBookingSlotRowSchema>;
export type RecordContactRow = z.infer<typeof RecordContactRowSchema>;

export interface ConfirmGuestBookingResult {
  readonly outcome: "confirmed" | "submitted" | BookingRefusal;
  /** Present only for `confirmed`: a request has no time on any calendar (I14). */
  readonly scheduledAt: string | null;
}

export interface ManageGuestBookingResult {
  readonly outcome: "rescheduled" | "cancelled" | BookingRefusal;
  readonly scheduledAt: string | null;
}

/**
 * The company's public-safe policy header, or `null` when it does not take
 * bookings — the RPC returns no row for `mode = 'off'` or a deleted company,
 * so the caller never has to tell "absent" from "off".
 */
export async function readBookingPolicy(
  client: CustomerIdentityRpcClient,
  input: { companyId: string }
): Promise<BookingPolicyRow | null> {
  const operation = "read_public_booking_policy";
  scalar(input.companyId, PostgresUuidSchema, operation);
  const result = await callBookingRpc(
    client,
    "read_public_booking_policy_as_system",
    { p_company_id: input.companyId },
    operation
  );
  if (!result.ok) throw new CustomerIdentityStoreError(operation, { cause: result.error });
  if (result.data == null) return null;
  if (!Array.isArray(result.data)) throw new CustomerIdentityStoreError(operation);
  if (result.data.length === 0) return null;
  return singleRow(result.data, BookingPolicyRowSchema, operation);
}

/**
 * Slot starts the company is currently offering, already net of notice,
 * horizon, existing bookings, live holds and the per-day cap. Empty is an
 * answer, never a failure — a fully booked week and a closed one look the same
 * from outside, which is the point.
 */
export async function readPublicAvailability(
  client: CustomerIdentityRpcClient,
  input: { companyId: string; from: string; to: string }
): Promise<readonly Date[]> {
  const operation = "read_public_availability";
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.from, IsoDateSchema, operation);
  scalar(input.to, IsoDateSchema, operation);
  const result = await callBookingRpc(
    client,
    "read_public_availability_as_system",
    { p_company_id: input.companyId, p_from: input.from, p_to: input.to },
    operation
  );
  if (!result.ok) throw new CustomerIdentityStoreError(operation, { cause: result.error });
  if (result.data == null) return Object.freeze([]);
  if (!Array.isArray(result.data)) throw new CustomerIdentityStoreError(operation);
  return Object.freeze(
    result.data.map((row) => {
      const parsed = AvailabilitySlotRowSchema.safeParse(row);
      if (!parsed.success) throw new CustomerIdentityStoreError(operation);
      return new Date(parsed.data.slot_start_at);
    })
  );
}

// ─── Holds (design I13) ─────────────────────────────────────────────────────

/**
 * One refusal shape for every reason a hold can fail — booking off, integration
 * inactive, slot closed, or a cap reached. The migration deliberately does not
 * distinguish them (I5), so neither does anything above.
 */
export async function holdBookingSlot(
  client: CustomerIdentityRpcClient,
  input: {
    companyId: string;
    integrationId: string;
    slotStartAt: Date;
    networkFingerprint: string;
  }
): Promise<HoldBookingSlotRow> {
  const operation = "hold_booking_slot";
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.integrationId, PostgresUuidSchema, operation);
  scalar(input.networkFingerprint, Sha256HexSchema, operation);
  const result = await callBookingRpc(
    client,
    "hold_booking_slot_as_system",
    {
      p_company_id: input.companyId,
      p_integration_id: input.integrationId,
      p_slot_start_at: isoInstant(input.slotStartAt, operation),
      p_network_fingerprint: input.networkFingerprint,
    },
    operation
  );
  if (!result.ok) throw new CustomerIdentityStoreError(operation, { cause: result.error });
  return singleRow(result.data, HoldBookingSlotRowSchema, operation);
}

// ─── Contact (design §5.2, I1) ──────────────────────────────────────────────

/**
 * Attach the details to a held intent. The address crosses as a keyed digest
 * for matching and as broker ciphertext for later mail; the plaintext is never
 * stored on the row. `accepted: false` means the hold is dead, already used or
 * unknown — the caller answers identically either way (I5).
 */
export async function recordBookingContact(
  client: CustomerIdentityRpcClient,
  input: {
    intentId: string;
    contactName: string;
    contactEmailDigest: string;
    contactEmailEncrypted: string;
    contactPhone: string | null;
    answers: readonly BookingAnswer[];
  }
): Promise<RecordContactRow> {
  const operation = "record_guest_booking_contact";
  scalar(input.intentId, PostgresUuidSchema, operation);
  scalar(input.contactEmailDigest, EmailDigestSchema, operation);
  const result = await callBookingRpc(
    client,
    "record_guest_booking_contact_as_system",
    {
      p_intent_id: input.intentId,
      p_contact_name: input.contactName,
      p_contact_email_digest: input.contactEmailDigest,
      p_contact_email_encrypted: input.contactEmailEncrypted,
      p_contact_phone: input.contactPhone,
      p_answers: input.answers,
    },
    operation
  );
  if (!result.ok) throw new CustomerIdentityStoreError(operation, { cause: result.error });
  return singleRow(result.data, RecordContactRowSchema, operation);
}

// ─── The atomic core (design §5, I12, I14) ──────────────────────────────────

/**
 * Under the company lock: re-validate the slot against live policy and
 * bookings, resolve the client, create the lead, then branch on mode —
 * `instant` books the visit and answers with the time, `request` stops at a
 * pending request and answers with no time at all, because there is none on
 * any calendar (I14).
 */
export async function confirmGuestBooking(
  client: CustomerIdentityRpcClient,
  input: {
    intentId: string;
    contactEmailDigest: string;
    contactEmail: string;
    verifiedChannel: "email" | "phone";
  }
): Promise<ConfirmGuestBookingResult> {
  const operation = "confirm_guest_booking";
  scalar(input.intentId, PostgresUuidSchema, operation);
  scalar(input.contactEmailDigest, EmailDigestSchema, operation);
  const result = await callBookingRpc(
    client,
    "confirm_guest_booking_as_system",
    {
      p_intent_id: input.intentId,
      p_contact_email_digest: input.contactEmailDigest,
      p_contact_email: input.contactEmail,
      p_verified_channel: input.verifiedChannel,
    },
    operation
  );
  if (!result.ok) {
    return Object.freeze({
      outcome: refusalOrThrow(result.error, operation),
      scheduledAt: null,
    });
  }
  const row = singleRow(result.data, ConfirmGuestBookingRowSchema, operation);
  return Object.freeze({ outcome: row.outcome, scheduledAt: row.scheduled_at });
}

// ─── Management after a fresh code (design I15) ─────────────────────────────

/**
 * May this address change this booking? Asked before any code is sent, so a
 * management link cannot be turned into a way to mail codes to strangers.
 *
 * **Missing from the P2-1 migration** — flagged to the PM with this exact
 * signature. Until it is deployed the call fails closed: the answer is "no",
 * no code is sent, and the surface behaves exactly as it does for a booking
 * that does not exist. A real store failure is never swallowed this way.
 */
export async function readGuestBookingManageable(
  client: CustomerIdentityRpcClient,
  input: { intentId: string; companyId: string; contactEmailDigest: string }
): Promise<boolean> {
  const operation = "read_guest_booking_manageable";
  scalar(input.intentId, PostgresUuidSchema, operation);
  scalar(input.companyId, PostgresUuidSchema, operation);
  scalar(input.contactEmailDigest, EmailDigestSchema, operation);
  const result = await callBookingRpc(
    client,
    "read_guest_booking_manageable_as_system",
    {
      p_intent_id: input.intentId,
      p_company_id: input.companyId,
      p_contact_email_digest: input.contactEmailDigest,
    },
    operation
  );
  if (!result.ok) {
    if (isMissingFunction(result.error)) return false;
    if (classifyRefusal(result.error) !== null) return false;
    throw new CustomerIdentityStoreError(operation, { cause: result.error });
  }
  return scalar(result.data, z.boolean(), operation);
}

export async function rescheduleGuestBooking(
  client: CustomerIdentityRpcClient,
  input: { intentId: string; scheduledAt: Date }
): Promise<ManageGuestBookingResult> {
  const operation = "reschedule_guest_booking";
  scalar(input.intentId, PostgresUuidSchema, operation);
  const result = await callBookingRpc(
    client,
    "reschedule_guest_booking_as_system",
    {
      p_intent_id: input.intentId,
      p_scheduled_at: isoInstant(input.scheduledAt, operation),
    },
    operation
  );
  if (!result.ok) {
    return Object.freeze({
      outcome: refusalOrThrow(result.error, operation),
      scheduledAt: null,
    });
  }
  const row = singleRow(result.data, RescheduleRowSchema, operation);
  return Object.freeze({ outcome: "rescheduled", scheduledAt: row.scheduled_at });
}

export async function cancelGuestBooking(
  client: CustomerIdentityRpcClient,
  input: { intentId: string; reason?: string }
): Promise<ManageGuestBookingResult> {
  const operation = "cancel_guest_booking";
  scalar(input.intentId, PostgresUuidSchema, operation);
  const result = await callBookingRpc(
    client,
    "cancel_guest_booking_as_system",
    { p_intent_id: input.intentId, p_reason: input.reason ?? null },
    operation
  );
  if (!result.ok) {
    return Object.freeze({
      outcome: refusalOrThrow(result.error, operation),
      scheduledAt: null,
    });
  }
  singleRow(result.data, CancelRowSchema, operation);
  return Object.freeze({ outcome: "cancelled", scheduledAt: null });
}

function isoInstant(value: Date, operation: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new CustomerIdentityStoreError(operation);
  }
  return value.toISOString();
}
