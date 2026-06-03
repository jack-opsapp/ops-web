/**
 * OPS Web — Accounting OAuth token cipher
 *
 * AES-256-GCM encryption for accounting OAuth secrets at rest (Intuit security
 * requirement: "Encrypt the refresh token with a symmetric algorithm (AES
 * preferred). Store your AES key in your app, in a separate configuration
 * file."). We encrypt the QuickBooks/Sage access_token, refresh_token, and
 * realm_id before they are written to `accounting_connections`, and decrypt
 * them on read — server-side only.
 *
 * KEY: read from the `QB_TOKEN_ENC_KEY` env var (the "separate config file" —
 * a Vercel project secret, never committed and never in the database). It must
 * be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`).
 *
 * FAIL-CLOSED: encryptToken throws if the key is missing or malformed, so a
 * misconfigured deploy can NEVER silently persist a plaintext token. decrypt
 * is tolerant of legacy plaintext (values without the version prefix are
 * returned as-is) so a read can't break, but anything we write is always
 * encrypted.
 *
 * This module must only be imported by server code (API routes / services).
 * Never expose the key or this module to the client bundle.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "enc:v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32; // AES-256

/** Resolve + validate the 32-byte AES key from env. Throws if absent/malformed. */
function getKey(): Buffer {
  const raw = process.env.QB_TOKEN_ENC_KEY;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "QB_TOKEN_ENC_KEY is not set — refusing to handle accounting tokens without an encryption key"
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new Error("QB_TOKEN_ENC_KEY is not valid base64");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `QB_TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}); generate with \`openssl rand -base64 32\``
    );
  }
  return key;
}

/** True if a stored value is in our encrypted envelope format. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

/**
 * Encrypt a secret for storage. Returns `enc:v1:<iv>:<tag>:<ciphertext>`
 * (each segment base64). Throws if the key is missing/malformed (fail-closed).
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a stored secret. Values that are not in the `enc:v1:` envelope are
 * treated as legacy plaintext and returned unchanged (tolerant read). Throws
 * if an encrypted value is malformed or fails the GCM auth check, or if the
 * key is missing while an encrypted value is present.
 */
export function decryptToken(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (!isEncrypted(stored)) return stored; // legacy plaintext passthrough

  const parts = stored.split(":");
  // [ "enc", "v1", iv, tag, ciphertext ]
  if (parts.length !== 5) {
    throw new Error("encrypted token envelope is malformed");
  }
  const key = getKey();
  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const ciphertext = Buffer.from(parts[4], "base64");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Encrypt a nullable secret (null/empty passes through as null). */
export function encryptNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return encryptToken(value);
}
