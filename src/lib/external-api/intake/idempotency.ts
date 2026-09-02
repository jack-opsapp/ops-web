import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const MINIMUM_HMAC_KEY_BYTES = 32;
const MAXIMUM_HMAC_KEY_BYTES = 64;
const MAXIMUM_RETAINED_KEYS = 32;
const MAXIMUM_KEY_VERSION = 32_767;

export interface VersionedHmacKeyRing {
  activeKid: number;
  keys: ReadonlyMap<number, Buffer>;
}

export type PrincipalIdempotencyIdentity = Readonly<{
  kind: "principal";
  companyId: string;
  principalId: string;
  namespace: "upload_batch" | "submission";
  key: string;
}>;

export type ExternalSubmissionIdentity = Readonly<{
  kind: "external_submission";
  companyId: string;
  sourceId: string;
  externalSubmissionId: string;
}>;

export type IntakeReplayIdentity =
  | PrincipalIdempotencyIdentity
  | ExternalSubmissionIdentity;

export interface IdempotencyDigest {
  kid: number;
  digest: string;
  writeEligible: boolean;
}

function configurationError(name: string, reason: string): Error {
  return new Error(`${name} ${reason}`);
}

function parseKid(value: unknown, name: string): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,4}$/.test(value)) {
    throw configurationError(name, "contains a malformed key version");
  }
  const kid = Number(value);
  if (kid > MAXIMUM_KEY_VERSION) {
    throw configurationError(name, "contains an out-of-range key version");
  }
  return kid;
}

function decodeHmacKey(value: unknown, name: string, kid: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw configurationError(name, `key ${kid} is malformed`);
  }
  const key = Buffer.from(value, "base64url");
  if (
    key.toString("base64url") !== value ||
    key.byteLength < MINIMUM_HMAC_KEY_BYTES ||
    key.byteLength > MAXIMUM_HMAC_KEY_BYTES
  ) {
    throw configurationError(name, `key ${kid} must contain 32 to 64 bytes`);
  }
  return key;
}

