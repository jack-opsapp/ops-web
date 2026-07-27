import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const MARKER_PREFIX = "emc_";
const ENVELOPE_VERSION = 1;
const NONCE_BYTES = 12;
const UUID_BYTES = 16;
const EXPIRY_BYTES = 8;
const TAG_BYTES = 16;
const HEADER_BYTES = 3;
const PLAINTEXT_BYTES = UUID_BYTES * 2 + EXPIRY_BYTES;
const ENVELOPE_BYTES = HEADER_BYTES + NONCE_BYTES + PLAINTEXT_BYTES + TAG_BYTES;
const PURPOSE = Buffer.from("ops.external-intake.email-correlation.v1", "utf8");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EmailCorrelationKeyRing {
  activeKid: number;
  keys: ReadonlyMap<number, Buffer>;
}

export interface EmailCorrelationBinding {
  companyId: string;
  mailboxId: string;
  sourceId: string;
}

export interface EmailCorrelationPayload extends EmailCorrelationBinding {
  submissionId: string;
  leadId: string;
  expiresAt: Date;
}

export class InvalidEmailCorrelationMarkerError extends Error {
  constructor() {
    super("email correlation marker is invalid");
    this.name = "InvalidEmailCorrelationMarkerError";
  }
}

function uuidBytes(value: string): Buffer {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidEmailCorrelationMarkerError();
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function bytesUuid(value: Buffer): string {
  if (value.byteLength !== UUID_BYTES) {
    throw new InvalidEmailCorrelationMarkerError();
  }
  const hex = value.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function assertKeyRing(keyRing: EmailCorrelationKeyRing): void {
  if (
    !Number.isInteger(keyRing.activeKid) ||
    keyRing.activeKid < 1 ||
    keyRing.activeKid > 65_535 ||
    !keyRing.keys.has(keyRing.activeKid) ||
    keyRing.keys.size < 1 ||
    keyRing.keys.size > 3
  ) {
    throw new Error("email correlation key ring is invalid");
  }
  const materials = new Set<string>();
  for (const [kid, key] of keyRing.keys) {
    const encoded = key.toString("base64url");
    if (
      !Number.isInteger(kid) ||
      kid < 1 ||
      kid > 65_535 ||
      key.byteLength !== 32 ||
      materials.has(encoded)
    ) {
      throw new Error("email correlation key ring is invalid");
    }
    materials.add(encoded);
  }
}

function parseEmailCorrelationKeyRing(
  serialized: string | undefined
): EmailCorrelationKeyRing {
  if (!serialized) {
    throw new Error("EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS is required");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS is malformed");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS is malformed");
  }
  const object = parsed as Record<string, unknown>;
  if (
    Object.keys(object).length !== 2 ||
    typeof object.activeKid !== "string" ||
    !/^[1-9][0-9]{0,4}$/.test(object.activeKid) ||
    typeof object.keys !== "object" ||
    object.keys === null ||
    Array.isArray(object.keys)
  ) {
    throw new Error("EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS is malformed");
  }
  const keys = new Map<number, Buffer>();
  for (const [rawKid, rawKey] of Object.entries(
    object.keys as Record<string, unknown>
  )) {
    if (
      !/^[1-9][0-9]{0,4}$/.test(rawKid) ||
      typeof rawKey !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(rawKey)
    ) {
      throw new Error("EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS is malformed");
    }
    const key = Buffer.from(rawKey, "base64url");
    if (key.toString("base64url") !== rawKey) {
      throw new Error("EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS is malformed");
    }
    keys.set(Number(rawKid), key);
  }
  const keyRing = {
    activeKid: Number(object.activeKid),
    keys,
  };
  assertKeyRing(keyRing);
  return keyRing;
}

export function readEmailCorrelationKeyRing(): EmailCorrelationKeyRing {
  return parseEmailCorrelationKeyRing(
    process.env.EXTERNAL_INTAKE_EMAIL_CORRELATION_KEYS
  );
}

function header(kid: number): Buffer {
  const value = Buffer.alloc(HEADER_BYTES);
  value.writeUInt8(ENVELOPE_VERSION, 0);
  value.writeUInt16BE(kid, 1);
  return value;
}

function associatedData(
  binding: EmailCorrelationBinding,
  envelopeHeader: Buffer
): Buffer {
  return Buffer.concat([
    PURPOSE,
    Buffer.from([0]),
    envelopeHeader,
    uuidBytes(binding.companyId),
    uuidBytes(binding.mailboxId),
    uuidBytes(binding.sourceId),
  ]);
}

function plaintext(payload: EmailCorrelationPayload): Buffer {
  const expiryMs = payload.expiresAt.getTime();
  if (
    !Number.isSafeInteger(expiryMs) ||
    expiryMs <= 0 ||
    expiryMs % 1000 !== 0
  ) {
    throw new Error("email correlation expiry must use whole seconds");
  }
  const expiry = Buffer.alloc(EXPIRY_BYTES);
  expiry.writeBigUInt64BE(BigInt(expiryMs / 1000));
  return Buffer.concat([
    uuidBytes(payload.submissionId),
    uuidBytes(payload.leadId),
    expiry,
  ]);
}

export function sealEmailCorrelationMarker(
  payload: EmailCorrelationPayload,
  keyRing: EmailCorrelationKeyRing,
  nonceSource: (size: number) => Buffer = randomBytes
): string {
  assertKeyRing(keyRing);
  const key = keyRing.keys.get(keyRing.activeKid);
  if (!key) throw new Error("email correlation active key is unavailable");
  const nonce = nonceSource(NONCE_BYTES);
  if (nonce.byteLength !== NONCE_BYTES) {
    throw new Error("email correlation nonce source is invalid");
  }
  const envelopeHeader = header(keyRing.activeKid);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData(payload, envelopeHeader));
  const encrypted = Buffer.concat([
    cipher.update(plaintext(payload)),
    cipher.final(),
  ]);
  const envelope = Buffer.concat([
    envelopeHeader,
    nonce,
    encrypted,
    cipher.getAuthTag(),
  ]);
  if (envelope.byteLength !== ENVELOPE_BYTES) {
    throw new Error("email correlation envelope is invalid");
  }
  return `${MARKER_PREFIX}${envelope.toString("base64url")}`;
}

