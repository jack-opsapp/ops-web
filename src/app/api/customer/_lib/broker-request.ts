import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  CustomerAccessError,
  CustomerContactConflictError,
  CustomerIdentityError,
  CustomerIdentityInputError,
  CustomerIdentityStoreError,
  CustomerIdentityUnavailableError,
  networkFingerprint,
  normalizeEmail,
  type CustomerIdentityHmacKeyRing,
} from "@/lib/customer-identity";
import { parsePublicHandle } from "@/lib/customer-identity/handle";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { rateLimit } from "@/lib/utils/ratelimit";

/**
 * Request plumbing shared by the customer broker routes under
 * `/api/customer` (design: specs/2026-09-01-public-api-customer-identity-design.md).
 *
 * Every route follows the same order — per-IP limit, broker configuration,
 * body, company by public handle, then the broker call — so a refusal is
 * always the cheapest possible refusal and never reaches the customer auth
 * project. Every response body here is privacy-safe by construction (I5):
 * a fixed error code, never a message, never an identifier.
 */

// ─── Public handle ──────────────────────────────────────────────────────────

/**
 * The handle grammar lives once, in a page-safe module the hosted pages share
 * (`src/lib/customer-identity/handle.ts`): exact or nothing, uuid refused (I4).
 */
export { parsePublicHandle } from "@/lib/customer-identity/handle";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function customerHomePath(handle: string): string {
  return `/c/${handle}/home`;
}

// ─── Client address ─────────────────────────────────────────────────────────

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

/** The library's fingerprint over the request's first hop and user agent. */
export function requestFingerprint(request: NextRequest): string {
  return networkFingerprint(clientIp(request), request.headers.get("user-agent"));
}

// ─── Per-IP limits (on top of the broker's own I8 limits) ───────────────────

export interface IpLimitPolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowSec: number;
}

/**
 * Sends are the scarce resource: the start window is the tightest. The
 * broker's identifier-level limits (1/60s, 5/hour per email) still apply
 * underneath; these bound what one address can do across many emails.
 */
export const IP_LIMITS = Object.freeze({
  authStart: Object.freeze({ name: "auth-start", limit: 20, windowSec: 600 }),
  authVerify: Object.freeze({ name: "auth-verify", limit: 40, windowSec: 600 }),
  authSignout: Object.freeze({ name: "auth-signout", limit: 30, windowSec: 60 }),
  me: Object.freeze({ name: "me", limit: 120, windowSec: 60 }),
}) satisfies Readonly<Record<string, IpLimitPolicy>>;

export async function enforceIpLimit(
  request: NextRequest,
  policy: IpLimitPolicy
): Promise<NextResponse | null> {
  const result = await rateLimit({
    key: `customer-api:${policy.name}:${clientIp(request)}`,
    limit: policy.limit,
    windowSec: policy.windowSec,
  });
  if (!result.exceeded) return null;
  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterSec));
  return brokerJson(
    { error: "rate_limited", retryAfterSeconds },
    429,
    { "Retry-After": String(retryAfterSeconds) }
  );
}

// ─── Opaque challenge refs (I4) bound to the email (I5, I8) ─────────────────

const CHALLENGE_REF_PREFIX = "ch_";
const CHALLENGE_REF_PATTERN = /^ch_[A-Za-z0-9_-]{46}$/;
const REF_UUID_BYTES = 16;
const REF_KID_BYTES = 2;
const REF_TAG_BYTES = 16;
const REF_BYTES = REF_UUID_BYTES + REF_KID_BYTES + REF_TAG_BYTES;

export type ChallengeRefDecoding =
  | { readonly ok: true; readonly challengeId: string }
  /** Well-formed, but not minted for this email (or by a key this ring holds). */
  | { readonly ok: false; readonly reason: "mismatch"; readonly challengeId: string }
  | { readonly ok: false; readonly reason: "malformed" };

function challengeTag(key: Buffer, uuidBytes: Buffer, email: string): Buffer {
  return createHmac("sha256", key)
    .update(uuidBytes)
    .update(email, "utf8")
    .digest()
    .subarray(0, REF_TAG_BYTES);
}