export function parseRetainedHmacKeyRing(
  serialized: string | undefined,
  name: string
): VersionedHmacKeyRing {
  if (!serialized) {
    throw configurationError(name, "is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw configurationError(name, "is malformed");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw configurationError(name, "is malformed");
  }

  const object = parsed as Record<string, unknown>;
  if (
    Object.keys(object).length !== 2 ||
    typeof object.activeKid !== "string" ||
    typeof object.keys !== "object" ||
    object.keys === null ||
    Array.isArray(object.keys)
  ) {
    throw configurationError(name, "is malformed");
  }

  const activeKid = parseKid(object.activeKid, name);
  const entries = Object.entries(object.keys as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MAXIMUM_RETAINED_KEYS) {
    throw configurationError(name, "must contain 1 to 32 retained keys");
  }

  const keys = new Map<number, Buffer>();
  const materials = new Set<string>();
  for (const [rawKid, value] of entries) {
    const kid = parseKid(rawKid, name);
    const key = decodeHmacKey(value, name, rawKid);
    const encoded = key.toString("base64url");
    if (keys.has(kid) || materials.has(encoded)) {
      throw configurationError(name, "contains a duplicate key");
    }
    keys.set(kid, key);
    materials.add(encoded);
  }
  if (!keys.has(activeKid)) {
    throw configurationError(name, "active key is unavailable");
  }

  return Object.freeze({
    activeKid,
    keys: keys as ReadonlyMap<number, Buffer>,
  });
}

export function readIdempotencyHmacKeyRing(): VersionedHmacKeyRing {
  return parseRetainedHmacKeyRing(
    process.env.EXTERNAL_API_IDEMPOTENCY_HMAC_KEYS,
    "EXTERNAL_API_IDEMPOTENCY_HMAC_KEYS"
  );
}

function assertKeyRing(keyRing: VersionedHmacKeyRing): void {
  if (
    !Number.isInteger(keyRing.activeKid) ||
    keyRing.activeKid < 1 ||
    keyRing.activeKid > MAXIMUM_KEY_VERSION ||
    !keyRing.keys.has(keyRing.activeKid) ||
    keyRing.keys.size < 1 ||
    keyRing.keys.size > MAXIMUM_RETAINED_KEYS
  ) {
    throw new Error("idempotency HMAC key ring is invalid");
  }
  for (const [kid, key] of keyRing.keys) {
    if (
      !Number.isInteger(kid) ||
      kid < 1 ||
      kid > MAXIMUM_KEY_VERSION ||
      key.byteLength < MINIMUM_HMAC_KEY_BYTES ||
      key.byteLength > MAXIMUM_HMAC_KEY_BYTES
    ) {
      throw new Error("idempotency HMAC key ring is invalid");
    }
  }
}

function lengthPrefix(value: string): Buffer {
  const encoded = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(encoded.byteLength);
  return Buffer.concat([length, encoded]);
}

export function deriveDomainSeparatedHmac(
  key: Uint8Array,
  purpose: string,
  values: readonly string[]
): string {
  if (
    key.byteLength < MINIMUM_HMAC_KEY_BYTES ||
    key.byteLength > MAXIMUM_HMAC_KEY_BYTES
  ) {
    throw new Error("HMAC key length is invalid");
  }
  const hmac = createHmac("sha256", key);
  hmac.update(lengthPrefix(purpose));
  for (const value of values) {
    hmac.update(lengthPrefix(value.normalize("NFC")));
  }
  return hmac.digest("hex");
}

function identityDomain(identity: IntakeReplayIdentity): {
  purpose: string;
  values: string[];
} {
  if (identity.kind === "principal") {
    return {
      purpose: "ops.external-api.idempotency.v1",
      values: [
        identity.companyId,
        identity.principalId,
        identity.namespace,
        identity.key,
      ],
    };
  }
  return {
    purpose: "ops.external-api.external-submission.v1",
    values: [
      identity.companyId,
      identity.sourceId,
      identity.externalSubmissionId,
    ],
  };
}

function deriveForKid(
  identity: IntakeReplayIdentity,
  kid: number,
  keyRing: VersionedHmacKeyRing
): IdempotencyDigest {
  const key = keyRing.keys.get(kid);
  if (!key) {
    throw new Error(`idempotency digest key ${kid} is unavailable`);
  }
  const domain = identityDomain(identity);
  return Object.freeze({
    kid,
    digest: deriveDomainSeparatedHmac(key, domain.purpose, domain.values),
    writeEligible: kid === keyRing.activeKid,
  });
}

export function deriveActiveIdempotencyDigest(
  identity: IntakeReplayIdentity,
  keyRing: VersionedHmacKeyRing
): IdempotencyDigest {
  assertKeyRing(keyRing);
  return deriveForKid(identity, keyRing.activeKid, keyRing);
}

export function deriveIdempotencyLookupCandidates(
  identity: IntakeReplayIdentity,
  keyRing: VersionedHmacKeyRing
): IdempotencyDigest[] {
  assertKeyRing(keyRing);
  const kids = [
    keyRing.activeKid,
    ...[...keyRing.keys.keys()]
      .filter((kid) => kid !== keyRing.activeKid)
      .sort((left, right) => right - left),
  ];
  return kids.map((kid) => deriveForKid(identity, kid, keyRing));
}

export function findMatchingIdempotencyDigest(
  stored: Readonly<{ kid: number; digest: string }>,
  candidates: readonly IdempotencyDigest[]
): IdempotencyDigest | null {
  if (!/^[a-f0-9]{64}$/.test(stored.digest)) return null;
  for (const candidate of candidates) {
    if (
      candidate.kid === stored.kid &&
      /^[a-f0-9]{64}$/.test(candidate.digest) &&
      timingSafeEqual(
        Buffer.from(candidate.digest, "hex"),
        Buffer.from(stored.digest, "hex")
      )
    ) {
      return candidate;
    }
  }
  return null;
}

export function assertIdempotencyKeyRetirementSafe(
  retiringKid: number,
  retainedLedgerKids: readonly number[]
): void {
  if (retainedLedgerKids.includes(retiringKid)) {
    throw new Error(
      `idempotency digest key ${retiringKid} is still referenced`
    );
  }
}