export function openEmailCorrelationMarker(
  marker: string,
  binding: EmailCorrelationBinding,
  keyRing: EmailCorrelationKeyRing,
  now: Date = new Date()
): {
  submissionId: string;
  leadId: string;
  expiresAt: string;
  keyVersion: number;
} {
  try {
    assertKeyRing(keyRing);
    if (
      !marker.startsWith(MARKER_PREFIX) ||
      !/^emc_[A-Za-z0-9_-]{22,128}$/.test(marker)
    ) {
      throw new InvalidEmailCorrelationMarkerError();
    }
    const encoded = marker.slice(MARKER_PREFIX.length);
    const envelope = Buffer.from(encoded, "base64url");
    if (
      envelope.byteLength !== ENVELOPE_BYTES ||
      envelope.toString("base64url") !== encoded
    ) {
      throw new InvalidEmailCorrelationMarkerError();
    }
    const envelopeHeader = envelope.subarray(0, HEADER_BYTES);
    if (envelopeHeader.readUInt8(0) !== ENVELOPE_VERSION) {
      throw new InvalidEmailCorrelationMarkerError();
    }
    const kid = envelopeHeader.readUInt16BE(1);
    const key = keyRing.keys.get(kid);
    if (!key) throw new InvalidEmailCorrelationMarkerError();
    const nonceStart = HEADER_BYTES;
    const encryptedStart = nonceStart + NONCE_BYTES;
    const tagStart = envelope.byteLength - TAG_BYTES;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      envelope.subarray(nonceStart, encryptedStart)
    );
    decipher.setAAD(associatedData(binding, envelopeHeader));
    decipher.setAuthTag(envelope.subarray(tagStart));
    const decrypted = Buffer.concat([
      decipher.update(envelope.subarray(encryptedStart, tagStart)),
      decipher.final(),
    ]);
    if (decrypted.byteLength !== PLAINTEXT_BYTES) {
      throw new InvalidEmailCorrelationMarkerError();
    }
    const expiresAtSeconds = decrypted.readBigUInt64BE(UUID_BYTES * 2);
    const expiresAtMs = Number(expiresAtSeconds) * 1000;
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now.getTime()) {
      throw new InvalidEmailCorrelationMarkerError();
    }
    return Object.freeze({
      submissionId: bytesUuid(decrypted.subarray(0, UUID_BYTES)),
      leadId: bytesUuid(decrypted.subarray(UUID_BYTES, UUID_BYTES * 2)),
      expiresAt: new Date(expiresAtMs).toISOString(),
      keyVersion: kid,
    });
  } catch {
    throw new InvalidEmailCorrelationMarkerError();
  }
}
