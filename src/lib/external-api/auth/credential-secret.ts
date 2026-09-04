import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const MINIMUM_HMAC_KEY_BYTES = 32;
const MAXIMUM_HMAC_KEY_BYTES = 64;
const MAXIMUM_VALIDATION_KEYS = 3;
const MAXIMUM_KEY_VERSION = 32_767;

export type ExternalApiHmacKeyRing = Readonly<{
  activeKid: number;
  keys: ReadonlyMap<number, Buffer>;
}>;

export type CreatedCredentialSecret = Readonly<{
  secret: string;
  visiblePrefix: string;
  digestVersion: number;
  lookupDigest: Buffer;
}>;

function configurationError(name: string, reason: string): Error {
  return new Error(`${name} ${reason}`);
}

function parseKeyVersion(input: unknown, name: string, field: string): number {
  if (typeof input !== "string" || !/^[1-9][0-9]{0,4}$/.test(input)) {
    throw configurationError(name, `${field} is malformed`);
  }
  const version = Number(input);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > MAXIMUM_KEY_VERSION
  ) {
    throw configurationError(name, `${field} is out of range`);
  }
  return version;
}

function decodeKey(input: unknown, name: string, kid: string): Buffer {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]+$/.test(input)) {
    throw configurationError(name, `key ${kid} is malformed`);
  }
  const decoded = Buffer.from(input, "base64url");
  if (decoded.toString("base64url") !== input) {
    throw configurationError(name, `key ${kid} is malformed`);
  }
  if (decoded.byteLength < MINIMUM_HMAC_KEY_BYTES) {
    throw configurationError(name, `key ${kid} must contain at least 32 bytes`);
  }
  if (decoded.byteLength > MAXIMUM_HMAC_KEY_BYTES) {
    throw configurationError(name, `key ${kid} must contain at most 64 bytes`);
  }
  return decoded;
}

export function parseExternalApiHmacKeyRing(
  serialized: string | undefined,
  name: string
): ExternalApiHmacKeyRing {
  if (!serialized) {
    throw configurationError(name, "is required");
  }

  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch {
    throw configurationError(name, "is malformed");
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw configurationError(name, "is malformed");
  }
  const object = input as Record<string, unknown>;
  if (
    Object.keys(object).length !== 2 ||
    !Object.hasOwn(object, "activeKid") ||
    !Object.hasOwn(object, "keys") ||
    typeof object.keys !== "object" ||
    object.keys === null ||
    Array.isArray(object.keys)
  ) {
    throw configurationError(name, "is malformed");
  }

  const activeKid = parseKeyVersion(object.activeKid, name, "activeKid");
  const entries = Object.entries(object.keys as Record<string, unknown>);
  if (entries.length < 1) {
    throw configurationError(name, "must contain at least 1 key");
  }
  if (entries.length > MAXIMUM_VALIDATION_KEYS) {
    throw configurationError(name, "must contain at most 3 keys");
  }

  const keys = new Map<number, Buffer>();
  const encodedMaterials = new Set<string>();
  for (const [kid, value] of entries) {
    const version = parseKeyVersion(kid, name, `key id ${kid}`);
    if (keys.has(version)) {
      throw configurationError(name, "contains duplicate key versions");
    }
    const material = decodeKey(value, name, kid);
    const encodedMaterial = material.toString("base64url");
    if (encodedMaterials.has(encodedMaterial)) {
      throw configurationError(name, "contains duplicate key material");
    }
    encodedMaterials.add(encodedMaterial);
    keys.set(version, material);
  }
  if (!keys.has(activeKid)) {
    throw configurationError(name, "active key is unavailable");
  }

  return Object.freeze({
    activeKid,
    keys: keys as ReadonlyMap<number, Buffer>,
  });
}

export function readExternalApiCredentialHmacKeyRing(): ExternalApiHmacKeyRing {
  return parseExternalApiHmacKeyRing(
    process.env.EXTERNAL_API_CREDENTIAL_HMAC_KEYS,
    "EXTERNAL_API_CREDENTIAL_HMAC_KEYS"
  );
}

export function deriveCredentialLookupDigest(
  secret: string,
  digestVersion: number,
  keyRing: ExternalApiHmacKeyRing
): Buffer {
  const key = keyRing.keys.get(digestVersion);
  if (!key) {
    throw new Error("credential HMAC key version is unavailable");
  }
  return createHmac("sha256", key).update(secret, "utf8").digest();
}

export function verifyCredentialLookupDigest(
  secret: string,
  digestVersion: number,
  expectedDigest: Uint8Array,
  keyRing: ExternalApiHmacKeyRing
): boolean {
  if (expectedDigest.byteLength !== 32) return false;
  let actual: Buffer;
  try {
    actual = deriveCredentialLookupDigest(secret, digestVersion, keyRing);
  } catch {
    return false;
  }
  return timingSafeEqual(actual, Buffer.from(expectedDigest));
}

export function createCredentialSecret(
  keyRing: ExternalApiHmacKeyRing
): CreatedCredentialSecret {
  const digestVersion = keyRing.activeKid;
  const randomPrefix = randomBytes(9).toString("base64url");
  const secretMaterial = randomBytes(32).toString("base64url");
  const visiblePrefix = `opsx_${digestVersion}_${randomPrefix}`;
  const secret = `${visiblePrefix}_${secretMaterial}`;
  const lookupDigest = deriveCredentialLookupDigest(
    secret,
    digestVersion,
    keyRing
  );

  return Object.freeze({
    secret,
    visiblePrefix,
    digestVersion,
    lookupDigest,
  });
}
