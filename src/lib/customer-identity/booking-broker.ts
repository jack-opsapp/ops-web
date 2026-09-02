import "server-only";

import { randomUUID } from "node:crypto";

import type { CustomerIdentityDeps } from "./config";
import { emailDigest, normalizeEmail } from "./credentials";
import {
  beginBookingContact,
  beginBookingManage,
  cancelGuestBooking,
  confirmGuestBooking,
  holdBookingSlot,
  readBookingPolicy,
  readPublicAvailability,
  rescheduleGuestBooking,
  type BookingMode,
} from "./booking-rpc";
import { appendIdentityEvent, recordOtpAttempt } from "./rpc";
import { OTP_MAX_ATTEMPTS } from "./otp";

/**
 * Guest booking (design §5.2, §6; D9–D11, I5, I11–I15).
 *
 * A homeowner sees times the business chose to offer, holds one, proves an
 * email by code, and ends up with a real visit — or, in `request` mode, a
 * request nobody's calendar has heard of yet (I14). No OPS account is created
 * anywhere in this module: the customer auth project checks the code, the
 * session it hands back is discarded, and no `customer_identities` row, no
 * broker session and no `app_metadata` write follows (D11). A later sign-in
 * with the same verified email claims the booking.
 *
 * Refusals are shaped like the successes they hide. A ref that names nothing,
 * a booking held under another address, and a send the limits refused all
 * answer with a challenge that will never resolve — the caller cannot tell
 * them apart, and neither can anyone probing the surface (I5, I11).
 */

const CONTACT_NAME_MAX_LENGTH = 200;
const CONTACT_PHONE_MAX_LENGTH = 50;
const ANSWER_KEY_MAX_LENGTH = 64;
const ANSWER_VALUE_MAX_LENGTH = 500;

/** Same bound the intake ledger holds its answers to (design §4.2). */
export const MAX_BOOKING_ANSWERS = 100 as const;

const CODE_PATTERN = /^[0-9]{6}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type BookingAnswerValue = string | number | boolean | null;

export interface BookingContact {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly answers: Readonly<Record<string, BookingAnswerValue>>;
}

export interface BookingAvailability {
  /** Never `off` — a company that has not turned booking on has no surface. */
  readonly mode: Exclude<BookingMode, "off">;
  readonly timezone: string;
  readonly durationMinutes: number;
  readonly slots: readonly Date[];
}

export type HoldSlotResult =
  | { readonly ok: true; readonly intentId: string; readonly holdExpiresAt: string }
  | { readonly ok: false; readonly reason: "slot_unavailable" }
  | {
      readonly ok: false;
      readonly reason: "rate_limited";
      readonly retryAfterSeconds: number;
    };

/** Identical for an accepted intent, a refused one and a refused send (I5). */
export interface BookingChallengeStarted {
  readonly challengeId: string;
  readonly retryAfterSeconds: number;
}

type CodeRefusal =
  | {
      readonly ok: false;
      readonly reason: "invalid_code";
      readonly attemptsRemaining: number;
    }
  | { readonly ok: false; readonly reason: "challenge_exhausted" }
  | { readonly ok: false; readonly reason: "challenge_closed" };

export type ConfirmBookingResult =
  | {
      readonly ok: true;
      readonly outcome: "confirmed" | "submitted";
      readonly scheduledAt: string;
      readonly durationMinutes: number;
    }
  | { readonly ok: false; readonly reason: "slot_no_longer_available" }
  | { readonly ok: false; readonly reason: "not_confirmable" }
  | CodeRefusal;

export type ManageBookingAction = "reschedule" | "cancel";

export type ManageBookingResult =
  | {
      readonly ok: true;
      readonly outcome: "rescheduled";
      readonly scheduledAt: string;
      readonly durationMinutes: number;
    }
  | { readonly ok: true; readonly outcome: "cancelled" }
  | { readonly ok: false; readonly reason: "slot_no_longer_available" }
  | { readonly ok: false; readonly reason: "not_manageable" }
  | CodeRefusal;

// ─── Availability (design D10) ──────────────────────────────────────────────

/**
 * What the business is offering, and nothing about who would attend (I11).
 * `null` means the company has not turned public booking on — there is no
 * surface to answer with, so the caller renders no page and no error either.
 */
