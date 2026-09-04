import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { CustomerIdentityHmacKeyRing } from "./config";

/**
 * Opaque booking descriptors (design §4.4, I4).
 *
 * Three refs, one construction, one key ring — the same ring, the same
 * constant-time compare and the same rotation tolerance the `ch_` challenge
 * refs use (`src/app/api/customer/_lib/broker-request.ts`). Nothing here
 * carries a client, a crew member or a lead, and no uuid ever leaves in
 * readable form.
 *
 *   `sl_` slot descriptor — company ‖ slot start, valid ten minutes.
 *   `in_` intent ref      — a held guest intent, bound to its company.
 *   `bk_` booking ref     — the same intent after confirmation.
 *
 * **A valid slot signature proves only that OPS offered this slot (I12).** It
 * is a proposal, never a reservation: the hold and the confirm re-check
 * policy, bookings and holds in the database under the company lock and may
 * still refuse. Nothing in this module may be read as evidence a time is free.
 *
 * The slot descriptor's ten-minute life is signed rather than stored: the tag
 * covers the minute it was minted in, and verification retries the minutes
 * inside the window. That keeps the byte layout the design fixes — no issued-at
 * field — and costs eleven HMACs on the refusal path. An expired descriptor is
 * indistinguishable from a forged one, which is the answer both deserve.
 */

// ─── Layout ─────────────────────────────────────────────────────────────────

const UUID_BYTES = 16;
const EPOCH_BYTES = 8;
const KID_BYTES = 2;
const TAG_BYTES = 16;

const SLOT_BYTES = UUID_BYTES + EPOCH_BYTES + KID_BYTES + TAG_BYTES;
const REF_BYTES = UUID_BYTES + KID_BYTES + TAG_BYTES;

export const SLOT_DESCRIPTOR_PREFIX = "sl_" as const;
export const INTENT_REF_PREFIX = "in_" as const;
export const BOOKING_REF_PREFIX = "bk_" as const;

export const SLOT_DESCRIPTOR_PATTERN = /^sl_[A-Za-z0-9_-]{56}$/;
export const INTENT_REF_PATTERN = /^in_[A-Za-z0-9_-]{46}$/;
export const BOOKING_REF_PATTERN = /^bk_[A-Za-z0-9_-]{46}$/;

/** Design §4.4. Never longer: the window is measured from the minted minute. */
export const SLOT_DESCRIPTOR_TTL_MINUTES = 10 as const;
/** One minute of forward tolerance so two instances' clocks need not agree exactly. */
const SLOT_DESCRIPTOR_SKEW_MINUTES = 1;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Domain separation: one key, three ref kinds, no cross-reading. A tag minted
// for an intent can never validate as a booking ref and vice versa.
const SLOT_DOMAIN = "ops.slot.v1";
const INTENT_DOMAIN = "ops.intent.v1";
const BOOKING_DOMAIN = "ops.booking.v1";

export type RefDecoding<T> =
  | ({ readonly ok: true } & T)
  /** Well-formed, but not minted for this company (or expired, or by an unknown key). */
  | { readonly ok: false; readonly reason: "mismatch" }
  | { readonly ok: false; readonly reason: "malformed" };

const MALFORMED = Object.freeze({ ok: false, reason: "malformed" } as const);
const MISMATCH = Object.freeze({ ok: false, reason: "mismatch" } as const);

// ─── Bytes ──────────────────────────────────────────────────────────────────

