import "server-only";

import { randomUUID } from "node:crypto";

import type { CustomerIdentityDeps } from "./config";
import { emailDigest, normalizeEmail } from "./credentials";
import {
  cancelGuestBooking,
  confirmGuestBooking,
  holdBookingSlot,
  readBookingPolicy,
  readGuestBookingManageable,
  readPublicAvailability,
  recordBookingContact,
  rescheduleGuestBooking,
  type BookingAnswer,
  type BookingMode,
} from "./booking-rpc";
import { encryptContactEmail } from "./booking-crypto";
import {
  appendIdentityEvent,
  beginOtpChallenge,
  ensureHostedIntegration,
  recordOtpAttempt,
} from "./rpc";
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
 *
 * **Which company an intent belongs to is the ref's binding, checked by the
 * route before it calls here.** The landed RPCs take an intent id and prove
 * the rest themselves: the confirm re-checks that the verified address is the
 * one attached to the intent, so a proved code cannot be moved between
 * bookings. Nothing in this module re-derives a company from caller input.
 */

const CONTACT_NAME_MAX_LENGTH = 200;
const CONTACT_PHONE_MAX_LENGTH = 40;
const ANSWER_KEY_MAX_LENGTH = 120;
const ANSWER_FIELDS_MAX = 8;
const ANSWERS_SERIALIZED_MAX_LENGTH = 16_384;

/** `private.booking_answers_valid`: at most 100 entries, each a flat object. */
export const MAX_BOOKING_ANSWERS = 100 as const;

type BookingAnswerValue = string | number | boolean | null;

const CODE_PATTERN = /^[0-9]{6}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface BookingContact {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly answers: readonly BookingAnswer[];
}

export interface BookingAvailability {
  /** Never `off` — a company that has not turned booking on has no surface. */
  readonly mode: Exclude<BookingMode, "off">;
  readonly timezone: string;
  readonly durationMinutes: number;
  readonly slots: readonly Date[];
}

/**
 * One refusal, whatever the reason. The migration answers a closed slot, an
 * inactive integration and a reached cap identically — success minus the
 * intent — and nothing above it may invent a distinction it cannot see (I5).
 */
export type HoldSlotResult =
  | { readonly ok: true; readonly intentId: string; readonly holdExpiresAt: string }
  | { readonly ok: false; readonly reason: "slot_no_longer_available" };

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
      /** Null for `submitted`: a request is on nobody's calendar yet (I14). */
      readonly scheduledAt: string | null;
    }
  | { readonly ok: false; readonly reason: "slot_no_longer_available" }
  | { readonly ok: false; readonly reason: "not_confirmable" }
  | CodeRefusal;

export type ManageBookingAction = "reschedule" | "cancel";

export type ManageBookingResult =
  | { readonly ok: true; readonly outcome: "rescheduled"; readonly scheduledAt: string }
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
  if (policy === null || policy.mode === "off") return null;

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
  // Holds are attributed to the company's hosted-pages integration, which the
  // RPC re-checks is live before it grants anything.
  const integrationId = await ensureHostedIntegration(deps.rpc, {
    companyId: input.companyId,
  });
  const held = await holdBookingSlot(deps.rpc, {
    companyId: input.companyId,
    integrationId,
    slotStartAt: input.slotStartAt,
    networkFingerprint: input.networkFingerprint,
  });
  if (!held.allowed) {
    return Object.freeze({ ok: false, reason: "slot_no_longer_available" });
  }
  // The schema guarantees both are present on an allowed hold.
  return Object.freeze({
    ok: true,
    intentId: held.intent_id as string,
    holdExpiresAt: held.hold_expires_at as string,
  });
}

// ─── Contact (design §6) ────────────────────────────────────────────────────

/**
 * `private.booking_answers_valid`: an array of at most 100 flat objects, each
 * with at most 8 scalar fields, keys under 120 characters, and 16 KB of JSON
 * in total. Anything else is refused here rather than raised in SQL.
 */