export async function readBookingAvailability(
  deps: CustomerIdentityDeps,
  input: { companyId: string; from: string; to: string }
): Promise<BookingAvailability | null> {
  const policy = await readBookingPolicy(deps.rpc, { companyId: input.companyId });
  if (policy.mode === "off") return null;

  const slots = await readPublicAvailability(deps.rpc, {
    companyId: input.companyId,
    from: input.from,
    to: input.to,
  });
  return Object.freeze({
    mode: policy.mode,
    timezone: policy.timezone,
    durationMinutes: policy.visit_duration_minutes,
    slots,
  });
}

// ─── Holds (design I13) ─────────────────────────────────────────────────────

export async function holdSlot(
  deps: CustomerIdentityDeps,
  input: { companyId: string; slotStartAt: Date; networkFingerprint: string }
): Promise<HoldSlotResult> {
  const held = await holdBookingSlot(deps.rpc, input);
  if (held.allowed) {
    // The schema guarantees both are present on an allowed hold.
    return Object.freeze({
      ok: true,
      intentId: held.intent_id as string,
      holdExpiresAt: held.hold_expires_at as string,
    });
  }
  if (held.reason === "rate_limited") {
    return Object.freeze({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: held.retry_after_seconds,
    });
  }
  return Object.freeze({ ok: false, reason: "slot_unavailable" });
}

// ─── Contact (design §6) ────────────────────────────────────────────────────

function parseAnswers(
  input: unknown
): Readonly<Record<string, BookingAnswerValue>> | null {
  if (input === undefined || input === null) return Object.freeze({});
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_BOOKING_ANSWERS) return null;
  const answers: Record<string, BookingAnswerValue> = {};
  for (const [key, value] of entries) {
    if (key.length < 1 || key.length > ANSWER_KEY_MAX_LENGTH) return null;
    if (typeof value === "string") {
      if (value.length > ANSWER_VALUE_MAX_LENGTH) return null;
      answers[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      answers[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      answers[key] = value;
    } else {
      return null;
    }
  }
  return Object.freeze(answers);
}

/**
 * The website's own questions and the one channel that will be proved. The
 * phone is evidence only: it is stored, never verified and never matched (I1).
 */
export function parseBookingContact(
  input: Readonly<Record<string, unknown>>
): BookingContact | null {
  if (typeof input !== "object" || input === null) return null;

  const rawName = typeof input.name === "string" ? input.name.trim() : "";
  if (rawName.length < 1 || rawName.length > CONTACT_NAME_MAX_LENGTH) return null;

  const email = typeof input.email === "string" ? normalizeEmail(input.email) : null;
  if (email === null) return null;

  let phone: string | null = null;
  if (input.phone !== undefined && input.phone !== null) {
    if (typeof input.phone !== "string") return null;
    const trimmed = input.phone.trim();
    if (trimmed.length > CONTACT_PHONE_MAX_LENGTH) return null;
    phone = trimmed.length > 0 ? trimmed : null;
  }

  const answers = parseAnswers(input.answers);
  if (answers === null) return null;

  return Object.freeze({ name: rawName, email, phone, answers });
}

/**
 * A challenge that will never resolve. Every refusal answers with one so the
 * shape of a refused intent, a refused send and an accepted one is identical;
 * the verify step treats an unknown challenge exactly like a closed one.
 */
function decoyChallenge(retryAfterSeconds: number): BookingChallengeStarted {
  return Object.freeze({ challengeId: randomUUID(), retryAfterSeconds });
}

function providerErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code)) return code;
  if (typeof status === "number") return `status_${status}`;
  return null;
}

/** Send the six-digit code, logging by code only — never the address. */
async function sendCode(
  deps: CustomerIdentityDeps,
  email: string,
  fingerprint: string,
  stage: "contact" | "manage"
): Promise<void> {
  let sendError: unknown = null;
  try {
    ({ error: sendError } = await deps.auth.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    }));
  } catch (cause) {
    sendError = cause;
  }
  if (sendError != null) {
    console.error("[customer-identity] booking otp send failed", {
      stage,
      code: providerErrorCode(sendError),
    });
  }
  await appendIdentityEvent(deps.rpc, {
    eventType: sendError == null ? "otp_started" : "otp_send_failed",
    identityId: null,
    companyId: null,
    sessionId: null,
    networkFingerprint: fingerprint,
    metadata: { flow: "booking", stage },
  });
}

