import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  EXTERNAL_API_VERSION,
  externalApiScopeSchema,
} from "../contracts/common";
import { leadFeedFiltersSchema } from "../contracts/lead-feed";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEYS = 3;
const MAX_KID = 32_767;
const MAX_CURSOR_BYTES = 4096;
const MAX_CHECKPOINT_BYTES = 2048;
export const LEAD_FEED_CURSOR_TTL_MS = 60 * 60 * 1000;
export const LEAD_PROJECTION_SCHEMA_VERSION = 1;

export type ExternalApiCursorKeyRing = Readonly<{
  activeKid: number;
  keys: ReadonlyMap<number, Buffer>;
}>;

const decimalSequenceSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/);

const actorBindingShape = {
  apiVersion: z.literal(EXTERNAL_API_VERSION),
  projectionVersion: z.literal(LEAD_PROJECTION_SCHEMA_VERSION),
  principalId: z.string().uuid(),
  companyId: z.string().uuid(),
  authorizationEpoch: z.number().int().positive(),
  scopes: z.array(externalApiScopeSchema).min(1).max(3),
};

const leadPageCursorClaimsSchema = z
  .object({
    purpose: z.literal("lead_page"),
    ...actorBindingShape,
    mode: z.enum(["full", "incremental"]),
    highWater: decimalSequenceSchema,
    checkpointSequence: decimalSequenceSchema.nullable(),
    afterPublicLeadId: z.string().uuid().nullable(),
    afterSequence: decimalSequenceSchema.nullable(),
    filters: leadFeedFiltersSchema.nullable(),
    filtered: z.boolean(),
    sort: z.enum(["public_lead_id", "change_sequence"]),
    dataThrough: z.string().datetime({ offset: true }),
    expiresAt: z.number().int().positive(),
  })
  .strict();

const leadSyncCheckpointClaimsSchema = z
  .object({
    purpose: z.literal("lead_checkpoint"),
    ...actorBindingShape,
    sequence: decimalSequenceSchema,
    dataThrough: z.string().datetime({ offset: true }),
    issuedAt: z.number().int().positive(),
  })
  .strict();

export type LeadFeedCursorClaims = z.infer<typeof leadPageCursorClaimsSchema>;
export type LeadSyncCheckpointClaims = z.infer<
  typeof leadSyncCheckpointClaimsSchema
>;

export class ExternalApiCursorError extends Error {
  constructor() {
    super("External API cursor is invalid");
    this.name = "ExternalApiCursorError";
  }
}

function configError(reason: string): Error {
  return new Error(`EXTERNAL_API_CURSOR_ENCRYPTION_KEYS ${reason}`);
}

export function parseExternalApiCursorKeyRing(
  serialized: string | undefined
): ExternalApiCursorKeyRing {
  if (!serialized) throw configError("is required");
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw configError("is malformed");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw configError("is malformed");
  }
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== 2 ||
    typeof object.activeKid !== "string" ||
    !/^[1-9][0-9]{0,4}$/.test(object.activeKid) ||
    !object.keys ||
    typeof object.keys !== "object" ||
    Array.isArray(object.keys)
  ) {
    throw configError("is malformed");
  }
  const activeKid = Number(object.activeKid);
  if (activeKid > MAX_KID) throw configError("activeKid is out of range");
  const entries = Object.entries(object.keys as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MAX_KEYS) {
    throw configError("must contain one to three keys");
  }
  const keys = new Map<number, Buffer>();
  const materials = new Set<string>();
  for (const [kidText, material] of entries) {
    if (
      !/^[1-9][0-9]{0,4}$/.test(kidText) ||
      Number(kidText) > MAX_KID ||
      typeof material !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(material)
    ) {
      throw configError(`key ${kidText} is malformed`);
    }
    const decoded = Buffer.from(material, "base64url");
    if (
      decoded.byteLength !== KEY_BYTES ||
      decoded.toString("base64url") !== material ||
      materials.has(material)
    ) {
      throw configError(`key ${kidText} must be a unique 32-byte key`);
    }
    keys.set(Number(kidText), decoded);
    materials.add(material);
  }
  if (!keys.has(activeKid)) throw configError("active key is unavailable");
  return Object.freeze({
    activeKid,
    keys: keys as ReadonlyMap<number, Buffer>,
  });
}

