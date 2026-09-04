import "server-only";

import { createDecipheriv, createCipheriv, createHmac, randomBytes } from "node:crypto";

import type { CustomerIdentityHmacKeyRing } from "./config";
import { normalizeEmail } from "./credentials";

/**
 * Broker-owned ciphertext for a guest's email address
 * (`private.guest_booking_intents.contact_email_encrypted`).
 *
 * The migration is explicit that the column is opaque to SQL — nothing there
 * reads or interprets it — so confidentiality of a homeowner's address on that
 * row lives entirely here. The intent stores the keyed digest for matching and
 * this ciphertext for sending the confirmation and management mail later; the
 * plaintext reaches the confirm RPC as an argument and is never stored.
 *
 * The sealing key is derived from the customer-identity ring rather than a new
 * secret: HMAC-SHA256(ring key, "ops.booking.email.v1") gives a 256-bit
 * AES-GCM key that rotates with the ring and is domain-separated from every
 * other use of the same material. The key id travels in the envelope, so a
 * rotation that keeps the old key can still open old rows.
 *
 * Envelope: `v1.<kid>.<iv base64url>.<ciphertext‖tag base64url>`.
 */

const VERSION = "v1" as const;
const KEY_INFO = "ops.booking.email.v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** `guest_booking_intents_email_ciphertext_bounded`: 1–4096 characters. */
export const CONTACT_EMAIL_CIPHERTEXT_MAX_LENGTH = 4096 as const;

const ENVELOPE_PATTERN =
  /^v1\.([1-9][0-9]{0,4})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/;

function sealingKey(material: Buffer): Buffer {
  return createHmac("sha256", material).update(KEY_INFO, "utf8").digest();
}

export function encryptContactEmail(
  email: string,
  keyRing: CustomerIdentityHmacKeyRing
): string {
  const normalized = normalizeEmail(email);
  if (normalized === null) {
    throw new TypeError("encryptContactEmail requires a normalizable email");
  }
  const material = keyRing.keys.get(keyRing.activeKid);
  if (!material) {
    throw new TypeError("customer identity HMAC active key is unavailable");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(material), iv);
  const sealed = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return [
    VERSION,
    String(keyRing.activeKid),
    iv.toString("base64url"),
    sealed.toString("base64url"),
  ].join(".");
}

/**
 * Null for anything this ring cannot open: a foreign key, a rotated-out key,
 * a tampered envelope, or a shape this broker never wrote. Every caller must
 * treat null as "no address on file" rather than guessing.
 */
export function decryptContactEmail(
  envelope: unknown,
  keyRing: CustomerIdentityHmacKeyRing
): string | null {
  if (typeof envelope !== "string") return null;
  if (envelope.length > CONTACT_EMAIL_CIPHERTEXT_MAX_LENGTH) return null;
  const match = ENVELOPE_PATTERN.exec(envelope);
  if (match === null) return null;

  const kid = Number(match[1]);
  const material = keyRing.keys.get(kid);
  if (!material) return null;

  const iv = Buffer.from(match[2], "base64url");
  const sealed = Buffer.from(match[3], "base64url");
  if (iv.byteLength !== IV_BYTES || sealed.byteLength <= TAG_BYTES) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", sealingKey(material), iv);
    decipher.setAuthTag(sealed.subarray(sealed.byteLength - TAG_BYTES));
    const opened = Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.byteLength - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    return normalizeEmail(opened);
  } catch {
    return null;
  }
}