function parseAnswers(input: unknown): readonly BookingAnswer[] | null {
  if (input === undefined || input === null) return Object.freeze([]);
  if (!Array.isArray(input)) return null;
  if (input.length > MAX_BOOKING_ANSWERS) return null;

  const answers: BookingAnswer[] = [];
  for (const entry of input) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const fields = Object.entries(entry as Record<string, unknown>);
    if (fields.length > ANSWER_FIELDS_MAX) return null;
    const answer: Record<string, BookingAnswerValue> = {};
    for (const [key, value] of fields) {
      if (key.length < 1 || key.length > ANSWER_KEY_MAX_LENGTH) return null;
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        value !== null
      ) {
        return null;
      }
      answer[key] = value;
    }
    answers.push(Object.freeze(answer));
  }
  if (JSON.stringify(answers).length > ANSWERS_SERIALIZED_MAX_LENGTH) return null;
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
  input: { intentId: string; contact: BookingContact; networkFingerprint: string }
): Promise<BookingChallengeStarted> {
  const digest = emailDigest(input.contact.email, deps.keyRing);
  const recorded = await recordBookingContact(deps.rpc, {
    intentId: input.intentId,
    contactName: input.contact.name,
    contactEmailDigest: digest,
    // The address is sealed here and opaque to SQL; the plaintext reaches the
    // confirm RPC as an argument and is never stored on the row.
    contactEmailEncrypted: encryptContactEmail(input.contact.email, deps.keyRing),
    contactPhone: input.contact.phone,
    answers: input.contact.answers,
  });
  if (!recorded.accepted) {
    return refuse(deps, input.networkFingerprint, "contact", 0);
  }

  const challenge = await beginOtpChallenge(deps.rpc, {
    emailDigest: digest,
    networkFingerprint: input.networkFingerprint,
  });
  if (!challenge.allowed) {
    return refuse(
      deps,
      input.networkFingerprint,
      "contact",
      challenge.retry_after_seconds
    );
  }

  await sendCode(deps, input.contact.email, input.networkFingerprint, "contact");
  return Object.freeze({
    challengeId: challenge.challenge_id as string,
    retryAfterSeconds: challenge.retry_after_seconds,
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
  const digest = emailDigest(email, deps.keyRing);

  // Nothing is sent until the database says this address is on this booking.
  // Otherwise a management link — which anyone who books once holds — becomes
  // a way to mail codes to strangers.
  const manageable = await readGuestBookingManageable(deps.rpc, {
    intentId: input.intentId,
    companyId: input.companyId,
    contactEmailDigest: digest,
  });
  if (!manageable) {
    return refuse(deps, input.networkFingerprint, "manage", 0);
  }

  const challenge = await beginOtpChallenge(deps.rpc, {
    emailDigest: digest,
    networkFingerprint: input.networkFingerprint,
  });
  if (!challenge.allowed) {
    return refuse(deps, input.networkFingerprint, "manage", challenge.retry_after_seconds);
  }

  await sendCode(deps, email, input.networkFingerprint, "manage");
  return Object.freeze({
    challengeId: challenge.challenge_id as string,
    retryAfterSeconds: challenge.retry_after_seconds,
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

  // The database re-checks that this verified address is the one attached to
  // the intent, so a proved code for one booking cannot confirm another.
  const confirmed = await confirmGuestBooking(deps.rpc, {
    intentId: input.intentId,
    contactEmailDigest: emailDigest(email, deps.keyRing),
    contactEmail: email,
    verifiedChannel: "email",
  });
  switch (confirmed.outcome) {
    case "confirmed":
    case "submitted":
      return Object.freeze({
        ok: true,
        outcome: confirmed.outcome,
        scheduledAt: confirmed.scheduledAt,
      });
    case "slot_no_longer_available":
      return Object.freeze({ ok: false, reason: "slot_no_longer_available" });
    case "not_actionable":
      return Object.freeze({ ok: false, reason: "not_confirmable" });
  }
}

export async function verifyBookingManage(
  deps: CustomerIdentityDeps,
  input: {
    intentId: string;
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

  const result =
    input.action === "cancel"
      ? await cancelGuestBooking(deps.rpc, {
          intentId: input.intentId,
          reason: "customer_cancelled",
        })
      : await rescheduleGuestBooking(deps.rpc, {
          intentId: input.intentId,
          scheduledAt: input.slotStartAt as Date,
        });

  switch (result.outcome) {
    case "cancelled":
      return Object.freeze({ ok: true, outcome: "cancelled" });
    case "rescheduled":
      return Object.freeze({
        ok: true,
        outcome: "rescheduled",
        scheduledAt: result.scheduledAt as string,
      });
    case "slot_no_longer_available":
      return Object.freeze({ ok: false, reason: "slot_no_longer_available" });
    case "not_actionable":
      return Object.freeze({ ok: false, reason: "not_manageable" });
  }
}