function uuidToBytes(value: string, label: string): Buffer {
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} requires a canonical uuid`);
  }
  return Buffer.from(value.replace(/-/g, ""), "hex");
}

function uuidFromBytes(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function kidToBytes(kid: number): Buffer {
  const bytes = Buffer.alloc(KID_BYTES);
  bytes.writeUInt16BE(kid);
  return bytes;
}

function activeKey(keyRing: CustomerIdentityHmacKeyRing): Buffer {
  const key = keyRing.keys.get(keyRing.activeKid);
  if (!key) throw new TypeError("customer identity HMAC active key is unavailable");
  return key;
}

/**
 * Decode the canonical rendering or nothing. Only one string names a given
 * ref: a re-encoding that differs is refused rather than tolerated.
 */
function decodePayload(
  ref: unknown,
  prefix: string,
  pattern: RegExp,
  byteLength: number
): Buffer | null {
  if (typeof ref !== "string" || !pattern.test(ref)) return null;
  const encoded = ref.slice(prefix.length);
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.byteLength !== byteLength) return null;
  if (bytes.toString("base64url") !== encoded) return null;
  return bytes;
}

function tag(key: Buffer, domain: string, ...parts: readonly Buffer[]): Buffer {
  const mac = createHmac("sha256", key).update(domain, "utf8");
  for (const part of parts) mac.update(part);
  return mac.digest().subarray(0, TAG_BYTES);
}

// ─── Slot descriptors ───────────────────────────────────────────────────────

function epochSecondsToBytes(slotStartAt: Date): Buffer {
  const millis = slotStartAt instanceof Date ? slotStartAt.getTime() : Number.NaN;
  if (!Number.isFinite(millis)) {
    throw new TypeError("encodeSlotDescriptor requires a valid date");
  }
  if (millis % 1000 !== 0) {
    throw new TypeError("encodeSlotDescriptor requires a whole-second slot start");
  }
  const bytes = Buffer.alloc(EPOCH_BYTES);
  bytes.writeBigInt64BE(BigInt(millis / 1000));
  return bytes;
}

function minuteBytes(minute: number): Buffer {
  const bytes = Buffer.alloc(EPOCH_BYTES);
  bytes.writeBigInt64BE(BigInt(minute));
  return bytes;
}

function currentMinute(): number {
  return Math.floor(Date.now() / 60_000);
}

/**
 * Mint a proposal for one slot. The tag binds the company, the slot start and
 * the minute of minting; nothing else is recoverable from the string.
 */
export function encodeSlotDescriptor(
  companyId: string,
  slotStartAt: Date,
  keyRing: CustomerIdentityHmacKeyRing
): string {
  const companyBytes = uuidToBytes(companyId, "encodeSlotDescriptor");
  const epochBytes = epochSecondsToBytes(slotStartAt);
  const kidBytes = kidToBytes(keyRing.activeKid);
  const signature = tag(
    activeKey(keyRing),
    SLOT_DOMAIN,
    companyBytes,
    epochBytes,
    minuteBytes(currentMinute())
  );
  return `${SLOT_DESCRIPTOR_PREFIX}${Buffer.concat([
    companyBytes,
    epochBytes,
    kidBytes,
    signature,
  ]).toString("base64url")}`;
}

/**
 * Verify a descriptor against the company it is being replayed at. Expiry and
 * forgery answer identically (`mismatch`) — the caller refuses both the same
 * way, and neither says anything about whether the slot is still free (I12).
 */
export function decodeSlotDescriptor(
  descriptor: unknown,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): RefDecoding<{ readonly slotStartAt: Date }> {
  const bytes = decodePayload(
    descriptor,
    SLOT_DESCRIPTOR_PREFIX,
    SLOT_DESCRIPTOR_PATTERN,
    SLOT_BYTES
  );
  if (bytes === null) return MALFORMED;
  if (typeof companyId !== "string" || !CANONICAL_UUID_PATTERN.test(companyId)) {
    return MALFORMED;
  }

  const companyBytes = bytes.subarray(0, UUID_BYTES);
  const epochBytes = bytes.subarray(UUID_BYTES, UUID_BYTES + EPOCH_BYTES);
  const kid = bytes.readUInt16BE(UUID_BYTES + EPOCH_BYTES);
  const presented = bytes.subarray(UUID_BYTES + EPOCH_BYTES + KID_BYTES);

  if (uuidFromBytes(companyBytes) !== companyId) return MISMATCH;
  const key = keyRing.keys.get(kid);
  if (!key) return MISMATCH;

  const now = currentMinute();
  const newest = now + SLOT_DESCRIPTOR_SKEW_MINUTES;
  const oldest = now - (SLOT_DESCRIPTOR_TTL_MINUTES - 1);
  for (let minted = newest; minted >= oldest; minted -= 1) {
    const expected = tag(key, SLOT_DOMAIN, companyBytes, epochBytes, minuteBytes(minted));
    if (timingSafeEqual(expected, presented)) {
      const seconds = epochBytes.readBigInt64BE();
      return Object.freeze({
        ok: true,
        slotStartAt: new Date(Number(seconds) * 1000),
      });
    }
  }
  return MISMATCH;
}

// ─── Intent and booking refs ────────────────────────────────────────────────

function encodeCompanyBoundRef(
  prefix: string,
  domain: string,
  intentId: string,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing,
  label: string
): string {
  const intentBytes = uuidToBytes(intentId, label);
  const companyBytes = uuidToBytes(companyId, label);
  const kidBytes = kidToBytes(keyRing.activeKid);
  const signature = tag(activeKey(keyRing), domain, intentBytes, companyBytes);
  return `${prefix}${Buffer.concat([intentBytes, kidBytes, signature]).toString("base64url")}`;
}

function decodeCompanyBoundRef(
  ref: unknown,
  prefix: string,
  pattern: RegExp,
  domain: string,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): RefDecoding<{ readonly intentId: string }> {
  const bytes = decodePayload(ref, prefix, pattern, REF_BYTES);
  if (bytes === null) return MALFORMED;
  if (typeof companyId !== "string" || !CANONICAL_UUID_PATTERN.test(companyId)) {
    return MALFORMED;
  }

  const intentBytes = bytes.subarray(0, UUID_BYTES);
  const kid = bytes.readUInt16BE(UUID_BYTES);
  const presented = bytes.subarray(UUID_BYTES + KID_BYTES);

  const key = keyRing.keys.get(kid);
  if (!key) return MISMATCH;
  const companyBytes = Buffer.from(companyId.replace(/-/g, ""), "hex");
  const expected = tag(key, domain, intentBytes, companyBytes);
  if (!timingSafeEqual(expected, presented)) return MISMATCH;
  return Object.freeze({ ok: true, intentId: uuidFromBytes(intentBytes) });
}

/** Names a held guest intent to the page that holds it, and to nobody else. */
export function encodeIntentRef(
  intentId: string,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): string {
  return encodeCompanyBoundRef(
    INTENT_REF_PREFIX,
    INTENT_DOMAIN,
    intentId,
    companyId,
    keyRing,
    "encodeIntentRef"
  );
}

export function decodeIntentRef(
  ref: unknown,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): RefDecoding<{ readonly intentId: string }> {
  return decodeCompanyBoundRef(
    ref,
    INTENT_REF_PREFIX,
    INTENT_REF_PATTERN,
    INTENT_DOMAIN,
    companyId,
    keyRing
  );
}

/**
 * The confirmed booking, addressed for management (I15). Possession is not
 * authority: every management action still costs a fresh six-digit code.
 */
export function encodeBookingRef(
  intentId: string,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): string {
  return encodeCompanyBoundRef(
    BOOKING_REF_PREFIX,
    BOOKING_DOMAIN,
    intentId,
    companyId,
    keyRing,
    "encodeBookingRef"
  );
}

export function decodeBookingRef(
  ref: unknown,
  companyId: string,
  keyRing: CustomerIdentityHmacKeyRing
): RefDecoding<{ readonly intentId: string }> {
  return decodeCompanyBoundRef(
    ref,
    BOOKING_REF_PREFIX,
    BOOKING_REF_PATTERN,
    BOOKING_DOMAIN,
    companyId,
    keyRing
  );
}