function uuidFromBytes(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A challenge id is a row id and must not cross the boundary as one. The ref
 * carries the id, the key id, and a keyed tag over (id, normalized email):
 * `ch_` + base64url(uuid[16] ‖ kid[2] ‖ HMAC-SHA256(key, uuid ‖ email)[16]).
 *
 * The tag is what lets the verify route prove the supplied email is the one
 * the challenge was begun for before it proxies a code (ruled 2026-09-02):
 * the challenge row holds only a digest, so the proof lives in the ref and
 * costs no database read. Only the canonical rendering decodes, so exactly
 * one string names a challenge for a given email.
 */
export function encodeChallengeRef(
  challengeId: string,
  email: string,
  keyRing: CustomerIdentityHmacKeyRing
): string {
  if (!CANONICAL_UUID_PATTERN.test(challengeId)) {
    throw new TypeError("encodeChallengeRef requires a canonical uuid");
  }
  const normalized = normalizeEmail(email);
  if (normalized === null) {
    throw new TypeError("encodeChallengeRef requires a normalizable email");
  }
  const key = keyRing.keys.get(keyRing.activeKid);
  if (!key) {
    throw new TypeError("customer identity HMAC active key is unavailable");
  }
  const uuidBytes = Buffer.from(challengeId.replace(/-/g, ""), "hex");
  const kidBytes = Buffer.alloc(REF_KID_BYTES);
  kidBytes.writeUInt16BE(keyRing.activeKid);
  const tag = challengeTag(key, uuidBytes, normalized);
  return `${CHALLENGE_REF_PREFIX}${Buffer.concat([uuidBytes, kidBytes, tag]).toString("base64url")}`;
}

export function decodeChallengeRef(
  ref: unknown,
  email: string,
  keyRing: CustomerIdentityHmacKeyRing
): ChallengeRefDecoding {
  const malformed = { ok: false, reason: "malformed" } as const;
  if (typeof ref !== "string" || !CHALLENGE_REF_PATTERN.test(ref)) return malformed;
  const encoded = ref.slice(CHALLENGE_REF_PREFIX.length);
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.byteLength !== REF_BYTES || bytes.toString("base64url") !== encoded) {
    return malformed;
  }
  const normalized = normalizeEmail(email);
  if (normalized === null) return malformed;

  const uuidBytes = bytes.subarray(0, REF_UUID_BYTES);
  const kid = bytes.readUInt16BE(REF_UUID_BYTES);
  const tag = bytes.subarray(REF_UUID_BYTES + REF_KID_BYTES);
  const challengeId = uuidFromBytes(uuidBytes);

  const key = keyRing.keys.get(kid);
  if (!key) return { ok: false, reason: "mismatch", challengeId };
  const expected = challengeTag(key, uuidBytes, normalized);
  if (!timingSafeEqual(expected, tag)) {
    return { ok: false, reason: "mismatch", challengeId };
  }
  return { ok: true, challengeId };
}

// ─── Company by public handle ───────────────────────────────────────────────

const COMPANY_COLUMNS = "id, deleted_at";

/**
 * Null for a malformed handle, an unknown handle, or a soft-deleted company —
 * the caller answers the same 404 for all three. A database failure is a
 * store error, never "not found".
 */
export async function resolveCompanyIdByHandle(
  handle: string
): Promise<string | null> {
  if (parsePublicHandle(handle) === null) return null;

  let data: { id?: unknown; deleted_at?: unknown } | null;
  let error: unknown;
  try {
    ({ data, error } = await getServiceRoleClient()
      .from("companies")
      .select(COMPANY_COLUMNS)
      .eq("public_handle", handle)
      .maybeSingle());
  } catch (cause) {
    throw new CustomerIdentityStoreError("resolve_company_handle", { cause });
  }
  if (error != null) {
    throw new CustomerIdentityStoreError("resolve_company_handle", { cause: error });
  }
  if (!data || typeof data.id !== "string" || data.deleted_at != null) return null;
  return data.id;
}

// ─── Body ───────────────────────────────────────────────────────────────────

export async function readJsonObject(
  request: NextRequest
): Promise<Record<string, unknown> | null> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

// ─── Responses ──────────────────────────────────────────────────────────────

const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

export function brokerJson(
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {}
): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

export function notFoundResponse(): NextResponse {
  return brokerJson({ error: "not_found" }, 404);
}

export function invalidRequestResponse(): NextResponse {
  return brokerJson({ error: "invalid_request" }, 400);
}

export function unauthenticatedResponse(): NextResponse {
  return brokerJson({ error: "unauthenticated" }, 401);
}

function unavailableResponse(): NextResponse {
  return brokerJson({ error: "customer_identity_unavailable" }, 503);
}

function failureResponse(): NextResponse {
  return brokerJson({ error: "customer_identity_failed" }, 500);
}

function accessDeniedResponse(): NextResponse {
  return brokerJson({ error: "access_denied" }, 403);
}

/**
 * Map a broker failure to its response. Logged by route and code only: an
 * unknown error's message may echo an address, so it is never quoted.
 */
export function brokerErrorResponse(error: unknown, route: string): NextResponse {
  if (error instanceof CustomerIdentityUnavailableError) {
    console.error("[customer-api] broker unavailable", {
      route,
      code: error.code,
      reason: error.reason,
    });
    return unavailableResponse();
  }
  if (error instanceof CustomerIdentityInputError) {
    return invalidRequestResponse();
  }
  if (error instanceof CustomerAccessError) {
    return accessDeniedResponse();
  }
  if (error instanceof CustomerContactConflictError) {
    console.error("[customer-api] broker failure", { route, code: error.code });
    return failureResponse();
  }
  if (error instanceof CustomerIdentityStoreError) {
    console.error("[customer-api] broker failure", {
      route,
      code: error.code,
      operation: error.operation,
    });
    return failureResponse();
  }
  if (error instanceof CustomerIdentityError) {
    console.error("[customer-api] broker failure", { route, code: error.code });
    return failureResponse();
  }
  console.error("[customer-api] unexpected failure", {
    route,
    name: error instanceof Error ? error.name : typeof error,
  });
  return failureResponse();
}