async function refuse(
  deps: CustomerIdentityDeps,
  fingerprint: string,
  stage: "contact" | "manage",
  retryAfterSeconds: number
): Promise<BookingChallengeStarted> {
  await appendIdentityEvent(deps.rpc, {
    eventType: "otp_refused",
    identityId: null,
    companyId: null,
    sessionId: null,
    networkFingerprint: fingerprint,
    metadata: { flow: "booking", stage, retry_after_seconds: retryAfterSeconds },
  });
  return decoyChallenge(retryAfterSeconds);
}

export async function startBookingContact(
  deps: CustomerIdentityDeps,
  input: {
    intentId: string;
    companyId: string;
    contact: BookingContact;
    networkFingerprint: string;
  }
): Promise<BookingChallengeStarted> {
  const started = await beginBookingContact(deps.rpc, {
    intentId: input.intentId,
    companyId: input.companyId,
    contactName: input.contact.name,
    contactEmail: input.contact.email,
    contactPhone: input.contact.phone,
    answers: input.contact.answers,
    emailDigest: emailDigest(input.contact.email, deps.keyRing),
    networkFingerprint: input.networkFingerprint,
  });
  if (!started.allowed) {
    return refuse(
      deps,
      input.networkFingerprint,
      "contact",
      started.retry_after_seconds
    );
  }

  await sendCode(deps, input.contact.email, input.networkFingerprint, "contact");
  return Object.freeze({
    challengeId: started.challenge_id as string,
    retryAfterSeconds: started.retry_after_seconds,
  });
}

export async function startBookingManage(
  deps: CustomerIdentityDeps,
  input: {
    intentId: string;
    companyId: string;
    email: string;
    networkFingerprint: string;
  }
): Promise<BookingChallengeStarted> {
  const email = normalizeEmail(input.email);
  if (email === null) {
    return refuse(deps, input.networkFingerprint, "manage", 0);
  }
  const started = await beginBookingManage(deps.rpc, {
    intentId: input.intentId,
    companyId: input.companyId,
    emailDigest: emailDigest(email, deps.keyRing),
    networkFingerprint: input.networkFingerprint,
  });
  if (!started.allowed) {
    return refuse(deps, input.networkFingerprint, "manage", started.retry_after_seconds);
  }

  await sendCode(deps, email, input.networkFingerprint, "manage");
  return Object.freeze({
    challengeId: started.challenge_id as string,
    retryAfterSeconds: started.retry_after_seconds,
  });
}

// ─── Proving the channel (design §5.2) ──────────────────────────────────────

type CodeProof = { readonly ok: true } | CodeRefusal;

/**
 * The sign-in challenge machinery, minus the identity. Charge the attempt
 * first — concurrent guesses cannot all slip through one stale check, and a
 * transport failure on the proxy still costs the attempt — then check the code
 * at the customer auth project and discard everything it returns.
 */
async function proveCode(
  deps: CustomerIdentityDeps,
  input: {
    challengeId: string;
    email: string;
    code: string;
    networkFingerprint: string;
    stage: "verify" | "manage";
  }
): Promise<CodeProof> {
  const attempt = await recordOtpAttempt(deps.rpc, {
    challengeId: input.challengeId,
    success: false,
  });
  if (attempt === null) {
    return Object.freeze({ ok: false, reason: "challenge_closed" });
  }
  if (attempt.exhausted || attempt.attempts > OTP_MAX_ATTEMPTS) {
    const exhausted = attempt.attempts > OTP_MAX_ATTEMPTS;
    await appendIdentityEvent(deps.rpc, {
      eventType: "otp_refused",
      identityId: null,
      companyId: null,
      sessionId: null,
      networkFingerprint: input.networkFingerprint,
      metadata: {
        flow: "booking",
        stage: input.stage,
        attempts: attempt.attempts,
        exhausted,
      },
    });
    return Object.freeze(
      exhausted
        ? ({ ok: false, reason: "challenge_exhausted" } as const)
        : ({ ok: false, reason: "challenge_closed" } as const)
    );
  }

  let proven = false;
  let verifyError: unknown = null;
  try {
    const { data, error } = await deps.auth.auth.verifyOtp({
      email: input.email,
      token: input.code,
      type: "email",
    });
    verifyError = error;
    // `data.session` is deliberately never read: a guest never holds one.
    if (error == null && data.user !== null && UUID_PATTERN.test(data.user.id)) {
      proven = true;
    }
  } catch (cause) {
    verifyError = cause;
  }

  if (!proven) {
    await appendIdentityEvent(deps.rpc, {
      eventType: "otp_failed",
      identityId: null,
      companyId: null,
      sessionId: null,
      networkFingerprint: input.networkFingerprint,
      metadata: {
        flow: "booking",
        stage: input.stage,
        attempts: attempt.attempts,
        provider_error: verifyError == null ? null : providerErrorCode(verifyError),
      },
    });
    return Object.freeze({
      ok: false,
      reason: "invalid_code",
      attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - attempt.attempts),
    });
  }

  await recordOtpAttempt(deps.rpc, { challengeId: input.challengeId, success: true });
  await appendIdentityEvent(deps.rpc, {
    eventType: "otp_verified",
    identityId: null,
    companyId: null,
    sessionId: null,
    networkFingerprint: input.networkFingerprint,
    metadata: { flow: "booking", stage: input.stage, attempts: attempt.attempts },
  });
  return Object.freeze({ ok: true });
}

