import "server-only";

import { randomUUID } from "node:crypto";

import type { CustomerIdentityDeps } from "./config";
import {
  emailDigest,
  mintSessionCredential,
  normalizeEmail,
  sessionDigest,
} from "./credentials";
import {
  CustomerContactConflictError,
  CustomerIdentityInputError,
  CustomerIdentityStoreError,
} from "./errors";
import {
  appendIdentityEvent,
  beginOtpChallenge,
  mintSession,
  recordOtpAttempt,
  upsertIdentity,
} from "./rpc";

/**
 * Email OTP sign-in (design §5.1, D4, I5, I8).
 *
 * The customer auth project issues and checks the six-digit code; the broker
 * owns attempt accounting and refuses before proxying when a challenge is
 * exhausted or closed. The Supabase session that `verifyOtp` returns is
 * discarded on the spot: it is never persisted, logged or returned. The only
 * credential that leaves this module is the broker's own opaque session.
 */

export const OTP_MAX_ATTEMPTS = 5 as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_PATTERN = /^[0-9]{6}$/;

export interface StartOtpInput {
  readonly email: string;
  readonly networkFingerprint: string;
}

/** Identical for known, unknown and refused emails (design I5). */
export interface StartOtpResult {
  readonly challengeId: string;
  readonly retryAfterSeconds: number;
}

export interface VerifyOtpInput {
  readonly challengeId: string;
  readonly email: string;
  readonly code: string;
  readonly networkFingerprint: string;
}

export type VerifyOtpResult =
  | {
      readonly ok: true;
      /** The opaque `ops_cs_` credential to set as the session cookie. */
      readonly credential: string;
      readonly identityId: string;
      readonly created: boolean;
    }
  | { readonly ok: false; readonly reason: "invalid_code"; readonly attemptsRemaining: number }
  | { readonly ok: false; readonly reason: "challenge_exhausted" }
  | { readonly ok: false; readonly reason: "challenge_closed" };

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code)) return code;
  if (typeof status === "number") return `status_${status}`;
  return null;
}

export async function startOtp(
  deps: CustomerIdentityDeps,
  input: StartOtpInput
): Promise<StartOtpResult> {
  const email = normalizeEmail(input.email);
  if (email === null) throw new CustomerIdentityInputError("email");

  const challenge = await beginOtpChallenge(deps.rpc, {
    emailDigest: emailDigest(email, deps.keyRing),
    networkFingerprint: input.networkFingerprint,
  });

  if (!challenge.allowed) {
    await appendIdentityEvent(deps.rpc, {
      eventType: "otp_refused",
      identityId: null,
      companyId: null,
      sessionId: null,
      networkFingerprint: input.networkFingerprint,
      metadata: { stage: "start", retry_after_seconds: challenge.retry_after_seconds },
    });
    // A refused send still answers with a challenge id so the response is
    // indistinguishable from an accepted one. A decoy never resolves: the
    // verify path treats an unknown challenge exactly like a closed one.
    return Object.freeze({
      challengeId: challenge.challenge_id ?? randomUUID(),
      retryAfterSeconds: challenge.retry_after_seconds,
    });
  }

  // `allowed` guarantees a challenge id (validated in rpc.ts).
  const challengeId = challenge.challenge_id as string;

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
    // Logged by code only: never the address, never the provider message
    // verbatim (it can echo the address back).
    console.error("[customer-identity] otp send failed", {
      code: errorCode(sendError),
    });
    await appendIdentityEvent(deps.rpc, {
      eventType: "otp_send_failed",
      identityId: null,
      companyId: null,
      sessionId: null,
      networkFingerprint: input.networkFingerprint,
      metadata: { provider_error: errorCode(sendError) },
    });
  } else {
    await appendIdentityEvent(deps.rpc, {
      eventType: "otp_started",
      identityId: null,
      companyId: null,
      sessionId: null,
      networkFingerprint: input.networkFingerprint,
      metadata: { stage: "start" },
    });
  }

  return Object.freeze({
    challengeId,
    retryAfterSeconds: challenge.retry_after_seconds,
  });
}

