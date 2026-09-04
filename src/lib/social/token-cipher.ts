import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENVELOPE_PREFIX = "ig-token:v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_CONTEXT = Buffer.from("ops:social:instagram:v1", "utf8");

function encryptionKey(): Buffer {
  const encoded = process.env.INSTAGRAM_TOKEN_ENC_KEY?.trim();
  if (!encoded) {
    throw new Error(
      "INSTAGRAM_TOKEN_ENC_KEY is not set — refusing to store an Instagram token"
    );
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("INSTAGRAM_TOKEN_ENC_KEY is not valid base64");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `INSTAGRAM_TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`
    );
  }
  return key;
}

export function encryptInstagramToken(plaintext: string): string {
  if (!plaintext.trim()) throw new Error("Instagram access token is empty");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(AUTH_CONTEXT);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    ENVELOPE_PREFIX,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptInstagramToken(envelope: string): string {
  const parts = envelope.split(":");
  if (
    parts.length !== 5 ||
    `${parts[0]}:${parts[1]}` !== ENVELOPE_PREFIX ||
    !parts[2] ||
    !parts[3] ||
    !parts[4]
  ) {
    throw new Error("Instagram token envelope is malformed");
  }

  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const ciphertext = Buffer.from(parts[4], "base64");
  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length < 1) {
    throw new Error("Instagram token envelope is malformed");
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAAD(AUTH_CONTEXT);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