export function readExternalApiCursorKeyRing(): ExternalApiCursorKeyRing {
  return parseExternalApiCursorKeyRing(
    process.env.EXTERNAL_API_CURSOR_ENCRYPTION_KEYS
  );
}

function aad(prefix: "cur" | "sync", kid: number): Buffer {
  return Buffer.from(
    `ops-external:${EXTERNAL_API_VERSION}:lead-feed:${prefix}:${kid}`,
    "utf8"
  );
}

function seal(
  prefix: "cur" | "sync",
  claims: unknown,
  keyRing: ExternalApiCursorKeyRing
): string {
  const kid = keyRing.activeKid;
  const key = keyRing.keys.get(kid);
  if (!key) throw new ExternalApiCursorError();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(prefix, kid));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(claims), "utf8"),
    cipher.final(),
  ]);
  const packed = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
  const token = `${prefix}_${kid}_${packed.toString("base64url")}`;
  const maximum = prefix === "cur" ? MAX_CURSOR_BYTES : MAX_CHECKPOINT_BYTES;
  if (Buffer.byteLength(token, "utf8") > maximum) {
    throw new ExternalApiCursorError();
  }
  return token;
}

function open(
  prefix: "cur" | "sync",
  token: string,
  keyRing: ExternalApiCursorKeyRing
): unknown {
  const maximum = prefix === "cur" ? MAX_CURSOR_BYTES : MAX_CHECKPOINT_BYTES;
  if (
    Buffer.byteLength(token, "utf8") > maximum ||
    !token.startsWith(`${prefix}_`)
  ) {
    throw new ExternalApiCursorError();
  }
  const match = token.match(
    new RegExp(`^${prefix}_([1-9][0-9]{0,4})_([A-Za-z0-9_-]+)$`)
  );
  if (!match) throw new ExternalApiCursorError();
  const kid = Number(match[1]);
  const key = keyRing.keys.get(kid);
  if (!key) throw new ExternalApiCursorError();
  try {
    const packed = Buffer.from(match[2], "base64url");
    if (
      packed.toString("base64url") !== match[2] ||
      packed.byteLength <= NONCE_BYTES + TAG_BYTES
    ) {
      throw new ExternalApiCursorError();
    }
    const nonce = packed.subarray(0, NONCE_BYTES);
    const tag = packed.subarray(packed.byteLength - TAG_BYTES);
    const ciphertext = packed.subarray(
      NONCE_BYTES,
      packed.byteLength - TAG_BYTES
    );
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad(prefix, kid));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new ExternalApiCursorError();
  }
}

export function sealLeadFeedCursor(
  claims: LeadFeedCursorClaims,
  keyRing: ExternalApiCursorKeyRing
): string {
  return seal("cur", leadPageCursorClaimsSchema.parse(claims), keyRing);
}

export function openLeadFeedCursor(
  token: string,
  keyRing: ExternalApiCursorKeyRing,
  now = new Date()
): LeadFeedCursorClaims {
  const claims = leadPageCursorClaimsSchema.parse(open("cur", token, keyRing));
  if (claims.expiresAt <= now.getTime()) throw new ExternalApiCursorError();
  return claims;
}

export function sealLeadSyncCheckpoint(
  claims: LeadSyncCheckpointClaims,
  keyRing: ExternalApiCursorKeyRing
): string {
  return seal("sync", leadSyncCheckpointClaimsSchema.parse(claims), keyRing);
}

export function openLeadSyncCheckpoint(
  token: string,
  keyRing: ExternalApiCursorKeyRing
): LeadSyncCheckpointClaims {
  return leadSyncCheckpointClaimsSchema.parse(open("sync", token, keyRing));
}