export async function verifyOtp(
  deps: CustomerIdentityDeps,
  input: VerifyOtpInput
): Promise<VerifyOtpResult> {
  if (typeof input.challengeId !== "string" || !UUID_PATTERN.test(input.challengeId)) {
    throw new CustomerIdentityInputError("challengeId");
  }
  const email = normalizeEmail(input.email);
  if (email === null) throw new CustomerIdentityInputError("email");
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!CODE_PATTERN.test(code)) throw new CustomerIdentityInputError("code");

  // Charge the attempt first. Counting before proxying means concurrent
  // guesses cannot all slip through one stale check, and a transport failure
  // on the proxy still costs the attempt.
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
        stage: "verify",
        attempts: attempt.attempts,
        exhausted,
      },
    });
    return Object.freeze(
      exhausted
        ? { ok: false, reason: "challenge_exhausted" }
        : { ok: false, reason: "challenge_closed" }
    );
  }

  let authSubject: string | null = null;
  let verifyError: unknown = null;
  try {
    const { data, error } = await deps.auth.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    verifyError = error;
    // The Supabase session in `data.session` is deliberately never read.
    if (error == null && data.user !== null && UUID_PATTERN.test(data.user.id)) {
      authSubject = data.user.id;
    }
  } catch (cause) {
    verifyError = cause;
  }

  if (authSubject === null) {
    const attemptsRemaining = Math.max(0, OTP_MAX_ATTEMPTS - attempt.attempts);
    await appendIdentityEvent(deps.rpc, {
      eventType: "otp_failed",
      identityId: null,
      companyId: null,
      sessionId: null,
      networkFingerprint: input.networkFingerprint,
      metadata: {
        attempts: attempt.attempts,
        provider_error: verifyError == null ? null : errorCode(verifyError),
      },
    });
    return Object.freeze({ ok: false, reason: "invalid_code", attemptsRemaining });
  }

  await recordOtpAttempt(deps.rpc, { challengeId: input.challengeId, success: true });
  await appendIdentityEvent(deps.rpc, {
    eventType: "otp_verified",
    identityId: null,
    companyId: null,
    sessionId: null,
    networkFingerprint: input.networkFingerprint,
    metadata: { attempts: attempt.attempts },
  });

  let identity: { identity_id: string; created: boolean };
  try {
    identity = await upsertIdentity(deps.rpc, { authSubject, email });
  } catch (error) {
    if (error instanceof CustomerContactConflictError) {
      await appendIdentityEvent(deps.rpc, {
        eventType: "contact_conflict",
        identityId: null,
        companyId: null,
        sessionId: null,
        networkFingerprint: input.networkFingerprint,
        metadata: { stage: "verify" },
      });
    }
    throw error;
  }

  if (identity.created) {
    let markError: unknown = null;
    try {
      ({ error: markError } = await deps.auth.auth.admin.updateUserById(authSubject, {
        app_metadata: { principal: "customer" },
      }));
    } catch (cause) {
      markError = cause;
    }
    if (markError != null) {
      throw new CustomerIdentityStoreError("set_customer_principal", { cause: markError });
    }
    await appendIdentityEvent(deps.rpc, {
      eventType: "identity_created",
      identityId: identity.identity_id,
      companyId: null,
      sessionId: null,
      networkFingerprint: input.networkFingerprint,
      metadata: { channel: "otp" },
    });
  }

  const credential = mintSessionCredential();
  const sessionHash = sessionDigest(credential);
  if (sessionHash === null) {
    throw new CustomerIdentityStoreError("mint_customer_session");
  }
  const sessionId = await mintSession(deps.rpc, {
    identityId: identity.identity_id,
    sessionHash,
    networkFingerprint: input.networkFingerprint,
  });
  await appendIdentityEvent(deps.rpc, {
    eventType: "session_issued",
    identityId: identity.identity_id,
    companyId: null,
    sessionId,
    networkFingerprint: input.networkFingerprint,
    metadata: { channel: "otp", identity_created: identity.created },
  });

  return Object.freeze({
    ok: true,
    credential,
    identityId: identity.identity_id,
    created: identity.created,
  });
}