/**
 * Prove the channel, then confirm. The confirm is the only thing that can say
 * a booking exists: the descriptor the page held was a proposal, and the
 * database may still refuse it (I12).
 */
export async function verifyBookingContact(
  deps: CustomerIdentityDeps,
  input: {
    intentId: string;
    companyId: string;
    challengeId: string;
    email: string;
    code: string;
    networkFingerprint: string;
  }
): Promise<ConfirmBookingResult> {
  const email = normalizeEmail(input.email);
  if (email === null || !CODE_PATTERN.test(input.code.trim())) {
    return Object.freeze({ ok: false, reason: "not_confirmable" });
  }

  const proof = await proveCode(deps, {
    challengeId: input.challengeId,
    email,
    code: input.code.trim(),
    networkFingerprint: input.networkFingerprint,
    stage: "verify",
  });
  if (!proof.ok) return proof;

  const confirmed = await confirmGuestBooking(deps.rpc, {
    intentId: input.intentId,
    companyId: input.companyId,
    challengeId: input.challengeId,
    verifiedChannel: "email",
    networkFingerprint: input.networkFingerprint,
  });
  if (confirmed.outcome === "confirmed" || confirmed.outcome === "submitted") {
    return Object.freeze({
      ok: true,
      outcome: confirmed.outcome,
      scheduledAt: confirmed.scheduled_at as string,
      durationMinutes: confirmed.duration_minutes as number,
    });
  }
  return Object.freeze({ ok: false, reason: confirmed.outcome });
}

export async function verifyBookingManage(
  deps: CustomerIdentityDeps,
  input: {
    intentId: string;
    companyId: string;
    challengeId: string;
    email: string;
    code: string;
    action: ManageBookingAction;
    slotStartAt?: Date;
    networkFingerprint: string;
  }
): Promise<ManageBookingResult> {
  const email = normalizeEmail(input.email);
  if (email === null || !CODE_PATTERN.test(input.code.trim())) {
    return Object.freeze({ ok: false, reason: "not_manageable" });
  }
  if (input.action === "reschedule" && !(input.slotStartAt instanceof Date)) {
    return Object.freeze({ ok: false, reason: "not_manageable" });
  }

  const proof = await proveCode(deps, {
    challengeId: input.challengeId,
    email,
    code: input.code.trim(),
    networkFingerprint: input.networkFingerprint,
    stage: "manage",
  });
  if (!proof.ok) return proof;

  if (input.action === "cancel") {
    const cancelled = await cancelGuestBooking(deps.rpc, {
      intentId: input.intentId,
      companyId: input.companyId,
      challengeId: input.challengeId,
      networkFingerprint: input.networkFingerprint,
    });
    return cancelled.outcome === "cancelled"
      ? Object.freeze({ ok: true, outcome: "cancelled" })
      : Object.freeze({ ok: false, reason: "not_manageable" });
  }

  const rescheduled = await rescheduleGuestBooking(deps.rpc, {
    intentId: input.intentId,
    companyId: input.companyId,
    challengeId: input.challengeId,
    slotStartAt: input.slotStartAt as Date,
    networkFingerprint: input.networkFingerprint,
  });
  if (rescheduled.outcome === "rescheduled") {
    return Object.freeze({
      ok: true,
      outcome: "rescheduled",
      scheduledAt: rescheduled.scheduled_at as string,
      durationMinutes: rescheduled.duration_minutes as number,
    });
  }
  return Object.freeze({ ok: false, reason: rescheduled.outcome });
}
